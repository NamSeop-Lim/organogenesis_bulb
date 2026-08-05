// Phase 3 Step 2: renders the vertically-stacked kidney-map sequence for
// whichever tree node is currently click-selected (js/tree.js calls
// showChainForNode / showChainPlaceholder directly on selection change).
// chains.json (315) shape: { node_id: { chain_mutation_ids: [...], depth, n_mutations_in_chain } }
// chains_full.json (567) shape: { chains: { node_id: {...} }, panel_mutation_ids: [...] } --
// normalized to the same flat node_id-keyed shape below so the rest of this
// file doesn't need to know which tree version is active.
// chain_mutation_ids is already in root-to-node order (private terminal
// mutations excluded for leaves) -- rendered top-to-bottom as-is, no
// re-sorting here.

const chainDataCache = {}; // `${donor}:${chainsFile}` -> normalized {node_id: {...}} content

async function loadChainsData(donor, chainsFile) {
  const cacheKey = `${donor}:${chainsFile}`;
  if (chainDataCache[cacheKey]) return chainDataCache[cacheKey];
  const res = await fetch(`data/${donor}/${chainsFile}`);
  const raw = await res.json();
  const data = raw.chains ? raw.chains : raw; // unwrap chains_full.json's nested shape
  chainDataCache[cacheKey] = data;
  return data;
}

// cmd2607311722 Part 2: organ-aware -- was hardcoded "...kidney VAF maps."
// regardless of the selected organ. Same manifest label lookup
// updateChainPanelTitle (js/organ.js) uses; defaults to the current
// tree/organ globals so the DOMContentLoaded call site (before any chain is
// selected) still works with no args.
function showChainPlaceholder(
  donor = (typeof treeDonor !== 'undefined' ? treeDonor : 'DB15'),
  organId = (typeof currentOrgan !== 'undefined' ? currentOrgan : 'kidney')
) {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return; // chain panel not in the DOM yet during early script eval
  // Any pinned/displayed panel-highlight (cmd2607271611) is about to lose
  // its panelEl -- reset before the DOM under it is torn down, or the pin
  // survives referencing a now-detached node.
  if (typeof resetPanelLink === 'function') resetPanelLink();
  const donorEntry = (typeof appManifest !== 'undefined' && appManifest && appManifest.donors) ? appManifest.donors[donor] : null;
  const cfg = donorEntry && donorEntry.organs ? donorEntry.organs[organId] : null;
  const label = ((cfg && cfg.label) || organId).toLowerCase();
  list.innerHTML = `<p class="status chain-placeholder">Click a branch or leaf in the tree to see its lineage chain’s ${label} VAF maps.</p>`;
  if (status) status.textContent = '';
}

async function showChainForNode(nodeId, donor, chainsFile = 'chains.json') {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return;
  if (typeof resetPanelLink === 'function') resetPanelLink();
  list.innerHTML = '<p class="status chain-placeholder">loading chain…</p>';

  let chains;
  try {
    chains = await loadChainsData(donor, chainsFile);
  } catch (err) {
    list.innerHTML = `<p class="status chain-placeholder">failed to load ${chainsFile}</p>`;
    console.error(err);
    return;
  }

  const entry = chains[nodeId];
  const mutationIds = entry ? entry.chain_mutation_ids : [];

  if (status) {
    status.textContent = entry
      ? `node ${nodeId} · depth ${entry.depth} · ${mutationIds.length} mutation${mutationIds.length === 1 ? '' : 's'} in chain`
      : `node ${nodeId} not found in chains.json`;
  }

  if (mutationIds.length === 0) {
    list.innerHTML = '<p class="status chain-placeholder">This node’s chain has no mutations — e.g. the root before any founder mutation, or a leaf whose only branch is a private (excluded) terminal mutation.</p>';
    return;
  }

  list.innerHTML = '';
  mutationIds.forEach((mutationId, i) => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'chain-entry';
    // Compact grid by default; click anywhere on the card (including a dot,
    // which still fires its own hover tooltip independently) toggles a
    // full-width expanded view -- simpler than a modal/lightbox overlay.
    // cmd2607301756: no title attribute here -- a native tooltip on the
    // whole card covered/raced with a hovered dot's own VAF tooltip.
    // Set once renderKidneyMap resolves below -- gates pin/unpin so a
    // no-data placeholder card (nothing to link to) can still expand/
    // collapse normally without touching the highlight pin.
    let hasKidneyData = false;
    entryDiv.addEventListener('click', () => {
      const willExpand = !entryDiv.classList.contains('chain-entry--expanded');
      entryDiv.classList.toggle('chain-entry--expanded');
      // cmd2608051156: swap each map's background <image> to its
      // organ-specific expanded template (if one is defined -- see
      // ORGAN_VISUALS' expandedHref) while expanded, back to the default
      // on collapse. Dots/tooltip/pin are untouched -- only the background
      // href changes. No-op for organs/templates with no expandedHref
      // (image.dataset.expandedHref is undefined).
      entryDiv.querySelectorAll('.kidneymap-svg image').forEach((img) => {
        const expandedHref = img.dataset.expandedHref;
        if (!expandedHref) return;
        img.setAttribute('href', willExpand ? expandedHref : img.dataset.defaultHref);
      });
      if (!hasKidneyData) return;
      if (willExpand) {
        if (typeof pinPanelLink === 'function') pinPanelLink(entryDiv, mutationId);
      } else if (typeof unpinPanelLink === 'function') {
        unpinPanelLink(entryDiv);
      }
    });

    const label = document.createElement('h3');
    label.className = 'chain-entry-label';
    label.textContent = `${i + 1}. ${mutationId}`;
    entryDiv.appendChild(label);

    const mapDiv = document.createElement('div');
    mapDiv.className = 'chain-entry-map';
    entryDiv.appendChild(mapDiv);

    list.appendChild(entryDiv);
    renderKidneyMap(mapDiv, mutationId, donor).then((hasData) => {
      // Kidney-panel-hover -> cross-column tree-segment leader line only
      // makes sense when there's an actual panel rendered (in-panel
      // mutations) -- no-TG-data placeholder cards have nothing to link to,
      // so hasData===false intentionally leaves them with no hover listeners
      // (and the click handler above leaves hasKidneyData false, so it never
      // pins one either).
      hasKidneyData = hasData;
      if (!hasData) return;
      if (typeof showPanelLink !== 'function') return;
      entryDiv.addEventListener('mouseenter', () => showPanelLink(entryDiv, mutationId));
      entryDiv.addEventListener('mouseleave', () => {
        if (typeof hidePanelLink === 'function') hidePanelLink();
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', showChainPlaceholder);
