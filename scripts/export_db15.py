#!/usr/bin/env python3
"""
Data-prep export for organogenesis_bulb (DB15): tree.json, chains.json,
singlecell_heatmap.json, kidney_vaf_long.json, templates/, manifest.json.

Source of truth for tree topology + branch mutation content is NOT the
.nwk's numeric branch lengths (ete3 drops/mishandles the outermost root
branch length on this newick) -- instead, per-branch mutation_ids are
re-derived directly from 315_tgeem_singlecell_heatmap_aligned.csv using
the same carrier-set rule as csv_newick_gil_ver3.py (VAF>0 per sample),
then matched onto tree nodes by exact leaf-descendant-set. This is more
robust and gives us actual mutation identities, not just counts.
"""
import csv
import json
import os
import shutil
from collections import defaultdict

from ete3 import Tree

DB15_DIR = "/home/namseop/0_kidney/lineage_bulb/db15"
OUT_DIR = "/home/namseop/0_kidney/organogenesis_bulb/data/DB15"
NWK = f"{DB15_DIR}/315_tgeem_singlecell_lineage.nwk"
ALIGNED_CSV = f"{DB15_DIR}/csv/315_tgeem_singlecell_heatmap_aligned.csv"
LINEAGE_CSV = f"{DB15_DIR}/csv/DB15_singlecell_lineage_assignment.csv"
KIDNEY_LONG_CSV = f"{DB15_DIR}/csv/db15_kidney_vaf_long_mapped.csv"
RIGHT_TEMPLATE = f"{DB15_DIR}/kidney_package/right_kidney_template.svg"
LEFT_TEMPLATE = f"{DB15_DIR}/kidney_package/left_kidney_template.svg"


def load_aligned_heatmap():
    with open(ALIGNED_CSV, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f))
    header = rows[0]
    sample_ids = header[3:]
    mutation_ids = []
    matrix = []
    for row in rows[1:]:
        mutation_ids.append(row[0])
        matrix.append([float(v) for v in row[3:]])
    return mutation_ids, sample_ids, matrix


def build_carrier_groups(mutation_ids, sample_ids, matrix):
    """mutation carrier-set (frozenset of sample_ids with VAF>0) -> list of mutation_ids,
    matching csv_newick_gil_ver3.py's `row.iloc[i] > 0` rule exactly."""
    groups = defaultdict(list)
    for mi, mutation_id in enumerate(mutation_ids):
        carriers = frozenset(sample_ids[si] for si, v in enumerate(matrix[mi]) if v > 0)
        groups[carriers].append(mutation_id)
    return groups


def assign_node_ids(tree):
    """Deterministic ids via preorder traversal (root first)."""
    id_of = {}
    for i, node in enumerate(tree.traverse('preorder')):
        id_of[id(node)] = f"n{i}"
    return id_of


def build_tree_json(tree, id_of, carrier_groups):
    nodes_out = {}
    total_mut_assigned = set()
    unmatched_nodes = []

    parent_of = {}
    for node in tree.traverse('preorder'):
        for child in node.children:
            parent_of[id(child)] = id(node)

    # The tree has genuine single-child "pass-through" nodes (e.g. n323->n324)
    # whose leaf-descendant-set is IDENTICAL to their one child's -- an artifact
    # of csv_newick_gil_ver3.py's positional paren-insertion, not a branching
    # event. A naive per-node leafset->carrier_groups lookup assigns the same
    # mutation group to every node in such a run, double-counting it in every
    # descendant's chain. Fix: each unique leafset is claimed by exactly the
    # SHALLOWEST node with that leafset (the point where the clade first
    # becomes defined coming down from its parent); deeper pass-through
    # nodes sharing the same leafset get 0 mutation_ids for their own branch.
    depth_of = {}
    for node in tree.traverse('preorder'):
        depth_of[id(node)] = 0 if id(node) not in parent_of else depth_of[parent_of[id(node)]] + 1

    leafset_of = {id(node): frozenset(node.get_leaf_names()) for node in tree.traverse('preorder')}
    shallowest_owner = {}  # leafset -> node id(), shallowest depth wins
    for node in tree.traverse('preorder'):
        ls = leafset_of[id(node)]
        cur = shallowest_owner.get(ls)
        if cur is None or depth_of[id(node)] < depth_of[cur]:
            shallowest_owner[ls] = id(node)

    for node in tree.traverse('preorder'):
        nid = id_of[id(node)]
        is_leaf = node.is_leaf()
        leafset = leafset_of[id(node)]
        is_owner = shallowest_owner.get(leafset) == id(node)
        mutation_ids = carrier_groups.get(leafset, []) if is_owner else []
        if mutation_ids:
            total_mut_assigned.update(mutation_ids)
        elif leafset not in carrier_groups:
            unmatched_nodes.append(nid)  # 0-mutation branch, expected for many

        nodes_out[nid] = {
            "id": nid,
            "is_leaf": is_leaf,
            "leaf_name": node.name if is_leaf else None,
            "parent_id": id_of[parent_of[id(node)]] if id(node) in parent_of else None,
            "children": [id_of[id(c)] for c in node.children],
            "mutation_ids": mutation_ids,
            "n_mutations": len(mutation_ids),
        }

    return nodes_out, total_mut_assigned


