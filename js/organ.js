// cmd2607301542 Part 2: organ toggle, alongside the version/orientation/
// theme toggles in the tree panel header. Built from manifest.json's
// per-donor organ list (js/donor.js caches the fetched manifest on
// `appManifest`) -- only organs with available:true are clickable; others
// render disabled until their data lands (see manifest.json's liver entry).
//
// Switching organ only affects the kidney-map side of the page (template
// set, dot data, compartment bar) -- tree/chain-selection state
// (selectedNodeId, treeVersion, treeDonor) is untouched, so switching organ
// just re-renders whatever chain is currently selected, same call
// tree.js's own click handler already uses.

function renderOrganToggle(donor) {
  const host = document.getElementById('organ-toggle');
  if (!host) return;

  const donorEntry = (typeof appManifest !== 'undefined' && appManifest && appManifest.donors) ? appManifest.donors[donor] : null;
  const organs = (donorEntry && donorEntry.organs) || {};
  const organIds = Object.keys(organs);

  host.innerHTML = '';
  if (organIds.length === 0) return;

  const active = organIds.find((id) => organs[id].available) || organIds[0];
  setKidneyMapOrganState(donor, active);

  organIds.forEach((organId) => {
    const cfg = organs[organId];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'orient-btn';
    btn.dataset.organ = organId;
    btn.classList.toggle('is-active', organId === active);
    btn.textContent = cfg.label || organId;
    if (cfg.available === false) {
      btn.disabled = true;
      btn.title = `${cfg.label || organId} data not available yet`;
    }
    btn.addEventListener('click', () => setOrgan(donor, organId));
    host.appendChild(btn);
  });
}

function setOrgan(donor, organId) {
  const donorEntry = (typeof appManifest !== 'undefined' && appManifest && appManifest.donors) ? appManifest.donors[donor] : null;
  const cfg = donorEntry && donorEntry.organs ? donorEntry.organs[organId] : null;
  if (!cfg || cfg.available === false) return;
  if (typeof currentOrgan !== 'undefined' && currentOrgan === organId) return;

  document.querySelectorAll('#organ-toggle .orient-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.organ === organId);
  });
  setKidneyMapOrganState(donor, organId);

  // Re-render the currently selected chain (if any) so its panels pick up
  // the new organ's templates/dots -- same redraw path tree.js's own click
  // handler uses (js/tree.js, node-click branch).
  if (typeof selectedNodeId !== 'undefined' && selectedNodeId && typeof showChainForNode === 'function') {
    showChainForNode(selectedNodeId, treeDonor, TREE_FILES[treeVersion].chains);
  } else if (typeof showChainPlaceholder === 'function') {
    showChainPlaceholder();
  }
}

function setKidneyMapOrganState(donor, organId) {
  if (typeof setKidneyMapOrgan === 'function') setKidneyMapOrgan(organId);
  if (typeof buildCompartmentFilterBar === 'function') buildCompartmentFilterBar(donor, organId);
}
