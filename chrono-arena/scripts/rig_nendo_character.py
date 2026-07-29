"""Rig and skin the SPAR3D nendoroid hero for glTF/Babylon.js.

Run from the repository root:

    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/rig_nendo_character.py -- hero-nendo

The source GLB is intentionally read-only.  This script writes a skinned GLB
and five review renders under ``assets/production/demonic/rigged`` only.
"""

from __future__ import annotations

import math
import sys
import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import bpy
import bmesh
from mathutils import Matrix, Vector


ROOT_DIR = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT_DIR / "assets" / "production" / "demonic" / "spar3d"
OUTPUT_DIR = ROOT_DIR / "assets" / "production" / "demonic" / "rigged"
TARGET_HEIGHT = 1.8
MAX_GLB_BYTES = int(3.5 * 1024 * 1024)
MAX_INFLUENCES = 4
MAX_FACES = 60_000
FRAGMENT_MAX_VERTICES = 16
WEIGHT_POWER = 4.0
EXPECTED_BONE_NAMES = (
    "Root", "Hips", "Spine", "Chest", "Neck", "Head",
    "UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R",
    "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R",
)


@dataclass(frozen=True)
class Bounds:
    minimum: Vector
    maximum: Vector

    @property
    def size(self) -> Vector:
        return self.maximum - self.minimum


@dataclass(frozen=True)
class BoneSpec:
    name: str
    head: Vector
    tail: Vector
    parent: str | None


@dataclass(frozen=True)
class BodyLayout:
    """Measured normalized boundaries and derived centres for a squat body."""

    leg_top: float
    knee: float
    head_start: float
    torso_half_width: float
    hips: Vector
    spine: Vector
    chest: Vector
    neck: Vector
    head_tip: Vector
    shoulder_l: Vector
    elbow_l: Vector
    hand_l: Vector
    shoulder_r: Vector
    elbow_r: Vector
    hand_r: Vector
    hip_l: Vector
    knee_l: Vector
    ankle_l: Vector
    toe_l: Vector
    hip_r: Vector
    knee_r: Vector
    ankle_r: Vector
    toe_r: Vector


def log(message: str) -> None:
    print(f"[NENDO_RIG] {message}")


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def activate_only(objects: Iterable[bpy.types.Object], active: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active


def world_vertices(mesh: bpy.types.Object, *, evaluated: bool = False) -> list[Vector]:
    source = mesh
    if evaluated:
        source = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [source.matrix_world @ vertex.co for vertex in source.data.vertices]


def bounds_for_mesh(mesh: bpy.types.Object, *, evaluated: bool = False) -> Bounds:
    vertices = world_vertices(mesh, evaluated=evaluated)
    if not vertices:
        raise RuntimeError("Imported character has no mesh vertices.")
    return Bounds(
        Vector(tuple(min(vertex[axis] for vertex in vertices) for axis in range(3))),
        Vector(tuple(max(vertex[axis] for vertex in vertices) for axis in range(3))),
    )


def triangle_count(mesh: bpy.types.Object) -> int:
    """glTFの面数と一致する三角面数を返す（四角面は2として数える）。"""
    return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.data.polygons)


def percentile(values: Iterable[float], ratio: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise RuntimeError("Cannot calculate a percentile of no values.")
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * ratio)))
    return ordered[index]


def centroid(vertices: Iterable[Vector], fallback: Vector) -> Vector:
    points = list(vertices)
    if not points:
        return fallback.copy()
    return sum(points, Vector()) / len(points)


def find_valley(vertices: list[Vector], low: float, high: float, lower: float, upper: float) -> float:
    """Find the least-populated Z band inside an anatomy-informed search range.

    The ranges merely constrain an expected body region.  The selected value
    comes from this mesh's 80-bin vertex distribution, rather than a fixed
    nendoroid ratio.
    """
    bins = 80
    span = high - low
    counts = [0] * bins
    for vertex in vertices:
        bucket = min(bins - 1, max(0, int((vertex.z - low) / span * bins)))
        counts[bucket] += 1
    start = max(1, min(bins - 2, int(lower * bins)))
    end = max(start, min(bins - 2, int(upper * bins)))
    # Isolated low bins are noisy.  A three-bin mean tracks actual narrow
    # neck/hip regions more reliably on generated scan topology.
    candidate = min(range(start, end + 1), key=lambda index: sum(counts[index - 1 : index + 2]))
    return low + (candidate + 0.5) / bins * span


def remove_staging_and_join() -> bpy.types.Object:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("GLB import did not create a mesh.")
    detailed = [obj for obj in meshes if len(obj.data.polygons) > 12]
    if not detailed:
        raise RuntimeError("GLB only contained staging geometry, not a character.")
    discarded = [obj.name for obj in meshes if obj not in detailed]
    for obj in meshes:
        if obj not in detailed:
            bpy.data.objects.remove(obj, do_unlink=True)
    for obj in detailed:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        activate_only([obj], obj)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    activate_only(detailed, detailed[0])
    if len(detailed) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    mesh.name = "HeroNendo"
    log(f"IMPORT mesh={mesh.name} vertices={len(mesh.data.vertices)} faces={len(mesh.data.polygons)} discarded={discarded or 'none'}")
    return mesh


def normalize_mesh(mesh: bpy.types.Object) -> None:
    """Put the longest human axis on +Z, then make feet-centre the origin."""
    initial = bounds_for_mesh(mesh)
    vertical_axis = max(range(3), key=lambda axis: initial.size[axis])
    mesh.rotation_mode = "XYZ"
    if vertical_axis == 0:
        mesh.rotation_euler[1] = -math.pi / 2.0
        axis_note = "X_TO_Z"
    elif vertical_axis == 1:
        mesh.rotation_euler[0] = math.pi / 2.0
        axis_note = "Y_TO_Z"
    else:
        axis_note = "Z_ALREADY_UPRIGHT"
    activate_only([mesh], mesh)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    upright = bounds_for_mesh(mesh)
    if upright.size.z <= 0.0:
        raise RuntimeError("Character height is invalid.")
    mesh.scale *= TARGET_HEIGHT / upright.size.z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    scaled = bounds_for_mesh(mesh)
    mesh.location = (
        -(scaled.minimum.x + scaled.maximum.x) * 0.5,
        -(scaled.minimum.y + scaled.maximum.y) * 0.5,
        -scaled.minimum.z,
    )
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    result = bounds_for_mesh(mesh)
    if not math.isclose(result.size.z, TARGET_HEIGHT, abs_tol=0.001):
        raise RuntimeError(f"Normalisation height mismatch: {result.size.z:.6f}m")
    log(
        "NORMALIZE "
        f"orientation={axis_note} bbox_min={tuple(round(v, 4) for v in result.minimum)} "
        f"bbox_max={tuple(round(v, 4) for v in result.maximum)} height={result.size.z:.4f}m"
    )


