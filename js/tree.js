// Renders data/<donor>/tree.json (or tree_full.json) as a pannable/zoomable
// D3 dendrogram. tree.json shape: { nodes: { id: {id, is_leaf, leaf_name,
// parent_id, children, mutation_ids, n_mutations} }, root_id,
// unassigned_mutation_ids, panel_mutation_ids? }. panel_mutation_ids is only
// present on tree_full.json (the 567-mutation full-resolution tree) --
// tree.json (315, TG-panel-confirmed) omits it since every mutation there
// already has kidney VAF data by construction.
//
// cmd2607271426: DISCRETE mutation-per-step layout (replaces the earlier
// continuous branch-length-proportional depth axis). Each edge's length is
// (number of mutations on that edge) * STEP_PX, and each mutation renders
// as its own individually-colored, individually-addressable segment --
// data/tree*.json's per-node mutation_ids array (an ordered list, confirmed
// present + internally consistent with n_mutations on both tree files
// before this rewrite -- see chat record) is what makes this possible. A
// 0-mutation edge (including the synthetic root stub) draws as a short
// neutral CAP_PX "knot" instead of a mutation-count-proportional run --
// same DB3-style short root knot before the first real split, generalized
// to every 0-mutation edge, not just the root's.

let treeOrientation = 'vertical'; // 'horizontal' | 'vertical' -- vertical is the default per stage3
let treeVersion = '315'; // '315' (TG panel, default) | '567' (full resolution)
let treeZoomScale = 1; // preserved across orientation toggles (translate is not, see drawTree)
let treeLastData = null; // cached last-loaded tree.json, so toggling orientation doesn't refetch
let treeDonor = 'DB15'; // set by renderTree(donor); used when a click needs to look up chains.json
let selectedNodeId = null; // click-to-select state, persists across orientation toggles/redraws

// Module-level state kept in sync by the most recent drawTree() call, so the
// exposed highlightChainSegment/clearChainSegmentHighlight functions (called
// from chainpanel.js on kidney-panel hover, outside drawTree's own closure)
// can look up the latest tree without needing drawTree to re-run.
let currentPathIds = new Set();
let currentMutationIdToNodeId = {};
let currentPanelIds = null; // Set|null -- null on 315 (every mutation counts as TG-confirmed)

const TREE_FILES = {
  315: { tree: 'tree.json', chains: 'chains.json' },
  567: { tree: 'tree_full.json', chains: 'chains_full.json' },
};

const STEP_PX = 10; // px per discrete mutation step, along the depth axis
const CAP_PX = 5; // px for a 0-mutation edge's neutral "cap" stub (shorter than one step -- DB3-style knot)
const SELECTED_COLOR = '#ff6b35'; // chain-selection halo
const TG_CONFIRMED_COLOR = '#2f6fb0'; // blue -- same as css --accent
const NO_PANEL_COLOR = '#9aa5b1'; // gray -- matches the existing leaf-node fill color
const STRUCTURAL_COLOR = '#c3cad1'; // lighter neutral -- brackets + 0-mutation caps (not a real mutation, no panel color applies)
const HOVER_LINK_COLOR = '#2f6fb0';
const NO_PANEL_X_COLOR = '#6b7785'; // gray X (was red pre-redesign) -- matches css --muted
const PANEL_LINK_COLOR = '#e6007a'; // magenta -- cmd2607271517 cross-column kidney-panel<->tree-segment leader line + glow

// Module-level (not local to drawTree) so the exposed cross-column
// leader-line helpers (called from js/panelhighlight.js on kidney-panel
// hover, well after drawTree's own closure has returned) can still pan the
// live tree and query the live zoom scale.
let currentZoomBehavior = null;
let currentSvgSelection = null;

async function renderTree(donor) {
  const status = document.getElementById('tree-status');
  status.textContent = 'loading…';
  treeDonor = donor;
  selectedNodeId = null; // fresh donor/tree -- any prior selection belongs to a different tree
  if (typeof showChainPlaceholder === 'function') showChainPlaceholder();

  let data;
  try {
    const res = await fetch(`data/${donor}/${TREE_FILES[treeVersion].tree}`);
    data = await res.json();
  } catch (err) {
    status.textContent = `failed to load ${TREE_FILES[treeVersion].tree}`;
    console.error(err);
    return;
  }

  treeLastData = data;
  drawTree(data);
}

