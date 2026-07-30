#!/usr/bin/env node
// glb を検証する。生成直後と減量後に必ず通す。目視では気づけない
// 「UVが無い」「テクスチャが入っていない」「板状に崩れた」「中身が詰まって
// 塊になった」を機械的に検出する。
//
//   node check-glb.mjs <file.glb> [more.glb ...]
//
// 終了コード: すべて健全なら 0、警告があれば 1（バッチ/CIで使える）
//
// 実装上の注意: bbox は accessor の min/max ではなく、ノードのTRSを適用した
// 実頂点から求める。gltfpack で量子化した glb は accessor 値が整数レンジに
// なり、ノードのスケールで元寸法へ戻す設計のため、min/max をそのまま読むと
// 「bbox 16383 x 10199」のような無意味な値になり、扁平判定が機能しない。

import { readFileSync, statSync } from "node:fs";

const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORMALIZE_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function parseGlb(path) {
  const buf = readFileSync(path);
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error("glTF binary ではない");
  const version = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  let bin = null;
  let offset = 20 + jsonLen;
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    if (buf.readUInt32LE(offset + 4) === 0x004e4942) bin = buf.subarray(offset + 8, offset + 8 + len);
    offset += 8 + len;
  }
  return { gltf, bin, version, bytes: buf.length };
}

