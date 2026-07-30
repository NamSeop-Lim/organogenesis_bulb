// cmd2607271718: renders a kidney VAF map for a single mutation_id as two
// LIVE svg panels (right + left), each the plain dot-free template
// (data/<donor>/templates/{right,left}_kidney_template.svg, embedded
// read-only via <image href>) with sample dots drawn dynamically on top --
// replaces the earlier pre-baked-PNG-plus-invisible-overlay approach, which
// is what made compartment show/hide filtering possible in the first place
// (a baked PNG has no per-dot DOM to hide).
//
// Dot placement needs NO transform: kidney_vaf_long.json's x/y are the raw
// kidney_package digitization coordinates, and data/<donor>/templates/*.svg
// are byte-identical to the plain template that digitization was done
// against -- verified empirically (cmd2607271718 inspection step) by
// plotting real coordinates straight onto the plain template and confirming
// they land on the correct anatomical structures. kidney_map_transform.json
// (scale/offset into the OLD baked-PNG's cropped pixel space, a DIFFERENT,
// PI-redrawn "_final" template lineage) is unrelated and no longer used.
//
// cmd2607301542 Part 2: made organ-aware. `currentOrgan` (default 'kidney')
// picks which entry of ORGAN_VISUALS supplies the per-template crop/SVG/
// dimensions and which compartment table (if any) applies; manifest.json
// supplies the template id/label list and compartment key list per organ so
// a new organ (e.g. liver, 1 template, no compartments) is one manifest
// entry + one ORGAN_VISUALS entry, not a rewrite of the render loop.

const kidneyMapCache = {}; // `${donor}:${organ}` -> byMutation index (mutation_id -> point[])

let currentOrgan = 'kidney';

function setKidneyMapOrgan(organ) {
  currentOrgan = organ;
}

const DOT_R = 9; // native viewBox units -- visually matches the old baked maps' 1.5x dot size
const DOT_HIT_R = 15; // larger invisible hit target, same "fat hitline" pattern used elsewhere in this app
const ABSENT_FILL = '#f2f2f2';
const VMAX = 0.230; // p99 cap, same fixed shared scale as the old baked maps / site-wide VAF legend
const HOVER_COLOR = '#ff2d6f';

// Same 9-stop ColorBrewer YlGnBu ramp already used by .vaf-legend-bar's CSS
// gradient (css/style.css) -- reusing it here (instead of re-deriving
// matplotlib's YlGnBu independently) guarantees the dots and the legend
// bar always agree pixel-for-pixel on what a given VAF value looks like.
const YLGNBU_STOPS = [
  '#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4',
  '#1d91c0', '#225ea8', '#253494', '#081d58',
];

// cmd2607271718: compartment-colored dot outlines + filter-bar state.
// Colors deliberately avoid blue/green (already used inside the YlGnBu fill
// scale above -- an outline in those hues would be hard to tell apart from
// the fill at a glance). Kidney-specific for now -- an organ with no
// compartments (manifest organ.compartments === null) just skips all of
// this (see buildCompartmentFilterBar in compartmentfilter.js).
const COMPARTMENT_COLORS = {
  cortex: '#d62728',
  medulla: '#ff7f0e',
  calyx: '#9467bd',
  pelves_ureter: '#e377c2',
  renal_fat: '#8c564b',
};
const COMPARTMENT_LABELS = {
  cortex: 'Cortex',
  medulla: 'Medulla',
  calyx: 'Calyx',
  pelves_ureter: 'Ureter',
  renal_fat: 'Fat',
};

// Single shared filter state -- toggling a checkbox affects every panel
// currently in the DOM at once (chainpanel.js's whole chain-list), not just
// one card. New panels rendered afterward (e.g. after selecting a different
// tree node, or switching organ) read this same state at creation time so
// they start already filtered consistently with whatever the user last chose.
const compartmentVisible = {
  cortex: true, medulla: true, calyx: true, pelves_ureter: true, renal_fat: true,
};

function setCompartmentVisible(compartment, visible) {
  compartmentVisible[compartment] = visible;
  document.querySelectorAll(`.kidneymap-dot[data-compartment="${compartment}"]`).forEach((el) => {
    el.style.display = visible ? '' : 'none';
  });
}

