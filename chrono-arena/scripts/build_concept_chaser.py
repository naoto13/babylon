"""Build the concept-faithful production Chrono Chaser.

This remains separate from the older HD fallback asset so the production model
can be regenerated without destroying the previous implementation.

Unlike the earlier HD generator, anatomy is authored from continuous swept
surfaces.  Disconnected geometry is reserved for intentional mechanical layers:
armour plates, joint housings and luminous inlays.
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
MODEL_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(SCRIPT_DIR))
from build_blender_assets import (  # noqa: E402
    activate,
    clear_scene,
    export_glb,
    parent_keep_transform,
)
from build_custom_hero import make_mesh, pbr_material  # noqa: E402
from build_high_detail_enemies import (  # noqa: E402
    chaser_bones,
    create_chaser_actions,
    create_rig,
)


PARTS: list[bpy.types.Object] = []
REQUIRED_ACTIONS = {"Idle", "Move", "Attack", "Hit", "Death"}


def register(obj: bpy.types.Object, rig: bpy.types.Object, bone: str):
    group = obj.vertex_groups.new(name=bone)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    world_transform = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world_transform
    modifier = obj.modifiers.new("ChaserConceptRig", "ARMATURE")
    modifier.object = rig
    PARTS.append(obj)
    return obj


def add_modifier_and_apply(
    obj: bpy.types.Object,
    modifier_type: str,
    name: str,
    **properties,
) -> None:
    print(
        f"MODIFIER_BEGIN object={obj.name} type={modifier_type} "
        f"vertices={len(obj.data.vertices)}",
        flush=True,
    )
    modifier = obj.modifiers.new(name, modifier_type)
    for property_name, value in properties.items():
        setattr(modifier, property_name, value)
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    print(
        f"MODIFIER_END object={obj.name} type={modifier_type} "
        f"vertices={len(obj.data.vertices)}",
        flush=True,
    )


def signed_power(value: float, exponent: float) -> float:
    return math.copysign(abs(value) ** exponent, value)


def fixed_axis_loft(
    name: str,
    sections: list[dict],
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    sides: int = 48,
    exponent: float = 0.82,
    bevel: float = 0.0,
    subdivision: int = 1,
):
    """Create a sculpted shell whose cross-sections live in the X/Z plane."""

    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    for section_index, section in enumerate(sections):
        cx, cy, cz = section["center"]
        radius_x, radius_z = section["radius"]
        top_bias = section.get("top_bias", 0.0)
        belly_flatten = section.get("belly_flatten", 0.0)
        twist = section.get("twist", 0.0)
        for side in range(sides):
            angle = math.tau * side / sides + twist
            cosine = signed_power(math.cos(angle), exponent)
            sine = signed_power(math.sin(angle), exponent)
            z_offset = radius_z * sine
            if sine > 0:
                z_offset *= 1.0 + top_bias * sine
            else:
                z_offset *= 1.0 - belly_flatten * abs(sine)
            vertices.append((cx + radius_x * cosine, cy, cz + z_offset))

        if section_index:
            previous = (section_index - 1) * sides
            current = section_index * sides
            for side in range(sides):
                following = (side + 1) % sides
                faces.append(
                    (
                        previous + side,
                        previous + following,
                        current + following,
                        current + side,
                    )
                )

    faces.append(tuple(reversed(range(sides))))
    last = (len(sections) - 1) * sides
    faces.append(tuple(last + index for index in range(sides)))
    obj = make_mesh(name, vertices, faces, mat, smooth=True)
    if subdivision:
        add_modifier_and_apply(
            obj,
            "SUBSURF",
            "SculptContinuity",
            levels=subdivision,
            render_levels=subdivision,
            subdivision_type="CATMULL_CLARK",
        )
    if bevel:
        add_modifier_and_apply(
            obj,
            "BEVEL",
            "EdgeCatchlight",
            width=bevel,
            segments=3,
            limit_method="ANGLE",
        )
    return register(obj, rig, bone)


def swept_limb(
    name: str,
    points: list[tuple[float, float, float]],
    radii: list[tuple[float, float]],
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    sides: int = 32,
    subdivision: int = 1,
):
    """Create a tapered, curved, non-cylindrical mechanical muscle shell."""

    if len(points) != len(radii):
        raise ValueError(f"{name}: points and radii must match")
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    previous_width_axis: Vector | None = None

    for index, coordinate in enumerate(points):
        point = Vector(coordinate)
        if index == 0:
            tangent = Vector(points[1]) - point
        elif index == len(points) - 1:
            tangent = point - Vector(points[index - 1])
        else:
            tangent = Vector(points[index + 1]) - Vector(points[index - 1])
        tangent.normalize()

        reference = Vector((0, 0, 1))
        if abs(tangent.dot(reference)) > 0.92:
            reference = Vector((0, 1, 0))
        width_axis = tangent.cross(reference).normalized()
        if previous_width_axis is not None and width_axis.dot(previous_width_axis) < 0:
            width_axis.negate()
        depth_axis = width_axis.cross(tangent).normalized()
        previous_width_axis = width_axis.copy()

        radius_width, radius_depth = radii[index]
        for side in range(sides):
            angle = math.tau * side / sides
            # A slightly squared superellipse reads as forged armour over
            # anatomy, without falling back to a faceted low-poly cylinder.
            c = signed_power(math.cos(angle), 0.86)
            s = signed_power(math.sin(angle), 0.86)
            offset = width_axis * c * radius_width + depth_axis * s * radius_depth
            vertices.append(tuple(point + offset))

        if index:
            previous = (index - 1) * sides
            current = index * sides
            for side in range(sides):
                following = (side + 1) % sides
                faces.append(
                    (
                        previous + side,
                        previous + following,
                        current + following,
                        current + side,
                    )
                )

    faces.append(tuple(reversed(range(sides))))
    last = (len(points) - 1) * sides
    faces.append(tuple(last + index for index in range(sides)))
    obj = make_mesh(name, vertices, faces, mat, smooth=True)
    if subdivision:
        add_modifier_and_apply(
            obj,
            "SUBSURF",
            "LimbSurfaceContinuity",
            levels=subdivision,
            render_levels=subdivision,
            subdivision_type="CATMULL_CLARK",
        )
    return register(obj, rig, bone)


def curved_armour_patch(
    name: str,
    *,
    y_start: float,
    y_end: float,
    center_z_start: float,
    center_z_end: float,
    radius_x_start: float,
    radius_x_end: float,
    radius_z_start: float,
    radius_z_end: float,
    angle_start: float,
    angle_end: float,
    thickness: float,
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    rows: int = 7,
    columns: int = 20,
    crest: float = 0.0,
):
    """Create one fitted, volumetric armour plate over the torso."""

    outer: list[tuple[float, float, float]] = []
    inner: list[tuple[float, float, float]] = []
    for row in range(rows):
        v = row / (rows - 1)
        smooth_v = v * v * (3.0 - 2.0 * v)
        y = y_start + (y_end - y_start) * v
        center_z = center_z_start + (center_z_end - center_z_start) * smooth_v
        radius_x = radius_x_start + (radius_x_end - radius_x_start) * smooth_v
        radius_z = radius_z_start + (radius_z_end - radius_z_start) * smooth_v
        for column in range(columns):
            u = column / (columns - 1)
            angle = angle_start + (angle_end - angle_start) * u
            edge_falloff = math.sin(math.pi * u) ** 0.7
            ridge = crest * edge_falloff * math.sin(math.pi * v)
            normal = Vector((math.cos(angle), 0, math.sin(angle))).normalized()
            base = Vector(
                (
                    radius_x * math.cos(angle),
                    y,
                    center_z + radius_z * math.sin(angle) + ridge,
                )
            )
            outer.append(tuple(base + normal * thickness * 0.55))
            inner.append(tuple(base - normal * thickness * 0.45))

    vertices = outer + inner
    layer_size = rows * columns
    faces: list[tuple[int, ...]] = []
    for layer in (0, layer_size):
        reverse = layer != 0
        for row in range(rows - 1):
            for column in range(columns - 1):
                a = layer + row * columns + column
                quad = (a, a + 1, a + columns + 1, a + columns)
                faces.append(tuple(reversed(quad)) if reverse else quad)

    def bridge(outer_indices: list[int], inner_indices: list[int]) -> None:
        for first, second, inner_first, inner_second in zip(
            outer_indices,
            outer_indices[1:],
            inner_indices,
            inner_indices[1:],
        ):
            faces.append((first, second, inner_second, inner_first))

    top = [(rows - 1) * columns + column for column in range(columns)]
    bottom = [column for column in range(columns)]
    left = [row * columns for row in range(rows)]
    right = [row * columns + columns - 1 for row in range(rows)]
    for edge in (top, bottom, left, right):
        bridge(edge, [index + layer_size for index in edge])

    obj = make_mesh(name, vertices, faces, mat, smooth=True)
    add_modifier_and_apply(
        obj,
        "BEVEL",
        "ForgedPlateEdge",
        width=0.008,
        segments=3,
        limit_method="ANGLE",
    )
    return register(obj, rig, bone)


def radial_mechanism(
    name: str,
    *,
    center: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    teeth: int = 14,
    segments_per_tooth: int = 8,
    inner_ring_ratio: float = 0.67,
    hub_ratio: float = 0.20,
    spoke_width: int = 2,
    plane: str = "XZ",
):
    """Create teeth, annular rim, hub and spokes as one connected mesh."""

    count = teeth * segments_per_tooth
    radii = {
        "outer": [],
        "ring_inner": [],
        "hub_outer": [],
        "hub_inner": [],
    }
    for index in range(count):
        phase = index % segments_per_tooth
        on_tooth = 1 <= phase <= segments_per_tooth - 2
        tooth_profile = 1.0 if on_tooth else 0.0
        radii["outer"].append(radius * (1.0 + 0.12 * tooth_profile))
        radii["ring_inner"].append(radius * inner_ring_ratio)
        radii["hub_outer"].append(radius * hub_ratio)
        radii["hub_inner"].append(radius * 0.075)

    if plane not in {"XZ", "YZ"}:
        raise ValueError(f"{name}: unsupported mechanism plane {plane}")
    cx, cy, cz = center
    vertices: list[tuple[float, float, float]] = []
    ring_names = ("outer", "ring_inner", "hub_outer", "hub_inner")
    for depth_offset in (-depth * 0.5, depth * 0.5):
        for ring_name in ring_names:
            for index in range(count):
                angle = math.tau * index / count
                r = radii[ring_name][index]
                if plane == "XZ":
                    vertices.append(
                        (
                            cx + math.cos(angle) * r,
                            cy + depth_offset,
                            cz + math.sin(angle) * r,
                        )
                    )
                else:
                    vertices.append(
                        (
                            cx + depth_offset,
                            cy + math.cos(angle) * r,
                            cz + math.sin(angle) * r,
                        )
                    )

    layer_stride = count * len(ring_names)

    def vertex(layer: int, ring: int, index: int) -> int:
        return layer * layer_stride + ring * count + index % count

    faces: list[tuple[int, ...]] = []
    for layer in (0, 1):
        flip = layer == 0
        for index in range(count):
            following = (index + 1) % count
            rim = (
                vertex(layer, 0, index),
                vertex(layer, 0, following),
                vertex(layer, 1, following),
                vertex(layer, 1, index),
            )
            hub = (
                vertex(layer, 2, index),
                vertex(layer, 2, following),
                vertex(layer, 3, following),
                vertex(layer, 3, index),
            )
            faces.append(tuple(reversed(rim)) if flip else rim)
            faces.append(tuple(reversed(hub)) if flip else hub)

            tooth_index = index // segments_per_tooth
            spoke_center = tooth_index * segments_per_tooth
            local = (index - spoke_center) % count
            if local < spoke_width or local >= count - spoke_width:
                spoke = (
                    vertex(layer, 1, index),
                    vertex(layer, 1, following),
                    vertex(layer, 2, following),
                    vertex(layer, 2, index),
                )
                faces.append(tuple(reversed(spoke)) if flip else spoke)

    for ring in (0, 3):
        for index in range(count):
            following = (index + 1) % count
            wall = (
                vertex(0, ring, index),
                vertex(1, ring, index),
                vertex(1, ring, following),
                vertex(0, ring, following),
            )
            faces.append(wall if ring == 0 else tuple(reversed(wall)))

    # Connect front/back surfaces only at the two lateral edges of each spoke.
    # Adding a wall at every spoke segment duplicates faces after beveling.
    for tooth_index in range(teeth):
        leading = tooth_index * segments_per_tooth
        trailing = leading + spoke_width
        faces.append(
            (
                vertex(0, 1, leading),
                vertex(1, 1, leading),
                vertex(1, 2, leading),
                vertex(0, 2, leading),
            )
        )
        faces.append(
            (
                vertex(0, 1, trailing),
                vertex(0, 2, trailing),
                vertex(1, 2, trailing),
                vertex(1, 1, trailing),
            )
        )

    obj = make_mesh(name, vertices, faces, mat, smooth=False)
    return register(obj, rig, bone)


def extruded_outline(
    name: str,
    points_xz: list[tuple[float, float]],
    y: float,
    depth: float,
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    bevel: float = 0.006,
):
    count = len(points_xz)
    vertices = [
        (x, y - depth * 0.5, z) for x, z in points_xz
    ] + [
        (x, y + depth * 0.5, z) for x, z in points_xz
    ]
    faces: list[tuple[int, ...]] = [
        tuple(range(count)),
        tuple(reversed(range(count, count * 2))),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    obj = make_mesh(name, vertices, faces, mat, smooth=False)
    if bevel:
        add_modifier_and_apply(
            obj,
            "BEVEL",
            "OutlineEdge",
            width=bevel,
            segments=3,
            limit_method="ANGLE",
        )
    return register(obj, rig, bone)


def extruded_outline_yz(
    name: str,
    points_yz: list[tuple[float, float]],
    x: float,
    depth: float,
    mat: bpy.types.Material,
    rig: bpy.types.Object,
    bone: str,
    *,
    bevel: float = 0.004,
):
    """Create a fitted side inlay with its face in the Y/Z plane."""

    count = len(points_yz)
    vertices = [
        (x - depth * 0.5, y, z) for y, z in points_yz
    ] + [
        (x + depth * 0.5, y, z) for y, z in points_yz
    ]
    faces: list[tuple[int, ...]] = [
        tuple(range(count)),
        tuple(reversed(range(count, count * 2))),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    obj = make_mesh(name, vertices, faces, mat, smooth=False)
    if bevel:
        add_modifier_and_apply(
            obj,
            "BEVEL",
            "SideInlayEdge",
            width=bevel,
            segments=3,
            limit_method="ANGLE",
        )
    return register(obj, rig, bone)


def build_materials() -> dict[str, bpy.types.Material]:
    return {
        "underbody": pbr_material(
            "ChaserConceptUnderbody",
            # 下地の布目を残し、殻より一段暗く保つ。
            (0.035, 0.046, 0.063, 1),
            metallic=0.04,
            roughness=0.88,
        ),
        "iron": pbr_material(
            "ChaserConceptMidnightIron",
            # 旧値の約 3.5 倍。黒ではなく中間調ガンメタルを albedo にする。
            (0.147, 0.182, 0.228, 1),
            metallic=0.85,
            roughness=0.42,
            coat=0.15,
        ),
        "steel": pbr_material(
            "ChaserConceptBlueSteel",
            (0.16, 0.18, 0.21, 1),
            metallic=0.80,
            roughness=0.30,
            coat=0.30,
        ),
        "brass": pbr_material(
            "ChaserConceptAntiqueBrass",
            (0.28, 0.32, 0.39, 1),
            metallic=0.90,
            roughness=0.20,
            coat=0.28,
        ),
        "cyan": pbr_material(
            "ChaserConceptChronoCyan",
            (0.28, 0.010, 0.030, 1),
            metallic=0.12,
            roughness=0.16,
            # #e11d48 heat in cracks; kept local so the shell remains black iron.
            emission=(0.78, 0.012, 0.055),
            emission_strength=0.50,
        ),
        "eye": pbr_material(
            "ChaserConceptPredatorEye",
            (0.36, 0.012, 0.035, 1),
            metallic=0.08,
            roughness=0.1,
            emission=(0.88, 0.015, 0.065),
            emission_strength=1.10,
        ),
        "black": pbr_material(
            "ChaserConceptJointBlack",
            (0.006, 0.008, 0.011, 1),
            metallic=0.85,
            roughness=0.42,
            coat=0.15,
        ),
    }


def body_surface(rig, mats):
    sections = [
        {"center": (0, -0.48, 0.68), "radius": (0.30, 0.24), "top_bias": 0.12},
        {"center": (0, -0.42, 0.70), "radius": (0.39, 0.30), "top_bias": 0.12},
        {"center": (0, -0.30, 0.72), "radius": (0.47, 0.36), "top_bias": 0.13},
        {"center": (0, -0.14, 0.74), "radius": (0.50, 0.38), "top_bias": 0.14},
        {"center": (0, 0.02, 0.75), "radius": (0.48, 0.37), "top_bias": 0.14},
        {"center": (0, 0.18, 0.74), "radius": (0.44, 0.35), "top_bias": 0.12},
        {"center": (0, 0.38, 0.72), "radius": (0.43, 0.34), "top_bias": 0.1},
        {"center": (0, 0.57, 0.69), "radius": (0.39, 0.31), "top_bias": 0.08},
        {"center": (0, 0.68, 0.67), "radius": (0.30, 0.23), "top_bias": 0.06},
    ]
    return fixed_axis_loft(
        "ChaserConceptContinuousTorso",
        sections,
        mats["underbody"],
        rig,
        "Body",
        sides=52,
        exponent=0.9,
        subdivision=2,
    )


def head_surface(rig, mats):
    sections = [
        {"center": (0, -0.38, 0.71), "radius": (0.265, 0.225), "top_bias": 0.18},
        {"center": (0, -0.51, 0.69), "radius": (0.30, 0.245), "top_bias": 0.2},
        {"center": (0, -0.68, 0.64), "radius": (0.275, 0.215), "top_bias": 0.18},
        {"center": (0, -0.84, 0.59), "radius": (0.235, 0.18), "top_bias": 0.13},
        {"center": (0, -1.00, 0.55), "radius": (0.18, 0.135), "top_bias": 0.08},
        {"center": (0, -1.14, 0.52), "radius": (0.125, 0.09), "top_bias": 0.04},
        {"center": (0, -1.22, 0.51), "radius": (0.075, 0.052), "top_bias": 0.0},
    ]
    return fixed_axis_loft(
        "ChaserConceptContinuousSkull",
        sections,
        mats["iron"],
        rig,
        "Head",
        sides=48,
        exponent=0.76,
        subdivision=2,
    )


def body_armour(rig, mats):
    plate_ranges = [
        (-0.41, -0.235, 0.70, 0.73, 0.405, 0.475, 0.305, 0.37),
        (-0.215, -0.035, 0.73, 0.75, 0.48, 0.48, 0.375, 0.375),
        (-0.015, 0.17, 0.75, 0.74, 0.475, 0.445, 0.37, 0.35),
        (0.19, 0.385, 0.74, 0.72, 0.44, 0.43, 0.345, 0.335),
        (0.405, 0.62, 0.72, 0.68, 0.42, 0.34, 0.33, 0.26),
    ]
    for index, values in enumerate(plate_ranges):
        curved_armour_patch(
            f"ChaserConceptDorsalPlate{index + 1:02d}",
            y_start=values[0],
            y_end=values[1],
            center_z_start=values[2],
            center_z_end=values[3],
            radius_x_start=values[4],
            radius_x_end=values[5],
            radius_z_start=values[6],
            radius_z_end=values[7],
            angle_start=math.radians(13),
            angle_end=math.radians(167),
            thickness=0.065,
            mat=mats["steel"] if index % 2 else mats["iron"],
            rig=rig,
            bone="Body",
            crest=0.04,
        )

    # A raised central keel is the dominant front-view line from the concept.
    # It is swept along the back instead of being a box extruded through it.
    swept_limb(
        "ChaserConceptSpinalKeel",
        [
            (0, -0.41, 1.055),
            (0, -0.22, 1.115),
            (0, 0.0, 1.14),
            (0, 0.22, 1.10),
            (0, 0.43, 1.01),
        ],
        [(0.024, 0.018), (0.03, 0.022), (0.033, 0.024), (0.03, 0.021), (0.022, 0.016)],
        mats["brass"],
        rig,
        "Body",
        sides=20,
        subdivision=1,
    )


def head_armour(rig, mats):
    """Layer fitted helmet plates over the skull's continuous under-surface."""

    plate_ranges = [
        (-0.43, -0.55, 0.71, 0.68, 0.275, 0.305, 0.23, 0.245),
        (-0.57, -0.70, 0.68, 0.635, 0.30, 0.27, 0.24, 0.21),
        (-0.72, -0.85, 0.63, 0.585, 0.265, 0.23, 0.205, 0.175),
        (-0.87, -1.00, 0.58, 0.545, 0.225, 0.175, 0.17, 0.13),
        (-1.02, -1.14, 0.54, 0.515, 0.17, 0.12, 0.125, 0.085),
    ]
    for index, values in enumerate(plate_ranges):
        curved_armour_patch(
            f"ChaserConceptSkullPlate{index + 1:02d}",
            y_start=values[0],
            y_end=values[1],
            center_z_start=values[2],
            center_z_end=values[3],
            radius_x_start=values[4],
            radius_x_end=values[5],
            radius_z_start=values[6],
            radius_z_end=values[7],
            angle_start=math.radians(8),
            angle_end=math.radians(172),
            thickness=0.052,
            mat=mats["steel"] if index in {1, 3} else mats["iron"],
            rig=rig,
            bone="Head",
            rows=6,
            columns=18,
            crest=0.018,
        )


