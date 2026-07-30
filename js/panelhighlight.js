// cmd2607301756: replaced the cross-column leader line with tree
// auto-centering + a shared magenta highlight on both ends -- no more
// #panel-link-overlay, no more per-frame scroll/resize tracking loop (that
// machinery existed purely to keep a line's endpoints glued to moving DOM
// elements; a glow toggle + a one-shot pan don't need continuous
// repositioning). The link between a spatial-map panel and its tree segment
// is now conveyed by: (a) panning the tree so the segment is centered
// (js/tree.js's panSegmentIntoView), (b) glowing that segment magenta
// (js/tree.js's glowSegment/unglowSegment, --tree-magenta), and (c) the
// same magenta on the panel's own border/outline (chain-entry--panel-linked/
// --panel-pinned, css/style.css) -- (b) and (c) already shared this color
// before this change, so no color/CSS work was needed there.
//
// cmd2607271611: PIN state on top of the original hover-only display.
// Clicking a panel to enlarge it (chainpanel.js's existing
// chain-entry--expanded toggle) pins that mutation's highlight so it
// survives mouseleave; only one pin at a time. `displayed` is whichever
// mutation is CURRENTLY highlighted -- normally the pin, but a transient
// hover over a different panel temporarily takes over `displayed` and
// hidePanelLink() hands it back to the pin (if any) instead of clearing.
//
// Orchestrates tree.js's lower-level per-segment primitives
// (glowSegment/unglowSegment/panSegmentIntoView) plus its own panel-side
// scroll/highlight -- this file is the only thing that knows about BOTH
// columns at once.

let displayed = null; // { panelEl, mutationId } | null -- whatever's currently highlighted
let pinned = null; // { panelEl, mutationId } | null -- persists across mouseleave until explicitly unpinned
let hoverToken = 0; // invalidates a stale in-flight auto-pan sequence

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

// Switches `displayed` to (panelEl, mutationId): un-glows/un-classes the
// previous displayed entry first (unless it's the same one, in which case
// this is a no-op re-application -- keeps re-hovering the pinned panel
// itself from flickering), then glows + classes the new one immediately
// (no need to wait for the tree pan to finish).
function setDisplayed(panelEl, mutationId) {
  const same = displayed && displayed.panelEl === panelEl && displayed.mutationId === mutationId;
  if (displayed && !same) {
    if (typeof unglowSegment === 'function') unglowSegment(displayed.mutationId);
    clearPanelClasses(displayed);
  }
  displayed = { panelEl, mutationId };
  applyPanelClasses(displayed);
  if (typeof glowSegment === 'function') glowSegment(mutationId);
}

function clearAllDisplay() {
  if (displayed) {
    if (typeof unglowSegment === 'function') unglowSegment(displayed.mutationId);
    clearPanelClasses(displayed);
  }
  displayed = null;
}

// Instantly re-shows an already-known-good display (used to hand the
// highlight back to the pin once a transient hover ends) -- no auto-pan,
// since the pin was already centered before the hover interrupted it.
function restoreDisplay(panelEl, mutationId) {
  setDisplayed(panelEl, mutationId);
}

// Full sequence for a NEW display target (a fresh hover or a fresh pin):
// glow + classes apply immediately, then scroll the panel into view and pan
// the tree so the segment is centered.
async function runDisplaySequence(panelEl, mutationId) {
  const myToken = ++hoverToken;
  setDisplayed(panelEl, mutationId);

  const chainScroll = document.getElementById('chain-scroll');
  const scrollRect = chainScroll.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  const panelNeedsScroll = panelRect.top < scrollRect.top || panelRect.bottom > scrollRect.bottom;
  if (panelNeedsScroll) {
    panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (typeof panSegmentIntoView === 'function') {
    await panSegmentIntoView(mutationId);
    if (myToken !== hoverToken) return; // superseded by a newer hover/pin/unpin while panning
  }
}

/**
 * Called on kidney-map panel mouseenter. `panelEl` is the whole card
 * (.chain-entry); mutationId is that card's own mutation. If this panel is
 * already what's displayed (e.g. it's the pinned panel, or you're
 * re-entering the same panel), there's nothing to do.
 */
function showPanelLink(panelEl, mutationId) {
  if (displayed && displayed.panelEl === panelEl && displayed.mutationId === mutationId) return;
  runDisplaySequence(panelEl, mutationId);
}

/**
 * Called on kidney-map panel mouseleave. If a pin exists, the highlight is
 * handed back to the pin (restored, not cleared) -- a transient hover must
 * never leave the pinned segment un-highlighted. With no pin, this fully
 * reverts, same as before pinning existed.
 */
function hidePanelLink() {
  hoverToken++; // invalidate any in-flight auto-pan for the hover that just ended
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
 * glow/classes are torn down by setDisplayed() inside runDisplaySequence,
 * same as any other display switch).
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
  hoverToken++; // invalidate any in-flight auto-pan sequence
  clearAllDisplay();
}

/**
 * Called by chainpanel.js right before it tears down/rebuilds #chain-list
 * (new node selected, tree version switched) -- any pinned/displayed
 * panelEl is about to go stale (removed from the DOM), so drop it
 * unconditionally rather than let clearAllDisplay() run later against a
 * detached node.
 */
function resetPanelLink() {
  pinned = null;
  hoverToken++;
  clearAllDisplay();
}