def measured_layout(mesh: bpy.types.Object) -> BodyLayout:
    vertices = world_vertices(mesh)
    bounds = bounds_for_mesh(mesh)
    low, high = bounds.minimum.z, bounds.maximum.z
    height = high - low

    # 正面三面図（turnarounds/hero.png）の足元を0、全高を1とした目安。
    # ねんどろいどは頭が約4割を占めるため、頂点密度から人体比を推測せず、
    # 骨位置を一定比率で安定させる。手首は実測した腕長の75%へ置く。
    ankle_z = low + height * 0.06
    knee_z = low + height * 0.16
    hip_z = low + height * 0.28
    spine_z = low + height * 0.34
    chest_z = low + height * 0.46
    shoulder_z = low + height * 0.54
    neck_z = low + height * 0.58
    head_start = low + height * 0.60
    head_tip_z = min(high, low + height * 0.98)

    torso_candidates = [vertex for vertex in vertices if hip_z <= vertex.z <= neck_z]
    if len(torso_candidates) < 100:
        torso_candidates = vertices
    # 55 percentile keeps the central torso and rejects the A-pose arm tips.
    torso_half_width = max(height * 0.075, percentile((abs(vertex.x) for vertex in torso_candidates), 0.55))
    body_y = percentile((vertex.y for vertex in torso_candidates), 0.50)

    arm_floor = low + height * 0.25
    arm_ceiling = min(high - height * 0.04, head_start + height * 0.02)
    arm_candidates = [
        vertex
        for vertex in vertices
        if arm_floor <= vertex.z <= arm_ceiling and abs(vertex.x) > torso_half_width * 0.72
    ]
    if len(arm_candidates) < 100:
        arm_candidates = [vertex for vertex in vertices if abs(vertex.x) > torso_half_width]

    def arm_points(sign: float) -> tuple[Vector, Vector, Vector]:
        side = [vertex for vertex in arm_candidates if vertex.x * sign > 0.0]
        shoulder = Vector((sign * torso_half_width * 0.92, body_y, shoulder_z))
        if not side:
            direction = Vector((sign * height * 0.24, 0.0, -height * 0.10))
            hand = shoulder + direction
            return shoulder, shoulder.lerp(hand, 0.50), hand
        # A distal score follows both the outward extent and a hanging/angled
        # hand, so it works for the requested A pose and for a slightly low arm.
        score = lambda vertex: abs(vertex.x) + 0.35 * (shoulder_z - vertex.z)
        cutoff = percentile((score(vertex) for vertex in side), 0.84)
        hand = centroid((vertex for vertex in side if score(vertex) >= cutoff), shoulder)
        direction = hand - shoulder
        if direction.length < height * 0.08:
            direction = Vector((sign * height * 0.23, 0.0, -height * 0.06))
        hand = shoulder + direction
        # 腕全長の中点を肘にする。ねんどろいどは短い腕を更に分割しない。
        elbow = shoulder.lerp(hand, 0.50)
        return shoulder, elbow, hand

    shoulder_l, elbow_l, hand_l = arm_points(1.0)
    shoulder_r, elbow_r, hand_r = arm_points(-1.0)

    leg_candidates = [vertex for vertex in vertices if vertex.z <= hip_z + height * 0.03]

    def leg_points(sign: float) -> tuple[Vector, Vector, Vector, Vector]:
        side = [vertex for vertex in leg_candidates if vertex.x * sign >= 0.0]
        x = percentile((abs(vertex.x) for vertex in side), 0.50) if side else height * 0.10
        hip = Vector((sign * max(x, torso_half_width * 0.48), body_y, hip_z))
        low_foot = [vertex for vertex in side if vertex.z <= percentile((point.z for point in side), 0.22)] if side else []
        foot_centre = centroid(low_foot, Vector((hip.x, body_y - height * 0.05, low + height * 0.06)))
        ankle = Vector((foot_centre.x, foot_centre.y, ankle_z))
        knee_point = hip.lerp(ankle, 0.52)
        knee_point.z = knee_z
        # The tenth y percentile is the toe-side in the imported -Y-forward
        # character convention.  It still gives a short stable foot when a
        # future source has nearly symmetric boots.
        toe_y = percentile((vertex.y for vertex in low_foot), 0.10) if low_foot else ankle.y - height * 0.08
        toe = Vector((ankle.x, min(toe_y, ankle.y - height * 0.025), max(low, foot_centre.z)))
        return hip, knee_point, ankle, toe

    hip_l, knee_l, ankle_l, toe_l = leg_points(1.0)
    hip_r, knee_r, ankle_r, toe_r = leg_points(-1.0)

    log(
        "LAYOUT_SOURCE front_turnaround_standard_ratio "
        "ratios=ankle:0.06,knee:0.16,hip:0.28,spine:0.34,chest:0.46,shoulder:0.54,neck:0.58,head_center:0.78 "
        f"z=ankle:{ankle_z:.4f},knee:{knee_z:.4f},hip:{hip_z:.4f},chest:{chest_z:.4f},shoulder:{shoulder_z:.4f},neck:{neck_z:.4f} "
        f"torso_half_width={torso_half_width:.4f} arm_candidates={len(arm_candidates)}"
    )
    log(
        "PART_CENTRES "
        f"shoulder_L={tuple(round(v, 3) for v in shoulder_l)} hand_L={tuple(round(v, 3) for v in hand_l)} "
        f"hip_L={tuple(round(v, 3) for v in hip_l)} toe_L={tuple(round(v, 3) for v in toe_l)}"
    )
    return BodyLayout(
        hip_z, knee_z, head_start, torso_half_width,
        Vector((0.0, body_y, hip_z)), Vector((0.0, body_y, spine_z)), Vector((0.0, body_y, chest_z)),
        Vector((0.0, body_y, neck_z)), Vector((0.0, body_y, head_tip_z)),
        shoulder_l, elbow_l, hand_l, shoulder_r, elbow_r, hand_r,
        hip_l, knee_l, ankle_l, toe_l, hip_r, knee_r, ankle_r, toe_r,
    )


def nonzero_tail(head: Vector, tail: Vector) -> Vector:
    return tail if (tail - head).length > 0.002 else head + Vector((0.0, 0.0, 0.03))


