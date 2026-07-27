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

function noDataPlaceholder(container, message) {
  container.innerHTML = `<div class="chain-entry-nodata">${message}</div>`;
}

/**
 * Render a kidney VAF map for one mutation into `container` (any DOM element).
 * Clears and replaces the container's contents on each call.
 * Returns true if a real map (image + hoverable overlay) was rendered, false
 * if a "no spatial data" placeholder was shown instead -- callers (chainpanel.js)
 * use this to decide whether to wire up the kidney-panel-hover tree-segment
 * highlight (only meaningful when there's an actual panel to hover).
 */
async function renderKidneyMap(container, mutationId, donor = 'DB15') {
  container.innerHTML = '<p class="status">loading…</p>';

  let data;
  try {
    data = await loadKidneyMapData(donor);
  } catch (err) {
    container.innerHTML = '<p class="status">failed to load kidney map data</p>';
    console.error(err);
    return false;
  }

  const { transform, byMutation } = data;
  const points = byMutation[mutationId] || [];
  if (points.length === 0) {
    // Not in kidney_vaf_long.json at all -- either a 567-tree no-TG-data
    // mutation (never target-seq'd) or, on 315, genuinely absent (shouldn't
    // happen there). No PNG was ever generated for this id -- don't attempt
    // to fetch one.
    noDataPlaceholder(container, `no spatial data<br>(${mutationId} not in the 315 kidney target-seq panel)`);
    return false;
  }
  if (points.every((p) => p.vaf === 0)) {
    // All-zero VAF across every kidney sample -- render_kidney_vaf_maps.py
    // skips generating a PNG for these (e.g. ('18', 54788409)), so a real
    // in-panel mutation can still have no image. Same placeholder, worded
    // for this case specifically -- caught here BEFORE creating the <img>
    // tag, so this never causes a 404 either.
    noDataPlaceholder(container, `no spatial data<br>(${mutationId} is all-zero VAF -- map was skipped at render time)`);
    return false;
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

  const loaded = await new Promise((resolve) => {
    if (img.complete) return resolve(true);
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  if (!loaded) {
    // Defensive fallback for any PNG missing for a reason the two checks
    // above didn't anticipate -- degrade to the same placeholder rather
    // than leaving a broken-image icon on screen.
    console.error(new Error(`image failed to load: ${img.src}`));
    noDataPlaceholder(container, `no spatial data<br>(${mutationId} image failed to load)`);
    return false;
  }

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

  function readSupportHtml(p) {
    // depth/alt_read_count are only absent for data predating the cmd11
    // enrichment -- shouldn't happen post-regeneration, but degrade quietly
    // rather than print "undefined" if it ever does.
    if (p.depth === null || p.depth === undefined || p.alt_read_count === null || p.alt_read_count === undefined) {
      return '';
    }
    if (p.depth === 0) {
      return ' <span class="vaf-readsupport">(no read coverage)</span>';
    }
    return ` <span class="vaf-readsupport">(${p.alt_read_count} alt / ${p.depth} depth)</span>`;
  }

  function showTooltip(event, p) {
    tooltip
      .style('display', 'block')
      .html(
        `<strong>${p.sample_id}</strong> (${p.kidney})<br>` +
        `compartment: ${p.compartment}<br>` +
        `VAF: ${p.vaf}${readSupportHtml(p)}`
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

  return true;
}
