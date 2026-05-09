// CORS helpers — kept for parity with the original Worker version,
// but mostly redundant now that frontend and backend share an origin
// (everything lives under the same Pages domain). Same-origin requests
// don't need CORS preflight at all. We still set a permissive
// Access-Control-Allow-Origin so external tools (curl, scripts) can
// poke at the API.

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export function withCors(response) {
  const h = corsHeaders();
  for (const [k, v] of Object.entries(h)) response.headers.set(k, v);
  return response;
}

export function jsonResponse(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  );
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: String(message) }, status);
}

export function preflightResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
