// ── Iframe proxy ─────────────────────────────────────────────
//
// In the original Next.js project, the visual selection happened
// inside a real Chromium window opened by Playwright on the user's
// own machine. On Cloudflare we cannot pop a window on the user's
// screen (there is no display), so we fetch the page on the edge,
// rewrite a few things, and serve it back so it can render in an
// iframe inside `scraper.html`.
//
// Specifically we:
//
//   1. fetch the target URL with a real-browser User-Agent
//   2. drop X-Frame-Options and frame-blocking CSP so the page
//      can actually live in an iframe on our domain
//   3. inject `<base href="...">` so relative links/css/img URLs
//      keep resolving to the target site
//   4. inject the overlay script just before </body> so the user
//      gets the same point-and-click selection panel they had locally

import { overlayScript } from "./overlay-injector-string.js";
import { withCors, errorResponse } from "./cors.js";

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
    return errorResponse("Failed to fetch target: " + e.message, env, 502);
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    // not HTML — just stream through
    return new Response(upstream.body, {
      status: upstream.status,
      headers: stripFrameHeaders(upstream.headers),
    });
  }

  let html = await upstream.text();

  // ── inject <base href> so relative URLs still resolve ────
  // Drop any existing <base> first.
  html = html.replace(/<base\b[^>]*>/gi, "");
  const baseTag = `<base href="${escapeAttr(targetUrl.toString())}">`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + baseTag);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => m + "<head>" + baseTag + "</head>");
  } else {
    html = baseTag + html;
  }

  // ── strip inline CSP <meta> tags ─────────────────────────
  // (some sites set CSP via <meta http-equiv> which still applies in iframes)
  html = html.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    "",
  );
  html = html.replace(
    /<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi,
    "",
  );

  // ── inject overlay script before </body> ────────────────
  const injection = `<script>${overlayScript}</script>`;
  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, injection + "</body>");
  } else {
    html = html + injection;
  }

  // ── send rewritten HTML, headers stripped ───────────────
  const headers = stripFrameHeaders(upstream.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding"); // we already decoded with .text()
  // Allow our Pages site to embed us
  headers.set("X-Basira-Proxy", "1");

  return new Response(html, { status: upstream.status, headers });
}

// strip headers that would block iframe embedding
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