def head_details(rig, mats):
    # Brow and cheek shells follow the long wedge of the skull instead of
    # reading as a sphere plus a cone.
    for side in (-1, 1):
        sign = float(side)
        extruded_outline(
            f"ChaserConceptBrowPlate{'L' if side > 0 else 'R'}",
            [
                (0.02 * sign, 0.665),
                (0.27 * sign, 0.72),
                (0.235 * sign, 0.585),
                (0.105 * sign, 0.535),
            ],
            -1.00,
            0.055,
            mats["brass"],
            rig,
            "Head",
            bevel=0.008,
        )
        extruded_outline_yz(
            f"ChaserConceptEyeSlit{'L' if side > 0 else 'R'}",
            [
                (-0.79, 0.655),
                (-1.045, 0.615),
                (-1.105, 0.565),
                (-0.86, 0.60),
            ],
            0.24 * sign,
            0.026,
            mats["eye"],
            rig,
            "Head",
            bevel=0.004,
        )
        extruded_outline(
            f"ChaserConceptCheekBlade{'L' if side > 0 else 'R'}",
            [
                (0.20 * sign, 0.59),
                (0.39 * sign, 0.72),
                (0.31 * sign, 0.48),
                (0.17 * sign, 0.42),
            ],
            -0.79,
            0.065,
            mats["brass"],
            rig,
            "Head",
            bevel=0.008,
        )

    extruded_outline(
        "ChaserConceptNasalArmour",
        [
            (-0.105, 0.57),
            (-0.075, 0.66),
            (0, 0.695),
            (0.075, 0.66),
            (0.105, 0.57),
            (0.075, 0.45),
            (0, 0.41),
            (-0.075, 0.45),
        ],
        -1.185,
        0.045,
        mats["steel"],
        rig,
        "Head",
        bevel=0.008,
    )
    for side in (-1, 1):
        extruded_outline_yz(
            f"ChaserConceptFlankChronoInlay{'L' if side > 0 else 'R'}",
            [
                (-0.34, 0.77),
                (-0.10, 0.805),
                (0.16, 0.775),
                (0.31, 0.72),
                (0.08, 0.735),
                (-0.16, 0.72),
            ],
            0.475 * side,
            0.018,
            mats["cyan"],
            rig,
            "Body",
            bevel=0.003,
        )
    swept_limb(
        "ChaserConceptLowerJaw",
        [
            (0, -0.69, 0.49),
            (0, -0.88, 0.42),
            (0, -1.08, 0.42),
            (0, -1.20, 0.47),
        ],
        [(0.19, 0.08), (0.17, 0.068), (0.115, 0.052), (0.055, 0.032)],
        mats["black"],
        rig,
        "Head",
        sides=28,
        subdivision=1,
    )


