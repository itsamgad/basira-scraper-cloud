// KV-backed result + progress storage (data layer only — no HTTP).

export async function saveResult(env, jobId, payload) {
  if (!jobId) return;
  // payload: { url, fields, data }
  await env.BASIRA_KV.put("result:" + jobId, JSON.stringify(payload));
}

export async function getResult(env, jobId) {
  if (!jobId) return null;
  const raw = await env.BASIRA_KV.get("result:" + jobId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// ── live progress (matches the original /api/scraper?action=get-progress) ──
// During a scrape run, the scrape function writes to "progress:<jobId>"
// every few items; the frontend polls /api/results?action=progress&jobId=…
// while loading, so the user sees real-time counts instead of just a spinner.
export async function saveProgress(env, jobId, progress) {
  if (!jobId) return;
  try {
    await env.BASIRA_KV.put("progress:" + jobId, JSON.stringify({
      ...progress,
      ts: Date.now(),
    }), { expirationTtl: 600 }); // auto-expire after 10 minutes
  } catch (_) { /* best-effort */ }
}

export async function getProgress(env, jobId) {
  if (!jobId) return null;
  const raw = await env.BASIRA_KV.get("progress:" + jobId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
