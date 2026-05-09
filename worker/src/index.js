// Basira Scraper Worker — entry point.
//
// Routes requests to the right handler. Receives requests two ways:
//   1) Direct HTTP — when called via the Worker's *.workers.dev URL
//      (useful for testing with curl).
//   2) Service Binding — when Pages forwards a request via
//      `env.BACKEND.fetch(request)`. Same API surface either way.

import { handleProxy }   from "./proxy.js";
import { handleScrape }  from "./scrape.js";
import { handleHistory } from "./history.js";
import { handleResults } from "./results.js";
import { preflightResponse, errorResponse, jsonResponse } from "./cors.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflightResponse(env);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "")          return jsonResponse({ name: "Basira Scraper Worker", ok: true }, env);
    if (path === "/health")                   return jsonResponse({ ok: true, ts: Date.now() }, env);
    if (path === "/proxy")                    return handleProxy(request, env);
    if (path === "/api/scrape")               return handleScrape(request, env);
    if (path === "/api/history")              return handleHistory(request, env);
    if (path === "/api/results")              return handleResults(request, env);

    return errorResponse("Not found", env, 404);
  },
};
