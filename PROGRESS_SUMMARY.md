# DB15 Lineage Tracing — Progress Summary

Early embryonic mutation (EEM) lineage tracing in donor DB15: from single-cell mutation discovery to an interactive spatial lineage viewer. Written for a PI-level update — full technical detail lives in the working repos (`lineage_bulb/db15/`, `organogenesis_bulb/`).

---

## 1. EEM discovery in single-cell clones

**Problem.** Early embryonic mutations mark clonal lineages from the first few zygotic divisions. To use them for lineage tracing we needed a confident, whole-genome-supported set of candidate EEMs and a way to assign each single cell to a lineage.

**Decision.** ~500 single-cell skin dermal fibroblast clones were whole-genome sequenced and screened for candidate early mutations, then filtered down through several intermediate rank/filter passes to a final validated set.

**Built.** 502 single-cell clones × 315 confirmed EEMs, encoded as a VAF heatmap (`315_tgeem_singlecell_heatmap_aligned.csv`). Manually reordering rows/columns of this heatmap exposed a clean block-diagonal structure, revealing two mutually exclusive founder lineages from the first zygotic division: **L1** (first 252 samples) and **L2** (last 250 samples). This split was confirmed independently — across all 315 EEMs, no mutation shows presence in both blocks (one borderline case, `15L109Fb8_F9`, sits at VAF 0.1 on the L1 founder vs. 0 on L2 — read as real L1 signal at the edge of the detection threshold, not a contradiction).

---

## 2. Kidney targeted sequencing

**Problem.** Once EEMs are known from single cells, we need their VAF in kidney tissue itself, across many spatial sites, to see where each lineage physically ended up.