def build_chains_json(tree, id_of, tree_nodes):
    chains = {}
    for node in tree.traverse('preorder'):
        nid = id_of[id(node)]
        is_leaf = node.is_leaf()
        # path root -> ... -> parent (ancestors, root first)
        ancestors = list(reversed(node.get_ancestors()))  # root-first
        chain = []
        for anc in ancestors:
            anc_id = id_of[id(anc)]
            chain.extend(tree_nodes[anc_id]["mutation_ids"])
        if not is_leaf:
            chain.extend(tree_nodes[nid]["mutation_ids"])
        # if leaf: own branch is by construction private-only (carrier-set size 1),
        # excluded per spec -- simply don't append this node's own mutation_ids.
        chains[nid] = {
            "chain_mutation_ids": chain,
            "depth": len(ancestors),
            "n_mutations_in_chain": len(chain),
        }
    return chains


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(f"{OUT_DIR}/templates", exist_ok=True)

    # ---- 1+2: tree.json + chains.json ----
    tree = Tree(open(NWK).read().strip(), format=1)
    mutation_ids, sample_ids, matrix = load_aligned_heatmap()
    carrier_groups = build_carrier_groups(mutation_ids, sample_ids, matrix)

    id_of = assign_node_ids(tree)
    tree_nodes, total_mut_assigned = build_tree_json(tree, id_of, carrier_groups)
    chains = build_chains_json(tree, id_of, tree_nodes)

    unassigned_mutation_ids = [m for m in mutation_ids if m not in total_mut_assigned]

    with open(f"{OUT_DIR}/tree.json", 'w') as f:
        json.dump({
            "nodes": tree_nodes,
            "root_id": id_of[id(tree)],
            "unassigned_mutation_ids": unassigned_mutation_ids,
        }, f)
    with open(f"{OUT_DIR}/chains.json", 'w') as f:
        json.dump(chains, f)

    leaves = [n for n in tree_nodes.values() if n["is_leaf"]]
    print(f"node count: {len(tree_nodes)}")
    print(f"leaf count: {len(leaves)} (expect 502)")
    print(f"distinct mutation_ids assigned across all branches: {len(total_mut_assigned)} (expect 315)")
    missing_muts = set(mutation_ids) - total_mut_assigned
    if missing_muts:
        print(f"WARNING: {len(missing_muts)} mutation_ids never matched to any node (kept unassigned, not force-fit):")
        node_leafsets = [frozenset(n.get_leaf_names()) for n in tree.traverse('preorder')]
        for m in sorted(missing_muts):
            mi = mutation_ids.index(m)
            carriers = frozenset(sample_ids[si] for si, v in enumerate(matrix[mi]) if v > 0)
            best = min(node_leafsets, key=lambda ls: len(ls.symmetric_difference(carriers)))
            extra_in_carrier = sorted(carriers - best)
            missing_from_carrier = sorted(best - carriers)
            print(f"  {m}: carrier_n={len(carriers)}, nearest_node_n={len(best)}")
            print(f"    extra sample(s) breaking the match (in data, not in nearest node): {extra_in_carrier}")
            print(f"    sample(s) nearest node has that data doesn't: {missing_from_carrier}")

    # founder-mutation sanity check: mutations present in all 71 kidney sample_ids
    kidney_rows = list(csv.DictReader(open(KIDNEY_LONG_CSV)))
    by_mut_kidney = defaultdict(set)
    for r in kidney_rows:
        if float(r['vaf']) > 0:
            by_mut_kidney[r['mutation_id']].add(r['sample_id'])
    n_kidney_samples = len(set((r['sample_id'], r['kidney']) for r in kidney_rows))
    founder_like = [m for m, s in by_mut_kidney.items() if len(s) == n_kidney_samples]
    print(f"\nkidney 'founder-level' mutations (present in all {n_kidney_samples} kidney samples): {len(founder_like)}")

    root_id = id_of[id(tree)]
    root_chain = set(chains[root_id]["chain_mutation_ids"])
    # depth of each founder-like mutation = shallowest node whose OWN mutation_ids contains it
    depths = {}
    for nid, node in tree_nodes.items():
        for m in node["mutation_ids"]:
            if m in founder_like:
                depths[m] = chains[nid]["depth"] if not node["is_leaf"] else None
    print("founder-like mutation depths in tree (node's own depth, root=0):")
    for m in founder_like:
        print(f"  {m}: depth={depths.get(m, 'NOT FOUND IN TREE')}")

    # ---- 2b: spot-check 2-3 leaf chains ----
    leaf_nodes = [n for n in tree_nodes.values() if n["is_leaf"]]
    sample_leaves = leaf_nodes[:1] + leaf_nodes[len(leaf_nodes) // 2: len(leaf_nodes) // 2 + 1] + leaf_nodes[-1:]
    print("\nspot-check leaf chains:")
    for leaf in sample_leaves:
        c = chains[leaf["id"]]
        print(f"  leaf {leaf['id']} ({leaf['leaf_name']}): depth={c['depth']}, n_mutations_in_chain={c['n_mutations_in_chain']}")
        print(f"    chain: {c['chain_mutation_ids']}")

    # ---- 3: singlecell_heatmap.json ----
    lineage_of = {}
    with open(LINEAGE_CSV, newline='') as f:
        for r in csv.DictReader(f):
            lineage_of[r['sample']] = r['lineage']
    heatmap_out = {
        "mutation_ids": mutation_ids,
        "sample_ids": sample_ids,
        "vaf_matrix": matrix,
        "lineage": [lineage_of.get(s) for s in sample_ids],
    }
    with open(f"{OUT_DIR}/singlecell_heatmap.json", 'w') as f:
        json.dump(heatmap_out, f)

    # ---- 4: kidney_vaf_long.json ----
    kidney_out = []
    for r in kidney_rows:
        kidney_out.append({
            "mutation_id": r["mutation_id"],
            "sample_id": r["sample_id"],
            "kidney": r["kidney"],
            "compartment": r["compartment"],
            "x": float(r["x"]),
            "y": float(r["y"]),
            "vaf": float(r["vaf"]),
        })
    with open(f"{OUT_DIR}/kidney_vaf_long.json", 'w') as f:
        json.dump(kidney_out, f)

    # ---- 5: template svgs ----
    shutil.copy(RIGHT_TEMPLATE, f"{OUT_DIR}/templates/right_kidney_template.svg")
    shutil.copy(LEFT_TEMPLATE, f"{OUT_DIR}/templates/left_kidney_template.svg")

    # ---- 6: manifest.json ----
    manifest = {"donors": ["DB15"]}
    with open("/home/namseop/0_kidney/organogenesis_bulb/data/manifest.json", 'w') as f:
        json.dump(manifest, f, indent=2)

    print("\nfile sizes:")
    for fp in [
        f"{OUT_DIR}/tree.json", f"{OUT_DIR}/chains.json",
        f"{OUT_DIR}/singlecell_heatmap.json", f"{OUT_DIR}/kidney_vaf_long.json",
        f"{OUT_DIR}/templates/right_kidney_template.svg", f"{OUT_DIR}/templates/left_kidney_template.svg",
        "/home/namseop/0_kidney/organogenesis_bulb/data/manifest.json",
    ]:
        print(f"  {fp}: {os.path.getsize(fp)} bytes")


if __name__ == '__main__':
    main()