def joint_disc(
    name: str,
    center: tuple[float, float, float],
    radius: float,
    depth: float,
    mat,
    rig,
    bone,
):
    return radial_mechanism(
        name,
        center=center,
        radius=radius,
        depth=depth,
        mat=mat,
        rig=rig,
        bone=bone,
        teeth=12,
        segments_per_tooth=4,
        inner_ring_ratio=0.48,
        hub_ratio=0.32,
        spoke_width=1,
        plane="YZ",
    )


def paw_surface(
    name: str,
    ankle: tuple[float, float, float],
    sign: int,
    forward: float,
    mat,
    claw_mat,
    rig,
    bone,
):
    x, y, z = ankle
    points = [
        (x, y, z + 0.02),
        (x + 0.015 * sign, y - 0.06, z - 0.01),
        (x + 0.018 * sign, y - forward * 0.55, 0.095),
        (x, y - forward, 0.075),
    ]
    radii = [(0.095, 0.075), (0.125, 0.07), (0.145, 0.052), (0.115, 0.032)]
    paw = swept_limb(
        name,
        points,
        radii,
        mat,
        rig,
        bone,
        sides=32,
        subdivision=0,
    )

    # Three forged talons are intentional hard-surface attachments.  Their
    # tapered diamond profiles avoid the previous cone placeholder language.
    for claw_index, offset in enumerate((-0.085, 0.0, 0.085)):
        base_x = x + offset
        y_tip = y - forward - 0.17
        vertices = [
            (base_x - 0.034, y - forward + 0.01, 0.07),
            (base_x + 0.034, y - forward + 0.01, 0.07),
            (base_x + 0.027, y - forward + 0.01, 0.125),
            (base_x - 0.027, y - forward + 0.01, 0.125),
            (base_x, y_tip, 0.04),
        ]
        faces = [
            (0, 1, 2, 3),
            (0, 4, 1),
            (1, 4, 2),
            (2, 4, 3),
            (3, 4, 0),
        ]
        claw = make_mesh(
            f"{name}Talon{claw_index + 1}",
            vertices,
            faces,
            claw_mat,
            smooth=False,
        )
        add_modifier_and_apply(
            claw,
            "BEVEL",
            "TalonEdge",
            width=0.004,
            segments=2,
            limit_method="ANGLE",
        )
        register(claw, rig, bone)
    return paw


