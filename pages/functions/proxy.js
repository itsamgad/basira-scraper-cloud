// Pages Function — handles GET /proxy?url=...
// Routed automatically by Pages because of the file path.
//
// Acts as a reverse proxy: fetches the target site server-side,
// strips X-Frame-Options + CSP, neutralises common JS frame-busting
// patterns, and injects the overlay sidebar before serving.
// The user's iframe loads this URL — same origin as the Pages site,
// so no CORS, no popup, no extra config.

import { overlayScript } from "./_lib/overlay-injector-string.js";
import { errorResponse, withCors } from "./_lib/cors.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return errorResponse("Missing ?url= parameter", 400);

  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (!/^https?:$/.test(targetUrl.protocol))
      throw new Error("Only http/https URLs are allowed");
  } catch (e) {
    return errorResponse("Invalid URL: " + e.message, 400);
  }

  // ── fetch the target page ────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      },
      redirect: "follow",
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (e) {
    return errorResponse("Failed to fetch target: " + e.message, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    // Not HTML — just stream through.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: stripFrameHeaders(upstream.headers),
    });
  }

  let html = await upstream.text();

  // ── strip inline CSP <meta> tags ─────────────────────────
  html = html.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    "",
  );
  html = html.replace(
    /<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi,
    "",
  );

  // ── neutralise common JS frame-busting patterns ──────────
  // The iframe sandbox already blocks `allow-top-navigation`, so even
  // if a pattern slips through the rewriter, the browser refuses the
  // breakout. This is belt-and-braces.
  html = html.replace(/\btop\s*!=+\s*self\b/g,                  "false");
  html = html.replace(/\bself\s*!=+\s*top\b/g,                  "false");
  html = html.replace(/\bwindow\.top\s*!=+\s*window\.self\b/g,  "false");
  html = html.replace(/\bwindow\.self\s*!=+\s*window\.top\b/g,  "false");
  html = html.replace(/\btop\s*!=+\s*window\b/g,                "false");
  html = html.replace(/\bparent\s*!=+\s*window\b/g,             "false");
  html = html.replace(/\bwindow\.parent\s*!=+\s*window\b/g,     "false");
  html = html.replace(/\bwindow\.frameElement\s*!=+\s*null\b/g, "false");
  html = html.replace(/\bif\s*\(\s*self\s*!=+\s*top\s*\)/g,     "if(false)");
  html = html.replace(/\bif\s*\(\s*top\s*!=+\s*self\s*\)/g,     "if(false)");

  // ── inject <base href> + prelude into <head> ────────────
  html = html.replace(/<base\b[^>]*>/gi, "");
  const baseTag = `<base href="${escapeAttr(targetUrl.toString())}">`;
  const prelude = `<script>
    (function(){
      try {
        Object.defineProperty(window, 'frameElement', { get: function(){ return null; } });
      } catch(_){}
    })();
  </script>`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + baseTag + prelude);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + "<head>" + baseTag + prelude + "</head>");
  } else {
    html = baseTag + prelude + html;
  }

  // ── runtime context for the overlay ─────────────────────
  const jobId    = url.searchParams.get("jobId")    || "job-" + Date.now();
  const pagesUrl = url.searchParams.get("pagesUrl") || "";
  const lang     = url.searchParams.get("lang")     || "en";
  const stealth  = url.searchParams.get("stealth")  || "0";
  const rowLimit = url.searchParams.get("rowLimit") || "";

  const ctx =
    `<script>window.__BASIRA__ = ${JSON.stringify({
      jobId, pagesUrl, lang, stealth, rowLimit,
      sourceUrl: targetUrl.toString(),
    })};</script>`;

  // ── inject overlay before </body> ───────────────────────
  const injection = ctx + `<script>${overlayScript}</script>`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, injection + "</body>");
  } else {
    html = html + injection;
  }

  // ── send rewritten HTML, frame-blocking headers stripped ──
  const headers = stripFrameHeaders(upstream.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding"); // we already decoded with .text()
  headers.set("X-Basira-Proxy", "1");

  return new Response(html, { status: upstream.status, headers });
}

function stripFrameHeaders(src) {
  const out = new Headers(src);
  out.delete("x-frame-options");
  out.delete("X-Frame-Options");
  out.delete("content-security-policy");
  out.delete("Content-Security-Policy");
  out.delete("content-security-policy-report-only");
  out.delete("cross-origin-opener-policy");
  out.delete("cross-origin-embedder-policy");
  out.delete("cross-origin-resource-policy");
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
