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
  // payload: { url, fields, data }
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

// ── live progress (matches the original /api/scraper?action=get-progress) ──
// During a scrape run, scrape.js writes to "progress:<jobId>" every few
// items; the frontend polls /api/results?action=progress&jobId=… while
// loading, so the user sees real-time counts instead of just a spinner.
export async function saveProgress(env, jobId, progress) {
  if (!jobId) return;
  try {
    await env.BASIRA_KV.put("progress:" + jobId, JSON.stringify({
      ...progress,
      ts: Date.now(),
    }), { expirationTtl: 600 }); // auto-expire after 10 minutes
  } catch (_) { /* progress is best-effort */ }
}

export async function getProgress(env, jobId) {
  if (!jobId) return null;
  const raw = await env.BASIRA_KV.get("progress:" + jobId);
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
    // Wrap in `result` so view-page.js can read json.result.{url,fields,data}.
    return jsonResponse({
      success: true,
      result: {
        url:    result.url    || "",
        fields: result.fields || [],
        data:   result.data   || [],
      },
    }, env);
  }

  if (action === "progress" && request.method === "GET") {
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return errorResponse("Missing jobId", env, 400);
    const progress = await getProgress(env, jobId);
    return jsonResponse({ success: true, progress: progress || null }, env);
  }

  return errorResponse("Invalid action", env, 400);
}
