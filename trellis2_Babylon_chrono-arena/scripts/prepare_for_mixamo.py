"""Prepare SPAR3D static GLB characters for Mixamo Auto-Rigger.

Run from the repository root:
    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/prepare_for_mixamo.py -- chaser

Override the default 180-degree horizontal correction when required:
    blender --background --factory-startup --python-exit-code 1 \
        --python scripts/prepare_for_mixamo.py -- --yaw 90 chaser

The source GLB files are never modified.  This script writes only FBX and
preview PNG files under ``assets/production/demonic/fbx``.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SPAR3D_DIR = ROOT / "assets" / "production" / "demonic" / "spar3d"
OUTPUT_DIR = ROOT / "assets" / "production" / "demonic" / "fbx"
TARGET_HEIGHT_METERS = 1.8
MAX_FACES = 50_000
MAX_FBX_BYTES = 10 * 1024 * 1024
DEFAULT_YAW_DEGREES = 180.0


@dataclass(frozen=True)
class MeshStats:
    vertices: int
    faces: int
    materials: int


@dataclass(frozen=True)
class Bounds:
    minimum: Vector
    maximum: Vector

    @property
    def size(self) -> Vector:
        return self.maximum - self.minimum

    @property
    def center_xy(self) -> Vector:
        return Vector(((self.minimum.x + self.maximum.x) * 0.5, (self.minimum.y + self.maximum.y) * 0.5))


def log(name: str, message: str) -> None:
    print(f"[MIXAMO] name={name} {message}")


def format_vector(vector: Vector) -> str:
    return "(" + ", ".join(f"{value:.5f}" for value in vector) + ")"


def clear_scene() -> None:
    """Remove imported objects and orphan data from the previous character."""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def mesh_stats(meshes: list[bpy.types.Object]) -> MeshStats:
    return MeshStats(
        vertices=sum(len(mesh.data.vertices) for mesh in meshes),
        faces=sum(len(mesh.data.polygons) for mesh in meshes),
        materials=sum(len(mesh.data.materials) for mesh in meshes),
    )


def bounds_for_meshes(meshes: list[bpy.types.Object]) -> Bounds:
    vertices = [mesh.matrix_world @ vertex.co for mesh in meshes for vertex in mesh.data.vertices]
    if not vertices:
        raise RuntimeError("No mesh vertices found while calculating bounds.")
    return Bounds(
        minimum=Vector(tuple(min(vertex[axis] for vertex in vertices) for axis in range(3))),
        maximum=Vector(tuple(max(vertex[axis] for vertex in vertices) for axis in range(3))),
    )


def remove_spar3d_staging_meshes(meshes: list[bpy.types.Object]) -> tuple[list[bpy.types.Object], list[str]]:
    """Discard only the low-poly photo-stage cube SPAR3D sometimes exports.

    The cube is not part of the character: it has only a handful of faces and
    is much larger than the detailed human mesh.  Small detailed accessories
    remain eligible for joining.
    """
    detailed_meshes = [mesh for mesh in meshes if len(mesh.data.polygons) > 12]
    if not detailed_meshes:
        return meshes, []
    detailed_longest_side = max(max(mesh.dimensions) for mesh in detailed_meshes)
    discarded = [
        mesh
        for mesh in meshes
        if len(mesh.data.polygons) <= 12 and max(mesh.dimensions) > detailed_longest_side * 1.25
    ]
    discarded_names = [mesh.name for mesh in discarded]
    for mesh in discarded:
        bpy.data.objects.remove(mesh, do_unlink=True)
    return [mesh for mesh in meshes if mesh not in discarded], discarded_names


def activate_only(meshes: list[bpy.types.Object], active: bpy.types.Object | None = None) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    active = active or meshes[0]
    bpy.context.view_layer.objects.active = active
    return active


def join_meshes(meshes: list[bpy.types.Object]) -> bpy.types.Object:
    if not meshes:
        raise RuntimeError("SPAR3D import did not provide a character mesh.")
    # 親子変換を含めて頂点へ焼き込み、join 後の bbox をワールド基準で安定させる。
    for mesh in meshes:
        world_matrix = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = world_matrix
        activate_only([mesh], mesh)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    active = activate_only(meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    active.name = "MixamoCharacter"
    return active


def collapse_materials(mesh: bpy.types.Object) -> None:
    """Keep one material slot so the Mixamo upload contains one mesh/material.

    SPAR3D's current character body has one material.  If a future export has
    multiple slots, the first material is deliberately retained rather than
    exporting a multi-material FBX; this keeps the Mixamo handoff contract
    explicit and visible in the log.
    """
    material_count = len(mesh.data.materials)
    if material_count == 0:
        material = bpy.data.materials.new("MixamoMaterial")
        material.diffuse_color = (0.6, 0.6, 0.6, 1.0)
        mesh.data.materials.append(material)
        return
    if material_count == 1:
        return
    for polygon in mesh.data.polygons:
        polygon.material_index = 0
    while len(mesh.data.materials) > 1:
        mesh.data.materials.pop(index=1)


def apply_upright_rotation(mesh: bpy.types.Object) -> str:
    """Map the imported longest human axis to Blender +Z and apply it."""
    # SPAR3D's character mesh retains QUATERNION mode after its parent is
    # removed.  Euler assignments do not drive a quaternion-mode object.
    mesh.rotation_mode = "XYZ"
    initial_bounds = bounds_for_meshes([mesh])
    vertical_axis = max(range(3), key=lambda axis: initial_bounds.size[axis])
    if vertical_axis == 0:
        mesh.rotation_euler[1] = -math.pi / 2.0  # +X を +Z へ。
        correction = "X_TO_Z"
    elif vertical_axis == 1:
        mesh.rotation_euler[0] = math.pi / 2.0  # +Y を +Z へ。
        correction = "Y_TO_Z"
    else:
        correction = "Z_ALREADY_UPRIGHT"
    activate_only([mesh], mesh)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return correction


def apply_yaw_rotation(mesh: bpy.types.Object, yaw_degrees: float) -> tuple[Vector, Vector]:
    """Rotate the SPAR3D-facing direction into Mixamo's Blender -Y forward."""
    vertex_before_yaw = mesh.data.vertices[0].co.copy()
    mesh.rotation_mode = "XYZ"
    mesh.rotation_euler = (0.0, 0.0, math.radians(yaw_degrees))
    activate_only([mesh], mesh)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return vertex_before_yaw, mesh.data.vertices[0].co.copy()


