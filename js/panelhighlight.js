// cmd2607271517: cross-column magenta leader line connecting a hovered
// kidney-map panel (in #chain-panel) to its corresponding tree segment (in
// #tree-panel). Lives on its own full-viewport overlay SVG (#panel-link-overlay,
// a direct child of <body>, position:fixed, pointer-events:none) since the
// line needs to be drawn ON TOP of both columns regardless of their own
// stacking/overflow/scroll state -- neither column's own SVG can host an
// element that escapes its own clipping box.
//
// cmd2607271611: added a PIN state on top of the original hover-only
// display. Clicking a panel to enlarge it (chainpanel.js's existing
// chain-entry--expanded toggle) pins that mutation's highlight so it
// survives mouseleave; only one pin at a time. `displayed` is whichever
// mutation is CURRENTLY drawn on the single shared overlay -- normally the
// pin, but a transient hover over a different panel temporarily takes over
// `displayed` and hidePanelLink() hands it back to the pin (if any) instead
// of clearing, rather than fully hiding.
//
// Orchestrates tree.js's lower-level per-segment primitives
// (getSegmentElement/glowSegment/unglowSegment/panSegmentIntoView) plus its
// own panel-side scroll/highlight -- this file is the only thing that knows
// about BOTH columns at once.

const LEADER_LINE_COLOR = '#e6007a';
const AUTOSCROLL_SETTLE_MS = 500; // >= tree.js panSegmentIntoView's 450ms transition + scrollIntoView's native smooth duration

let overlaySvg = null;
let linkPath = null;
let dotStart = null;
let dotEnd = null;
let arrowMark = null;

let displayed = null; // { panelEl, mutationId } | null -- whatever's currently drawn on the overlay
let pinned = null; // { panelEl, mutationId } | null -- persists across mouseleave until explicitly unpinned
let trackHandle = null; // requestAnimationFrame handle for the scroll/resize-driven redraw loop
let hoverToken = 0; // invalidates a stale in-flight auto-scroll sequence

function ensureOverlay() {
  if (overlaySvg) return;
  overlaySvg = document.getElementById('panel-link-overlay');
  if (!overlaySvg) return;
  const ns = 'http://www.w3.org/2000/svg';
  linkPath = document.createElementNS(ns, 'path');
  linkPath.setAttribute('fill', 'none');
  linkPath.setAttribute('stroke', LEADER_LINE_COLOR);
  linkPath.setAttribute('stroke-width', '2.5');
  linkPath.setAttribute('stroke-linecap', 'round');
  dotStart = document.createElementNS(ns, 'circle');
  dotEnd = document.createElementNS(ns, 'circle');
  [dotStart, dotEnd].forEach((c) => {
    c.setAttribute('r', '4');
    c.setAttribute('fill', LEADER_LINE_COLOR);
  });
  arrowMark = document.createElementNS(ns, 'path');
  arrowMark.setAttribute('fill', LEADER_LINE_COLOR);
  overlaySvg.appendChild(linkPath);
  overlaySvg.appendChild(dotStart);
  overlaySvg.appendChild(dotEnd);
  overlaySvg.appendChild(arrowMark);
  hideOverlayElements();
}

function hideOverlayElements() {
  [linkPath, dotStart, dotEnd, arrowMark].forEach((el) => { if (el) el.style.display = 'none'; });
}

function clampPointToRect(x, y, rect) {
  return {
    x: Math.min(Math.max(x, rect.left), rect.right),
    y: Math.min(Math.max(y, rect.top), rect.bottom),
  };
}

// Small upward/downward triangle at (x,y), pointing toward `direction`
// ('up' | 'down') -- caps the line where it's clamped to a column's edge
// because the true endpoint is still offscreen after auto-scrolling.
function arrowPathAt(x, y, direction) {
  const s = 6;
  if (direction === 'up') {
    return `M${x - s},${y + s} L${x},${y - s} L${x + s},${y + s} Z`;
  }
  return `M${x - s},${y - s} L${x},${y + s} L${x + s},${y - s} Z`;
}

