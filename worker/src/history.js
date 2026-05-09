// ── History endpoints ────────────────────────────────────────
//
// In the original project, history was stored in a JSON file
// `scrape-history.json` on the user's disk. Workers don't have a
// filesystem, so we use Cloudflare KV with the binding BASIRA_KV
// declared in wrangler.toml.
//
// Layout in KV:
//
//   key "history"  →  JSON array of entries (newest first, capped at 50)
//
// Routes mounted on /api/history:
//
//   GET    ?action=list                 → { success, history }
//   POST   ?action=add                  → adds a new entry
//   DELETE ?action=delete&id=<jobId>    → removes one
//   DELETE ?action=clear                → wipes them all

import { jsonResponse, errorResponse } from "./cors.js";

const HISTORY_KEY = "history";
const HISTORY_CAP = 50;

async function readHistory(env) {
  try {
    const raw = await env.BASIRA_KV.get(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function writeHistory(env, history) {
  await env.BASIRA_KV.put(HISTORY_KEY, JSON.stringify(history));
}

export async function addHistoryEntry(env, partial) {
  const entry = {
    id:        partial.id,
    url:       partial.url || "",
    hostname:  hostnameOf(partial.url),
    timestamp: new Date().toISOString(),
    rows:           partial.rows           || 0,
    failedItems:    partial.failedItems    || 0,
    fields:         partial.fields         || [],
    loadingMethod:  partial.loadingMethod  || "auto-scroll",
    duration:       partial.duration       || 0,
  };
  const history = await readHistory(env);
  history.unshift(entry);
  if (history.length > HISTORY_CAP) history.splice(HISTORY_CAP);
  await writeHistory(env, history);
  return entry;
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch (_) { return url || ""; }
}

export async function handleHistory(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "list" && request.method === "GET") {
      const history = await readHistory(env);
      return jsonResponse({ success: true, history }, env);
    }

    if (action === "add" && request.method === "POST") {
      const body = await request.json();
      if (!body || !body.jobId)
        return errorResponse("Missing jobId", env, 400);
      const entry = await addHistoryEntry(env, {
        id:            body.jobId,
        url:           body.url,
        rows:          body.rows,
        failedItems:   body.failedItems,
        fields:        body.fields,
        loadingMethod: body.loadingMethod,
        duration:      body.duration,
      });
      return jsonResponse({ success: true, entry }, env);
    }

    if (action === "delete" && request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return errorResponse("Missing id", env, 400);
      const history = (await readHistory(env)).filter((e) => e.id !== id);
      await writeHistory(env, history);
      // also drop the result blob
      try { await env.BASIRA_KV.delete("result:" + id); } catch (_) {}
      return jsonResponse({ success: true }, env);
    }

    if (action === "clear" && request.method === "DELETE") {
      const history = await readHistory(env);
      // best-effort delete each result blob
      for (const e of history) {
        try { await env.BASIRA_KV.delete("result:" + e.id); } catch (_) {}
      }
      await writeHistory(env, []);
      return jsonResponse({ success: true }, env);
    }

    return errorResponse("Invalid action", env, 400);
  } catch (e) {
    return errorResponse(e.message || "history error", env, 500);
  }
}
