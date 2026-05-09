// Pages Function — handles /api/results
//   GET ?action=get&jobId=<id>      → saved scrape result
//   GET ?action=progress&jobId=<id> → live progress while a scrape runs

import { jsonResponse, errorResponse, preflightResponse } from "../_lib/cors.js";
import { getResult, getProgress } from "../_lib/results-helpers.js";

export async function onRequestOptions() { return preflightResponse(); }

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const action = url.searchParams.get("action");
  const jobId  = url.searchParams.get("jobId");

  if (action === "get") {
    if (!jobId) return errorResponse("Missing jobId", 400);
    const result = await getResult(context.env, jobId);
    if (!result) return errorResponse("Data not found", 404);
    return jsonResponse({
      success: true,
      result: {
        url:    result.url    || "",
        fields: result.fields || [],
        data:   result.data   || [],
      },
    });
  }

  if (action === "progress") {
    if (!jobId) return errorResponse("Missing jobId", 400);
    const progress = await getProgress(context.env, jobId);
    return jsonResponse({ success: true, progress: progress || null });
  }

  return errorResponse("Invalid action", 400);
}
