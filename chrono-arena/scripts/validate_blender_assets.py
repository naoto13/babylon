"""Import the generated GLBs in Blender and fail on missing model data."""

from __future__ import annotations

from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "assets" / "production" / "models"


def reset() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def inspect(filename: str, required_actions=(), *, require_rig=False, min_bones=1) -> None:
    reset()
    bpy.ops.import_scene.gltf(filepath=str(MODEL_DIR / filename))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    actions = {action.name.split("|")[-1] for action in bpy.data.actions}
    missing = set(required_actions) - actions
    if not meshes:
        raise RuntimeError(f"{filename}: no mesh objects")
    if missing:
        raise RuntimeError(f"{filename}: missing animations {sorted(missing)}; got {sorted(actions)}")
    if require_rig:
        armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
        skinned_meshes = [obj for obj in meshes if obj.find_armature() is not None]
        custom_shapes = {
            bone.custom_shape
            for armature in armatures
            for bone in armature.pose.bones
            if bone.custom_shape is not None
        }
        asset_meshes = [obj for obj in meshes if obj not in custom_shapes]
        asset_skinned_meshes = [obj for obj in asset_meshes if obj.find_armature() is not None]
        if len(armatures) != 1 or len(asset_skinned_meshes) != len(asset_meshes):
            unskinned = [obj.name for obj in asset_meshes if obj.find_armature() is None]
            raise RuntimeError(
                f"{filename}: expected one rig and {len(asset_meshes)} skinned meshes; "
                f"got rigs={len(armatures)} skinned={len(asset_skinned_meshes)} "
                f"unskinned={unskinned} custom_shapes={[obj.name for obj in custom_shapes]}"
            )
        bone_count = len(armatures[0].data.bones)
        if bone_count < min_bones:
            raise RuntimeError(
                f"{filename}: expected at least {min_bones} bones; got {bone_count}"
            )
    triangles = sum(len(obj.data.loop_triangles) or len(obj.data.polygons) for obj in meshes)
    print(f"ASSET_OK {filename} meshes={len(meshes)} approx_faces={triangles} actions={sorted(actions)}")
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


inspect(
    "chrono-duelist-custom.glb",
    ("Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash"),
    require_rig=True,
)
for enemy in ("chaser", "shooter", "thief", "boss"):
    inspect(
        f"enemy-{enemy}-concept.glb",
        ("Idle", "Move", "Attack", "Hit", "Death"),
        require_rig=True,
        min_bones=10,
    )
print("BLENDER_VALIDATION_OK")
