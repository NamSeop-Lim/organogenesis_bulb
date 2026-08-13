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
// the fill at a glance). An organ with no compartments (manifest
// organ.compartments === null) just skips all of this (see
// buildCompartmentFilterBar in compartmentfilter.js).
//
// cmd2607311458: organ-aware -- each organ's compartment set has its own
// internal keys (matching whatever field values the data actually uses:
// kidney's are lowercase tissue names, brain's are the label abbreviations
// CeBel/CeBru/Stem the sample_ids are already built from) plus its own
// outline colors and full display labels ("Cerebellum", not "CeBel") for
// the checkbox bar and tooltip. compartmentColor()/compartmentLabel() are
// the only lookup path -- render code and compartmentfilter.js both go
// through these rather than reading a table directly, so a new organ's
// compartments are one ORGAN_COMPARTMENTS entry away.
const ORGAN_COMPARTMENTS = {
  kidney: {
    colors: {
      cortex: '#d62728',
      medulla: '#ff7f0e',
      calyx: '#9467bd',
      pelves_ureter: '#e377c2',
      renal_fat: '#8c564b',
    },
    labels: {
      cortex: 'Cortex',
      medulla: 'Medulla',
      calyx: 'Calyx',
      pelves_ureter: 'Ureter',
      renal_fat: 'Fat',
    },
  },
  brain: {
    colors: {
      CeBel: '#e6ab02', // gold
      CeBru: '#c51b7d', // magenta
      Stem: '#525252', // neutral gray
    },
    labels: {
      CeBel: 'Cerebellum',
      CeBru: 'Cerebrum',
      Stem: 'Brainstem',
    },
  },
};

function compartmentColor(organ, key) {
  const cfg = ORGAN_COMPARTMENTS[organ];
  return (cfg && cfg.colors[key]) || '#333333';
}
function compartmentLabel(organ, key) {
  const cfg = ORGAN_COMPARTMENTS[organ];
  return (cfg && cfg.labels[key]) || key;
}

