// Renders a kidney VAF map for a single mutation_id: the pre-baked PNG
// (data/<donor>/kidney_vaf_maps/<mutation_id>.png -- colors, legend, kidney
// outline all already rendered server-side, never recomputed here) as the
// base layer, with a set of invisible hoverable <circle> overlays -- one
// per (sample_id, kidney) site -- positioned via an empirically-calibrated
// affine transform (data/<donor>/kidney_map_transform.json) so they land
// exactly on the painted dots underneath.
//
// The transform was derived once in scripts/calibrate_kidney_overlay.py by
// rendering known reference points through the *exact* same matplotlib
// pipeline (same crop bbox, same gridspec, same bbox_inches='tight' save)
// as scripts/render_kidney_vaf_maps.py and detecting their pixel centroids
// -- not re-derived analytically, since bbox_inches='tight' crops to an
// unpredictable content bbox. All 314 PNGs share identical geometry (only
// dot colors differ per mutation), so one calibration covers every one.

const kidneyMapCache = {}; // donor -> { transform, longRowsByMutation }

async function loadKidneyMapData(donor) {
  if (kidneyMapCache[donor]) return kidneyMapCache[donor];

  const [transform, longRows] = await Promise.all([
    fetch(`data/${donor}/kidney_map_transform.json`).then((r) => r.json()),
    fetch(`data/${donor}/kidney_vaf_long.json`).then((r) => r.json()),
  ]);

  const byMutation = {};
  for (const row of longRows) {
    (byMutation[row.mutation_id] ||= []).push(row);
  }

  const entry = { transform, byMutation };
  kidneyMapCache[donor] = entry;
  return entry;
}

function toPixel(transform, kidney, x, y) {
  const t = transform[kidney];
  return {
    px: t.scale_x * x + t.offset_x,
    py: t.scale_y * y + t.offset_y,
  };
}

/**
 * Render a kidney VAF map for one mutation into `container` (any DOM element).
 * Clears and replaces the container's contents on each call.
 */
async function renderKidneyMap(container, mutationId, donor = 'DB15') {
  container.innerHTML = '<p class="status">loading…</p>';

  let data;
  try {
    data = await loadKidneyMapData(donor);
  } catch (err) {
    container.innerHTML = '<p class="status">failed to load kidney map data</p>';
    console.error(err);
    return;
  }

  const { transform, byMutation } = data;
  const points = byMutation[mutationId] || [];
  if (points.length === 0) {
    container.innerHTML = `<p class="status">no kidney data for ${mutationId} (mutation not in kidney panel, or all-zero VAF -- image was skipped at render time)</p>`;
    return;
  }

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'kidneymap-wrap';
  container.appendChild(wrap);

  const img = document.createElement('img');
  img.className = 'kidneymap-img';
  img.src = `data/${donor}/kidney_vaf_maps/${mutationId}.png`;
  img.alt = `Kidney VAF map for ${mutationId}`;
  wrap.appendChild(img);

  await new Promise((resolve, reject) => {
    if (img.complete) return resolve();
    img.onload = resolve;
    img.onerror = () => reject(new Error(`image failed to load: ${img.src}`));
  }).catch((err) => {
    console.error(err);
  });

  const w = transform.png_width;
  const h = transform.png_height;

  const svg = d3.select(wrap)
    .append('svg')
    .attr('class', 'kidneymap-overlay')
    .attr('viewBox', `0 0 ${w} ${h}`);

  const tooltip = d3.select(wrap)
    .append('div')
    .attr('class', 'kidneymap-tooltip')
    .style('display', 'none');

  function showTooltip(event, p) {
    tooltip
      .style('display', 'block')
      .html(
        `<strong>${p.sample_id}</strong> (${p.kidney})<br>` +
        `compartment: ${p.compartment}<br>` +
        `VAF: ${p.vaf}`
      );
    moveTooltip(event);
  }
  function moveTooltip(event) {
    const rect = wrap.getBoundingClientRect();
    tooltip
      .style('left', `${event.clientX - rect.left + 12}px`)
      .style('top', `${event.clientY - rect.top + 12}px`);
  }
  function hideTooltip() {
    tooltip.style('display', 'none');
  }

  svg.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', (p) => toPixel(transform, p.kidney, p.x, p.y).px)
    .attr('cy', (p) => toPixel(transform, p.kidney, p.x, p.y).py)
    .attr('r', 8)
    .attr('fill', 'rgba(0,0,0,0.001)') // effectively invisible, but still hit-testable
    .attr('stroke', 'none')
    .style('pointer-events', 'all')
    .style('cursor', 'pointer')
    .on('mouseenter', function (event, p) {
      d3.select(this).attr('stroke', '#ff2d6f').attr('stroke-width', 2).attr('fill', 'rgba(255,45,111,0.12)');
      showTooltip(event, p);
    })
    .on('mousemove', moveTooltip)
    .on('mouseleave', function () {
      d3.select(this).attr('stroke', 'none').attr('fill', 'rgba(0,0,0,0.001)');
      hideTooltip();
    });
}