def polyline_sample(
    points: list[tuple[float, float, float]],
    factor: float,
) -> tuple[float, float, float]:
    vectors = [Vector(point) for point in points]
    lengths = [
        (vectors[index + 1] - vectors[index]).length
        for index in range(len(vectors) - 1)
    ]
    total = sum(lengths)
    target = max(0.0, min(1.0, factor)) * total
    traversed = 0.0
    for index, length in enumerate(lengths):
        if target <= traversed + length or index == len(lengths) - 1:
            local = 0.0 if length == 0 else (target - traversed) / length
            return tuple(vectors[index].lerp(vectors[index + 1], local))
        traversed += length
    return tuple(vectors[-1])


def segmented_limb_sheath(
    name: str,
    path: list[tuple[float, float, float]],
    base_radius: float,
    mat,
    rig,
    bone,
):
    """Create one connected overlapping-plate shell around a limb segment."""

    samples = [
        (0.06, 0.78),
        (0.14, 1.08),
        (0.23, 1.04),
        (0.27, 0.76),
        (0.36, 1.00),
        (0.46, 0.96),
        (0.50, 0.73),
        (0.60, 0.91),
        (0.70, 0.87),
        (0.74, 0.69),
        (0.83, 0.82),
        (0.94, 0.68),
    ]
    sheath_points = [polyline_sample(path, factor) for factor, _ in samples]
    sheath_radii = [
        (base_radius * scale, base_radius * scale * 0.84)
        for _, scale in samples
    ]
    return swept_limb(
        name,
        sheath_points,
        sheath_radii,
        mat,
        rig,
        bone,
        sides=32,
        subdivision=0,
    )


