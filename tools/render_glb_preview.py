"""GLB を固定カメラ・固定ライトでレンダリングし、アセット比較用の PNG を出す。

  blender -b -P tools/render_glb_preview.py -- --glb a.glb --out-dir out --name a \
      [--views 0,120,240] [--elevation 18] [--res 720] [--modes tex,clay]

サイズと向きの異なる glb を並べて比べられるよう、読み込み後にバウンディングボックスで
正規化する（中心を原点へ、最大寸法を 2 に）。tex はマテリアルそのまま、clay は全マテリアルを
無彩色の粘土に差し替えて形状だけを見る。
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--views", default="35,150,265")
    ap.add_argument("--elevation", type=float, default=18.0)
    ap.add_argument("--res", type=int, default=720)
    ap.add_argument("--modes", default="tex,clay")
    return ap.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def world_corners(objs):
    return [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]


def fit_distance(corners, center, direction, lens, sensor, margin=1.06):
    """視線方向 direction からバウンディングボックス全体が画角に収まる最短距離。

    外接球でフィットすると平たい物ほど余白が増えるので、実際の 8 隅を投影して詰める。
    """
    up_hint = Vector((0, 0, 1))
    if abs(direction.dot(up_hint)) > 0.99:
        up_hint = Vector((0, 1, 0))
    right = direction.cross(up_hint).normalized()
    up = right.cross(direction).normalized()
    tan_half = sensor / 2 / lens
    need = 0.0
    for c in corners:
        v = c - center
        along = v.dot(direction)
        lateral = max(abs(v.dot(right)), abs(v.dot(up))) / tan_half
        need = max(need, along + lateral)
    return need * margin


def measure_bounds(objs):
    """ワールド座標のバウンディングボックスから中心と外接球半径を返す。

    モデル側は動かさず、カメラとライトをこの中心・半径に合わせる。glb ごとに
    寸法も原点位置もばらばらでも、同じ画角・同じ相対光源で並べられる。
    """
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objs:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            lo = Vector(min(a, b) for a, b in zip(lo, w))
            hi = Vector(max(a, b) for a, b in zip(hi, w))
    center = (lo + hi) / 2
    radius = ((hi - lo) / 2).length
    return center, max(radius, 1e-6)


def look_at(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_light(name, offset, energy_per_area, color, size, center, radius):
    """モデルの外接球に対する相対位置でライトを置く（明るさは距離²で補正）。"""
    data = bpy.data.lights.new(name, "AREA")
    loc = center + Vector(offset) * radius
    data.energy = energy_per_area * (loc - center).length_squared
    data.color = color
    data.shape = "DISK"
    data.size = size * radius
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, center)
    return obj


def setup_scene(res, center, radius):
    scene = bpy.context.scene
    ids = {i.identifier for i in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.06, 0.065, 0.08, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    add_light("Key", (1.5, -1.7, 2.1), 38, (1.0, 0.96, 0.90), 2.0, center, radius)
    add_light("Fill", (-1.8, -1.0, 0.8), 18, (0.82, 0.88, 1.0), 2.2, center, radius)
    add_light("Rim", (-0.6, 1.9, 1.5), 26, (0.95, 0.98, 1.0), 1.5, center, radius)
    cam_data = bpy.data.cameras.new("PreviewCamera")
    cam_data.lens = 62
    cam = bpy.data.objects.new("PreviewCamera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def clay_override(objs):
    mat = bpy.data.materials.new("Clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.62, 0.62, 0.64, 1)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.55
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)


def render_views(cam, out_dir, name, mode, views, elevation, center, corners):
    os.makedirs(out_dir, exist_ok=True)
    el = math.radians(elevation)
    for az_deg in views:
        az = math.radians(az_deg)
        direction = Vector((
            math.cos(el) * math.sin(az),
            -math.cos(el) * math.cos(az),
            math.sin(el),
        )).normalized()
        dist = fit_distance(corners, center, direction, cam.data.lens,
                            cam.data.sensor_width)
        cam.location = center + direction * dist
        look_at(cam, center)
        path = os.path.join(out_dir, f"{name}-{mode}-{int(az_deg):03d}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"RENDER_OK {path}")


def main():
    args = parse_args()
    views = [float(v) for v in args.views.split(",")]
    modes = args.modes.split(",")
    for mode in modes:
        clear_scene()
        objs = import_glb(args.glb)
        if not objs:
            sys.exit(f"メッシュがない: {args.glb}")
        center, radius = measure_bounds(objs)
        cam = setup_scene(args.res, center, radius)
        if mode == "clay":
            clay_override(objs)
        render_views(cam, args.out_dir, args.name, mode, views, args.elevation,
                     center, world_corners(objs))


if __name__ == "__main__":
    main()
