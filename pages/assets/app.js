// ╭─────────────────────────────────────────────────────────────╮
// │  Basira Scraper — single-page flow                          │
// ╰─────────────────────────────────────────────────────────────╯
//
// Everything happens in this one page, no new tabs:
//
//   home  ─click Start─▶  modal (iframe + overlay)
//                            │
//                            ▼ postMessage({type:'selection'})
//                         progress (live polling)
//                            │
//                            ▼
//                         results (table + export)
//
// The iframe loads the worker `/proxy?url=…` URL. The worker fetches
// the target site, strips X-Frame-Options & CSP, neutralises common
// frame-busting JS patterns, and injects the overlay sidebar. The
// `sandbox="allow-scripts allow-same-origin allow-forms"` attribute
// (NO `allow-top-navigation`) prevents the iframe from breaking out
// even if a frame-busting pattern survives our rewriter.

import { T, methodIcon, typeIcon, timeAgo } from "/assets/i18n.js";

const $ = (id) => document.getElementById(id);

// ── state ────────────────────────────────────────────────────
const state = {
  lang:    localStorage.getItem("basira.lang")    || "en",
  theme:   localStorage.getItem("basira.theme")   || "dark",
  stealth: localStorage.getItem("basira.stealth") === "1",

  url:      "",
  jobId:    null,
  rowLimit: null,

  data:    [],
  fields:  [],

  // results table view-state
  search:  "",
  sortCol: null,
  sortDir: "asc",
};

// ╭──────────────────────────────────────────────────────────╮
// │  Section switcher                                        │
// ╰──────────────────────────────────────────────────────────╯
const SECTIONS = ["home", "modal", "manual", "progress", "error", "results"];
function show(name) {
  for (const s of SECTIONS) {
    $(s + "-section").hidden = s !== name;
  }
  // top-nav buttons follow the section
  $("export-csv").hidden     = name !== "results";
  $("export-json").hidden    = name !== "results";
  $("new-scrape-btn").hidden = (name === "home" || name === "modal");
  // hostname badge only meaningful while we're working on a URL
  $("hostname-badge").textContent =
    name === "home" || !state.url ? "" : "· " + hostnameOf(state.url);
  // body class so CSS can blank-out chrome behind modal
  document.body.classList.toggle("bs-modal-open", name === "modal");
}

// ╭──────────────────────────────────────────────────────────╮
// │  Theme + lang chrome                                     │
// ╰──────────────────────────────────────────────────────────╯
function applyChrome() {
  document.documentElement.setAttribute("data-theme", state.theme);
  document.documentElement.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
  document.documentElement.setAttribute("lang", state.lang);

  const t = T[state.lang];
  $("brand").textContent       = t.brand;
  $("subtitle").textContent    = t.subtitle;
  $("start-label").textContent = t.start;
  $("row-input").placeholder   = t.maxRows;
  $("advanced-label").textContent = t.advanced;
  $("stealth-label").textContent  = t.stealth;
  $("stealth-desc").textContent   = t.stealthDesc;
  $("history-label").textContent  = t.history;
  $("f1").textContent = t.f1; $("f2").textContent = t.f2;
  $("f3").textContent = t.f3; $("f4").textContent = t.f4;

  $("lang-toggle").textContent  = state.lang === "en" ? "AR" : "EN";
  $("theme-toggle").textContent = state.theme === "dark" ? "☀️" : "🌙";

  const tog = $("stealth-toggle");
  if (state.stealth) {
    tog.style.background = "var(--accent)";
    tog.firstElementChild.style.left = "21px";
    $("stealth-row").classList.add("active");
  } else {
    tog.style.background = "var(--border-2)";
    tog.firstElementChild.style.left = "3px";
    $("stealth-row").classList.remove("active");
  }
}
applyChrome();

$("lang-toggle").onclick = () => {
  state.lang = state.lang === "en" ? "ar" : "en";
  localStorage.setItem("basira.lang", state.lang);
  applyChrome(); loadHistory();
};
$("theme-toggle").onclick = () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("basira.theme", state.theme);
  applyChrome();
};
$("stealth-toggle").onclick = () => {
  state.stealth = !state.stealth;
  localStorage.setItem("basira.stealth", state.stealth ? "1" : "0");
  applyChrome();
};
$("advanced-toggle").onclick = () => {
  const p = $("advanced-panel");
  p.hidden = !p.hidden;
  $("advanced-toggle").firstChild.textContent = p.hidden ? "▼ " : "▲ ";
};