function setTreeVersion(version) {
  if (version === treeVersion) return;
  treeVersion = version;
  document.getElementById('version-315').classList.toggle('is-active', version === '315');
  document.getElementById('version-567').classList.toggle('is-active', version === '567');
  document.getElementById('tree-legend-nopanel').style.display = version === '567' ? '' : 'none';
  // Full reset: a node id from one tree has no meaning in the other (the two
  // trees are built from different newicks with independently-assigned ids),
  // so any carried-over selection would silently point at the wrong node.
  selectedNodeId = null;
  if (typeof showChainPlaceholder === 'function') showChainPlaceholder();
  renderTree(treeDonor);
}

function drawTree(data) {
  const svg = d3.select('#tree-svg');
  svg.selectAll('*').remove();
  // Drop any zoom listeners from a previous drawTree() call before attaching
  // a new zoom behavior below -- otherwise every orientation toggle stacks
  // another full set of wheel/mousedown/touch listeners on the same <svg>
  // node (it's never recreated, only its children are cleared), which
  // compounds across repeated toggles.
  svg.on('.zoom', null);

  const status = document.getElementById('tree-status');
  const isVertical = treeOrientation === 'vertical';

  const nodesArr = Object.values(data.nodes);
  const panelIds = data.panel_mutation_ids ? new Set(data.panel_mutation_ids) : null;
  currentPanelIds = panelIds;

  // d3.stratify wants parentId(root) === undefined/null, which matches our schema directly.
  const root = d3.stratify()
    .id((d) => d.id)
    .parentId((d) => d.parent_id)(nodesArr);

  const leaves = root.leaves();
  const nLeaves = leaves.length;

  const leafSpacing = 9; // px between adjacent leaves, along the leaf axis

  // Leaf ordering/position comes from d3.cluster() (unrelated to branch
  // length) -- it spaces leaves uniformly by construction, so leaf-axis
  // overlap is a zoom/resolution issue, never a d.x-positioning bug.
  const leafAxisPx = Math.max(400, nLeaves * leafSpacing);
  const cluster = d3.cluster().size([leafAxisPx, 1]);
  cluster(root);

  // d3.cluster's actual adjacent-leaf gap can run smaller than the nominal
  // leafSpacing (its separation() weighting tightens siblings under the same
  // parent) -- a fixed r=10 leaf hit-circle overlaps neighbors whenever the
  // real gap is under ~20px, which happens throughout a 502-leaf tree.
  // Derive the hit radius from the actual minimum gap instead, so adjacent
  // leaf hit-circles never cover each other's center (verified via
  // Playwright: r=10 against a ~7px real gap picked the wrong neighboring
  // leaf on an off-center click).
  const sortedLeafX = leaves.map((d) => d.x).sort((a, b) => a - b);
  let minLeafGap = Infinity;
  for (let i = 1; i < sortedLeafX.length; i++) {
    minLeafGap = Math.min(minLeafGap, sortedLeafX[i] - sortedLeafX[i - 1]);
  }
  const leafHitRadius = Number.isFinite(minLeafGap)
    ? Math.min(10, Math.max(2.5, minLeafGap / 2 - 0.3))
    : 10;

  // Discrete depth position: each edge's length = n_mutations * STEP_PX, or
  // CAP_PX for a 0-mutation edge (root's own synthetic incoming edge is
  // treated the same way -- a 0-mutation edge from an implicit point above
  // it, giving the short DB3-style root knot before the first real split).
  root.eachBefore((d) => {
    if (!d.parent) {
      d.branchPos = CAP_PX;
      return;
    }
    const n = d.data.n_mutations || 0;
    d.branchPos = d.parent.branchPos + (n > 0 ? n * STEP_PX : CAP_PX);
  });
  const depthAxisPx = d3.max(root.descendants(), (d) => d.branchPos);

  // screen-x/screen-y accessors for TRUE (unaligned) branch-endpoint
  // position: horizontal = root-left/leaves-right (depth -> x, leaf -> y);
  // vertical = root-top/leaves-bottom (leaf -> x, depth -> y).
  const screenX = isVertical ? (d) => d.x : (d) => d.branchPos;
  const screenY = isVertical ? (d) => d.branchPos : (d) => d.x;
  // depth-axis / leaf-axis screen coordinate, orientation-independent --
  // used by the bracket/descent link geometry below.
  const depthScreen = isVertical ? screenY : screenX;
  const leafAxisScreen = isVertical ? screenX : screenY;

  // Aligned position (iTOL/ete3 "aligned tip labels" convention): leaf-axis
  // coordinate unchanged, depth-axis coordinate pinned to the alignment
  // line (the furthest-right/bottom leaf's true depth). Only used for leaf
  // circles/labels + the dashed guide target -- links always connect true
  // (unaligned) node positions, so real branch length stays visible.
  const leafScreenX = isVertical ? (d) => d.x : () => depthAxisPx;
  const leafScreenY = isVertical ? () => depthAxisPx : (d) => d.x;
  const nodeScreenX = (d) => (d.data.is_leaf ? leafScreenX(d) : screenX(d));
  const nodeScreenY = (d) => (d.data.is_leaf ? leafScreenY(d) : screenY(d));

  const margin = isVertical
    ? { top: 20, left: 30, right: 30, bottom: 90 }
    : { top: 20, left: 90, right: 40, bottom: 20 };

  const innerWidth = isVertical ? leafAxisPx : depthAxisPx;
  const innerHeight = isVertical ? depthAxisPx : leafAxisPx;
  const totalWidth = innerWidth + margin.left + margin.right;
  const totalHeight = innerHeight + margin.top + margin.bottom;
  svg.attr('viewBox', [0, 0, totalWidth, totalHeight]);

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

  // Shared hover tooltip (used by both links and nodes).
  const tooltip = d3.select('#tree-panel')
    .selectAll('.tree-tooltip')
    .data([null])
    .join('div')
    .attr('class', 'tree-tooltip')
    .style('display', 'none');

  function showTooltip(event, html) {
    tooltip.style('display', 'block').html(html);
    moveTooltip(event);
  }
  function moveTooltip(event) {
    const panelRect = document.getElementById('tree-panel').getBoundingClientRect();
    tooltip
      .style('left', `${event.clientX - panelRect.left + 12}px`)
      .style('top', `${event.clientY - panelRect.top + 12}px`);
  }
  function hideTooltip() {
    tooltip.style('display', 'none');
  }

  function branchTooltipHtml(d) {
    const n = d.data;
    const ids = n.mutation_ids || [];
    const shown = ids.slice(0, 10).join(', ');
    const more = ids.length > 10 ? ` (+${ids.length - 10} more)` : '';
    return `<strong>${n.n_mutations} mutation${n.n_mutations === 1 ? '' : 's'}</strong> on this branch` +
      (ids.length ? `<br>${shown}${more}` : '');
  }

  // Click-to-select lineage chain highlighting. currentPathIds = set of
  // node ids from root down to the selected node (inclusive), recomputed
  // from THIS render's root each time -- selectedNodeId itself persists
  // across redraws (orientation/version toggles), but the d3 hierarchy is
  // rebuilt from scratch every drawTree() call, so the id-set can't be
  // cached. currentPathIds is module-level (not `let` redeclared here) so
  // the exposed hover-highlight functions can read the latest value.
  function recomputePathIds() {
    currentPathIds = new Set();
    if (!selectedNodeId) return;
    const selD = root.descendants().find((d) => d.data.id === selectedNodeId);
    if (selD) {
      currentPathIds = new Set(selD.ancestors().map((a) => a.data.id));
    } else {
      selectedNodeId = null; // stale id -- shouldn't happen for a fixed tree shape
    }
  }
  recomputePathIds();

  // mutation_id -> node id (the node that OWNS this mutation on its own
  // branch), rebuilt every draw -- exposed at module level for chainpanel.js
  // kidney-panel-hover -> tree-segment lookups.
  currentMutationIdToNodeId = {};
  root.descendants().forEach((d) => {
    (d.data.mutation_ids || []).forEach((m) => { currentMutationIdToNodeId[m] = d.data.id; });
  });

  // Per-edge discrete segment list: one entry per mutation (in the data's
  // own order), or a single synthetic "cap" entry for a 0-mutation edge.
  // `start`/`end` are depth-axis screen coordinates (already includes the
  // parent's own branchPos as the base). Used for both the root's synthetic
  // stub (no `d`/mutation owner, handled separately below) and every real
  // parent->child edge.
  function segmentsFor(d) {
    const startDepth = d.parent.branchPos;
    const muts = d.data.mutation_ids || [];
    if (!muts.length) {
      return [{ start: startDepth, end: d.branchPos, mutationId: null, isCap: true }];
    }
    // Small gap trimmed off the trailing edge of every non-last segment, so
    // "6 stacked cells" reads as visibly discrete steps even when adjacent
    // mutations share the same TG-confirmed/no-TG color and would otherwise
    // blend into one seamless run. No gap at the very first segment's start
    // (stays attached to the bracket) or the very last segment's end (stays
    // attached to the node dot).
    const SEGMENT_GAP = 1.2;
    return muts.map((m, i) => {
      const segStart = startDepth + i * STEP_PX;
      const segEnd = startDepth + (i + 1) * STEP_PX;
      const isLast = i === muts.length - 1;
      return {
        start: segStart,
        end: isLast ? segEnd : segEnd - SEGMENT_GAP,
        mutationId: m,
        isCap: false,
      };
    });
  }
  function isTgConfirmed(mutationId) {
    return !panelIds || panelIds.has(mutationId); // 315 (panelIds null): every mutation counts as confirmed
  }
  function segmentBaseColor(seg) {
    if (seg.isCap) return STRUCTURAL_COLOR;
    return isTgConfirmed(seg.mutationId) ? TG_CONFIRMED_COLOR : NO_PANEL_COLOR;
  }
  function segmentCoords(d, seg) {
    const leaf = leafAxisScreen(d);
    return isVertical
      ? { x1: leaf, y1: seg.start, x2: leaf, y2: seg.end }
      : { x1: seg.start, y1: leaf, x2: seg.end, y2: leaf };
  }

  function onPath(d) {
    return currentPathIds.has(d.data.id);
  }
  function dimOpacity(d) {
    return currentPathIds.size && !onPath(d) ? 0.3 : 0.9;
  }

  function restyleAllLinks() {
    descentHaloSel
      .style('display', (d) => (onPath(d) ? null : 'none'));
    // Per-mutation segment COLOR never changes on select/deselect (task
    // requirement: stays colored per mutation even inside the highlighted
    // path) -- only the whole descent's opacity dims when a selection
    // exists and this edge isn't on the path. Setting it once on the outer
    // wrapper <g> (bound to the child node `d`, inherited via .append())
    // dims the segment lines AND their X markers together via normal SVG
    // opacity compositing -- no need to touch individual segments/markers.
    descentSegmentsWrapperSel.attr('opacity', dimOpacity);
    bracketVisibleSel
      .attr('stroke-opacity', bracketBaseOpacity);
    bracketOverlaySel
      .attr('d', bracketOverlayPath)
      .style('display', (d) => (bracketHighlightChild(d) ? null : 'none'));
  }

  function selectNode(d) {
    const newId = d.data.id;
    selectedNodeId = selectedNodeId === newId ? null : newId; // click again to deselect
    recomputePathIds();
    restyleAllLinks();
    circlesSel
      .attr('stroke', circleBaseStroke)
      .attr('stroke-width', circleBaseStrokeWidth)
      .attr('r', circleBaseRadius);

    if (selectedNodeId) {
      showChainForNode(selectedNodeId, treeDonor, TREE_FILES[treeVersion].chains);
    } else {
      showChainPlaceholder();
    }
  }

  function circleBaseStroke(d) {
    return d.data.id === selectedNodeId ? SELECTED_COLOR : 'none';
  }
  function circleBaseStrokeWidth(d) {
    return d.data.id === selectedNodeId ? 2.5 : 0;
  }
  function circleBaseRadius(d) {
    const base = d.data.is_leaf ? 2 : 3;
    return d.data.id === selectedNodeId ? base + 3 : base;
  }
  function nodeHitRadius(d) {
    return d.data.is_leaf ? leafHitRadius : 10;
  }

  const contentLayer = zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // --- Links: one shared, neutral, SINGLE-ROW/COLUMN BRACKET per parent
  // (purely structural -- connects the parent's own depth-position out to
  // each child's leaf-axis position, all at the parent's own fixed depth,
  // so it is never more than one row/column and never represents any
  // mutation itself) + one independent multi-segment DESCENT per child,
  // entirely within that child's own leaf-axis column, subdivided into its
  // own mutation_ids as individually-colored steps. Because each child's
  // descent lives at its own unique leaf-axis position, siblings' descents
  // never share a pixel run with each other -- no draw-order-dependent
  // overwrite is possible, whether the difference is style (the earlier
  // fix) or, now, full per-mutation color. See cmd2607271309/326/1426 chat
  // record for the fuller diagnosis history.
  const bracketParents = root.descendants().filter((d) => d.children && d.children.length);

  function bracketPath(d) {
    const parentDepth = depthScreen(d);
    const parentLeaf = leafAxisScreen(d);
    const childLeaves = d.children.map(leafAxisScreen);
    const lo = Math.min(parentLeaf, ...childLeaves);
    const hi = Math.max(parentLeaf, ...childLeaves);
    return isVertical ? `M${lo},${parentDepth}H${hi}` : `M${parentDepth},${lo}V${hi}`;
  }
  // Single, unambiguous exception to "bracket is neutral": if exactly one of
  // this parent's children sits on the currently-selected chain path, an
  // orange overlay is drawn on top of the neutral bracket spanning from the
  // parent's own leaf-position to THAT child's leaf-position -- there's
  // never more than one such child, so this never reintroduces the
  // multi-sibling overlap ambiguity.
  function bracketHighlightChild(d) {
    return d.children.find((c) => currentPathIds.has(c.data.id)) || null;
  }
  function bracketOverlayPath(d) {
    const child = bracketHighlightChild(d);
    if (!child) return '';
    const parentDepth = depthScreen(d);
    const parentLeaf = leafAxisScreen(d);
    const childLeaf = leafAxisScreen(child);
    return isVertical ? `M${parentLeaf},${parentDepth}H${childLeaf}` : `M${parentDepth},${parentLeaf}V${childLeaf}`;
  }
  function bracketBaseOpacity(d) {
    if (!currentPathIds.size) return 0.8;
    const highlighted = currentPathIds.has(d.data.id) || bracketHighlightChild(d);
    return highlighted ? 0.8 : 0.25;
  }

  const bracketGroupSel = contentLayer.append('g')
    .attr('class', 'brackets')
    .selectAll('g')
    .data(bracketParents)
    .join('g')
    .attr('data-bracket-parent-id', (d) => d.data.id);

  const bracketVisibleSel = bracketGroupSel.append('path')
    .attr('class', 'bracket-visible')
    .attr('fill', 'none')
    .attr('d', bracketPath)
    .attr('stroke', STRUCTURAL_COLOR)
    .attr('stroke-width', 1.2)
    .attr('stroke-opacity', bracketBaseOpacity)
    .style('pointer-events', 'none');

  const bracketOverlaySel = bracketGroupSel.append('path')
    .attr('class', 'bracket-overlay')
    .attr('fill', 'none')
    .attr('d', bracketOverlayPath)
    .attr('stroke', SELECTED_COLOR)
    .attr('stroke-width', 3)
    .style('display', (d) => (bracketHighlightChild(d) ? null : 'none'))
    .style('pointer-events', 'none');

  bracketGroupSel.append('path')
    .attr('class', 'bracket-hit')
    .attr('fill', 'none')
    .attr('d', bracketPath)
    .attr('stroke', 'rgba(0,0,0,0.001)')
    .attr('stroke-width', 12)
    .attr('stroke-linecap', 'round')
    .style('cursor', 'pointer')
    .style('pointer-events', 'stroke')
    .on('mouseenter', function (event, d) {
      d3.select(this.parentNode).select('.bracket-visible')
        .attr('stroke', HOVER_LINK_COLOR).attr('stroke-width', 2).attr('stroke-opacity', 1);
      showTooltip(event, branchTooltipHtml(d));
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', function (event, d) {
      d3.select(this.parentNode).select('.bracket-visible')
        .attr('stroke', STRUCTURAL_COLOR).attr('stroke-width', 1.2).attr('stroke-opacity', bracketBaseOpacity(d));
      hideTooltip();
    })
    .on('click', (event, d) => selectNode(d));

  // Root's own synthetic incoming stub (0 mutations, CAP_PX) -- purely
  // cosmetic (DB3-style short knot before the tree begins), selects the
  // root on click for consistency with everything else being clickable.
  const rootD = root;
  const rootStubCoords = isVertical
    ? { x1: leafAxisScreen(rootD), y1: 0, x2: leafAxisScreen(rootD), y2: rootD.branchPos }
    : { x1: 0, y1: leafAxisScreen(rootD), x2: rootD.branchPos, y2: leafAxisScreen(rootD) };
  const rootStubGroup = contentLayer.append('g').attr('class', 'root-stub');
  rootStubGroup.append('line')
    .attr('class', 'root-stub-visible')
    .attr('x1', rootStubCoords.x1).attr('y1', rootStubCoords.y1)
    .attr('x2', rootStubCoords.x2).attr('y2', rootStubCoords.y2)
    .attr('stroke', STRUCTURAL_COLOR)
    .attr('stroke-width', 1.2)
    .style('pointer-events', 'none');
  rootStubGroup.append('line')
    .attr('x1', rootStubCoords.x1).attr('y1', rootStubCoords.y1)
    .attr('x2', rootStubCoords.x2).attr('y2', rootStubCoords.y2)
    .attr('stroke', 'rgba(0,0,0,0.001)')
    .attr('stroke-width', 12)
    .style('cursor', 'pointer')
    .style('pointer-events', 'stroke')
    .on('click', () => selectNode(rootD));

  const descentDataset = root.descendants().filter((d) => d.parent);

  const descentGroupSel = contentLayer.append('g')
    .attr('class', 'descents')
    .selectAll('g')
    .data(descentDataset)
    .join('g')
    .attr('data-child-id', (d) => d.data.id);

  // Orange halo, drawn BEHIND the per-mutation segments: one full-length
  // line matching the whole descent's span, shown only when this edge is on
  // the selected chain path. Individual mutation colors (blue/gray) still
  // draw on top of it, unchanged -- this is how "stays colored per
  // mutation, but visibly on the selected path" is achieved without forcing
  // segments to the solid highlight color.
  const descentHaloSel = descentGroupSel.append('line')
    .attr('class', 'descent-halo')
    .attr('x1', (d) => segmentCoords(d, { start: d.parent.branchPos, end: d.branchPos }).x1)
    .attr('y1', (d) => segmentCoords(d, { start: d.parent.branchPos, end: d.branchPos }).y1)
    .attr('x2', (d) => segmentCoords(d, { start: d.parent.branchPos, end: d.branchPos }).x2)
    .attr('y2', (d) => segmentCoords(d, { start: d.parent.branchPos, end: d.branchPos }).y2)
    .attr('stroke', SELECTED_COLOR)
    .attr('stroke-width', 6)
    .attr('stroke-linecap', 'round')
    .style('pointer-events', 'none')
    .style('display', (d) => (onPath(d) ? null : 'none'));

  // Outer wrapper's bound datum is `d` (the child node), inherited
  // automatically from descentGroupSel via .append() -- restyleAllLinks()
  // toggles opacity on THIS selection (dimOpacity(d)), which cascades down
  // through every segment + X marker nested inside via normal SVG group
  // compositing, without needing to touch each one individually.
  const descentSegmentsWrapperSel = descentGroupSel.append('g')
    .attr('class', 'descent-segments')
    .style('pointer-events', 'none')
    .attr('opacity', dimOpacity);

  const segmentsSel = descentSegmentsWrapperSel
    .selectAll('g')
    .data((d) => segmentsFor(d).map((seg) => ({ seg, d })))
    .join('g')
    .attr('data-mutation-id', ({ seg }) => seg.mutationId || '');

  // Magenta glow, pre-created hidden (display:none) and toggled on/off by
  // glowSegment()/unglowSegment() during a kidney-panel hover -- cheaper and
  // simpler than creating/destroying elements per hover, and its position
  // in the DOM (inserted before .mut-segment) keeps it rendering BEHIND the
  // segment's own per-mutation color line, never covering it.
  segmentsSel.append('line')
    .attr('class', 'mut-segment-glow')
    .attr('x1', ({ seg, d }) => segmentCoords(d, seg).x1)
    .attr('y1', ({ seg, d }) => segmentCoords(d, seg).y1)
    .attr('x2', ({ seg, d }) => segmentCoords(d, seg).x2)
    .attr('y2', ({ seg, d }) => segmentCoords(d, seg).y2)
    .attr('stroke', PANEL_LINK_COLOR)
    .attr('stroke-width', 13)
    .attr('stroke-linecap', 'round')
    .attr('stroke-opacity', 0.4)
    .style('pointer-events', 'none')
    .style('display', 'none');

  segmentsSel.append('line')
    .attr('class', 'mut-segment')
    .attr('x1', ({ seg, d }) => segmentCoords(d, seg).x1)
    .attr('y1', ({ seg, d }) => segmentCoords(d, seg).y1)
    .attr('x2', ({ seg, d }) => segmentCoords(d, seg).x2)
    .attr('y2', ({ seg, d }) => segmentCoords(d, seg).y2)
    .attr('stroke', ({ seg }) => segmentBaseColor(seg))
    .attr('stroke-width', 2.4)
    .attr('stroke-linecap', 'butt');

  // Gray X centered on every no-TG-data mutation's own segment (one per
  // mutation now, not one per branch tip -- a branch can carry a mix of
  // TG-confirmed and no-TG mutations, each needs its own marker).
  const descentXMarkerSel = segmentsSel.filter(({ seg }) => !seg.isCap && !isTgConfirmed(seg.mutationId))
    .append('g')
    .attr('class', 'mut-x-marker')
    .attr('transform', ({ seg, d }) => {
      const c = segmentCoords(d, seg);
      const mx = (c.x1 + c.x2) / 2;
      const my = (c.y1 + c.y2) / 2;
      return `translate(${mx},${my})`;
    });
  descentXMarkerSel.append('line').attr('x1', -3).attr('y1', -3).attr('x2', 3).attr('y2', 3)
    .attr('stroke', NO_PANEL_X_COLOR).attr('stroke-width', 1.3);
  descentXMarkerSel.append('line').attr('x1', -3).attr('y1', 3).attr('x2', 3).attr('y2', -3)
    .attr('stroke', NO_PANEL_X_COLOR).attr('stroke-width', 1.3);

  descentGroupSel.append('path')
    .attr('class', 'descent-hit')
    .attr('fill', 'none')
    .attr('d', (d) => {
      const c = segmentCoords(d, { start: d.parent.branchPos, end: d.branchPos });
      return `M${c.x1},${c.y1}L${c.x2},${c.y2}`;
    })
    .attr('stroke', 'rgba(0,0,0,0.001)') // effectively invisible, but still hit-testable (same trick as kidneymap.js's dot overlay)
    .attr('stroke-width', 12)
    .attr('stroke-linecap', 'round')
    .style('cursor', 'pointer')
    .style('pointer-events', 'stroke')
    .on('mouseenter', function (event, d) {
      d3.select(this.parentNode).selectAll('.mut-segment').attr('stroke', HOVER_LINK_COLOR);
      showTooltip(event, branchTooltipHtml(d));
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', function (event, d) {
      d3.select(this.parentNode).selectAll('.mut-segment')
        .attr('stroke', function () {
          const segDatum = d3.select(this.parentNode).datum();
          return segmentBaseColor(segDatum.seg);
        });
      hideTooltip();
    })
    .on('click', (event, d) => selectNode(d));

  // Dashed alignment guides: only for leaves whose true branch endpoint
  // isn't already at the alignment line -- a thin dashed segment from the
  // true (unaligned) endpoint out to the aligned tip position, so real
  // branch length stays readable (as guide-line length) while every label
  // still starts at a common x (horizontal) / y (vertical).
  contentLayer.append('g')
    .attr('class', 'guides')
    .attr('fill', 'none')
    .attr('stroke', '#c3cad1')
    .attr('stroke-width', 0.75)
    .attr('stroke-dasharray', '2,2')
    .style('pointer-events', 'none')
    .selectAll('path')
    .data(leaves.filter((d) => Math.abs(screenX(d) - leafScreenX(d)) + Math.abs(screenY(d) - leafScreenY(d)) > 0.5))
    .join('path')
    .attr('d', (d) => `M${screenX(d)},${screenY(d)}L${leafScreenX(d)},${leafScreenY(d)}`);

  const nodeGroup = contentLayer.append('g')
    .attr('class', 'nodes')
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('data-node-id', (d) => d.data.id)
    .attr('transform', (d) => `translate(${nodeScreenX(d)},${nodeScreenY(d)})`);

  // Same visible/hit split as links: a small visible circle (pure
  // decoration) plus a larger invisible one on top carrying all clicks/
  // hover, so leaves (r=2) are still easy to hit precisely.
  const circlesSel = nodeGroup.append('circle')
    .attr('class', 'node-visible')
    .attr('r', circleBaseRadius)
    .attr('fill', (d) => (d.data.is_leaf ? '#9aa5b1' : '#2f6fb0'))
    .attr('stroke', circleBaseStroke)
    .attr('stroke-width', circleBaseStrokeWidth)
    .style('pointer-events', 'none');

  nodeGroup.append('circle')
    .attr('class', 'node-hit')
    .attr('r', nodeHitRadius)
    .attr('fill', 'rgba(0,0,0,0.001)')
    .style('cursor', 'pointer')
    .style('pointer-events', 'all')
    .on('mouseenter', (event, d) => {
      const info = d.data.is_leaf
        ? `<strong>${d.data.leaf_name}</strong><br>depth ${d.depth}`
        : `<strong>internal node</strong><br>depth ${d.depth}, ${d.children ? d.children.length : 0} children`;
      showTooltip(event, info);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip)
    .on('click', (event, d) => selectNode(d));

  const leafLabels = nodeGroup
    .filter((d) => d.data.is_leaf)
    .append('text')
    .attr('class', 'leaf-label')
    .attr('font-size', 7)
    .attr('fill', '#333')
    .text((d) => d.data.leaf_name)
    .style('display', 'none');

  if (isVertical) {
    // leaves hang downward -- rotate labels to read top-to-bottom below each leaf
    leafLabels
      .attr('transform', 'rotate(90)')
      .attr('dx', 5)
      .attr('dy', 3)
      .attr('text-anchor', 'start');
  } else {
    leafLabels
      .attr('dx', 5)
      .attr('dy', 3);
  }

  const labelToggle = document.getElementById('tree-show-labels');
  const wasChecked = labelToggle.checked;
  leafLabels.style('display', wasChecked ? null : 'none');
  labelToggle.onchange = (e) => {
    leafLabels.style('display', e.target.checked ? null : 'none');
  };

  const zoom = d3.zoom()
    .scaleExtent([0.03, 10])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform);
      treeZoomScale = event.transform.k;
    });
  svg.call(zoom);
  currentZoomBehavior = zoom;
  currentSvgSelection = svg;
  // Translate isn't meaningfully portable across an axis swap (a pan offset
  // means something different once x/y trade roles), so only the zoom
  // *scale* is preserved across orientation toggles; the svg's viewBox +
  // 100%/100% CSS size auto-fits/centers the tree at that scale on redraw.
  if (treeZoomScale !== 1) {
    svg.call(zoom.transform, d3.zoomIdentity.scale(treeZoomScale));
  }

  // User-facing summary only -- internal node/leaf/unassigned counts are QA
  // detail, available via the info icon's tooltip + console instead.
  const totalMutations = nodesArr.reduce((sum, n) => sum + n.n_mutations, 0) +
    (data.unassigned_mutation_ids || []).length;
  status.textContent = `${nLeaves} single cells · ${totalMutations} mutations`;

  const unassigned = data.unassigned_mutation_ids || [];
  const qaDetail = `QA detail: ${nodesArr.length} tree nodes, ${nLeaves} leaves` +
    (unassigned.length
      ? `, ${unassigned.length} mutation_ids unassigned to any branch: ${unassigned.join(', ')}`
      : ', 0 unassigned mutation_ids');
  document.getElementById('tree-status-info').setAttribute('title', qaDetail);
  console.log('[tree]', qaDetail);
}

