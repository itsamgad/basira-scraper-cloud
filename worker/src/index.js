// ╭───────────────────────────────────────────────────────────╮
// │   Basira Scraper — Cloudflare Worker entry                │
// ╰───────────────────────────────────────────────────────────╯
//
// This Worker is the entire backend. It replaces:
//
//   server.js                (the Next.js dev server)
//   pages/api/scraper.js     (Playwright-on-localhost scraper)
//   pages/api/history.js     (file-on-disk history)
//
// All endpoints respond with CORS headers so the static Pages
// frontend can talk to it directly from the browser.
//
//   GET    /                      → tiny status page
//   GET    /health                → liveness probe
//   GET    /proxy?url=...         → iframe-ready proxied target page
//   POST   /api/scrape            → run Playwright on Browser Rendering
//   GET    /api/history?action=list
//   POST   /api/history?action=add
//   DELETE /api/history?action=delete&id=...
//   DELETE /api/history?action=clear
//   GET    /api/results?action=get&jobId=...

import { handleProxy }   from "./proxy.js";
import { handleScrape }  from "./scrape.js";
import { handleHistory } from "./history.js";
import { handleResults } from "./results.js";
import { handlePreflight, jsonResponse, withCors } from "./cors.js";

export default {
  async fetch(request, env, ctx) {
    // Preflight CORS
    if (request.method === "OPTIONS") return handlePreflight(env);

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/" || path === "")
        return statusPage(env);

      if (path === "/health")
        return jsonResponse({ ok: true, ts: Date.now() }, env);

      if (path === "/proxy")
        return handleProxy(request, env);

      if (path === "/api/scrape")
        return handleScrape(request, env, ctx);

      if (path === "/api/history")
        return handleHistory(request, env);

      if (path === "/api/results")
        return handleResults(request, env);

      return jsonResponse({ error: "Not found", path }, env, 404);
    } catch (err) {
      console.error("Unhandled:", err);
      return jsonResponse({ error: err.message || "Internal error" }, env, 500);
    }
  },
};

function statusPage(env) {
  const body = `<!doctype html>
<meta charset="utf-8">
<title>Basira Scraper · Worker</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#f1f5f9;
       margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:560px;background:#111827;border:1px solid rgba(255,255,255,.07);
        border-radius:20px;padding:36px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  h1{margin:0 0 8px;font-size:26px;color:#38bdf8;letter-spacing:-.5px}
  p{color:#94a3b8;line-height:1.6;font-size:14px}
  code{background:#1e293b;padding:2px 8px;border-radius:6px;color:#a5f3fc;font-size:13px}
  ul{padding-left:18px;color:#cbd5e1;font-size:13px;line-height:1.9}
  .badge{display:inline-block;padding:4px 10px;background:rgba(34,197,94,.12);
         color:#22c55e;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1px;
         border:1px solid rgba(34,197,94,.25);margin-bottom:14px}
</style>
<div class="card">
  <span class="badge">RUNNING</span>
  <h1>Basira Scraper · Worker</h1>
  <p>Backend running on Cloudflare Workers + Browser Rendering.<br>
     The frontend lives on Cloudflare Pages — open it from there.</p>
  <ul>
    <li><code>GET /proxy?url=…</code> · iframe-ready target</li>
    <li><code>POST /api/scrape</code> · run a scrape job</li>
    <li><code>GET /api/history?action=list</code></li>
    <li><code>GET /api/results?action=get&amp;jobId=…</code></li>
  </ul>
</div>`;
  return withCors(
    new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    env,
  );
}