def limbs(rig, mats):
    specs = [
        {
            "prefix": "Front",
            "side": "L",
            "sign": 1,
            "shoulder": (0.34, -0.25, 0.71),
            "elbow": (0.49, -0.48, 0.39),
            "ankle": (0.53, -0.68, 0.15),
            "forward": 0.25,
            "upper_radius": 0.155,
        },
        {
            "prefix": "Front",
            "side": "R",
            "sign": -1,
            "shoulder": (-0.34, -0.25, 0.71),
            "elbow": (-0.49, -0.48, 0.39),
            "ankle": (-0.53, -0.68, 0.15),
            "forward": 0.25,
            "upper_radius": 0.155,
        },
        {
            "prefix": "Back",
            "side": "L",
            "sign": 1,
            "shoulder": (0.37, 0.37, 0.70),
            "elbow": (0.51, 0.56, 0.42),
            "ankle": (0.53, 0.70, 0.16),
            "forward": 0.22,
            "upper_radius": 0.19,
        },
        {
            "prefix": "Back",
            "side": "R",
            "sign": -1,
            "shoulder": (-0.37, 0.37, 0.70),
            "elbow": (-0.51, 0.56, 0.42),
            "ankle": (-0.53, 0.70, 0.16),
            "forward": 0.22,
            "upper_radius": 0.19,
        },
    ]
    for spec in specs:
        prefix = spec["prefix"]
        side = spec["side"]
        sign = spec["sign"]
        shoulder = Vector(spec["shoulder"])
        elbow = Vector(spec["elbow"])
        ankle = Vector(spec["ankle"])
        upper_bone = f"{prefix}Upper.{side}"
        lower_bone = f"{prefix}Lower.{side}"

        upper_points = [
            tuple(shoulder),
            tuple(shoulder.lerp(elbow, 0.22) + Vector((0.025 * sign, 0, 0.03))),
            tuple(shoulder.lerp(elbow, 0.52) + Vector((0.035 * sign, 0, 0.02))),
            tuple(shoulder.lerp(elbow, 0.82)),
            tuple(elbow),
        ]
        upper_radius = spec["upper_radius"]
        swept_limb(
            f"ChaserConcept{prefix}Upper{side}",
            upper_points,
            [
                (upper_radius * 0.73, upper_radius * 0.66),
                (upper_radius * 0.78, upper_radius * 0.68),
                (upper_radius * 0.70, upper_radius * 0.61),
                (upper_radius * 0.58, upper_radius * 0.53),
                (upper_radius * 0.50, upper_radius * 0.46),
            ],
            mats["black"],
            rig,
            upper_bone,
            sides=36,
            subdivision=1,
        )
        segmented_limb_sheath(
            f"ChaserConcept{prefix}UpperPlateShell{side}",
            upper_points,
            upper_radius,
            mats["iron"],
            rig,
            upper_bone,
        )
        joint_disc(
            f"ChaserConcept{prefix}ShoulderGear{side}",
            tuple(shoulder + Vector((0.018 * sign, -0.01, 0))),
            upper_radius * 1.1,
            0.075,
            mats["brass"],
            rig,
            upper_bone,
        )
        lower_points = [
            tuple(elbow),
            tuple(elbow.lerp(ankle, 0.25) + Vector((0.015 * sign, 0, 0.01))),
            tuple(elbow.lerp(ankle, 0.55) + Vector((0.01 * sign, 0, -0.005))),
            tuple(elbow.lerp(ankle, 0.8)),
            tuple(ankle),
        ]
        swept_limb(
            f"ChaserConcept{prefix}Lower{side}",
            lower_points,
            [
                (0.083, 0.072),
                (0.086, 0.069),
                (0.072, 0.061),
                (0.059, 0.051),
                (0.052, 0.045),
            ],
            mats["black"],
            rig,
            lower_bone,
            sides=32,
            subdivision=1,
        )
        segmented_limb_sheath(
            f"ChaserConcept{prefix}LowerPlateShell{side}",
            lower_points,
            0.112,
            mats["steel"],
            rig,
            lower_bone,
        )
        joint_disc(
            f"ChaserConcept{prefix}KneeGear{side}",
            tuple(elbow + Vector((0.012 * sign, 0, 0))),
            0.145,
            0.065,
            mats["brass"],
            rig,
            lower_bone,
        )
        paw_surface(
            f"ChaserConcept{prefix}Paw{side}",
            tuple(ankle),
            sign,
            spec["forward"],
            mats["iron"],
            mats["brass"],
            rig,
            lower_bone,
        )

        # One swept plate follows each limb's anatomical line.  It is a fitted
        # armour layer, not a box laid over a cylinder.
        blade_points = [
            (
                shoulder.x + 0.04 * sign,
                shoulder.y,
                shoulder.z + upper_radius * 0.6,
            ),
            (
                shoulder.x + 0.14 * sign,
                shoulder.y + (elbow.y - shoulder.y) * 0.52,
                shoulder.z + (elbow.z - shoulder.z) * 0.48 + 0.08,
            ),
            (
                elbow.x + 0.11 * sign,
                elbow.y,
                elbow.z + 0.02,
            ),
            (
                elbow.x + 0.055 * sign,
                elbow.y,
                elbow.z - 0.06,
            ),
        ]
        blade = extruded_outline(
            f"ChaserConcept{prefix}LimbBlade{side}",
            [(point[0], point[2]) for point in blade_points],
            sum(point[1] for point in blade_points) / len(blade_points),
            0.07,
            mats["brass"],
            rig,
            upper_bone,
            bevel=0.008,
        )
        blade.rotation_euler.y = 0.08 * sign


