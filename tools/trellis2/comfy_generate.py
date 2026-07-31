#!/usr/bin/env python3
"""参照画像から TRELLIS.2 (ローカル ComfyUI) でテクスチャ付き glb を生成する。

  python tools/trellis2/comfy_generate.py --name mortar --image path/to/mortar-ref.png \
      --out-dir out/ [--texture-size 2048] [--target-faces 500000]

ComfyUI の UI ワークフロー MeshWithTexturing.json と同じグラフを API 形式で組み立てる。
ComfyUI が 127.0.0.1:8188 で起動している前提（tools/trellis2/run_comfyui.sh）。
複数アセットを渡すときは --name/--image を繰り返す。パイプラインは常駐させるので
2 個目以降はモデルロードが省ける。
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SERVER = os.environ.get("COMFY_SERVER", "127.0.0.1:8188")
COMFY_ROOT = os.environ.get(
    "COMFY_ROOT", r"C:\Users\yamau\work\babylon\tools\trellis2\ComfyUI"
)
MODEL_NAME = os.environ.get("TRELLIS2_MODEL", "visualbruno/TRELLIS.2-4B-FP8")
# この環境の venv には flash_attn が入っていないため xformers を使う
ATTENTION = os.environ.get("TRELLIS2_ATTENTION", "xformers")


def http_json(path: str, payload=None):
    url = f"http://{SERVER}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"} if data else {}
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def upload_image(path: str) -> str:
    """ComfyUI の input へ画像を置く。名前衝突は overwrite で上書きする。"""
    name = os.path.basename(path)
    boundary = uuid.uuid4().hex
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        blob = f.read()
    parts = []
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
        f"filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
    )
    parts.append(blob)
    parts.append(f"\r\n--{boundary}\r\n".encode())
    parts.append(
        b"Content-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n"
        + f"--{boundary}--\r\n".encode()
    )
    body = b"".join(parts)
    req = urllib.request.Request(
        f"http://{SERVER}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode("utf-8"))["name"]


def build_prompt(*, image_name, out_name, texture_size, target_faces,
                 shape_resolution, to_resolution, seed, keep_loaded,
                 texture_resolution, max_views, quad_resolution, cascade=True):
    """MeshWithTexturing.json と同じノード構成を API 形式で返す。"""
    p = {}
    p["39"] = {"class_type": "Trellis2LoadModel", "inputs": {
        "modelname": MODEL_NAME, "backend": ATTENTION, "device": "cuda",
        "low_vram": True, "keep_models_loaded": keep_loaded,
        "conv_backend": "flex_gemm", "sparse_backend": ATTENTION,
        "use_reconviagen": False}}
    p["6"] = {"class_type": "Trellis2LoadImageWithTransparency",
              "inputs": {"image": image_name}}
    p["194"] = {"class_type": "Trellis2PreProcessImage", "inputs": {
        "image": ["6", 2], "padding": 10, "remove_background": False,
        "max_size": 1024}}
    p["213"] = {"class_type": "Trellis2ImageCondGenerator", "inputs": {
        "pipeline": ["39", 0], "image": ["194", 0], "max_views": 1}}
    p["214"] = {"class_type": "Trellis2SparseGenerator", "inputs": {
        "pipeline": ["213", 2], "image_cond": ["213", 0], "seed": seed,
        "sparse_structure_steps": 12, "sparse_structure_guidance_strength": 7.5,
        "sparse_structure_guidance_rescale": 0.01, "sparse_structure_rescale_t": 5,
        "sparse_structure_sampler": "heun", "sparse_structure_resolution": 32,
        "sparse_structure_guidance_interval_start": 0.1,
        "sparse_structure_guidance_interval_end": 1, "fill_holes": True,
        "hole_iterations": 1, "verbose": False, "dino_lock": 1,
        "dino_substeps": 8, "hole_fill_algorithm": "flood_fill",
        "dino_foundation_cap": 1, "keep_only_shell": True}}
    p["215"] = {"class_type": "Trellis2ShapeGenerator", "inputs": {
        "pipeline": ["214", 2], "image_cond": ["213", 0], "coords": ["214", 0],
        "resolution": shape_resolution, "shape_steps": 12,
        "shape_guidance_strength": 7.5, "shape_guidance_rescale": 0.01,
        "shape_rescale_t": 3, "shape_sampler": "heun",
        "shape_guidance_interval_start": 0.1, "shape_guidance_interval_end": 1,
        "verbose": False, "dino_lock": 0, "dino_substeps": 9,
        "dino_foundation_cap": 1}}
    p["216"] = {"class_type": "Trellis2ShapeCascadeGenerator", "inputs": {
        "pipeline": ["215", 2], "image_cond": ["213", 1],
        "shape_slat": ["215", 0], "from_resolution": ["215", 1],
        "to_resolution": to_resolution,
        "sparse_structure_resolution": ["214", 1], "max_num_tokens": 999999,
        "shape_steps": 12, "shape_guidance_strength": 7.5,
        "shape_guidance_rescale": 0.01, "shape_rescale_t": 3,
        "shape_sampler": "heun", "shape_guidance_interval_start": 0.1,
        "shape_guidance_interval_end": 1, "verbose": False, "dino_lock": 0,
        "dino_substeps": 1, "dino_foundation_cap": 1}}
    # カスケードは 512 の形状を 1024 へ引き上げる段。デコードの VRAM ピークが
    # ここで跳ね上がるため、複雑すぎて OOM する対象は cascade=False で 512 のまま出す。
    shape_src = "216" if cascade else "215"
    if not cascade:
        del p["216"]
    p["217"] = {"class_type": "Trellis2DecodeLatents", "inputs": {
        "pipeline": [shape_src, 2], "shape_slat": [shape_src, 0],
        "resolution": [shape_src, 1], "use_tiled_decoder": True}}
    p["193"] = {"class_type": "Trellis2FillHolesWithCuMesh", "inputs": {
        "mesh": ["217", 0], "max_permieters": 1}}
    p["161"] = {"class_type": "Trellis2ReconstructMeshWithQuad", "inputs": {
        "mesh": ["193", 0], "remesh_band": 1, "resolution": quad_resolution,
        "remove_floaters": True, "remove_inner_faces": True}}
    p["218"] = {"class_type": "Trellis2SimplifyMesh", "inputs": {
        "mesh": ["161", 0], "target_face_num": target_faces,
        "method": "Cumesh"}}
    p["250"] = {"class_type": "Trellis2FillHolesNicelyWithMeshlib",
                "inputs": {"mesh": ["218", 0]}}
    p["257"] = {"class_type": "Trellis2SimplifyMesh", "inputs": {
        "mesh": ["250", 0], "target_face_num": target_faces,
        "method": "Cumesh"}}
    p["264"] = {"class_type": "Trellis2MeshWithVoxelToTrimesh", "inputs": {
        "mesh": ["257", 0], "reorient_vertices": "90 degrees"}}
    p["203"] = {"class_type": "Trellis2ExportMesh", "inputs": {
        "trimesh": ["264", 0], "filename_prefix": f"{out_name}_WhiteMesh",
        "file_format": "glb"}}
    p["267"] = {"class_type": "Trellis2Continue", "inputs": {
        "input_1": ["264", 0], "input_2": ["203", 0]}}
    p["261"] = {"class_type": "Trellis2MeshTexturing", "inputs": {
        "pipeline": ["217", 2], "image": ["194", 0], "trimesh": ["267", 0],
        "seed": seed, "texture_steps": 12, "texture_guidance_strength": 5,
        "texture_guidance_rescale": 0.05, "texture_rescale_t": 3,
        "resolution": texture_resolution, "texture_size": texture_size,
        "texture_alpha_mode": "OPAQUE", "double_side_material": False,
        "texture_guidance_interval_start": 0,
        "texture_guidance_interval_end": 0.99, "max_views": max_views,
        "bake_on_vertices": False, "use_custom_normals": False,
        "mesh_cluster_threshold_cone_half_angle_rad": 60, "sampler": "heun",
        "inpainting": "telea", "verbose": False, "dino_lock": 0,
        "dino_substeps": 4, "dino_foundation_cap": 1}}
    p["262"] = {"class_type": "Trellis2ExportMesh", "inputs": {
        "trimesh": ["261", 0], "filename_prefix": f"{out_name}_Textured",
        "file_format": "glb"}}
    return p


def run(prompt, client_id, label):
    res = http_json("/prompt", {"prompt": prompt, "client_id": client_id})
    pid = res["prompt_id"]
    t0 = time.time()
    last = ""
    while True:
        time.sleep(3)
        hist = http_json(f"/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error" or not status.get("completed", True):
                msgs = status.get("messages", [])
                raise RuntimeError(f"{label}: 実行エラー\n{json.dumps(msgs, ensure_ascii=False, indent=2)[:4000]}")
            return entry, time.time() - t0
        q = http_json("/queue")
        running = [x[1] for x in q.get("queue_running", [])]
        state = "実行中" if pid in running else "待機中"
        # 30 秒ごとにだけ出す（3 秒ごとだと一括生成でログが数千行になる）
        bucket = f"{state} {int((time.time() - t0) // 30) * 30}s"
        if bucket != last:
            print(f"  {label}: {bucket}", flush=True)
            last = bucket


def collect_outputs(entry, out_dir, name):
    """history の出力から glb を out_dir へ回収する。"""
    saved = []
    for node_out in entry.get("outputs", {}).values():
        for key in ("result", "glb_path", "text", "string"):
            for v in node_out.get(key, []) if isinstance(node_out.get(key), list) else []:
                if isinstance(v, str) and v.lower().endswith(".glb") and os.path.isfile(v):
                    saved.append(v)
    # ノード出力に絶対パスが乗らない構成もあるので output ディレクトリからも拾う
    outdir = os.path.join(COMFY_ROOT, "output")
    for kind in ("Textured", "WhiteMesh"):
        cands = [os.path.join(outdir, f) for f in os.listdir(outdir)
                 if f.startswith(f"{name}_{kind}_") and f.endswith(".glb")]
        if cands:
            saved.append(max(cands, key=os.path.getmtime))
    copied = []
    os.makedirs(out_dir, exist_ok=True)
    for src in dict.fromkeys(saved):
        kind = "textured" if "Textured" in os.path.basename(src) else "whitemesh"
        dst = os.path.join(out_dir, f"{name}-trellis2-{kind}.glb")
        shutil.copy2(src, dst)
        copied.append(dst)
    return copied


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", action="append", required=True, help="出力名（複数可）")
    ap.add_argument("--image", action="append", required=True, help="参照画像（--name と同数）")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--texture-size", type=int, default=2048, help="UV アトラス解像度")
    ap.add_argument("--texture-resolution", type=int, default=1024, choices=[512, 1024, 1536],
                    help="テクスチャ生成時のビュー解像度")
    ap.add_argument("--max-views", type=int, default=4, help="テクスチャ生成の視点数")
    ap.add_argument("--target-faces", type=int, default=500000)
    ap.add_argument("--quad-resolution", type=int, default=1024, choices=[128, 256, 512, 1024, 2048])
    ap.add_argument("--shape-resolution", type=int, default=512, choices=[512, 1024])
    ap.add_argument("--to-resolution", type=int, default=1024, choices=[1024, 1536])
    ap.add_argument("--seed", type=int, default=12345)
    ap.add_argument("--suffix", default="", help="出力名に付ける識別子（パラメータ比較用）")
    ap.add_argument("--no-cascade", action="store_true",
                    help="1024 へのカスケード段を外して 512 のままデコードする（VRAM 退避用・ディテールは落ちる）")
    args = ap.parse_args()

    if len(args.name) != len(args.image):
        sys.exit("--name と --image の数が一致しない")

    client_id = uuid.uuid4().hex
    for i, (name, image) in enumerate(zip(args.name, args.image)):
        if not os.path.isfile(image):
            sys.exit(f"参照画像がない: {image}")
        out_name = f"{name}{args.suffix}"
        uploaded = upload_image(image)
        prompt = build_prompt(
            image_name=uploaded, out_name=out_name,
            texture_size=args.texture_size, target_faces=args.target_faces,
            shape_resolution=args.shape_resolution,
            to_resolution=args.to_resolution, seed=args.seed,
            keep_loaded=(i < len(args.name) - 1),
            texture_resolution=args.texture_resolution,
            max_views=args.max_views, quad_resolution=args.quad_resolution,
            cascade=not args.no_cascade)
        print(f"[{i + 1}/{len(args.name)}] {out_name} <- {os.path.basename(image)}", flush=True)
        entry, secs = run(prompt, client_id, out_name)
        files = collect_outputs(entry, args.out_dir, out_name)
        print(f"  完了 {secs:.0f}s: " + ", ".join(os.path.basename(f) for f in files), flush=True)


if __name__ == "__main__":
    main()