def bone_specs(layout: BodyLayout) -> list[BoneSpec]:
    # 肩当ては上腕、拳は前腕に含める。各骨の担当領域を十分に広く保つ。
    specs = [
        BoneSpec("Root", Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, max(0.06, layout.hips.z * 0.35))), None),
        BoneSpec("Hips", layout.hips, layout.spine, "Root"),
        BoneSpec("Spine", layout.spine, layout.chest, "Hips"),
        BoneSpec("Chest", layout.chest, layout.neck, "Spine"),
        BoneSpec("Neck", layout.neck, layout.head_tip.lerp(layout.neck, 0.72), "Chest"),
        BoneSpec("Head", layout.head_tip.lerp(layout.neck, 0.72), layout.head_tip, "Neck"),
        BoneSpec("UpperArm.L", layout.shoulder_l, layout.elbow_l, "Chest"),
        BoneSpec("UpperArm.R", layout.shoulder_r, layout.elbow_r, "Chest"),
        BoneSpec("LowerArm.L", layout.elbow_l, layout.hand_l, "UpperArm.L"),
        BoneSpec("LowerArm.R", layout.elbow_r, layout.hand_r, "UpperArm.R"),
        BoneSpec("UpperLeg.L", layout.hip_l, layout.knee_l, "Hips"),
        BoneSpec("UpperLeg.R", layout.hip_r, layout.knee_r, "Hips"),
        BoneSpec("LowerLeg.L", layout.knee_l, layout.ankle_l, "UpperLeg.L"),
        BoneSpec("LowerLeg.R", layout.knee_r, layout.ankle_r, "UpperLeg.R"),
        BoneSpec("Foot.L", layout.ankle_l, nonzero_tail(layout.ankle_l, layout.toe_l), "LowerLeg.L"),
        BoneSpec("Foot.R", layout.ankle_r, nonzero_tail(layout.ankle_r, layout.toe_r), "LowerLeg.R"),
    ]
    names = tuple(spec.name for spec in specs)
    if names != EXPECTED_BONE_NAMES:
        raise RuntimeError(f"Unexpected nendoroid bone contract: {names}")
    return specs


