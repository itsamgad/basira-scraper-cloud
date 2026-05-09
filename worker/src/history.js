import { jsonResponse, errorResponse, preflightResponse } from "./cors.js";
import { readHistory, writeHistory, addHistoryEntry } from "./_history-helpers.js";

export async function handleHistory(request, env) {
  if (request.method === "OPTIONS") return preflightResponse(env);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (request.method === "GET") {
    if (action !== "list") return errorResponse("Invalid action", env, 400);
    const history = await readHistory(env);
    return jsonResponse({ success: true, history }, env);
  }

  if (request.method === "POST") {
    if (action !== "add") return errorResponse("Invalid action", env, 400);
    const body = await request.json();
    if (!body || !body.jobId) return errorResponse("Missing jobId", env, 400);
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

  if (request.method === "DELETE") {
    if (action === "delete") {
      const id = url.searchParams.get("id");
      if (!id) return errorResponse("Missing id", env, 400);
      const history = (await readHistory(env)).filter((e) => e.id !== id);
      await writeHistory(env, history);
      try { await env.BASIRA_KV.delete("result:" + id); } catch (_) {}
      return jsonResponse({ success: true }, env);
    }
    if (action === "clear") {
      const history = await readHistory(env);
      for (const e of history) {
        try { await env.BASIRA_KV.delete("result:" + e.id); } catch (_) {}
      }
      await writeHistory(env, []);
      return jsonResponse({ success: true }, env);
    }
    return errorResponse("Invalid action", env, 400);
  }

  return errorResponse("Method not allowed", env, 405);
}
