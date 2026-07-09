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
  const maxDepth = root.height;

  const leafSpacing = 9; // px between adjacent leaves
  const depthSpacing = 70; // px per tree-depth level
  const margin = { top: 20, left: 90, right: 40, bottom: 20 };

  const innerHeight = Math.max(400, nLeaves * leafSpacing);
  const innerWidth = Math.max(600, maxDepth * depthSpacing);

  const cluster = d3.cluster().size([innerHeight, innerWidth]);
  cluster(root);

  const totalWidth = innerWidth + margin.left + margin.right;
  const totalHeight = innerHeight + margin.top + margin.bottom;
  svg.attr('viewBox', [0, 0, totalWidth, totalHeight]);

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');

  const maxMut = d3.max(nodesArr, (d) => d.n_mutations) || 1;
  const strokeScale = d3.scaleSqrt().domain([0, maxMut]).range([0.6, 9]);

  const linkGen = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

  zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('fill', 'none')
    .attr('stroke', '#8a97a5')
    .attr('stroke-opacity', 0.8)
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('d', linkGen)
    .attr('stroke-width', (d) => strokeScale(d.target.data.n_mutations || 0));

  const nodeGroup = zoomLayer.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('transform', (d) => `translate(${d.y},${d.x})`);

  nodeGroup.append('circle')
    .attr('r', (d) => (d.data.is_leaf ? 2 : Math.min(7, 2 + Math.sqrt(d.data.n_mutations || 0))))
    .attr('fill', (d) => (d.data.is_leaf ? '#9aa5b1' : '#2f6fb0'))
    .append('title')
    .text((d) => (d.data.is_leaf ? d.data.leaf_name : `${d.data.n_mutations} mutation(s) on this branch`));

  // n_mutations numeric label on internal nodes that carry mutations
  nodeGroup
    .filter((d) => !d.data.is_leaf && d.data.n_mutations > 0)
    .append('text')
    .attr('dx', -6)
    .attr('dy', -6)
    .attr('text-anchor', 'end')
    .attr('font-size', 9)
    .attr('fill', '#4a5568')
    .text((d) => d.data.n_mutations);

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
