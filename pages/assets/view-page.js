// ── View-page logic ──────────────────────────────────────────
// Replaces the original `pages/view/[jobId].js` React page.
// Reads ?jobId= from the URL, fetches the saved result from
// the Cloudflare Worker (which stores it in KV), then renders
// the same results table + sidebar that scraper-page.js uses.

import { WORKER_URL } from "/assets/config.js";
import { T, typeIcon } from "/assets/i18n.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(window.location.search);

const state = {
  jobId:   params.get("jobId") || "",
  lang:    params.get("lang")  || localStorage.getItem("basira.lang")  || "en",
  theme:   params.get("theme") || localStorage.getItem("basira.theme") || "dark",
  url:     "",
  data:    [],
  fields:  [],
  search:  "",
  sortCol: null,
  sortDir: "asc",
};

document.documentElement.setAttribute("data-theme", state.theme);
document.documentElement.setAttribute("dir", state.lang === "ar" ? "rtl" : "ltr");
document.documentElement.setAttribute("lang", state.lang);

const t = T[state.lang];

// ── boot ────────────────────────────────────────────────────
if (!state.jobId) {
  showError("No jobId provided.");
} else {
  loadJob();
}

async function loadJob() {
  try {
    const res = await fetch(
      `${WORKER_URL}/api/results?action=get&jobId=${encodeURIComponent(state.jobId)}`
    );
    if (!res.ok) {
      throw new Error(`Worker returned ${res.status}`);
    }
    const json = await res.json();
    if (!json.success || !json.result) {
      throw new Error(json.error || "Result not found");
    }
    state.url    = json.result.url    || "";
    state.fields = json.result.fields || [];
    state.data   = json.result.data   || [];
    $("job-meta").textContent =
      "· " + (hostnameOf(state.url) || state.jobId);
    renderResults();
    $("loading-screen").hidden = true;
    $("results-screen").hidden = false;
  } catch (err) {
    showError(err.message || String(err));
  }
}

function showError(msg) {
  $("loading-screen").hidden = true;
  $("error-screen").hidden = false;
  $("error-msg").textContent = "⚠️ " + msg;
}

// ╭──────────────────────────────────────────────────────────╮
// │  Render results + export (mirrors scraper-page.js)       │
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

  $("summary-rows").innerHTML = [
    { label: t.rows,       value: allRows.length,        color: "var(--accent)"  },
    { label: t.columns,    value: state.fields.length,   color: "var(--purple)"  },
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

// ── search ──────────────────────────────────────────────────
$("results-search").addEventListener("input", (e) => {
  state.search = e.target.value;
  renderResults();
});

// ── exports (top-nav + sidebar buttons share handlers) ─────
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
$("export-csv").onclick       = exportCSV;
$("export-json").onclick      = exportJSON;
$("export-csv-side").onclick  = exportCSV;
$("export-json-side").onclick = exportJSON;

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