def tail(rig, mats):
    points = [
        (0, 0.61, 0.70),
        (0, 0.74, 0.65),
        (0, 0.88, 0.56),
        (0, 1.03, 0.46),
        (0, 1.18, 0.36),
        (0, 1.31, 0.27),
        (0, 1.42, 0.20),
    ]
    swept_limb(
        "ChaserConceptContinuousTail",
        points,
        [
            (0.13, 0.13),
            (0.125, 0.12),
            (0.11, 0.105),
            (0.095, 0.09),
            (0.078, 0.074),
            (0.058, 0.052),
            (0.025, 0.022),
        ],
        mats["iron"],
        rig,
        "Tail",
        sides=32,
        subdivision=1,
    )
    for index, point in enumerate(points[1:-1], start=1):
        x, y, z = point
        extruded_outline(
            f"ChaserConceptTailFin{index:02d}",
            [(-0.065, z), (0, z + 0.15 - index * 0.012), (0.065, z), (0, z - 0.03)],
            y,
            0.052,
            mats["brass"] if index % 2 else mats["steel"],
            rig,
            "Tail",
            bevel=0.005,
        )


def mechanisms(rig, mats):
    radial_mechanism(
        "ChaserConceptDorsalChronoGear",
        center=(0, 0.08, 1.12),
        radius=0.43,
        depth=0.10,
        mat=mats["brass"],
        rig=rig,
        bone="Gear",
        teeth=14,
        segments_per_tooth=8,
        inner_ring_ratio=0.7,
        hub_ratio=0.2,
        spoke_width=2,
    )
    radial_mechanism(
        "ChaserConceptDorsalEnergyRotor",
        center=(0, 0.022, 1.12),
        radius=0.245,
        depth=0.035,
        mat=mats["cyan"],
        rig=rig,
        bone="Gear",
        teeth=10,
        segments_per_tooth=6,
        inner_ring_ratio=0.72,
        hub_ratio=0.22,
        spoke_width=1,
    )

    # Side housings establish the large circular shoulder/hip motifs visible
    # in the concept side view.
    for side in (-1, 1):
        sign = float(side)
        joint_disc(
            f"ChaserConceptTorsoChronometer{'L' if side > 0 else 'R'}",
            (0.46 * sign, -0.12, 0.76),
            0.22,
            0.055,
            mats["brass"],
            rig,
            "Body",
        )
        joint_disc(
            f"ChaserConceptHipChronometer{'L' if side > 0 else 'R'}",
            (0.40 * sign, 0.31, 0.68),
            0.19,
            0.05,
            mats["steel"],
            rig,
            "Body",
        )