function redraw() {
  if (!displayed || !overlaySvg) return;
  const { panelEl, mutationId } = displayed;

  const treePanel = document.getElementById('tree-panel');
  const chainScroll = document.getElementById('chain-scroll');
  if (!treePanel || !chainScroll) return;
  const treeRect = treePanel.getBoundingClientRect();
  const scrollRect = chainScroll.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();

  const segEl = typeof getSegmentElement === 'function' ? getSegmentElement(mutationId) : null;

  // --- panel-side endpoint: left-center of the card, facing the tree column ---
  let panelTrueX = panelRect.left;
  let panelTrueY = panelRect.top + panelRect.height / 2;
  const panelOffTop = panelRect.top < scrollRect.top;
  const panelOffBottom = panelRect.bottom > scrollRect.bottom;
  const panelOffscreen = panelOffTop || panelOffBottom;
  let panelDraw = panelOffscreen
    ? clampPointToRect(panelTrueX, panelTrueY, scrollRect)
    : { x: panelTrueX, y: panelTrueY };

  // --- tree-side endpoint: center of the target segment ---
  let treeDraw = null;
  let treeOffscreen = !segEl;
  let treeDirection = null;
  if (segEl) {
    const segRect = segEl.getBoundingClientRect();
    const trueX = segRect.left + segRect.width / 2;
    const trueY = segRect.top + segRect.height / 2;
    const offTop = trueY < treeRect.top;
    const offBottom = trueY > treeRect.bottom;
    const offLeft = trueX < treeRect.left;
    const offRight = trueX > treeRect.right;
    treeOffscreen = offTop || offBottom || offLeft || offRight;
    treeDraw = treeOffscreen ? clampPointToRect(trueX, trueY, treeRect) : { x: trueX, y: trueY };
    treeDirection = offTop ? 'up' : (offBottom ? 'down' : null);
  } else {
    // No segment element at all (shouldn't normally happen -- guarded by
    // chainpanel.js only wiring this up for in-panel entries) -- clamp to
    // the tree panel's own center as a harmless fallback endpoint.
    const cx = treeRect.left + treeRect.width / 2;
    const cy = treeRect.top + treeRect.height / 2;
    treeDraw = { x: cx, y: cy };
  }

  // Curve control point: bulge through the gap between the two panel
  // columns (the shared border area) rather than cutting straight across
  // either column's own dense content.
  const gapX = (treeRect.right + scrollRect.left) / 2;
  const midY = (panelDraw.y + treeDraw.y) / 2;
  const ctrl1 = { x: gapX, y: panelDraw.y };
  const ctrl2 = { x: gapX, y: treeDraw.y };

  linkPath.setAttribute(
    'd',
    `M${panelDraw.x},${panelDraw.y} C${ctrl1.x},${ctrl1.y} ${ctrl2.x},${midY} ${treeDraw.x},${treeDraw.y}`
  );
  linkPath.style.display = null;

  dotStart.setAttribute('cx', panelDraw.x);
  dotStart.setAttribute('cy', panelDraw.y);
  dotStart.style.display = null;

  dotEnd.setAttribute('cx', treeDraw.x);
  dotEnd.setAttribute('cy', treeDraw.y);
  dotEnd.style.display = null;

  if (treeOffscreen && treeDirection) {
    arrowMark.setAttribute('d', arrowPathAt(treeDraw.x, treeDraw.y, treeDirection));
    arrowMark.style.display = null;
  } else {
    arrowMark.style.display = 'none';
  }

  if (segEl) {
    glowSegment(mutationId);
  }
}

function startTracking() {
  if (trackHandle) return; // already running -- idempotent
  const loop = () => {
    redraw();
    trackHandle = requestAnimationFrame(loop);
  };
  trackHandle = requestAnimationFrame(loop);
  window.addEventListener('scroll', redraw, true);
  window.addEventListener('resize', redraw);
}

function stopTracking() {
  if (trackHandle) cancelAnimationFrame(trackHandle);
  trackHandle = null;
  window.removeEventListener('scroll', redraw, true);
  window.removeEventListener('resize', redraw);
}

function isPinned(panelEl, mutationId) {
  return !!pinned && pinned.panelEl === panelEl && pinned.mutationId === mutationId;
}

function applyPanelClasses(entry) {
  if (!entry) return;
  entry.panelEl.classList.add('chain-entry--panel-linked');
  entry.panelEl.classList.toggle('chain-entry--panel-pinned', isPinned(entry.panelEl, entry.mutationId));
}

function clearPanelClasses(entry) {
  if (!entry) return;
  entry.panelEl.classList.remove('chain-entry--panel-linked');
  entry.panelEl.classList.remove('chain-entry--panel-pinned');
}

// Switches `displayed` to (panelEl, mutationId), releasing the previous
// displayed entry's glow/border first (unless it's the same one, in which
// case this is a no-op re-application -- keeps re-hovering the pinned panel
// itself from flickering).
function setDisplayed(panelEl, mutationId) {
  const same = displayed && displayed.panelEl === panelEl && displayed.mutationId === mutationId;
  if (displayed && !same) {
    if (typeof unglowSegment === 'function') unglowSegment(displayed.mutationId);
    clearPanelClasses(displayed);
  }
  displayed = { panelEl, mutationId };
  applyPanelClasses(displayed);
}

