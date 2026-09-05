#!/usr/bin/env python3
"""Apply the first GLB-mediated blockout refinement to the Ink Tide Scout spec.

This uses only semantic bounds and visible landmarks from the validated multipart GLB.
It does not read or copy GLB vertices, indices, topology, materials, or binary payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


REFINEMENT_ID = "blockout-world-landmarks-v1"
EXPECTED_GLB_SHA256 = "1268ffdb0d694cfada9adc328ad90c513ef55f4f16391c898efd50e7465e753a"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--in-place", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def component_map(spec: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(component.get("id")): component
        for component in spec.get("componentTree", [])
        if isinstance(component, dict) and component.get("id")
    }


def set_shape(
    components: dict[str, dict[str, Any]],
    component_id: str,
    *,
    parent: str | None,
    primitive: str,
    position: list[float],
    scale: list[float],
    material: str | None = None,
    geometry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    component = components[component_id]
    component["parent"] = parent
    component["primitive"] = primitive
    component["level"] = "macro"
    component["fidelityTier"] = "blockout"
    component["transform"] = {
        "position": position,
        "rotation": [0.0, 0.0, 0.0],
        "scale": scale,
    }
    component["dimensions"] = {
        "width": scale[0],
        "height": scale[1],
        "depth": scale[2],
        "units": "world-meters",
        "confidence": 0.86,
    }
    if material is not None:
        component["material"] = material
        component["materialLayers"] = [material]
    if geometry is not None:
        descriptor = component.setdefault("geometryDescriptor", {})
        descriptor.update(geometry)
    component["attachment"] = None
    return component


def set_limb(
    components: dict[str, dict[str, Any]],
    component_id: str,
    *,
    start: list[float],
    end: list[float],
    base_radius: float,
    end_radius: float,
    material: str,
) -> None:
    component = components[component_id]
    component["parent"] = "root"
    component["level"] = "macro"
    component["fidelityTier"] = "blockout"
    component["material"] = material
    component["materialLayers"] = [material]
    component["transform"] = {
        "position": start,
        "rotation": [0.0, 0.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
    }
    component["attachment"] = {
        "parentId": "root",
        "parentSocket": f"blockout-{component_id}-root",
        "localStart": start,
        "localEnd": end,
        "contactType": "embedded",
        "baseRadius": base_radius,
        "endRadius": end_radius,
        "embedDepth": min(base_radius, end_radius) * 0.45,
        "gapTolerance": 0.004,
        "evidenceRefs": ["glb-mediated-semantic-bounds"],
    }


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
    if any(item.get("id") == REFINEMENT_ID for item in refinements if isinstance(item, dict)):
        raise RuntimeError(f"refinement already applied: {REFINEMENT_ID}")
    components = component_map(spec)

    # Do not let the original generic torso chain leak into the curated blockout merely because
    # it was macro-level. The selected world-space parts below are explicit pass references.
    for component_id in ("pelvis", "abdomen", "chest"):
        components[component_id]["level"] = "meso"
        components[component_id]["fidelityTier"] = "proportion-lock"

    set_shape(
        components,
        "neck",
        parent=None,
        primitive="ellipsoid",
        position=[0.0, 1.165, 0.015],
        scale=[0.09, 0.15, 0.09],
        material="skin",
    )
    components["neck"]["level"] = "meso"
    set_shape(
        components,
        "head",
        parent="root",
        primitive="ellipsoid",
        position=[0.0, 1.31, 0.035],
        scale=[0.235, 0.255, 0.205],
        material="skin",
    )
    set_shape(
        components,
        "hair",
        parent="root",
        primitive="ellipsoid",
        position=[0.0, 1.35, -0.01],
        scale=[0.30, 0.235, 0.19],
        material="hair",
    )
    set_shape(
        components,
        "hair-lock-system",
        parent="root",
        primitive="extrude",
        position=[0.0, 1.315, -0.115],
        scale=[1.0, 1.0, 1.0],
        material="hair",
        geometry={
            "profile2D": {
                "points": [
                    [-0.145, 0.115],
                    [0.145, 0.115],
                    [0.155, -0.065],
                    [0.115, -0.155],
                    [0.065, -0.18],
                    [0.0, -0.145],
                    [-0.065, -0.18],
                    [-0.115, -0.155],
                    [-0.155, -0.065],
                ],
                "depth": 0.10,
            }
        },
    )
    for component_id, x in (("cat-ear-l", -0.132), ("cat-ear-r", 0.132)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="extrude",
            position=[x, 1.47, -0.005],
            scale=[1.0, 1.0, 1.0],
            material="hair",
            geometry={
                "profile2D": {
                    "points": [[-0.055, -0.055], [0.055, -0.055], [0.0, 0.075]],
                    "depth": 0.08,
                }
            },
        )

    for component_id, x in (("eye-l", -0.043), ("eye-r", 0.043)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="ellipsoid",
            position=[x, 1.33, 0.139],
            scale=[0.036, 0.043, 0.018],
            material="eye",
        )
    for component_id, x in (("brow-l", -0.043), ("brow-r", 0.043)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="box",
            position=[x, 1.37, 0.143],
            scale=[0.045, 0.008, 0.008],
            material="hair",
        )
    set_shape(
        components,
        "mouth",
        parent="root",
        primitive="box",
        position=[0.0, 1.265, 0.142],
        scale=[0.055, 0.008, 0.008],
        material="lips",
    )

    set_shape(
        components,
        "inner-top-shell",
        parent="root",
        primitive="extrude",
        position=[0.0, 0.86, -0.10],
        scale=[1.0, 1.0, 1.0],
        material="mint",
        geometry={
            "profile2D": {
                "points": [[-0.17, -0.18], [0.17, -0.18], [0.16, 0.18], [-0.16, 0.18]],
                "depth": 0.22,
            }
        },
    )
    set_shape(
        components,
        "jacket-shell",
        parent="root",
        primitive="extrude",
        position=[0.0, 1.025, -0.105],
        scale=[1.0, 1.0, 1.0],
        material="coral",
        geometry={
            "profile2D": {
                "points": [
                    [-0.19, -0.11],
                    [0.19, -0.11],
                    [0.205, 0.08],
                    [0.16, 0.13],
                    [-0.16, 0.13],
                    [-0.205, 0.08],
                ],
                "depth": 0.23,
            }
        },
    )
    set_shape(
        components,
        "shorts-shell",
        parent="root",
        primitive="extrude",
        position=[0.0, 0.64, -0.105],
        scale=[1.0, 1.0, 1.0],
        material="teal",
        geometry={
            "profile2D": {
                "points": [[-0.19, -0.145], [0.19, -0.145], [0.175, 0.15], [-0.175, 0.15]],
                "depth": 0.235,
            }
        },
    )
    set_shape(
        components,
        "belt-assembly",
        parent="root",
        primitive="box",
        position=[0.0, 0.765, 0.125],
        scale=[0.34, 0.035, 0.026],
        material="trim-white",
    )

    set_limb(
        components,
        "upper-arm-l",
        start=[0.16, 1.075, 0.015],
        end=[0.30, 0.92, 0.045],
        base_radius=0.061,
        end_radius=0.052,
        material="coral",
    )
    set_limb(
        components,
        "forearm-l",
        start=[0.30, 0.92, 0.045],
        end=[0.405, 0.79, 0.085],
        base_radius=0.050,
        end_radius=0.040,
        material="skin",
    )
    set_limb(
        components,
        "upper-arm-r",
        start=[-0.16, 1.075, 0.015],
        end=[-0.30, 0.92, 0.045],
        base_radius=0.061,
        end_radius=0.052,
        material="coral",
    )
    set_limb(
        components,
        "forearm-r",
        start=[-0.30, 0.92, 0.045],
        end=[-0.405, 0.79, 0.085],
        base_radius=0.050,
        end_radius=0.040,
        material="skin",
    )
    for component_id, x in (("hand-l", 0.42), ("hand-r", -0.42)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="ellipsoid",
            position=[x, 0.755, 0.10],
            scale=[0.065, 0.09, 0.055],
            material="skin",
        )
    for component_id, x in (("glove-l", 0.42), ("glove-r", -0.42)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="ellipsoid",
            position=[x, 0.775, 0.10],
            scale=[0.072, 0.073, 0.065],
            material="teal",
        )

    set_limb(
        components,
        "thigh-l",
        start=[0.095, 0.68, 0.02],
        end=[0.12, 0.40, 0.03],
        base_radius=0.100,
        end_radius=0.078,
        material="skin",
    )
    set_limb(
        components,
        "shin-l",
        start=[0.12, 0.40, 0.03],
        end=[0.145, 0.145, 0.045],
        base_radius=0.076,
        end_radius=0.056,
        material="skin",
    )
    set_limb(
        components,
        "thigh-r",
        start=[-0.095, 0.68, 0.02],
        end=[-0.12, 0.40, 0.03],
        base_radius=0.100,
        end_radius=0.078,
        material="skin",
    )
    set_limb(
        components,
        "shin-r",
        start=[-0.12, 0.40, 0.03],
        end=[-0.145, 0.145, 0.045],
        base_radius=0.076,
        end_radius=0.056,
        material="skin",
    )
    for component_id, x in (("boot-l", 0.15), ("boot-r", -0.15)):
        set_shape(
            components,
            component_id,
            parent="root",
            primitive="extrude",
            position=[x, 0.13, -0.055],
            scale=[1.0, 1.0, 1.0],
            material="trim-white",
            geometry={
                "profile2D": {
                    "points": [[-0.065, -0.13], [0.065, -0.13], [0.072, 0.13], [-0.072, 0.13]],
                    "depth": 0.25,
                }
            },
        )

    set_shape(
        components,
        "tail-assembly",
        parent=None,
        primitive="tube",
        position=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
        material="hair",
        geometry={
            "tubePath": {
                "points": [
                    [0.0, 0.79, -0.12],
                    [0.0, 0.72, -0.20],
                    [0.0, 0.60, -0.255],
                    [0.0, 0.47, -0.25],
                    [0.0, 0.34, -0.225],
                    [0.0, 0.25, -0.19],
                ],
                "radius": 0.027,
                "radialSegments": 12,
                "closed": False,
            }
        },
    )
    components["tail-assembly"]["topologyClass"] = "continuous-sculpt"
    components["tail-assembly"]["topologyRationale"] = (
        "A free world-space tube preserves the measured J curve; the pinned generator turns any attached tube into a straight cylinder."
    )

    set_shape(
        components,
        "ahoge",
        parent=None,
        primitive="tube",
        position=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
        material="hair",
        geometry={
            "tubePath": {
                "points": [
                    [0.0, 1.455, -0.01],
                    [-0.012, 1.50, -0.005],
                    [0.004, 1.545, 0.0],
                    [0.035, 1.555, 0.004],
                ],
                "radius": 0.012,
                "radialSegments": 10,
                "closed": False,
            }
        },
    )

    blockout_refs = [
        "root",
        "neck",
        "head",
        "hair",
        "hair-lock-system",
        "cat-ear-l",
        "cat-ear-r",
        "brow-l",
        "brow-r",
        "eye-l",
        "eye-r",
        "mouth",
        "inner-top-shell",
        "jacket-shell",
        "shorts-shell",
        "belt-assembly",
        "upper-arm-l",
        "forearm-l",
        "hand-l",
        "glove-l",
        "upper-arm-r",
        "forearm-r",
        "hand-r",
        "glove-r",
        "thigh-l",
        "shin-l",
        "boot-l",
        "thigh-r",
        "shin-r",
        "boot-r",
        "tail-assembly",
        "ahoge",
    ]
    for build_pass in spec.get("buildPasses", []):
        if isinstance(build_pass, dict) and build_pass.get("id") == "blockout":
            build_pass["componentRefs"] = blockout_refs
            build_pass["acceptance"] = [
                "Cat ears, layered bob mass, cropped jacket, shorts, boots, and J-shaped tail are visible in silhouette.",
                "Humanoid proportions and A-pose read correctly without material maps.",
                "The world-space model is grounded near Y=0 and fits the shared 1.92-unit orthographic frame.",
            ]

    refinements.append(
        {
            "id": REFINEMENT_ID,
            "route": "independent-primitives-from-semantic-bounds",
            "glbSha256": EXPECTED_GLB_SHA256,
            "copyPolicy": "bounds-and-landmarks-only-no-vertex-or-topology-copy",
            "sourceEvidence": [
                "browser-rendered GLB reference views",
                "named multipart GLB semantic bounds",
                "blockout Tier 1 silhouette failure",
            ],
            "changes": [
                "curated critical identity parts into the blockout pass",
                "re-authored macro parts in a shared world-space coordinate frame",
                "replaced the straight attached tail with an independent J-shaped tube path",
                "added world-space cat ears, bob mass, clothing shells, gloves, boots, and ahoge",
            ],
            "knownLimitations": [
                "Tail visual continuity is present but attachment metadata is deferred because the pinned generator linearizes attached tubes.",
                "Garment forms remain coarse extrusions and are not fitted cloth topology.",
                "Face, fingers, seams, cuffs, buckle depth, and hair clumps remain later-pass work.",
            ],
        }
    )

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "GO",
                "refinement": REFINEMENT_ID,
                "out": str(target),
                "sha256": sha256(target),
                "blockoutComponentCount": len(blockout_refs),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