$("new-scrape-btn").onclick = backHome;
$("error-back").onclick     = backHome;
$("modal-close").onclick    = closeModal;
$("hint-cancel").onclick    = closeModal;
$("hint-manual").onclick    = () => { closeModalKeepUrl(); openManual(); };

function backHome() {
  state.url = ""; state.jobId = null; state.rowLimit = null;
  state.data = []; state.fields = [];
  show("home");
  loadHistory();
}

// ╭──────────────────────────────────────────────────────────╮
// │  Home → Start                                            │
// ╰──────────────────────────────────────────────────────────╯
$("start-btn").onclick     = handleStart;
$("url-input").onkeypress  = (e) => { if (e.key === "Enter") handleStart(); };

function handleStart() {
  const t = T[state.lang];
  $("url-error").innerHTML = "";
  $("row-error").innerHTML = "";

  let raw = $("url-input").value.trim();
  let rowLimit = $("row-input").value.trim();
  let valid = true;

  if (!raw) {
    $("url-error").innerHTML = `<div class="bs-error-banner" style="margin-top:10px">⚠️ ${escapeHtml(t.urlError)}</div>`;
    valid = false;
  }
  if (rowLimit && (isNaN(parseInt(rowLimit)) || parseInt(rowLimit) < 1)) {
    $("row-error").innerHTML = `<div class="bs-error-banner" style="margin-top:8px">⚠️ ${escapeHtml(t.rowError)}</div>`;
    valid = false;
  }
  if (!valid) return;

  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  state.url      = raw;
  state.jobId    = "job-" + Date.now();
  state.rowLimit = rowLimit ? parseInt(rowLimit, 10) : null;

  openModal();
}

// ╭──────────────────────────────────────────────────────────╮
// │  Modal: load worker proxy in iframe + listen for events  │
// ╰──────────────────────────────────────────────────────────╯
let blankHintTimer = null;

function openModal() {
  const t = T[state.lang];
  $("modal-url").textContent = state.url;
  $("modal-blank-hint").hidden = true;
  $("hint-title").textContent = t.error || "This site blocks framing";
  $("hint-desc").textContent  = t.iframeNote;

  // Build proxy URL
  const params = new URLSearchParams({
    url:      state.url,
    jobId:    state.jobId,
    lang:     state.lang,
    stealth:  state.stealth ? "1" : "0",
    pagesUrl: window.location.origin,
  });
  if (state.rowLimit) params.set("rowLimit", String(state.rowLimit));

  $("modal-iframe").src = `/proxy?${params.toString()}`;
  show("modal");

  // Listen for selection events from the iframe
  window.addEventListener("message", onIframeMessage, false);

  // If the iframe stays blank after 7s, show a manual fallback hint.
  // (Some sites detect framing in ways our rewriter can't catch.)
  if (blankHintTimer) clearTimeout(blankHintTimer);
  blankHintTimer = setTimeout(() => {
    try {
      const fr = $("modal-iframe");
      const doc = fr.contentDocument;
      const empty = !doc || !doc.body || !doc.body.children.length;
      if (empty) $("modal-blank-hint").hidden = false;
    } catch (_) { /* cross-origin: probably loaded fine */ }
  }, 7000);
}

function closeModal() {
  closeModalKeepUrl();
  backHome();
}

function closeModalKeepUrl() {
  if (blankHintTimer) { clearTimeout(blankHintTimer); blankHintTimer = null; }
  window.removeEventListener("message", onIframeMessage, false);
  $("modal-iframe").src = "about:blank";
}

function onIframeMessage(ev) {
  if (!ev.data || ev.data.basira !== true) return;
  if (ev.data.type === "cancelled") {
    closeModal();
    return;
  }
  if (ev.data.type === "selection") {
    closeModalKeepUrl();
    runScrape(ev.data.payload);
  }
}

