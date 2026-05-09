// ── Scraper-page logic ────────────────────────────────────────
// Replaces the original `ScraperInterface` React component, but
// instead of opening a real browser window via local Playwright,
// it loads the target URL inside an iframe (proxied through the
// Worker), captures the visual selection via postMessage, and
// then asks the Worker to do the actual scrape on Cloudflare
// Browser Rendering.

import { WORKER_URL } from "/assets/config.js";
import { T, typeIcon } from "/assets/i18n.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);

const state = {
  url:     params.get("url") || "",
  jobId:   params.get("jobId") || ("job-" + Date.now()),
  lang:    params.get("lang") || localStorage.getItem("basira.lang") || "en",
  theme:   params.get("theme") || localStorage.getItem("basira.theme") || "dark",
  mode:    params.get("mode") || "visual",   // visual is the default — manual is a fallback
  stealth: params.get("stealth") === "1",
  rowLimit: parseInt(params.get("rowLimit") || "0", 10) || null,
  data:    [],
  fields:  [],
  search:  "",
  sortCol: null,
  sortDir: "asc",
};

// ── apply chrome ─────────────────────────────────────────────
document.documentElement.setAttribute("data-theme", state.theme);
document.documentElement.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
document.documentElement.setAttribute("lang", state.lang);

const t = T[state.lang];
$("hostname-badge").textContent = "· " + (hostnameOf(state.url) || "");
if (state.stealth) $("stealth-badge").hidden = false;
$("error-back").onclick = () => window.location.href = "/";
$("back-btn").onclick   = () => window.location.href = "/";

// ── view switching ───────────────────────────────────────────
function show(view) {
  for (const id of ["select-screen", "manual-screen", "loading-screen", "error-screen", "results-screen"]) {
    $(id).hidden = id !== view;
  }
  // When the visual-selection iframe is showing, give it the full
  // viewport (hide the top nav). Other screens keep the nav.
  if (view === "select-screen") document.body.classList.add("bs-iframe-mode");
  else                          document.body.classList.remove("bs-iframe-mode");
}

// ── kick off the right view ──────────────────────────────────
if (!state.url) {
  showError("No URL provided. Go back and enter a URL.");
} else if (state.mode === "manual") {
  startManual();
} else {
  startVisual();
}

// ╭──────────────────────────────────────────────────────────╮
// │  Visual selection via iframe + postMessage               │
// ╰──────────────────────────────────────────────────────────╯
function startVisual() {
  show("select-screen");

  const iframe = $("selection-iframe");
  iframe.src = `${WORKER_URL}/proxy?url=${encodeURIComponent(state.url)}`;

  // listen for the selection coming back from the iframe
  window.addEventListener("message", onIframeMessage, false);

  // Some sites detect framing with JS and stay blank. Show a hint
  // after a few seconds so the user can switch to manual mode.
  setTimeout(() => {
    try {
      const doc = iframe.contentDocument;
      const empty = !doc || !doc.body || !doc.body.children.length;
      if (empty) showBlankHint();
    } catch (_) {
      // cross-origin — likely loaded fine but we can't peek; ignore
    }
  }, 6000);
}

function showBlankHint() {
  const hint = $("iframe-blank-hint");
  if (!hint) return;
  $("iframe-note").textContent =
    state.lang === "ar"
      ? "الموقع رفض التحميل داخل الإطار. حوّل إلى الوضع اليدوي والصق محدِّدات CSS."
      : "The site refused to be embedded. Switch to manual mode and paste CSS selectors.";
  hint.hidden = false;
  $("switch-to-manual").onclick = () => {
    hint.hidden = true;
    window.removeEventListener("message", onIframeMessage, false);
    startManual();
  };
}

function onIframeMessage(ev) {
  if (!ev.data || ev.data.basira !== true) return;
  if (ev.data.type === "cancelled") {
    window.location.href = "/";
    return;
  }
  if (ev.data.type === "selection") {
    window.removeEventListener("message", onIframeMessage, false);
    runScrape(ev.data.payload);
  }
}

