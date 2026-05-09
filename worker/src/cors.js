// CORS helper — every JSON response from the Worker goes through
// `withCors`, every preflight goes through `handlePreflight`.
//
// We allow the wildcard origin by default (configurable via the
// ALLOWED_ORIGIN var in wrangler.toml) so the static Pages site
// can call this Worker directly from the browser, on whatever
// pages.dev / custom-domain it ends up on.

export function corsHeaders(env) {
  const origin = (env && env.ALLOWED_ORIGIN) || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function handlePreflight(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export function withCors(response, env) {
  const h = corsHeaders(env);
  for (const [k, v] of Object.entries(h)) response.headers.set(k, v);
  return response;
}

export function jsonResponse(data, env, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    env,
  );
}

export function errorResponse(message, env, status = 500) {
  return jsonResponse({ error: String(message) }, env, status);
}
