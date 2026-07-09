// Renders data/<donor>/tree.json as a pannable/zoomable D3 dendrogram.
// tree.json shape: { nodes: { id: {id, is_leaf, leaf_name, parent_id, children, mutation_ids, n_mutations} }, root_id, unassigned_mutation_ids }

let treeOrientation = 'horizontal'; // 'horizontal' | 'vertical'
let treeZoomScale = 1; // preserved across orientation toggles (translate is not, see drawTree)
let treeLastData = null; // cached last-loaded tree.json, so toggling orientation doesn't refetch

async function renderTree(donor) {
  const status = document.getElementById('tree-status');
  status.textContent = 'loading…';

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
  // length). Branch-length (depth) position is computed separately as
  // cumulative n_mutations from the root -- true phylogram, not uniform
  // per-depth spacing. Stored as d.branchPos to avoid clashing with d3's
  // own d.x/d.y, which we remap per-orientation below.
  const leafAxisPx = Math.max(400, nLeaves * leafSpacing);
  const cluster = d3.cluster().size([leafAxisPx, 1]);
  cluster(root);

  root.eachBefore((d) => {
    d.cumLen = d.parent ? d.parent.cumLen + (d.data.n_mutations || 0) : 0;
  });
  const maxCumLen = d3.max(root.descendants(), (d) => d.cumLen) || 1;
  const depthAxisPx = Math.max(400, maxCumLen * pxPerMutation);
  const branchScale = d3.scaleLinear().domain([0, maxCumLen]).range([0, depthAxisPx]);
  root.each((d) => { d.branchPos = branchScale(d.cumLen); });

  // screen-x/screen-y accessors: horizontal = root-left/leaves-right (depth
  // -> x, leaf -> y); vertical = root-top/leaves-bottom (leaf -> x, depth -> y).
  const screenX = isVertical ? (d) => d.x : (d) => d.branchPos;
  const screenY = isVertical ? (d) => d.branchPos : (d) => d.x;

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

  // Right-angle "elbow" links: straight out from the source node along the
  // depth axis to the child's depth, then a single 90-degree turn along the
  // leaf axis into the child's row/column. Orientation only changes which
  // segment (H or V) comes first.
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

  zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('fill', 'none')
    .attr('stroke', '#8a97a5')
    .attr('stroke-opacity', 0.8)
    .attr('stroke-width', 1.2)
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('d', linkGen)
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      d3.select(event.currentTarget).attr('stroke', '#2f6fb0').attr('stroke-width', 2);
      showTooltip(event, linkTooltipHtml(d));
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).attr('stroke', '#8a97a5').attr('stroke-width', 1.2);
      hideTooltip();
    });

  const nodeGroup = zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('transform', (d) => `translate(${screenX(d)},${screenY(d)})`);

  nodeGroup.append('circle')
    .attr('r', (d) => (d.data.is_leaf ? 2 : 3))
    .attr('fill', (d) => (d.data.is_leaf ? '#9aa5b1' : '#2f6fb0'))
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const info = d.data.is_leaf
        ? `<strong>${d.data.leaf_name}</strong><br>depth ${d.depth}`
        : `<strong>internal node</strong><br>depth ${d.depth}, ${d.children ? d.children.length : 0} children`;
      showTooltip(event, info);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', hideTooltip);

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
  // detail, moved to the info icon's tooltip + console instead of the
  // main status line.
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
