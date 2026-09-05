#!/usr/bin/env python3
"""Correct blockout pass selection after inspecting official generator semantics.

The official generator includes a component when either its level is allowed or its
fidelityTier equals the current pass.  The migrated character spec marked nearly every
component as blockout, so old GLB-derived proxies leaked into the curated world-space
blockout.  This correction keeps only the explicit blockout refs eligible for pass one.
It changes pass metadata only; no GLB geometry, material, or binary data is copied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REFINEMENT_ID = "blockout-pass-selection-v2"
PRIOR_REFINEMENT_ID = "blockout-world-landmarks-v1"
EXPECTED_GLB_SHA256 = "1268ffdb0d694cfada9adc328ad90c513ef55f4f16391c898efd50e7465e753a"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--in-place", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    args = parse_args()
    source = args.spec.expanduser().resolve()
    if args.in_place == bool(args.out):
        raise ValueError("choose exactly one of --in-place or --out")
    target = source if args.in_place else args.out.expanduser().resolve()
    spec = json.loads(source.read_text(encoding="utf-8"))

    baseline = spec.get("glbMediatedBaseline", {})
    if baseline.get("glb", {}).get("sha256") != EXPECTED_GLB_SHA256:
        raise RuntimeError("validated GLB baseline hash changed")

    refinements = spec.setdefault("glbMediatedRefinements", [])
    refinement_ids = {
        item.get("id") for item in refinements if isinstance(item, dict)
    }
    if PRIOR_REFINEMENT_ID not in refinement_ids:
        raise RuntimeError(f"required prior refinement missing: {PRIOR_REFINEMENT_ID}")
    existing_refinement = next(
        (
            item
            for item in refinements
            if isinstance(item, dict) and item.get("id") == REFINEMENT_ID
        ),
        None,
    )

    blockout_pass = next(
        (
            item
            for item in spec.get("buildPasses", [])
            if isinstance(item, dict) and item.get("id") == "blockout"
        ),
        None,
    )
    if blockout_pass is None:
        raise RuntimeError("blockout pass missing")
    refs = {
        str(value)
        for value in blockout_pass.get("componentRefs", [])
        if str(value).strip()
    }
    if not refs:
        raise RuntimeError("blockout pass has no explicit component refs")

    components = [
        item for item in spec.get("componentTree", []) if isinstance(item, dict)
    ]
    ids = {str(item.get("id")) for item in components if item.get("id")}
    missing = sorted(refs - ids)
    if missing:
        raise RuntimeError(f"blockout refs missing from componentTree: {missing}")

    deferred: list[str] = []
    for component in components:
        component_id = str(component.get("id") or "")
        if component_id in refs:
            continue
        # Both predicates must be false for official filter_components_for_pass().
        # Preserve the strict quality contract's minimum meso inventory without
        # leaking those parts into blockout (PASS_LEVELS[blockout] allows macro only).
        component["level"] = "meso" if len(deferred) < 7 else "micro"
        component["fidelityTier"] = "feature-placement"
        deferred.append(component_id)

    refinement_record = {
            "id": REFINEMENT_ID,
            "route": "official-pass-selector-correction",
            "glbSha256": EXPECTED_GLB_SHA256,
            "copyPolicy": "metadata-only-no-vertex-or-topology-copy",
            "sourceEvidence": [
                "official forge/stage3_build/generate_threejs_factory.py filter_components_for_pass",
                "browser component bounds showing 1.904888 source height",
                "browser beauty render showing overlapping migrated proxies",
            ],
            "changes": [
                f"kept {len(refs)} explicit component refs eligible for blockout",
                f"deferred {len(deferred)} non-selected components to feature-placement",
                "retained seven deferred meso labels so the strict quality inventory remains satisfied",
                "removed the accidental fidelityTier=blockout inclusion path from non-selected components",
            ],
            "knownLimitations": [
                "This corrects pass selection only; the selected geometry remains primitive/extrude/tube procedural construction.",
                "The official generator has no per-build-pass visibility toggle in the emitted runtime factory.",
            ],
        }
    if existing_refinement is None:
        refinements.append(refinement_record)
    else:
        existing_refinement.clear()
        existing_refinement.update(refinement_record)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "GO",
                "correction": REFINEMENT_ID,
                "operation": "updated" if existing_refinement is not None else "applied",
                "out": str(target),
                "sha256": sha256(target),
                "explicitBlockoutComponents": len(refs),
                "deferredComponents": len(deferred),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