def scale_and_ground(mesh: bpy.types.Object) -> float:
    bounds_before_scale = bounds_for_meshes([mesh])
    height = bounds_before_scale.size.z
    if height <= 0.0:
        raise RuntimeError(f"Character height is invalid: {height}")
    scale_multiplier = TARGET_HEIGHT_METERS / height
    mesh.scale *= scale_multiplier
    activate_only([mesh], mesh)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # 足元中央を原点へ移し、Mixamo で root が地面に乗るようにする。
    scaled_bounds = bounds_for_meshes([mesh])
    mesh.location = (-scaled_bounds.center_xy.x, -scaled_bounds.center_xy.y, -scaled_bounds.minimum.z)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return scale_multiplier


def decimate_if_needed(mesh: bpy.types.Object) -> bool:
    face_count = len(mesh.data.polygons)
    if face_count <= MAX_FACES:
        return False
    modifier = mesh.modifiers.new("MixamoFaceBudget", "DECIMATE")
    # 少し余裕を持たせ、丸め後も 50,000 面以下を保証する。
    modifier.ratio = min(1.0, (MAX_FACES - 100) / face_count)
    activate_only([mesh], mesh)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if len(mesh.data.polygons) > MAX_FACES:
        raise RuntimeError(
            f"Decimate did not reach the {MAX_FACES}-face budget: {len(mesh.data.polygons)} faces."
        )
    return True