// Kidney-panel-hover cross-column leader line (cmd2607271517) -- these are
// the low-level primitives js/panelhighlight.js orchestrates from; it owns
// the overlay SVG, curve routing and auto-scroll sequencing since those
// span both the tree AND the kidney-panel columns, neither of which tree.js
// has exclusive ownership of. tree.js only knows how to find/glow/pan to
// its own segments. Only takes effect if the mutation's owning node is on
// the currently-selected chain path -- it always should be, since the
// chain panel only ever shows the selected node's own chain, but the guard
// keeps this safe against any future caller that isn't.
function getSegmentElement(mutationId) {
  const nodeId = currentMutationIdToNodeId[mutationId];
  if (!nodeId || !currentPathIds.has(nodeId)) return null;
  const el = document.querySelector(
    `.descents g[data-child-id="${nodeId}"] g[data-mutation-id="${mutationId}"] .mut-segment`
  );
  return el || null;
}

function glowSegment(mutationId) {
  const nodeId = currentMutationIdToNodeId[mutationId];
  if (!nodeId) return;
  const el = document.querySelector(
    `.descents g[data-child-id="${nodeId}"] g[data-mutation-id="${mutationId}"] .mut-segment-glow`
  );
  if (el) el.style.display = null;
}

function unglowSegment(mutationId) {
  const nodeId = currentMutationIdToNodeId[mutationId];
  if (!nodeId) return;
  const el = document.querySelector(
    `.descents g[data-child-id="${nodeId}"] g[data-mutation-id="${mutationId}"] .mut-segment-glow`
  );
  if (el) el.style.display = 'none';
}

