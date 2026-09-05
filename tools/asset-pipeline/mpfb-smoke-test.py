#!/usr/bin/env python3
"""Run the isolated MPFB -> GLB -> Blender readback smoke test.

Invoke this script through Blender. It intentionally uses only the already-enabled
MPFB extension in BLENDER_USER_EXTENSIONS and never downloads assets itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import tomllib
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


ADDON_ID = "bl_ext.blender_org.mpfb"
EXPECTED_MPFB_VERSION = "2.0.17"
EXPECTED_BLENDER_VERSION = (5, 2, 0)
EXPECTED_MPFB_EXTENSION_TREE_SHA256 = "63c2b6fbe3b5b211469841d60a1817192eae7aede166065538e61b575d4f8cca"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("create", "reimport"), required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def tree_sha256(root: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    files = sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix != ".pyc" and "__pycache__" not in path.parts
    )
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(sha256(path)))
    return digest.hexdigest(), len(files)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds_for(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return {
        "min": [min(point[index] for point in points) for index in range(3)],
        "max": [max(point[index] for point in points) for index in range(3)],
    }


def inspect_meshes(objects: list[bpy.types.Object]) -> dict[str, Any]:
    meshes = [obj for obj in objects if obj.type == "MESH"]
    non_finite = 0
    max_vertex_group_memberships = 0
    mesh_records = []

    for obj in meshes:
        for vertex in obj.data.vertices:
            if not all(math.isfinite(value) for value in vertex.co):
                non_finite += 1
            max_vertex_group_memberships = max(max_vertex_group_memberships, len(vertex.groups))
        mesh_records.append(
            {
                "name": obj.name,
                "vertices": len(obj.data.vertices),
                "edges": len(obj.data.edges),
                "polygons": len(obj.data.polygons),
                "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                "vertexGroups": len(obj.vertex_groups),
                "modifiers": [modifier.type for modifier in obj.modifiers],
            }
        )

    return {
        "meshes": mesh_records,
        "meshCount": len(meshes),
        "nonFiniteVertexCount": non_finite,
        "maxVertexGroupMemberships": max_vertex_group_memberships,
        "bounds": bounds_for(meshes) if meshes else None,
    }


def extension_info() -> dict[str, Any]:
    if ADDON_ID not in bpy.context.preferences.addons:
        raise RuntimeError(f"MPFB extension is not enabled: {ADDON_ID}")

    module = __import__(ADDON_ID, fromlist=["__file__"])
    extension_dir = Path(module.__file__).resolve().parent
    manifest_path = extension_dir / "blender_manifest.toml"
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != EXPECTED_MPFB_VERSION:
        raise RuntimeError(
            f"unexpected MPFB version: {manifest.get('version')!r}, expected {EXPECTED_MPFB_VERSION!r}"
        )

    preferences = bpy.context.preferences.addons[ADDON_ID].preferences
    external_roots = {
        "mpfb_user_data": getattr(preferences, "mpfb_user_data", ""),
        "mpfb_second_root": getattr(preferences, "mpfb_second_root", ""),
        "mh_user_data": getattr(preferences, "mh_user_data", ""),
        "mh_auto_user_data": bool(getattr(preferences, "mh_auto_user_data", False)),
    }
    if any(value for value in external_roots.values()):
        raise RuntimeError(f"external MPFB/MakeHuman asset roots are enabled: {external_roots}")

    extension_tree_hash, extension_file_count = tree_sha256(extension_dir)
    if extension_tree_hash != EXPECTED_MPFB_EXTENSION_TREE_SHA256:
        raise RuntimeError(
            "unexpected MPFB extension tree hash: "
            f"{extension_tree_hash!r}, expected {EXPECTED_MPFB_EXTENSION_TREE_SHA256!r}"
        )
    return {
        "addonId": ADDON_ID,
        "version": manifest["version"],
        "manifestSha256": sha256(manifest_path),
        "extensionTreeSha256": extension_tree_hash,
        "expectedExtensionTreeSha256": EXPECTED_MPFB_EXTENSION_TREE_SHA256,
        "extensionFileCount": extension_file_count,
        "extensionDirectory": str(extension_dir),
        "externalAssetRoots": external_roots,
    }


def create_phase(out_dir: Path) -> dict[str, Any]:
    clear_scene()
    result = bpy.ops.mpfb.create_human()
    if result != {"FINISHED"}:
        raise RuntimeError(f"MPFB create_human returned {result!r}")

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.vertices) < 10_000:
        raise RuntimeError(f"unexpected generated mesh inventory: {[(obj.name, len(obj.data.vertices)) for obj in meshes]}")

    body = meshes[0]
    body.name = "body"
    body.data.name = "body_mesh"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body

    blend_path = out_dir / "mpfb-smoke.blend"
    glb_path = out_dir / "mpfb-smoke.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    export_result = bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
    )
    if export_result != {"FINISHED"} or not glb_path.is_file():
        raise RuntimeError(f"glTF export failed: {export_result!r}")

    return {
        "phase": "create",
        "blend": {"path": str(blend_path), "sha256": sha256(blend_path)},
        "glb": {"path": str(glb_path), "sha256": sha256(glb_path)},
        "exportSettings": {"export_format": "GLB", "use_selection": True},
        "scene": inspect_meshes([body]),
    }


def reimport_phase(out_dir: Path) -> dict[str, Any]:
    glb_path = out_dir / "mpfb-smoke.glb"
    create_report_path = out_dir / "mpfb-smoke-create.json"
    if not glb_path.is_file():
        raise RuntimeError(f"missing GLB from create phase: {glb_path}")
    if not create_report_path.is_file():
        raise RuntimeError(f"missing report from create phase: {create_report_path}")

    create_report = json.loads(create_report_path.read_text(encoding="utf-8"))
    expected_glb_hash = create_report["result"]["glb"]["sha256"]
    actual_glb_hash = sha256(glb_path)
    if actual_glb_hash != expected_glb_hash:
        raise RuntimeError("GLB hash changed between create and reimport phases")

    clear_scene()
    result = bpy.ops.import_scene.gltf(filepath=str(glb_path))
    if result != {"FINISHED"}:
        raise RuntimeError(f"glTF import failed: {result!r}")

    objects = list(bpy.context.scene.objects)
    scene = inspect_meshes(objects)
    names = {record["name"] for record in scene["meshes"]}
    if scene["meshCount"] != 1 or "body" not in names or scene["nonFiniteVertexCount"] != 0:
        raise RuntimeError(f"unexpected GLB readback: {scene}")

    source_bounds = create_report["result"]["scene"]["bounds"]
    imported_bounds = scene["bounds"]
    source_size = [source_bounds["max"][index] - source_bounds["min"][index] for index in range(3)]
    imported_size = [imported_bounds["max"][index] - imported_bounds["min"][index] for index in range(3)]
    relative_size_error = [
        abs(imported_size[index] - source_size[index]) / max(source_size[index], 1e-9)
        for index in range(3)
    ]
    source_center = [
        (source_bounds["max"][index] + source_bounds["min"][index]) / 2.0 for index in range(3)
    ]
    imported_center = [
        (imported_bounds["max"][index] + imported_bounds["min"][index]) / 2.0 for index in range(3)
    ]
    center_delta = [abs(imported_center[index] - source_center[index]) for index in range(3)]
    tolerance = max(source_size) * 0.03
    if max(relative_size_error) > 0.03 or max(center_delta) > tolerance:
        raise RuntimeError(
            "GLB readback bounds exceed 3% tolerance: "
            f"relative_size_error={relative_size_error}, center_delta={center_delta}"
        )

    return {
        "phase": "reimport",
        "glb": {"path": str(glb_path), "sha256": actual_glb_hash},
        "boundsComparison": {
            "relativeSizeError": relative_size_error,
            "centerDelta": center_delta,
            "tolerance": tolerance,
        },
        "scene": scene,
    }


def main() -> int:
    args = parse_args()
    out_dir = args.out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / f"mpfb-smoke-{args.phase}.json"

    report: dict[str, Any] = {
        "schemaVersion": 1,
        "status": "NO-GO",
        "blender": {
            "version": list(bpy.app.version),
            "versionString": bpy.app.version_string,
            "buildHash": bpy.app.build_hash.decode("ascii"),
            "binary": bpy.app.binary_path,
        },
        "runner": {
            "path": str(Path(__file__).resolve()),
            "sha256": sha256(Path(__file__).resolve()),
        },
        "environment": {
            name: os.environ.get(name)
            for name in (
                "BLENDER_USER_CONFIG",
                "BLENDER_USER_SCRIPTS",
                "BLENDER_USER_EXTENSIONS",
                "BLENDER_USER_DATAFILES",
            )
        },
    }

    try:
        if bpy.app.version[:3] != EXPECTED_BLENDER_VERSION:
            raise RuntimeError(
                f"unexpected Blender version: {bpy.app.version[:3]!r}, expected {EXPECTED_BLENDER_VERSION!r}"
            )
        report["mpfb"] = extension_info()
        report["result"] = create_phase(out_dir) if args.phase == "create" else reimport_phase(out_dir)
        report["status"] = "GO"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(
            json.dumps({"status": report["status"], "report": str(report_path), "error": report["error"]}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 1

    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "report": str(report_path)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