// ╭──────────────────────────────────────────────────────────╮
// │  Manual fallback                                         │
// ╰──────────────────────────────────────────────────────────╯
function openManual() {
  const t = T[state.lang];
  $("manual-title").textContent = t.manualMode;
  $("lbl-parent").textContent   = t.parentSelector;
  $("lbl-item").textContent     = t.itemSelector;
  $("lbl-fields-m").textContent = t.fields;
  $("lbl-add").textContent      = "Add field";
  $("lbl-run").textContent      = t.runScrape;
  $("m-method").innerHTML =
    `<option value="auto-scroll">${t.methodAutoScroll}</option>` +
    `<option value="pagination">${t.methodPagination}</option>` +
    `<option value="load-more">${t.methodLoadMore}</option>`;

  $("m-fields").innerHTML = "";
  addManualField();
  $("m-add-field").onclick = addManualField;
  $("m-method").onchange = () => {
    const v = $("m-method").value;
    $("m-extra-row").hidden = (v === "auto-scroll");
    $("lbl-extra").textContent = v === "pagination" ? t.paginationSelector
                              : v === "load-more"  ? t.loadMoreSelector
                              : "";
    if (v === "pagination") $("m-extra").placeholder = ".pagination .next";
    if (v === "load-more")  $("m-extra").placeholder = ".load-more-btn";
  };
  $("m-cancel").onclick = backHome;
  $("m-run").onclick    = onManualRun;
  show("manual");
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
  if (!parent || !item) { alert("Container and item selectors are required."); return; }

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

  runScrape({
    parentSelector: parent,
    itemSelector:   item,
    loadingMethod:  method,
    paginationSelector: method === "pagination" ? extra : null,
    loadMoreSelector:   method === "load-more"  ? extra : null,
    fields,
  });
}

