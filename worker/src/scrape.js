// ── Scrape handler ──────────────────────────────────────────
//
// This is the Cloudflare Browser Rendering port of the original
// `pages/api/scraper.js` from the Next.js project.
//
// The original kept a Map of long-lived browsers across requests
// (`activeBrowsers`) because Playwright was running on a server
// the user controlled.  Worker invocations are short-lived and
// stateless, so we collapse the entire flow into one request:
// the browser opens, navigates, scrapes, closes, all inside a
// single POST to /api/scrape.  The selection step happens earlier
// on the client, in the iframe, via the overlay panel — so by
// the time we get here we already have selectors.
//
// Pattern follows the @cloudflare/playwright docs:
//
//   import { launch } from "@cloudflare/playwright";
//   const browser = await launch(env.MYBROWSER);
//
// (For users who prefer the namespaced form requested in the
//  spec, `chromium.launch(env.MYBROWSER)` is also exported and
//  works identically — see the README.)

import { launch } from "@cloudflare/playwright";
import { jsonResponse, errorResponse } from "./cors.js";
import { saveResult } from "./results.js";
import { addHistoryEntry } from "./history.js";

// User-Agent pool used when stealth mode is enabled
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

export async function handleScrape(request, env, ctx) {
  if (request.method !== "POST")
    return errorResponse("Use POST", env, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return errorResponse("Invalid JSON body", env, 400); }

  const {
    url,
    jobId,
    selection,
    rowLimit,
    stealth = false,
    lang = "en",
  } = body || {};

  if (!url || !selection || !selection.parentSelector || !selection.itemSelector || !Array.isArray(selection.fields)) {
    return errorResponse("Missing required fields: url, selection.parentSelector, selection.itemSelector, selection.fields", env, 400);
  }

  const hardCap = parseInt(env.MAX_ROWS_HARD_CAP || "5000", 10);
  const requestedLimit = rowLimit && rowLimit > 0 ? Math.min(rowLimit, hardCap) : hardCap;

  const startTime = Date.now();
  let browser;

  try {
    // ── launch Browser Rendering ──────────────────────────
    browser = await launch(env.MYBROWSER);

    const contextOptions = {
      viewport: { width: 1366, height: 900 },
    };
    if (stealth) {
      contextOptions.userAgent = randomUA();
      contextOptions.locale    = "en-US";
      contextOptions.timezoneId = "America/New_York";
      contextOptions.extraHTTPHeaders = {
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      };
    }

    const context = await browser.newContext(contextOptions);

    if (stealth) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
        // @ts-ignore
        window.chrome = { runtime: {} };
      });
    }

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // give SPAs a beat to hydrate
    try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch (_) {}

    const {
      parentSelector,
      itemSelector,
      fields,
      loadingMethod = "auto-scroll",
      paginationSelector,
      loadMoreSelector,
    } = selection;

    let data = [];
    let validItemIndex = 0;
    let failedItems = 0;

    if (loadingMethod === "pagination" && paginationSelector) {
      const r = await paginationLoad(page, parentSelector, itemSelector, paginationSelector, fields, requestedLimit);
      data = r.allData;
      validItemIndex = r.totalLoaded;
      failedItems = r.failedItems;
    } else {
      if (loadingMethod === "auto-scroll") {
        await autoScroll(page, parentSelector, itemSelector, requestedLimit);
      } else if (loadingMethod === "load-more" && loadMoreSelector) {
        await loadMoreLoad(page, parentSelector, itemSelector, loadMoreSelector, requestedLimit);
      }

      const items = await page.$$(`${parentSelector} ${itemSelector}`);
      const limited = items.slice(0, requestedLimit);

      for (let i = 0; i < limited.length; i++) {
        const { rowData, hasData } = await extractItemWithRetry(limited[i], fields, page, 3);
        if (hasData) {
          for (const f of fields) {
            data.push({ item_index: validItemIndex, field_name: f.name, value: rowData[f.name] || "N/A" });
          }
          validItemIndex++;
        } else {
          failedItems++;
        }
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    // ── persist to KV (best-effort) ───────────────────────
    if (jobId) {
      try { await saveResult(env, jobId, { fields, data }); } catch (e) { console.warn("saveResult:", e.message); }
      try {
        await addHistoryEntry(env, {
          id: jobId,
          url,
          rows: validItemIndex,
          failedItems,
          fields,
          loadingMethod,
          duration,
        });
      } catch (e) { console.warn("addHistoryEntry:", e.message); }
    }

    await browser.close();
    browser = null;

    return jsonResponse({
      success: true,
      jobId,
      itemsScraped: validItemIndex,
      failedItems,
      fields,
      data,
      duration,
    }, env);
  } catch (error) {
    console.error("Scrape error:", error);
    if (browser) { try { await browser.close(); } catch (_) {} }
    return errorResponse(error.message || "Scrape failed", env, 500);
  }
}

// ── Helpers ports of the originals ────────────────────────────

