// Phase 3 Step 2: renders the vertically-stacked kidney-map sequence for
// whichever tree node is currently click-selected (js/tree.js calls
// showChainForNode / showChainPlaceholder directly on selection change).
// chains.json shape: { node_id: { chain_mutation_ids: [...], depth, n_mutations_in_chain } }
// chain_mutation_ids is already in root-to-node order (private terminal
// mutations excluded for leaves) -- rendered top-to-bottom as-is, no
// re-sorting here.

const chainDataCache = {}; // donor -> chains.json content

async function loadChainsData(donor) {
  if (chainDataCache[donor]) return chainDataCache[donor];
  const res = await fetch(`data/${donor}/chains.json`);
  const data = await res.json();
  chainDataCache[donor] = data;
  return data;
}

function showChainPlaceholder() {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return; // chain panel not in the DOM yet during early script eval
  list.innerHTML = '<p class="status chain-placeholder">Click a branch or leaf in the tree to see its lineage chain’s kidney VAF maps.</p>';
  if (status) status.textContent = '';
}

async function showChainForNode(nodeId, donor) {
  const list = document.getElementById('chain-list');
  const status = document.getElementById('chain-status');
  if (!list) return;
  list.innerHTML = '<p class="status">loading chain…</p>';

  let chains;
  try {
    chains = await loadChainsData(donor);
  } catch (err) {
    list.innerHTML = '<p class="status">failed to load chains.json</p>';
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
    list.innerHTML = '<p class="status">This node’s chain has no mutations — e.g. the root before any founder mutation, or a leaf whose only branch is a private (excluded) terminal mutation.</p>';
    return;
  }

  list.innerHTML = '';
  mutationIds.forEach((mutationId, i) => {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'chain-entry';

    const label = document.createElement('h3');
    label.className = 'chain-entry-label';
    label.textContent = `${i + 1}. ${mutationId}`;
    entryDiv.appendChild(label);

    const mapDiv = document.createElement('div');
    mapDiv.className = 'chain-entry-map';
    entryDiv.appendChild(mapDiv);

    list.appendChild(entryDiv);
    renderKidneyMap(mapDiv, mutationId, donor);
  });
}

document.addEventListener('DOMContentLoaded', showChainPlaceholder);