// Per-organ rendering specifics that aren't part of manifest.json (crop
// windows, template SVG filenames, native viewBox dimensions, and the VAF
// row field that assigns a point to one template vs. another). manifest.json
// supplies the *count*/labels/dataDir/compartment-key-list; this supplies
// the pixels. Only 'kidney' is populated -- 'liver' (1 template, no
// compartments per manifest) gets an ORGAN_VISUALS entry once its template
// SVG + digitized coordinates land, following the same shape.
const ORGAN_VISUALS = {
  kidney: {
    dataFile: 'kidney_vaf_long.json',
    sideField: 'kidney', // point.kidney is 'right'|'left', matched against template id
    templates: {
      right: { href: 'templates/right_kidney_template.svg', w: 917.01, h: 663.54, crop: { x: 222, y: 20, w: 436, h: 603 } },
      left: { href: 'templates/left_kidney_template.svg', w: 855.71, h: 663.54, crop: { x: 196, y: 10, w: 430, h: 598 } },
    },
  },
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function vafToColor(vaf) {
  const t = Math.max(0, Math.min(1, vaf / VMAX));
  const seg = t * (YLGNBU_STOPS.length - 1);
  const lo = Math.floor(seg);
  const hi = Math.min(lo + 1, YLGNBU_STOPS.length - 1);
  const frac = seg - lo;
  const a = hexToRgb(YLGNBU_STOPS[lo]);
  const b = hexToRgb(YLGNBU_STOPS[hi]);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * frac));
}

function getOrganManifestConfig(donor, organ) {
  const donorEntry = (typeof appManifest !== 'undefined' && appManifest && appManifest.donors) ? appManifest.donors[donor] : null;
  return donorEntry && donorEntry.organs ? donorEntry.organs[organ] : null;
}

async function loadKidneyMapData(donor, organ) {
  const cacheKey = `${donor}:${organ}`;
  if (kidneyMapCache[cacheKey]) return kidneyMapCache[cacheKey];
  const visual = ORGAN_VISUALS[organ];
  const manifestCfg = getOrganManifestConfig(donor, organ);
  const dataDir = (manifestCfg && manifestCfg.dataDir) || organ;
  const dataFile = (visual && visual.dataFile) || `${organ}_vaf_long.json`;
  const longRows = await fetch(`data/${donor}/${dataDir}/${dataFile}`).then((r) => r.json());
  const byMutation = {};
  for (const row of longRows) {
    (byMutation[row.mutation_id] ||= []).push(row);
  }
  kidneyMapCache[cacheKey] = byMutation;
  return byMutation;
}

function noDataPlaceholder(container, message) {
  container.innerHTML = `<div class="chain-entry-nodata">${message}</div>`;
}

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

/**
 * Render a VAF map for one mutation into `container` (any DOM element).
 * Clears and replaces the container's contents on each call. Organ defaults
 * to whatever js/organ.js last set via setKidneyMapOrgan (currentOrgan) --
 * chainpanel.js doesn't need to know or pass it.
 * Returns true if a real map (dots + hoverable overlay) was rendered, false
 * if a "no spatial data" placeholder was shown instead -- callers (chainpanel.js)
 * use this to decide whether to wire up the panel-hover tree-segment
 * highlight (only meaningful when there's an actual panel to hover).
 */
