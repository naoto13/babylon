"""Build Chrono Arena's high-detail clockwork enemies.

The four enemies are authored as layered mechanical characters with dedicated
rigs and five gameplay clips. Existing lightweight enemy assets remain as
fallbacks; this script writes `enemy-*-hd.blend` and `enemy-*-hd.glb`.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
PREVIEW_DIR = ROOT / "screenshots" / "enemy-review"
for directory in (MODEL_DIR, SOURCE_DIR, PREVIEW_DIR):
    directory.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_blender_assets import (  # noqa: E402
    activate,
    clear_scene,
    export_glb,
    finish_mesh,
    material,
    parent_keep_transform,
)
from build_custom_hero import (  # noqa: E402
    add_torus,
    curve_tube,
    extruded_panel,
    loft_mesh,
    rigid_bind,
)


ENEMY_KINDS = ("chaser", "shooter", "thief", "boss")
CURRENT_PARTS: list[bpy.types.Object] = []


def register(obj, rig, bone_name: str):
    rigid_bind(obj, rig, bone_name)
    CURRENT_PARTS.append(obj)
    return obj


def sphere(
    name: str,
    location,
    scale,
    mat,
    rig,
    bone_name: str,
    *,
    segments=32,
    rings=16,
):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.scale = scale
    finish_mesh(obj, name, mat, smooth=True)
    return register(obj, rig, bone_name)


def cube(
    name: str,
    location,
    scale,
    mat,
    rig,
    bone_name: str,
    *,
    rotation=(0, 0, 0),
    bevel=0.02,
):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = scale
    finish_mesh(obj, name, mat, bevel=bevel)
    return register(obj, rig, bone_name)


def cone(
    name: str,
    location,
    radius1,
    radius2,
    depth,
    mat,
    rig,
    bone_name: str,
    *,
    rotation=(0, 0, 0),
    vertices=24,
    bevel=0.012,
):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    finish_mesh(obj, name, mat, smooth=True, bevel=bevel)
    return register(obj, rig, bone_name)


def cylinder_between(
    name: str,
    start,
    end,
    radius,
    mat,
    rig,
    bone_name: str,
    *,
    radius2=None,
    vertices=24,
    bevel=0.01,
):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius,
        radius2=radius if radius2 is None else radius2,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(
        direction.normalized()
    )
    obj.rotation_mode = "XYZ"
    finish_mesh(obj, name, mat, smooth=True, bevel=bevel)
    return register(obj, rig, bone_name)


def torus(
    name: str,
    location,
    major_radius,
    minor_radius,
    mat,
    rig,
    bone_name: str,
    *,
    rotation=(0, 0, 0),
):
    obj = add_torus(
        name,
        location,
        major_radius,
        minor_radius,
        mat,
        rotation=rotation,
    )
    return register(obj, rig, bone_name)


def panel(
    name: str,
    points_xz,
    y,
    depth,
    mat,
    rig,
    bone_name: str,
    *,
    bevel=0.014,
):
    obj = extruded_panel(name, points_xz, y, depth, mat, bevel=bevel)
    return register(obj, rig, bone_name)


def tube(
    name: str,
    points,
    mat,
    rig,
    bone_name: str,
    *,
    radius=0.02,
):
    obj = curve_tube(name, points, mat, radius=radius, resolution=3)
    return register(obj, rig, bone_name)


def create_rig(name: str, definitions: dict[str, tuple]) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"{name}Rig")
    rig = bpy.data.objects.new(f"{name}Rig", data)
    bpy.context.collection.objects.link(rig)
    rig.show_in_front = True
    activate(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for bone_name, (head, tail, parent_name) in definitions.items():
        bone = data.edit_bones.new(bone_name)
        bone.head = head
        bone.tail = tail
        if parent_name:
            bone.parent = data.edit_bones[parent_name]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def humanoid_bones(scale=1.0):
    def p(x, y, z):
        return (x * scale, y * scale, z * scale)

    return {
        "Root": (p(0, 0, 0), p(0, 0, 0.3), None),
        "Hips": (p(0, 0, 0.78), p(0, 0, 1.08), "Root"),
        "Chest": (p(0, 0, 1.08), p(0, 0, 1.62), "Hips"),
        "Head": (p(0, 0, 1.62), p(0, 0, 2.1), "Chest"),
        "UpperArm.L": (p(0.31, 0, 1.54), p(0.62, 0, 1.34), "Chest"),
        "LowerArm.L": (
            p(0.62, 0, 1.34),
            p(0.82, -0.02, 1.04),
            "UpperArm.L",
        ),
        "Hand.L": (p(0.82, -0.02, 1.04), p(0.88, -0.04, 0.88), "LowerArm.L"),
        "UpperArm.R": (p(-0.31, 0, 1.54), p(-0.62, 0, 1.34), "Chest"),
        "LowerArm.R": (
            p(-0.62, 0, 1.34),
            p(-0.82, -0.02, 1.04),
            "UpperArm.R",
        ),
        "Hand.R": (
            p(-0.82, -0.02, 1.04),
            p(-0.88, -0.04, 0.88),
            "LowerArm.R",
        ),
        "UpperLeg.L": (p(0.17, 0, 0.83), p(0.2, 0, 0.47), "Hips"),
        "LowerLeg.L": (
            p(0.2, 0, 0.47),
            p(0.21, -0.02, 0.15),
            "UpperLeg.L",
        ),
        "Foot.L": (p(0.21, -0.02, 0.15), p(0.21, -0.27, 0.09), "LowerLeg.L"),
        "UpperLeg.R": (p(-0.17, 0, 0.83), p(-0.2, 0, 0.47), "Hips"),
        "LowerLeg.R": (
            p(-0.2, 0, 0.47),
            p(-0.21, -0.02, 0.15),
            "UpperLeg.R",
        ),
        "Foot.R": (
            p(-0.21, -0.02, 0.15),
            p(-0.21, -0.27, 0.09),
            "LowerLeg.R",
        ),
        "Cape.L": (p(0.15, 0.12, 1.5), p(0.3, 0.18, 0.48), "Chest"),
        "Cape.R": (p(-0.15, 0.12, 1.5), p(-0.3, 0.18, 0.48), "Chest"),
        "Halo": (p(0, 0.1, 1.55), p(0, 0.12, 2.3), "Chest"),
    }


def chaser_bones():
    return {
        "Root": ((0, 0, 0), (0, 0, 0.24), None),
        "Body": ((0, 0.18, 0.58), (0, -0.2, 0.8), "Root"),
        "Head": ((0, -0.28, 0.72), (0, -0.82, 0.58), "Body"),
        "FrontUpper.L": ((0.3, -0.2, 0.65), (0.48, -0.48, 0.38), "Body"),
        "FrontLower.L": (
            (0.48, -0.48, 0.38),
            (0.57, -0.72, 0.09),
            "FrontUpper.L",
        ),
        "FrontUpper.R": ((-0.3, -0.2, 0.65), (-0.48, -0.48, 0.38), "Body"),
        "FrontLower.R": (
            (-0.48, -0.48, 0.38),
            (-0.57, -0.72, 0.09),
            "FrontUpper.R",
        ),
        "BackUpper.L": ((0.31, 0.26, 0.64), (0.46, 0.5, 0.38), "Body"),
        "BackLower.L": (
            (0.46, 0.5, 0.38),
            (0.56, 0.67, 0.09),
            "BackUpper.L",
        ),
        "BackUpper.R": ((-0.31, 0.26, 0.64), (-0.46, 0.5, 0.38), "Body"),
        "BackLower.R": (
            (-0.46, 0.5, 0.38),
            (-0.56, 0.67, 0.09),
            "BackUpper.R",
        ),
        "Tail": ((0, 0.48, 0.63), (0, 1.05, 0.36), "Body"),
        "Gear": ((0, 0.18, 0.68), (0, 0.24, 1.3), "Body"),
    }


def reset_pose(rig):
    rig.location = (0, 0, 0)
    rig.rotation_mode = "XYZ"
    rig.rotation_euler = (0, 0, 0)
    rig.scale = (1, 1, 1)
    for bone in rig.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.location = (0, 0, 0)
        bone.rotation_euler = (0, 0, 0)
        bone.scale = (1, 1, 1)


def action_curves(action):
    if hasattr(action, "fcurves"):
        return action.fcurves
    return [
        curve
        for layer in action.layers
        for strip in layer.strips
        for channelbag in strip.channelbags
        for curve in channelbag.fcurves
    ]


def build_action(rig, name: str, frames: list[tuple[int, dict]]) -> None:
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for frame, pose in frames:
        reset_pose(rig)
        object_pose = pose.get("$object", {})
        rig.location = object_pose.get("location", (0, 0, 0))
        rig.rotation_euler = object_pose.get("rotation", (0, 0, 0))
        rig.scale = object_pose.get("scale", (1, 1, 1))
        rig.keyframe_insert(data_path="location", frame=frame)
        rig.keyframe_insert(data_path="rotation_euler", frame=frame)
        rig.keyframe_insert(data_path="scale", frame=frame)
        for bone_name, transform in pose.items():
            if bone_name == "$object" or bone_name not in rig.pose.bones:
                continue
            bone = rig.pose.bones[bone_name]
            bone.location = transform.get("location", (0, 0, 0))
            bone.rotation_euler = transform.get("rotation", (0, 0, 0))
            bone.scale = transform.get("scale", (1, 1, 1))
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path="location", frame=frame)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame)
            bone.keyframe_insert(data_path="scale", frame=frame)

    for curve in action_curves(action):
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"

    if name != "Idle":
        action_slot = getattr(rig.animation_data, "action_slot", None)
        track = rig.animation_data.nla_tracks.new(prev=None)
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        if action_slot is not None and hasattr(strip, "action_slot"):
            strip.action_slot = action_slot
        if hasattr(strip, "action_frame_start"):
            strip.action_frame_start = action.frame_range[0]
            strip.action_frame_end = action.frame_range[1]
        track.lock = True
        track.mute = True


def create_humanoid_actions(rig, kind: str) -> None:
    bpy.context.scene.render.fps = 24
    rig.animation_data_create()
    neutral = (
        {
            "Hips": {"rotation": (0.12, 0, -0.06)},
            "Chest": {"rotation": (0.28, 0, 0.08)},
            "Head": {"rotation": (-0.12, 0, -0.04)},
            "UpperLeg.L": {"rotation": (0.34, 0, 0.08)},
            "LowerLeg.L": {"rotation": (-0.24, 0, 0)},
            "UpperLeg.R": {"rotation": (-0.16, 0, -0.05)},
            "LowerLeg.R": {"rotation": (0.2, 0, 0)},
            "UpperArm.L": {"rotation": (-0.18, 0, -0.08)},
            "UpperArm.R": {"rotation": (0.2, 0, 0.1)},
        }
        if kind == "thief"
        else {}
    )
    idle_mid = (
        {
            **neutral,
            "Chest": {"rotation": (0.31, 0, 0.095)},
            "Head": {"rotation": (-0.15, 0, -0.055)},
            "Cape.L": {"rotation": (0.08, 0.02, 0.04)},
            "Cape.R": {"rotation": (0.07, -0.02, -0.035)},
        }
        if kind == "thief"
        else {
            "Chest": {"rotation": (0.035, 0, 0.025)},
            "Head": {"rotation": (-0.02, 0, -0.018)},
            "Cape.L": {"rotation": (0.04, 0.02, 0.025)},
            "Cape.R": {"rotation": (0.04, -0.02, -0.025)},
        }
    )
    build_action(
        rig,
        "Idle",
        [
            (1, neutral),
            (13, idle_mid),
            (25, neutral),
        ],
    )
    build_action(
        rig,
        "Move",
        [
            (
                1,
                {
                    "Hips": {"rotation": (0.06, 0, -0.08)},
                    "UpperLeg.L": {"rotation": (0.48, 0, 0)},
                    "LowerLeg.L": {"rotation": (-0.34, 0, 0)},
                    "UpperLeg.R": {"rotation": (-0.42, 0, 0)},
                    "LowerLeg.R": {"rotation": (0.22, 0, 0)},
                    "UpperArm.L": {"rotation": (-0.28, 0, -0.05)},
                    "UpperArm.R": {"rotation": (0.3, 0, 0.05)},
                    "Cape.L": {"rotation": (0.14, 0.03, 0.08)},
                    "Cape.R": {"rotation": (0.11, -0.02, -0.06)},
                },
            ),
            (
                7,
                {
                    "Hips": {"rotation": (-0.02, 0, 0.08)},
                    "UpperLeg.L": {"rotation": (-0.42, 0, 0)},
                    "LowerLeg.L": {"rotation": (0.22, 0, 0)},
                    "UpperLeg.R": {"rotation": (0.48, 0, 0)},
                    "LowerLeg.R": {"rotation": (-0.34, 0, 0)},
                    "UpperArm.L": {"rotation": (0.3, 0, -0.05)},
                    "UpperArm.R": {"rotation": (-0.28, 0, 0.05)},
                    "Cape.L": {"rotation": (0.1, 0.02, 0.05)},
                    "Cape.R": {"rotation": (0.15, -0.03, -0.08)},
                },
            ),
            (13, {}),
        ],
    )

    if kind == "shooter":
        attack_mid = {
            "Chest": {"rotation": (-0.12, 0, 0.15)},
            "Head": {"rotation": (0, 0, -0.18)},
            "UpperArm.R": {"rotation": (-1.05, 0.1, -0.52)},
            "LowerArm.R": {"rotation": (-0.42, 0, -0.42)},
            "Hand.R": {"rotation": (0.18, 0.12, 0.22)},
            "UpperArm.L": {"rotation": (-0.85, -0.08, 0.48)},
            "LowerArm.L": {"rotation": (-0.74, 0.05, 0.52)},
            "Cape.L": {"rotation": (0.12, 0.06, 0.09)},
            "Cape.R": {"rotation": (0.12, -0.06, -0.09)},
        }
    elif kind == "thief":
        attack_mid = {
            "Hips": {"rotation": (0.18, 0, -0.2)},
            "Chest": {"rotation": (0.42, 0, 0.26)},
            "Head": {"rotation": (-0.14, 0, -0.14)},
            "UpperArm.R": {"rotation": (-0.95, 0.1, 0.32)},
            "LowerArm.R": {"rotation": (-0.48, 0, 0.45)},
            "UpperArm.L": {"rotation": (0.34, 0, -0.25)},
            "UpperLeg.L": {"rotation": (0.5, 0, 0)},
            "UpperLeg.R": {"rotation": (-0.38, 0, 0)},
            "Cape.L": {"rotation": (0.22, 0.02, 0.16)},
            "Cape.R": {"rotation": (0.18, -0.02, -0.12)},
        }
    else:
        attack_mid = {
            "Chest": {"rotation": (-0.28, 0, -0.12)},
            "Head": {"rotation": (0.1, 0, 0.12)},
            "UpperArm.L": {"rotation": (-1.15, 0.12, 0.36)},
            "LowerArm.L": {"rotation": (-0.62, 0.1, 0.28)},
            "Hand.L": {"rotation": (0.22, 0, -0.3)},
            "UpperArm.R": {"rotation": (0.36, 0, -0.2)},
            "Cape.L": {"rotation": (0.2, 0.05, 0.15)},
            "Cape.R": {"rotation": (0.18, -0.05, -0.12)},
        }

    build_action(
        rig,
        "Attack",
        [
            (1, {}),
            (5, {**attack_mid, "$object": {"location": (0, 0.08, 0)}}),
            (9, {**attack_mid, "$object": {"location": (0, -0.2, 0.04)}}),
            (15, {}),
        ],
    )
    build_action(
        rig,
        "Hit",
        [
            (1, {}),
            (
                3,
                {
                    "Hips": {"rotation": (-0.2, 0.08, 0.18)},
                    "Chest": {"rotation": (-0.35, 0.12, -0.28)},
                    "Head": {"rotation": (0.2, -0.08, 0.2)},
                    "UpperArm.L": {"rotation": (0.2, 0, 0.2)},
                    "UpperArm.R": {"rotation": (0.2, 0, -0.2)},
                },
            ),
            (8, {}),
        ],
    )
    build_action(
        rig,
        "Death",
        [
            (1, {}),
            (
                7,
                {
                    "$object": {"location": (0, 0.08, -0.06)},
                    "Hips": {"rotation": (-0.45, 0.1, 0.48)},
                    "Chest": {"rotation": (-0.6, 0.12, -0.42)},
                    "Head": {"rotation": (0.38, 0, 0.42)},
                    "UpperLeg.L": {"rotation": (0.38, 0, 0.22)},
                    "UpperLeg.R": {"rotation": (-0.28, 0, -0.18)},
                    "Cape.L": {"rotation": (0.5, 0.1, 0.35)},
                    "Cape.R": {"rotation": (0.42, -0.1, -0.32)},
                },
            ),
            (
                16,
                {
                    "$object": {
                        "location": (0, 0.18, -0.42),
                        "rotation": (-1.12, 0.16, 0.55),
                        "scale": (1.04, 1.04, 0.72),
                    }
                },
            ),
        ],
    )
    rig.animation_data.action = bpy.data.actions.get("Idle")


def create_chaser_actions(rig) -> None:
    bpy.context.scene.render.fps = 24
    rig.animation_data_create()
    build_action(
        rig,
        "Idle",
        [
            (1, {}),
            (
                13,
                {
                    "Body": {"location": (0, 0, 0.035), "rotation": (0.03, 0, 0.02)},
                    "Head": {"rotation": (-0.06, 0, -0.04)},
                    "Tail": {"rotation": (0.08, 0.04, 0.12)},
                    "Gear": {"rotation": (0, 0.25, 0)},
                },
            ),
            (25, {}),
        ],
    )
    build_action(
        rig,
        "Move",
        [
            (
                1,
                {
                    "Body": {"rotation": (0.09, 0, -0.06)},
                    "FrontUpper.L": {"rotation": (0.52, 0, 0.08)},
                    "FrontLower.L": {"rotation": (-0.38, 0, 0)},
                    "FrontUpper.R": {"rotation": (-0.42, 0, -0.08)},
                    "BackUpper.L": {"rotation": (-0.34, 0, 0)},
                    "BackUpper.R": {"rotation": (0.46, 0, 0)},
                    "Tail": {"rotation": (0, 0, 0.18)},
                    "Gear": {"rotation": (0, 0.42, 0)},
                },
            ),
            (
                7,
                {
                    "Body": {"rotation": (-0.04, 0, 0.06)},
                    "FrontUpper.L": {"rotation": (-0.42, 0, 0.08)},
                    "FrontUpper.R": {"rotation": (0.52, 0, -0.08)},
                    "FrontLower.R": {"rotation": (-0.38, 0, 0)},
                    "BackUpper.L": {"rotation": (0.46, 0, 0)},
                    "BackUpper.R": {"rotation": (-0.34, 0, 0)},
                    "Tail": {"rotation": (0, 0, -0.18)},
                    "Gear": {"rotation": (0, -0.42, 0)},
                },
            ),
            (13, {}),
        ],
    )
    build_action(
        rig,
        "Attack",
        [
            (1, {}),
            (
                5,
                {
                    "$object": {"location": (0, 0.12, -0.02)},
                    "Body": {"rotation": (-0.18, 0, 0)},
                    "Head": {"rotation": (0.22, 0, 0)},
                    "FrontUpper.L": {"rotation": (-0.28, 0, 0.16)},
                    "FrontUpper.R": {"rotation": (-0.28, 0, -0.16)},
                },
            ),
            (
                9,
                {
                    "$object": {"location": (0, -0.42, 0.08)},
                    "Body": {"rotation": (0.24, 0, 0)},
                    "Head": {"rotation": (-0.38, 0, 0)},
                    "FrontUpper.L": {"rotation": (0.42, 0, 0.2)},
                    "FrontUpper.R": {"rotation": (0.42, 0, -0.2)},
                    "Gear": {"rotation": (0, 0.8, 0)},
                },
            ),
            (15, {}),
        ],
    )
    build_action(
        rig,
        "Hit",
        [
            (1, {}),
            (
                3,
                {
                    "Body": {"rotation": (-0.28, 0.12, 0.25)},
                    "Head": {"rotation": (0.32, -0.08, -0.3)},
                    "Tail": {"rotation": (0.18, 0.12, -0.36)},
                },
            ),
            (8, {}),
        ],
    )
    build_action(
        rig,
        "Death",
        [
            (1, {}),
            (
                7,
                {
                    "$object": {"location": (0, 0.08, -0.08)},
                    "Body": {"rotation": (-0.45, 0.12, 0.5)},
                    "Head": {"rotation": (0.5, 0, -0.4)},
                    "FrontUpper.L": {"rotation": (0.7, 0, 0.4)},
                    "FrontUpper.R": {"rotation": (-0.6, 0, -0.4)},
                    "Tail": {"rotation": (0.3, 0.2, 0.55)},
                },
            ),
            (
                15,
                {
                    "$object": {
                        "location": (0, 0.18, -0.34),
                        "rotation": (-0.72, 0.18, 0.7),
                        "scale": (1.08, 1.02, 0.45),
                    }
                },
            ),
        ],
    )
    rig.animation_data.action = bpy.data.actions.get("Idle")


def materials(kind: str):
    accent = {
        "chaser": ((0.02, 0.55, 0.85, 1), (0.01, 0.72, 1.0)),
        "shooter": ((0.32, 0.04, 0.62, 1), (0.62, 0.08, 1.0)),
        "thief": ((0.02, 0.55, 0.85, 1), (0.01, 0.72, 1.0)),
        "boss": ((0.62, 0.012, 0.025, 1), (1.0, 0.015, 0.025)),
    }[kind]
    return {
        "iron": material(
            f"{kind.title()}Iron",
            (0.018, 0.035, 0.075, 1),
            metallic=0.62,
            roughness=0.24,
        ),
        "steel": material(
            f"{kind.title()}Steel",
            (0.085, 0.13, 0.2, 1),
            metallic=0.72,
            roughness=0.18,
        ),
        "brass": material(
            f"{kind.title()}Brass",
            (0.48, 0.24, 0.055, 1),
            metallic=0.82,
            roughness=0.22,
        ),
        "cloth": material(
            f"{kind.title()}Cloth",
            (0.018, 0.012, 0.045, 1),
            metallic=0.0,
            roughness=0.82,
        ),
        "accent": material(
            f"{kind.title()}Accent",
            accent[0],
            metallic=0.18,
            roughness=0.14,
            emission=accent[1],
            emission_strength=5.5 if kind != "boss" else 7.5,
        ),
        "dark": material(
            f"{kind.title()}DarkMetal",
            (0.006, 0.008, 0.016, 1),
            metallic=0.75,
            roughness=0.3,
        ),
    }


def gear_teeth(
    prefix,
    center,
    radius,
    count,
    mat,
    rig,
    bone,
    *,
    tooth_scale=(0.045, 0.035, 0.075),
):
    for index in range(count):
        angle = math.tau * index / count
        x = center[0] + math.cos(angle) * radius
        z = center[2] + math.sin(angle) * radius
        cube(
            f"{prefix}Tooth{index:02d}",
            (x, center[1], z),
            tooth_scale,
            mat,
            rig,
            bone,
            rotation=(0, angle, angle),
            bevel=0.008,
        )


def build_chaser(rig, mats):
    sphere("ChaserCoreBody", (0, 0.08, 0.68), (0.43, 0.62, 0.36), mats["dark"], rig, "Body")
    for index, y in enumerate((-0.28, -0.12, 0.04, 0.2, 0.36)):
        sphere(
            f"ChaserBackPlate{index}",
            (0, y, 0.74 + 0.025 * math.cos(index)),
            (0.45 - index * 0.018, 0.18, 0.19),
            mats["iron"] if index % 2 == 0 else mats["steel"],
            rig,
            "Body",
            segments=28,
            rings=14,
        )
        torus(
            f"ChaserRib{index}",
            (0, y - 0.02, 0.7),
            0.39 - index * 0.012,
            0.025,
            mats["brass"],
            rig,
            "Body",
            rotation=(math.pi / 2, 0, 0),
        )

    torus(
        "ChaserSpineGear",
        (0, 0.16, 1.0),
        0.38,
        0.055,
        mats["brass"],
        rig,
        "Gear",
        rotation=(math.pi / 2, 0, 0),
    )
    torus(
        "ChaserSpineGearInner",
        (0, 0.155, 1.0),
        0.25,
        0.026,
        mats["accent"],
        rig,
        "Gear",
        rotation=(math.pi / 2, 0, 0),
    )
    gear_teeth(
        "ChaserGear",
        (0, 0.16, 1.0),
        0.46,
        14,
        mats["brass"],
        rig,
        "Gear",
    )

    sphere("ChaserSkull", (0, -0.57, 0.69), (0.32, 0.43, 0.26), mats["iron"], rig, "Head")
    cone(
        "ChaserMuzzle",
        (0, -0.9, 0.58),
        0.25,
        0.13,
        0.52,
        mats["steel"],
        rig,
        "Head",
        rotation=(math.pi / 2, 0, 0),
        vertices=28,
    )
    panel(
        "ChaserBrow",
        [(-0.3, 0.78), (0.3, 0.78), (0.2, 0.61), (0, 0.55), (-0.2, 0.61)],
        -0.88,
        0.045,
        mats["brass"],
        rig,
        "Head",
    )
    for side in (-1, 1):
        sphere(
            f"ChaserEye{side}",
            (0.12 * side, -0.925, 0.665),
            (0.095, 0.025, 0.045),
            mats["accent"],
            rig,
            "Head",
            segments=20,
            rings=10,
        )
        cone(
            f"ChaserCheekBlade{side}",
            (0.28 * side, -0.72, 0.64),
            0.09,
            0,
            0.36,
            mats["brass"],
            rig,
            "Head",
            rotation=(0, math.radians(62) * side, math.radians(10) * side),
            vertices=16,
        )

    limb_specs = [
        ("Front", "L", 1, -0.2, -0.48, -0.72),
        ("Front", "R", -1, -0.2, -0.48, -0.72),
        ("Back", "L", 1, 0.26, 0.5, 0.67),
        ("Back", "R", -1, 0.26, 0.5, 0.67),
    ]
    for region, side_name, sign, y0, y1, y2 in limb_specs:
        upper_bone = f"{region}Upper.{side_name}"
        lower_bone = f"{region}Lower.{side_name}"
        hip = (0.3 * sign, y0, 0.65)
        knee = (0.48 * sign, y1, 0.38)
        paw = (0.57 * sign, y2, 0.09)
        sphere(
            f"Chaser{region}Joint{side_name}",
            hip,
            (0.17, 0.17, 0.17),
            mats["brass"],
            rig,
            upper_bone,
            segments=24,
            rings=12,
        )
        cylinder_between(
            f"Chaser{region}UpperArmour{side_name}",
            hip,
            knee,
            0.12,
            mats["steel"],
            rig,
            upper_bone,
            radius2=0.095,
        )
        torus(
            f"Chaser{region}KneeGear{side_name}",
            knee,
            0.14,
            0.025,
            mats["brass"],
            rig,
            lower_bone,
            rotation=(0, math.pi / 2, 0),
        )
        cylinder_between(
            f"Chaser{region}LowerArmour{side_name}",
            knee,
            paw,
            0.095,
            mats["iron"],
            rig,
            lower_bone,
            radius2=0.065,
        )
        cube(
            f"Chaser{region}Paw{side_name}",
            (paw[0], paw[1] - 0.08, 0.07),
            (0.17, 0.22, 0.07),
            mats["steel"],
            rig,
            lower_bone,
            bevel=0.025,
        )
        for claw in (-1, 0, 1):
            cone(
                f"Chaser{region}Claw{side_name}{claw}",
                (paw[0] + claw * 0.055, paw[1] - 0.29, 0.06),
                0.035,
                0,
                0.22,
                mats["brass"],
                rig,
                lower_bone,
                rotation=(math.pi / 2, 0, 0),
                vertices=12,
                bevel=0.004,
            )

    tail_points = [(0, 0.46, 0.64), (0, 0.7, 0.56), (0, 0.92, 0.43), (0, 1.12, 0.3)]
    for index in range(len(tail_points) - 1):
        cylinder_between(
            f"ChaserTailSegment{index}",
            tail_points[index],
            tail_points[index + 1],
            0.08 - index * 0.012,
            mats["steel"] if index % 2 else mats["iron"],
            rig,
            "Tail",
            radius2=0.065 - index * 0.012,
        )
        torus(
            f"ChaserTailJoint{index}",
            tail_points[index],
            0.1 - index * 0.008,
            0.018,
            mats["brass"],
            rig,
            "Tail",
            rotation=(math.pi / 2, 0, 0),
        )
    cone(
        "ChaserTailSpike",
        (0, 1.21, 0.24),
        0.09,
        0,
        0.32,
        mats["brass"],
        rig,
        "Tail",
        rotation=(math.pi / 2, 0, 0),
        vertices=16,
    )


def build_humanoid_base(rig, mats, *, scale=1.0, heavy=False, hood=True):
    s = scale
    torso = loft_mesh(
        "TorsoShell",
        [
            ((0, 0, 1.02 * s), 0.27 * s, 0.2 * s),
            ((0, 0, 1.28 * s), 0.34 * s, 0.23 * s),
            ((0, 0, 1.55 * s), (0.42 if heavy else 0.36) * s, 0.24 * s),
            ((0, 0, 1.66 * s), 0.31 * s, 0.21 * s),
        ],
        mats["iron"],
        sides=36,
        bevel=0.012 * s,
    )
    register(torso, rig, "Chest")
    abdomen = loft_mesh(
        "AbdomenShell",
        [
            ((0, 0, 0.72 * s), 0.24 * s, 0.18 * s),
            ((0, 0, 0.9 * s), 0.29 * s, 0.19 * s),
            ((0, 0, 1.1 * s), 0.27 * s, 0.19 * s),
        ],
        mats["dark"],
        sides=32,
        bevel=0.008 * s,
    )
    register(abdomen, rig, "Hips")

    for index, z in enumerate((1.13, 1.28, 1.43, 1.58)):
        torus(
            f"TorsoRib{index}",
            (0, -0.19 * s, z * s),
            (0.25 + index * 0.018) * s,
            0.018 * s,
            mats["brass"],
            rig,
            "Chest",
            rotation=(math.pi / 2, 0, 0),
        )

    for side_name, sign in (("L", 1), ("R", -1)):
        sphere(
            f"Pauldron.{side_name}",
            (0.39 * sign * s, 0, 1.54 * s),
            ((0.24 if heavy else 0.2) * s, 0.25 * s, 0.18 * s),
            mats["steel"],
            rig,
            f"UpperArm.{side_name}",
            segments=28,
            rings=14,
        )
        for spike_index in range(2 if heavy else 1):
            cone(
                f"PauldronSpike.{side_name}.{spike_index}",
                (
                    (0.48 + spike_index * 0.08) * sign * s,
                    0.02 * s,
                    (1.68 - spike_index * 0.05) * s,
                ),
                0.07 * s,
                0,
                (0.32 if heavy else 0.24) * s,
                mats["brass"],
                rig,
                f"UpperArm.{side_name}",
                rotation=(0, math.radians(58) * sign, 0),
                vertices=16,
            )

        upper_start = (0.34 * sign * s, 0, 1.5 * s)
        elbow = (0.62 * sign * s, 0, 1.34 * s)
        wrist = (0.82 * sign * s, -0.02 * s, 1.04 * s)
        hand = (0.86 * sign * s, -0.04 * s, 0.93 * s)
        cylinder_between(
            f"UpperArmour.{side_name}",
            upper_start,
            elbow,
            (0.13 if heavy else 0.105) * s,
            mats["iron"],
            rig,
            f"UpperArm.{side_name}",
            radius2=(0.11 if heavy else 0.09) * s,
        )
        torus(
            f"ElbowGear.{side_name}",
            elbow,
            (0.13 if heavy else 0.105) * s,
            0.018 * s,
            mats["brass"],
            rig,
            f"LowerArm.{side_name}",
            rotation=(0, math.pi / 2, 0),
        )
        cylinder_between(
            f"ForearmGuard.{side_name}",
            elbow,
            wrist,
            (0.13 if heavy else 0.1) * s,
            mats["steel"],
            rig,
            f"LowerArm.{side_name}",
            radius2=(0.09 if heavy else 0.065) * s,
        )
        sphere(
            f"Gauntlet.{side_name}",
            hand,
            ((0.13 if heavy else 0.1) * s, 0.1 * s, 0.12 * s),
            mats["dark"],
            rig,
            f"Hand.{side_name}",
            segments=20,
            rings=10,
        )

        hip = (0.17 * sign * s, 0, 0.83 * s)
        knee = (0.2 * sign * s, 0, 0.47 * s)
        ankle = (0.21 * sign * s, -0.02 * s, 0.15 * s)
        cylinder_between(
            f"ThighArmour.{side_name}",
            hip,
            knee,
            (0.16 if heavy else 0.125) * s,
            mats["iron"],
            rig,
            f"UpperLeg.{side_name}",
            radius2=(0.13 if heavy else 0.1) * s,
        )
        torus(
            f"KneeGear.{side_name}",
            knee,
            (0.14 if heavy else 0.11) * s,
            0.02 * s,
            mats["brass"],
            rig,
            f"LowerLeg.{side_name}",
            rotation=(0, math.pi / 2, 0),
        )
        cylinder_between(
            f"Greave.{side_name}",
            knee,
            ankle,
            (0.15 if heavy else 0.115) * s,
            mats["steel"],
            rig,
            f"LowerLeg.{side_name}",
            radius2=(0.11 if heavy else 0.085) * s,
        )
        cube(
            f"Boot.{side_name}",
            (0.21 * sign * s, -0.16 * s, 0.1 * s),
            ((0.16 if heavy else 0.13) * s, 0.24 * s, 0.09 * s),
            mats["dark"],
            rig,
            f"Foot.{side_name}",
            bevel=0.025 * s,
        )

    head_mat = mats["cloth"] if hood else mats["iron"]
    hood_shell = loft_mesh(
        "HoodShell",
        [
            ((0, 0, 1.62 * s), 0.25 * s, 0.21 * s),
            ((0, -0.015 * s, 1.82 * s), 0.3 * s, 0.24 * s),
            ((0, -0.045 * s, 2.04 * s), 0.2 * s, 0.19 * s),
            ((0, -0.02 * s, 2.16 * s), 0.08 * s, 0.1 * s),
        ],
        head_mat,
        sides=36,
        bevel=0.01 * s,
    )
    register(hood_shell, rig, "Head")
    panel(
        "FaceMask",
        [
            (-0.18 * s, 2.03 * s),
            (0.18 * s, 2.03 * s),
            (0.14 * s, 1.72 * s),
            (0, 1.61 * s),
            (-0.14 * s, 1.72 * s),
        ],
        -0.245 * s,
        0.045 * s,
        mats["dark"],
        rig,
        "Head",
        bevel=0.012 * s,
    )
    for sign in (-1, 1):
        tube(
            f"MaskEye{sign}",
            [
                (0, -0.276 * s, 1.9 * s),
                (0.1 * sign * s, -0.278 * s, 1.84 * s),
            ],
            mats["accent"],
            rig,
            "Head",
            radius=0.018 * s,
        )

    for side_name, sign in (("L", 1), ("R", -1)):
        cloth_panel = panel(
            f"CoatTail.{side_name}",
            [
                (0.04 * sign * s, 1.1 * s),
                (0.28 * sign * s, 1.04 * s),
                (0.33 * sign * s, 0.35 * s),
                (0.16 * sign * s, 0.18 * s),
                (0.02 * sign * s, 0.42 * s),
            ],
            0.16 * s,
            0.035 * s,
            mats["cloth"],
            rig,
            f"Cape.{side_name}",
            bevel=0.008 * s,
        )
        cloth_panel.rotation_euler.y = 0.04 * sign


def add_clock_core(rig, mats, *, scale=1.0, color_bone="Chest"):
    s = scale
    torus(
        "ChestClockOuter",
        (0, -0.255 * s, 1.38 * s),
        0.2 * s,
        0.036 * s,
        mats["brass"],
        rig,
        color_bone,
        rotation=(math.pi / 2, 0, 0),
    )
    torus(
        "ChestClockInner",
        (0, -0.268 * s, 1.38 * s),
        0.13 * s,
        0.022 * s,
        mats["accent"],
        rig,
        color_bone,
        rotation=(math.pi / 2, 0, 0),
    )
    sphere(
        "ChestClockLens",
        (0, -0.286 * s, 1.38 * s),
        (0.09 * s, 0.025 * s, 0.09 * s),
        mats["accent"],
        rig,
        color_bone,
        segments=24,
        rings=12,
    )


def build_shooter(rig, mats):
    build_humanoid_base(rig, mats, scale=1.0, heavy=False, hood=True)
    add_clock_core(rig, mats, scale=1.0)
    torus(
        "ShooterBackDial",
        (0, 0.22, 1.5),
        0.28,
        0.04,
        mats["brass"],
        rig,
        "Chest",
        rotation=(math.pi / 2, 0, 0),
    )
    gear_teeth(
        "ShooterBackDial",
        (0, 0.22, 1.5),
        0.34,
        12,
        mats["brass"],
        rig,
        "Chest",
        tooth_scale=(0.035, 0.025, 0.055),
    )

    bow_points_upper = [
        (-0.85, -0.12, 1.06),
        (-1.08, -0.12, 1.28),
        (-1.12, -0.12, 1.56),
        (-0.92, -0.12, 1.82),
    ]
    bow_points_lower = [
        (-0.85, -0.12, 1.06),
        (-0.66, -0.12, 0.84),
        (-0.7, -0.12, 0.58),
        (-0.94, -0.12, 0.42),
    ]
    tube("ShooterBowUpper", bow_points_upper, mats["brass"], rig, "Hand.R", radius=0.055)
    tube("ShooterBowLower", bow_points_lower, mats["brass"], rig, "Hand.R", radius=0.055)
    tube(
        "ShooterBowString",
        [bow_points_upper[-1], (-0.85, -0.14, 1.06), bow_points_lower[-1]],
        mats["accent"],
        rig,
        "Hand.R",
        radius=0.012,
    )
    torus(
        "ShooterBowDial",
        (-0.85, -0.13, 1.06),
        0.2,
        0.035,
        mats["brass"],
        rig,
        "Hand.R",
        rotation=(math.pi / 2, 0, 0),
    )
    torus(
        "ShooterBowCore",
        (-0.85, -0.15, 1.06),
        0.11,
        0.023,
        mats["accent"],
        rig,
        "Hand.R",
        rotation=(math.pi / 2, 0, 0),
    )
    for point, label in ((bow_points_upper[-1], "Top"), (bow_points_lower[-1], "Bottom")):
        cone(
            f"ShooterBowBlade{label}",
            (point[0], point[1], point[2]),
            0.07,
            0,
            0.3,
            mats["steel"],
            rig,
            "Hand.R",
            rotation=(0, 0, math.radians(-12 if label == "Top" else 168)),
            vertices=16,
        )


def add_claws(rig, mats, hand_bone, sign, *, scale=1.0):
    hand_x = 0.88 * sign * scale
    for index in range(3):
        cone(
            f"Claw.{hand_bone}.{index}",
            (
                hand_x + (index - 1) * 0.035 * scale,
                -0.12 * scale,
                (0.88 - index * 0.018) * scale,
            ),
            0.025 * scale,
            0,
            0.18 * scale,
            mats["brass"],
            rig,
            hand_bone,
            rotation=(math.pi / 2, 0, 0),
            vertices=12,
            bevel=0.003,
        )


def build_thief(rig, mats):
    build_humanoid_base(rig, mats, scale=0.96, heavy=False, hood=True)
    add_clock_core(rig, mats, scale=0.96)
    add_claws(rig, mats, "Hand.L", 1, scale=0.96)
    add_claws(rig, mats, "Hand.R", -1, scale=0.96)
    tube(
        "ThiefBackHose",
        [
            (0.22, 0.16, 1.55),
            (0.46, 0.22, 1.32),
            (0.45, 0.18, 0.92),
            (0.32, 0.12, 0.68),
        ],
        mats["brass"],
        rig,
        "Chest",
        radius=0.028,
    )
    for z, label in ((0.67, "Top"), (0.28, "Bottom")):
        torus(
            f"ThiefHourglass{label}",
            (0.97, -0.13, z),
            0.16,
            0.032,
            mats["brass"],
            rig,
            "Hand.L",
        )
    for sign in (-1, 1):
        for depth_sign in (-1, 1):
            cylinder_between(
                f"ThiefHourglassPost{sign}{depth_sign}",
                (0.97 + 0.12 * sign, -0.13 + 0.06 * depth_sign, 0.3),
                (0.97 + 0.12 * sign, -0.13 + 0.06 * depth_sign, 0.65),
                0.018,
                mats["brass"],
                rig,
                "Hand.L",
                vertices=16,
                bevel=0.004,
            )
    cone(
        "ThiefHourglassUpperGlass",
        (0.97, -0.13, 0.53),
        0.12,
        0.035,
        0.24,
        mats["accent"],
        rig,
        "Hand.L",
        vertices=28,
        bevel=0.006,
    )
    cone(
        "ThiefHourglassLowerGlass",
        (0.97, -0.13, 0.41),
        0.035,
        0.12,
        0.24,
        mats["accent"],
        rig,
        "Hand.L",
        vertices=28,
        bevel=0.006,
    )
    tube(
        "ThiefHourglassChain",
        [(0.83, -0.06, 0.98), (0.92, -0.08, 0.84), (0.97, -0.11, 0.7)],
        mats["brass"],
        rig,
        "Hand.L",
        radius=0.016,
    )
    for side_name, sign in (("L", 1), ("R", -1)):
        torus(
            f"ThiefShoulderClock.{side_name}",
            (0.39 * sign, -0.1, 1.55),
            0.13,
            0.024,
            mats["brass"],
            rig,
            f"UpperArm.{side_name}",
            rotation=(math.pi / 2, 0, 0),
        )


def build_boss(rig, mats):
    scale = 1.35
    build_humanoid_base(rig, mats, scale=scale, heavy=True, hood=False)
    add_clock_core(rig, mats, scale=scale)
    for side_name, sign in (("L", 1), ("R", -1)):
        add_claws(rig, mats, f"Hand.{side_name}", sign, scale=scale)
        horn_points = [
            (0.16 * sign, -0.02, 2.72),
            (0.3 * sign, 0.02, 3.0),
            (0.36 * sign, 0.05, 3.32),
            (0.28 * sign, 0.08, 3.58),
        ]
        tube(
            f"BossHorn.{side_name}",
            horn_points,
            mats["brass"],
            rig,
            "Head",
            radius=0.075,
        )
        for index, point in enumerate(horn_points[:-1]):
            torus(
                f"BossHornBand.{side_name}.{index}",
                point,
                0.09 - index * 0.01,
                0.016,
                mats["steel"],
                rig,
                "Head",
                rotation=(math.pi / 2, 0, 0),
            )

    torus(
        "BossGearHalo",
        (0, 0.28, 2.45),
        0.58,
        0.065,
        mats["brass"],
        rig,
        "Halo",
        rotation=(math.pi / 2, 0, 0),
    )
    torus(
        "BossGearHaloInner",
        (0, 0.275, 2.45),
        0.39,
        0.032,
        mats["accent"],
        rig,
        "Halo",
        rotation=(math.pi / 2, 0, 0),
    )
    gear_teeth(
        "BossHalo",
        (0, 0.28, 2.45),
        0.7,
        16,
        mats["brass"],
        rig,
        "Halo",
        tooth_scale=(0.06, 0.045, 0.1),
    )

    for index, (x, z) in enumerate(((0, 1.08), (0, 0.92), (0, 0.76))):
        torus(
            f"BossReactorRing{index}",
            (x, -0.37, z * scale),
            (0.23 - index * 0.025) * scale,
            0.026 * scale,
            mats["brass"] if index != 1 else mats["accent"],
            rig,
            "Chest" if index == 0 else "Hips",
            rotation=(math.pi / 2, 0, 0),
        )

    orb_center = (1.27 * scale, -0.15 * scale, 1.48 * scale)
    sphere(
        "BossTimeOrb",
        orb_center,
        (0.18 * scale, 0.18 * scale, 0.18 * scale),
        mats["accent"],
        rig,
        "Hand.L",
        segments=32,
        rings=16,
    )
    torus(
        "BossTimeOrbRingA",
        orb_center,
        0.27 * scale,
        0.026 * scale,
        mats["brass"],
        rig,
        "Hand.L",
        rotation=(math.pi / 2, 0, 0),
    )
    torus(
        "BossTimeOrbRingB",
        orb_center,
        0.24 * scale,
        0.022 * scale,
        mats["accent"],
        rig,
        "Hand.L",
        rotation=(0, math.pi / 2, 0),
    )
    for side_name, sign in (("L", 1), ("R", -1)):
        for layer in range(2):
            cape = panel(
                f"BossCape.{side_name}.{layer}",
                [
                    (0.08 * sign * scale, 1.58 * scale),
                    ((0.34 + layer * 0.06) * sign * scale, 1.48 * scale),
                    ((0.52 + layer * 0.08) * sign * scale, 0.18 * scale),
                    ((0.18 + layer * 0.05) * sign * scale, 0.02 * scale),
                    (0.03 * sign * scale, 0.48 * scale),
                ],
                (0.16 + layer * 0.035) * scale,
                0.035 * scale,
                mats["cloth"],
                rig,
                f"Cape.{side_name}",
                bevel=0.01 * scale,
            )
            cape.rotation_euler.y = 0.04 * sign


def consolidate_parts(rig, kind: str) -> bpy.types.Object:
    if not CURRENT_PARTS:
        raise RuntimeError(f"{kind}: no geometry was created")
    for obj in CURRENT_PARTS:
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
            else:
                activate(obj)
                bpy.ops.object.modifier_apply(modifier=modifier.name)
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        if obj.type != "MESH":
            activate(obj)
            bpy.ops.object.convert(target="MESH")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in CURRENT_PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = CURRENT_PARTS[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = f"{kind.title()}HDMesh"
    merged.data.name = f"{kind.title()}HDMesh"
    for polygon in merged.data.polygons:
        polygon.use_smooth = True
    parent_keep_transform(merged, rig)
    modifier = merged.modifiers.new(f"{kind.title()}HDDeform", "ARMATURE")
    modifier.object = rig

    for vertex in merged.data.vertices:
        memberships = [item for item in vertex.groups if item.weight > 1e-8]
        if len(memberships) != 1:
            raise RuntimeError(
                f"{kind}: rigid mesh vertex {vertex.index} has "
                f"{len(memberships)} influences"
            )
        memberships[0].weight = 1.0
    return merged


def build_enemy(kind: str) -> None:
    clear_scene()
    CURRENT_PARTS.clear()
    mats = materials(kind)
    if kind == "chaser":
        rig = create_rig("ChaserHD", chaser_bones())
        build_chaser(rig, mats)
        create_chaser_actions(rig)
    else:
        scale = 1.35 if kind == "boss" else 1.0
        rig = create_rig(f"{kind.title()}HD", humanoid_bones(scale))
        if kind == "shooter":
            build_shooter(rig, mats)
        elif kind == "thief":
            build_thief(rig, mats)
        elif kind == "boss":
            build_boss(rig, mats)
        else:
            raise ValueError(f"Unknown enemy: {kind}")
        create_humanoid_actions(rig, kind)

    merged = consolidate_parts(rig, kind)
    bpy.context.scene["asset_name"] = f"Chrono Arena {kind.title()} HD"
    bpy.context.scene["design_reference"] = f"{kind}-turnaround-v2.png"
    bpy.context.scene["animation_clips"] = "Idle,Move,Attack,Hit,Death"
    bpy.context.scene["pipeline"] = "custom-clockwork-rig-pbr-glb"
    bpy.context.scene["runtime_role"] = kind

    source_path = SOURCE_DIR / f"enemy-{kind}-hd.blend"
    model_path = MODEL_DIR / f"enemy-{kind}-hd.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    export_glb(model_path, animations=True)
    merged.data.calc_loop_triangles()
    print(
        "HD_ENEMY_READY "
        f"kind={kind} source={source_path} model={model_path} "
        f"vertices={len(merged.data.vertices)} "
        f"triangles={len(merged.data.loop_triangles)} "
        f"bones={len(rig.data.bones)} materials={len(merged.data.materials)}"
    )


def main() -> None:
    bpy.context.preferences.filepaths.save_version = 0
    for kind in ENEMY_KINDS:
        build_enemy(kind)
    print(f"HD_ENEMIES_READY models={MODEL_DIR}")


if __name__ == "__main__":
    main()
