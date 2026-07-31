#!/usr/bin/env python3
"""
cmd2607311722 Part 1: build the diaphragm organ's dot data for
organogenesis_bulb.

Joins diaphragm_package/diaphragm_all_samples.csv (tmp_label, sample_label,
x, y -- parsed straight from diaphragm.svg's 27 marker groups by
scripts/parse_diaphragm_markers.py, no transform needed, confirmed by
overlay screenshot) onto
lineage_bulb/db15/csv/db15_diaphragm_vaf_long_with_depth.csv (mutation_id,
sample_id, vaf, depth, alt_read_count -- 315 mutations x 27 diaphragm
samples).

Same schema as liver's liver_vaf_long.json (one template, no compartments):
mutation_id, sample_id, x, y, vaf, depth, alt_read_count. Unlike liver,
sample_id here is the full annotated label (e.g. "Dia_23 (Lt_LePp Ant)"),
derived from sample_label with the "15_" prefix dropped and a space
inserted before the parenthetical, so the tooltip shows the sampling site
directly.
"""
import csv
import json
import os
import re

DB15_DIR = "/home/namseop/0_kidney/lineage_bulb/db15"
COORDS_CSV = f"{DB15_DIR}/diaphragm_package/diaphragm_all_samples.csv"
DIAPHRAGM_LONG_CSV = f"{DB15_DIR}/csv/db15_diaphragm_vaf_long_with_depth.csv"
OUT_DIR = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15/diaphragm"
OUT_JSON = f"{OUT_DIR}/diaphragm_vaf_long.json"

LABEL_RE = re.compile(r"^15_(Dia_\d+)\(([^)]*)\)$")


def annotate_label(sample_label):
    m = LABEL_RE.match(sample_label)
    if not m:
        raise SystemExit(f"sample_label doesn't match expected pattern: {sample_label!r}")
    return f"{m.group(1)} ({m.group(2)})"


def strip_paren(sample_label):
    return sample_label.split("(")[0]


def main():
    coords = {}
    labels = {}
    with open(COORDS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            bam_id = strip_paren(row["sample_label"])
            coords[bam_id] = (float(row["x"]), float(row["y"]))
            labels[bam_id] = annotate_label(row["sample_label"])

    with open(DIAPHRAGM_LONG_CSV, newline="") as f:
        long_rows = list(csv.DictReader(f))

    missing_coords = sorted({r["sample_id"] for r in long_rows if r["sample_id"] not in coords})
    if missing_coords:
        raise SystemExit(f"sample_ids in {DIAPHRAGM_LONG_CSV} with no marker coordinate: {missing_coords}")

    out_rows = []
    for r in long_rows:
        x, y = coords[r["sample_id"]]
        out_rows.append({
            "mutation_id": r["mutation_id"],
            "sample_id": labels[r["sample_id"]],
            "x": x,
            "y": y,
            "vaf": float(r["vaf"]),
            "depth": int(r["depth"]),
            "alt_read_count": int(r["alt_read_count"]),
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_JSON, "w") as f:
        json.dump(out_rows, f)

    unique_samples = {r["sample_id"] for r in out_rows}
    unique_mutations = {r["mutation_id"] for r in out_rows}
    nonzero_mutations = {r["mutation_id"] for r in out_rows if r["vaf"] > 0}
    print(f"written: {OUT_JSON}")
    print(f"rows: {len(out_rows)}")
    print(f"unique sample_ids: {len(unique_samples)}")
    print(f"unique mutation_ids: {len(unique_mutations)}")
    print(f"mutations with nonzero diaphragm VAF in >=1 sample: {len(nonzero_mutations)}")
    print(f"file size: {os.path.getsize(OUT_JSON)} bytes")


if __name__ == "__main__":
    main()