// Smoothly pans (never rescales -- keeps whatever zoom level the user is
// currently at) the tree so the target segment's midpoint lands at the
// center of the tree panel's visible viewport. Reads the segment's LOCAL
// (pre-zoom-transform) coordinates straight off its own x1/y1/x2/y2
// attributes, which are stable regardless of the current pan/zoom (only the
// ancestor .zoom-layer's transform changes on pan/zoom, never the
// segment's own attributes). Resolves once the transition completes, or
// resolves immediately (false) if there's nothing to pan to.
function panSegmentIntoView(mutationId) {
  const el = getSegmentElement(mutationId);
  if (!el || !currentZoomBehavior || !currentSvgSelection) return Promise.resolve(false);

  const x1 = parseFloat(el.getAttribute('x1'));
  const y1 = parseFloat(el.getAttribute('y1'));
  const x2 = parseFloat(el.getAttribute('x2'));
  const y2 = parseFloat(el.getAttribute('y2'));
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const svgNode = document.getElementById('tree-svg');
  const w = svgNode.clientWidth;
  const h = svgNode.clientHeight;
  const scale = treeZoomScale || 1;
  const tx = w / 2 - midX * scale;
  const ty = h / 2 - midY * scale;

  return new Promise((resolve) => {
    currentSvgSelection.transition().duration(450)
      .call(currentZoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
      .on('end', () => resolve(true));
  });
}

function setTreeOrientation(orientation) {
  if (orientation === treeOrientation) return;
  treeOrientation = orientation;
  document.getElementById('orient-horizontal').classList.toggle('is-active', orientation === 'horizontal');
  document.getElementById('orient-vertical').classList.toggle('is-active', orientation === 'vertical');
  if (treeLastData) drawTree(treeLastData);
}

document.getElementById('orient-horizontal').addEventListener('click', () => setTreeOrientation('horizontal'));
document.getElementById('orient-vertical').addEventListener('click', () => setTreeOrientation('vertical'));
document.getElementById('version-315').addEventListener('click', () => setTreeVersion('315'));
document.getElementById('version-567').addEventListener('click', () => setTreeVersion('567'));
