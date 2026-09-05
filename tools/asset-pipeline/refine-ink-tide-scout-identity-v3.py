#!/usr/bin/env python3
"""Apply the final bounded blockout identity refinement.

All authored geometry remains independent Three.js primitives, extrusions, and tubes.
The validated GLB contributes only comparison views, named-part bounds, and landmarks;
no vertex, index, topology, material, or binary payload is copied.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any


REFINEMENT_ID = "blockout-source-identity-v3"
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


def replace_exact_string_refs(value: Any, old: str, new: str) -> Any:
    if isinstance(value, dict):
        for key, child in list(value.items()):
            value[key] = replace_exact_string_refs(child, old, new)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            value[index] = replace_exact_string_refs(child, old, new)
    elif value == old:
        return new
    return value


def rename_component(
    spec: dict[str, Any],
    components: dict[str, dict[str, Any]],
    old_id: str,
    new_id: str,
    name: str,
) -> dict[str, Any]:
    if new_id in components:
        component = components[new_id]
    else:
        component = components.pop(old_id)
        replace_exact_string_refs(spec, old_id, new_id)
        component["id"] = new_id
        components[new_id] = component
    component["name"] = name
    component["role"] = "eye-detail"
    return component


def clone_component(
    spec: dict[str, Any],
    components: dict[str, dict[str, Any]],
    source_id: str,
    component_id: str,
    name: str,
) -> dict[str, Any]:
    if component_id in components:
        return components[component_id]
    component = copy.deepcopy(components[source_id])
    component["id"] = component_id
    component["name"] = name
    component["parent"] = "root"
    action = component.get("actionProfile")
    if isinstance(action, dict):
        destruction = action.get("destruction")
        if isinstance(destruction, dict):
            destruction["fractureGroup"] = component_id
    spec["componentTree"].append(component)
    components[component_id] = component
    return component


def set_shape(
    component: dict[str, Any],
    *,
    primitive: str,
    position: list[float],
    scale: list[float],
    material: str,
    geometry: dict[str, Any] | None = None,
) -> None:
    component["parent"] = "root"
    component["primitive"] = primitive
    component["level"] = "macro"
    component["fidelityTier"] = "blockout"
    component["material"] = material
    component["materialLayers"] = [material]
    component["attachment"] = None
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
        "confidence": 0.84,
    }
    component["topologyClass"] = (
        "continuous-sculpt" if primitive in {"tube", "curve-sweep"} else "assembled-solid"
    )
    component["topologyRationale"] = (
        "A swept continuous path is required for the authored curved silhouette."
        if primitive in {"tube", "curve-sweep"}
        else "This is an intentionally discrete procedural volume with a visible semantic boundary."
    )
    descriptor = component.setdefault("geometryDescriptor", {})
    for incompatible in ("profile2D", "tubePath", "latheProfile", "curveSweep", "sdf"):
        descriptor.pop(incompatible, None)
    if geometry:
        descriptor.update(geometry)


def set_limb(
    component: dict[str, Any],
    *,
    start: list[float],
    end: list[float],
    base_radius: float,
    end_radius: float,
    material: str,
) -> None:
    component["parent"] = "root"
    component["primitive"] = "capsule"
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
        "parentSocket": f"identity-{component['id']}-root",
        "localStart": start,
        "localEnd": end,
        "contactType": "embedded",
        "baseRadius": base_radius,
        "endRadius": end_radius,
        "embedDepth": min(base_radius, end_radius) * 0.42,
        "gapTolerance": 0.004,
        "evidenceRefs": ["source-turnaround-landmarks"],
    }


def activate(blockout_refs: list[str], *component_ids: str) -> None:
    for component_id in component_ids:
        if component_id not in blockout_refs:
            blockout_refs.append(component_id)


def main() -> int:
    args = parse_args()
    source = args.spec.expanduser().resolve()
    if args.in_place == bool(args.out):
        raise ValueError("choose exactly one of --in-place or --out")
    target = source if args.in_place else args.out.expanduser().resolve()
    spec = json.loads(source.read_text(encoding="utf-8"))
    if spec.get("glbMediatedBaseline", {}).get("glb", {}).get("sha256") != EXPECTED_GLB_SHA256:
        raise RuntimeError("validated GLB baseline hash changed")
    refinements = spec.setdefault("glbMediatedRefinements", [])
    existing_refinement = next(
        (
            item
            for item in refinements
            if isinstance(item, dict) and item.get("id") == REFINEMENT_ID
        ),
        None,
    )

    components = component_map(spec)
    for side in ("l", "r"):
        rename_component(
            spec,
            components,
            f"eye-cavity-{side}",
            f"iris-{side}",
            f"Teal iris {side.upper()}",
        )
    blockout_pass = next(
        item
        for item in spec.get("buildPasses", [])
        if isinstance(item, dict) and item.get("id") == "blockout"
    )
    blockout_refs = blockout_pass.setdefault("componentRefs", [])

    # Rounded torso and two independent hip/short volumes fix the slab silhouette
    # while preserving separately addressable garment pieces.
    set_shape(
        components["inner-top-shell"],
        primitive="ellipsoid",
        position=[0.0, 0.91, 0.01],
        scale=[0.31, 0.43, 0.255],
        material="mint",
    )
    set_shape(
        components["shorts-shell"],
        primitive="ellipsoid",
        position=[-0.087, 0.625, 0.005],
        scale=[0.235, 0.30, 0.275],
        material="teal",
    )
    shorts_right = clone_component(
        spec, components, "shorts-shell", "shorts-shell-r", "Right fitted shorts volume"
    )
    set_shape(
        shorts_right,
        primitive="ellipsoid",
        position=[0.087, 0.625, 0.005],
        scale=[0.235, 0.30, 0.275],
        material="teal",
    )
    activate(blockout_refs, "shorts-shell-r")

    # Open-front cropped jacket: the concave polygon exposes the mint top and
    # retains a short coral bridge at the lower edge.
    set_shape(
        components["jacket-shell"],
        primitive="extrude",
        position=[0.0, 1.035, -0.105],
        scale=[1.0, 1.0, 1.0],
        material="coral",
        geometry={
            "profile2D": {
                "points": [
                    [-0.19, -0.10], [0.19, -0.10], [0.205, 0.075],
                    [0.155, 0.13], [0.045, 0.13], [0.045, -0.045],
                    [-0.045, -0.045], [-0.045, 0.13], [-0.155, 0.13],
                    [-0.205, 0.075],
                ],
                "depth": 0.225,
            }
        },
    )

    # Layered front bangs and side locks keep the face readable from front and orbit.
    set_shape(
        components["hair-lock-system"],
        primitive="extrude",
        position=[0.0, 1.385, 0.125],
        scale=[1.0, 1.0, 1.0],
        material="hair",
        geometry={
            "profile2D": {
                "points": [
                    [-0.135, 0.075], [0.135, 0.075], [0.115, -0.015],
                    [0.078, 0.025], [0.043, -0.045], [0.0, 0.018],
                    [-0.043, -0.045], [-0.078, 0.025], [-0.115, -0.015],
                ],
                "depth": 0.025,
            }
        },
    )
    for side, x in (("l", -0.135), ("r", 0.135)):
        lock = clone_component(
            spec, components, "hair-lock-system", f"hair-side-lock-{side}", f"Bob side lock {side.upper()}"
        )
        set_shape(
            lock,
            primitive="extrude",
            position=[x, 1.285, 0.04],
            scale=[1.0, 1.0, 1.0],
            material="hair",
            geometry={
                "profile2D": {
                    "points": [[-0.035, 0.11], [0.035, 0.11], [0.026, -0.12], [0.0, -0.16], [-0.028, -0.12]],
                    "depth": 0.075,
                }
            },
        )
        activate(blockout_refs, f"hair-side-lock-{side}")

    # Layered eye construction: pale sclera, teal iris, and dark pupil.
    for side, x in (("l", -0.043), ("r", 0.043)):
        set_shape(
            components[f"eye-{side}"],
            primitive="ellipsoid",
            position=[x, 1.33, 0.142],
            scale=[0.048, 0.044, 0.018],
            material="trim-white",
        )
        set_shape(
            components[f"iris-{side}"],
            primitive="ellipsoid",
            position=[x, 1.33, 0.153],
            scale=[0.029, 0.036, 0.014],
            material="eye",
        )
        components[f"iris-{side}"]["role"] = "eye-detail"
        pupil = clone_component(
            spec, components, f"iris-{side}", f"pupil-{side}", f"Dark pupil {side.upper()}"
        )
        set_shape(
            pupil,
            primitive="ellipsoid",
            position=[x, 1.33, 0.161],
            scale=[0.010, 0.022, 0.008],
            material="eye-dark",
        )
        pupil["role"] = "eye-detail"
        activate(blockout_refs, f"iris-{side}", f"pupil-{side}")

    # Pale inner ear insets sit just in front of the outer hair-colour triangles.
    for side, x in (("l", -0.132), ("r", 0.132)):
        inner = clone_component(
            spec, components, f"cat-ear-{side}", f"cat-ear-inner-{side}", f"Inner cat ear {side.upper()}"
        )
        set_shape(
            inner,
            primitive="extrude",
            position=[x, 1.47, 0.077],
            scale=[1.0, 1.0, 1.0],
            material="ear-inner",
            geometry={
                "profile2D": {
                    "points": [[-0.035, -0.037], [0.035, -0.037], [0.0, 0.046]],
                    "depth": 0.012,
                }
            },
        )
        activate(blockout_refs, f"cat-ear-inner-{side}")

    # White sleeve cuffs overlay the coral upper-arm endpoints.
    set_limb(
        components["sleeve-cuff-l"],
        start=[0.255, 0.975, 0.035], end=[0.302, 0.92, 0.046],
        base_radius=0.064, end_radius=0.057, material="trim-white",
    )
    set_limb(
        components["sleeve-cuff-r"],
        start=[-0.255, 0.975, 0.035], end=[-0.302, 0.92, 0.046],
        base_radius=0.064, end_radius=0.057, material="trim-white",
    )
    activate(blockout_refs, "sleeve-cuff-l", "sleeve-cuff-r")

    # Boot shafts stop at the ankle; independent toe, sole, and coral strap parts
    # provide the characteristic panelled boot silhouette and depth.
    for side, x in (("l", 0.15), ("r", -0.15)):
        set_shape(
            components[f"boot-{side}"],
            primitive="extrude",
            position=[x, 0.15, -0.065],
            scale=[1.0, 1.0, 1.0],
            material="trim-white",
            geometry={
                "profile2D": {
                    "points": [[-0.066, -0.11], [0.066, -0.11], [0.074, 0.11], [-0.074, 0.11]],
                    "depth": 0.15,
                }
            },
        )
        set_shape(
            components[f"foot-{side}"],
            primitive="extrude",
            position=[x, 0.055, -0.07],
            scale=[1.0, 1.0, 1.0],
            material="trim-white",
            geometry={
                "profile2D": {
                    "points": [[-0.078, -0.045], [0.078, -0.045], [0.072, 0.045], [-0.060, 0.045]],
                    "depth": 0.27,
                }
            },
        )
        sole = clone_component(
            spec, components, f"foot-{side}", f"boot-sole-{side}", f"Teal boot sole {side.upper()}"
        )
        set_shape(
            sole,
            primitive="box",
            position=[x, 0.012, 0.045],
            scale=[0.168, 0.025, 0.255],
            material="teal",
        )
        strap = clone_component(
            spec, components, f"boot-{side}", f"boot-strap-{side}", f"Coral ankle strap {side.upper()}"
        )
        set_shape(
            strap,
            primitive="box",
            position=[x, 0.218, 0.005],
            scale=[0.165, 0.035, 0.17],
            material="coral",
        )
        activate(
            blockout_refs,
            f"foot-{side}", f"boot-sole-{side}", f"boot-strap-{side}",
        )

    # Belt buckle and two-part J-tail preserve small, high-value source cues.
    set_shape(
        components["pendant"],
        primitive="box",
        position=[0.0, 0.765, 0.145],
        scale=[0.052, 0.054, 0.027],
        material="trim-white",
    )
    activate(blockout_refs, "pendant")
    tail_descriptor = components["tail-assembly"].setdefault("geometryDescriptor", {})
    tail_descriptor["tubePath"] = {
        "points": [
            [0.0, 0.79, -0.12], [0.0, 0.72, -0.20], [0.0, 0.60, -0.255],
            [0.0, 0.47, -0.25], [0.0, 0.38, -0.235], [0.0, 0.32, -0.215],
        ],
        "radius": 0.027,
        "radialSegments": 12,
        "closed": False,
    }
    tail_tip = clone_component(
        spec, components, "tail-assembly", "tail-tip-geometry", "Dark tail tip"
    )
    set_shape(
        tail_tip,
        primitive="tube",
        position=[0.0, 0.0, 0.0],
        scale=[1.0, 1.0, 1.0],
        material="tail-tip",
        geometry={
            "tubePath": {
                "points": [[0.0, 0.34, -0.222], [0.0, 0.30, -0.207], [0.0, 0.25, -0.19]],
                "radius": 0.028,
                "radialSegments": 12,
                "closed": False,
            }
        },
    )
    tail_tip["parent"] = None
    activate(blockout_refs, "tail-tip-geometry")

    refinement_record = {
            "id": REFINEMENT_ID,
            "route": "source-identity-plus-glb-silhouette",
            "glbSha256": EXPECTED_GLB_SHA256,
            "copyPolicy": "independent-primitives-only-no-vertex-or-topology-copy",
            "sourceEvidence": [
                "original front profile rear turnaround",
                "browser-rendered multipart GLB comparison views",
                "official Tier 1 silhouette result 0.7675",
            ],
            "changes": [
                "rounded torso and separately addressable left/right shorts volumes",
                "open-front cropped jacket and layered bob bangs/side locks",
                "sclera iris pupil and inner-ear layers",
                "white sleeve cuffs and multi-part boots with sole and ankle strap",
                "belt buckle and independently coloured tail tip",
            ],
            "knownLimitations": [
                "Primitive/extrude assembly cannot reproduce fitted cloth folds or anime facial topology.",
                "The GLB comparison baseline itself diverges materially from the supplied turnaround.",
                "The pinned generator linearizes attached tube paths, so J-tail pieces remain world-space components.",
            ],
        }
    if existing_refinement is None:
        refinements.append(refinement_record)
    else:
        existing_refinement.clear()
        existing_refinement.update(refinement_record)

    blockout_pass["acceptance"] = [
        "Cat ears with inner panels, layered bob and bangs, open cropped jacket, split shorts, panelled boots, and two-tone J-tail are visible.",
        "Humanoid proportions and A-pose read in front, orbit, profile, and rear views without material maps.",
        "The model remains grounded and uses independent code geometry with no runtime GLB/image dependency.",
    ]

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "GO",
                "refinement": REFINEMENT_ID,
                "operation": "updated" if existing_refinement is not None else "applied",
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
