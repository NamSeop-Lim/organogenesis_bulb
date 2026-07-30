// cmd2607271718: compartment checkbox filter bar. One shared set of
// checkboxes controls dot visibility across every panel currently rendered
// in #chain-list at once -- js/kidneymap.js owns COMPARTMENT_COLORS/LABELS
// and the actual show/hide (setCompartmentVisible), this file just builds
// the UI and wires it to that.
//
// cmd2607301542 Part 2: organ-aware. The compartment *key list* now comes
// from manifest.json's per-organ config (organ.compartments), not a
// hardcoded constant -- an organ with no compartments (manifest
// compartments: null, e.g. liver) renders no bar at all instead of an
// always-on 5-checkbox row that doesn't apply to it.

function buildCompartmentFilterBar(donor, organ) {
  const host = document.getElementById('compartment-filter');
  if (!host) return;

  host.innerHTML = '';

  const donorEntry = (typeof appManifest !== 'undefined' && appManifest && appManifest.donors) ? appManifest.donors[donor] : null;
  const organCfg = donorEntry && donorEntry.organs ? donorEntry.organs[organ] : null;
  const keys = organCfg && organCfg.compartments;
  if (!keys || keys.length === 0) {
    host.style.display = 'none';
    return;
  }
  host.style.display = '';

  const label = document.createElement('span');
  label.className = 'compartment-filter-label';
  label.textContent = 'Compartments';
  host.appendChild(label);

  keys.forEach((key) => {
    const item = document.createElement('label');
    item.className = 'compartment-filter-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.compartment = key;
    checkbox.addEventListener('change', () => {
      if (typeof setCompartmentVisible === 'function') {
        setCompartmentVisible(key, checkbox.checked);
      }
    });

    const swatch = document.createElement('span');
    swatch.className = 'compartment-filter-swatch';
    swatch.style.backgroundColor = (typeof COMPARTMENT_COLORS !== 'undefined' && COMPARTMENT_COLORS[key]) || '#999';

    const text = document.createElement('span');
    text.textContent = (typeof COMPARTMENT_LABELS !== 'undefined' && COMPARTMENT_LABELS[key]) || key;

    item.appendChild(checkbox);
    item.appendChild(swatch);
    item.appendChild(text);
    host.appendChild(item);
  });
}
