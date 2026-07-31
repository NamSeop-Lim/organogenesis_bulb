#!/usr/bin/env python3
"""
cmd2607311632: apply kidney_package/kidney_final_transform.json (derived by
lineage_bulb/db15/scripts/calibrate_kidney_final_transform.py) to every
point in data/DB15/kidney/kidney_vaf_long.json, mapping the OLD
2-template x/y into the NEW single-combined-image (kidney_final.svg,
viewBox 1163.14x717.15) coordinate space. VAF/depth/alt_read_count/
compartment/kidney/sample_id/mutation_id are all left untouched -- only
x/y change.

Run with --verify-only to write to a scratch path instead of the real
data file, for the overlay sanity check before committing to the swap.
"""
import argparse
import json

TRANSFORM_JSON = "/home/namseop/0_kidney/lineage_bulb/db15/kidney_package/kidney_final_transform.json"
SRC_JSON = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15/kidney/kidney_vaf_long.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    transform = json.load(open(TRANSFORM_JSON))
    rows = json.load(open(SRC_JSON))

    for r in rows:
        t = transform[r["kidney"]]
        r["x"] = round(r["x"] * t["scale_x"] + t["offset_x"], 3)
        r["y"] = round(r["y"] * t["scale_y"] + t["offset_y"], 3)

    with open(args.out, "w") as f:
        json.dump(rows, f)

    print(f"written: {args.out}")
    print(f"rows: {len(rows)}")

    xs = [r["x"] for r in rows]
    ys = [r["y"] for r in rows]
    print(f"x range: {min(xs):.1f} - {max(xs):.1f}")
    print(f"y range: {min(ys):.1f} - {max(ys):.1f}")
    right_xs = [r["x"] for r in rows if r["kidney"] == "right"]
    left_xs = [r["x"] for r in rows if r["kidney"] == "left"]
    print(f"right (RK) x range: {min(right_xs):.1f} - {max(right_xs):.1f} (expect within out_layer bbox x=89.8-479.2)")
    print(f"left  (LK) x range: {min(left_xs):.1f} - {max(left_xs):.1f} (expect within medulla bbox x=696.9-1085.9)")


if __name__ == "__main__":
    main()
