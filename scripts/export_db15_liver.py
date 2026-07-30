#!/usr/bin/env python3
"""
cmd2607301646: build the liver organ's dot data for organogenesis_bulb.

Joins liver_package/liver_all_samples.csv (marker number -> x,y, parsed
straight from liver.svg's numbers group by scripts/parse_liver_markers.py --
no manual digitization, no transform needed, see that script + the
cmd2607301646 coordinate-space check) onto
lineage_bulb/db15/csv/db15_liver_vaf_long_with_depth.csv (mutation_id,
sample_id, vaf, depth, alt_read_count -- 315 mutations x 55 liver samples).

Same schema as kidney's kidney_vaf_long.json minus the kidney/compartment
fields (liver has one template, no compartments): mutation_id, sample_id,
x, y, vaf, depth, alt_read_count.
"""
import csv
import json
import os

DB15_DIR = "/home/namseop/0_kidney/lineage_bulb/db15"
COORDS_CSV = f"{DB15_DIR}/liver_package/liver_all_samples.csv"
LIVER_LONG_CSV = f"{DB15_DIR}/csv/db15_liver_vaf_long_with_depth.csv"
OUT_DIR = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15/liver"
OUT_JSON = f"{OUT_DIR}/liver_vaf_long.json"


def main():
    coords = {}
    with open(COORDS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            coords[row["number"]] = (float(row["x"]), float(row["y"]))

    with open(LIVER_LONG_CSV, newline="") as f:
        long_rows = list(csv.DictReader(f))

    missing_coords = sorted({r["sample_id"] for r in long_rows if r["sample_id"] not in coords}, key=int)
    if missing_coords:
        raise SystemExit(f"sample_ids in {LIVER_LONG_CSV} with no marker coordinate: {missing_coords}")

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
    print(f"mutations with nonzero liver VAF in >=1 sample: {len(nonzero_mutations)}")
    print(f"file size: {os.path.getsize(OUT_JSON)} bytes")


if __name__ == "__main__":
    main()
