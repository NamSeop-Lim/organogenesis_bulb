#!/usr/bin/env python3
"""
cmd2607311236: build the eye organ's dot data for organogenesis_bulb.
Mirrors export_db15_heart.py -- joins eye_package/eye_all_samples.csv
(sample_name -> x,y, parsed from eye.svg's marker group by
scripts/parse_eye_markers.py, no transform needed) onto
lineage_bulb/db15/csv/db15_eye_vaf_long_with_depth.csv (mutation_id,
sample_id, vaf, depth, alt_read_count -- 315 mutations x 45 eye samples).

sample_id is the LE##/RE## name (not a bam-derived id) so the tooltip shows
the actual eye + site, e.g. "LE22-1".

Same schema as kidney/liver/heart's *_vaf_long.json minus the
kidney/compartment fields: mutation_id, sample_id, x, y, vaf, depth,
alt_read_count.
"""
import csv
import json
import os

DB15_DIR = "/home/namseop/0_kidney/lineage_bulb/db15"
COORDS_CSV = f"{DB15_DIR}/eye_package/eye_all_samples.csv"
EYE_LONG_CSV = f"{DB15_DIR}/csv/db15_eye_vaf_long_with_depth.csv"
OUT_DIR = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15/eye"
OUT_JSON = f"{OUT_DIR}/eye_vaf_long.json"


def main():
    coords = {}
    with open(COORDS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            coords[row["sample_name"]] = (float(row["x"]), float(row["y"]))

    with open(EYE_LONG_CSV, newline="") as f:
        long_rows = list(csv.DictReader(f))

    missing_coords = sorted({r["sample_id"] for r in long_rows if r["sample_id"] not in coords})
    if missing_coords:
        raise SystemExit(f"sample_ids in {EYE_LONG_CSV} with no marker coordinate: {missing_coords}")

    out_rows = []
    for r in long_rows:
        x, y = coords[r["sample_id"]]
        out_rows.append({
            "mutation_id": r["mutation_id"],
            "sample_id": r["sample_id"],
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
    print(f"mutations with nonzero eye VAF in >=1 sample: {len(nonzero_mutations)}")
    print(f"file size: {os.path.getsize(OUT_JSON)} bytes")


if __name__ == "__main__":
    main()
