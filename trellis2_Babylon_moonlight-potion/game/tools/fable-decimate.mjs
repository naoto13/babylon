#!/usr/bin/env node
// Fable5 設計のローポリ変換: 曲率適応 QEM 簡約。
//   simplify: node fable-decimate.mjs simplify <in.glb> <out.glb> <targetTris>
//   compare:  node fable-decimate.mjs compare <original.glb> <candidate.glb> [...more]
// 設計:
//   - Garland-Heckbert QEM を基礎に、面積重み付き平面二次形式で辺収縮コストを評価
//   - 特徴保存: 二面角の大きい辺と境界辺に「辺を含む直交平面」の拘束二次形式を注入
//     （釜の縁・レリーフ・脚先のシルエットを一様簡約より強く残す）
//   - 曲率適応: 頂点周りの平均二面角で誤差をスケールし、平坦部から先に潰す
//   - 安全性: 法線反転・退化面を生む収縮は棄却
//   - 出力: スムーズ法線を再計算した最小 glb
// compare は元メッシュ表面から面積比例サンプリングした点群の
// 「元 → 候補メッシュ」片側距離（bbox 対角で正規化）を格子加速で測る。

import { readFileSync, writeFileSync } from "node:fs";

// ---------- glb IO ----------

function parseGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a glb`);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  let bin = null;
  let offset = 20 + jsonLen;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === 0x004e4942) bin = buf.subarray(offset + 8, offset + 8 + len);
    offset += 8 + len;
  }
  return { gltf, bin };
}

function accessorData(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const arrays = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const Arr = arrays[acc.componentType];
  const compBytes = Arr.BYTES_PER_ELEMENT;
  const tight = compCount * compBytes;
  const stride = view.byteStride ?? tight;
  if (stride === tight) {
    return { acc, data: new Arr(bin.buffer, bin.byteOffset + start, acc.count * compCount), compCount };
  }
  // インターリーブ（gltfpack 等）: stride を跨いで密配列へコピー
  const data = new Arr(acc.count * compCount);
  for (let i = 0; i < acc.count; i += 1) {
    const row = new Arr(bin.buffer, bin.byteOffset + start + i * stride, compCount);
    for (let k = 0; k < compCount; k += 1) data[i * compCount + k] = row[k];
  }
  return { acc, data, compCount };
}

function nodeWorldTransforms(gltf) {
  // 平行移動+スケール(+回転)を親から累積し、mesh index -> transform 配列を返す。
  const out = new Map();
  const walk = (nodeIndex, parent) => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) return;
    const t = node.translation ?? [0, 0, 0];
    const s = node.scale ?? [1, 1, 1];
    const r = node.rotation ?? [0, 0, 0, 1];
    const local = { t, s, r };
    const world = composeTransforms(parent, local);
    if (node.mesh !== undefined) {
      if (!out.has(node.mesh)) out.set(node.mesh, []);
      out.get(node.mesh).push(world);
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
  const identity = { t: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0, 1] };
  for (const root of roots) walk(root, identity);
  return out;
}

function rotateVec(q, v) {
  const [x, y, z, w] = q;
  const ux = 2 * (y * v[2] - z * v[1]);
  const uy = 2 * (z * v[0] - x * v[2]);
  const uz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * ux + (y * uz - z * uy), v[1] + w * uy + (z * ux - x * uz), v[2] + w * uz + (x * uy - y * ux)];
}

function composeTransforms(parent, local) {
  const scaled = [local.t[0] * parent.s[0], local.t[1] * parent.s[1], local.t[2] * parent.s[2]];
  const rotated = rotateVec(parent.r, scaled);
  return {
    t: [parent.t[0] + rotated[0], parent.t[1] + rotated[1], parent.t[2] + rotated[2]],
    s: [parent.s[0] * local.s[0], parent.s[1] * local.s[1], parent.s[2] * local.s[2]],
    r: multiplyQuat(parent.r, local.r),
  };
}

function multiplyQuat(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function loadMesh(path) {
  // 全 primitive を world 座標へ変換して1メッシュに結合する。
  const { gltf, bin } = parseGlb(path);
  const transforms = nodeWorldTransforms(gltf);
  const positions = [];
  const indices = [];
  let base = 0;
  (gltf.meshes ?? []).forEach((mesh, meshIndex) => {
    const meshTransforms = transforms.get(meshIndex) ?? [{ t: [0, 0, 0], s: [1, 1, 1], r: [0, 0, 0, 1] }];
    for (const world of meshTransforms) {
      for (const prim of mesh.primitives ?? []) {
        if (prim.attributes?.POSITION === undefined) continue;
        const pos = accessorData(gltf, bin, prim.attributes.POSITION);
        const normalized = pos.acc.normalized === true;
        const maxVal = { 5121: 255, 5123: 65535 }[pos.acc.componentType];
        for (let i = 0; i < pos.acc.count; i += 1) {
          let v = [pos.data[i * 3], pos.data[i * 3 + 1], pos.data[i * 3 + 2]];
          if (normalized && maxVal) v = v.map((x) => x / maxVal);
          v = rotateVec(world.r, [v[0] * world.s[0], v[1] * world.s[1], v[2] * world.s[2]]);
          positions.push(v[0] + world.t[0], v[1] + world.t[1], v[2] + world.t[2]);
        }
        if (prim.indices !== undefined) {
          const idx = accessorData(gltf, bin, prim.indices);
          for (let i = 0; i < idx.acc.count; i += 1) indices.push(idx.data[i] + base);
        } else {
          for (let i = 0; i < pos.acc.count; i += 1) indices.push(i + base);
        }
        base = positions.length / 3;
      }
    }
  });
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices) };
}

function writeGlb(path, positions, indices) {
  const vertexCount = positions.length / 3;
  const normals = smoothNormals(positions, indices);
  const posArr = new Float32Array(positions);
  const nrmArr = new Float32Array(normals);
  const idxArr = new Uint32Array(indices);
  const align = (n) => Math.ceil(n / 4) * 4;
  const posBytes = align(posArr.byteLength);
  const nrmBytes = align(nrmArr.byteLength);
  const idxBytes = align(idxArr.byteLength);
  const bin = Buffer.alloc(posBytes + nrmBytes + idxBytes);
  Buffer.from(posArr.buffer).copy(bin, 0);
  Buffer.from(nrmArr.buffer).copy(bin, posBytes);
  Buffer.from(idxArr.buffer).copy(bin, posBytes + nrmBytes);
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i += 1) for (let k = 0; k < 3; k += 1) {
    mins[k] = Math.min(mins[k], posArr[i * 3 + k]);
    maxs[k] = Math.max(maxs[k], posArr[i * 3 + k]);
  }
  const gltf = {
    asset: { version: "2.0", generator: "fable-decimate" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "fable-simplified" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.72, 0.72, 0.78, 1], metallicFactor: 0.1, roughnessFactor: 0.8 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: "VEC3", min: mins, max: maxs },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: idxArr.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posArr.byteLength },
      { buffer: 0, byteOffset: posBytes, byteLength: nrmArr.byteLength },
      { buffer: 0, byteOffset: posBytes + nrmBytes, byteLength: idxArr.byteLength },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = align(jsonBuf.length);
  const total = 12 + 8 + jsonPad + 8 + bin.length;
  const out = Buffer.alloc(total, 0x20);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPad, 12); out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  out.writeUInt32LE(bin.length, 20 + jsonPad); out.writeUInt32LE(0x004e4942, 24 + jsonPad);
  bin.copy(out, 28 + jsonPad);
  writeFileSync(path, out);
}

function smoothNormals(positions, indices) {
  const normals = new Float64Array(positions.length);
  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]];
    const n = faceNormal(positions, a, b, c, false);
    for (const v of [a, b, c]) { normals[v * 3] += n[0]; normals[v * 3 + 1] += n[1]; normals[v * 3 + 2] += n[2]; }
  }
  for (let v = 0; v < positions.length / 3; v += 1) {
    const len = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= len; normals[v * 3 + 1] /= len; normals[v * 3 + 2] /= len;
  }
  return normals;
}

function faceNormal(positions, a, b, c, normalize = true) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
  const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  if (!normalize) return n;
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

// ---------- QEM 簡約 ----------

const FEATURE_ANGLE_DEG = 38;   // これ以上の二面角の辺は特徴として拘束
const FEATURE_WEIGHT = 24;      // 特徴拘束の強さ（辺長²スケール）
const BOUNDARY_WEIGHT = 120;    // 境界辺はさらに強く保持
const CURVATURE_GAIN = 3.0;     // 曲率適応の効き

function quadricFromPlane(a, b, c, d, w) {
  return [w * a * a, w * a * b, w * a * c, w * a * d, w * b * b, w * b * c, w * b * d, w * c * c, w * c * d, w * d * d];
}

function addQ(target, src) { for (let i = 0; i < 10; i += 1) target[i] += src[i]; }

function quadricError(q, x, y, z) {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
    + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
    + q[7] * z * z + 2 * q[8] * z + q[9];
}

function optimalPosition(q, fallbacks) {
  // ∇err=0 の 3x3 を解く。特異なら候補から最小コストを選ぶ。
  const [a, b, c, , e, f, , h, i2] = [q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]];
  const det = a * (e * h - f * f) - b * (b * h - f * c) + c * (b * f - e * c);
  if (Math.abs(det) > 1e-12) {
    const rx = -q[3], ry = -q[6], rz = -q[8];
    const x = (rx * (e * h - f * f) - b * (ry * h - f * rz) + c * (ry * f - e * rz)) / det;
    const y = (a * (ry * h - rz * f) - rx * (b * h - c * f) + c * (b * rz - ry * c)) / det;
    const z = (a * (e * rz - ry * f) - b * (b * rz - ry * c) + rx * (b * f - e * c)) / det;
    if ([x, y, z].every(Number.isFinite)) return [x, y, z];
  }
  let best = fallbacks[0], bestCost = Infinity;
  for (const p of fallbacks) {
    const cost = quadricError(q, p[0], p[1], p[2]);
    if (cost < bestCost) { bestCost = cost; best = p; }
  }
  return best;
}

function simplify(positions, indices, targetTris) {
  const vertexCount = positions.length / 3;
  const quadrics = Array.from({ length: vertexCount }, () => new Float64Array(10));
  const edgeFaces = new Map(); // "a:b" (a<b) -> {faces: [normal...], length}
  const vertexDihedralSum = new Float64Array(vertexCount);
  const vertexDihedralCount = new Float64Array(vertexCount);

  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (let f = 0; f < indices.length; f += 3) {
    const [a, b, c] = [indices[f], indices[f + 1], indices[f + 2]];
    const rawN = faceNormal(positions, a, b, c, false);
    const area2 = Math.hypot(rawN[0], rawN[1], rawN[2]);
    if (area2 < 1e-14) continue;
    const n = [rawN[0] / area2, rawN[1] / area2, rawN[2] / area2];
    const d = -(n[0] * positions[a * 3] + n[1] * positions[a * 3 + 1] + n[2] * positions[a * 3 + 2]);
    const q = quadricFromPlane(n[0], n[1], n[2], d, area2 * 0.5);
    for (const v of [a, b, c]) addQ(quadrics[v], q);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(u, v);
      if (!edgeFaces.has(key)) edgeFaces.set(key, { normals: [], u: Math.min(u, v), v: Math.max(u, v) });
      edgeFaces.get(key).normals.push(n);
    }
  }

  // 特徴辺・境界辺の拘束と頂点曲率の集計
  const featureThreshold = Math.cos((FEATURE_ANGLE_DEG * Math.PI) / 180);
  for (const info of edgeFaces.values()) {
    const { normals, u, v } = info;
    const ex = positions[v * 3] - positions[u * 3];
    const ey = positions[v * 3 + 1] - positions[u * 3 + 1];
    const ez = positions[v * 3 + 2] - positions[u * 3 + 2];
    const edgeLen2 = ex * ex + ey * ey + ez * ez;
    let constraintWeight = 0;
    let dihedral = 0;
    if (normals.length === 1) {
      constraintWeight = BOUNDARY_WEIGHT;
      dihedral = 1;
    } else if (normals.length >= 2) {
      const dot = normals[0][0] * normals[1][0] + normals[0][1] * normals[1][1] + normals[0][2] * normals[1][2];
      dihedral = 1 - Math.max(-1, Math.min(1, dot));
      if (dot < featureThreshold) constraintWeight = FEATURE_WEIGHT;
    }
    vertexDihedralSum[u] += dihedral; vertexDihedralCount[u] += 1;
    vertexDihedralSum[v] += dihedral; vertexDihedralCount[v] += 1;
    if (constraintWeight > 0) {
      // 辺と平均法線の両方に直交する平面 = 辺を跨ぐ移動を罰する
      const avg = normals.length >= 2
        ? [normals[0][0] + normals[1][0], normals[0][1] + normals[1][1], normals[0][2] + normals[1][2]]
        : normals[0];
      let px = ey * avg[2] - ez * avg[1];
      let py = ez * avg[0] - ex * avg[2];
      let pz = ex * avg[1] - ey * avg[0];
      const plen = Math.hypot(px, py, pz);
      if (plen > 1e-12) {
        px /= plen; py /= plen; pz /= plen;
        const d = -(px * positions[u * 3] + py * positions[u * 3 + 1] + pz * positions[u * 3 + 2]);
        const q = quadricFromPlane(px, py, pz, d, constraintWeight * edgeLen2);
        addQ(quadrics[u], q);
        addQ(quadrics[v], q);
      }
    }
  }

  // 曲率適応: 平坦頂点の誤差を割り引き、曲率の高い頂点を守る
  for (let v = 0; v < vertexCount; v += 1) {
    const mean = vertexDihedralCount[v] ? vertexDihedralSum[v] / vertexDihedralCount[v] : 0;
    const scale = 1 + CURVATURE_GAIN * mean;
    for (let i = 0; i < 10; i += 1) quadrics[v][i] *= scale;
  }

  // 収縮ループ（遅延無効化ヒープ）
  const pos = Float64Array.from(positions);
  const faces = [];
  for (let f = 0; f < indices.length; f += 3) faces.push([indices[f], indices[f + 1], indices[f + 2]]);
  const vertexFaces = Array.from({ length: vertexCount }, () => new Set());
  faces.forEach((face, fi) => face.forEach((v) => vertexFaces[v].add(fi)));
  const parent = new Int32Array(vertexCount).map((_, i) => i);
  const find = (v) => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
  const version = new Uint32Array(vertexCount);

  const heap = [];
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].cost <= heap[i].cost) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].cost < heap[m].cost) m = l; if (r < heap.length && heap[r].cost < heap[m].cost) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };

  const scoreEdge = (u, v) => {
    const q = new Float64Array(10);
    addQ(q, quadrics[u]); addQ(q, quadrics[v]);
    const pu = [pos[u * 3], pos[u * 3 + 1], pos[u * 3 + 2]];
    const pv = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const mid = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2, (pu[2] + pv[2]) / 2];
    const target = optimalPosition(q, [mid, pu, pv]);
    return { u, v, cost: Math.max(0, quadricError(q, target[0], target[1], target[2])), target, vu: version[u], vv: version[v] };
  };

  for (const { u, v } of edgeFaces.values()) push(scoreEdge(u, v));

  let triCount = faces.length;
  const wouldFlip = (moving, keep, target) => {
    for (const fi of vertexFaces[moving]) {
      const face = faces[fi];
      if (!face) continue;
      const mapped = face.map((x) => find(x));
      if (mapped.includes(keep) && mapped.includes(moving)) continue; // 消える面
      const before = faceNormal(pos, mapped[0], mapped[1], mapped[2]);
      const saved = mapped.map((x) => [pos[x * 3], pos[x * 3 + 1], pos[x * 3 + 2]]);
      const idxInFace = mapped.indexOf(moving);
      if (idxInFace === -1) continue;
      const backup = saved[idxInFace];
      pos[moving * 3] = target[0]; pos[moving * 3 + 1] = target[1]; pos[moving * 3 + 2] = target[2];
      const after = faceNormal(pos, mapped[0], mapped[1], mapped[2]);
      pos[moving * 3] = backup[0]; pos[moving * 3 + 1] = backup[1]; pos[moving * 3 + 2] = backup[2];
      if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.05) return true;
    }
    return false;
  };

  // 生存面の正確な再計数。差分計数はエッジケースで乖離するため、
  // 一定間隔でこれを正として終了判定する。
  const recount = () => {
    let alive = 0;
    for (let fi = 0; fi < faces.length; fi += 1) {
      const face = faces[fi];
      if (!face) continue;
      const a = find(face[0]), b = find(face[1]), c = find(face[2]);
      if (a === b || b === c || a === c) { faces[fi] = null; continue; }
      alive += 1;
    }
    return alive;
  };

  let collapses = 0;
  while (heap.length) {
    if (triCount <= targetTris) {
      triCount = recount();
      if (triCount <= targetTris) break;
    }
    const item = pop();
    const u = find(item.u), v = find(item.v);
    if (u === v) continue;
    if (version[u] !== item.vu || version[v] !== item.vv) continue; // 古い見積り
    if (wouldFlip(v, u, item.target) || wouldFlip(u, v, item.target)) {
      // 棄却したエッジは罰則付きで再投入する（破棄するとヒープが枯渇し目標到達前に停止する）
      const retries = (item.retries ?? 0) + 1;
      if (retries <= 4) push({ ...item, cost: item.cost * 3 + 1e-12, retries });
      continue;
    }

    // v を u に併合し、u を target へ移動
    parent[v] = u;
    pos[u * 3] = item.target[0]; pos[u * 3 + 1] = item.target[1]; pos[u * 3 + 2] = item.target[2];
    addQ(quadrics[u], quadrics[v]);
    version[u] += 1; version[v] += 1;

    for (const fi of vertexFaces[v]) vertexFaces[u].add(fi);
    const neighborSet = new Set();
    for (const fi of [...vertexFaces[u]]) {
      const face = faces[fi];
      if (!face) { vertexFaces[u].delete(fi); continue; }
      const mapped = face.map((x) => find(x));
      if (new Set(mapped).size < 3) { faces[fi] = null; vertexFaces[u].delete(fi); triCount -= 1; continue; }
      // 面を現ルートIDへ書き換えて全所属集合を更新する。
      // 旧IDのままだと後続の収縮で死んだ面を検出できず、計数が実態から乖離する。
      faces[fi] = mapped;
      for (const x of mapped) vertexFaces[x].add(fi);
      for (const x of mapped) if (x !== u) neighborSet.add(x);
    }
    for (const n of neighborSet) push(scoreEdge(u, n));
    collapses += 1;
    if ((collapses & 0x0fff) === 0) triCount = recount(); // 4096回ごとに実数へ補正
  }

  // 出力再構築
  const remap = new Map();
  const outPositions = [];
  const outIndices = [];
  for (const face of faces) {
    if (!face) continue;
    const mapped = face.map((x) => find(x));
    if (new Set(mapped).size < 3) continue;
    for (const v of mapped) {
      if (!remap.has(v)) { remap.set(v, outPositions.length / 3); outPositions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      outIndices.push(remap.get(v));
    }
  }
  return { positions: new Float64Array(outPositions), indices: new Uint32Array(outIndices) };
}

// ---------- 幾何誤差計測 ----------

function sampleSurface(positions, indices, count, seedInit) {
  let seed = seedInit >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const faceCount = indices.length / 3;
  const cumArea = new Float64Array(faceCount);
  let total = 0;
  for (let f = 0; f < faceCount; f += 1) {
    const n = faceNormal(positions, indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2], false);
    total += Math.hypot(n[0], n[1], n[2]) / 2;
    cumArea[f] = total;
  }
  const points = new Float64Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = rnd() * total;
    let lo = 0, hi = faceCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumArea[mid] < r) lo = mid + 1; else hi = mid; }
    const [a, b, c] = [indices[lo * 3], indices[lo * 3 + 1], indices[lo * 3 + 2]];
    let s = rnd(), t = rnd();
    if (s + t > 1) { s = 1 - s; t = 1 - t; }
    for (let k = 0; k < 3; k += 1) {
      points[i * 3 + k] = positions[a * 3 + k] + s * (positions[b * 3 + k] - positions[a * 3 + k]) + t * (positions[c * 3 + k] - positions[a * 3 + k]);
    }
  }
  return points;
}

function pointTriangleDistSq(px, py, pz, positions, a, b, c) {
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    const qx = ax + t * abx - px, qy = ay + t * aby - py, qz = az + t * abz - pz;
    return qx * qx + qy * qy + qz * qz;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    const qx = ax + t * acx - px, qy = ay + t * acy - py, qz = az + t * acz - pz;
    return qx * qx + qy * qy + qz * qz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const qx = bx + t * (cx - bx) - px, qy = by + t * (cy - by) - py, qz = bz + t * (cz - bz) - pz;
    return qx * qx + qy * qy + qz * qz;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py, qz = az + abz * v + acz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}

function measureError(refPositions, refIndices, candidate) {
  const { positions, indices } = candidate;
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < refPositions.length / 3; i += 1) for (let k = 0; k < 3; k += 1) {
    mins[k] = Math.min(mins[k], refPositions[i * 3 + k]);
    maxs[k] = Math.max(maxs[k], refPositions[i * 3 + k]);
  }
  const diag = Math.hypot(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]);
  const GRID = 48;
  const cell = [(maxs[0] - mins[0]) / GRID || 1, (maxs[1] - mins[1]) / GRID || 1, (maxs[2] - mins[2]) / GRID || 1];
  const grid = new Map();
  const cellKey = (x, y, z) => ((x * GRID) + y) * GRID + z;
  const clampCell = (v) => Math.max(0, Math.min(GRID - 1, v));
  const faceCount = indices.length / 3;
  for (let f = 0; f < faceCount; f += 1) {
    const vs = [indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) for (let k = 0; k < 3; k += 1) {
      lo[k] = Math.min(lo[k], positions[v * 3 + k]); hi[k] = Math.max(hi[k], positions[v * 3 + k]);
    }
    const c0 = lo.map((v, k) => clampCell(Math.floor((v - mins[k]) / cell[k])));
    const c1 = hi.map((v, k) => clampCell(Math.floor((v - mins[k]) / cell[k])));
    for (let x = c0[0]; x <= c1[0]; x += 1) for (let y = c0[1]; y <= c1[1]; y += 1) for (let z = c0[2]; z <= c1[2]; z += 1) {
      const key = cellKey(x, y, z);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(f);
    }
  }
  const samples = sampleSurface(refPositions, refIndices, 15000, 0x5eed);
  const dists = [];
  for (let i = 0; i < samples.length / 3; i += 1) {
    const px = samples[i * 3], py = samples[i * 3 + 1], pz = samples[i * 3 + 2];
    const cx = clampCell(Math.floor((px - mins[0]) / cell[0]));
    const cy = clampCell(Math.floor((py - mins[1]) / cell[1]));
    const cz = clampCell(Math.floor((pz - mins[2]) / cell[2]));
    let best = Infinity;
    for (let ring = 0; ring < GRID; ring += 1) {
      let found = false;
      for (let x = clampCell(cx - ring); x <= clampCell(cx + ring); x += 1)
        for (let y = clampCell(cy - ring); y <= clampCell(cy + ring); y += 1)
          for (let z = clampCell(cz - ring); z <= clampCell(cz + ring); z += 1) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== ring) continue;
            const bucket = grid.get(cellKey(x, y, z));
            if (!bucket) continue;
            found = true;
            for (const f of bucket) {
              const d = pointTriangleDistSq(px, py, pz, positions, indices[f * 3], indices[f * 3 + 1], indices[f * 3 + 2]);
              if (d < best) best = d;
            }
          }
      if (best < Infinity && ring > 0 && found) break;
      if (best < Infinity && ring >= 2) break;
    }
    dists.push(Math.sqrt(best));
  }
  dists.sort((a, b) => a - b);
  const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
  const rms = Math.sqrt(dists.reduce((s, d) => s + d * d, 0) / dists.length);
  return {
    meanPct: (mean / diag) * 100,
    rmsPct: (rms / diag) * 100,
    p95Pct: (dists[Math.floor(dists.length * 0.95)] / diag) * 100,
    maxPct: (dists[dists.length - 1] / diag) * 100,
  };
}

// ---------- CLI ----------

const [, , command, ...args] = process.argv;
if (command === "simplify") {
  const [input, output, target] = args;
  const t0 = Date.now();
  const mesh = loadMesh(input);
  console.log(`in: ${input} verts=${mesh.positions.length / 3} tris=${mesh.indices.length / 3}`);
  const result = simplify(mesh.positions, mesh.indices, Number(target));
  writeGlb(output, result.positions, result.indices);
  console.log(`out: ${output} verts=${result.positions.length / 3} tris=${result.indices.length / 3} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else if (command === "compare") {
  const [refPath, ...candidates] = args;
  const ref = loadMesh(refPath);
  console.log(`reference: ${refPath} tris=${ref.indices.length / 3}`);
  for (const c of candidates) {
    const mesh = loadMesh(c);
    const m = measureError(ref.positions, ref.indices, mesh);
    console.log(`${c} | tris=${mesh.indices.length / 3} | mean=${m.meanPct.toFixed(4)}% rms=${m.rmsPct.toFixed(4)}% p95=${m.p95Pct.toFixed(4)}% max=${m.maxPct.toFixed(3)}% (bbox対角比)`);
  }
} else {
  console.log("usage: simplify <in.glb> <out.glb> <targetTris> | compare <ref.glb> <candidate.glb> ...");
}
