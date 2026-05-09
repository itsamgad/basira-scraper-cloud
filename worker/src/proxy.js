// Worker proxy handler — server-to-server fetch, framing-strip,
// JS rewrite, overlay injection. Same logic as before, just exported
// as a function the router calls.

import { overlayScript } from "./overlay-injector-string.js";
import { errorResponse } from "./cors.js";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function handleProxy(request, env) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url");
  if (!target) return errorResponse("Missing ?url= parameter", env, 400);

  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (!/^https?:$/.test(targetUrl.protocol))
      throw new Error("Only http/https URLs are allowed");
  } catch (e) {
    return errorResponse("Invalid URL: " + e.message, env, 400);
  }

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
    return errorResponse("Failed to fetch target: " + e.message, env, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: stripFrameHeaders(upstream.headers),
    });
  }

  let html = await upstream.text();

  // strip inline CSP/X-Frame meta tags
  html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "");

  // neutralise common JS frame-busting patterns (belt-and-braces)
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

  // base + prelude (so frameElement reads as null before page scripts run)
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

  // runtime context for the overlay
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

  const injection = ctx + `<script>${overlayScript}</script>`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, injection + "</body>");
  } else {
    html = html + injection;
  }

  const headers = stripFrameHeaders(upstream.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("X-Basira-Proxy", "1");

  return new Response(html, { status: upstream.status, headers });
}

function stripFrameHeaders(src) {
  const out = new Headers(src);
  for (const k of [
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ]) {
    out.delete(k);
  }
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
