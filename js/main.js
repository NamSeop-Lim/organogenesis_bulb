// Orchestrates the two panels off a single donor selection.
document.addEventListener('DOMContentLoaded', () => {
  initDonorPicker((donor) => {
    renderTree(donor);
    renderHeatmap(donor);
  });
});
