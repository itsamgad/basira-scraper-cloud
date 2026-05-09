# Basira "Web Scraping" Button

A drop-in HTML snippet you paste into your **local Basira app** so users
can click one button and jump straight into the cloud-hosted scraper
(Cloudflare Pages). The local app does *not* run any scraping itself —
it only opens the cloud page in a new tab.

---

## Files

| File | What it is |
|---|---|
| `basira-scraping-button.html` | The button + a tiny inline script that opens your Cloudflare Pages URL with the right query params. |

---

## How to use it

1. Open `basira-scraping-button.html`.
2. Replace **`BASIRA_PAGES_URL`** with your real Pages URL — for example:
   ```js
   const BASIRA_PAGES_URL = "https://basira-scraper.pages.dev";
   ```
3. Paste the whole snippet anywhere in your local Basira app (any HTML
   file, any framework — it's plain HTML + a tiny script).
4. Optional: change `BASIRA_DEFAULTS` to set the default language, theme,
   stealth mode, etc.

That's it. Clicking the button opens:

```
https://basira-scraper.pages.dev/?lang=ar&theme=dark&stealth=0
```

…in a new tab, where the user enters a URL and runs the scrape on
Cloudflare Browser Rendering — **nothing runs on your machine**.

---

## Pre-filling a URL programmatically

If your local app already has a URL in mind (e.g. the user clicked a
product link), you can bypass the home screen entirely:

```js
openBasiraScraping({
  url:       "https://amazon.sa/some-search-page",
  autostart: "1",        // skips the home screen, jumps to scraper
  rowLimit:  "100",      // optional cap
  stealth:   "1",        // optional stealth mode
});
```

The `openBasiraScraping` function is exposed globally by the script
included in the snippet.

---

## Available query params

| Param | Values | Effect |
|---|---|---|
| `lang` | `ar` \| `en` | UI language |
| `theme` | `dark` \| `light` | Theme |
| `stealth` | `0` \| `1` | Stealth mode toggle |
| `rowLimit` | number | Cap rows |
| `url` | URL | Pre-fill the URL input |
| `autostart` | `0` \| `1` | If `1` and `url` is set, skip home and go straight to the scraper |
| `mode` | `visual` \| `manual` | Which selection mode to start in (only used when `autostart=1`) |

The Pages app reads these via `URLSearchParams` and behaves accordingly.
