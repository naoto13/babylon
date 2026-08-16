"""Report topology-island metrics for Chrono Arena enemy GLBs.

This audit catches the specific failure where many disconnected primitives are
joined into one object and therefore pass ordinary mesh/rig validation while
still reading as an assembled placeholder.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path
import sys

import bpy


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
DEFAULT_MODEL_LABELS = ("chaser", "shooter", "thief", "boss")


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.actions,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def component_sizes(mesh: bpy.types.Mesh) -> list[int]:
    adjacency: list[list[int]] = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        left, right = edge.vertices
        adjacency[left].append(right)
        adjacency[right].append(left)

    unseen = set(range(len(mesh.vertices)))
    sizes: list[int] = []
    while unseen:
        root = unseen.pop()
        queue = deque([root])
        size = 0
        while queue:
            current = queue.popleft()
            size += 1
            for neighbor in adjacency[current]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    queue.append(neighbor)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def audit(model_label: str) -> None:
    reset_scene()
    if model_label.endswith(".glb"):
        model = Path(model_label).resolve()
        label = model.stem.removeprefix("enemy-")
    else:
        suffix = model_label if model_label.endswith("-concept") else f"{model_label}-hd"
        model = MODEL_DIR / f"enemy-{suffix}.glb"
        label = model_label
    if not model.is_file():
        raise RuntimeError(f"Missing model: {model}")
    bpy.ops.import_scene.gltf(filepath=str(model))
    asset_meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.find_armature() is not None
    ]
    if not asset_meshes:
        raise RuntimeError(
            f"{label}: expected at least one skinned asset mesh"
        )

    total_vertices = 0
    total_triangles = 0
    sizes: list[int] = []
    for asset_mesh in asset_meshes:
        mesh = asset_mesh.data
        mesh.calc_loop_triangles()
        total_vertices += len(mesh.vertices)
        total_triangles += len(mesh.loop_triangles)
        sizes.extend(component_sizes(mesh))
    sizes.sort(reverse=True)
    small_components = sum(1 for size in sizes if size < 100)
    dominant_share = sizes[0] / max(1, total_vertices)
    print(
        "SURFACE_AUDIT "
        f"kind={label} skinned_meshes={len(asset_meshes)} "
        f"vertices={total_vertices} "
        f"triangles={total_triangles} "
        f"islands={len(sizes)} small_islands={small_components} "
        f"largest_island_vertices={sizes[0]} "
        f"largest_island_share={dominant_share:.3f} "
        f"top_islands={sizes[:8]}"
    )


def audit_source(model_label: str) -> None:
    source = SOURCE_DIR / f"enemy-{model_label}.blend"
    if not source.is_file():
        return
    bpy.ops.wm.open_mainfile(filepath=str(source))
    asset_meshes = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and obj.find_armature() is not None
    ]
    if not asset_meshes:
        raise RuntimeError(f"{model_label}: source has no skinned meshes")
    total_vertices = 0
    total_triangles = 0
    sizes: list[int] = []
    per_mesh: list[str] = []
    for asset_mesh in asset_meshes:
        mesh = asset_mesh.data
        mesh.calc_loop_triangles()
        mesh_sizes = component_sizes(mesh)
        total_vertices += len(mesh.vertices)
        total_triangles += len(mesh.loop_triangles)
        sizes.extend(mesh_sizes)
        per_mesh.append(
            f"{asset_mesh.name}:{len(mesh.vertices)}v/{len(mesh_sizes)}i"
        )
    sizes.sort(reverse=True)
    dominant_share = sizes[0] / max(1, total_vertices)
    print(
        "SOURCE_SURFACE_AUDIT "
        f"kind={model_label} skinned_meshes={len(asset_meshes)} "
        f"vertices={total_vertices} triangles={total_triangles} "
        f"islands={len(sizes)} largest_island_vertices={sizes[0]} "
        f"largest_island_share={dominant_share:.3f} "
        f"meshes={per_mesh} top_islands={sizes[:8]}"
    )


def main() -> None:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    labels = tuple(sys.argv[separator + 1 :]) or DEFAULT_MODEL_LABELS
    for label in labels:
        audit(label)
        audit_source(label)
    print("SURFACE_AUDIT_COMPLETE")


if __name__ == "__main__":
    main()
