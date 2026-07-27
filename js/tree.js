// Renders data/<donor>/tree.json (or tree_full.json) as a pannable/zoomable
// D3 dendrogram. tree.json shape: { nodes: { id: {id, is_leaf, leaf_name,
// parent_id, children, mutation_ids, n_mutations} }, root_id,
// unassigned_mutation_ids, panel_mutation_ids? }. panel_mutation_ids is only
// present on tree_full.json (the 567-mutation full-resolution tree) --
// tree.json (315, TG-panel-confirmed) omits it since every mutation there
// already has kidney VAF data by construction.

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
let currentNodeStyleById = {}; // nodeId -> { panelStyle: 'in_panel'|'no_panel'|'neutral' }

const TREE_FILES = {
  315: { tree: 'tree.json', chains: 'chains.json' },
  567: { tree: 'tree_full.json', chains: 'chains_full.json' },
};

const MIN_STUB_PX = 4; // minimum visible branch-segment length, even for 0/1-mutation branches
const SELECTED_COLOR = '#ff6b35';
const DEFAULT_LINK_COLOR = '#8a97a5';
const HOVER_LINK_COLOR = '#2f6fb0';
const NO_PANEL_COLOR = '#b7bfc7'; // muted -- dashed no-TG-data branches (567 only)
const NO_PANEL_X_COLOR = '#e02020'; // reuses the .vaf-legend-absent-x convention
const SUPER_HIGHLIGHT_COLOR = '#c2185b'; // kidney-panel-hover second-level accent -- reads clearly against SELECTED_COLOR orange

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

  // d3.stratify wants parentId(root) === undefined/null, which matches our schema directly.
  const root = d3.stratify()
    .id((d) => d.id)
    .parentId((d) => d.parent_id)(nodesArr);

  const leaves = root.leaves();
  const nLeaves = leaves.length;

  const leafSpacing = 9; // px between adjacent leaves, along the leaf axis
  const pxPerMutation = 8; // px per mutation, along the branch-length axis

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

  // Branch-length (depth) position: true phylogram, cumulative n_mutations
  // from the root, then floored so every branch segment -- even a 0- or
  // 1-mutation one -- is at least MIN_STUB_PX long and visually distinct.
  // Must run parent-before-child (eachBefore) since a floored parent
  // position can itself push a child's floor further out.
  root.eachBefore((d) => {
    d.cumLen = d.parent ? d.parent.cumLen + (d.data.n_mutations || 0) : 0;
  });
  const maxCumLen = d3.max(root.descendants(), (d) => d.cumLen) || 1;
  const targetDepthAxisPx = Math.max(400, maxCumLen * pxPerMutation);
  const branchScale = d3.scaleLinear().domain([0, maxCumLen]).range([0, targetDepthAxisPx]);
  root.eachBefore((d) => {
    const raw = branchScale(d.cumLen);
    d.branchPos = d.parent ? Math.max(raw, d.parent.branchPos + MIN_STUB_PX) : 0;
  });
  // Actual depth extent after flooring can exceed the original target
  // (long chains of near-zero branches each add MIN_STUB_PX), so the
  // alignment coordinate + viewBox use the real max, not the estimate.
  const depthAxisPx = d3.max(root.descendants(), (d) => d.branchPos);

  // screen-x/screen-y accessors for TRUE (unaligned) branch-endpoint
  // position: horizontal = root-left/leaves-right (depth -> x, leaf -> y);
  // vertical = root-top/leaves-bottom (leaf -> x, depth -> y).
  const screenX = isVertical ? (d) => d.x : (d) => d.branchPos;
  const screenY = isVertical ? (d) => d.branchPos : (d) => d.x;
  // depth-axis / leaf-axis screen coordinate, orientation-independent --
  // used by the bracket/peel-off link geometry below.
  const depthScreen = isVertical ? screenY : screenX;

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

  // Panel-membership style for a node's OWN branch (its mutation_ids, not
  // its chain): 'in_panel' (>=1 own mutation has kidney VAF data), 'no_panel'
  // (own mutations exist, none in-panel -- 567 only), 'neutral' (0 own
  // mutations, e.g. many pass-through/multifurcation nodes -- nothing to
  // flag either way). On the 315 tree panelIds is null, so every branch with
  // mutations reads as 'in_panel' -- no dashed styling there, by design.
  function branchPanelStyle(d) {
    const muts = d.data.mutation_ids || [];
    if (!panelIds) return muts.length ? 'in_panel' : 'neutral';
    if (!muts.length) return 'neutral';
    return muts.some((m) => panelIds.has(m)) ? 'in_panel' : 'no_panel';
  }

  // mutation_id -> node id (the node that OWNS this mutation on its own
  // branch), rebuilt every draw -- exposed at module level for chainpanel.js
  // kidney-panel-hover -> tree-segment lookups.
  currentMutationIdToNodeId = {};
  currentNodeStyleById = {};
  root.descendants().forEach((d) => {
    const style = branchPanelStyle(d);
    currentNodeStyleById[d.data.id] = style;
    (d.data.mutation_ids || []).forEach((m) => { currentMutationIdToNodeId[m] = d.data.id; });
  });

  function peeloffBaseStroke(d) {
    if (currentPathIds.has(d.data.id)) return SELECTED_COLOR;
    const style = currentNodeStyleById[d.data.id];
    return style === 'no_panel' ? NO_PANEL_COLOR : DEFAULT_LINK_COLOR;
  }
  function peeloffBaseWidth(d) {
    return currentPathIds.has(d.data.id) ? 3 : 1.2;
  }
  function peeloffBaseOpacity(d) {
    return currentPathIds.size && !currentPathIds.has(d.data.id) ? 0.25 : 0.8;
  }
  function peeloffDashArray(d) {
    return currentNodeStyleById[d.data.id] === 'no_panel' ? '4,3' : null;
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

  function restyleAllLinks() {
    peeloffVisibleSel
      .attr('stroke', peeloffBaseStroke)
      .attr('stroke-width', peeloffBaseWidth)
      .attr('stroke-opacity', peeloffBaseOpacity)
      .attr('stroke-dasharray', peeloffDashArray);
    peeloffXMarkerSel
      .attr('opacity', (d) => (currentNodeStyleById[d.data.id] === 'no_panel'
        ? (currentPathIds.size && !currentPathIds.has(d.data.id) ? 0.35 : 1) : 0));
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

  const contentLayer = zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // --- Links, drawn as one shared BRACKET per parent + one HORIZONTAL/
  // VERTICAL (orientation-dependent) PEEL-OFF per child -- NOT one
  // independent full elbow per child. Each child's own vertical+horizontal
  // elbow used to be drawn as its own separate path from the parent's exact
  // position; siblings at different depths made those paths overlap along
  // the shared trunk, and whichever sibling was drawn last in DOM order
  // visually overwrote the others there -- harmless while every branch
  // shared one style, but it silently corrupts a differently-styled
  // sibling's apparent line style the moment two different styles (solid
  // in-panel vs dashed no-panel) meet on that shared stretch. Fixed by
  // drawing the shared trunk exactly once, in a neutral style owned by no
  // child, and giving each child only its own short peel-off segment (which
  // never overlaps a sibling's, since peel-offs sit at different depths and
  // never share the same run) in that child's own style. See the
  // cmd2607271309/cmd2607271326 chat record for the full diagnosis --
  // validated first in lineage_bulb/db15/scripts/preview_frontend_tree.py.
  const bracketParents = root.descendants().filter((d) => d.children && d.children.length);

  function bracketMaxChildDepth(d) {
    return d3.max(d.children, depthScreen);
  }
  function bracketPath(d) {
    const px = screenX(d);
    const py = screenY(d);
    const maxDepth = bracketMaxChildDepth(d);
    return isVertical ? `M${px},${py}V${maxDepth}` : `M${px},${py}H${maxDepth}`;
  }
  // Single, unambiguous exception to "bracket is neutral": if exactly one of
  // this parent's children sits on the currently-selected chain path, an
  // orange overlay is drawn on top of the neutral bracket from the parent's
  // own depth to THAT child's depth -- there's never more than one such
  // child, so this never reintroduces the multi-sibling style-overlap bug.
  function bracketHighlightChild(d) {
    return d.children.find((c) => currentPathIds.has(c.data.id)) || null;
  }
  function bracketOverlayPath(d) {
    const child = bracketHighlightChild(d);
    if (!child) return '';
    const px = screenX(d);
    const py = screenY(d);
    const depth = depthScreen(child);
    return isVertical ? `M${px},${py}V${depth}` : `M${px},${py}H${depth}`;
  }
  function bracketBaseOpacity(d) {
    if (!currentPathIds.size) return 0.8;
    const onPath = currentPathIds.has(d.data.id) || bracketHighlightChild(d);
    return onPath ? 0.8 : 0.25;
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
    .attr('stroke', DEFAULT_LINK_COLOR)
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
    .on('mouseleave', function () {
      d3.select(this.parentNode).select('.bracket-visible')
        .attr('stroke', DEFAULT_LINK_COLOR).attr('stroke-width', 1.2).attr('stroke-opacity', bracketBaseOpacity);
      hideTooltip();
    })
    .on('click', (event, d) => selectNode(d));

  function peeloffPath(d) {
    const px = screenX(d.parent);
    const py = screenY(d.parent);
    const cx = screenX(d);
    const cy = screenY(d);
    return isVertical ? `M${px},${cy}H${cx}` : `M${cx},${py}V${cy}`;
  }

  const peeloffGroupSel = contentLayer.append('g')
    .attr('class', 'peeloffs')
    .selectAll('g')
    .data(root.descendants().filter((d) => d.parent))
    .join('g')
    .attr('data-child-id', (d) => d.data.id);

  const peeloffVisibleSel = peeloffGroupSel.append('path')
    .attr('class', 'link-peeloff')
    .attr('fill', 'none')
    .attr('d', peeloffPath)
    .attr('stroke', peeloffBaseStroke)
    .attr('stroke-width', peeloffBaseWidth)
    .attr('stroke-opacity', peeloffBaseOpacity)
    .attr('stroke-dasharray', peeloffDashArray)
    .style('pointer-events', 'none');

  // Small red X at the tip of every no-TG-data branch (567 only; null-style
  // on 315 since panelIds is null there) -- reuses the .vaf-legend-absent-x
  // red (#e02020) for visual-language consistency with the kidney-map panel.
  const peeloffXMarkerSel = peeloffGroupSel.append('g')
    .attr('class', 'link-peeloff-x')
    .attr('transform', (d) => `translate(${screenX(d)},${screenY(d)})`)
    .style('pointer-events', 'none')
    .attr('opacity', (d) => (currentNodeStyleById[d.data.id] === 'no_panel'
      ? (currentPathIds.size && !currentPathIds.has(d.data.id) ? 0.35 : 1) : 0));
  peeloffXMarkerSel.append('line').attr('x1', -3).attr('y1', -3).attr('x2', 3).attr('y2', 3)
    .attr('stroke', NO_PANEL_X_COLOR).attr('stroke-width', 1.3);
  peeloffXMarkerSel.append('line').attr('x1', -3).attr('y1', 3).attr('x2', 3).attr('y2', -3)
    .attr('stroke', NO_PANEL_X_COLOR).attr('stroke-width', 1.3);

  peeloffGroupSel.append('path')
    .attr('class', 'link-peeloff-hit')
    .attr('fill', 'none')
    .attr('d', peeloffPath)
    .attr('stroke', 'rgba(0,0,0,0.001)') // effectively invisible, but still hit-testable (same trick as kidneymap.js's dot overlay)
    .attr('stroke-width', 12)
    .attr('stroke-linecap', 'round')
    .style('cursor', 'pointer')
    .style('pointer-events', 'stroke')
    .on('mouseenter', function (event, d) {
      d3.select(this.parentNode).select('.link-peeloff')
        .attr('stroke', HOVER_LINK_COLOR).attr('stroke-width', 2).attr('stroke-opacity', 1);
      showTooltip(event, branchTooltipHtml(d));
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', function (event, d) {
      d3.select(this.parentNode).select('.link-peeloff')
        .attr('stroke', peeloffBaseStroke(d)).attr('stroke-width', peeloffBaseWidth(d)).attr('stroke-opacity', peeloffBaseOpacity(d));
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

// Kidney-panel-hover -> tree-segment second-level highlight. Called from
// chainpanel.js when the user hovers an in-panel mutation's kidney-map card
// (only ever attached there -- no-TG-data placeholder cards have no panel to
// hover, so chainpanel.js never calls this for those). Only takes effect if
// the mutation's owning node is actually on the currently-selected chain
// path -- it always should be, since the chain panel only ever shows the
// selected node's own chain, but the guard keeps this safe against any
// future caller that isn't.
function highlightChainSegment(mutationId) {
  const nodeId = currentMutationIdToNodeId[mutationId];
  if (!nodeId || !currentPathIds.has(nodeId)) return;
  d3.select(`.peeloffs g[data-child-id="${nodeId}"] .link-peeloff`)
    .attr('stroke', SUPER_HIGHLIGHT_COLOR)
    .attr('stroke-width', 5);
}

function clearChainSegmentHighlight(mutationId) {
  const nodeId = currentMutationIdToNodeId[mutationId];
  if (!nodeId) return;
  const sel = d3.select(`.peeloffs g[data-child-id="${nodeId}"] .link-peeloff`);
  if (sel.empty()) return;
  // Revert to the normal on-path selected style (this is only ever called
  // for segments that were on the path to begin with).
  sel.attr('stroke', SELECTED_COLOR).attr('stroke-width', 3);
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
