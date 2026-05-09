# Basira Scraper — Cloud Edition

> **GitHub → Cloudflare** only. No `npm install`, no `npm run`, no
> `server.js`, no Electron, no local Playwright. Push to GitHub, deploy
> to Cloudflare, done.

This is a full conversion of the original local Basira Scraper into:

- **Cloudflare Pages** — the entire UI (landing, scraper, view) as
  static HTML + ES modules. No build step.
- **Cloudflare Worker** — the backend that runs Playwright through
  **Cloudflare Browser Rendering** (the `MYBROWSER` binding).
- **Cloudflare KV** — replaces the local filesystem for scrape history
  and saved job results.
- **A drop-in HTML button** for the local Basira app that opens the
  cloud UI in a new tab — your existing local app keeps working,
  scraping just moves to the cloud.

---

## Folder layout

```
basira-scraper-cloud/
├── pages/                 # ← Cloudflare Pages project
│   ├── index.html
│   ├── scraper.html
│   ├── view.html
│   ├── basira-logo.png
│   ├── _headers
│   ├── package.json
│   └── assets/
│       ├── styles.css
│       ├── i18n.js
│       ├── config.js          ← put your Worker URL here
│       ├── app.js
│       ├── scraper-page.js
│       └── view-page.js
│
├── worker/                # ← Cloudflare Worker project
│   ├── wrangler.toml          ← Browser binding + KV
│   ├── package.json
│   ├── README.md
│   └── src/
│       ├── index.js           ← router
│       ├── scrape.js          ← Playwright on Browser Rendering
│       ├── proxy.js           ← /proxy?url=… for the visual selector
│       ├── overlay-injector-string.js
│       ├── history.js         ← KV-backed history
│       ├── results.js         ← KV-backed result store
│       └── cors.js
│
└── basira-button/         # ← drop-in for your local app
    ├── basira-scraping-button.html
    └── README.md
```

These are **two separate Cloudflare deployments** (Pages and Worker),
both deployed from the same GitHub repo.

---

## Architecture in one picture

```
   ┌────────────────────┐    click "Web Scraping"    ┌──────────────────────┐
   │  Local Basira app  │ ─────────────────────────► │  Cloudflare Pages    │
   │  (unchanged)       │                            │  (static UI)         │
   └────────────────────┘                            └──────────┬───────────┘
                                                                │ fetch()
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │  Cloudflare Worker   │
                                                     │  /proxy   /api/*     │
                                                     └──────────┬───────────┘
                                                                │ launch(env.MYBROWSER)
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │  Browser Rendering   │
                                                     │  (real Chromium)     │
                                                     └──────────────────────┘

                                                     ┌──────────────────────┐
                                                     │  Cloudflare KV       │
                                                     │  history + results   │
                                                     └──────────────────────┘
```

**Zero local execution.** The local Basira app contains *only* a button
that opens a URL.

---

## Deployment guide

You'll do this once. After that, every `git push` redeploys both Pages
and the Worker automatically.

### 0. Prerequisites

- A Cloudflare account (free tier works).
- A GitHub account.
- **Browser Rendering** enabled in your Cloudflare dashboard: go to
  **Workers & Pages → Browser Rendering** and click *Enable*.

### 1. Push this folder to GitHub

```bash
cd basira-scraper-cloud
git init
git add .
git commit -m "Basira Scraper — cloud edition"
git branch -M main
git remote add origin https://github.com/<you>/basira-scraper-cloud.git
git push -u origin main
```

### 2. Deploy the Worker

The Worker has to come first because Pages needs to know its URL.

The Worker uses **`@cloudflare/playwright`** with the `MYBROWSER`
binding (declared in `worker/wrangler.toml`):

```toml
[browser]
binding = "MYBROWSER"
```

Inside `worker/src/scrape.js` it's used exactly as the spec asks:

```js
import { launch } from "@cloudflare/playwright";
const browser = await launch(env.MYBROWSER);
// (chromium.launch(env.MYBROWSER) also works in newer @cloudflare/playwright)
```

Two ways to deploy. Pick **one**.

#### Option A — Connect GitHub from the Cloudflare dashboard *(no CLI)*

1. **Workers & Pages → Create → Workers → Import a repository.**
2. Pick your `basira-scraper-cloud` repo.
3. Set the **root directory** to `worker`.
4. Build command: *(empty)*. Deploy command: `npx wrangler deploy`.
5. Click **Save and Deploy**.
6. Before the first deploy succeeds you'll need a KV namespace —
   either create one from the dashboard (**Workers & Pages → KV →
   Create**) or run step *KV setup* below from your machine once.
   Paste the namespace **id** into `worker/wrangler.toml`:
   ```toml
   [[kv_namespaces]]
   binding = "BASIRA_KV"
   id = "<the-id-cloudflare-gave-you>"
   ```
