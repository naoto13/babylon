#!/usr/bin/env python3
"""Create a fresh GLB-mediated Ink Tide Scout spec from validated semantic decisions.

The source spec contributes only reference-derived hierarchy, materials, detail mappings,
and quality contracts. Prior factory review evidence and loop state are intentionally reset.
The GLB is recorded as a comparison baseline; its geometry is never copied into the spec.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


IMG2THREEJS_COMMIT = "d6673386f89673a58736f8d398dd16ece67874f5"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-spec", type=Path, required=True)
    parser.add_argument("--glb-probe", type=Path, required=True)
    parser.add_argument("--blender-build", type=Path, required=True)
    parser.add_argument("--blender-validate", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def main() -> int:
    args = parse_args()
    paths = {
        "source_spec": args.source_spec.expanduser().resolve(),
        "glb_probe": args.glb_probe.expanduser().resolve(),
        "blender_build": args.blender_build.expanduser().resolve(),
        "blender_validate": args.blender_validate.expanduser().resolve(),
        "out": args.out.expanduser().resolve(),
    }
    for key, path in paths.items():
        if key != "out" and not path.is_file():
            raise FileNotFoundError(f"missing {key}: {path}")

    spec = load_json(paths["source_spec"])
    probe = load_json(paths["glb_probe"])
    build = load_json(paths["blender_build"])
    validate = load_json(paths["blender_validate"])

    if probe.get("referenceReadiness") != "pass":
        raise RuntimeError("img2threejs GLB probe is not reference-ready")
    if probe.get("semanticDecomposition", {}).get("status") != "rich":
        raise RuntimeError("GLB semantic decomposition is not rich")
    if build.get("status") != "GO" or validate.get("status") != "GO":
        raise RuntimeError("Blender build or fresh-process GLB validation is not GO")
    if build["result"]["glb"]["sha256"] != probe.get("sha256"):
        raise RuntimeError("GLB hash differs between Blender build and img2threejs probe")
    if validate["result"]["glb"]["sha256"] != probe.get("sha256"):
        raise RuntimeError("GLB hash differs between fresh-process validation and img2threejs probe")

    prior_reviews = list(spec.get("reviewHistory", []))
    converted_rotations = []
    for component in spec.get("componentTree", []):
        transform = component.get("transform") if isinstance(component, dict) else None
        rotation = transform.get("rotation") if isinstance(transform, dict) else None
        if not isinstance(rotation, list) or len(rotation) != 3:
            continue
        if not any(abs(float(value)) > math.tau for value in rotation):
            continue
        radians = [math.radians(float(value)) for value in rotation]
        transform["rotation"] = radians
        converted_rotations.append(
            {"componentId": component.get("id"), "degrees": rotation, "radians": radians}
        )
    spec["targetName"] = "Ink Tide Scout GLB-Mediated"
    spec["targetId"] = "ink-tide-scout-glb-mediated"
    spec["visualEvidence"] = []
    spec["reviewHistory"] = []
    pipeline = spec.setdefault("sculptPipeline", {})
    pipeline["currentPass"] = "blockout"
    pipeline["completedPasses"] = []
    pipeline["lastCompletedPass"] = ""
    pipeline["blockedReason"] = ""
    pipeline["nextRequiredEvidence"] = [
        "Render the multipart GLB through the shared Three.js render profile.",
        "Render the independent procedural blockout through that same profile.",
        "Capture beauty, alpha-silhouette, semantic-id, depth, normal, and roughness-material-id passes.",
        "Record one comparison-backed review action before unlocking the next pass.",
    ]

    assumptions = spec.setdefault("assumptions", [])
    for statement in (
        "The multipart GLB is a structural and visual comparison baseline only.",
        "No GLB vertex, index, topology, material, skin, animation, or binary payload may be copied or encoded into the TypeScript factory.",
        "The prior primitive-route review history is archived as provenance and is not acceptance evidence for this route.",
        "Static blockout evidence is not rigging or animation evidence.",
    ):
        if statement not in assumptions:
            assumptions.append(statement)

    spec["glbMediatedBaseline"] = {
        "schemaVersion": 1,
        "img2threejsCommit": IMG2THREEJS_COMMIT,
        "route": "independent-procedural-factory",
        "copyPolicy": "comparison-only-no-geometry-copy",
        "glb": {
            "path": probe["path"],
            "sha256": probe["sha256"],
            "bytes": probe["bytes"],
            "scene": probe["scene"],
            "semanticDecomposition": probe["semanticDecomposition"],
            "referenceReadiness": probe["referenceReadiness"],
            "warnings": probe.get("warnings", []),
        },
        "blenderBuild": {
            "path": str(paths["blender_build"]),
            "sha256": sha256(paths["blender_build"]),
            "status": build["status"],
            "triangles": build["result"]["inventory"]["triangles"],
            "meshCount": build["result"]["inventory"]["meshCount"],
            "nonFiniteVertexCount": build["result"]["inventory"]["nonFiniteVertexCount"],
        },
        "freshImportValidation": {
            "path": str(paths["blender_validate"]),
            "sha256": sha256(paths["blender_validate"]),
            "status": validate["status"],
            "triangles": validate["result"]["inventory"]["triangles"],
            "meshCount": validate["result"]["inventory"]["meshCount"],
            "nonFiniteVertexCount": validate["result"]["inventory"]["nonFiniteVertexCount"],
            "dimensions": validate["result"]["dimensions"],
        },
        "visualStatus": {
            "verdict": "VISUAL_NO-GO",
            "reason": "The baseline is structurally useful but still under-resolves the anime face, layered bob silhouette, garment seams, and boot integration.",
        },
        "priorRoute": {
            "sourceSpecPath": str(paths["source_spec"]),
            "sourceSpecSha256": sha256(paths["source_spec"]),
            "archivedReviewCount": len(prior_reviews),
            "reviewEvidenceReused": False,
        },
        "specCorrections": {
            "degreeAuthoredComponentRotationsConvertedToRadians": converted_rotations,
            "reason": "Three.js Euler.set consumes radians; the source anatomy evidence records pose angles in degrees.",
        },
    }

    paths["out"].parent.mkdir(parents=True, exist_ok=True)
    paths["out"].write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "GO",
                "out": str(paths["out"]),
                "sha256": sha256(paths["out"]),
                "componentCount": len(spec.get("componentTree", [])),
                "reviewHistoryReset": len(prior_reviews),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
