# organogenesis_bulb

Interactive viewer for early embryonic mutation (EEM) lineage tracing in human kidney organogenesis.

## What this is

Each donor's ~500 single-cell clones (skin dermal fibroblast, whole-genome sequenced) are used to reconstruct a mutation-based lineage tree rooted at the zygote. Kidney tissue is then sampled across dozens of spatial sites and targeted-sequenced for the same mutation set, so each early embryonic mutation's variant allele frequency (VAF) can be mapped back onto the kidney's physical anatomy.

This tool lets you:
- Browse a donor's full lineage tree alongside its single-cell VAF heatmap
- Hover any branch to trace its lineage chain (root → that point, private mutations excluded) and see which mutations define it
- View the spatial VAF pattern of those mutations painted onto kidney cross-sections (left + right), in developmental order
- Inspect per-site VAF and tissue compartment (cortex / medulla / calyx / pelvis-ureter / renal fat) on hover

The name comes from the idea of lighting up one clonal lineage at a time — like switching on individual bulbs in a string, tracing how a single early cell's descendants come to occupy specific regions of the kidney.

## Donors
| Donor | Status |
|---|---|
| DB15 | Available — 502 single-cell clones, 315 EEMs, 71 mapped kidney sites |
| DB10 | Planned |

## Status

Under active development. Not yet finalized for citation or external use — feedback welcome from lab members.

## Data & methods

Built on the lab's standard VAF-extraction pipeline and perfect-phylogeny lineage reconstruction. Full technical details (pileup parameters, tree-building algorithm, coordinate mapping caveats) are documented in the working analysis repo, not duplicated here.