7. Push the change. The Worker redeploys automatically on every push.

The Worker URL will look like:
```
https://basira-scraper-worker.<your-subdomain>.workers.dev
```

Save this URL — you need it in step 3.

#### Option B — One-time CLI deploy

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create BASIRA_KV
# paste the returned id into wrangler.toml under [[kv_namespaces]]
npx wrangler deploy
```

The output prints the same `*.workers.dev` URL.

### 3. Point the frontend at the Worker

Edit one file: `pages/assets/config.js`

```js
export const WORKER_URL = "https://basira-scraper-worker.<your-subdomain>.workers.dev";
```

Commit and push:

```bash
git add pages/assets/config.js
git commit -m "wire frontend to worker"
git push
```

### 4. Deploy Pages

1. **Workers & Pages → Create → Pages → Connect to Git.**
2. Pick the same repo.
3. Set the **root directory** to `pages`.
4. Framework preset: **None**. Build command: *(empty)*. Build output
   directory: *(empty — leave blank)*. Pages will serve `pages/`
   directly because it's already static.
5. Click **Save and Deploy**.

Pages gives you a URL like:
```
https://basira-scraper.pages.dev
```

### 5. Lock down CORS *(optional but recommended)*

In `worker/wrangler.toml`, change:

```toml
ALLOWED_ORIGIN = "*"
```
to:
```toml
ALLOWED_ORIGIN = "https://basira-scraper.pages.dev"
```

Push. The Worker redeploys. Now only your Pages site can call the
Worker.

### 6. Wire up the local Basira button

Open `basira-button/basira-scraping-button.html`, set:

```js
const BASIRA_PAGES_URL = "https://basira-scraper.pages.dev";
```

Paste the whole snippet into your local Basira app. Done.

---

## How it differs from the original local app

The original opened a **visible Chromium window** on the user's
machine, let them click items live, and read the selection back from
`window.basiraResults`. Cloudflare Browser Rendering is **headless
only** — no visible window — so the visual selector had to be
re-implemented:

- **Visual mode (default)**: The Worker has a `/proxy?url=…` endpoint
  that fetches the target page, strips `X-Frame-Options` / `CSP`,
  injects a `<base href>`, and injects the same overlay UI from the
  original. The Pages app loads that proxied page inside an `<iframe>`.
  The overlay sends the user's selection back via
  `window.parent.postMessage`. The Pages app then POSTs to
  `/api/scrape`, which runs the **real** scrape on Browser Rendering.
- **Manual mode (fallback)**: For sites with very strict framing, the
  user pastes CSS selectors directly. Always works.

Everything else — auto-scroll, pagination, load-more, stealth UA
rotation, star-rating extraction, CSV/JSON export, history — is ported
1:1 from the original.

---

## API surface (the Worker)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/`                    | Worker info |
| `GET`  | `/health`              | Health check |
| `GET`  | `/proxy?url=…`         | Reverse-proxy the target site + inject overlay (for the visual selector iframe) |
| `POST` | `/api/scrape`          | Run the actual scrape on Browser Rendering, store result in KV, return data |
| `GET`  | `/api/history`         | List recent scrapes (KV-backed) |
| `POST` | `/api/history`         | Add an entry |
| `DELETE` | `/api/history`       | Clear history |
| `GET`  | `/api/results?action=get&jobId=…` | Fetch a saved job |

Full schemas are documented in `worker/README.md`.

---

## Costs

Cloudflare's free tier handles a generous amount of this. Browser
Rendering and KV both have free quotas; check the dashboard for
current limits. The Worker itself is on the free Workers plan unless
you opt into the paid plan.

---

## Troubleshooting

- **Pages loads but nothing happens when I click "Start"** — check the
  browser console; almost always it's the wrong `WORKER_URL` in
  `pages/assets/config.js`, or CORS is blocking it. Set
  `ALLOWED_ORIGIN` in `wrangler.toml` to your Pages URL (or `*` while
  testing).
- **The visual selector iframe is blank** — the target site refuses to
  be framed even after the proxy strips headers (some sites detect
  this with JS). Switch to **Manual mode** and paste CSS selectors.
- **Scrape fails with `MYBROWSER is not defined`** — Browser Rendering
  isn't enabled for your account yet. Cloudflare dashboard → Workers
  & Pages → Browser Rendering → Enable.
- **`KV namespace not found`** — you forgot to paste the real
  namespace id into `worker/wrangler.toml` after running `wrangler kv
  namespace create BASIRA_KV`.
