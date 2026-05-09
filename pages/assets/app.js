// ── Landing-page logic ────────────────────────────────────────
// Mirrors the React `Home` component from the original
// `pages/index.js` but written as plain DOM/JS so it can be
// served as a static file from Cloudflare Pages with no build step.

import { WORKER_URL } from "/assets/config.js";
import { T, methodIcon, timeAgo } from "/assets/i18n.js";

const $ = (id) => document.getElementById(id);

// ── state ────────────────────────────────────────────────────
const state = {
  lang:    localStorage.getItem("basira.lang")    || "en",
  theme:   localStorage.getItem("basira.theme")   || "dark",
  stealth: localStorage.getItem("basira.stealth") === "1",
};

// ── apply theme + lang ───────────────────────────────────────
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

  // toggle visual on stealth pill
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

// ── handlers for chrome ──────────────────────────────────────
$("lang-toggle").onclick = () => {
  state.lang = state.lang === "en" ? "ar" : "en";
  localStorage.setItem("basira.lang", state.lang);
  applyChrome();
  loadHistory();
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

// ── start handler ────────────────────────────────────────────
$("start-btn").onclick = handleStart;
$("url-input").onkeypress = (e) => { if (e.key === "Enter") handleStart(); };

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

  const jobId = "job-" + Date.now();
  const params = new URLSearchParams({
    url:     raw,
    jobId,
    lang:    state.lang,
    theme:   state.theme,
    stealth: state.stealth ? "1" : "0",
  });
  if (rowLimit) params.set("rowLimit", rowLimit);

  // Open the scraper screen in a NEW TAB so the home page stays as a
  // "control room" — just like the original local app opened a new
  // browser window.
  window.open("/scraper.html?" + params.toString(), "_blank", "noopener");
}

// ── history ──────────────────────────────────────────────────
async function loadHistory() {
  const t = T[state.lang];
  try {
    const res = await fetch(`${WORKER_URL}/api/history?action=list`);
    const data = await res.json();
    renderHistory(data.history || [], t);
  } catch (e) {
    renderHistory([], t);
  }
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
      await fetch(`${WORKER_URL}/api/history?action=delete&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      loadHistory();
    };
  });
}

$("history-clear").onclick = async () => {
  await fetch(`${WORKER_URL}/api/history?action=clear`, { method: "DELETE" });
  loadHistory();
};

loadHistory();

// ── helpers ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// ── deep-link support: ?url=... auto-jumps to scraper.html ──
// Useful for the Basira button: it can pass `?url=…&autostart=1`.
const initParams = new URLSearchParams(window.location.search);
const initialUrl = initParams.get("url");
if (initialUrl) {
  $("url-input").value = initialUrl;
  if (initParams.get("autostart") === "1") handleStart();
}
