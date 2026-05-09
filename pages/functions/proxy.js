// Pages Function — forwards /proxy?... to the Worker via Service Binding.
//
// The user's iframe loads /proxy?url=… on the Pages domain (same origin
// as the rest of the app, so no CORS). Cloudflare routes the request
// here, and we hand it straight off to the Worker, which holds the
// Browser Rendering binding and does the actual work.
//
// `BACKEND` is the Service Binding name configured in:
//   Pages project → Settings → Functions → Bindings → Add → Service binding

export async function onRequest(context) {
  if (!context.env.BACKEND) {
    return new Response(
      JSON.stringify({
        error:
          "Service binding 'BACKEND' is not configured. Go to Pages project " +
          "→ Settings → Functions → Bindings → Add → Service binding, " +
          "and bind it to the basira-scraper-worker.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  return context.env.BACKEND.fetch(context.request);
}
