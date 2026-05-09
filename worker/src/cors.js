// CORS helpers for the Worker. The Worker is called via Service
// Binding from the Pages frontend, so cross-origin headers don't
// strictly matter — but we leave them permissive for parity with
// direct testing (curl against the *.workers.dev URL).

function originHeader(env) {
  return (env && env.ALLOWED_ORIGIN) || "*";
}

export function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": originHeader(env),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
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

export function preflightResponse(env) {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}
