// Renders data/<donor>/tree.json as a pannable/zoomable D3 dendrogram.
// tree.json shape: { nodes: { id: {id, is_leaf, leaf_name, parent_id, children, mutation_ids, n_mutations} }, root_id, unassigned_mutation_ids }

let treeOrientation = 'horizontal'; // 'horizontal' | 'vertical'
let treeZoomScale = 1; // preserved across orientation toggles (translate is not, see drawTree)
let treeLastData = null; // cached last-loaded tree.json, so toggling orientation doesn't refetch
let treeDonor = 'DB15'; // set by renderTree(donor); used when a click needs to look up chains.json
let selectedNodeId = null; // click-to-select state, persists across orientation toggles/redraws

const MIN_STUB_PX = 4; // minimum visible branch-segment length, even for 0/1-mutation branches
const SELECTED_COLOR = '#ff6b35';

async function renderTree(donor) {
  const status = document.getElementById('tree-status');
  status.textContent = 'loading…';
  treeDonor = donor;
  selectedNodeId = null; // fresh donor/tree -- any prior selection belongs to a different tree
  if (typeof showChainPlaceholder === 'function') showChainPlaceholder();

  let data;
  try {
    const res = await fetch(`data/${donor}/tree.json`);
    data = await res.json();
  } catch (err) {
    status.textContent = 'failed to load tree.json';
    console.error(err);
    return;
  }

  treeLastData = data;
  drawTree(data);
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

  // Right-angle "elbow" links, drawn to TRUE (unaligned) positions: straight
  // out from the source node along the depth axis to the child's depth,
  // then a single 90-degree turn along the leaf axis into the child's
  // row/column. Orientation only changes which segment (H or V) comes first.
  function linkGen(d) {
    const sx = screenX(d.source);
    const sy = screenY(d.source);
    const tx = screenX(d.target);
    const ty = screenY(d.target);
    return isVertical ? `M${sx},${sy}V${ty}H${tx}` : `M${sx},${sy}H${tx}V${ty}`;
  }

  function linkTooltipHtml(d) {
    const n = d.target.data;
    const ids = n.mutation_ids || [];
    const shown = ids.slice(0, 10).join(', ');
    const more = ids.length > 10 ? ` (+${ids.length - 10} more)` : '';
    return `<strong>${n.n_mutations} mutation${n.n_mutations === 1 ? '' : 's'}</strong> on this branch` +
      (ids.length ? `<br>${shown}${more}` : '');
  }

  // Click-to-select lineage chain highlighting. currentPathIds = set of
  // node ids from root down to the selected node (inclusive), recomputed
  // from THIS render's root each time -- selectedNodeId itself persists
  // across redraws (orientation toggles), but the d3 hierarchy is rebuilt
  // from scratch every drawTree() call, so the id-set can't be cached.
  let currentPathIds = new Set();
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

  function linkBaseStroke(d) {
    return currentPathIds.has(d.target.data.id) ? SELECTED_COLOR : '#8a97a5';
  }
  function linkBaseWidth(d) {
    return currentPathIds.has(d.target.data.id) ? 3 : 1.2;
  }
  function linkBaseOpacity(d) {
    return currentPathIds.size && !currentPathIds.has(d.target.data.id) ? 0.25 : 0.8;
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

  function selectNode(d) {
    const newId = d.data.id;
    selectedNodeId = selectedNodeId === newId ? null : newId; // click again to deselect
    recomputePathIds();

    linksSel
      .attr('stroke', linkBaseStroke)
      .attr('stroke-width', linkBaseWidth)
      .attr('stroke-opacity', linkBaseOpacity);
    circlesSel
      .attr('stroke', circleBaseStroke)
      .attr('stroke-width', circleBaseStrokeWidth)
      .attr('r', circleBaseRadius);

    if (selectedNodeId) {
      showChainForNode(selectedNodeId, treeDonor);
    } else {
      showChainPlaceholder();
    }
  }

  const contentLayer = zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const linksSel = contentLayer.append('g')
    .attr('class', 'links')
    .attr('fill', 'none')
    .attr('stroke-opacity', 0.8)
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('d', linkGen)
    .attr('data-target-id', (d) => d.target.data.id)
    .attr('stroke', linkBaseStroke)
    .attr('stroke-width', linkBaseWidth)
    .attr('stroke-opacity', linkBaseOpacity)
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      d3.select(event.currentTarget).attr('stroke', '#2f6fb0').attr('stroke-width', 2).attr('stroke-opacity', 1);
      showTooltip(event, linkTooltipHtml(d));
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', (event, d) => {
      d3.select(event.currentTarget)
        .attr('stroke', linkBaseStroke(d))
        .attr('stroke-width', linkBaseWidth(d))
        .attr('stroke-opacity', linkBaseOpacity(d));
      hideTooltip();
    })
    .on('click', (event, d) => selectNode(d.target));

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

  const circlesSel = nodeGroup.append('circle')
    .attr('r', circleBaseRadius)
    .attr('fill', (d) => (d.data.is_leaf ? '#9aa5b1' : '#2f6fb0'))
    .attr('stroke', circleBaseStroke)
    .attr('stroke-width', circleBaseStrokeWidth)
    .style('cursor', 'pointer')
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

function setTreeOrientation(orientation) {
  if (orientation === treeOrientation) return;
  treeOrientation = orientation;
  document.getElementById('orient-horizontal').classList.toggle('is-active', orientation === 'horizontal');
  document.getElementById('orient-vertical').classList.toggle('is-active', orientation === 'vertical');
  if (treeLastData) drawTree(treeLastData);
}

document.getElementById('orient-horizontal').addEventListener('click', () => setTreeOrientation('horizontal'));
document.getElementById('orient-vertical').addEventListener('click', () => setTreeOrientation('vertical'));
