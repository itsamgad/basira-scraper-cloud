# Basira Scraper — Cloud Edition (v2.1)

> **Same domain. No URL paste. No CORS.**
> Pages handles the frontend. A Worker handles Browser Rendering.
> They talk via **Service Binding** — internal, no URL configuration.

```
┌────────────────────┐     fetch('/api/scrape')     ┌──────────────────────┐
│   Browser          │ ───────────────────────────► │  Pages Function      │
│  basira.pages.dev  │      (same origin)           │  (forwarder, 1 line) │
└────────────────────┘                              └──────────┬───────────┘
                                                               │ env.BACKEND.fetch()
                                                               │ (Service Binding,
                                                               │  internal RPC,
                                                               │  no URL, no CORS)
                                                               ▼
                                                    ┌──────────────────────┐
                                                    │   Worker             │
                                                    │   *.workers.dev      │
                                                    │  ┌────────────────┐  │
                                                    │  │ Browser        │  │
                                                    │  │ Rendering      │  │
                                                    │  └────────────────┘  │
                                                    └──────────────────────┘
```

## Why this layout

Pages Functions cannot bind to **Browser Rendering** — only Workers can.
But Pages Functions *can* bind to a Worker via Service Binding. So:

- The **Worker** holds Browser Rendering. It does the scraping.
- The **Pages site** holds the frontend, plus tiny Pages Functions
  that forward requests to the Worker via Service Binding.
- The frontend uses **relative paths** (`/api/scrape`, `/proxy?...`).
- Cloudflare routes those internally — never crosses CORS, never
  needs a hardcoded Worker URL anywhere.

## Folder layout

```
basira-scraper-cloud/
├── README.md                  ← this file
├── basira-button/             ← drop-in for your local app
└── pages/
    ├── _headers
    ├── basira-logo.png
    ├── package.json           ← no deps; Pages serves files as-is
    ├── index.html             ← single-page flow: home → modal → results
    ├── scraper.html
    ├── view.html
    ├── assets/
    │   ├── app.js             ← uses /api/… and /proxy?… (no URL config)
    │   ├── styles.css
    │   ├── i18n.js
    │   ├── scraper-page.js
    │   └── view-page.js
    └── functions/             ← Pages Functions (auto-routed)
        ├── proxy.js                ← /proxy → BACKEND.fetch()
        └── api/[[path]].js         ← /api/* → BACKEND.fetch()
└── worker/
    ├── package.json           ← @cloudflare/playwright
    ├── wrangler.toml          ← [browser] binding lives here
    └── src/
        ├── index.js           ← router
        ├── proxy.js           ← reverse-proxy + overlay injection
        ├── scrape.js          ← Playwright on Browser Rendering
        ├── history.js
        ├── results.js
        ├── cors.js
        ├── _history-helpers.js
        ├── _results-helpers.js
        └── overlay-injector-string.js
```

---

## Deployment guide

### 0. Prerequisites

- A Cloudflare account (free tier works).
- A GitHub account.
- **Browser Run** enabled in your Cloudflare dashboard
  (Compute → Browser Run → Enable). One-time per account.

### 1. Push the code to GitHub

In GitHub Desktop: replace the contents of your repo with this folder
(the four entries: `README.md`, `basira-button/`, `pages/`, `worker/`).
Commit + Push.

### 2. Create the KV namespace (one-time)

Cloudflare Dashboard → Storage & Databases → KV → **Create**.

- Name: `BASIRA_KV`
- Copy the returned **id**.

Open `worker/wrangler.toml` on GitHub, replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`
with that id, commit.

> If you already had `BASIRA_KV` for the previous worker, reuse the
> same id — your history won't be lost.

### 3. Deploy the Worker

Cloudflare Dashboard → Workers & Pages → **Create** → Workers tab →
**Import a repository**.

- Repo: your `basira-scraper-cloud` repo
- **Root directory**: `worker`   ← important
- **Build command**: empty
- **Deploy command**: `npx wrangler deploy`

Click Save and Deploy. The Worker URL will look like:
`https://basira-scraper-worker.<your-account>.workers.dev`

Verify in **Settings → Bindings**:
- ✅ `MYBROWSER` (Browser Rendering)  ← added automatically by wrangler.toml
- ✅ `BASIRA_KV` (KV namespace)

### 4. Deploy the Pages site

Cloudflare Dashboard → Workers & Pages → **Create** → Pages tab →
**Connect to Git**.

- Same repo
- **Build output directory**: `pages`
- **Build command**: empty
- **Framework preset**: None

Click Save and Deploy. Pages URL: `https://basira-scraper.pages.dev`.

### 5. Connect Pages → Worker via Service Binding ⭐

This is the step that eliminates the URL config:

1. Open the Pages project → **Settings → Functions → Bindings**.
2. Click **Add → Service binding**.
3. **Variable name**: `BACKEND`   ← exact name, case-sensitive
4. **Service**: select `basira-scraper-worker`.
5. **Save**.

Trigger a redeploy (Deployments → latest → **Retry**).

### 6. Done — test it

Open the Pages URL. Paste `https://books.toscrape.com/`. Click Start.

- An in-page modal pops up with the books site loaded inside.
- Sidebar overlay floats on the right.
- Click a book card → SHIFT+click on title/price/image.
- Pick auto-scroll → press Extract.
- Results appear in a table.

If anything goes wrong, the most common failure is the Service
Binding not being attached. The forwarder Functions return a clear
error message in that case.

---

## The flow at runtime

```
Browser:  fetch('/api/scrape', {body:...})
           ↓
Pages Function api/[[path]].js  →  env.BACKEND.fetch(request)
           ↓ (internal Cloudflare RPC, no DNS, no TLS, no CORS)
Worker /api/scrape  →  launch(env.MYBROWSER)  →  Playwright on Browser Rendering
           ↑
Browser:  receives JSON response
```

The frontend *never* knows the Worker's URL. Service Binding is an
in-memory reference — Cloudflare wires it up when both deployments
exist.

---

## Why not put everything in the Worker?

We could — Workers can serve static assets too. But Pages gives us:

- Automatic git-driven deploys
- Preview deployments per branch / PR
- A real CDN with `_headers` and `_redirects` files
- Faster startup for static files

So splitting frontend (Pages) from backend (Worker) is genuinely
better for this app. Service Bindings let us split without paying
the usual cost (CORS, URL config).

---

## Cost

Free tier covers a generous amount of all four services:
- Pages: unlimited static requests
- Pages Functions: 100k requests/day
- Workers: 100k requests/day
- Browser Rendering: 10 minutes/day on the free Workers plan
- KV: 100k reads/day, 1k writes/day

The Service Binding call between Pages Function and Worker counts as
one request to each. So a single user-triggered scrape uses one Pages
Function request and one Worker request.

---

## Troubleshooting

**`Service binding 'BACKEND' is not configured`** — step 5 above
wasn't done. Add the binding and redeploy Pages.

**`MYBROWSER is not defined`** in Worker logs — Browser Rendering
isn't enabled, or the binding wasn't applied. Check your Worker's
**Settings → Bindings**.

**Modal opens but the page is blank** — the target site has very
strict framing detection. After 7 seconds the modal shows a "Switch
to manual mode" button. Use it.

**`KV namespace not found`** — the id in `worker/wrangler.toml`
doesn't match a real namespace. Re-read step 2.
