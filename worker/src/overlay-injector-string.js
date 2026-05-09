// ── Overlay Injector (browser-side) ──────────────────────────
//
// This is the same idea as the original `src/utils/overlay-injector.js`
// from the local Next.js project, except:
//
//   • It is a plain string, not a Node module.  No `fs.readFileSync`,
//     no `require()` — the Worker has no filesystem.
//
//   • The logo is a tiny inline SVG instead of a 150KB base64 PNG,
//     so the proxy response stays small.
//
//   • Instead of writing `window.basiraResults` for the server to
//     read by polling, the panel calls `window.parent.postMessage(...)`
//     because the page now lives inside an iframe in `scraper.html`.
//
// The Worker injects this string into every proxied page right before
// `</body>`, and the browser (inside the iframe) runs it.

export const overlayScript = String.raw`
(function() {
  if (window.__basiraOverlayInstalled) return;
  window.__basiraOverlayInstalled = true;

  // ── tiny inline SVG logo ────────────────────────────────────
  var LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1">' +
    '<stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#6366f1"/>' +
    '</linearGradient></defs>' +
    '<circle cx="32" cy="32" r="30" fill="url(#g)"/>' +
    '<circle cx="32" cy="32" r="14" fill="#fff"/>' +
    '<circle cx="32" cy="32" r="6" fill="#0f172a"/>' +
    '</svg>'
  );

  var selectedFields = [];
  var isSelecting   = false;
  var fieldCounter  = 0;
  var currentListElement = null;
  var referenceItem      = null;
  var loadingMethod      = 'auto-scroll';
  var paginationButton   = null;
  var loadMoreButton     = null;
  var pickingMode        = null; // 'pagination' | 'load-more' | null

  // ── helpers ─────────────────────────────────────────────────
  function getBestClass(el) {
    if (!el || !el.className || typeof el.className !== 'string') return null;
    var classes = el.className.split(/\s+/).filter(function(c) {
      return c && !/^(active|hover|focus|selected|open|show|hide)$/i.test(c)
                && !/^(js-|is-|has-)/.test(c) && c.length > 1 && c.length < 40;
    });
    return classes[0] || null;
  }

  function getSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;
    var cdns = ['data-testid','data-cy','data-qa','data-test'];
    for (var i = 0; i < cdns.length; i++) {
      var v = el.getAttribute(cdns[i]);
      if (v) return '[' + cdns[i] + '="' + v + '"]';
    }
    var c = getBestClass(el);
    if (c) return el.tagName.toLowerCase() + '.' + c;
    // fall back to nth-child path (max 4 levels)
    var path = [], cur = el, depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4 && cur !== document.body) {
      var seg = cur.tagName.toLowerCase();
      if (cur.parentElement) {
        var idx = Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1;
        seg += ':nth-child(' + idx + ')';
      }
      path.unshift(seg);
      cur = cur.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  function relativeSelectorWithin(parent, child) {
    if (!parent || !child) return null;
    var direct = getSelector(child);
    // try class-based first
    var cls = getBestClass(child);
    if (cls) return child.tagName.toLowerCase() + '.' + cls;
    return direct;
  }

  function findRepeatedItemSelector(parent) {
    if (!parent) return null;
    var children = parent.children;
    if (children.length < 2) return null;
    var counts = {};
    for (var i = 0; i < children.length; i++) {
      var key = children[i].tagName.toLowerCase();
      var cls = getBestClass(children[i]);
      if (cls) key += '.' + cls;
      counts[key] = (counts[key] || 0) + 1;
    }
    // pick the key with the highest count
    var best = null, max = 0;
    for (var k in counts) if (counts[k] > max) { max = counts[k]; best = k; }
    return max >= 2 ? best : null;
  }

  function inferType(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'img') return 'image';
    if (tag === 'a')   return 'link';
    var t = (el.textContent || '').trim();
    if (/^[$€£¥₹]?\s*\d[\d.,\s]*$/.test(t)) return 'price';
    return 'text';
  }

  // ── selection panel UI ──────────────────────────────────────
  function init() {
    document.body.style.paddingRight = '380px';
    var panel = document.createElement('div');
    panel.id = '__basira_panel';
    panel.style.cssText = [
      'position:fixed','top:0','right:0','width:380px','height:100vh',
      'background:#0f172a','border-left:3px solid #3b82f6','z-index:2147483647',
      'color:#f1f5f9','overflow-y:auto','display:flex','flex-direction:column',
      'font-family:system-ui,-apple-system,Segoe UI,sans-serif','box-shadow:-12px 0 32px rgba(0,0,0,.3)'
    ].join(';');
    document.documentElement.appendChild(panel);
    showStartScreen();
  }

  function setPanel(html) { document.getElementById('__basira_panel').innerHTML = html; }

  function showStartScreen() {
    setPanel(
      '<div style="padding:32px 24px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #334155">' +
        '<div style="display:flex;align-items:center;gap:14px">' +
          '<img src="' + LOGO + '" style="width:56px;height:56px;border-radius:14px"/>' +
          '<div>' +
            '<div style="font-size:22px;font-weight:800;color:#3b82f6">Basira Scraper</div>' +
            '<div style="font-size:12px;color:#94a3b8;margin-top:2px">Click items, then SHIFT+Click fields</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="padding:24px;display:flex;flex-direction:column;gap:12px">' +
        '<button id="__bs_start" style="background:#3b82f6;color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">▶ Start visual selection</button>' +
        '<button id="__bs_cancel" style="background:transparent;color:#94a3b8;border:1px solid #334155;padding:12px;border-radius:10px;font-size:13px;cursor:pointer">Cancel</button>' +
        '<div style="margin-top:16px;font-size:12px;color:#64748b;line-height:1.6">' +
          '<b style="color:#cbd5e1">How it works:</b><br>' +
          '1. Click <b>any one item</b> in a list (a card, a row, a product)<br>' +
          '2. SHIFT+Click each <b>field</b> inside it (title, price, image…)<br>' +
          '3. Pick a loading method (scroll / pagination / load-more)<br>' +
          '4. Press <b>Extract</b>.' +
        '</div>' +
      '</div>'
    );
    document.getElementById('__bs_start').onclick  = startSelection;
    document.getElementById('__bs_cancel').onclick = function() {
      var ctx = window.__BASIRA__ || {};
      window.location.href = ctx.pagesUrl || '/';
    };
  }

  // ── visual selection ───────────────────────────────────────
  var hoverHighlight = null;

  function startSelection() {
    isSelecting = true;
    document.addEventListener('click',     onClick,     true);
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout',  onMouseOut,  true);
    showSelectingPanel();
  }

  function onMouseOver(e) {
    if (!isSelecting) return;
    var t = e.target;
    if (!t || t.closest('#__basira_panel')) return;
    if (hoverHighlight && hoverHighlight !== t) hoverHighlight.style.outline = '';
    hoverHighlight = t;
    t.style.outline = '2px dashed #3b82f6';
    t.style.outlineOffset = '2px';
  }

  function onMouseOut(e) {
    if (e.target && e.target.style) e.target.style.outline = '';
  }

  function onClick(e) {
    if (!isSelecting) return;
    if (e.target.closest('#__basira_panel')) return;
    e.preventDefault();
    e.stopPropagation();

    if (pickingMode === 'pagination' || pickingMode === 'load-more') {
      var sel = getSelector(e.target);
      if (pickingMode === 'pagination') paginationButton = { selector: sel, sample: (e.target.textContent || '').trim().slice(0, 40) };
      else loadMoreButton = { selector: sel, sample: (e.target.textContent || '').trim().slice(0, 40) };
      pickingMode = null;
      showSelectingPanel();
      return;
    }

    if (e.shiftKey) {
      // field pick — must be inside the reference item
      if (!referenceItem) { alert('Click a list item first (without SHIFT)'); return; }
      if (!referenceItem.contains(e.target)) {
        alert('That element is outside the item card.');
        return;
      }
      var fname = prompt('Field name?', 'field_' + (++fieldCounter));
      if (!fname) return;
      var ftype = inferType(e.target);
      var fselector = relativeSelectorWithin(referenceItem, e.target);
      selectedFields.push({
        name: fname,
        selector: fselector,
        sample: (e.target.textContent || '').trim().slice(0, 60),
        type: ftype,
      });
      showSelectingPanel();
    } else {
      // pick the reference item (the row) and detect its parent + sibling pattern
      referenceItem = e.target;
      // walk up until we find a parent that has at least one sibling of the same shape
      var cur = e.target, parent = e.target.parentElement, found = false;
      while (parent && parent !== document.body) {
        var siblings = parent.children;
        if (siblings.length >= 2) {
          var sameShape = 0;
          for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].tagName === cur.tagName) sameShape++;
          }
          if (sameShape >= 2) { referenceItem = cur; currentListElement = parent; found = true; break; }
        }
        cur = parent; parent = parent.parentElement;
      }
      if (!found) { currentListElement = e.target.parentElement; referenceItem = e.target; }
      showSelectingPanel();
    }
  }

  function showSelectingPanel() {
    var fieldsHtml = selectedFields.length
      ? selectedFields.map(function(f, i) {
          return '<div style="display:flex;align-items:center;gap:8px;background:#1e293b;border-radius:8px;padding:8px 10px;border:1px solid #334155">' +
            '<span style="font-size:11px;color:#3b82f6;font-weight:700">#' + (i + 1) + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:600">' + f.name + ' <span style="color:#64748b;font-size:10px">(' + f.type + ')</span></div>' +
              '<div style="font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + f.sample + '</div>' +
            '</div>' +
            '<button data-bs-rmf="' + i + '" style="background:transparent;border:none;color:#ef4444;cursor:pointer;font-size:16px">×</button>' +
          '</div>';
        }).join('')
      : '<div style="padding:14px;text-align:center;color:#64748b;font-size:12px;border:1px dashed #334155;border-radius:8px">No fields yet — SHIFT+Click inside the item</div>';

    var pickHint = pickingMode
      ? '<div style="background:#3b82f6;color:#fff;padding:10px;border-radius:8px;text-align:center;font-size:12px;font-weight:700">Click the ' + (pickingMode === 'pagination' ? 'NEXT' : 'LOAD MORE') + ' button on the page</div>'
      : '';

    setPanel(
      '<div style="padding:20px;background:linear-gradient(135deg,#1e293b,#0f172a);border-bottom:1px solid #334155">' +
        '<div style="font-size:18px;font-weight:800;color:#3b82f6">Basira Scraper</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' +
          (referenceItem ? '✓ Item selected · ' + selectedFields.length + ' field(s)' : 'Click any one list item to begin') +
        '</div>' +
      '</div>' +
      '<div style="padding:18px;display:flex;flex-direction:column;gap:12px;flex:1;overflow-y:auto">' +
        pickHint +
        '<div style="font-size:11px;font-weight:800;color:#64748b;letter-spacing:1.2px">FIELDS</div>' +
        fieldsHtml +
        '<div style="font-size:11px;font-weight:800;color:#64748b;letter-spacing:1.2px;margin-top:8px">LOADING METHOD</div>' +
        '<div style="display:flex;gap:6px">' +
          methodBtn('auto-scroll', '↕ Scroll') +
          methodBtn('pagination',  '📄 Pages') +
          methodBtn('load-more',   '➕ Load') +
        '</div>' +
        (loadingMethod === 'pagination'
          ? '<button id="__bs_pickpag" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:10px;border-radius:8px;font-size:12px;cursor:pointer">' + (paginationButton ? '✓ Next button: ' + paginationButton.sample : 'Pick the “Next” button') + '</button>'
          : '') +
        (loadingMethod === 'load-more'
          ? '<button id="__bs_pickmore" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:10px;border-radius:8px;font-size:12px;cursor:pointer">' + (loadMoreButton ? '✓ Load-more: ' + loadMoreButton.sample : 'Pick the “Load more” button') + '</button>'
          : '') +
      '</div>' +
      '<div style="padding:18px;border-top:1px solid #334155;display:flex;flex-direction:column;gap:8px">' +
        '<button id="__bs_extract" style="background:' + (selectedFields.length ? '#10b981' : '#334155') + ';color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:700;cursor:' + (selectedFields.length ? 'pointer' : 'not-allowed') + '">⚡ Extract data</button>' +
        '<button id="__bs_reset" style="background:transparent;color:#94a3b8;border:1px solid #334155;padding:10px;border-radius:8px;font-size:12px;cursor:pointer">Reset</button>' +
      '</div>'
    );

    Array.prototype.forEach.call(document.querySelectorAll('[data-bs-rmf]'), function(b) {
      b.onclick = function() { selectedFields.splice(+b.getAttribute('data-bs-rmf'), 1); showSelectingPanel(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bs-method]'), function(b) {
      b.onclick = function() { loadingMethod = b.getAttribute('data-bs-method'); showSelectingPanel(); };
    });
    var pp = document.getElementById('__bs_pickpag');  if (pp) pp.onclick  = function() { pickingMode = 'pagination'; showSelectingPanel(); };
    var pm = document.getElementById('__bs_pickmore'); if (pm) pm.onclick = function() { pickingMode = 'load-more'; showSelectingPanel(); };
    document.getElementById('__bs_reset').onclick = function() {
      selectedFields = []; referenceItem = null; currentListElement = null;
      paginationButton = null; loadMoreButton = null; loadingMethod = 'auto-scroll';
      showSelectingPanel();
    };
    document.getElementById('__bs_extract').onclick = function() {
      if (!selectedFields.length) return;
      submit();
    };
  }

  function methodBtn(value, label) {
    var active = loadingMethod === value;
    return '<button data-bs-method="' + value + '" style="flex:1;background:' + (active ? '#3b82f6' : '#1e293b') + ';color:' + (active ? '#fff' : '#cbd5e1') + ';border:1px solid ' + (active ? '#3b82f6' : '#334155') + ';padding:10px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">' + label + '</button>';
  }

  function submit() {
    isSelecting = false;
    document.removeEventListener('click',     onClick,     true);
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout',  onMouseOut,  true);

    var containerSelector = getSelector(currentListElement);
    var itemSelector = findRepeatedItemSelector(currentListElement) ||
                       (referenceItem ? referenceItem.tagName.toLowerCase() : '*');

    var result = {
      parentSelector:    containerSelector,
      itemSelector:      itemSelector,
      loadingMethod:     loadingMethod,
      paginationSelector: paginationButton ? paginationButton.selector : null,
      loadMoreSelector:   loadMoreButton   ? loadMoreButton.selector   : null,
      fields: selectedFields.map(function(f) {
        return { name: f.name, selector: f.selector, sample: f.sample, type: f.type || 'text' };
      }),
    };

    setPanel(
      '<div style="padding:60px 30px;text-align:center;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
        '<div style="width:88px;height:88px;background:linear-gradient(135deg,#10b981,#14b8a6);border-radius:24px;display:flex;align-items:center;justify-content:center;font-size:42px;color:#fff">✓</div>' +
        '<div style="margin-top:24px;font-size:22px;font-weight:800;color:#fff">Selection captured</div>' +
        '<div style="margin-top:8px;font-size:13px;color:#94a3b8">Sending to scraper…</div>' +
      '</div>'
    );

    try {
      var ctx = window.__BASIRA__ || {};
      var qs = new URLSearchParams({
        jobId:    ctx.jobId    || '',
        url:      ctx.sourceUrl || '',
        lang:     ctx.lang     || 'en',
        stealth:  ctx.stealth  || '0',
        rowLimit: ctx.rowLimit || '',
        autorun:  '1',
        selection: encodeURIComponent(JSON.stringify(result)),
      });
      var dest = (ctx.pagesUrl || '') + '/scraper.html?' + qs.toString();
      // Brief pause so the user sees the "captured" panel for a moment.
      setTimeout(function() { window.location.href = dest; }, 600);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 200);
  }
})();
`;
