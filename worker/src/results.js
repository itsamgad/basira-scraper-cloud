import { jsonResponse, errorResponse, preflightResponse } from "./cors.js";
import { getResult, getProgress } from "./_results-helpers.js";

export async function handleResults(request, env) {
  if (request.method === "OPTIONS") return preflightResponse(env);
  if (request.method !== "GET") return errorResponse("Method not allowed", env, 405);

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const jobId  = url.searchParams.get("jobId");

  if (action === "get") {
    if (!jobId) return errorResponse("Missing jobId", env, 400);
    const result = await getResult(env, jobId);
    if (!result) return errorResponse("Data not found", env, 404);
    return jsonResponse({
      success: true,
      result: {
        url:    result.url    || "",
        fields: result.fields || [],
        data:   result.data   || [],
      },
    }, env);
  }

  if (action === "progress") {
    if (!jobId) return errorResponse("Missing jobId", env, 400);
    const progress = await getProgress(env, jobId);
    return jsonResponse({ success: true, progress: progress || null }, env);
  }

  return errorResponse("Invalid action", env, 400);
}
