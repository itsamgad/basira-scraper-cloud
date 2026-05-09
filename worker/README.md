# Basira Scraper — Worker

Cloudflare Worker backend. Replaces the local Next.js API routes
(`pages/api/scraper.js`, `pages/api/history.js`) and the local
Playwright install with **Cloudflare Browser Rendering** via
`@cloudflare/playwright`.

## Quick deploy

```bash
cd worker
npm install
# 1) once: create the KV namespace and copy the id into wrangler.toml
npx wrangler kv namespace create BASIRA_KV
# 2) login and deploy
npx wrangler login
npx wrangler deploy
```

After deploy, note the `*.workers.dev` URL Wrangler prints. Paste
it into `pages/assets/config.js` so the Pages frontend knows
where to send API calls.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET    | `/proxy?url=…`                          | Fetches a target site, strips frame-blocking headers, injects the visual-selection overlay so it renders inside the iframe on `scraper.html` |
| POST   | `/api/scrape`                           | Runs Playwright (Browser Rendering) with the user's selection and returns the extracted data |
| GET    | `/api/history?action=list`              | Lists past scrape jobs from KV |
| POST   | `/api/history?action=add`               | Adds a history entry |
| DELETE | `/api/history?action=delete&id=…`       | Removes one entry |
| DELETE | `/api/history?action=clear`             | Clears all history |
| GET    | `/api/results?action=get&jobId=…`       | Returns the data from a past job |

## Pattern used for `@cloudflare/playwright`

```js
import { launch } from "@cloudflare/playwright";

const browser = await launch(env.MYBROWSER);
const page    = await browser.newPage();
```

The package also exports a `chromium` namespace for compatibility
with upstream Playwright code, so the user-spec form

```js
import { chromium } from "@cloudflare/playwright";
const browser = await chromium.launch(env.MYBROWSER);
```

is equivalent. We use the documented `launch()` form because it
matches the official Cloudflare docs verbatim and is guaranteed
to keep working across versions.