// ╭──────────────────────────────────────────────────────────╮
// │  Progress + Scrape                                       │
// ╰──────────────────────────────────────────────────────────╯
async function runScrape(selection) {
  const t = T[state.lang];
  $("loading-title").textContent = t.extracting;
  $("loading-sub").textContent   = t.collectingItems;
  show("progress");

  const progressTimer = setInterval(pollProgress, 1200);
  try {
    const res = await fetch(`/api/scrape`, {
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
    show("results");
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    clearInterval(progressTimer);
  }
}

async function pollProgress() {
  if (!state.jobId) return;
  try {
    const res = await fetch(
      `/api/results?action=progress&jobId=${encodeURIComponent(state.jobId)}`
    );
    if (!res.ok) return;
    const json = await res.json();
    const p = json && json.progress;
    if (!p) return;

    if (p.status === "starting") {
      $("loading-sub").textContent =
        state.lang === "ar" ? "جاري تشغيل المتصفح…" : "Launching browser…";
      return;
    }
    if (p.status === "extracting") {
      const items = p.itemsCollected || 0;
      const total = p.totalToProcess || null;
      const page  = p.currentPage   || null;
      const parts = [];
      if (page && p.totalPages && p.totalPages !== "?") {
        parts.push(state.lang === "ar"
          ? `الصفحة ${page} من ${p.totalPages}`
          : `Page ${page} of ${p.totalPages}`);
      } else if (page) {
        parts.push(state.lang === "ar" ? `الصفحة ${page}` : `Page ${page}`);
      }
      parts.push(state.lang === "ar"
        ? `تم جمع ${items}${total ? " / " + total : ""} عنصر`
        : `${items}${total ? " / " + total : ""} items collected`);
      if (p.failedItems) {
        parts.push(state.lang === "ar"
          ? `${p.failedItems} فشل`
          : `${p.failedItems} failed`);
      }
      $("loading-sub").textContent = parts.join(" · ");
    }
  } catch (_) { /* network blip — try again next tick */ }
}

function showError(msg) {
  const t = T[state.lang];
  $("error-title").textContent = t.error;
  $("error-sub").textContent   = msg;
  show("error");
}

// ╭──────────────────────────────────────────────────────────╮
// │  Results table                                           │
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
  const t = T[state.lang];
  const allRows = rebuildRows();

  const filtered = allRows
    .filter((row) =>
      !state.search ||
      state.fields.some((f) =>
        (row[f.name] || "").toLowerCase().includes(state.search.toLowerCase())
      )
    )
    .sort((a, b) => {
      if (!state.sortCol) return 0;
      const av = (a[state.sortCol] || "").toLowerCase();
      const bv = (b[state.sortCol] || "").toLowerCase();
      const an = parseFloat(av), bn = parseFloat(bv);
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
      return state.sortDir === "asc" ? cmp : -cmp;
    });

  const totalCells = state.data.length;
  const fillRate = totalCells > 0
    ? Math.round(
        ((totalCells - state.data.filter((d) => !d.value || d.value === "N/A").length) /
          totalCells) * 100
      )
    : 0;

  $("lbl-complete").textContent = (t.complete || "").toUpperCase();
  $("lbl-summary").textContent  = t.summary;
  $("lbl-fields").textContent   = t.fields;
  $("lbl-export").textContent   = t.export;

  $("summary-rows").innerHTML = [
    { label: t.rows,       value: allRows.length,        color: "var(--accent)" },
    { label: t.columns,    value: state.fields.length,   color: "var(--purple)" },
    { label: t.totalCells, value: totalCells,            color: "var(--success)" },
    { label: t.fillRate,   value: fillRate + "%",        color: fillRate >= 80 ? "var(--success)" : "var(--warning)" },
  ].map((s) =>
    `<div class="bs-stat-row"><span class="bs-stat-label">${escapeHtml(s.label)}</span><span class="bs-stat-value" style="color:${s.color}">${escapeHtml(String(s.value))}</span></div>`
  ).join("");

  $("fields-chips").innerHTML = state.fields.map((f) =>
    `<div class="bs-field-chip"><span>${typeIcon[f.type] || "📝"}</span>${escapeHtml(f.name)}</div>`
  ).join("");

  const thead = $("results-head");
  thead.innerHTML = `<th style="width:40px">#</th>` + state.fields.map((f) => {
    const arrow = state.sortCol === f.name
      ? (state.sortDir === "asc" ? t.sortAsc : t.sortDesc)
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

$("results-search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderResults();
});

function exportCSV() {
  const rows = rebuildRows();
  const h = state.fields.map((f) => f.name);
  const csv = [
    h.join(","),
    ...rows.map((r) => h.map((k) => `"${(r[k] || "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  download(`basira-${state.jobId}.csv`, "text/csv;charset=utf-8", "\uFEFF" + csv);
}
function exportJSON() {
  const rows = rebuildRows();
  download(
    `basira-${state.jobId}.json`,
    "application/json;charset=utf-8",
    JSON.stringify({ url: state.url, jobId: state.jobId, fields: state.fields, rows }, null, 2)
  );
}
$("export-csv").onclick      = exportCSV;
$("export-json").onclick     = exportJSON;
$("export-csv-side").onclick = exportCSV;
$("export-json-side").onclick= exportJSON;

// ╭──────────────────────────────────────────────────────────╮
// │  History                                                 │
// ╰──────────────────────────────────────────────────────────╯
async function loadHistory() {
  const t = T[state.lang];
  try {
    const res = await fetch(`/api/history?action=list`);
    const data = await res.json();
    renderHistory(data.history || [], t);
  } catch (e) { renderHistory([], t); }
}

function renderHistory(history, t) {
  const list = $("history-list");
  $("history-clear").hidden = history.length === 0;
  if (!history.length) {
    list.innerHTML = `<div class="bs-card" style="text-align:center;padding:32px;color:var(--text-muted);font-size:.86rem;border-style:dashed">${escapeHtml(t.noHistory)}</div>`;
    return;
  }
  list.innerHTML = history.map((entry) => {
    const failed = entry.failedItems > 0
      ? `<span style="color:var(--danger);margin-inline-start:8px">⚠️ ${entry.failedItems} failed</span>`
      : "";
    return `<div class="bs-history-item" data-id="${escapeAttr(entry.id)}">
      <div class="bs-history-icon">${methodIcon[entry.loadingMethod] || "📊"}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr">${escapeHtml(entry.hostname || entry.url)}</div>
        <div class="bs-history-meta">
          <span style="font-family:var(--mono)">${entry.rows}</span> rows · ${entry.fields.length} fields · ${entry.duration}s · ${escapeHtml(timeAgo(entry.timestamp, t))}
          ${failed}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <a href="/view.html?jobId=${encodeURIComponent(entry.id)}" target="_blank" rel="noreferrer"
           class="bs-btn bs-btn-ghost" style="padding:7px 14px;font-size:.75rem;text-decoration:none">👁 View</a>
        <button class="bs-icon-btn" data-del="${escapeAttr(entry.id)}">×</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-del");
      await fetch(`/api/history?action=delete&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      loadHistory();
    };
  });
}

$("history-clear").onclick = async () => {
  await fetch(`/api/history?action=clear`, { method: "DELETE" });
  loadHistory();
};

// ╭──────────────────────────────────────────────────────────╮
// │  Boot                                                    │
// ╰──────────────────────────────────────────────────────────╯
show("home");
loadHistory();

// Deep-link support: ?url=…&autostart=1 (used by the Basira button)
const initParams = new URLSearchParams(window.location.search);
const initialUrl = initParams.get("url");
if (initialUrl) {
  $("url-input").value = initialUrl;
  if (initParams.get("autostart") === "1") handleStart();
}

// ╭──────────────────────────────────────────────────────────╮
// │  Helpers                                                 │
// ╰──────────────────────────────────────────────────────────╯
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
