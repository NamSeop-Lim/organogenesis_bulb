// Reads data/manifest.json and populates the donor dropdown.
// Does not assume any specific donor id -- works for however many
// entries manifest.donors contains.
async function initDonorPicker(onDonorChange) {
  const select = document.getElementById('donor-select');

  let manifest;
  try {
    const res = await fetch('data/manifest.json');
    manifest = await res.json();
  } catch (err) {
    console.error('failed to load data/manifest.json', err);
    select.innerHTML = '<option>failed to load manifest</option>';
    return;
  }

  const donors = manifest.donors || [];
  select.innerHTML = '';
  donors.forEach((donorId) => {
    const opt = document.createElement('option');
    opt.value = donorId;
    opt.textContent = donorId;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => onDonorChange(select.value));

  if (donors.length > 0) {
    select.value = donors[0];
    onDonorChange(donors[0]);
  }
}