async function renderKidneyMap(container, mutationId, donor = 'DB15', organ = currentOrgan) {
  container.innerHTML = '<p class="status">loading…</p>';

  const visual = ORGAN_VISUALS[organ];
  const manifestCfg = getOrganManifestConfig(donor, organ);
  if (!visual || !manifestCfg || !manifestCfg.templates || manifestCfg.templates.length === 0) {
    container.innerHTML = '<p class="status">no map data for this organ yet</p>';
    return false;
  }

  let byMutation;
  try {
    byMutation = await loadKidneyMapData(donor, organ);
  } catch (err) {
    container.innerHTML = '<p class="status">failed to load kidney map data</p>';
    console.error(err);
    return false;
  }

  const points = byMutation[mutationId] || [];
  if (points.length === 0) {
    // Not in kidney_vaf_long.json at all -- either a 567-tree no-TG-data
    // mutation (never target-seq'd) or, on 315, genuinely absent (shouldn't
    // happen there).
    noDataPlaceholder(container, `no spatial data<br>(${mutationId} not in the 315 kidney target-seq panel)`);
    return false;
  }
  if (points.every((p) => p.vaf === 0)) {
    // All-zero VAF across every sample -- same placeholder condition the old
    // baked-PNG pipeline used (it skipped generating a PNG for these), kept
    // as-is here (cmd2607271718 is a rendering-mechanism swap, not a change
    // to which mutations get a map).
    noDataPlaceholder(container, `no spatial data<br>(${mutationId} is all-zero VAF -- map was skipped at render time)`);
    return false;
  }

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'kidneymap-wrap';
  container.appendChild(wrap);

  const dual = document.createElement('div');
  dual.className = 'kidneymap-dual';
  wrap.appendChild(dual);

  const tooltip = d3.select(wrap)
    .append('div')
    .attr('class', 'kidneymap-tooltip')
    .style('display', 'none');

  function showTooltip(event, p) {
    tooltip
      .style('display', 'block')
      .html(
        `<strong>${p.sample_id}</strong>${p.kidney ? ` (${p.kidney})` : ''}<br>` +
        (p.compartment ? `compartment: ${p.compartment}<br>` : '') +
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

  const ns = 'http://www.w3.org/2000/svg';
  for (const tmplCfg of manifestCfg.templates) {
    const tmplId = tmplCfg.id;
    const tmpl = visual.templates[tmplId];
    if (!tmpl) continue; // manifest lists it, but no visual/pixel config yet -- skip rather than throw

    const side = document.createElement('div');
    side.className = 'kidneymap-side';
    const label = document.createElement('div');
    label.className = 'kidneymap-side-label';
    label.textContent = tmplCfg.label || tmplId;
    side.appendChild(label);

    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('class', 'kidneymap-svg');
    svgEl.setAttribute('viewBox', `${tmpl.crop.x} ${tmpl.crop.y} ${tmpl.crop.w} ${tmpl.crop.h}`);
    side.appendChild(svgEl);
    dual.appendChild(side);

    const image = document.createElementNS(ns, 'image');
    // Template SVGs are treated as read-only -- referenced by URL via
    // <image>, never fetched/parsed/mutated.
    image.setAttribute('href', `data/${donor}/${manifestCfg.dataDir}/${tmpl.href}`);
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(tmpl.w));
    image.setAttribute('height', String(tmpl.h));
    svgEl.appendChild(image);

    const dotsG = document.createElementNS(ns, 'g');
    dotsG.setAttribute('class', 'kidneymap-dots');
    svgEl.appendChild(dotsG);

    const sideField = visual.sideField;
    const tmplPoints = sideField ? points.filter((p) => p[sideField] === tmplId) : points;
    for (const p of tmplPoints) {
      const dotG = document.createElementNS(ns, 'g');
      dotG.setAttribute('class', 'kidneymap-dot');
      dotG.setAttribute('data-compartment', p.compartment || '');
      dotG.setAttribute('transform', `translate(${p.x},${p.y})`);
      if (p.compartment && !compartmentVisible[p.compartment]) dotG.style.display = 'none';
      dotsG.appendChild(dotG);

      const outline = (p.compartment && COMPARTMENT_COLORS[p.compartment]) || '#333333';
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', String(DOT_R));
      dot.setAttribute('stroke', outline);
      dot.setAttribute('stroke-width', '2.2');
      dot.setAttribute('fill', p.vaf > 0 ? vafToColor(p.vaf) : ABSENT_FILL);
      dot.setAttribute('class', 'kidneymap-dot-visible');
      dotG.appendChild(dot);

      if (p.vaf === 0) {
        const xs = DOT_R * 0.55;
        for (const [x1, y1, x2, y2] of [[-xs, -xs, xs, xs], [-xs, xs, xs, -xs]]) {
          const line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', x1); line.setAttribute('y1', y1);
          line.setAttribute('x2', x2); line.setAttribute('y2', y2);
          line.setAttribute('stroke', 'red');
          line.setAttribute('stroke-width', '1.6');
          line.style.pointerEvents = 'none';
          dotG.appendChild(line);
        }
      }

      const hit = document.createElementNS(ns, 'circle');
      hit.setAttribute('r', String(DOT_HIT_R));
      hit.setAttribute('fill', 'rgba(0,0,0,0.001)');
      hit.style.cursor = 'pointer';
      hit.style.pointerEvents = 'all';
      hit.addEventListener('mouseenter', (event) => {
        dot.setAttribute('stroke', HOVER_COLOR);
        dot.setAttribute('stroke-width', '3');
        showTooltip(event, p);
      });
      hit.addEventListener('mousemove', moveTooltip);
      hit.addEventListener('mouseleave', () => {
        dot.setAttribute('stroke', outline);
        dot.setAttribute('stroke-width', '2.2');
        hideTooltip();
      });
      dotG.appendChild(hit);
    }
  }

  return true;
}