async function extractFieldValue(element, field, pageUrl) {
  if (field.type === "image") {
    const src =
      (await element.getAttribute("src")) ||
      (await element.getAttribute("data-src")) ||
      (await element.getAttribute("data-lazy")) ||
      "";
    try { return src ? new URL(src, pageUrl).href : ""; } catch (_) { return src; }
  }
  if (field.type === "link") {
    const href = (await element.getAttribute("href")) || "";
    try { return href ? new URL(href, pageUrl).href : ""; } catch (_) { return href; }
  }
  if (field.type === "price") {
    const raw = await element.textContent();
    return (raw || "").replace(/[£$€¥₹,\s]/g, "").trim();
  }
  // text — detect class-based star ratings
  const className = (await element.getAttribute("class")) || "";
  const starMatch = className.match(/\b(One|Two|Three|Four|Five)\b/i);
  if (starMatch) {
    const map = { one: "1", two: "2", three: "3", four: "4", five: "5" };
    return map[starMatch[1].toLowerCase()] || starMatch[1];
  }
  return ((await element.textContent()) || "").trim();
}

async function extractItemWithRetry(item, fields, page, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rowData = {};
      let hasData = false;
      const pageUrl = page.url();

      for (const field of fields) {
        try {
          const el = await item.$(field.selector);
          if (el) {
            const value = await extractFieldValue(el, field, pageUrl);
            if (value) { rowData[field.name] = value; hasData = true; }
          }
        } catch (_) { /* swallow per-field error */ }
      }
      return { rowData, hasData };
    } catch (err) {
      if (attempt < maxRetries) await sleep(500 * attempt);
    }
  }
  return { rowData: {}, hasData: false };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanDelay = (base) => base * 0.6 + Math.random() * base * 0.8;

async function autoScroll(page, containerSel, itemSel, maxRows = Infinity) {
  return await page.evaluate(
    async ({ containerSel, itemSel, maxRows }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let prev = 0, noNew = 0, iter = 0;
      while (iter++ < 500) {
        const items = document.querySelectorAll(`${containerSel} ${itemSel}`);
        const cur = items.length;
        if (cur >= maxRows) break;
        if (cur > prev) noNew = 0;
        else if (++noNew >= 15) break;
        prev = cur;
        if (items.length) items[items.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(1500);
        if (iter % 5 === 0) { window.scrollBy(0, 200); await sleep(300); }
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      await sleep(500);
      return document.querySelectorAll(`${containerSel} ${itemSel}`).length;
    },
    { containerSel, itemSel, maxRows },
  );
}

async function loadMoreLoad(page, containerSel, itemSel, buttonSel, maxRows = Infinity) {
  return await page.evaluate(
    async ({ containerSel, itemSel, buttonSel, maxRows }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let iter = 0;
      while (iter++ < 100) {
        const items = document.querySelectorAll(`${containerSel} ${itemSel}`);
        if (items.length >= maxRows) break;
        const btn = document.querySelector(buttonSel);
        if (!btn || btn.offsetParent === null) break;
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(500);
        btn.click();
        await sleep(2000);
      }
      window.scrollTo({ top: 0, behavior: "auto" });
      await sleep(500);
      return document.querySelectorAll(`${containerSel} ${itemSel}`).length;
    },
    { containerSel, itemSel, buttonSel, maxRows },
  );
}

async function paginationLoad(page, containerSel, itemSel, buttonSel, fields, maxRows = Infinity) {
  const allData = [];
  let validItemIndex = 0;
  let failedItems = 0;
  let pageNum = 0;
  const maxPages = 200;
  const maxClickRetries = 3;

  while (pageNum < maxPages) {
    pageNum++;

    let itemsFound = false;
    for (let t = 0; t < 3; t++) {
      try {
        await page.waitForSelector(`${containerSel} ${itemSel}`, { timeout: 10000 });
        itemsFound = true;
        break;
      } catch (_) {
        await page.waitForTimeout(2000);
      }
    }
    if (!itemsFound) break;

    const items = await page.$$(`${containerSel} ${itemSel}`);

    for (const item of items) {
      if (validItemIndex >= maxRows) break;
      const { rowData, hasData } = await extractItemWithRetry(item, fields, page, 3);
      if (hasData) {
        for (const f of fields) {
          allData.push({ item_index: validItemIndex, field_name: f.name, value: rowData[f.name] || "N/A" });
        }
        validItemIndex++;
      } else {
        failedItems++;
      }
    }

    if (validItemIndex >= maxRows) break;

    const buttonReady = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (!btn) return false;
      if (btn.disabled) return false;
      if (btn.getAttribute("aria-disabled") === "true") return false;
      if (btn.offsetParent === null) return false;
      return true;
    }, buttonSel);
    if (!buttonReady) break;

    let clicked = false;
    for (let attempt = 1; attempt <= maxClickRetries; attempt++) {
      try {
        const btnBox = await page.locator(buttonSel).boundingBox();
        if (btnBox) {
          const x = btnBox.x + btnBox.width  * (0.3 + Math.random() * 0.4);
          const y = btnBox.y + btnBox.height * (0.3 + Math.random() * 0.4);
          await page.mouse.move(x, y, { steps: Math.floor(5 + Math.random() * 10) });
          await page.waitForTimeout(humanDelay(300));
        }
        const navPromise = page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 })
          .catch(() => null);
        await page.click(buttonSel, { timeout: 5000 });
        await navPromise;
        await page.waitForTimeout(humanDelay(1500));
        clicked = true;
        break;
      } catch (_) {
        await page.waitForTimeout(2000 * attempt);
      }
    }
    if (!clicked) break;
  }

  return { totalLoaded: validItemIndex, allData, failedItems };
}