// ╭──────────────────────────────────────────────────────────╮
// │  Manual selectors workspace                               │
// ╰──────────────────────────────────────────────────────────╯
function startManual() {
  $("manual-title").textContent = t.manualMode;
  $("lbl-parent").textContent   = t.parentSelector;
  $("lbl-item").textContent     = t.itemSelector;
  $("lbl-fields").textContent   = t.fields;
  $("lbl-add").textContent      = "Add field";
  $("lbl-run").textContent      = t.runScrape;
  $("m-method").innerHTML =
    `<option value="auto-scroll">${t.methodAutoScroll}</option>` +
    `<option value="pagination">${t.methodPagination}</option>` +
    `<option value="load-more">${t.methodLoadMore}</option>`;

  addManualField();
  $("m-add-field").onclick = addManualField;
  $("m-method").onchange = () => {
    const v = $("m-method").value;
    $("m-extra-row").hidden = (v === "auto-scroll");
    $("lbl-extra").textContent = v === "pagination" ? t.paginationSelector
                                : v === "load-more" ? t.loadMoreSelector
                                : "";
    if (v === "pagination") $("m-extra").placeholder = ".pagination .next";
    if (v === "load-more")  $("m-extra").placeholder = ".load-more-btn";
  };
  $("m-run").onclick = onManualRun;
  show("manual-screen");
}

function addManualField() {
  const wrap = $("m-fields");
  const row = document.createElement("div");
  row.className = "bs-field-row";
  row.innerHTML =
    `<input class="bs-input bs-input-sm" data-fk="name" placeholder="title"/>` +
    `<input class="bs-input bs-input-sm" data-fk="selector" placeholder=".product-title" style="flex:2"/>` +
    `<select class="bs-input bs-input-sm" data-fk="type">` +
      `<option value="text">📝 Text</option>` +
      `<option value="link">🔗 Link</option>` +
      `<option value="image">🖼 Image</option>` +
      `<option value="price">💰 Price</option>` +
    `</select>` +
    `<button class="bs-icon-btn" type="button">×</button>`;
  row.querySelector("button").onclick = () => row.remove();
  wrap.appendChild(row);
}

function onManualRun() {
  const parent = $("m-parent").value.trim();
  const item   = $("m-item").value.trim();
  if (!parent || !item) {
    alert("Container and item selectors are required.");
    return;
  }
  const fieldRows = $("m-fields").querySelectorAll(".bs-field-row");
  const fields = [];
  fieldRows.forEach((r) => {
    const name = r.querySelector('[data-fk="name"]').value.trim();
    const sel  = r.querySelector('[data-fk="selector"]').value.trim();
    const ty   = r.querySelector('[data-fk="type"]').value;
    if (name && sel) fields.push({ name, selector: sel, type: ty });
  });
  if (!fields.length) { alert("Add at least one field."); return; }

  const method = $("m-method").value;
  const extra  = $("m-extra").value.trim();

  const payload = {
    parentSelector: parent,
    itemSelector:   item,
    loadingMethod:  method,
    paginationSelector: method === "pagination" ? extra : null,
    loadMoreSelector:   method === "load-more"  ? extra : null,
    fields,
  };
  runScrape(payload);
}

// ╭──────────────────────────────────────────────────────────╮
// │  Run the scrape on the Worker                            │
// ╰──────────────────────────────────────────────────────────╯
async function runScrape(selection) {
  show("loading-screen");
  $("loading-title").textContent = t.extracting;
  $("loading-sub").textContent   = t.collectingItems;

  try {
    const res = await fetch(`${WORKER_URL}/api/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url:      state.url,
        jobId:    state.jobId,
        selection,
        rowLimit: state.rowLimit,
        stealth:  state.stealth,
        lang:     state.lang,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Worker returned ${res.status}: ${txt.slice(0, 200)}`);
    }
    const result = await res.json();
    if (!result.success) throw new Error(result.error || "Scrape failed");

    state.fields = result.fields || [];
    state.data   = result.data   || [];
    renderResults();
    show("results-screen");
  } catch (err) {
    showError(err.message || String(err));
  }
}

function showError(msg) {
  $("error-title").textContent = t.error;
  $("error-sub").textContent   = msg;
  show("error-screen");
}

// ╭──────────────────────────────────────────────────────────╮
// │  Render results + export                                 │
// ╰──────────────────────────────────────────────────────────╯
function rebuildRows() {
  const map = {};
  for (const it of state.data) {
    if (!map[it.item_index]) map[it.item_index] = {};
    map[it.item_index][it.field_name] = it.value;
  }
  return Object.values(map);
}