// アクセサを密な配列として読む（byteStride のインターリーブと正規化整数に対応）
function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const counts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const comps = counts[acc.type];
  const Arr = ARRAYS[acc.componentType];
  if (!Arr || acc.bufferView === undefined) return null;
  const view = gltf.bufferViews[acc.bufferView];
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const tight = comps * Arr.BYTES_PER_ELEMENT;
  const stride = view.byteStride ?? tight;
  const out = new Float64Array(acc.count * comps);
  const scale = acc.normalized ? NORMALIZE_MAX[acc.componentType] ?? 1 : 1;
  for (let i = 0; i < acc.count; i += 1) {
    const row = new Arr(bin.buffer, bin.byteOffset + start + i * stride, comps);
    for (let k = 0; k < comps; k += 1) out[i * comps + k] = acc.normalized ? row[k] / scale : row[k];
  }
  return out;
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function nodeMatrix(node) {
  if (node.matrix) return Float64Array.from(node.matrix);
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return Float64Array.from([
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

// mesh index -> ワールド行列（同じメッシュが複数ノードから参照されることがある）
function meshTransforms(gltf) {
  const out = new Map();
  const identity = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const walk = (nodeIndex, parent) => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      if (!out.has(node.mesh)) out.set(node.mesh, []);
      out.get(node.mesh).push(world);
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? gltf.nodes?.map((_, i) => i) ?? [];
  for (const root of roots) walk(root, identity);
  return out;
}

function apply(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function summarize(path) {
  const { gltf, bin, version, bytes } = parseGlb(path);
  const transforms = meshTransforms(gltf);
  const attrs = new Set();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  let triangles = 0;
  let signedVolume = 0;
  let decoded = true;

  (gltf.meshes ?? []).forEach((mesh, meshIndex) => {
    const worlds = transforms.get(meshIndex) ?? [nodeMatrix({})];
    for (const prim of mesh.primitives ?? []) {
      for (const key of Object.keys(prim.attributes ?? {})) attrs.add(key);
      const posIndex = prim.attributes?.POSITION;
      if (posIndex === undefined) continue;
      const positions = bin ? readAccessor(gltf, bin, posIndex) : null;
      if (!positions) { decoded = false; continue; }
      const indices = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : null;
      const count = positions.length / 3;

      for (const world of worlds) {
        vertices += count;
        const world3 = [];
        for (let i = 0; i < count; i += 1) {
          const p = apply(world, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          world3.push(p);
          for (let k = 0; k < 3; k += 1) {
            if (p[k] < min[k]) min[k] = p[k];
            if (p[k] > max[k]) max[k] = p[k];
          }
        }
        const faceCount = indices ? indices.length / 3 : count / 3;
        triangles += Math.floor(faceCount);
        for (let f = 0; f < faceCount; f += 1) {
          const a = world3[indices ? indices[f * 3] : f * 3];
          const b = world3[indices ? indices[f * 3 + 1] : f * 3 + 1];
          const c = world3[indices ? indices[f * 3 + 2] : f * 3 + 2];
          if (!a || !b || !c) continue;
          // 発散定理による符号付き体積（閉じていないメッシュでも近似値として使える）
          signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        }
      }
    }
  });

  const size = min.every(Number.isFinite) ? [0, 1, 2].map((k) => max[k] - min[k]) : null;
  const bboxVolume = size ? size[0] * size[1] * size[2] : 0;
  return {
    path, version, bytes, vertices, triangles, decoded,
    attributes: [...attrs],
    images: (gltf.images ?? []).length,
    materials: (gltf.materials ?? []).length,
    extensions: [...new Set([...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])])],
    size,
    fillRatio: bboxVolume > 0 ? Math.abs(signedVolume) / bboxVolume : null,
  };
}

function report(info) {
  const mb = (info.bytes / 1048576).toFixed(2);
  const dims = info.size ? info.size.map((v) => v.toFixed(2)).join(" x ") : "不明";
  console.log(`\n${info.path}`);
  console.log(`  glTF v${info.version} / ${mb} MB`);
  console.log(`  頂点 ${info.vertices.toLocaleString()} / 面 ${info.triangles.toLocaleString()}`);
  console.log(`  属性 ${info.attributes.join(", ") || "なし"}`);
  console.log(`  テクスチャ ${info.images} 枚 / マテリアル ${info.materials}`);
  if (info.extensions.length) console.log(`  拡張 ${info.extensions.join(", ")}`);
  console.log(`  bbox ${dims}${info.fillRatio === null ? "" : ` / 充填率 ${(info.fillRatio * 100).toFixed(1)}%`}`);

  const warn = [];
  const hasUv = info.attributes.includes("TEXCOORD_0");
  if (!info.decoded) warn.push("頂点を復号できなかった（外部バッファ参照など）。形状の健全性は未検証");
  if (!hasUv) warn.push("UV(TEXCOORD_0)なし → テクスチャを貼れない。トライプラナー等の手当てが要る");
  if (!info.attributes.includes("NORMAL")) warn.push("法線なし → 取り込み側で再計算しないと陰影がフラットになる");
  if (hasUv && info.images === 0) warn.push("UVはあるがテクスチャ画像が0枚 → 生成時にテクスチャ段が失敗した疑い");
  if (info.bytes > 3 * 1048576) warn.push(`${mb}MB は Web配信には大きい → gltfpack -si での減量を検討`);
  if (info.triangles > 200000) warn.push(`面数 ${info.triangles.toLocaleString()} は多い → 減量推奨`);
  if (info.size) {
    const sorted = [...info.size].sort((a, b) => a - b);
    if (sorted[0] > 0 && sorted[2] / sorted[0] > 12) warn.push("極端に扁平 → 板状に崩れている可能性。参照画像の角度を見直す");
  }
  // 充填率: リング・持ち手・脚などの開放構造は 5〜25%、詰まった塊は 45%以上に出る。
  // 「細い骨組みのはずが塊になった」を早期に捕まえるための指標。
  if (info.fillRatio !== null && info.fillRatio > 0.45) {
    warn.push(`充填率 ${(info.fillRatio * 100).toFixed(0)}% → 開放構造（リング/取っ手/格子）を意図したなら塊に潰れている疑い`);
  }
  if (info.extensions.includes("KHR_texture_transform")) {
    warn.push("KHR_texture_transform あり → 非対応ローダーでは無言でテクスチャがズレる。取り込み側の対応を確認");
  }

  if (warn.length === 0) console.log("  ✅ 問題なし");
  else for (const w of warn) console.log(`  ⚠️  ${w}`);
  return warn.length;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node check-glb.mjs <file.glb> [...]");
  process.exit(2);
}

let warnings = 0;
for (const file of files) {
  try {
    statSync(file);
    warnings += report(summarize(file));
  } catch (error) {
    console.log(`\n${file}\n  ❌ 読めない: ${error.message}`);
    warnings += 1;
  }
}
console.log("");
process.exit(warnings > 0 ? 1 : 0);