function clearAllDisplay() {
  if (displayed) {
    if (typeof unglowSegment === 'function') unglowSegment(displayed.mutationId);
    clearPanelClasses(displayed);
  }
  displayed = null;
  hideOverlayElements();
  stopTracking();
}

// Instantly re-shows an already-known-good display (used to hand the
// overlay back to the pin once a transient hover ends) -- no auto-scroll,
// since the pin was already positioned before the hover interrupted it;
// redraw()'s own offscreen-clamp+arrow handles anything that scrolled away
// in the meantime.
function restoreDisplay(panelEl, mutationId) {
  setDisplayed(panelEl, mutationId);
  redraw();
  startTracking();
}

// Full async sequence for a NEW display target (a fresh hover or a fresh
// pin): draw immediately with whatever's currently visible, then smoothly
// bring both ends into view, then redraw once settled.
async function runDisplaySequence(panelEl, mutationId) {
  ensureOverlay();
  if (!overlaySvg) return;

  const myToken = ++hoverToken;
  setDisplayed(panelEl, mutationId);
  redraw();
  startTracking();

  const chainScroll = document.getElementById('chain-scroll');
  const scrollRect = chainScroll.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  const panelNeedsScroll = panelRect.top < scrollRect.top || panelRect.bottom > scrollRect.bottom;
  if (panelNeedsScroll) {
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const panPromise = typeof panSegmentIntoView === 'function'
    ? panSegmentIntoView(mutationId)
    : Promise.resolve(false);

  await Promise.race([
    panPromise,
    new Promise((resolve) => setTimeout(resolve, AUTOSCROLL_SETTLE_MS)),
  ]);
  // A little extra settle time for the panel's native smooth-scroll (not
  // itself awaitable) to finish alongside the tree's own transition.
  await new Promise((resolve) => setTimeout(resolve, 120));

  if (myToken !== hoverToken) return; // superseded by a newer hover/pin/unpin while we were scrolling
  redraw();
}

/**
 * Called on kidney-map panel mouseenter. `panelEl` is the whole card
 * (.chain-entry); mutationId is that card's own mutation. If this panel is
 * already what's displayed (e.g. it's the pinned panel, or you're re-
 * entering the same panel), just make sure tracking is alive -- no need to
 * replay the auto-scroll dance for something already in view.
 */
function showPanelLink(panelEl, mutationId) {
  if (displayed && displayed.panelEl === panelEl && displayed.mutationId === mutationId) {
    startTracking();
    return;
  }
  runDisplaySequence(panelEl, mutationId);
}

/**
 * Called on kidney-map panel mouseleave. If a pin exists, the overlay is
 * handed back to the pin (restored, not cleared) -- a transient hover must
 * never leave the pinned segment un-highlighted. With no pin, this fully
 * reverts, same as before pinning existed.
 */
function hidePanelLink() {
  hoverToken++; // invalidate any in-flight auto-scroll sequence for the hover that just ended
  if (pinned) {
    const alreadyShowingPin = displayed && displayed.panelEl === pinned.panelEl && displayed.mutationId === pinned.mutationId;
    if (!alreadyShowingPin) restoreDisplay(pinned.panelEl, pinned.mutationId);
    return;
  }
  clearAllDisplay();
}

/**
 * Called when a panel is clicked to enlarge (chainpanel.js's
 * chain-entry--expanded toggle turning on). Only one pin at a time --
 * pinning a new panel cleanly releases whatever was pinned before (its
 * glow/border/line are torn down by setDisplayed() inside
 * runDisplaySequence, same as any other display switch).
 */
function pinPanelLink(panelEl, mutationId) {
  pinned = { panelEl, mutationId };
  runDisplaySequence(panelEl, mutationId);
}

/**
 * Called when the pinned panel is collapsed (chain-entry--expanded turning
 * off). Only the actual pinned panel can unpin itself -- collapsing some
 * other, non-pinned panel is a no-op here. Fully reverts the highlight per
 * spec, regardless of whether the mouse is still physically over the panel.
 */
function unpinPanelLink(panelEl) {
  if (!pinned || pinned.panelEl !== panelEl) return;
  pinned = null;
  hoverToken++; // invalidate any in-flight auto-scroll sequence
  clearAllDisplay();
}

/**
 * Called by chainpanel.js right before it tears down/rebuilds #chain-list
 * (new node selected, tree version switched) -- any pinned/displayed
 * panelEl is about to go stale (removed from the DOM), so drop it
 * unconditionally rather than let clearAllDisplay()/unglowSegment() run
 * later against a detached node.
 */
function resetPanelLink() {
  pinned = null;
  hoverToken++;
  clearAllDisplay();
}
