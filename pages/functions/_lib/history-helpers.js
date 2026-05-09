// KV-backed history (data layer only — no HTTP).

const HISTORY_KEY = "history";
const HISTORY_CAP = 50;

export async function readHistory(env) {
  try {
    const raw = await env.BASIRA_KV.get(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

export async function writeHistory(env, history) {
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