def export_fbx(name: str, mesh: bpy.types.Object, output_path: Path) -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    activate_only([mesh], mesh)
    # Blender 5.2.0 の live RNA で確認した FBX 引数。COPY + embed が必須。
    result = bpy.ops.export_scene.fbx(
        filepath=str(output_path),
        use_selection=True,
        object_types={"MESH"},
        path_mode="COPY",
        embed_textures=True,
        axis_forward="-Z",
        axis_up="Y",
        bake_anim=False,
        add_leaf_bones=False,
    )
    if "FINISHED" not in result or not output_path.is_file():
        raise RuntimeError(f"FBX export failed: result={result} path={output_path}")
    size = output_path.stat().st_size
    if size >= MAX_FBX_BYTES:
        raise RuntimeError(f"FBX exceeds the {MAX_FBX_BYTES}-byte budget: {size} bytes.")
    # Blender's binary FBX exporter writes embedded image data as a Video
    # object's Content payload.  This verifies the exported file rather than
    # rejecting valid characters merely because their source texture is small.
    fbx_payload = output_path.read_bytes()
    embedded_texture_payload = b"Video" in fbx_payload and b"Content" in fbx_payload
    if not embedded_texture_payload:
        raise RuntimeError(f"FBX has no embedded texture payload: {output_path}")
    log(
        name,
        "FBX_EXPORT "
        f"path={output_path} path_mode=COPY embed_textures=True "
        f"embedded_texture_payload={embedded_texture_payload} bytes={size}",
    )
    return size


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_workbench(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    shading.show_shadows = True
    shading.show_cavity = True
    shading.cavity_type = "WORLD"
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.24, 0.24, 0.24)


