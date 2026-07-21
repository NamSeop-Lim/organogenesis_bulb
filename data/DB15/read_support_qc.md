# Read support (depth / alt_read_count) — what these numbers mean

Plain-language note for anyone hovering a kidney VAF site and wondering what
"2 alt / 1847 depth" actually counts. Applies to `db15_kidney_vaf_long_mapped_with_depth.csv`
(and, eventually, the `depth`/`alt_read_count` fields surfaced in the
interactive tool's hover tooltip).

## What counts as a "read" here

- **Depth** = number of sequencing reads covering this exact genomic
  position, after dropping **duplicate reads** and **secondary alignments**
  (`flag_filter=1536`, i.e. only reads that are each read's single primary,
  non-duplicate alignment are counted). No base-quality floor is applied at
  this stage — depth includes low-quality bases too.

- **Alt read count** = of those depth reads, how many support the
  **actual mismatching base**, split by confidence:
  - **Q≥30 reads** (high base-quality) are always counted if they match the
    majority mismatch base.
  - **Q20–29 reads** (medium base-quality) are only added on top of the
    Q≥30 count when there are already **3 or more** Q≥30 reads supporting
    that base — below that, only the Q≥30 reads are counted, to avoid a
    couple of medium-quality misreads inflating a call that has almost no
    high-confidence support.
  - Reads below Q20, or reads matching the reference, are not counted as
    alt.

- **Which base counts as "alt"** is **not** taken from a fixed reference
  list — it's determined at each site by majority vote among the
  mismatching reads themselves (whichever non-reference base appears most
  often among Q≥30 mismatches at that position). This makes the count
  robust to a stale or approximate alt-allele label, at the cost of, in
  principle, occasionally picking a different base than expected if
  sequencing noise dominates a very low-depth site.

- **VAF** = alt_read_count / depth, rounded to 3 decimals.

## Replicate sites

A handful of kidney sample sites (6 of the 71 spatially-mapped sites) were
sequenced twice (two separate bam files for the same physical site). For
those, `depth` and `alt_read_count` are **summed** across both bams before
computing anything — i.e. treated as one pooled, deeper measurement, not
averaged. This differs slightly from how the existing `vaf` column for
those same 6 sites was computed (mean of the two replicates' own VAF
ratios), so `alt_read_count / depth` for those specific sites can differ
from the stored `vaf` by a bit more than rounding — expected, not an error.
For the other 65 (single-bam) sites, `alt_read_count / depth` should
reconcile with `vaf` to within rounding.

Validated across the full table (22,365 rows = 315 mutations × 71 sites):
all 20,475 single-bam rows reconcile with the stored `vaf` exactly (0
mismatches beyond rounding). The 1,890 multi-bam rows (6 sites × 315
mutations) show the expected small divergence described above — max
absolute difference 0.011, mean 0.0002.

## What this does *not* tell you

- Mapping quality, strand bias, or indel evidence are not folded into these
  numbers — a site can have "good" depth/alt numbers by this definition and
  still warrant a closer look for other reasons.
- This is the same method used to call VAF for both the single-cell clones
  and all kidney bulk samples throughout this project — consistent
  filtering, not a bespoke standard for this table.
