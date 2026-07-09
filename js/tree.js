// Renders data/<donor>/tree.json as a pannable/zoomable D3 dendrogram.
// tree.json shape: { nodes: { id: {id, is_leaf, leaf_name, parent_id, children, mutation_ids, n_mutations} }, root_id, unassigned_mutation_ids }
async function renderTree(donor) {
  const status = document.getElementById('tree-status');
  const svg = d3.select('#tree-svg');
  svg.selectAll('*').remove();
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

  const nodesArr = Object.values(data.nodes);

  // d3.stratify wants parentId(root) === undefined/null, which matches our schema directly.
  const root = d3.stratify()
    .id((d) => d.id)
    .parentId((d) => d.parent_id)(nodesArr);

  const leaves = root.leaves();
  const nLeaves = leaves.length;

  const leafSpacing = 9; // px between adjacent leaves
  const margin = { top: 20, left: 90, right: 40, bottom: 20 };

  const innerHeight = Math.max(400, nLeaves * leafSpacing);

  // Leaf ordering / vertical (x) position still comes from d3.cluster() --
  // that part is unrelated to branch length. Its depth-based y is then
  // discarded and replaced below with a true phylogram: horizontal (y)
  // position = cumulative n_mutations (branch length) from the root, so
  // branch length is the single visual encoding of mutation count instead
  // of three redundant ones.
  const cluster = d3.cluster().size([innerHeight, 1]);
  cluster(root);

  root.eachBefore((d) => {
    d.cumLen = d.parent ? d.parent.cumLen + (d.data.n_mutations || 0) : 0;
  });
  const maxCumLen = d3.max(root.descendants(), (d) => d.cumLen) || 1;
  const pxPerMutation = 8;
  const innerWidth = Math.max(500, maxCumLen * pxPerMutation);
  const branchScale = d3.scaleLinear().domain([0, maxCumLen]).range([0, innerWidth]);
  root.each((d) => { d.y = branchScale(d.cumLen); });

  const totalWidth = innerWidth + margin.left + margin.right;
  const totalHeight = innerHeight + margin.top + margin.bottom;
  svg.attr('viewBox', [0, 0, totalWidth, totalHeight]);

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

  // Shared hover tooltip (used by both links and nodes) instead of the old
  // always-on numeric label -- info is still available, just on demand.
  const tooltip = d3.select('#tree-panel')
    .selectAll('.tree-tooltip')
    .data([null])
    .join('div')
    .attr('class', 'tree-tooltip')
    .style('display', 'none');

  function showTooltip(event, html) {
    tooltip
      .style('display', 'block')
      .html(html);
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

  // Right-angle "elbow" links (cladogram/phylogram convention) instead of
  // d3.linkHorizontal()'s smooth Bezier curves: straight out from the
  // source node along its row, then a single 90-degree turn down/up into
  // the child's row. Screen-x is depth (d.y), screen-y is leaf position
  // (d.x).
  const linkGen = (d) =>
    `M${d.source.y},${d.source.x}H${d.target.y}V${d.target.x}`;

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
    .attr('transform', (d) => `translate(${d.y},${d.x})`);

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
    .attr('dx', 5)
    .attr('dy', 3)
    .attr('font-size', 7)
    .attr('fill', '#333')
    .text((d) => d.data.leaf_name)
    .style('display', 'none');

  const labelToggle = document.getElementById('tree-show-labels');
  labelToggle.checked = false;
  labelToggle.onchange = (e) => {
    leafLabels.style('display', e.target.checked ? null : 'none');
  };

  const zoom = d3.zoom()
    .scaleExtent([0.03, 10])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform);
    });
  svg.call(zoom);
  // No initial zoom.transform call: the svg's viewBox + 100%/100% CSS size
  // already auto-fits the whole tree into the panel on first paint (native
  // preserveAspectRatio behavior). d3-zoom's identity default composes with
  // that correctly; explicitly setting a transform here would scale the
  // zoom-layer about (0,0) and fight the viewBox fit instead of matching it.

  const unassigned = data.unassigned_mutation_ids || [];
  status.textContent = `${nodesArr.length} nodes, ${nLeaves} leaves` +
    (unassigned.length ? ` (${unassigned.length} mutation_ids unassigned to any branch)` : '');
}