**Decision.** Submitted candidate EEMs for a custom targeted-sequencing panel design rather than whole-genome kidney sequencing (cost/depth tradeoff — targeted panels give much higher effective depth per site for VAF confidence). 403 candidate positions were submitted; 89 were declined during panel design, leaving 315 confirmed positions actually on the panel. (Note: the post-decline set isn't cleanly recoverable as a 403−89 diff from files on disk — 315 is a strict subset of 403, but 403−315 = 88, one short of 89. The 315-position file is treated as the authoritative final list regardless.)

**Built.** 107 kidney bulk tissue samples (left kidney "LK" + right kidney "RK") sequenced against the 315-EEM panel.

---

## 3. VAF extraction pipeline (shared method)

**Problem.** Single-cell and kidney-bulk VAF need to be computed identically, or downstream comparisons (e.g. "is this EEM present in this kidney site") aren't meaningful.

**Decision.** Reused the lab's standard, previously-validated VAF-calling script rather than writing a new one, applied identically to both single-cell and kidney bulk bams.

**Method, briefly:** pileup at each candidate site (duplicate/secondary reads dropped), depth = reads covering the site. Per read, a base is called "alt" if it mismatches the reference at Q≥30 (or Q20–29 as a lower-confidence tier). The actual alt allele is *rediscovered* by majority vote among mismatches at each site (not simply trusted from the candidate list) — this guards against stale/incorrect alt annotations. VAF = high-confidence alt read count / total depth. This is a validated, previously-used method, not a new pipeline design — the value here was consistent, correct reimplementation for both sample types, not novel methodology.

---

## 4. Lineage tree construction

**Problem.** Given the 315×502 single-cell VAF matrix, build a mutation-based lineage tree.

**Decision.** Used a **perfect-phylogeny** approach rather than distance-based clustering (e.g. hierarchical clustering, neighbor-joining). Rationale: EEMs are (assumed) irreversible, non-recurring lineage markers — the correct model is a tree where each mutation defines a clade, not a distance metric between cells. Perfect phylogeny exploits that structure directly instead of approximating it.

**Method:** each mutation's "carrier set" (which single cells show VAF > 0) is computed; mutations with identical carrier sets are merged onto one branch (branch length = mutation count on that branch); branches are nested by carrier-set containment. This only works correctly if the input matrix's rows/columns are pre-sorted so that nested carrier-set groups are contiguous — the earlier manual reordering (section 1) isn't just cosmetic, it's a load-bearing input to this algorithm.

**Built.** A 502-leaf Newick tree (`315_tgeem_singlecell_lineage.nwk`), later consumed by the interactive tool (section 8).

---

## 5. Kidney spatial coordinate mapping

**Problem.** The 107 kidney bulk samples need physical (x,y) coordinates on a kidney cross-section diagram to plot VAF spatially.

**Decision.** Sample positions from the original lab figure were digitized into a coordinate CSV (`sample_id, compartment, x, y`) per kidney, rather than re-deriving positions from scratch — this preserves the PI's original site definitions.

**The matching problem:** kidney bulk bam files are named like `15_RK_27_TG` / `15_LK_100_TG`, not by the bare numeric `sample_id` used in the coordinate CSVs, and some sites were sequenced in replicate (`_1`/`_2` suffixes). Normalizing bam names to `(kidney, sample_id)` keys and grouping replicates collapsed 107 raw bam files to 100 distinct sample keys. Of those 100, **71 matched a digitized coordinate** and 29 did not — the unmatched keys are right-kidney IDs 21–27 (renal artery/vein) and 41–50 (capsule, anterior/posterior), plus a further set of left-kidney IDs (99, 100, 106–108, 120–128, 153–162). All of these are capsule/vessel/other structures that were intentionally excluded from the parenchyma-only coordinate digitization, not a data gap. (An earlier working assumption had this match count at 77; re-verified directly against the coordinate files and confirmed as 71 — noted here for the record, since 77 appears in some older internal notes.) Replicate pairs at the same site were mean-VAF'd into one value, keeping replicate count as a QC column.

**Built.** `db15_kidney_vaf_long_mapped.csv` — 315 mutations × 71 spatially-mapped kidney sites, long-format, ready to plot.

---

## 6. Static VAF map generation (314 images)

**Problem.** Turn the long-format VAF table into one shareable image per mutation, showing its spatial pattern across both kidneys.

**Design decisions:**
- **Raw VAF, not per-mutation-normalized.** Normalizing each mutation to its own min/max would make every mutation's map "look" similarly saturated regardless of true VAF magnitude, hiding real biological differences in clonal abundance between mutations. Raw values preserve that signal.
- **Global color scale, capped at p99 (VAF = 0.230), shared across all 314 images.** A single fixed scale makes images directly comparable to each other (a light dot always means "low VAF" everywhere), and capping at the 99th percentile (rather than the true max) prevents one or two outlier sites from compressing the usable color range for everything else.
- **Colormap: YlGnBu**, chosen after iterating past a red/blue diverging scheme — red/blue read as "good/bad" or "positive/negative" to a viewer, which is the wrong association for a VAF magnitude scale, and diverging scales also had poor contrast against the kidney artwork's background. YlGnBu (light-yellow → dark-blue) reads as a clean low→high sequential scale and contrasts well against the gray/white anatomy.
- **Absent sites (VAF = 0)** are marked with a distinct red-X marker rather than plotted on the continuous color scale, so "not detected here" is visually unambiguous rather than just "the lightest shade of present."

**Built.** 314 PNGs (one per mutation with panel-design-confirmed status), each showing both kidneys side by side (right kidney left panel, left kidney right panel, per the lab's conventional layout) with VAF-colored dots at each of the 71 mapped sites.

---

## 7. PI-driven artwork simplification + recalibration

**Problem.** The original kidney diagrams color-coded tissue compartment (cortex/medulla/etc.), which visually competed with the VAF color overlay. The PI redrew the artwork in Illustrator in a minimal white/gray/black-capsule style to fix this.

**Consequence.** The new artwork was a fresh Illustrator export with a different SVG viewBox/origin than the one the original coordinate CSVs were digitized against — old (x,y) values could not be reused as-is.

**Decision.** Rather than assume or eyeball a correction, the transform was derived empirically: known reference points were rendered through the actual production pipeline and their pixel centroids detected in the output, then compared against the old coordinate space. This confirmed the new artwork is the **same scale** as the old (silhouette bounding boxes match to ~1px), just **translated** — a simple per-kidney (dx, dy) offset (right: −146, +15; left: −133, +15) is sufficient, no rescaling needed.

**Validation.** The derived offset was checked against **all 128 digitized coordinate sites** (61 right + 67 left — the full digitized set, not just the 71 with kidney VAF data), confirming every site lands on-structure on the new artwork, not just a handful of spot-checked corners.

---

## 8. organogenesis_bulb — interactive viewer

**What it does.** A static, donor-toggleable web tool (currently DB15; architecture supports adding more donors later without code changes) that lets a viewer:
- Browse the full 502-leaf lineage tree (pannable/zoomable)
- Click any branch or leaf to select its lineage chain (root → that point, excluding that leaf's own private terminal mutations)
- See that chain's kidney VAF maps displayed in root-to-leaf order, so you can watch a lineage's spatial footprint accumulate mutation by mutation

**Key technical decisions:**
- **True phylogram layout** — branch length is proportional to cumulative mutation count from the root (not a uniform-spacing dendrogram), with aligned tip labels (dashed guide lines connect each leaf's true position to a common label alignment line) — the standard convention in phylogenetics tools (iTOL, ete3), chosen so branch length is visually meaningful, not just topology.
- **Click, not hover, for chain selection** — a hover-driven UI would make the chain panel flicker with every incidental mouse movement while browsing a dense 502-leaf tree; click-to-select gives a stable, deliberate selection that persists while the viewer studies the resulting kidney maps.
- **Pre-rendered PNG + hover overlay**, not live plotting — the 314 kidney maps are static images generated once by the same matplotlib pipeline as section 6/7, with a lightweight invisible-hitbox SVG overlay added client-side for per-site hover tooltips (VAF, compartment). This keeps the interactive tool fast (no client-side rendering of anatomy or per-site math) while still supporting hover detail.

---

## 9. Known open issues / limitations

- **5 mutation_ids don't cleanly nest in the tree** under the perfect-phylogeny model and are currently tracked as "unassigned" rather than forced onto a branch: `('12', 103927193)`, `('20', 6422366)`, `('3', 195914017)`, `('5', 137035503)`, `('10', 52659442)`. Not yet root-caused — candidates are noise/miscall at those specific sites, or genuine violations of the infinite-sites/no-recurrence assumption perfect phylogeny depends on. Excluded from chain displays rather than silently misassigned.
- **One borderline L1/L2 call**: sample `15L109Fb8_F9` sits at VAF 0.1 on the L1 founder mutation (vs. 0 on L2) — right at the presence-detection threshold. Currently called L1 (consistent with the rest of its block), but flagged as the one non-clean-cut case in an otherwise unambiguous 502-sample split.
- **315-vs-403 panel provenance gap**: the exact 89 declined candidate positions aren't reconstructable from files currently on disk (see section 2) — not blocking (315 is used as-is throughout), but worth knowing if anyone later asks "why isn't candidate X in the final set."
- **2D compositing caveat on kidney maps**: each kidney's sampling sites were digitized from 4 separate physical cross-sections onto one representative 2D template. Visual proximity between two dots on the diagram does not imply physical proximity in the real 3D kidney — a real limitation of the display, not a data error.
- **36 of 107 kidney bulk samples have no spatial coordinate** (capsule/vessel/other out-of-scope structures, see section 5) and are excluded from all spatial plots — sequencing data exists for them, but they can't currently be shown on the kidney maps.
