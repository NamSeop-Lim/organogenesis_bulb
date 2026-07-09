// Renders data/<donor>/singlecell_heatmap.json as a canvas heatmap
// (rows = mutation_ids order, cols = sample_ids order, both preserved
// as-is -- row/col order is load-bearing per CLAUDE.md) plus a thin
// L1/L2 lineage color strip above the columns. Pannable/zoomable via
// d3-zoom applied as a CSS transform on the wrapping layer.
async function renderHeatmap(donor) {
  const status = document.getElementById('heatmap-status');
  status.textContent = 'loading…';

  let data;
  try {
    const res = await fetch(`data/${donor}/singlecell_heatmap.json`);
    data = await res.json();
  } catch (err) {
    status.textContent = 'failed to load singlecell_heatmap.json';
    console.error(err);
    return;
  }

  const { mutation_ids, sample_ids, vaf_matrix, lineage } = data;
  const nRows = mutation_ids.length;
  const nCols = sample_ids.length;

  const cellW = 4;
  const cellH = 4;
  const stripH = 12;
  const stripGap = 2;
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.getElementById('heatmap-canvas');
  const strip = document.getElementById('lineage-strip');
  const zoomLayer = document.getElementById('heatmap-zoom-layer');

  const pixelW = nCols * cellW;
  const pixelH = nRows * cellH;

  canvas.width = Math.round(pixelW * dpr);
  canvas.height = Math.round(pixelH * dpr);
  canvas.style.width = `${pixelW}px`;
  canvas.style.height = `${pixelH}px`;
  canvas.style.position = 'absolute';
  canvas.style.left = '0px';
  canvas.style.top = `${stripH + stripGap}px`;

  strip.width = Math.round(pixelW * dpr);
  strip.height = Math.round(stripH * dpr);
  strip.style.width = `${pixelW}px`;
  strip.style.height = `${stripH}px`;
  strip.style.position = 'absolute';
  strip.style.left = '0px';
  strip.style.top = '0px';

  zoomLayer.style.width = `${pixelW}px`;
  zoomLayer.style.height = `${stripH + stripGap + pixelH}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const color = d3.scaleSequential(d3.interpolateYlGnBu).domain([0, 1]);

  for (let r = 0; r < nRows; r++) {
    const row = vaf_matrix[r];
    for (let c = 0; c < nCols; c++) {
      ctx.fillStyle = color(row[c]);
      ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
    }
  }

  const sctx = strip.getContext('2d');
  sctx.scale(dpr, dpr);
  const lineageColor = { L1: '#3b7dd8', L2: '#e08214' };
  for (let c = 0; c < nCols; c++) {
    sctx.fillStyle = lineageColor[lineage[c]] || '#cccccc';
    sctx.fillRect(c * cellW, 0, cellW, stripH);
  }

  const scrollEl = d3.select('#heatmap-scroll');
  const zoom = d3.zoom()
    .scaleExtent([0.15, 25])
    .on('zoom', (event) => {
      zoomLayer.style.transform =
        `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
    });
  scrollEl.call(zoom);
  scrollEl.call(zoom.transform, d3.zoomIdentity);

  status.textContent = `${nRows} mutations × ${nCols} samples`;
}
