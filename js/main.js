// Orchestrates the panels off a single donor selection.
document.addEventListener('DOMContentLoaded', () => {
  initDonorPicker((donor) => {
    renderTree(donor);
    // Single-cell heatmap panel is hidden by default (stage3) to free up
    // space for the kidney-map chain panel -- code kept intact for later
    // QA use, just not rendered/shown by default. To bring it back: remove
    // the `hidden` attribute on #heatmap-panel in index.html and uncomment
    // the call below.
    // renderHeatmap(donor);
  });
});
