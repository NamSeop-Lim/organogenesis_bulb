#!/usr/bin/env python3
"""
cmd2607311458: build the brain organ's dot data for organogenesis_bulb.
Mirrors export_db15_eye.py -- joins brain_package/brain_all_samples.csv
(sample_label -> x,y,region,side, parsed from brain.svg's two label groups
by scripts/parse_brain_markers.py + build_brain_sample_table.py, no
transform needed) onto
lineage_bulb/db15/csv/db15_brain_vaf_long_with_depth.csv (mutation_id,
sample_id, vaf, depth, alt_read_count -- 315 mutations x 29 brain samples).

Unlike liver/heart/eye, brain HAS a compartment field: region (Cerebellum/
Cerebrum/Brainstem), stored under the internal keys the rendering code
filters on (CeBel/CeBru/Stem) -- js/kidneymap.js's ORGAN_COMPARTMENTS maps
those keys to their full display names ("Cerebellum" etc.) for the
checkbox bar and tooltip, same pattern as kidney's cortex/medulla/etc.
side (LT/RT) is tooltip-only, not a filterable compartment, so it's not
included in the JSON (would need separate handling to matter).
"""
import csv
import json
import os

DB15_DIR = "/home/namseop/0_kidney/lineage_bulb/db15"
COORDS_CSV = f"{DB15_DIR}/brain_package/brain_all_samples.csv"
BRAIN_LONG_CSV = f"{DB15_DIR}/csv/db15_brain_vaf_long_with_depth.csv"
OUT_DIR = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15/brain"
OUT_JSON = f"{OUT_DIR}/brain_vaf_long.json"

REGION_KEY = {"Cerebellum": "CeBel", "Cerebrum": "CeBru", "Brainstem": "Stem"}


def main():
    coords = {}
    with open(COORDS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            coords[row["sample_label"]] = {
                "x": float(row["x"]),
                "y": float(row["y"]),
                "compartment": REGION_KEY[row["region"]],
                "side": row["side"],
            }

    with open(BRAIN_LONG_CSV, newline="") as f:
        long_rows = list(csv.DictReader(f))

    missing_coords = sorted({r["sample_id"] for r in long_rows if r["sample_id"] not in coords})
    if missing_coords:
        raise SystemExit(f"sample_ids in {BRAIN_LONG_CSV} with no marker coordinate: {missing_coords}")

    out_rows = []
    for r in long_rows:
        c = coords[r["sample_id"]]
        out_rows.append({
            "mutation_id": r["mutation_id"],
            "sample_id": r["sample_id"],
            "x": c["x"],
            "y": c["y"],
            "compartment": c["compartment"],
            "side": c["side"],
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
    print(f"mutations with nonzero brain VAF in >=1 sample: {len(nonzero_mutations)}")
    print(f"file size: {os.path.getsize(OUT_JSON)} bytes")


if __name__ == "__main__":
    main()