def consolidate(rig: bpy.types.Object) -> bpy.types.Object:
    if not PARTS:
        raise RuntimeError("No chaser geometry created")
    corrected_parts: list[str] = []
    for obj in PARTS:
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
        if obj.data.validate(verbose=False, clean_customdata=True):
            corrected_parts.append(obj.name)
        obj.data.update(calc_edges=True)

    print(
        f"PART_VALIDATE corrected={corrected_parts}",
        flush=True,
    )

    bpy.ops.object.select_all(action="DESELECT")
    for obj in PARTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = "ChaserConceptMesh"
    merged.data.name = "ChaserConceptMesh"
    for polygon in merged.data.polygons:
        polygon.use_smooth = True

    parent_keep_transform(merged, rig)
    modifier = merged.modifiers.new("ChaserConceptDeform", "ARMATURE")
    modifier.object = rig

    for vertex in merged.data.vertices:
        memberships = [item for item in vertex.groups if item.weight > 1e-8]
        if len(memberships) != 1:
            raise RuntimeError(
                f"Chaser concept vertex {vertex.index} has "
                f"{len(memberships)} rigid influences"
            )
        memberships[0].weight = 1.0
    return merged


def refresh_existing_chaser_materials() -> bpy.types.Object:
    """Replace only material datablocks in the exported production source."""

    source_path = SOURCE_DIR / "enemy-chaser-concept.blend"
    if not source_path.is_file():
        raise RuntimeError(f"chaser: material refresh source is missing: {source_path}")
    bpy.ops.wm.open_mainfile(filepath=str(source_path))
    rigs = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(rigs) != 1:
        raise RuntimeError(f"chaser: expected one rig in material refresh source, got {len(rigs)}")
    action_names = {action.name for action in bpy.data.actions}
    missing_actions = REQUIRED_ACTIONS - action_names
    if missing_actions:
        raise RuntimeError(f"chaser: material refresh source missing actions: {sorted(missing_actions)}")

    categories = {
        "ChaserConceptUnderbody": "underbody",
        "ChaserConceptMidnightIron": "iron",
        "ChaserConceptBlueSteel": "steel",
        "ChaserConceptAntiqueBrass": "brass",
        "ChaserConceptChronoCyan": "cyan",
        "ChaserConceptPredatorEye": "eye",
        "ChaserConceptJointBlack": "black",
    }
    original_materials = {
        name: bpy.data.materials.get(name)
        for name in categories
    }
    missing_materials = sorted(name for name, material in original_materials.items() if material is None)
    if missing_materials:
        raise RuntimeError(
            f"chaser: material refresh source missing materials: {', '.join(missing_materials)}"
        )

    refreshed = build_materials()
    replacements = 0
    replaced_categories = set()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for slot_index, slot in enumerate(obj.material_slots):
            category = categories.get(slot.material.name) if slot.material else None
            if category:
                obj.data.materials[slot_index] = refreshed[category]
                replacements += 1
                replaced_categories.add(category)
    expected_categories = set(categories.values())
    if replaced_categories != expected_categories:
        raise RuntimeError(
            f"chaser: material refresh expected roles {sorted(expected_categories)}, "
            f"replaced {sorted(replaced_categories)} across {replacements} slots"
        )
    for name, original in original_materials.items():
        bpy.data.materials.remove(original, do_unlink=True)
        refreshed[categories[name]].name = name
    print(
        f"CONCEPT_CHASER_MATERIAL_REFRESH source={source_path} "
        f"bones={len(rigs[0].data.bones)} actions={','.join(sorted(action_names))}",
        flush=True,
    )
    return rigs[0]


