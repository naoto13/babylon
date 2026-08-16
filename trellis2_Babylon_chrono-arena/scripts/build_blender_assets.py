"""Build Chrono Arena's production 3D assets with Blender.

Run from the repository root:
    blender --background --factory-startup --python chrono-arena/scripts/build_blender_assets.py

The script intentionally uses only Blender primitives so every shipped GLB is
reproducible without external downloads or opaque source files.
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "assets" / "production" / "models"
SOURCE_DIR = ROOT / "assets" / "production" / "blender"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    # Direct unlinking also removes hidden/custom-shape objects that cannot be
    # reached by selection-based deletion in a headless Blender session.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    # Actions deliberately carry fake users so they survive in the editable
    # source .blend. During a scripted scene rebuild they must still be
    # removed, otherwise Blender suffixes duplicate clip names with `.001`.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def material(name: str, color: tuple[float, float, float, float], *, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission and emission_input:
            emission_input.default_value = (*emission[:3], 1.0)
        strength_input = bsdf.inputs.get("Emission Strength")
        if strength_input:
            strength_input.default_value = emission_strength
    return mat


def activate(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def finish_mesh(obj, name: str, mat, *, smooth=False, bevel=0.0):
    obj.name = name
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat:
        obj.data.materials.append(mat)
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("EdgeSoftness", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def cube(name, location, scale, mat, *, rotation=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = scale
    return finish_mesh(obj, name, mat, bevel=bevel)


def sphere(name, location, scale, mat, *, segments=16, rings=8, smooth=True):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.scale = scale
    return finish_mesh(obj, name, mat, smooth=smooth)


def cone(name, location, radius1, radius2, depth, mat, *, rotation=(0, 0, 0), vertices=10, bevel=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat, bevel=bevel)


def cylinder_between(name, start, end, radius, mat, *, radius2=None, vertices=10, bevel=0.0):
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
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.rotation_mode = "XYZ"
    return finish_mesh(obj, name, mat, bevel=bevel)


def torus(name, location, major_radius, minor_radius, mat, *, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    return finish_mesh(bpy.context.object, name, mat, smooth=True)


def parent_keep_transform(obj, parent) -> None:
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def bind_rigid(obj, armature, bone_name: str) -> None:
    group = obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    modifier = obj.modifiers.new("ChronoRig", "ARMATURE")
    modifier.object = armature


def create_hero_rig():
    armature_data = bpy.data.armatures.new("ChronoDuelistRig")
    armature = bpy.data.objects.new("ChronoDuelistRig", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    activate(armature)
    bpy.ops.object.mode_set(mode="EDIT")

    bones = {
        "Root": ((0, 0, 0), (0, 0, 0.35), None),
        "Hips": ((0, 0, 0.75), (0, 0, 1.02), "Root"),
        "Spine": ((0, 0, 1.02), (0, 0, 1.42), "Hips"),
        "Chest": ((0, 0, 1.42), (0, 0, 1.7), "Spine"),
        "Head": ((0, 0, 1.7), (0, 0, 2.08), "Chest"),
        "UpperArm.L": ((0.25, 0, 1.61), (0.56, 0, 1.38), "Chest"),
        "LowerArm.L": ((0.56, 0, 1.38), (0.76, -0.02, 1.12), "UpperArm.L"),
        "Hand.L": ((0.76, -0.02, 1.12), (0.8, -0.04, 0.96), "LowerArm.L"),
        "UpperArm.R": ((-0.25, 0, 1.61), (-0.56, 0, 1.38), "Chest"),
        "LowerArm.R": ((-0.56, 0, 1.38), (-0.76, -0.02, 1.12), "UpperArm.R"),
        "Hand.R": ((-0.76, -0.02, 1.12), (-0.8, -0.04, 0.96), "LowerArm.R"),
        "UpperLeg.L": ((0.16, 0, 0.82), (0.18, 0, 0.46), "Hips"),
        "LowerLeg.L": ((0.18, 0, 0.46), (0.19, -0.01, 0.13), "UpperLeg.L"),
        "Foot.L": ((0.19, -0.01, 0.13), (0.19, -0.24, 0.08), "LowerLeg.L"),
        "UpperLeg.R": ((-0.16, 0, 0.82), (-0.18, 0, 0.46), "Hips"),
        "LowerLeg.R": ((-0.18, 0, 0.46), (-0.19, -0.01, 0.13), "UpperLeg.R"),
        "Foot.R": ((-0.19, -0.01, 0.13), (-0.19, -0.24, 0.08), "LowerLeg.R"),
        "Cape.L": ((0.14, 0.13, 1.52), (0.28, 0.2, 0.58), "Chest"),
        "Cape.R": ((-0.14, 0.13, 1.52), (-0.28, 0.2, 0.58), "Chest"),
    }
    edit_bones = {}
    for name, (head, tail, parent_name) in bones.items():
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.roll = 0
        if parent_name:
            bone.parent = edit_bones[parent_name]
        edit_bones[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def create_hero_geometry(armature):
    navy = material("MidnightArmor", (0.025, 0.075, 0.13, 1), metallic=0.28, roughness=0.32)
    blue = material("ChronoBlue", (0.025, 0.34, 0.56, 1), metallic=0.22, roughness=0.28)
    cyan = material("TimeGlow", (0.06, 0.72, 1.0, 1), metallic=0.18, roughness=0.16, emission=(0.05, 0.76, 1.0), emission_strength=7.5)
    pale = material("ClockSilver", (0.62, 0.82, 0.9, 1), metallic=0.42, roughness=0.24)
    gold = material("AntiqueGold", (0.78, 0.43, 0.09, 1), metallic=0.52, roughness=0.26, emission=(0.45, 0.18, 0.02), emission_strength=0.7)
    dark = material("VoidCloth", (0.008, 0.014, 0.026, 1), metallic=0.05, roughness=0.72)

    pieces = []

    def add(obj, bone):
        bind_rigid(obj, armature, bone)
        pieces.append(obj)
        return obj

    add(cone("HipsArmor", (0, 0, 0.9), 0.29, 0.24, 0.32, navy, vertices=10, bevel=0.025), "Hips")
    add(cone("Torso", (0, 0, 1.35), 0.33, 0.25, 0.62, blue, vertices=10, bevel=0.035), "Spine")
    add(cube("ChestPlate", (0, -0.225, 1.5), (0.27, 0.055, 0.19), navy, rotation=(math.radians(7), 0, 0), bevel=0.035), "Chest")
    add(torus("ClockCoreRing", (0, -0.3, 1.5), 0.12, 0.024, gold, rotation=(math.pi / 2, 0, 0)), "Chest")
    add(sphere("ClockCore", (0, -0.315, 1.5), (0.075, 0.025, 0.075), cyan, segments=12, rings=6), "Chest")

    add(sphere("Hood", (0, 0, 1.84), (0.3, 0.27, 0.31), dark, segments=16, rings=8), "Head")
    add(cone("HoodCrown", (0, 0.09, 2.04), 0.2, 0.035, 0.38, blue, rotation=(math.radians(-9), 0, 0), vertices=8), "Head")
    add(torus("ChronoHalo", (0, 0.02, 2.13), 0.19, 0.022, cyan), "Head")
    add(cube("FaceVoid", (0, -0.238, 1.83), (0.18, 0.035, 0.14), dark, rotation=(math.radians(6), 0, 0), bevel=0.045), "Head")
    add(cube("Eye.L", (0.075, -0.282, 1.86), (0.055, 0.012, 0.018), cyan, rotation=(0, math.radians(-8), math.radians(-8)), bevel=0.008), "Head")
    add(cube("Eye.R", (-0.075, -0.282, 1.86), (0.055, 0.012, 0.018), cyan, rotation=(0, math.radians(8), math.radians(8)), bevel=0.008), "Head")

    limb_specs = [
        ("UpperArm.L", (0.27, 0, 1.6), (0.56, 0, 1.38), 0.105, blue),
        ("LowerArm.L", (0.56, 0, 1.38), (0.76, -0.02, 1.12), 0.085, navy),
        ("UpperArm.R", (-0.27, 0, 1.6), (-0.56, 0, 1.38), 0.105, blue),
        ("LowerArm.R", (-0.56, 0, 1.38), (-0.76, -0.02, 1.12), 0.085, navy),
        ("UpperLeg.L", (0.16, 0, 0.82), (0.18, 0, 0.46), 0.12, dark),
        ("LowerLeg.L", (0.18, 0, 0.46), (0.19, -0.01, 0.13), 0.105, navy),
        ("UpperLeg.R", (-0.16, 0, 0.82), (-0.18, 0, 0.46), 0.12, dark),
        ("LowerLeg.R", (-0.18, 0, 0.46), (-0.19, -0.01, 0.13), 0.105, navy),
    ]
    for bone, start, end, radius, mat in limb_specs:
        add(cylinder_between(f"Armor.{bone}", start, end, radius, mat, radius2=radius * 0.78, vertices=8, bevel=0.012), bone)

    for side, sign in (("L", 1), ("R", -1)):
        add(sphere(f"Shoulder.{side}", (0.3 * sign, 0, 1.58), (0.15, 0.16, 0.13), pale, segments=12, rings=6), f"UpperArm.{side}")
        add(cube(f"Boot.{side}", (0.19 * sign, -0.1, 0.09), (0.125, 0.2, 0.08), navy, bevel=0.025), f"Foot.{side}")
        add(sphere(f"Hand.{side}", (0.79 * sign, -0.03, 1.06), (0.09, 0.08, 0.11), dark, segments=10, rings=5), f"Hand.{side}")

        blade_start = (0.8 * sign, -0.04, 1.0)
        # The blades lean forward and outward so their silhouette remains
        # readable from the game's high 3/4 camera instead of collapsing into
        # a point as a vertical sword would.
        blade_end = (1.08 * sign, -0.78, 0.58)
        add(cylinder_between(f"TimeBlade.{side}", blade_start, blade_end, 0.075, cyan, radius2=0.015, vertices=4), f"Hand.{side}")
        add(cylinder_between(f"BladeSpine.{side}", blade_start, blade_end, 0.025, pale, radius2=0.008, vertices=4), f"Hand.{side}")
        add(cylinder_between(f"Hilt.{side}", (0.7 * sign, -0.03, 1.09), (0.89 * sign, -0.03, 1.09), 0.025, gold, vertices=8), f"Hand.{side}")

    add(cube("CoatTail.L", (0.2, 0.12, 0.92), (0.18, 0.035, 0.56), blue, rotation=(math.radians(-5), math.radians(-7), math.radians(-5)), bevel=0.018), "Cape.L")
    add(cube("CoatTail.R", (-0.2, 0.12, 0.92), (0.18, 0.035, 0.56), blue, rotation=(math.radians(-5), math.radians(7), math.radians(5)), bevel=0.018), "Cape.R")
    add(cube("CoatTrim.L", (0.2, 0.08, 0.4), (0.18, 0.02, 0.025), gold, rotation=(math.radians(-5), math.radians(-7), math.radians(-5)), bevel=0.008), "Cape.L")
    add(cube("CoatTrim.R", (-0.2, 0.08, 0.4), (0.18, 0.02, 0.025), gold, rotation=(math.radians(-5), math.radians(7), math.radians(5)), bevel=0.008), "Cape.R")

    return pieces


def create_hero_actions(armature, *, world_spin=False) -> None:
    bpy.context.scene.render.fps = 24
    armature.animation_data_create()
    all_bones = [bone.name for bone in armature.pose.bones]

    def build_action(name, frames):
        action = bpy.data.actions.new(name=name)
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, transforms in frames:
            for bone_name in all_bones:
                bone = armature.pose.bones[bone_name]
                bone.rotation_mode = "XYZ"
                spec = transforms.get(bone_name, {})
                bone.location = spec.get("location", (0, 0, 0))
                bone.rotation_euler = spec.get("rotation", (0, 0, 0))
                bone.scale = spec.get("scale", (1, 1, 1))
                bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
                bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
                bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)
        # Blender 5 stores F-curves inside layered Action channel bags. Keep
        # the legacy branch so the asset pipeline also works in Blender 4.x.
        if hasattr(action, "fcurves"):
            curves = action.fcurves
        else:
            curves = [
                curve
                for layer in action.layers
                for strip in layer.strips
                for channelbag in strip.channelbags
                for curve in channelbag.fcurves
            ]
        for curve in curves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"
        return action

    idle_low = {
        "Hips": {"location": (0, 0, -0.018)},
        "Chest": {"rotation": (0.02, 0, -0.025)},
        "Cape.L": {"rotation": (-0.02, 0.02, 0.025)},
        "Cape.R": {"rotation": (-0.02, -0.02, -0.025)},
    }
    idle_high = {
        "Hips": {"location": (0, 0, 0.025)},
        "Chest": {"rotation": (-0.025, 0, 0.03)},
        "Head": {"rotation": (0.025, 0, -0.018)},
        "UpperArm.L": {"rotation": (0.035, 0, 0.025)},
        "UpperArm.R": {"rotation": (-0.035, 0, -0.025)},
        "Cape.L": {"rotation": (0.045, 0.04, -0.02)},
        "Cape.R": {"rotation": (0.045, -0.04, 0.02)},
    }
    build_action("Idle", [(1, idle_low), (13, idle_high), (25, idle_low), (37, idle_high), (49, idle_low)])

    run_a = {
        "Hips": {"location": (0, 0, 0.035), "rotation": (0.13, 0, -0.06)},
        "Chest": {"rotation": (-0.12, 0, 0.08)},
        "UpperLeg.L": {"rotation": (0.68, 0, 0)},
        "LowerLeg.L": {"rotation": (-0.58, 0, 0)},
        "UpperLeg.R": {"rotation": (-0.62, 0, 0)},
        "LowerLeg.R": {"rotation": (0.28, 0, 0)},
        "UpperArm.L": {"rotation": (-0.42, 0.08, 0.04)},
        "UpperArm.R": {"rotation": (0.46, -0.08, -0.04)},
        "Cape.L": {"rotation": (0.32, 0.08, -0.05)},
        "Cape.R": {"rotation": (0.28, -0.08, 0.05)},
    }
    run_b = {
        "Hips": {"location": (0, 0, -0.015), "rotation": (0.1, 0, 0.05)},
        "Chest": {"rotation": (-0.1, 0, -0.07)},
        "UpperLeg.L": {"rotation": (-0.62, 0, 0)},
        "LowerLeg.L": {"rotation": (0.28, 0, 0)},
        "UpperLeg.R": {"rotation": (0.68, 0, 0)},
        "LowerLeg.R": {"rotation": (-0.58, 0, 0)},
        "UpperArm.L": {"rotation": (0.46, 0.08, 0.04)},
        "UpperArm.R": {"rotation": (-0.42, -0.08, -0.04)},
        "Cape.L": {"rotation": (0.25, 0.12, 0.06)},
        "Cape.R": {"rotation": (0.34, -0.12, -0.06)},
    }
    build_action("Run", [(1, run_a), (7, run_b), (13, run_a), (19, run_b), (25, run_a)])

    attack_windup = {
        "Hips": {"rotation": (0, 0, -0.22)},
        "Chest": {"rotation": (0.05, -0.18, -0.48)},
        "Head": {"rotation": (0, 0.12, 0.2)},
        "UpperArm.L": {"rotation": (-0.9, 0.28, 0.58)},
        "LowerArm.L": {"rotation": (-0.35, 0, 0.42)},
        "UpperArm.R": {"rotation": (0.72, -0.22, -0.7)},
        "LowerArm.R": {"rotation": (-0.35, 0, -0.36)},
        "Cape.L": {"rotation": (0.18, 0.12, 0.2)},
        "Cape.R": {"rotation": (0.12, -0.08, 0.14)},
    }
    attack_contact = {
        "Hips": {"location": (0, -0.07, 0), "rotation": (0, 0, 0.34)},
        "Chest": {"rotation": (-0.12, 0.2, 0.62)},
        "Head": {"rotation": (0, -0.12, -0.24)},
        "UpperArm.L": {"rotation": (0.62, -0.3, -0.82)},
        "LowerArm.L": {"rotation": (0.2, 0.1, -0.38)},
        "UpperArm.R": {"rotation": (-0.75, 0.24, 0.78)},
        "LowerArm.R": {"rotation": (0.18, -0.08, 0.42)},
        "Cape.L": {"rotation": (0.4, 0.18, -0.26)},
        "Cape.R": {"rotation": (0.35, -0.16, -0.2)},
    }
    attack_follow = {
        "Hips": {"rotation": (0, 0, 0.14)},
        "Chest": {"rotation": (-0.06, 0.08, 0.28)},
        "UpperArm.L": {"rotation": (0.25, -0.12, -0.38)},
        "UpperArm.R": {"rotation": (-0.3, 0.1, 0.42)},
        "Cape.L": {"rotation": (0.3, 0.1, -0.12)},
        "Cape.R": {"rotation": (0.28, -0.1, -0.08)},
    }
    build_action("Attack", [(1, {}), (5, attack_windup), (10, attack_contact), (15, attack_follow), (22, {})])

    dash_pose = {
        "Hips": {"location": (0, -0.08, -0.04), "rotation": (0.28, 0, 0)},
        "Chest": {"rotation": (-0.42, 0, 0)},
        "Head": {"rotation": (0.18, 0, 0)},
        "UpperArm.L": {"rotation": (0.72, 0.05, 0.2)},
        "UpperArm.R": {"rotation": (0.72, -0.05, -0.2)},
        "UpperLeg.L": {"rotation": (-0.42, 0, 0)},
        "UpperLeg.R": {"rotation": (-0.22, 0, 0)},
        "Cape.L": {"rotation": (0.82, 0.15, -0.12)},
        "Cape.R": {"rotation": (0.82, -0.15, 0.12)},
    }
    build_action("Dash", [(1, {}), (4, dash_pose), (11, dash_pose), (16, {})])

    hit_pose = {
        "Hips": {"location": (0, 0.06, -0.07), "rotation": (-0.12, 0, -0.15)},
        "Chest": {"rotation": (0.35, 0, 0.32)},
        "Head": {"rotation": (-0.28, 0, -0.18)},
        "UpperArm.L": {"rotation": (-0.32, 0, 0.38)},
        "UpperArm.R": {"rotation": (-0.32, 0, -0.38)},
        "Cape.L": {"rotation": (-0.3, 0.05, 0.14)},
        "Cape.R": {"rotation": (-0.3, -0.05, -0.14)},
    }
    build_action("Hit", [(1, {}), (3, hit_pose), (7, hit_pose), (13, {})])

    slash_anticipate = {
        "Hips": {"location": (0, 0, -0.08), "rotation": (0, 0, -0.75)},
        "Chest": {"rotation": (0.1, 0, -0.62)},
        "UpperArm.L": {"rotation": (-1.05, 0.2, 0.72)},
        "UpperArm.R": {"rotation": (0.95, -0.2, -0.72)},
        "Cape.L": {"rotation": (0.15, 0.16, 0.34)},
        "Cape.R": {"rotation": (0.15, -0.16, 0.34)},
    }
    slash_mid = {
        "Hips": {"location": (0, -0.08, 0.05), "rotation": (0, 0, 2.5)},
        "Chest": {"rotation": (-0.08, 0, 1.25)},
        "UpperArm.L": {"rotation": (0.42, -0.4, -1.0)},
        "UpperArm.R": {"rotation": (-0.42, 0.4, 1.0)},
        "Cape.L": {"rotation": (0.55, 0.28, -0.5)},
        "Cape.R": {"rotation": (0.55, -0.28, -0.5)},
    }
    slash_end = {
        "Hips": {"rotation": (0, 0, 2 * math.pi)},
        "Chest": {"rotation": (0, 0, 0.25)},
        "UpperArm.L": {"rotation": (0.2, -0.1, -0.3)},
        "UpperArm.R": {"rotation": (-0.2, 0.1, 0.3)},
        "Cape.L": {"rotation": (0.32, 0.12, -0.18)},
        "Cape.R": {"rotation": (0.32, -0.12, 0.18)},
    }
    if world_spin:
        for pose in (slash_anticipate, slash_mid, slash_end):
            rotation = pose["Hips"]["rotation"]
            pose["Hips"]["rotation"] = (rotation[0], rotation[1], 0)
        slash_anticipate["Cape.L"]["rotation"] = (0.08, 0.025, 0)
        slash_anticipate["Cape.R"]["rotation"] = (0.08, -0.025, 0)
        slash_mid["Cape.L"]["rotation"] = (0.12, 0.04, 0)
        slash_mid["Cape.R"]["rotation"] = (0.12, -0.04, 0)
        slash_end["Cape.L"]["rotation"] = (0.08, 0.025, 0)
        slash_end["Cape.R"]["rotation"] = (0.08, -0.025, 0)
    build_action("FutureSlash", [(1, {}), (5, slash_anticipate), (11, slash_mid), (18, slash_end), (24, {})])
    if world_spin:
        armature.rotation_mode = "XYZ"
        for frame, angle in ((1, 0), (5, -0.75), (11, 2.5), (18, 2 * math.pi), (24, 2 * math.pi)):
            armature.rotation_euler = (0, 0, angle)
            armature.keyframe_insert(data_path="rotation_euler", frame=frame, group="WorldSpin")

    armature.animation_data.action = bpy.data.actions.get("Idle")


def export_glb(filepath: Path, *, animations=False) -> None:
    kwargs = {
        "filepath": str(filepath),
        "export_format": "GLB",
        "export_animations": animations,
        "export_skins": animations,
        "export_morph": False,
        "export_apply": True,
        "export_cameras": False,
        "export_lights": False,
    }
    if animations:
        kwargs["export_animation_mode"] = "ACTIONS"
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_animation_mode", None)
        bpy.ops.export_scene.gltf(**kwargs)


def build_hero() -> None:
    clear_scene()
    armature = create_hero_rig()
    create_hero_geometry(armature)
    create_hero_actions(armature)
    bpy.context.scene["asset_name"] = "Chrono Duelist"
    bpy.context.scene["animation_clips"] = "Idle,Run,Attack,Dash,Hit,FutureSlash"
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / "chrono-duelist.blend"))
    export_glb(MODEL_DIR / "chrono-duelist.glb", animations=True)


def create_enemy_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    return root


def parent_new_objects(root, before):
    for obj in bpy.context.scene.objects:
        if obj not in before and obj != root and obj.parent is None:
            parent_keep_transform(obj, root)


def create_enemy_actions(root) -> None:
    """Author reusable whole-body clips for the modular enemy models.

    Enemy geometry stays as separate rigid clockwork parts, so animating the
    exported model root gives every piece the same deliberate lunge, recoil,
    and collapse without adding a high-cost armature to each crowd instance.
    """

    bpy.context.scene.render.fps = 24
    root.animation_data_create()
    root.rotation_mode = "XYZ"

    def build_action(name, frames):
        action = bpy.data.actions.new(name=name)
        action.use_fake_user = True
        root.animation_data.action = action
        for frame, transform in frames:
            root.location = transform.get("location", (0, 0, 0))
            root.rotation_euler = transform.get("rotation", (0, 0, 0))
            root.scale = transform.get("scale", (1, 1, 1))
            root.keyframe_insert(data_path="location", frame=frame)
            root.keyframe_insert(data_path="rotation_euler", frame=frame)
            root.keyframe_insert(data_path="scale", frame=frame)
        if hasattr(action, "fcurves"):
            curves = action.fcurves
        else:
            curves = [
                curve
                for layer in action.layers
                for strip in layer.strips
                for channelbag in strip.channelbags
                for curve in channelbag.fcurves
            ]
        for curve in curves:
            for point in curve.keyframe_points:
                point.interpolation = "BEZIER"
                point.handle_left_type = "AUTO_CLAMPED"
                point.handle_right_type = "AUTO_CLAMPED"

        # Blender's glTF ACTIONS exporter includes the active action and
        # actions stashed in NLA tracks. A fake user only keeps an Action in
        # the .blend; it does not make that Action exportable. Keep Idle as
        # the active preview clip and stash every alternate clip exactly as
        # Blender's importer does, including the Blender 5 Action slot.
        if name != "Idle":
            action_slot = getattr(root.animation_data, "action_slot", None)
            track = root.animation_data.nla_tracks.new(prev=None)
            track.name = name
            strip = track.strips.new(name, int(action.frame_range[0]), action)
            if action_slot is not None and hasattr(strip, "action_slot"):
                strip.action_slot = action_slot
            if hasattr(strip, "action_frame_start"):
                strip.action_frame_start = action.frame_range[0]
                strip.action_frame_end = action.frame_range[1]
            track.lock = True
            track.mute = True
        return action

    neutral = {"location": (0, 0, 0), "rotation": (0, 0, 0), "scale": (1, 1, 1)}
    build_action(
        "Idle",
        [
            (1, neutral),
            (13, {"location": (0, 0, 0.045), "rotation": (0.025, 0, 0.025), "scale": (1.02, 0.985, 1.02)}),
            (25, neutral),
        ],
    )
    build_action(
        "Move",
        [
            (1, {"location": (0, 0.03, 0.015), "rotation": (0.08, 0, -0.07), "scale": (1.02, 0.98, 1.03)}),
            (7, {"location": (0, -0.04, 0.055), "rotation": (-0.05, 0, 0.07), "scale": (0.98, 1.03, 0.98)}),
            (13, {"location": (0, 0.03, 0.015), "rotation": (0.08, 0, -0.07), "scale": (1.02, 0.98, 1.03)}),
        ],
    )
    build_action(
        "Attack",
        [
            (1, neutral),
            (4, {"location": (0, 0.16, -0.03), "rotation": (-0.16, 0, -0.08), "scale": (0.94, 1.08, 0.96)}),
            (8, {"location": (0, -0.34, 0.04), "rotation": (0.24, 0, 0.1), "scale": (1.1, 0.9, 1.06)}),
            (14, neutral),
        ],
    )
    build_action(
        "Hit",
        [
            (1, neutral),
            (3, {"location": (0, 0.16, 0.03), "rotation": (-0.18, 0.08, 0.22), "scale": (1.13, 0.82, 1.08)}),
            (7, neutral),
        ],
    )
    build_action(
        "Death",
        [
            (1, neutral),
            (6, {"location": (0, 0.12, -0.12), "rotation": (-0.38, 0.2, 0.42), "scale": (1.08, 0.82, 0.8)}),
            (13, {"location": (0, 0.2, -0.34), "rotation": (-1.28, 0.18, 0.72), "scale": (1.18, 0.5, 0.18)}),
        ],
    )
    root.animation_data.action = bpy.data.actions.get("Idle")


def build_enemy(kind: str) -> None:
    clear_scene()
    iron = material("EnemyIron", (0.055, 0.1, 0.16, 1), metallic=0.26, roughness=0.34)
    steel = material("EnemySteel", (0.3, 0.48, 0.58, 1), metallic=0.34, roughness=0.28)
    brass = material("EnemyBrass", (0.72, 0.39, 0.075, 1), metallic=0.5, roughness=0.28)
    red = material("EnemyRed", (0.55, 0.015, 0.025, 1), metallic=0.15, roughness=0.16, emission=(1.0, 0.015, 0.02), emission_strength=8)
    violet = material("EnemyViolet", (0.29, 0.055, 0.52, 1), metallic=0.2, roughness=0.18, emission=(0.55, 0.08, 1.0), emission_strength=6)
    cyan = material("EnemyCyan", (0.025, 0.55, 0.74, 1), metallic=0.2, roughness=0.18, emission=(0.03, 0.72, 1.0), emission_strength=6)
    root = create_enemy_root(f"{kind.title()}Root")
    before = set(bpy.context.scene.objects)

    if kind == "chaser":
        sphere("ChaserBody", (0, 0, 0.64), (0.42, 0.58, 0.3), iron, segments=12, rings=6)
        cone("ChaserHead", (0, -0.48, 0.68), 0.31, 0.17, 0.5, steel, rotation=(math.pi / 2, 0, 0), vertices=8)
        torus("ChaserGear", (0, 0.15, 0.68), 0.3, 0.045, brass, rotation=(math.pi / 2, 0, 0))
        sphere("ChaserEye", (0, -0.73, 0.71), (0.11, 0.035, 0.055), red, segments=10, rings=5)
        sphere("ChaserTopCore", (0, 0, 0.94), (0.14, 0.18, 0.045), cyan, segments=10, rings=5)
        for index, (x, y) in enumerate(((0.31, -0.25), (-0.31, -0.25), (0.34, 0.24), (-0.34, 0.24))):
            sign = 1 if x > 0 else -1
            cylinder_between(f"ChaserLeg{index}", (x * 0.6, y, 0.58), (x + 0.18 * sign, y + 0.12, 0.1), 0.055, steel, radius2=0.035, vertices=6)
            cone(f"ChaserClaw{index}", (x + 0.22 * sign, y + 0.07, 0.08), 0.07, 0.0, 0.25, brass, rotation=(0, math.radians(68) * sign, 0), vertices=6)
    elif kind == "shooter":
        sphere("ShooterBody", (0, 0, 0.8), (0.45, 0.4, 0.45), iron, segments=14, rings=7)
        torus("ShooterOrbit", (0, 0, 0.8), 0.55, 0.035, violet, rotation=(math.radians(18), 0, math.radians(12)))
        sphere("ShooterCore", (0, -0.38, 0.82), (0.17, 0.07, 0.17), violet, segments=12, rings=6)
        sphere("ShooterTopCore", (0, 0, 1.24), (0.15, 0.15, 0.045), violet, segments=10, rings=5)
        cylinder_between("ShooterBarrel", (0, -0.25, 0.82), (0, -0.9, 0.82), 0.09, steel, radius2=0.065, vertices=8)
        cone("ShooterMuzzle", (0, -0.96, 0.82), 0.13, 0.07, 0.18, brass, rotation=(math.pi / 2, 0, 0), vertices=8)
        for index, angle in enumerate((0, 2 * math.pi / 3, 4 * math.pi / 3)):
            x, y = math.cos(angle) * 0.28, math.sin(angle) * 0.28
            cylinder_between(f"ShooterFin{index}", (x, y, 0.62), (x * 1.8, y * 1.8, 0.18), 0.045, steel, radius2=0.02, vertices=6)
    elif kind == "thief":
        cone("ThiefBody", (0, 0, 0.72), 0.28, 0.18, 0.86, iron, vertices=8)
        sphere("ThiefHead", (0, -0.06, 1.22), (0.25, 0.22, 0.26), steel, segments=12, rings=6)
        sphere("ThiefEye", (0, -0.265, 1.24), (0.105, 0.03, 0.065), red, segments=10, rings=5)
        torus("ThiefHourglassTop", (0, -0.28, 0.8), 0.14, 0.025, brass, rotation=(math.pi / 2, 0, 0))
        torus("ThiefHourglassBottom", (0, -0.28, 0.5), 0.14, 0.025, brass, rotation=(math.pi / 2, 0, 0))
        sphere("StolenTime", (0, -0.3, 0.65), (0.08, 0.025, 0.13), cyan, segments=10, rings=5)
        torus("ThiefTopRune", (0, 0, 1.46), 0.16, 0.025, cyan)
        for side in (-1, 1):
            cone(f"ThiefWing{side}", (0.38 * side, 0.08, 0.86), 0.28, 0.03, 0.72, steel, rotation=(0, math.radians(72) * side, math.radians(18) * side), vertices=6)
            cylinder_between(f"ThiefArm{side}", (0.16 * side, 0, 0.93), (0.5 * side, -0.2, 0.57), 0.04, brass, radius2=0.02, vertices=6)
    elif kind == "boss":
        cone("BossTorso", (0, 0, 1.45), 0.72, 0.5, 1.45, iron, vertices=12, bevel=0.04)
        sphere("BossShoulders", (0, 0, 1.72), (0.9, 0.46, 0.35), steel, segments=14, rings=7)
        sphere("BossHead", (0, -0.05, 2.32), (0.43, 0.38, 0.42), iron, segments=14, rings=7)
        sphere("BossEye", (0, -0.39, 2.35), (0.18, 0.04, 0.09), red, segments=12, rings=6)
        torus("BossClock", (0, -0.55, 1.55), 0.36, 0.06, brass, rotation=(math.pi / 2, 0, 0))
        sphere("BossCore", (0, -0.59, 1.55), (0.22, 0.04, 0.22), red, segments=12, rings=6)
        torus("BossCrownClock", (0, 0, 2.72), 0.32, 0.045, red)
        for side in (-1, 1):
            cylinder_between(f"BossArm{side}", (0.55 * side, 0, 1.75), (1.05 * side, -0.08, 0.92), 0.18, steel, radius2=0.13, vertices=10)
            sphere(f"BossFist{side}", (1.08 * side, -0.1, 0.82), (0.24, 0.22, 0.25), brass, segments=10, rings=5)
            cone(f"BossHorn{side}", (0.34 * side, 0, 2.65), 0.14, 0.0, 0.62, brass, rotation=(0, math.radians(24) * side, 0), vertices=7)
            cylinder_between(f"BossLeg{side}", (0.3 * side, 0, 0.85), (0.38 * side, 0, 0.2), 0.23, iron, radius2=0.17, vertices=10)
            cube(f"BossFoot{side}", (0.38 * side, -0.16, 0.13), (0.25, 0.34, 0.13), steel, bevel=0.04)
    else:
        raise ValueError(f"Unknown enemy kind: {kind}")

    parent_new_objects(root, before)
    create_enemy_actions(root)
    bpy.context.scene["asset_name"] = f"Chrono Arena {kind.title()}"
    bpy.context.scene["animation_clips"] = "Idle,Move,Attack,Hit,Death"
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_DIR / f"enemy-{kind}.blend"))
    export_glb(MODEL_DIR / f"enemy-{kind}.glb", animations=True)


def main() -> None:
    bpy.context.preferences.filepaths.save_version = 0
    for enemy_kind in ("chaser", "shooter", "thief", "boss"):
        build_enemy(enemy_kind)
    # Build the hero last so the saved editable source remains open when this
    # script is launched in Blender's UI as well as from the command line.
    build_hero()
    print(f"CHRONO_ASSETS_READY {MODEL_DIR}")


if __name__ == "__main__":
    main()
