// Temporary Phase 3 Step 1 test harness for renderKidneyMap(). No tree
// integration yet -- just a dropdown + quick-pick buttons so alignment can
// be spot-checked across several mutation_ids. Safe to remove/hide once
// Step 2 wires the real tree -> kidney-map interaction.
document.addEventListener('DOMContentLoaded', async () => {
  const select = document.getElementById('kidneymap-select');
  const container = document.getElementById('kidneymap-container');
  const donor = 'DB15'; // harness is single-donor for now, matches rest of Phase 2/3

  let mutationIds = [];
  try {
    const longRows = await fetch(`data/${donor}/kidney_vaf_long.json`).then((r) => r.json());
    mutationIds = [...new Set(longRows.map((r) => r.mutation_id))].sort();
  } catch (err) {
    container.innerHTML = '<p class="status">failed to load kidney_vaf_long.json for the harness dropdown</p>';
    console.error(err);
    return;
  }

  select.innerHTML = '';
  mutationIds.forEach((mid) => {
    const opt = document.createElement('option');
    opt.value = mid;
    opt.textContent = mid;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => renderKidneyMap(container, select.value, donor));

  document.querySelectorAll('.quickpick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mid = btn.getAttribute('data-mid');
      select.value = mid;
      renderKidneyMap(container, mid, donor);
    });
  });

  // default: load the founder-level example first
  const defaultMid = "('9', 129095960)";
  select.value = defaultMid;
  renderKidneyMap(container, defaultMid, donor);
});