def render_preview(name: str, mesh: bpy.types.Object, label: str, camera_location: Vector, output_path: Path) -> int:
    scene = bpy.context.scene
    configure_workbench(scene)
    bounds = bounds_for_meshes([mesh])
    target = Vector((0.0, 0.0, (bounds.minimum.z + bounds.maximum.z) * 0.5))
    camera_data = bpy.data.cameras.new(f"MixamoPreviewCamera.{label}")
    camera = bpy.data.objects.new(f"MixamoPreviewCamera.{label}", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = camera_location
    look_at(camera, target)
    camera.data.type = "ORTHO"
    # 512x768 の縦長フレームに高さと横幅の両方を収める。
    portrait_aspect = scene.render.resolution_x / scene.render.resolution_y
    camera.data.ortho_scale = max(
        bounds.size.z / portrait_aspect * 1.12,
        max(bounds.size.x, bounds.size.y) * 1.20,
    )
    scene.camera = camera
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    if not output_path.is_file():
        raise RuntimeError(f"Preview render did not create {output_path}")
    size = output_path.stat().st_size
    if size < 30_000:
        raise RuntimeError(f"Preview image is unexpectedly small: {output_path} ({size} bytes)")
    log(name, f"PREVIEW label={label} path={output_path} bytes={size} resolution=512x768 texture_color=WORKBENCH")
    return size


def process_character(name: str, yaw_degrees: float) -> None:
    source_path = SPAR3D_DIR / f"{name}.glb"
    if not source_path.is_file():
        raise RuntimeError(f"Missing SPAR3D input: {source_path}")
    output_path = OUTPUT_DIR / f"{name}.fbx"
    front_preview = OUTPUT_DIR / f"preview-{name}-front.png"
    side_preview = OUTPUT_DIR / f"preview-{name}-side.png"
    back_preview = OUTPUT_DIR / f"preview-{name}-back.png"

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    imported_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    character_meshes, discarded = remove_spar3d_staging_meshes(imported_meshes)
    original_stats = mesh_stats(character_meshes)
    imported_bounds = bounds_for_meshes(character_meshes)
    log(
        name,
        "IMPORT "
        f"source={source_path} vertices={original_stats.vertices} faces={original_stats.faces} "
        f"materials={original_stats.materials} bbox_min={format_vector(imported_bounds.minimum)} "
        f"bbox_max={format_vector(imported_bounds.maximum)} bbox_size={format_vector(imported_bounds.size)} "
        f"discarded_staging_meshes={discarded or 'none'}",
    )

    mesh = join_meshes(character_meshes)
    collapse_materials(mesh)
    correction = apply_upright_rotation(mesh)
    yaw_vertex_before, yaw_vertex_after = apply_yaw_rotation(mesh, yaw_degrees)
    log(
        name,
        "YAW_APPLY "
        f"yaw_degrees={yaw_degrees:.3f} vertex0_before={format_vector(yaw_vertex_before)} "
        f"vertex0_after={format_vector(yaw_vertex_after)}",
    )
    # Yaw changes the horizontal bounding box.  Ground only after it has been
    # baked, so the exported origin remains the feet's X/Y center at Z=0.
    scale_multiplier = scale_and_ground(mesh)
    was_decimated = decimate_if_needed(mesh)
    final_bounds = bounds_for_meshes([mesh])
    final_stats = mesh_stats([mesh])
    if final_stats.materials != 1:
        raise RuntimeError(f"Expected exactly one material after consolidation, got {final_stats.materials}.")
    if not math.isclose(final_bounds.size.z, TARGET_HEIGHT_METERS, rel_tol=0.0, abs_tol=0.001):
        raise RuntimeError(f"Expected {TARGET_HEIGHT_METERS}m height, got {final_bounds.size.z}m.")
    if not math.isclose(final_bounds.minimum.z, 0.0, rel_tol=0.0, abs_tol=0.001):
        raise RuntimeError(f"Expected ground-aligned Z minimum, got {final_bounds.minimum.z}.")
    log(
        name,
        "RESULT "
        f"vertices={final_stats.vertices} faces={final_stats.faces} materials={final_stats.materials} "
        f"orientation={correction} yaw_degrees={yaw_degrees:.3f} "
        f"scale_multiplier={scale_multiplier:.6f} decimated={was_decimated} "
        f"bbox_min={format_vector(final_bounds.minimum)} bbox_max={format_vector(final_bounds.maximum)} "
        f"bbox_size={format_vector(final_bounds.size)}",
    )

    export_fbx(name, mesh, output_path)
    preview_distance = max(final_bounds.size) * 3.0
    render_preview(name, mesh, "front", Vector((0.0, -preview_distance, final_bounds.size.z * 0.5)), front_preview)
    render_preview(name, mesh, "side", Vector((preview_distance, 0.0, final_bounds.size.z * 0.5)), side_preview)
    render_preview(name, mesh, "back", Vector((0.0, preview_distance, final_bounds.size.z * 0.5)), back_preview)
    log(name, "COMPLETE")


def requested_options() -> tuple[list[str], float]:
    try:
        separator = sys.argv.index("--")
    except ValueError:
        arguments: list[str] = []
    else:
        arguments = sys.argv[separator + 1 :]
    names: list[str] = []
    yaw_degrees = DEFAULT_YAW_DEGREES
    argument_index = 0
    while argument_index < len(arguments):
        argument = arguments[argument_index]
        if argument == "--yaw":
            argument_index += 1
            if argument_index == len(arguments):
                raise RuntimeError("--yaw requires a degree value, for example '--yaw 180'.")
            yaw_value = arguments[argument_index]
            try:
                yaw_degrees = float(yaw_value)
            except ValueError as error:
                raise RuntimeError(f"--yaw must be a number of degrees, got {yaw_value!r}.") from error
        elif argument.startswith("--yaw="):
            yaw_value = argument.removeprefix("--yaw=")
            try:
                yaw_degrees = float(yaw_value)
            except ValueError as error:
                raise RuntimeError(f"--yaw must be a number of degrees, got {yaw_value!r}.") from error
        elif argument.startswith("--"):
            raise RuntimeError(f"Unknown option: {argument!r}.")
        else:
            names.append(argument)
        argument_index += 1
    if not math.isfinite(yaw_degrees):
        raise RuntimeError(f"--yaw must be finite, got {yaw_degrees!r}.")
    names = names or sorted(path.stem for path in SPAR3D_DIR.glob("*.glb"))
    if not names:
        raise RuntimeError(f"No GLB files found in {SPAR3D_DIR}")
    for name in names:
        if Path(name).name != name or name.endswith(".glb"):
            raise RuntimeError(f"Use a GLB base name such as 'chaser', not {name!r}.")
    return names, yaw_degrees


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    names, yaw_degrees = requested_options()
    print(
        f"[MIXAMO] Blender={bpy.app.version_string} inputs={','.join(names)} "
        f"yaw_degrees={yaw_degrees:.3f} output_dir={OUTPUT_DIR}"
    )
    for name in names:
        process_character(name, yaw_degrees)
    print(f"[MIXAMO] ALL_COMPLETE count={len(names)}")


if __name__ == "__main__":
    main()