def create_armature(specs: list[BoneSpec]) -> bpy.types.Object:
    armature_data = bpy.data.armatures.new("HeroNendoRig")
    armature_data.pose_position = "POSE"
    armature = bpy.data.objects.new("HeroNendoRig", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    activate_only([armature], armature)
    bpy.ops.object.mode_set(mode="EDIT")
    created: dict[str, bpy.types.EditBone] = {}
    for spec in specs:
        bone = armature_data.edit_bones.new(spec.name)
        bone.head = spec.head
        bone.tail = nonzero_tail(spec.head, spec.tail)
        bone.roll = 0.0
        if spec.parent:
            bone.parent = created[spec.parent]
        created[spec.name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    names = [spec.name for spec in specs]
    log(f"BONES count={len(names)} pose_position={armature_data.pose_position} names={','.join(names)}")
    return armature


def bind_armature_directly(mesh: bpy.types.Object, armature: bpy.types.Object) -> None:
    """Bone Heatを使わず、後続の直接計算グループだけでスキニングする。"""
    mesh.parent = armature
    modifier = mesh.modifiers.new("HeroNendoRigDeform", "ARMATURE")
    modifier.object = armature
    modifier.use_vertex_groups = True
    log("ARMATURE_BIND method=DIRECT_VERTEX_GROUPS bone_heat=DISABLED")


def point_segment_distance(point: Vector, head: Vector, tail: Vector) -> float:
    axis = tail - head
    length_squared = axis.length_squared
    if length_squared <= 1e-12:
        return (point - head).length
    factor = max(0.0, min(1.0, (point - head).dot(axis) / length_squared))
    return (point - (head + axis * factor)).length


def topology_components(mesh: bpy.types.Object) -> tuple[list[int], list[list[int]]]:
    """Return per-vertex component ids and the connected vertex lists.

    SPAR3D stores disconnected armour and hood surfaces in one mesh.  Position
    alone can mistake the lower wide edge of the hood for a raised arm, so the
    largest continuous body surfaces are kept out of the arm-only classifier.
    """
    neighbours = [set() for _ in mesh.data.vertices]
    for polygon in mesh.data.polygons:
        indices = list(polygon.vertices)
        for index, first in enumerate(indices):
            for second in indices[index + 1 :]:
                neighbours[first].add(second)
                neighbours[second].add(first)
    membership = [-1] * len(mesh.data.vertices)
    sizes: list[int] = []
    components: list[list[int]] = []
    component_id = 0
    for start in range(len(neighbours)):
        if membership[start] >= 0:
            continue
        stack = [start]
        membership[start] = component_id
        component: list[int] = []
        while stack:
            index = stack.pop()
            component.append(index)
            for neighbour in neighbours[index]:
                if membership[neighbour] < 0:
                    membership[neighbour] = component_id
                    stack.append(neighbour)
        sizes.append(len(component))
        components.append(component)
        component_id += 1
    log(f"TOPOLOGY components={len(sizes)} largest={','.join(str(size) for size in sorted(sizes, reverse=True)[:4])}")
    return membership, components


def remove_floating_fragments(mesh: bpy.types.Object) -> None:
    """Drop only disconnected microscopic triangles that become pose debris.

    The source's principal surfaces are hundreds to thousands of vertices.
    Components of at most ``FRAGMENT_MAX_VERTICES`` vertices are isolated scan specks, not the
    readable armour silhouette; leaving them makes black spikes appear only
    once the arms or knees separate from the body.
    """
    _, components = topology_components(mesh)
    discard = {
        index
        for component in components
        if len(component) <= FRAGMENT_MAX_VERTICES
        for index in component
    }
    if not discard:
        return
    mesh_data = mesh.data
    edit_mesh = bmesh.new()
    edit_mesh.from_mesh(mesh_data)
    vertices = [vertex for vertex in edit_mesh.verts if vertex.index in discard]
    bmesh.ops.delete(edit_mesh, geom=vertices, context="VERTS")
    edit_mesh.to_mesh(mesh_data)
    edit_mesh.free()
    mesh_data.update()
    log(f"CLEANUP removed_floating_vertices={len(discard)} remaining_vertices={len(mesh_data.vertices)}")


def log_source_components(mesh: bpy.types.Object) -> None:
    """リメッシュ前の大きな表面の位置を出し、意味ラベル設計の根拠にする。"""
    _, components = topology_components(mesh)
    rows = []
    for component in sorted(components, key=len, reverse=True)[:12]:
        points = [mesh.matrix_world @ mesh.data.vertices[index].co for index in component]
        centre = centroid(points, Vector())
        minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        rows.append(
            f"n:{len(component)},c:({centre.x:.3f},{centre.z:.3f}),"
            f"x:{minimum.x:.3f}..{maximum.x:.3f},z:{minimum.z:.3f}..{maximum.z:.3f}"
        )
    log("SOURCE_COMPONENTS top12=" + " | ".join(rows))


def keep_largest_component(mesh: bpy.types.Object) -> None:
    """最後の保険として最大連結成分だけを残す。通常は呼ばれない。"""
    _, components = topology_components(mesh)
    if len(components) <= 1:
        return
    largest = set(max(components, key=len))
    edit_mesh = bmesh.new()
    edit_mesh.from_mesh(mesh.data)
    discard = [vertex for vertex in edit_mesh.verts if vertex.index not in largest]
    bmesh.ops.delete(edit_mesh, geom=discard, context="VERTS")
    edit_mesh.to_mesh(mesh.data)
    edit_mesh.free()
    mesh.data.update()
    log(f"REMESH_FALLBACK kept_largest_component vertices={len(mesh.data.vertices)} faces={len(mesh.data.polygons)}")


def remesh_for_deformation(mesh: bpy.types.Object) -> None:
    """断片化したSPAR3D表面を、細部を保った単一の連結体へ融合する。"""
    height = bounds_for_mesh(mesh).size.z
    before_components = len(topology_components(mesh)[1])
    before_faces = len(mesh.data.polygons)
    # 0.4〜0.6%を細部優先で試す。単一連結体になった最小voxelを採用し、
    # 角・肩当て・胸コアの段差を、60,000面の予算まで残す。
    candidates = (height * 0.004, height * 0.005, height * 0.006)
    original_data = mesh.data.copy()
    chosen: tuple[float, int, int] | None = None

    for attempt, voxel_size in enumerate(candidates, start=1):
        mesh.data = original_data.copy()
        modifier = mesh.modifiers.new(f"NendoVoxelRemesh{attempt}", "REMESH")
        modifier.mode = "VOXEL"
        modifier.voxel_size = voxel_size
        modifier.use_smooth_shade = True
        activate_only([mesh], mesh)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        components = topology_components(mesh)[1]
        component_count = len(components)
        significant_components = sum(len(component) > FRAGMENT_MAX_VERTICES for component in components)
        faces = len(mesh.data.polygons)
        log(
            "REMESH_ATTEMPT "
            f"attempt={attempt} voxel_size={voxel_size:.5f} ratio={voxel_size / height:.4%} "
            f"components={component_count} significant_components={significant_components} "
            f"polygons={faces} triangles={triangle_count(mesh)}"
        )
        # 指・角・肩当てを残すため、連結を保てた候補のうち最小voxelを採用する。
        if significant_components == 1 and chosen is None:
            chosen = (voxel_size, component_count, faces)

    if chosen is None:
        # 3回でも割れる場合だけ、最も粗い試行の最大成分へ退避する。
        keep_largest_component(mesh)
    else:
        selected_size = chosen[0]
        # 最終候補が選択済みデータでない可能性を排除して、決定値を再適用する。
        mesh.data = original_data.copy()
        modifier = mesh.modifiers.new("NendoVoxelRemeshSelected", "REMESH")
        modifier.mode = "VOXEL"
        modifier.voxel_size = selected_size
        modifier.use_smooth_shade = True
        activate_only([mesh], mesh)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        # 0.4%試行の8頂点程度の微小片だけを落とし、主表面は高解像度で維持する。
        remove_floating_fragments(mesh)

    after_components = len(topology_components(mesh)[1])
    after_faces = len(mesh.data.polygons)
    log(
        "REMESH_RESULT "
        f"components_before={before_components} components_after={after_components} "
        f"polygons_before={before_faces} polygons_after={after_faces} triangles_after={triangle_count(mesh)}"
    )
    if after_components != 1:
        raise RuntimeError(f"Voxel Remesh did not produce one connected component: {after_components}")


def decimate_if_needed(mesh: bpy.types.Object) -> None:
    """glTF予算のため、UV展開より前に必要最小限だけ面数を落とす。"""
    before = triangle_count(mesh)
    if before <= MAX_FACES:
        log(f"DECIMATE skipped triangles={before} limit={MAX_FACES}")
        return
    # Remeshは四角面を返すため、先に三角化してGLB検査と同じ単位にそろえる。
    activate_only([mesh], mesh)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
    bpy.ops.object.mode_set(mode="OBJECT")
    triangulated = triangle_count(mesh)
    modifier = mesh.modifiers.new("NendoFaceBudget", "DECIMATE")
    modifier.ratio = min(1.0, (MAX_FACES - 200) / triangulated)
    activate_only([mesh], mesh)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    after = triangle_count(mesh)
    components = len(topology_components(mesh)[1])
    log(
        f"DECIMATE triangles_before={before} triangles_after_triangulate={triangulated} "
        f"triangles_after={after} limit={MAX_FACES} components_after={components}"
    )
    if after > MAX_FACES or components != 1:
        raise RuntimeError(f"Decimation budget/continuity failure: triangles={after} components={components}")


def smart_uv_project(mesh: bpy.types.Object) -> None:
    """リメッシュで失ったUVを、glTF用の単一UVセットとして張り直す。"""
    activate_only([mesh], mesh)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # angle_limit は66度、island_margin は0.02。密な島の色漏れを防ぐ。
    result = bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv_layer = mesh.data.uv_layers.active
    if "FINISHED" not in result or uv_layer is None or not uv_layer.data:
        raise RuntimeError(f"Smart UV Project failed: result={result}")
    log(f"UV_SMART_PROJECT layer={uv_layer.name} loops={len(uv_layer.data)} angle_limit_degrees=66 island_margin=0.02")


def turnaround_projector_module():
    """既存の三面図分割・法線投影ベイク実装をそのまま再利用する。"""
    module_name = "nendo_turnaround_projector"
    if module_name in sys.modules:
        return sys.modules[module_name]
    source = ROOT_DIR / "scripts" / "project_turnaround_texture.py"
    spec = importlib.util.spec_from_file_location(module_name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load turnaround projector: {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def textured_material(basecolor: bpy.types.Image) -> bpy.types.Material:
    """ベイク済みbaseColorだけを使う、軽量なゲーム用マテリアル。"""
    material = bpy.data.materials.new("HeroNendoTurnaroundMaterial")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Metallic"].default_value = 0.32
    bsdf.inputs["Roughness"].default_value = 0.42
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = basecolor
    texture.interpolation = "Linear"
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    # シアン回路の発光感をレンダーでも失わないよう、色を弱く自己発光させる。
    if "Emission Color" in bsdf.inputs and "Emission Strength" in bsdf.inputs:
        links.new(texture.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.12
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return material


def bake_turnaround_texture(mesh: bpy.types.Object, name: str, source_base: bpy.types.Image) -> Path:
    """新UVへ三面図のfront/side/backを法線方向でブレンドして焼く。"""
    if mesh.data.uv_layers.active is None:
        raise RuntimeError("Cannot bake turnaround texture without a UV map.")
    projector = turnaround_projector_module()
    turnaround_image, _, _, views, _, _ = projector.load_turnaround(name)
    baked, direction_ratio, _ = projector.bake_turnaround_basecolor_gpu(mesh, turnaround_image, views, source_base)
    output_path = OUTPUT_DIR / f"{name}-rigged-basecolor.png"
    projector.save_png(baked, output_path)
    # 外部PNGも残しつつGLBには同じ画像を埋め込む。
    baked.pack()
    material = textured_material(baked)
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    for polygon in mesh.data.polygons:
        polygon.material_index = 0
    log(
        "TEXTURE_BAKE "
        f"method=turnaround_normal_projection image={output_path} bytes={output_path.stat().st_size} "
        + " ".join(f"{key}={value:.4f}" for key, value in direction_ratio.items())
    )
    return output_path


def geometric_distance_weights(mesh: bpy.types.Object, specs: list[BoneSpec], layout: BodyLayout) -> None:
    """線分距離で計算した、ねんどろいど向けの直接スキニングを設定する。"""
    for group in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(group)
    groups = {spec.name: mesh.vertex_groups.new(name=spec.name) for spec in specs}
    geometry = {spec.name: (spec.head, spec.tail) for spec in specs}
    bounds = bounds_for_mesh(mesh)
    height = bounds.size.z
    epsilon = height * 0.012
    # 短い腕の拳下端は全高0.18付近まで届く。ここを切ると手の外殻が胴へ落ちる。
    arm_floor = bounds.minimum.z + height * 0.18
    leg_ceiling = layout.leg_top + height * 0.04
    # 三面図の頭中心は全高0.78。フード下端・肩当て（約0.70）は頭に固定せず、
    # 頭中心の少し下である0.72からだけHead=1へ固定する。
    head_lock_z = bounds.minimum.z + height * 0.72
    torso_guard_half_width = layout.torso_half_width * 0.85
    torso_guard_low = layout.chest.z - height * 0.12
    torso_guard_high = layout.chest.z + height * 0.11
    # 胸下（z=0.54..0.68）では、短い腕・脚の鎖が胴の輪郭と接近する。
    # この細い帯を胴に固定しないと、隣接面が LowerArm/Hips/UpperLeg に割れて
    # ポーズ時に扇状へ開く。幅は実測胴幅の 95% に限り、腕本体は残す。
    waist_guard_low = layout.hips.z + height * 0.02
    waist_guard_high = layout.chest.z - height * 0.08
    waist_guard_half_width = layout.torso_half_width * 0.95
    # フード下端は上腕の根元と近接するが、本来は胸／首に固定された外装である。
    # ここが上腕へ混ざると肘ポーズで縦筋状に引かれるため、胴中央だけを静的骨へ渡す。
    hood_guard_low = layout.neck.z
    hood_guard_high = head_lock_z
    hood_guard_half_width = layout.torso_half_width * 1.25
    hood = ["Chest", "Neck", "Head"]
    body = ["Hips", "Spine", "Chest", "Neck"]
    # 肩当てから拳までを二骨に限定し、短い腕での微小ウェイト混在を防ぐ。
    arm_l = ["UpperArm.L", "LowerArm.L"]
    arm_r = ["UpperArm.R", "LowerArm.R"]
    leg_l = ["UpperLeg.L", "LowerLeg.L", "Foot.L"]
    leg_r = ["UpperLeg.R", "LowerLeg.R", "Foot.R"]
    counts = {spec.name: 0 for spec in specs}
    regions = {"head": 0, "torso": 0, "arm.L": 0, "arm.R": 0, "leg.L": 0, "leg.R": 0}
    peak_sums = {name: 0.0 for name in regions}
    peak_mins = {name: 1.0 for name in regions}
    head_outer_vertices = 0
    vertex_regions: list[str] = [""] * len(mesh.data.vertices)
    min_sum, max_sum, max_used = 1.0, 0.0, 0
    head_indices: set[int] = set()

    def distance_weights(point: Vector, names: list[str]) -> dict[str, float]:
        # w = 1 / (d + eps)^p。近接骨を強くしつつ、関節周辺だけ連続的に混ぜる。
        raw = [
            (name, 1.0 / (point_segment_distance(point, *geometry[name]) + epsilon) ** WEIGHT_POWER)
            for name in names
        ]
        raw.sort(key=lambda item: item[1], reverse=True)
        retained = raw[:MAX_INFLUENCES]
        total = sum(weight for _, weight in retained)
        if total <= 0.0 or not math.isfinite(total):
            raise RuntimeError("Geometric distance weighting produced an invalid total.")
        return {name: weight / total for name, weight in retained}

    for vertex in mesh.data.vertices:
        point = mesh.matrix_world @ vertex.co
        arm_names = arm_l if point.x >= 0.0 else arm_r
        leg_names = leg_l if point.x >= 0.0 else leg_r
        arm_distance = min(point_segment_distance(point, *geometry[name]) for name in arm_names)
        leg_distance = min(point_segment_distance(point, *geometry[name]) for name in leg_names)
        body_distance = min(point_segment_distance(point, *geometry[name]) for name in body)
        if point.z >= head_lock_z:
            # 頭中心より上は完全固定する。肩当ての高さはこの境界より低い。
            weights, region = {"Head": 1.0}, "head"
            head_indices.add(vertex.index)
            if abs(point.x) >= layout.torso_half_width * 0.80:
                head_outer_vertices += 1
        elif hood_guard_low <= point.z < hood_guard_high and abs(point.x) <= hood_guard_half_width:
            weights, region = distance_weights(point, hood), "torso"
        elif (
            torso_guard_low <= point.z <= torso_guard_high
            and abs(point.x) <= torso_guard_half_width
        ) or (
            waist_guard_low <= point.z < waist_guard_high
            and abs(point.x) <= waist_guard_half_width
        ):
            # 胸コアだけを保護する。腕の内側表面まで胴へ固定しない。
            weights, region = distance_weights(point, body), "torso"
        elif point.z <= leg_ceiling and leg_distance <= body_distance and leg_distance < arm_distance:
            # 短い腕の手首は脚上端と同じ高さへ来る。胴だけでなく同側の腕鎖より
            # 近い時だけ脚へ渡し、手を脚ウェイトへ誤分類しない。
            # 脚の付け根では胴骨も候補に残す。鎖を完全に切り替えると連結面が裂ける。
            weights, region = distance_weights(point, [*body, *leg_names]), "leg.L" if point.x >= 0.0 else "leg.R"
        elif arm_floor <= point.z < head_lock_z and arm_distance < body_distance:
            # 固定半径を使わず、同側の腕鎖と胴鎖を同じ距離式で競合させる。
            # 外側の手では腕が圧倒的に近く、肩根だけが胴へ滑らかにつながる。
            weights, region = distance_weights(point, [*body, *arm_names]), "arm.L" if point.x >= 0.0 else "arm.R"
        else:
            weights, region = distance_weights(point, body), "torso"

        if len(weights) > MAX_INFLUENCES:
            raise RuntimeError(f"Vertex {vertex.index} has more than {MAX_INFLUENCES} weights.")
        total = sum(weights.values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise RuntimeError(f"Vertex {vertex.index} has non-normalized weights: {total}")
        for bone_name, weight in weights.items():
            groups[bone_name].add([vertex.index], weight, "REPLACE")
            counts[bone_name] += 1
        regions[region] += 1
        vertex_regions[vertex.index] = region
        peak = max(weights.values())
        peak_sums[region] += peak
        peak_mins[region] = min(peak_mins[region], peak)
        min_sum = min(min_sum, total)
        max_sum = max(max_sum, total)
        max_used = max(max_used, len(weights))

    # リメッシュ後も一本の連結面なので、線分距離で得た初期値を隣接面へ二回だけ
    # 平滑化する。これはBone Heatではなく、胴と腕の境界を連続ウェイトにする後処理。
    # 頭は大きく胴へ近いため、平滑化後に下記で必ずHead=1へ戻す。
    bpy.context.view_layer.objects.active = mesh
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_smooth(
        group_select_mode="ALL",
        factor=0.45,
        repeat=2,
        expand=0.0,
    )
    bpy.ops.object.mode_set(mode="OBJECT")

    group_by_index = {group.index: group for group in groups.values()}
    counts = {spec.name: 0 for spec in specs}
    peak_sums = {name: 0.0 for name in regions}
    peak_mins = {name: 1.0 for name in regions}
    min_sum, max_sum, max_used = 1.0, 0.0, 0
    final_weights_by_vertex: list[dict[str, float]] = []
    for vertex in mesh.data.vertices:
        if vertex.index in head_indices:
            final_weights = {"Head": 1.0}
        else:
            # 平滑化で発生した微小な5本目以降を捨て、glTFの4骨上限へ再正規化する。
            blended = [
                (group_by_index[membership.group].name, membership.weight)
                for membership in vertex.groups
                if membership.group in group_by_index and membership.weight > 1e-8
            ]
            blended.sort(key=lambda item: item[1], reverse=True)
            retained = blended[:MAX_INFLUENCES]
            total = sum(weight for _, weight in retained)
            if total <= 0.0 or not math.isfinite(total):
                raise RuntimeError(f"Smoothed skinning produced an invalid total at vertex {vertex.index}.")
            final_weights = {name: weight / total for name, weight in retained}

        final_weights_by_vertex.append(final_weights)

        total = sum(final_weights.values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            raise RuntimeError(f"Vertex {vertex.index} has non-normalized smoothed weights: {total}")
        region = vertex_regions[vertex.index]
        peak = max(final_weights.values())
        peak_sums[region] += peak
        peak_mins[region] = min(peak_mins[region], peak)
        min_sum = min(min_sum, total)
        max_sum = max(max_sum, total)
        max_used = max(max_used, len(final_weights))

    # グループ内のゼロ重みを個別削除すると Blender が隠れた影響を保持することがある。
    # いったん全グループを再作成し、確定済みの上位4本だけを書き戻してから検査する。
    for group in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(group)
    groups = {spec.name: mesh.vertex_groups.new(name=spec.name) for spec in specs}
    for index, final_weights in enumerate(final_weights_by_vertex):
        for bone_name, weight in final_weights.items():
            groups[bone_name].add([index], weight, "REPLACE")
            counts[bone_name] += 1

    actual_max_influences = 0
    for vertex in mesh.data.vertices:
        actual = [membership.weight for membership in vertex.groups if membership.weight > 1e-8]
        actual_max_influences = max(actual_max_influences, len(actual))
        if len(actual) > MAX_INFLUENCES:
            raise RuntimeError(
                f"Vertex {vertex.index} retained {len(actual)} influences after top-{MAX_INFLUENCES} pruning."
            )
        if not math.isclose(sum(actual), 1.0, abs_tol=1e-6):
            raise RuntimeError(f"Vertex {vertex.index} has invalid final weight sum: {sum(actual)}")

    required = (*arm_l, *arm_r, *leg_l, *leg_r, "Head", "Chest")
    missing = [name for name in required if counts[name] == 0]
    if missing:
        raise RuntimeError(f"Geometric skinning left required bone groups empty: {missing}")
    log(
        "WEIGHTS source=GEOMETRIC_DISTANCE "
        f"power={WEIGHT_POWER:.1f} epsilon={epsilon:.5f} max_influences={max_used} "
        f"normalized_sum_range={min_sum:.6f}..{max_sum:.6f} limit={MAX_INFLUENCES} "
        f"smoothing=adjacent_groups:2x0.45 actual_max_influences={actual_max_influences}"
    )
    log("WEIGHT_REGIONS " + " ".join(f"{name}={count}" for name, count in regions.items()))
    log(f"HEAD_LOCK outer_vertices={head_outer_vertices} head_lock_z={head_lock_z:.4f}")
    log(
        "WEIGHT_PEAKS "
        + " ".join(
            f"{name}=min:{peak_mins[name]:.3f},mean:{peak_sums[name] / count:.3f}"
            for name, count in regions.items()
            if count
        )
    )
    probes = [
        Vector((sign * 0.62, layout.shoulder_l.y, z))
        for sign in (-1.0, 1.0)
        for z in (0.42, 0.58, 0.74)
    ]
    probe_rows = []
    for probe in probes:
        index = min(
            range(len(mesh.data.vertices)),
            key=lambda candidate: (mesh.matrix_world @ mesh.data.vertices[candidate].co - probe).length_squared,
        )
        point = mesh.matrix_world @ mesh.data.vertices[index].co
        probe_arm = arm_l if point.x >= 0.0 else arm_r
        probe_body = min(point_segment_distance(point, *geometry[name]) for name in body)
        probe_arm_distance = min(point_segment_distance(point, *geometry[name]) for name in probe_arm)
        probe_rows.append(
            f"p({point.x:.2f},{point.y:.2f},{point.z:.2f})={vertex_regions[index]}"
            f",a:{probe_arm_distance:.2f},b:{probe_body:.2f}"
        )
    log("ARM_PROBES " + " ".join(probe_rows))
    log("VERTEX_COUNTS " + " ".join(f"{name}={counts[name]}" for name in counts))


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def rotate_world(armature: bpy.types.Object, bone_name: str, axis: Vector, radians: float) -> None:
    """Rotate a pose bone around its current joint in armature/world space."""
    bone = armature.pose.bones[bone_name]
    pivot = bone.head.copy()
    transform = Matrix.Translation(pivot) @ Matrix.Rotation(radians, 4, axis) @ Matrix.Translation(-pivot)
    bone.matrix = transform @ bone.matrix


def log_arm_chain(armature: bpy.types.Object, label: str) -> None:
    """ポーズ後の骨頭位置を出し、親子変換が実際に伝播したかを記録する。"""
    bpy.context.view_layer.update()
    names = ("UpperArm.L", "LowerArm.L")
    values = []
    for name in names:
        bone = armature.pose.bones[name]
        head = bone.head
        tail = bone.tail
        values.append(f"{name}=h({head.x:.3f},{head.z:.3f})/t({tail.x:.3f},{tail.z:.3f})")
    log(f"POSE_CHAIN label={label} " + " ".join(values))


def log_arm_mesh_probes(mesh: bpy.types.Object, label: str) -> None:
    """各腕骨で最も強い頂点が、実際にどこへ変形したかを記録する。"""
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    values = []
    for name in ("UpperArm.L", "LowerArm.L"):
        group = mesh.vertex_groups[name]
        weighted = []
        for vertex in mesh.data.vertices:
            try:
                weighted.append((group.weight(vertex.index), vertex.index))
            except RuntimeError:
                continue
        weight, index = max(weighted)
        rest = mesh.matrix_world @ mesh.data.vertices[index].co
        posed = mesh.matrix_world @ evaluated.data.vertices[index].co
        values.append(f"{name}=w:{weight:.3f},rest:({rest.x:.3f},{rest.z:.3f}),posed:({posed.x:.3f},{posed.z:.3f})")
    log(f"MESH_PROBES label={label} " + " ".join(values))


def log_stretched_edges(mesh: bpy.types.Object, label: str) -> None:
    """ポーズで最も伸びた面境界を記録し、誤分類を推測で直さない。"""
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    edges = set()
    for polygon in mesh.data.polygons:
        indices = list(polygon.vertices)
        for first, second in zip(indices, indices[1:] + indices[:1]):
            edges.add(tuple(sorted((first, second))))

    def strongest_group(index: int) -> str:
        vertex = mesh.data.vertices[index]
        if not vertex.groups:
            return "none"
        group = max(vertex.groups, key=lambda item: item.weight)
        return mesh.vertex_groups[group.group].name

    stretched = []
    for first, second in edges:
        rest_first = mesh.matrix_world @ mesh.data.vertices[first].co
        rest_second = mesh.matrix_world @ mesh.data.vertices[second].co
        posed_first = mesh.matrix_world @ evaluated.data.vertices[first].co
        posed_second = mesh.matrix_world @ evaluated.data.vertices[second].co
        rest_length = (rest_first - rest_second).length
        if rest_length <= 1e-5:
            continue
        ratio = (posed_first - posed_second).length / rest_length
        stretched.append((ratio, first, second, rest_first, rest_second))
    rows = []
    for ratio, first, second, first_point, second_point in sorted(stretched, reverse=True)[:3]:
        rows.append(
            f"ratio:{ratio:.1f},a:({first_point.x:.2f},{first_point.z:.2f})/{strongest_group(first)},"
            f"b:({second_point.x:.2f},{second_point.z:.2f})/{strongest_group(second)}"
        )
    log(f"STRETCH_EDGES label={label} " + " | ".join(rows))


def log_largest_displacements(mesh: bpy.types.Object, label: str) -> None:
    """大きく移動した頂点を骨名付きで出し、目視上の突起を追跡する。"""
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())

    def groups_for(index: int) -> str:
        weights = sorted(mesh.data.vertices[index].groups, key=lambda item: item.weight, reverse=True)[:2]
        return "+".join(f"{mesh.vertex_groups[item.group].name}:{item.weight:.2f}" for item in weights)

    displaced = []
    for vertex in mesh.data.vertices:
        rest = mesh.matrix_world @ vertex.co
        posed = mesh.matrix_world @ evaluated.data.vertices[vertex.index].co
        if rest.z < 1.15:  # 頭フードではなく胴・腕境界だけを対象にする。
            displaced.append(((posed - rest).length, rest, posed, vertex.index))
    rows = []
    for amount, rest, posed, index in sorted(displaced, reverse=True)[:6]:
        rows.append(
            f"d:{amount:.2f},rest:({rest.x:.2f},{rest.z:.2f}),posed:({posed.x:.2f},{posed.z:.2f})/"
            f"{groups_for(index)}"
        )
    log(f"DISPLACED_VERTICES label={label} " + " | ".join(rows))


def pose_for(label: str, armature: bpy.types.Object) -> None:
    reset_pose(armature)
    if label not in {"tpose", "arms-up", "elbow", "walk", "crouch"}:
        raise RuntimeError(f"Unknown pose label: {label}")
    if label == "arms-up":
        # 上腕だけを肩から90度上げる。前腕は親の回転を継承して一直線に上がる。
        rotate_world(armature, "UpperArm.L", Vector((0.0, 1.0, 0.0)), math.radians(-90.0))
        rotate_world(armature, "UpperArm.R", Vector((0.0, 1.0, 0.0)), math.radians(90.0))
        log("POSE_ARMS_UP upper_arm_rotation_degrees=90 lower_arm_local_rotation_degrees=0")
    elif label == "elbow":
        # 肩を動かさず、前腕だけを90度回す関節分離の直接検査。
        rotate_world(armature, "LowerArm.L", Vector((0.0, 1.0, 0.0)), math.radians(-90.0))
        rotate_world(armature, "LowerArm.R", Vector((0.0, 1.0, 0.0)), math.radians(90.0))
        log("POSE_ELBOW upper_arm_rotation_degrees=0 lower_arm_rotation_degrees=90")
    elif label == "walk":
        rotate_world(armature, "UpperLeg.L", Vector((1.0, 0.0, 0.0)), math.radians(-24.0))
        rotate_world(armature, "UpperLeg.R", Vector((1.0, 0.0, 0.0)), math.radians(20.0))
        rotate_world(armature, "UpperArm.L", Vector((1.0, 0.0, 0.0)), math.radians(16.0))
        rotate_world(armature, "UpperArm.R", Vector((1.0, 0.0, 0.0)), math.radians(-16.0))
    elif label == "crouch":
        rotate_world(armature, "UpperLeg.L", Vector((1.0, 0.0, 0.0)), math.radians(-38.0))
        rotate_world(armature, "UpperLeg.R", Vector((1.0, 0.0, 0.0)), math.radians(-38.0))
        rotate_world(armature, "LowerLeg.L", Vector((1.0, 0.0, 0.0)), math.radians(46.0))
        rotate_world(armature, "LowerLeg.R", Vector((1.0, 0.0, 0.0)), math.radians(46.0))
    if label in {"arms-up", "elbow"}:
        log_arm_chain(armature, label)


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_textured_render(scene: bpy.types.Scene) -> None:
    available = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in available else "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.world.color = (0.035, 0.045, 0.065)


def add_area_light(name: str, location: Vector, energy: float, size: float, target: Vector) -> bpy.types.Object:
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def render_pose(label: str, mesh: bpy.types.Object, armature: bpy.types.Object, layout: BodyLayout, output_path: Path) -> int:
    pose_for(label, armature)
    bpy.context.view_layer.update()
    if label in {"arms-up", "elbow"}:
        log_arm_mesh_probes(mesh, label)
        log_stretched_edges(mesh, label)
        log_largest_displacements(mesh, label)
    scene = bpy.context.scene
    configure_textured_render(scene)
    bounds = bounds_for_mesh(mesh, evaluated=True)
    target = Vector((0.0, 0.0, (bounds.minimum.z + bounds.maximum.z) * 0.5))
    camera_data = bpy.data.cameras.new(f"PoseCamera.{label}")
    camera = bpy.data.objects.new(f"PoseCamera.{label}", camera_data)
    bpy.context.collection.objects.link(camera)
    # SPAR3D hero の顔は +Y 側。少し横から見て、腕と膝の変形を同時に読む。
    distance = max(bounds.size.x, bounds.size.z) * 3.2
    camera.location = Vector((distance * 0.58, distance, target.z + bounds.size.z * 0.07))
    look_at(camera, target)
    camera.data.type = "ORTHO"
    portrait_aspect = scene.render.resolution_x / scene.render.resolution_y
    camera.data.ortho_scale = max(bounds.size.z / portrait_aspect * 1.13, bounds.size.x * 1.18)
    scene.camera = camera
    lights = (
        add_area_light(f"PoseKey.{label}", Vector((2.8, 3.6, 3.8)), 720.0, 3.0, target),
        add_area_light(f"PoseFill.{label}", Vector((-3.2, 1.2, 2.2)), 420.0, 2.4, target),
        add_area_light(f"PoseRim.{label}", Vector((1.8, -3.0, 3.0)), 620.0, 2.0, target),
    )
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    reset_pose(armature)
    bpy.context.view_layer.update()
    bpy.data.objects.remove(camera, do_unlink=True)
    for light in lights:
        bpy.data.objects.remove(light, do_unlink=True)
    if not output_path.is_file() or output_path.stat().st_size < 20_000:
        raise RuntimeError(f"Pose render failed or is unexpectedly small: {output_path}")
    size = output_path.stat().st_size
    log(f"POSE_RENDER label={label} path={output_path} bytes={size} resolution=512x768")
    return size


def export_glb(mesh: bpy.types.Object, armature: bpy.types.Object, output_path: Path) -> int:
    reset_pose(armature)
    bpy.context.view_layer.update()
    activate_only([mesh, armature], mesh)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_influence_nb=MAX_INFLUENCES,
        export_all_influences=False,
        export_morph=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )
    if "FINISHED" not in result or not output_path.is_file():
        raise RuntimeError(f"glTF export failed: result={result} path={output_path}")
    size = output_path.stat().st_size
    if size > MAX_GLB_BYTES:
        raise RuntimeError(f"GLB size budget exceeded: {size} > {MAX_GLB_BYTES}")
    log(
        f"EXPORT path={output_path} bytes={size} export_skins=True "
        f"export_influence_nb={MAX_INFLUENCES} export_all_influences=False export_animations=False"
    )
    return size


def requested_name() -> str:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(arguments) != 1:
        raise RuntimeError("Expected exactly one base name, for example: -- hero-nendo")
    name = arguments[0]
    if Path(name).name != name or name.endswith(".glb"):
        raise RuntimeError(f"Use a bare GLB base name, not {name!r}")
    return name


def main() -> None:
    name = requested_name()
    source_path = SOURCE_DIR / f"{name}.glb"
    if not source_path.is_file():
        raise RuntimeError(f"Missing source GLB: {source_path}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_glb = OUTPUT_DIR / f"{name}-rigged.glb"
    log(f"START blender={bpy.app.version_string} source={source_path}")
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    mesh = remove_staging_and_join()
    # リメッシュ前のbaseColor画像だけを参照し、旧UVや法線マップは持ち込まない。
    projector = turnaround_projector_module()
    source_base = projector.image_for_socket(mesh.active_material, "Base Color")
    log(f"SOURCE_BASECOLOR image={source_base.name} size={tuple(source_base.size)}")
    normalize_mesh(mesh)
    log_source_components(mesh)
    remesh_for_deformation(mesh)
    decimate_if_needed(mesh)
    smart_uv_project(mesh)
    texture_path = bake_turnaround_texture(mesh, name, source_base)
    layout = measured_layout(mesh)
    specs = bone_specs(layout)
    armature = create_armature(specs)
    bind_armature_directly(mesh, armature)
    geometric_distance_weights(mesh, specs, layout)
    for label in ("tpose", "arms-up", "elbow", "walk", "crouch"):
        render_pose(label, mesh, armature, layout, OUTPUT_DIR / f"pose-{name}-{label}.png")
    export_glb(mesh, armature, output_glb)
    log(f"COMPLETE name={name} bones={len(specs)} texture={texture_path} output={output_glb}")


if __name__ == "__main__":
    main()
