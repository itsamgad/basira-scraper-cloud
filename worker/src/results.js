// ── Result storage ──────────────────────────────────────────
//
// In the original project, scraped data was written to disk as
// `scrape-data/<jobId>.json`. Workers don't have a filesystem,
// so we store each job's result in KV under "result:<jobId>".
//
// KV values are capped at 25 MB which is plenty for typical
// scrapes (10k rows × 10 fields ≈ a few MB of JSON).
//
// Route mounted on /api/results:
//
//   GET ?action=get&jobId=<id>     → { success, fields, data }

import { jsonResponse, errorResponse } from "./cors.js";

export async function saveResult(env, jobId, payload) {
  if (!jobId) return;
  // payload: { fields, data }
  await env.BASIRA_KV.put("result:" + jobId, JSON.stringify(payload), {
    // KV TTL not strictly needed here; default keeps results forever
    // until the user deletes the matching history entry.
  });
}

export async function getResult(env, jobId) {
  if (!jobId) return null;
  const raw = await env.BASIRA_KV.get("result:" + jobId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

export async function handleResults(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "get" && request.method === "GET") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return errorResponse("Missing jobId", env, 400);
    const result = await getResult(env, jobId);
    if (!result) return errorResponse("Data not found", env, 404);
    return jsonResponse({
      success: true,
      fields: result.fields || [],
      data:   result.data   || [],
    }, env);
  }

  return errorResponse("Invalid action", env, 400);
}
