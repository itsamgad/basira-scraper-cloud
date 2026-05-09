# Basira Scraper — Cloud Edition (v2)

> **GitHub → Cloudflare Pages.** One project, one deploy, one domain.
> No separate Worker. No URL configuration. No CORS setup.

This version moves the entire backend (the Playwright scraper, the
proxy that injects the overlay, history, and per-job results) into
**Cloudflare Pages Functions** — code that ships alongside the static
frontend and runs on the same domain. The frontend just calls
`/api/scrape` and `/proxy?url=…` like any normal web app.

```
basira-scraper-cloud/
├── wrangler.toml                ← Pages config + bindings
├── README.md
├── basira-button/               ← drop-in for your local app
└── pages/
    ├── package.json             ← @cloudflare/playwright dep
    ├── _headers
    ├── basira-logo.png
    ├── index.html               ← single-page flow: home → modal → results
    ├── scraper.html
    ├── view.html
    ├── assets/
    │   ├── app.js               ← uses relative paths (/api/…, /proxy?…)
    │   ├── styles.css
    │   ├── i18n.js
    │   ├── scraper-page.js
    │   └── view-page.js
    └── functions/               ← backend code (Pages auto-routes by path)
        ├── proxy.js             → /proxy
        ├── api/
        │   ├── scrape.js        → /api/scrape
        │   ├── history.js       → /api/history
        │   └── results.js       → /api/results
        └── _lib/                ← helpers (underscore = not routed)
            ├── cors.js
            ├── overlay-injector-string.js
            ├── results-helpers.js
            └── history-helpers.js
```

---

## Why this is better than the v1 (separate Worker) layout

| | v1 (Worker + Pages) | v2 (Pages Functions) |
|---|---|---|
| Deployments | 2 (Worker + Pages) | **1** (Pages) |
| Domains | 2 (`workers.dev` + `pages.dev`) | **1** (`pages.dev`) |
| URL config in code | required (`config.js`) | **none — relative paths** |
| CORS setup | required | **none — same origin** |
| Bindings | declared in 2 places | declared in **1** place |
| Browser popup blocker risk | possible (new tab) | **none** (in-page modal) |

---

## Deployment guide

### 0. Prerequisites

- A Cloudflare account (free tier works).
- A GitHub account.
- **Browser Rendering** enabled in your Cloudflare dashboard:
  Compute → Browser Run → enable.

### 1. Create the KV namespace (one-time)

In the Cloudflare dashboard:

1. **Storage & Databases → KV → Create a namespace.**
2. Name: `BASIRA_KV`
3. Copy the namespace **id** that's returned.
4. Open `wrangler.toml` (in this repo) and paste the id:
   ```toml
   [[kv_namespaces]]
   binding = "BASIRA_KV"
   id = "<paste-it-here>"
   ```

### 2. Push to GitHub

```bash
git add .
git commit -m "Basira Scraper v2 — Pages Functions"
git push
```

### 3. Connect to Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git.**
2. Pick this repo.
3. Build settings:
   - **Framework preset**: None
   - **Build command**: *(leave empty)*
   - **Build output directory**: `pages`
   - **Root directory**: *(leave empty — repo root)*
4. **Save and Deploy.**

Pages will:
- Read `wrangler.toml` for compatibility flags and bindings.
- Run `npm install` inside `pages/` because of the `package.json`.
- Detect `pages/functions/` and route them automatically.
- Serve `pages/` as the static site.

### 4. Verify the bindings (one-time, in dashboard)

After the first deploy, go to your Pages project:

**Settings → Functions → Bindings.** You should see:

- ✅ `MYBROWSER` (Browser Rendering)
- ✅ `BASIRA_KV` (KV namespace)

If either is missing, add it manually with the same name (the
`wrangler.toml` should populate them automatically, but the dashboard
overrides everything and is the source of truth).

### 5. Done

Open the URL Pages gives you (`https://basira-scraper.pages.dev` or
similar). Paste a URL. Click Start. The full flow works in **one
browser tab**, no popups, no manual config.

---

## Testing checklist

After your first deploy:

1. Open `https://<your-project>.pages.dev`
2. Paste `https://books.toscrape.com/`
3. Click Start
4. **Expected:** an in-page modal pops up with the books site loaded
   inside, sidebar overlay on the right.
5. Click a book card → SHIFT+Click on title, price, image
6. Pick Auto-scroll → press Extract
7. Modal closes → "Page 1 · 5 items collected" → results table
8. Try `View` on the history entry — past results page should load
9. Try the Basira button (`basira-button/basira-scraping-button.html`)
   pointing at this Pages URL — it should pre-fill and auto-start.

---

## How it differs from the original local app

The original opened a **visible Chromium window** on the user's
machine with Playwright (`headless: false, --start-maximized`).
Cloudflare Browser Rendering is headless-only — there is no display
on the server side. The closest equivalent on Cloudflare is:

- The frontend pops up an in-page modal containing an iframe.
- The iframe loads `/proxy?url=…`, which is a Pages Function that
  fetches the target site server-side, strips `X-Frame-Options`/CSP,
  rewrites common JS frame-busting patterns, and injects the same
  sidebar overlay the original local app used.
- The user clicks elements inside the iframe just like before.
- The overlay sends the selection back to the parent page via
  `postMessage`.
- The parent calls `/api/scrape` (Pages Function), which runs the
  *real* scrape on Browser Rendering and returns the results.

Auto-scroll, pagination, load-more, stealth UA rotation, retry logic,
star-rating extraction, CSV/JSON export, history — all ported from
the original.

---

## Cost

Cloudflare's free tier covers a generous amount of this. Browser
Rendering and KV both have free quotas. Pages Functions count against
the Workers free tier (100k requests/day on the free plan).

---

## Troubleshooting

**The modal opens but the page inside is blank.** The site has very
strict framing detection. After 7 seconds the modal shows a "Switch
to manual mode" button — click it and paste CSS selectors directly.

**Scrape fails with "MYBROWSER is not defined".** Browser Rendering
isn't bound to the Pages project. Go to **Settings → Functions →
Bindings → Add → Browser Rendering**, name it `MYBROWSER`.

**Scrape fails with KV errors.** The KV id in `wrangler.toml` doesn't
match a real namespace, or the binding `BASIRA_KV` isn't attached in
the Pages dashboard. Check both.

**The page stays on the home screen after Start.** Open DevTools →
Network. The `POST /api/scrape` request should return 200. If you
see 404, Functions aren't being detected — make sure your build
output directory is `pages` and the functions live under
`pages/functions/`.
