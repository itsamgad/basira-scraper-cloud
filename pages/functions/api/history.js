// Pages Function — handles /api/history with action= query param
// (mirrors the original Worker history.js).

import { jsonResponse, errorResponse, preflightResponse } from "../_lib/cors.js";
import { readHistory, writeHistory, addHistoryEntry } from "../_lib/history-helpers.js";

export async function onRequestOptions() { return preflightResponse(); }

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const action = url.searchParams.get("action");
  if (action !== "list") return errorResponse("Invalid action", 400);
  const history = await readHistory(context.env);
  return jsonResponse({ success: true, history });
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  const action = url.searchParams.get("action");
  if (action !== "add") return errorResponse("Invalid action", 400);

  const body = await context.request.json();
  if (!body || !body.jobId) return errorResponse("Missing jobId", 400);

  const entry = await addHistoryEntry(context.env, {
    id:            body.jobId,
    url:           body.url,
    rows:          body.rows,
    failedItems:   body.failedItems,
    fields:        body.fields,
    loadingMethod: body.loadingMethod,
    duration:      body.duration,
  });
  return jsonResponse({ success: true, entry });
}

export async function onRequestDelete(context) {
  const url = new URL(context.request.url);
  const action = url.searchParams.get("action");

  if (action === "delete") {
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("Missing id", 400);
    const history = (await readHistory(context.env)).filter((e) => e.id !== id);
    await writeHistory(context.env, history);
    try { await context.env.BASIRA_KV.delete("result:" + id); } catch (_) {}
    return jsonResponse({ success: true });
  }

  if (action === "clear") {
    const history = await readHistory(context.env);
    for (const e of history) {
      try { await context.env.BASIRA_KV.delete("result:" + e.id); } catch (_) {}
    }
    await writeHistory(context.env, []);
    return jsonResponse({ success: true });
  }

  return errorResponse("Invalid action", 400);
}
