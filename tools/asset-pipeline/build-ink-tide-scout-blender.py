#!/usr/bin/env python3
"""Build and validate the Ink Tide Scout Blender blockout.

The build phase requires MPFB 2.0.17 to be enabled in an isolated Blender profile.
The validate phase imports the exported GLB in a fresh Blender process and checks the
semantic-part, finite-geometry, scale, and material boundaries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

import bpy
from mathutils import Vector


ADDON_ID = "bl_ext.blender_org.mpfb"
EXPECTED_MPFB_VERSION = "2.0.17"
EXPECTED_BLENDER_VERSION = (5, 2, 0)
FRONT_AXIS = "-Y"

SEMANTIC_PARTS = (
    "body",
    "eyes",
    "hair_cap",
    "hair_bangs",
    "hair_sides",
    "ahoge",
    "ear_l",
    "ear_r",
    "ear_inner_l",
    "ear_inner_r",
    "inner_top",
    "jacket",
    "sailor_collar",
    "shorts",
    "belt",
    "belt_buckle",
    "glove_l",
    "glove_r",
    "boot_l",
    "boot_r",
    "tail",
)

PALETTE = {
    "skin": "#f4cdb8",
    "hair": "#e6b783",
    "hair_shadow": "#8b5b46",
    "coral": "#ee6d6b",
    "teal": "#138d9b",
    "cyan": "#21c9d0",
    "white": "#e9eff0",
    "eye": "#12a9ac",
    "dark": "#563d43",
}

DETAIL_TARGETS = (
    ("head-scale-horiz-incr", 0.28),
    ("head-scale-vert-incr", 0.12),
    ("head-scale-depth-incr", 0.12),
    ("head-round", 0.32),
    ("chin-width-decr", 0.34),
    ("chin-height-decr", 0.18),
    ("l-eye-scale-incr", 0.28),
    ("r-eye-scale-incr", 0.28),
    ("nose-scale-horiz-decr", 0.28),
    ("nose-scale-vert-decr", 0.18),
    ("nose-scale-depth-decr", 0.32),
    ("mouth-scale-horiz-decr", 0.12),
    ("l-ear-scale-decr", 0.35),
    ("r-ear-scale-decr", 0.35),
)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("build", "validate"), required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hex_rgba(value: str) -> tuple[float, float, float, float]:
    raw = value.removeprefix("#")
    channels = [int(raw[index : index + 2], 16) / 255.0 for index in (0, 2, 4)]

    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(linear(channel) for channel in channels) + (1.0,)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def make_material(
    name: str,
    color: str,
    *,
    roughness: float = 0.72,
    metallic: float = 0.0,
    emission: str | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = hex_rgba(color)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = hex_rgba(color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission and "Emission Color" in shader.inputs:
        shader.inputs["Emission Color"].default_value = hex_rgba(emission)
        shader.inputs["Emission Strength"].default_value = emission_strength
    return material


def tag_part(obj: bpy.types.Object, semantic_id: str) -> bpy.types.Object:
    obj.name = semantic_id
    obj["semantic_id"] = semantic_id
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)


def apply_object_transform(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def create_uv_ellipsoid(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    segments: int = 64,
    ring_count: int = 32,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=ring_count, location=location)
    obj = bpy.context.active_object
    obj.scale = scale
    apply_object_transform(obj)
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def create_rounded_cube(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    bevel: float = 0.012,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.active_object
    obj.scale = scale
    apply_object_transform(obj)
    bevel_modifier = obj.modifiers.new("rounded", "BEVEL")
    bevel_modifier.width = bevel
    bevel_modifier.segments = 4
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def create_curve_mesh(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    material: bpy.types.Material,
    *,
    resolution: int = 5,
    radii: list[float] | None = None,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(f"{name}_curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = 5
    curve.resolution_u = 12
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    if radii is not None and len(radii) != len(points):
        raise ValueError(f"radii length does not match points for {name}")
    for index, (point, coordinate) in enumerate(zip(spline.bezier_points, points, strict=True)):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
        point.radius = radii[index] if radii is not None else 1.0
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, material)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    tag_part(obj, name)
    return obj


def create_prism(
    name: str,
    front_points: list[tuple[float, float, float]],
    depth: float,
    material: bpy.types.Material,
    *,
    bevel: float = 0.006,
) -> bpy.types.Object:
    vertices = []
    for x, y, z in front_points:
        vertices.append((x, y - depth / 2.0, z))
    for x, y, z in front_points:
        vertices.append((x, y + depth / 2.0, z))
    count = len(front_points)
    faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    modifier = obj.modifiers.new("soft_edges", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def create_cat_ear(
    name: str,
    side: float,
    head_center: Vector,
    head_size: Vector,
    base_z: float,
    height: float,
    outer_material: bpy.types.Material,
    inner_material: bpy.types.Material,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    inner_x = side * head_size.x * 0.31
    outer_x = side * head_size.x * 0.70
    front_y = head_center.y - head_size.y * 0.18
    back_y = head_center.y + head_size.y * 0.27
    tip = (side * head_size.x * 0.52, head_center.y + head_size.y * 0.015, base_z + height)
    vertices = [
        (inner_x, front_y, base_z),
        (outer_x, front_y, base_z - head_size.z * 0.02),
        (outer_x, back_y, base_z - head_size.z * 0.02),
        (inner_x, back_y, base_z),
        tip,
    ]
    faces = [(0, 3, 2, 1), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    outer = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(outer)
    bevel = outer.modifiers.new("ear_edge_softness", "BEVEL")
    bevel.width = 0.005
    bevel.segments = 4
    tag_part(outer, name)
    assign_material(outer, outer_material)

    inner = create_prism(
        f"{name.replace('ear_', 'ear_inner_')}",
        [
            (inner_x * 1.02, front_y - 0.003, base_z + head_size.z * 0.025),
            (outer_x * 0.91, front_y - 0.003, base_z + head_size.z * 0.010),
            (tip[0], front_y - 0.003, base_z + height * 0.77),
        ],
        0.003,
        inner_material,
        bevel=0.002,
    )
    return outer, inner


def create_partial_ellipsoid_shell(
    name: str,
    center: Vector,
    radius: Vector,
    material: bpy.types.Material,
) -> bpy.types.Object:
    theta_steps = 28
    phi_steps = 56
    theta_min = 0.035
    theta_max = math.radians(132.0)
    phi_min = math.radians(-28.0)
    phi_max = math.radians(208.0)
    vertices = []
    for theta_index in range(theta_steps + 1):
        for phi_index in range(phi_steps + 1):
            phi = phi_min + (phi_max - phi_min) * phi_index / phi_steps
            scallop = math.radians(5.0) * (0.5 + 0.5 * math.cos(phi * 6.0))
            local_theta_max = theta_max + scallop
            theta = theta_min + (local_theta_max - theta_min) * theta_index / theta_steps
            sin_theta = math.sin(theta)
            vertices.append(
                (
                    center.x + radius.x * sin_theta * math.cos(phi),
                    center.y + radius.y * sin_theta * math.sin(phi),
                    center.z + radius.z * math.cos(theta),
                )
            )
    faces = []
    row = phi_steps + 1
    for theta_index in range(theta_steps):
        for phi_index in range(phi_steps):
            index = theta_index * row + phi_index
            faces.append((index, index + 1, index + row + 1, index + row))
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    solidify = obj.modifiers.new("hair_shell_thickness", "SOLIDIFY")
    solidify.thickness = 0.008
    solidify.offset = 0.0
    bevel = obj.modifiers.new("hair_shell_edge", "BEVEL")
    bevel.width = 0.004
    bevel.segments = 3
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def create_hair_ribbon(
    name: str,
    centers: list[tuple[float, float, float]],
    widths: list[float],
    depth: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    if len(centers) != len(widths) or len(centers) < 2:
        raise ValueError(f"invalid hair ribbon definition for {name}")
    vertices = []
    for x, y, z in centers:
        width = widths[len(vertices) // 4]
        vertices.extend(
            [
                (x - width, y - depth / 2.0, z),
                (x + width, y - depth / 2.0, z),
                (x - width, y + depth / 2.0, z),
                (x + width, y + depth / 2.0, z),
            ]
        )
    faces = []
    for index in range(len(centers) - 1):
        current = index * 4
        nxt = (index + 1) * 4
        faces.extend(
            [
                (current, current + 1, nxt + 1, nxt),
                (current + 2, nxt + 2, nxt + 3, current + 3),
                (current, nxt, nxt + 2, current + 2),
                (current + 1, current + 3, nxt + 3, nxt + 1),
            ]
        )
    faces.extend([(0, 2, 3, 1), (len(vertices) - 4, len(vertices) - 3, len(vertices) - 1, len(vertices) - 2)])
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bevel = obj.modifiers.new("hair_ribbon_edge", "BEVEL")
    bevel.width = min(widths) * 0.28
    bevel.segments = 4
    subdivision = obj.modifiers.new("hair_ribbon_surface", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 2
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def body_vertex_indices(body: bpy.types.Object) -> set[int]:
    group = body.vertex_groups.get("body")
    if group is None:
        raise RuntimeError("MPFB body vertex group is missing")
    index = group.index
    return {
        vertex.index
        for vertex in body.data.vertices
        if any(membership.group == index and membership.weight > 0.5 for membership in vertex.groups)
    }


def vertex_group_center(body: bpy.types.Object, group_name: str) -> Vector:
    group = body.vertex_groups.get(group_name)
    if group is None:
        raise RuntimeError(f"MPFB vertex group is missing: {group_name}")
    points = [
        body.matrix_world @ vertex.co
        for vertex in body.data.vertices
        if any(membership.group == group.index and membership.weight > 0.0 for membership in vertex.groups)
    ]
    if not points:
        raise RuntimeError(f"MPFB vertex group has no vertices: {group_name}")
    return sum(points, Vector()) / len(points)


def extract_body_shell(
    body: bpy.types.Object,
    name: str,
    predicate: Callable[[Vector], bool],
    offset: float,
    material: bpy.types.Material,
    *,
    z_limits: tuple[float, float] | None = None,
) -> bpy.types.Object:
    allowed = body_vertex_indices(body)
    selected_polygons = []
    for polygon in body.data.polygons:
        if not all(index in allowed for index in polygon.vertices):
            continue
        center = sum((body.data.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)
        if predicate(center):
            selected_polygons.append(polygon)
    if not selected_polygons:
        raise RuntimeError(f"no source polygons selected for {name}")

    source_indices = sorted({index for polygon in selected_polygons for index in polygon.vertices})
    remap = {source_index: output_index for output_index, source_index in enumerate(source_indices)}
    vertices = []
    for source_index in source_indices:
        vertex = body.data.vertices[source_index]
        coordinate = vertex.co + vertex.normal.normalized() * offset
        if z_limits is not None:
            coordinate.z = min(z_limits[1], max(z_limits[0], coordinate.z))
        vertices.append(tuple(coordinate))
    faces = [tuple(remap[index] for index in polygon.vertices) for polygon in selected_polygons]
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    smooth = obj.modifiers.new("cloth_surface_smooth", "SMOOTH")
    smooth.factor = 0.18
    smooth.iterations = 3
    solidify = obj.modifiers.new("cloth_thickness", "SOLIDIFY")
    solidify.thickness = max(0.003, offset * 0.55)
    solidify.offset = 0.0
    bevel = obj.modifiers.new("cloth_edge_softness", "BEVEL")
    bevel.width = 0.0035
    bevel.segments = 3
    tag_part(obj, name)
    assign_material(obj, material)
    return obj


def visible_body_copy(source: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph, preserve_all_data_layers=True)
    body = bpy.data.objects.new("body", mesh)
    bpy.context.collection.objects.link(body)
    tag_part(body, "body")
    assign_material(body, material)
    return body


def mesh_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return {
        "min": [min(point[index] for point in points) for index in range(3)],
        "max": [max(point[index] for point in points) for index in range(3)],
    }


def inspect_objects(objects: list[bpy.types.Object]) -> dict[str, Any]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    records = []
    non_finite = 0
    total_triangles = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        triangles = len(evaluated_mesh.loop_triangles)
        total_triangles += triangles
        non_finite += sum(
            1
            for vertex in evaluated_mesh.vertices
            if not all(math.isfinite(value) for value in vertex.co)
        )
        records.append(
            {
                "name": obj.name,
                "semanticId": obj.get("semantic_id"),
                "vertices": len(evaluated_mesh.vertices),
                "triangles": triangles,
                "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
            }
        )
        evaluated.to_mesh_clear()
    return {
        "objects": records,
        "meshCount": len(records),
        "triangles": total_triangles,
        "nonFiniteVertexCount": non_finite,
        "bounds": mesh_bounds([obj for obj in objects if obj.type == "MESH"]),
    }


def create_human_foundation() -> tuple[bpy.types.Object, dict[str, Any]]:
    if ADDON_ID not in bpy.context.preferences.addons:
        raise RuntimeError(f"MPFB extension is not enabled: {ADDON_ID}")

    from bl_ext.blender_org.mpfb.services import HumanService, TargetService

    macro = TargetService.get_default_macro_info_dict()
    macro.update(
        {
            "gender": 0.02,
            "age": 0.44,
            "muscle": 0.34,
            "weight": 0.44,
            "proportions": 0.38,
            "height": 0.42,
            "cupsize": 0.38,
            "firmness": 0.58,
            "race": {"african": 0.0, "asian": 0.68, "caucasian": 0.32},
        }
    )
    body_source = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=macro,
    )
    body_source.name = "body_source_mpfb"
    body_source.data.name = "body_source_mpfb_mesh"

    missing_targets = [name for name, _value in DETAIL_TARGETS if not TargetService.target_full_path(name)]
    if missing_targets:
        raise RuntimeError(f"MPFB detail targets are missing: {missing_targets}")
    TargetService.bulk_load_targets(
        body_source,
        [{"target": name, "value": value} for name, value in DETAIL_TARGETS],
        encode_target_names=False,
    )
    TargetService.bake_targets(body_source)
    body_source.data.update()
    body_source.hide_render = True
    body_source.hide_set(True)
    body_source["foundation"] = "MPFB 2.0.17 bundled/system assets"
    return body_source, {"macro": macro, "detailTargets": dict(DETAIL_TARGETS)}


def add_hair_and_face(
    body: bpy.types.Object,
    source_body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    body_height = max(vertex.co.z for vertex in body.data.vertices)
    head_vertices = [vertex.co for vertex in body.data.vertices if vertex.co.z > body_height * 0.82]
    head_min = Vector((
        min(point.x for point in head_vertices),
        min(point.y for point in head_vertices),
        min(point.z for point in head_vertices),
    ))
    head_max = Vector((
        max(point.x for point in head_vertices),
        max(point.y for point in head_vertices),
        max(point.z for point in head_vertices),
    ))
    center = (head_min + head_max) * 0.5
    size = head_max - head_min
    parts: list[bpy.types.Object] = []

    cap = create_partial_ellipsoid_shell(
        "hair_cap",
        Vector((center.x, center.y + size.y * 0.07, center.z + size.z * 0.03)),
        Vector((size.x * 0.54, size.y * 0.56, size.z * 0.51)),
        materials["hair"],
    )
    parts.append(cap)

    side_objects = []
    for index, side in enumerate((-1.0, 1.0)):
        for row in range(3):
            x = side * (size.x * (0.39 + row * 0.045))
            y = center.y + size.y * (0.055 + row * 0.018)
            start = (x * 0.70, y, head_max.z - size.z * (0.08 + row * 0.030))
            middle = (x, y - size.y * 0.025, center.z - size.z * (0.01 + row * 0.035))
            end = (x * 0.94, y + size.y * 0.02, head_min.z + size.z * (0.02 - row * 0.015))
            side_objects.append(
                create_curve_mesh(
                    f"hair_side_{index}_{row}",
                    [start, middle, end],
                    0.011,
                    materials["hair"],
                    radii=[1.0, 0.82, 0.24],
                )
            )
    side_root = bpy.data.objects.new("hair_sides", None)
    bpy.context.collection.objects.link(side_root)
    side_root["semantic_id"] = "hair_sides"
    for obj in side_objects:
        obj.parent = side_root
    parts.extend(side_objects)
    parts.append(side_root)

    bang_objects = []
    for index in range(5):
        t = (index - 2) / 2.0
        start = (t * size.x * 0.10, head_min.y + size.y * 0.010, head_max.z - size.z * 0.08)
        upper = (t * size.x * 0.22, head_min.y - size.y * 0.010, center.z + size.z * 0.27)
        middle = (t * size.x * 0.31, head_min.y - size.y * 0.020, center.z + size.z * 0.14)
        end_z = center.z + size.z * (0.015 - 0.045 * (1.0 - abs(t)))
        end = (t * size.x * 0.37, head_min.y - size.y * 0.018, end_z)
        bang_objects.append(
            create_hair_ribbon(
                f"hair_bang_{index}",
                [start, upper, middle, end],
                [size.x * 0.055, size.x * 0.050, size.x * 0.040, size.x * 0.010],
                size.y * 0.032,
                materials["hair"],
            )
        )
    bang_root = bpy.data.objects.new("hair_bangs", None)
    bpy.context.collection.objects.link(bang_root)
    bang_root["semantic_id"] = "hair_bangs"
    for obj in bang_objects:
        obj.parent = bang_root
    parts.extend(bang_objects)
    parts.append(bang_root)

    ahoge = create_curve_mesh(
        "ahoge",
        [
            (0.0, center.y, head_max.z - 0.005),
            (-0.015, center.y - 0.005, head_max.z + 0.085),
            (0.035, center.y - 0.010, head_max.z + 0.125),
            (0.065, center.y - 0.006, head_max.z + 0.095),
        ],
        0.008,
        materials["hair"],
    )
    parts.append(ahoge)

    ear_height = size.z * 0.43
    ear_base_z = head_max.z - size.z * 0.12
    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        ear, inner = create_cat_ear(
            f"ear_{suffix}",
            side,
            center,
            size,
            ear_base_z,
            ear_height,
            materials["hair"],
            materials["coral"],
        )
        parts.extend([ear, inner])

    eye_objects = []
    for group_name, suffix in (("joint-l-eye-target", "l"), ("joint-r-eye-target", "r")):
        eye_target = vertex_group_center(source_body, group_name)
        white = create_uv_ellipsoid(
            f"eye_white_{suffix}",
            (eye_target.x, eye_target.y - 0.0018, eye_target.z),
            (size.x * 0.070, size.y * 0.014, size.z * 0.054),
            materials["white"],
            segments=48,
            ring_count=24,
        )
        iris = create_uv_ellipsoid(
            f"eye_iris_{suffix}",
            (eye_target.x, eye_target.y - 0.0046, eye_target.z),
            (size.x * 0.034, size.y * 0.009, size.z * 0.038),
            materials["eye"],
            segments=40,
            ring_count=20,
        )
        pupil = create_uv_ellipsoid(
            f"eye_pupil_{suffix}",
            (eye_target.x, eye_target.y - 0.0064, eye_target.z - size.z * 0.002),
            (size.x * 0.013, size.y * 0.005, size.z * 0.024),
            materials["dark"],
            segments=32,
            ring_count=16,
        )
        catchlight = create_uv_ellipsoid(
            f"eye_catchlight_{suffix}",
            (
                eye_target.x - size.x * 0.009,
                eye_target.y - 0.0077,
                eye_target.z + size.z * 0.013,
            ),
            (size.x * 0.008, size.y * 0.003, size.z * 0.008),
            materials["white"],
            segments=24,
            ring_count=12,
        )
        eye_objects.extend([white, iris, pupil, catchlight])
    eye_root = bpy.data.objects.new("eyes", None)
    bpy.context.collection.objects.link(eye_root)
    eye_root["semantic_id"] = "eyes"
    for obj in eye_objects:
        obj.parent = eye_root
    parts.extend(eye_objects)
    parts.append(eye_root)
    return parts


def add_costume_and_tail(
    source_body: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> list[bpy.types.Object]:
    height = max(vertex.co.z for vertex in source_body.data.vertices)
    parts: list[bpy.types.Object] = []

    inner_top = extract_body_shell(
        source_body,
        "inner_top",
        lambda center: height * 0.50 < center.z < height * 0.74 and abs(center.x) < height * 0.112,
        0.008,
        materials["cyan"],
        z_limits=(height * 0.50, height * 0.74),
    )
    parts.append(inner_top)

    jacket_root = bpy.data.objects.new("jacket", None)
    bpy.context.collection.objects.link(jacket_root)
    jacket_root["semantic_id"] = "jacket"
    jacket_torso = extract_body_shell(
        source_body,
        "jacket_torso",
        lambda center: (
            height * 0.645 < center.z < height * 0.79
            and abs(center.x) < height * 0.122
            and not (center.y < -height * 0.045 and abs(center.x) < height * 0.070 and center.z < height * 0.75)
        ),
        0.017,
        materials["coral"],
        z_limits=(height * 0.645, height * 0.79),
    )
    jacket_torso.parent = jacket_root
    parts.extend([jacket_root, jacket_torso])

    for group_side, suffix in (("l", "l"), ("r", "r")):
        shoulder = vertex_group_center(source_body, f"joint-{group_side}-shoulder")
        elbow = vertex_group_center(source_body, f"joint-{group_side}-elbow")
        upper_arm = elbow - shoulder
        arm_length_squared = upper_arm.length_squared

        def arm_progress(point: Vector, start: Vector = shoulder, axis: Vector = upper_arm) -> float:
            return (point - start).dot(axis) / arm_length_squared

        def arm_axis_distance(point: Vector, start: Vector = shoulder, axis: Vector = upper_arm) -> float:
            progress = arm_progress(point, start, axis)
            return (point - (start + axis * progress)).length

        sleeve = extract_body_shell(
            source_body,
            f"jacket_sleeve_{suffix}",
            lambda center: 0.01 < arm_progress(center) < 0.48
            and arm_axis_distance(center) < height * 0.043,
            0.020,
            materials["coral"],
        )
        cuff = extract_body_shell(
            source_body,
            f"sleeve_cuff_{suffix}",
            lambda center: 0.44 < arm_progress(center) < 0.60
            and arm_axis_distance(center) < height * 0.046,
            0.024,
            materials["white"],
        )
        sleeve.parent = jacket_root
        cuff.parent = jacket_root
        parts.extend([sleeve, cuff])

    collar_root = bpy.data.objects.new("sailor_collar", None)
    bpy.context.collection.objects.link(collar_root)
    collar_root["semantic_id"] = "sailor_collar"
    collar_back = create_prism(
        "sailor_collar_back",
        [
            (-height * 0.105, height * 0.055, height * 0.735),
            (height * 0.105, height * 0.055, height * 0.735),
            (height * 0.085, height * 0.060, height * 0.684),
            (-height * 0.085, height * 0.060, height * 0.684),
        ],
        height * 0.008,
        materials["coral"],
        bevel=height * 0.003,
    )
    collar_left = create_prism(
        "sailor_collar_front_l",
        [
            (-height * 0.105, -height * 0.068, height * 0.735),
            (-height * 0.018, -height * 0.080, height * 0.680),
            (-height * 0.050, -height * 0.080, height * 0.735),
        ],
        height * 0.006,
        materials["coral"],
        bevel=height * 0.002,
    )
    collar_right = create_prism(
        "sailor_collar_front_r",
        [
            (height * 0.105, -height * 0.068, height * 0.735),
            (height * 0.018, -height * 0.080, height * 0.680),
            (height * 0.050, -height * 0.080, height * 0.735),
        ],
        height * 0.006,
        materials["coral"],
        bevel=height * 0.002,
    )
    for collar_part in (collar_back, collar_left, collar_right):
        collar_part.parent = collar_root
    parts.extend([collar_root, collar_back, collar_left, collar_right])

    shorts = extract_body_shell(
        source_body,
        "shorts",
        lambda center: height * 0.34 < center.z < height * 0.54 and abs(center.x) < height * 0.19,
        0.014,
        materials["teal"],
        z_limits=(height * 0.34, height * 0.54),
    )
    parts.append(shorts)

    shorts_cuff_z = height * 0.342
    for side, suffix in ((-1.0, "r"), (1.0, "l")):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=height * 0.043,
            minor_radius=height * 0.007,
            major_segments=64,
            minor_segments=12,
            location=(side * height * 0.080, -height * 0.020, shorts_cuff_z),
        )
        shorts_cuff = bpy.context.active_object
        shorts_cuff.scale.y = 0.88
        apply_object_transform(shorts_cuff)
        tag_part(shorts_cuff, f"shorts_cuff_{suffix}")
        assign_material(shorts_cuff, materials["white"])
        parts.append(shorts_cuff)

    for side, suffix in ((-1.0, "l"), (1.0, "r")):
        glove = extract_body_shell(
            source_body,
            f"glove_{suffix}",
            lambda center, side=side: (
                side * center.x > height * 0.235 and height * 0.37 < center.z < height * 0.57
            ),
            0.010,
            materials["teal"],
            z_limits=(height * 0.37, height * 0.57),
        )
        parts.append(glove)
        boot = extract_body_shell(
            source_body,
            f"boot_{suffix}",
            lambda center, side=side: side * center.x > height * 0.045 and center.z < height * 0.18,
            0.016,
            materials["white"],
            z_limits=(0.0, height * 0.18),
        )
        parts.append(boot)

        foot_center = vertex_group_center(source_body, f"joint-{suffix}-foot-2")
        toe_cap = create_uv_ellipsoid(
            f"boot_toe_{suffix}",
            (foot_center.x, foot_center.y + height * 0.018, height * 0.027),
            (height * 0.033, height * 0.037, height * 0.018),
            materials["white"],
            segments=48,
            ring_count=24,
        )
        sole = create_rounded_cube(
            f"boot_sole_{suffix}",
            (foot_center.x, foot_center.y + height * 0.035, height * 0.007),
            (height * 0.039, height * 0.052, height * 0.006),
            materials["teal"],
            bevel=height * 0.004,
        )
        toe_cap.parent = boot
        sole.parent = boot
        parts.extend([toe_cap, sole])

    waist_z = height * 0.525
    belt_root = bpy.data.objects.new("belt", None)
    bpy.context.collection.objects.link(belt_root)
    belt_root["semantic_id"] = "belt"
    belt_segments = (
        create_rounded_cube(
            "belt_front",
            (0.0, -height * 0.086, waist_z),
            (height * 0.108, height * 0.006, height * 0.008),
            materials["white"],
            bevel=height * 0.003,
        ),
        create_rounded_cube(
            "belt_back",
            (0.0, height * 0.072, waist_z),
            (height * 0.108, height * 0.006, height * 0.008),
            materials["white"],
            bevel=height * 0.003,
        ),
        create_rounded_cube(
            "belt_side_l",
            (-height * 0.108, -height * 0.014, waist_z),
            (height * 0.006, height * 0.072, height * 0.008),
            materials["white"],
            bevel=height * 0.003,
        ),
        create_rounded_cube(
            "belt_side_r",
            (height * 0.108, -height * 0.014, waist_z),
            (height * 0.006, height * 0.072, height * 0.008),
            materials["white"],
            bevel=height * 0.003,
        ),
    )
    for segment in belt_segments:
        segment.parent = belt_root
    parts.extend([belt_root, *belt_segments])

    buckle = create_rounded_cube(
        "belt_buckle",
        (0.0, -height * 0.096, waist_z),
        (height * 0.020, height * 0.006, height * 0.017),
        materials["white"],
        bevel=height * 0.005,
    )
    parts.append(buckle)

    tail_points = [
        (0.0, height * 0.080, height * 0.54),
        (0.0, height * 0.155, height * 0.53),
        (0.0, height * 0.178, height * 0.44),
        (0.0, height * 0.174, height * 0.31),
        (0.0, height * 0.160, height * 0.22),
    ]
    tail = create_curve_mesh(
        "tail", tail_points, height * 0.022, materials["hair"], radii=[1.0, 0.95, 0.88, 0.78, 0.68]
    )
    parts.append(tail)
    tail_tip = create_curve_mesh(
        "tail_tip",
        [tail_points[-2], tail_points[-1], (0.0, height * 0.145, height * 0.17)],
        height * 0.023,
        materials["hair_shadow"],
        radii=[0.72, 0.62, 0.16],
    )
    tail_tip.parent = tail
    parts.append(tail_tip)
    return parts


def add_stage(materials: dict[str, bpy.types.Material]) -> bpy.types.Object:
    ground = create_rounded_cube("preview_ground", (0.0, 0.0, -0.018), (1.2, 1.2, 0.018), materials["ground"], bevel=0.01)
    ground["preview_only"] = True
    return ground


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.world.color = (0.035, 0.035, 0.04)
    scene.view_settings.view_transform = "AgX"

    world = scene.world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.050, 0.052, 1.0)
    background.inputs["Strength"].default_value = 0.45

    for name, location, energy, size, color in (
        ("key_light", (-3.2, -4.0, 4.8), 900.0, 3.0, (1.0, 0.78, 0.68)),
        ("fill_light", (3.4, -2.5, 3.2), 650.0, 2.5, (0.55, 0.82, 1.0)),
        ("rim_light", (0.0, 3.5, 4.2), 1000.0, 2.2, (0.65, 0.85, 1.0)),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
        light.location = location
        look_at(light, (0.0, 0.0, 0.9))


def render_views(out_dir: Path, height: float) -> dict[str, dict[str, Any]]:
    cameras = {
        "front": ((0.0, -4.2, height * 0.52), (0.0, 0.0, height * 0.52)),
        "profile-right": ((-4.2, 0.0, height * 0.52), (0.0, 0.0, height * 0.52)),
        "rear": ((0.0, 4.2, height * 0.52), (0.0, 0.0, height * 0.52)),
        "three-quarter": ((-3.2, -3.2, height * 0.62), (0.0, 0.0, height * 0.52)),
    }
    output = {}
    for name, (location, target) in cameras.items():
        data = bpy.data.cameras.new(f"camera_{name}")
        data.type = "ORTHO"
        data.ortho_scale = height * 1.22
        camera = bpy.data.objects.new(f"camera_{name}", data)
        bpy.context.collection.objects.link(camera)
        camera.location = location
        look_at(camera, target)
        bpy.context.scene.camera = camera
        path = out_dir / f"blockout-{name}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        output[name] = {"path": str(path), "sha256": sha256(path)}
    return output


def build_phase(out_dir: Path, reference: Path) -> dict[str, Any]:
    if not reference.is_file():
        raise RuntimeError(f"reference image does not exist: {reference}")
    clear_scene()
    materials = {
        "skin": make_material("mat_skin", PALETTE["skin"], roughness=0.78),
        "hair": make_material("mat_hair", PALETTE["hair"], roughness=0.72),
        "hair_shadow": make_material("mat_hair_shadow", PALETTE["hair_shadow"], roughness=0.76),
        "coral": make_material("mat_coral", PALETTE["coral"], roughness=0.68),
        "teal": make_material("mat_teal", PALETTE["teal"], roughness=0.66),
        "cyan": make_material("mat_cyan", PALETTE["cyan"], roughness=0.72),
        "white": make_material("mat_white", PALETTE["white"], roughness=0.58),
        "eye": make_material("mat_eye", PALETTE["eye"], roughness=0.30),
        "dark": make_material("mat_dark", PALETTE["dark"], roughness=0.65),
        "ground": make_material("mat_ground", "#26252b", roughness=0.88),
    }

    body_source, foundation = create_human_foundation()
    body = visible_body_copy(body_source, materials["skin"])
    export_objects = [body]
    export_objects.extend(add_hair_and_face(body, body_source, materials))
    export_objects.extend(add_costume_and_tail(body_source, materials))

    stage = add_stage(materials)
    configure_render()
    full_bounds = mesh_bounds([obj for obj in export_objects if obj.type == "MESH"])
    height = full_bounds["max"][2] - full_bounds["min"][2]

    blend_path = out_dir / "ink-tide-scout-blockout-v1.blend"
    glb_path = out_dir / "ink-tide-scout-blockout-v1.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    renders = render_views(out_dir, height)

    bpy.ops.object.select_all(action="DESELECT")
    selected_ids = set()
    for obj in export_objects:
        if obj.type not in {"MESH", "EMPTY"} or obj.name in selected_ids:
            continue
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(True)
        selected_ids.add(obj.name)
    export_result = bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
    )
    if export_result != {"FINISHED"} or not glb_path.is_file():
        raise RuntimeError(f"GLB export failed: {export_result!r}")

    inventory = inspect_objects([obj for obj in export_objects if obj.type == "MESH"])
    if inventory["nonFiniteVertexCount"] != 0:
        raise RuntimeError("blockout contains non-finite vertices")
    stage.hide_render = False

    return {
        "phase": "build",
        "reference": {"path": str(reference), "sha256": sha256(reference)},
        "foundation": foundation,
        "frontAxis": FRONT_AXIS,
        "palette": PALETTE,
        "blend": {"path": str(blend_path), "sha256": sha256(blend_path)},
        "glb": {"path": str(glb_path), "sha256": sha256(glb_path)},
        "exportSettings": {"export_format": "GLB", "use_selection": True, "export_yup": True},
        "renders": renders,
        "inventory": inventory,
    }


def validate_phase(out_dir: Path, reference: Path) -> dict[str, Any]:
    glb_path = out_dir / "ink-tide-scout-blockout-v1.glb"
    build_report_path = out_dir / "ink-tide-scout-blockout-build.json"
    if not glb_path.is_file() or not build_report_path.is_file():
        raise RuntimeError("build artifacts are missing")
    build_report = json.loads(build_report_path.read_text(encoding="utf-8"))
    expected_hash = build_report["result"]["glb"]["sha256"]
    if sha256(glb_path) != expected_hash:
        raise RuntimeError("GLB hash differs from the build report")

    clear_scene()
    result = bpy.ops.import_scene.gltf(filepath=str(glb_path))
    if result != {"FINISHED"}:
        raise RuntimeError(f"GLB import failed: {result!r}")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    inventory = inspect_objects(meshes)
    names = {obj.name.split(".")[0] for obj in bpy.context.scene.objects}
    missing = sorted(set(SEMANTIC_PARTS) - names)
    bounds = inventory["bounds"]
    dimensions = [bounds["max"][index] - bounds["min"][index] for index in range(3)]
    if missing:
        raise RuntimeError(f"semantic GLB parts are missing: {missing}")
    if inventory["nonFiniteVertexCount"] != 0:
        raise RuntimeError("imported GLB contains non-finite vertices")
    if dimensions[2] <= 1.0 or min(dimensions) <= 0.1:
        raise RuntimeError(f"imported GLB bounds are implausible: {dimensions}")
    if inventory["triangles"] < 30_000:
        raise RuntimeError(f"blockout density is unexpectedly low: {inventory['triangles']} triangles")
    if not any(obj.material_slots for obj in meshes):
        raise RuntimeError("imported GLB has no materials")

    return {
        "phase": "validate",
        "reference": {"path": str(reference), "sha256": sha256(reference)},
        "glb": {"path": str(glb_path), "sha256": expected_hash},
        "missingSemanticParts": missing,
        "dimensions": dimensions,
        "inventory": inventory,
    }


def main() -> int:
    args = parse_args()
    out_dir = args.out_dir.expanduser().resolve()
    reference = args.reference.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / f"ink-tide-scout-blockout-{args.phase}.json"
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "status": "NO-GO",
        "blender": {
            "version": list(bpy.app.version),
            "versionString": bpy.app.version_string,
            "buildHash": bpy.app.build_hash.decode("ascii"),
            "binary": bpy.app.binary_path,
        },
        "runner": {"path": str(Path(__file__).resolve()), "sha256": sha256(Path(__file__).resolve())},
    }
    try:
        if bpy.app.version[:3] != EXPECTED_BLENDER_VERSION:
            raise RuntimeError(
                f"unexpected Blender version: {bpy.app.version[:3]!r}, expected {EXPECTED_BLENDER_VERSION!r}"
            )
        report["result"] = build_phase(out_dir, reference) if args.phase == "build" else validate_phase(out_dir, reference)
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
