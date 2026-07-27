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

function showChainPlaceholder() {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return; // chain panel not in the DOM yet during early script eval
  list.innerHTML = '<p class="status chain-placeholder">Click a branch or leaf in the tree to see its lineage chain’s kidney VAF maps.</p>';
  if (status) status.textContent = '';
}

async function showChainForNode(nodeId, donor, chainsFile = 'chains.json') {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return;
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
    entryDiv.title = 'Click to expand/collapse';
    entryDiv.addEventListener('click', () => {
      entryDiv.classList.toggle('chain-entry--expanded');
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
      // Kidney-panel-hover -> tree-segment second-level highlight only makes
      // sense when there's an actual panel rendered (in-panel mutations) --
      // no-TG-data placeholder cards have nothing to highlight against, so
      // hasData===false intentionally leaves them with no hover listeners.
      if (!hasData) return;
      if (typeof highlightChainSegment !== 'function') return;
      entryDiv.addEventListener('mouseenter', () => highlightChainSegment(mutationId));
      entryDiv.addEventListener('mouseleave', () => {
        if (typeof clearChainSegmentHighlight === 'function') clearChainSegmentHighlight(mutationId);
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', showChainPlaceholder);