function renderResults() {
  const allRows = rebuildRows();

  const filtered = allRows
    .filter((row) => !state.search || state.fields.some((f) => (row[f.name] || "").toLowerCase().includes(state.search.toLowerCase())))
    .sort((a, b) => {
      if (!state.sortCol) return 0;
      const av = (a[state.sortCol] || "").toLowerCase();
      const bv = (b[state.sortCol] || "").toLowerCase();
      const an = parseFloat(av), bn = parseFloat(bv);
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
      return state.sortDir === "asc" ? cmp : -cmp;
    });

  // sidebar summary
  const totalCells = state.data.length;
  const fillRate = totalCells > 0
    ? Math.round(((totalCells - state.data.filter((d) => !d.value || d.value === "N/A").length) / totalCells) * 100)
    : 0;

  $("lbl-complete").textContent = (t.complete || "").toUpperCase();
  $("lbl-summary").textContent  = t.summary;
  $("lbl-fields").textContent   = t.fields;
  $("lbl-export").textContent   = t.export;

  $("summary-rows").innerHTML = [
    { label: t.rows,       value: allRows.length, color: "var(--accent)" },
    { label: t.columns,    value: state.fields.length, color: "var(--purple)" },
    { label: t.totalCells, value: totalCells, color: "var(--success)" },
    { label: t.fillRate,   value: fillRate + "%", color: fillRate >= 80 ? "var(--success)" : "var(--warning)" },
  ].map((s) =>
    `<div class="bs-stat-row"><span class="bs-stat-label">${escapeHtml(s.label)}</span><span class="bs-stat-value" style="color:${s.color}">${escapeHtml(String(s.value))}</span></div>`
  ).join("");

  $("fields-chips").innerHTML = state.fields.map((f) =>
    `<div class="bs-field-chip"><span>${typeIcon[f.type] || "📝"}</span>${escapeHtml(f.name)}</div>`
  ).join("");

  // table head
  const thead = $("results-head");
  thead.innerHTML = `<th style="width:40px">#</th>` + state.fields.map((f) => {
    const arrow = state.sortCol === f.name ? (state.sortDir === "asc" ? t.sortAsc : t.sortDesc)
                                            : `<span style="opacity:.35">${t.sortNone}</span>`;
    return `<th data-col="${escapeAttr(f.name)}">${typeIcon[f.type] || ""} ${escapeHtml(f.name)} ${arrow}</th>`;
  }).join("");
  thead.querySelectorAll("[data-col]").forEach((th) => {
    th.onclick = () => {
      const c = th.getAttribute("data-col");
      if (state.sortCol === c) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortCol = c; state.sortDir = "asc"; }
      renderResults();
    };
  });

  // table body
  const tbody = $("results-body");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td class="bs-empty" colspan="${state.fields.length + 1}">No results for "${escapeHtml(state.search)}"</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map((row, ri) =>
      `<tr><td style="color:var(--text-muted);font-family:var(--mono);font-size:.72rem">${ri + 1}</td>` +
      state.fields.map((f) => `<td style="max-width:240px">${renderCell(f, row)}</td>`).join("") +
      `</tr>`
    ).join("");
  }

  $("results-count").textContent = `${filtered.length} / ${allRows.length}`;

  // expose export buttons on the navbar
  $("export-csv").hidden  = false;
  $("export-json").hidden = false;
}

function renderCell(field, row) {
  const val = row[field.name];
  if (!val || val === "N/A") return `<span style="color:var(--text-muted);font-style:italic">—</span>`;
  if (field.type === "image") return `<a href="${escapeAttr(val)}" target="_blank" rel="noreferrer"><img src="${escapeAttr(val)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;display:block" onerror="this.style.display='none'"/></a>`;
  if (field.type === "link") {
    const label = val.replace(/^https?:\/\//, "").substring(0, 40);
    return `<a href="${escapeAttr(val)}" target="_blank" rel="noreferrer" style="color:var(--accent);text-decoration:none;font-size:.78rem;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">🔗 ${escapeHtml(label)}</a>`;
  }
  if (field.type === "price") return `<span style="color:var(--success);font-weight:800;font-family:var(--mono)">${escapeHtml(val)}</span>`;
  return `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escapeHtml(val)}</span>`;
}

// ── search ──────────────────────────────────────────────────
$("results-search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderResults();
});

// ── exports ─────────────────────────────────────────────────
$("export-csv").onclick = $("export-csv-side").onclick = () => {
  const rows = rebuildRows();
  const h = state.fields.map((f) => f.name);
  const csv = [
    h.join(","),
    ...rows.map((r) => h.map((k) => `"${(r[k] || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  download(`basira-${state.jobId}.csv`, "text/csv;charset=utf-8", "\uFEFF" + csv);
};
$("export-json").onclick = $("export-json-side").onclick = () => {
  const rows = rebuildRows();
  download(`basira-${state.jobId}.json`, "application/json;charset=utf-8", JSON.stringify({ url: state.url, jobId: state.jobId, fields: state.fields, rows }, null, 2));
};

// ── helpers ─────────────────────────────────────────────────
function download(filename, type, content) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function hostnameOf(u) { try { return new URL(u).hostname; } catch (_) { return u; } }
