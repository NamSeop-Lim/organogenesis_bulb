// cmd2607271718: compartment checkbox filter bar. One shared set of 5
// checkboxes (cortex/medulla/calyx/ureter/fat) controls dot visibility
// across every kidney panel currently rendered in #chain-list at once --
// js/kidneymap.js owns COMPARTMENT_KEYS/COMPARTMENT_COLORS/COMPARTMENT_LABELS
// and the actual show/hide (setCompartmentVisible), this file just builds
// the UI and wires it to that.

function buildCompartmentFilterBar() {
  const host = document.getElementById('compartment-filter');
  if (!host) return;
  if (typeof COMPARTMENT_KEYS === 'undefined') return;

  host.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'compartment-filter-label';
  label.textContent = 'Compartments';
  host.appendChild(label);

  COMPARTMENT_KEYS.forEach((key) => {
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
    swatch.style.backgroundColor = COMPARTMENT_COLORS[key];

    const text = document.createElement('span');
    text.textContent = COMPARTMENT_LABELS[key] || key;

    item.appendChild(checkbox);
    item.appendChild(swatch);
    item.appendChild(text);
    host.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', buildCompartmentFilterBar);