// Single shared filter state across every organ -- their compartment keys
// never collide (kidney's are lowercase tissue names, brain's are
// CeBel/CeBru/Stem), so one flat map covers all of them. Toggling a
// checkbox affects every panel currently in the DOM at once (chainpanel.js's
// whole chain-list), not just one card. New panels rendered afterward (e.g.
// after selecting a different tree node, or switching organ) read this same
// state at creation time so they start already filtered consistently with
// whatever the user last chose.
const compartmentVisible = {
  cortex: true, medulla: true, calyx: true, pelves_ureter: true, renal_fat: true,
  CeBel: true, CeBru: true, Stem: true,
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
    // cmd2607311632: switched from 2 separate side templates (right/left,
    // each its own crop) to kidney_package/kidney_final.svg -- one combined
    // image with both kidneys already positioned (supine convention:
    // image-left = RK, image-right = LK). Every point's x/y was re-derived
    // for this new coordinate space (see
    // lineage_bulb/db15/scripts/calibrate_kidney_final_transform.py +
    // organogenesis_bulb/scripts/transform_kidney_final.py) -- verified by
    // overlay against the old 2-panel rendering that every compartment's
    // dots still land on the correct anatomical structure (cortex on the
    // outer rim, medulla inside the pyramids, calyx at the pyramid/pelvis
    // junction, pelves_ureter along the ureter). One panel now, like every
    // other organ -- no more per-point side filtering.
    sideField: null,
    // dotR: min pairwise distance among the 71 kidney points in the new
    // coordinate space is 28.474 (samples 32/34, right kidney), so 13
    // (just under half minus the 2.2px stroke's ~1.1px margin) is the
    // largest non-touching size, same method as brain/eye/liver/heart.
    dotR: 13,
    templates: {
      kidney: { href: 'templates/kidney_final.svg', w: 1163.14, h: 717.15, crop: { x: 0, y: 0, w: 1163.14, h: 717.15 } },
    },
  },
  liver: {
    dataFile: 'liver_vaf_long.json',
    sideField: null, // liver.svg's markers aren't split into sub-templates -- one panel, no filtering
    // cmd2707301734: liver renders on the full 1291x1006 native viewBox (no
    // tight hand-picked crop like kidney's), so the shared DOT_R=9 read as
    // near-invisible flecks -- tuned by eye against actual screenshots
    // (compared 18/22/28/34/40 at the expanded card size against the
    // densest marker cluster): 18 (2x) was legible but still small; 34+
    // started fusing adjacent dots into blobs there. 24 is the balance --
    // clearly bigger and easier to hover than 2x, still visibly separate
    // circles at the tightest cluster.
    dotR: 24,
    templates: {
      // cmd2607301646: marker coordinates (liver_package/liver_all_samples.csv,
      // parsed from liver.svg's numbers group) are in this same viewBox with
      // no transform (verified by plotting them back onto the plain template
      // and confirming every one lands on its original marker) -- so, unlike
      // kidney, no hand-picked crop is needed; the full native viewBox is used.
      liver: { href: 'templates/liver_template.svg', w: 1291.34, h: 1006.96, crop: { x: 0, y: 0, w: 1291.34, h: 1006.96 } },
    },
  },
  heart: {
    dataFile: 'heart_vaf_long.json',
    sideField: null, // heart.svg's markers aren't split into sub-templates -- one panel, no filtering
    // cmd2607301907: same reasoning as liver's dotR -- full native viewBox
    // (no tight hand-picked crop), tuned by eye against rendered screenshots.
    // heart.svg's markers sit closer together than liver's (smaller 769x1024
    // viewBox, tightly packed vessel sites), so liver's 24 was too big here --
    // compared 12/15/18/22/26, then zoomed into the single closest-adjacent
    // marker pair at 14/16/18/20: even the smallest candidate has that one
    // pair touching (they're genuinely that close in the source SVG), but at
    // 15 they stay "kissing, still two distinguishable circles" rather than
    // fusing into one shape, while everywhere else on the map stays clearly
    // separated and much easier to hover than the un-tuned DOT_R=9.
    dotR: 15,
    templates: {
      // cmd2607301907: marker coordinates (heart_package/heart_all_samples.csv,
      // parsed from heart.svg's marker group) are in this same viewBox with
      // no transform (verified by plotting them back onto the plain template
      // and confirming every one lands on its original marker) -- full
      // native viewBox used, same as liver.
      heart: { href: 'templates/heart_template.svg', w: 769, h: 1024, crop: { x: 0, y: 0, w: 769, h: 1024 } },
    },
  },
  eye: {
    dataFile: 'eye_vaf_long.json',
    sideField: null, // both eyes are already positioned in the one image -- one panel, no left/right filtering
    // eye_hannah_final.svg revision (PI-redrawn artwork, viewBox
    // 2656x1986.67 -> 4200x2824) -- dotR recomputed the same way as the
    // eye_song.svg revision: minimum pairwise marker distance across the 45
    // plotted markers is 50.935 (RE27/RE28, viewBox units), so two dots'
    // fill circles alone touch at r=25.467 (half that). Each dot also draws
    // a 2.2px stroke outside its radius, so subtracting that margin
    // (25.467 - 1.1 = 24.37) gives the largest non-touching-including-stroke
    // size; 24 leaves a small ~1px visual gap at the closest pair while
    // being as large as possible everywhere else.
    dotR: 24,
    templates: {
      // marker coordinates (eye_package/eye_all_samples.csv, re-parsed from
      // eye_hannah_final.svg's marker group by
      // scripts/parse_eye_markers_hannah.py) are in this same viewBox with
      // no transform (verified by plotting them back onto the plain
      // template and confirming every one lands on its original marker) --
      // full native viewBox used, same as liver/heart.
      // cmd2608121811: expandedHref -- swaps to eye_hannah_final_gray.svg
      // (dot-free, same viewBox/marker geometry as eye_template.svg) only
      // while the panel is expanded/pinned, same mechanism as brain above.
      eye: { href: 'templates/eye_template.svg', expandedHref: 'templates/eye_gray_line.svg', w: 4200, h: 2824, crop: { x: 0, y: 0, w: 4200, h: 2824 } },
    },
  },
  brain: {
    dataFile: 'brain_vaf_long.json',
    sideField: null, // both hemispheres are already positioned in the one image -- one panel, no left/right filtering
    // cmd2607311458: minimum pairwise marker distance across all 29 markers
    // is 41.808 (tmp_label 1<->2), so circles alone touch at r=20.904 (half
    // that); subtracting the 2.2px stroke's ~1.1px outward margin gives
    // 19.8 as the largest non-touching radius -- 19 leaves a small visual
    // gap at the closest pair while staying as large as possible elsewhere.
    dotR: 19,
    templates: {
      // cmd2607311458: marker coordinates (brain_package/brain_all_samples.csv,
      // parsed from brain.svg's Left_label/Right_label groups) are in this
      // same viewBox with no transform (verified by plotting them back onto
      // the plain template and confirming every one lands on its original
      // marker) -- full native viewBox used, same as liver/heart/eye.
      // cmd2608051156: expandedHref -- optional per-template swap-in used
      // only while a panel is expanded/pinned (see chainpanel.js's expand
      // toggle), so dots stand out for close inspection. Same viewBox/
      // coordinate space as href (verified: dots overlay with no
      // transform), just the dot-free gray-line variant instead of
      // black-line. Any organ can define one later; omitting it (like
      // every other organ below) means no swap happens at all.
      brain: { href: 'templates/brain_template.svg', expandedHref: 'templates/brain_gray_line.svg', w: 1842, h: 854, crop: { x: 0, y: 0, w: 1842, h: 854 } },
    },
  },
  diaphragm: {
    dataFile: 'diaphragm_vaf_long.json',
    sideField: null, // both left/right/central sites are already positioned in the one image -- one panel, no filtering
    // cmd2607311722: minimum pairwise marker distance across all 27 markers
    // is 157.315 (tmp_label 5<->16), so circles alone touch at r=78.657
    // (half that); subtracting the 2.2px stroke's ~1.1px outward margin
    // gives 77.5 as the largest non-touching radius -- 76 leaves a small
    // visual gap at the closest pair while staying as large as possible
    // elsewhere.
    dotR: 76,
    templates: {
      // cmd2607311722: marker coordinates (diaphragm_package/diaphragm_all_samples.csv,
      // parsed from diaphragm.svg's "location" group) are in this same
      // viewBox with no transform (verified by plotting them back onto the
      // plain template and confirming every one lands on its original
      // marker) -- full native viewBox used, same as liver/heart/eye/brain.
      diaphragm: { href: 'templates/diaphragm_template.svg', w: 3163.86, h: 2669.99, crop: { x: 0, y: 0, w: 3163.86, h: 2669.99 } },
    },
  },
  git: {
    dataFile: 'git_vaf_long.json',
    sideField: null, // stomach/small intestine/colon sites are already positioned in the one image -- one panel, no filtering
    // cmd2608131300: minimum pairwise marker distance across all 49 markers
    // is 60.342 (StoGC6<->StoGC7, viewBox units); the strict non-touching
    // radius would be ~29 (see git history for that derivation), but at
    // this organ's huge 7202.83-wide viewBox that read as too small in the
    // thumbnail panel -- cmd (2608131440+): sized up to 40 per direct
    // instruction ("dots too small"), a deliberate exception to the
    // no-overlap convention used elsewhere. Only the single StoGC6/StoGC7
    // pair overlaps slightly at this size; every other marker stays clear.
    dotR: 40,
    templates: {
      // marker coordinates (git_package/git_all_samples.csv, parsed from
      // GIT_black_minah_1.svg's 49 self-contained <g id="_N"> marker groups
      // by scripts/parse_git_markers.py) are in this same viewBox with no
      // transform -- full native viewBox used, same as liver/heart/eye/brain/diaphragm.
      // expandedHref swaps to the dot-free gray-line variant on expand,
      // same mechanism as brain/eye above.
      git: { href: 'templates/git_template.svg', expandedHref: 'templates/git_gray_line.svg', w: 7202.83, h: 3410.36, crop: { x: 0, y: 0, w: 7202.83, h: 3410.36 } },
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
  // cmd2607311532: organ class lets CSS give wide landscape templates
  // (brain, eye) a bigger expanded size than portrait/near-square ones
  // (kidney, liver, heart) without touching their existing sizing.
  wrap.className = `kidneymap-wrap kidneymap-organ-${organ}`;
  container.appendChild(wrap);

  const dual = document.createElement('div');
  dual.className = 'kidneymap-dual';
  wrap.appendChild(dual);

  const tooltip = d3.select(wrap)
    .append('div')
    .attr('class', 'kidneymap-tooltip')
    .style('display', 'none');

  function showTooltip(event, p) {
    const side = p.kidney || p.side; // kidney's left/right, brain's LT/RT -- tooltip-only, not a filterable compartment
    tooltip
      .style('display', 'block')
      .html(
        `<strong>${p.sample_id}</strong>${side ? ` (${side})` : ''}<br>` +
        (p.compartment ? `compartment: ${compartmentLabel(organ, p.compartment)}<br>` : '') +
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

  // Per-organ dot size (cmd2707301734) -- hit radius and the red-X absent
  // marker scale with it so they stay proportional to whatever dotR is,
  // not just kidney's.
  const dotR = visual.dotR || DOT_R;
  const dotHitR = dotR * (DOT_HIT_R / DOT_R);

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
    const defaultHref = `data/${donor}/${manifestCfg.dataDir}/${tmpl.href}`;
    image.setAttribute('href', defaultHref);
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(tmpl.w));
    image.setAttribute('height', String(tmpl.h));
    // cmd2608051156: expand/collapse href swap (chainpanel.js) reads these
    // two data attributes rather than re-deriving paths itself -- dataset
    // is set here since only this code knows manifestCfg.dataDir/tmpl.
    image.dataset.defaultHref = defaultHref;
    if (tmpl.expandedHref) {
      image.dataset.expandedHref = `data/${donor}/${manifestCfg.dataDir}/${tmpl.expandedHref}`;
    }
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

      const outline = p.compartment ? compartmentColor(organ, p.compartment) : '#333333';
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', String(dotR));
      dot.setAttribute('stroke', outline);
      dot.setAttribute('stroke-width', '2.2');
      dot.setAttribute('fill', p.vaf > 0 ? vafToColor(p.vaf) : ABSENT_FILL);
      dot.setAttribute('class', 'kidneymap-dot-visible');
      dotG.appendChild(dot);

      if (p.vaf === 0) {
        const xs = dotR * 0.55;
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
      hit.setAttribute('r', String(dotHitR));
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
