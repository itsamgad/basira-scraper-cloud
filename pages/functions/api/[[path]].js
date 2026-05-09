// Pages Function — forwards every /api/* path to the Worker via
// Service Binding (BACKEND). One file because [[path]] catches all
// nested paths under /api, so /api/scrape, /api/history, /api/results
// all flow through here.

export async function onRequest(context) {
  if (!context.env.BACKEND) {
    return new Response(
      JSON.stringify({
        error:
          "Service binding 'BACKEND' is not configured. Go to Pages project " +
          "→ Settings → Functions → Bindings → Add → Service binding, " +
          "name it BACKEND, and select your basira-scraper-worker.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return context.env.BACKEND.fetch(context.request);
}