def main() -> None:
    bpy.context.preferences.filepaths.save_version = 0
    clear_scene()
    PARTS.clear()
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    materials_only = "--materials-only" in sys.argv[separator + 1 :]
    if materials_only:
        rig = refresh_existing_chaser_materials()
        bpy.context.scene["asset_name"] = "Chrono Arena Chaser Concept Production"
        bpy.context.scene["design_reference"] = "chaser-turnaround-v2.png"
        bpy.context.scene["animation_clips"] = "Idle,Move,Attack,Hit,Death"
        bpy.context.scene["pipeline"] = "continuous-surface-concept-translation-v1"
        bpy.context.scene["runtime_role"] = "chaser"
        bpy.context.scene["production_asset"] = True
        source_path = SOURCE_DIR / "enemy-chaser-concept.blend"
        model_path = MODEL_DIR / "enemy-chaser-concept.glb"
        bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
        export_glb(model_path, animations=True)
        print(
            "CONCEPT_CHASER_READY "
            f"source={source_path} model={model_path} "
            f"bones={len(rig.data.bones)} mode=material-refresh",
            flush=True,
        )
        return
    mats = build_materials()
    rig = create_rig("ChaserConcept", chaser_bones())

    print("BUILD_STAGE body_surface", flush=True)
    body_surface(rig, mats)
    print("BUILD_STAGE head_surface", flush=True)
    head_surface(rig, mats)
    print("BUILD_STAGE body_armour", flush=True)
    body_armour(rig, mats)
    print("BUILD_STAGE head_armour", flush=True)
    head_armour(rig, mats)
    print("BUILD_STAGE head_details", flush=True)
    head_details(rig, mats)
    print("BUILD_STAGE limbs", flush=True)
    limbs(rig, mats)
    print("BUILD_STAGE tail", flush=True)
    tail(rig, mats)
    print("BUILD_STAGE mechanisms", flush=True)
    mechanisms(rig, mats)
    print("BUILD_STAGE actions", flush=True)
    create_chaser_actions(rig)
    print("BUILD_STAGE consolidate", flush=True)
    merged = consolidate(rig)
    corrected_invalid_data = merged.data.validate(
        verbose=False,
        clean_customdata=True,
    )
    merged.data.update(calc_edges=True)
    print(
        f"MESH_VALIDATE corrected={corrected_invalid_data}",
        flush=True,
    )

    bpy.context.scene["asset_name"] = "Chrono Arena Chaser Concept Production"
    bpy.context.scene["design_reference"] = "chaser-turnaround-v2.png"
    bpy.context.scene["animation_clips"] = "Idle,Move,Attack,Hit,Death"
    bpy.context.scene["pipeline"] = "continuous-surface-concept-translation-v1"
    bpy.context.scene["runtime_role"] = "chaser"
    bpy.context.scene["production_asset"] = True

    source_path = SOURCE_DIR / "enemy-chaser-concept.blend"
    model_path = MODEL_DIR / "enemy-chaser-concept.glb"
    print("BUILD_STAGE save", flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(source_path))
    print("BUILD_STAGE export", flush=True)
    export_glb(model_path, animations=True)
    merged.data.calc_loop_triangles()
    print(
        "CONCEPT_CHASER_READY "
        f"source={source_path} model={model_path} "
        f"vertices={len(merged.data.vertices)} "
        f"triangles={len(merged.data.loop_triangles)} "
        f"bones={len(rig.data.bones)} materials={len(merged.data.materials)}"
    )


if __name__ == "__main__":
    main()
