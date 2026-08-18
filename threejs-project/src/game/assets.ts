// GLB アセットローダー: /assets/models/<file>.glb を読み、失敗したら null
// （呼び出し側がプリミティブ表示へフォールバックする。1体の失敗でゲームは死なない）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_KEYS, type AssetConfig, type AssetKey } from './asset-config';

export interface LoadedModel {
  /** 正規化済み: 原点=接地中心、高さ 1 に収まるラッパー */
  object: THREE.Group;
  /** InstancedMesh 流用のため正規化変換を焼き込んだ最初のメッシュの geometry（無ければ null） */
  geometry: THREE.BufferGeometry | null;
  material: THREE.Material | null;
}

const MODEL_BASE_URL = '/assets/models/';

/**
 * glb をロードして「接地中心原点・高さ 1」に正規化する。
 * ファイル欠落・パース失敗・空メッシュはすべて null（フォールバック継続）。
 */
export async function loadModel(file: string): Promise<LoadedModel | null> {
  if (!/^[\w-]+$/.test(file)) return null;
  try {
    const gltf = await new GLTFLoader().loadAsync(`${MODEL_BASE_URL}${file}.glb`);
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) return null;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const height = size.y;
    if (!Number.isFinite(height) || height <= 1e-6) return null;
    const s = 1 / height;

    const object = new THREE.Group();
    object.add(scene);
    scene.scale.setScalar(s);
    scene.position.set(-center.x * s, -box.min.y * s, -center.z * s);

    // InstancedMesh 用: 最初の Mesh を探して正規化変換を geometry に焼き込む
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | null = null;
    let firstMesh: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (!firstMesh && (o as THREE.Mesh).isMesh) firstMesh = o as THREE.Mesh;
    });
    if (firstMesh) {
      const mesh: THREE.Mesh = firstMesh;
      try {
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld); // glb 内のローカル変換
        // 正規化（接地中心・高さ1）を焼き込む
        geo.translate(-center.x, -box.min.y, -center.z);
        geo.scale(s, s, s);
        geo.computeBoundingSphere();
        geometry = geo;
        material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      } catch {
        geometry = null;
        material = null;
      }
    }
    return { object, geometry, material };
  } catch {
    return null;
  }
}

/**
 * 正規化済み geometry に rotX（度）をベイクする。
 * 回転後の bbox で再センタリング・接地(minY=0)・高さ1 に再正規化するため床にめり込まない。
 * rotX=0 は元 geometry をそのまま返す（clone コスト回避）。
 */
export function rotatedGeometry(base: THREE.BufferGeometry, rotXdeg: number): THREE.BufferGeometry {
  if (!rotXdeg) return base;
  const geo = base.clone();
  geo.rotateX((rotXdeg * Math.PI) / 180);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb && !bb.isEmpty()) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bb.getSize(size);
    bb.getCenter(center);
    geo.translate(-center.x, -bb.min.y, -center.z);
    if (size.y > 1e-6) {
      const k = 1 / size.y;
      geo.scale(k, k, k);
    }
  }
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 正規化済み Object3D を rotX（度）で起こし、回転後 bbox で接地・高さ1 に再正規化した
 * ラッパーを返す。source は clone するので LoadedModel 本体は汚染しない。
 */
export function rotatedObject(source: THREE.Object3D, rotXdeg: number): THREE.Group {
  const obj = source.clone(true);
  const pivot = new THREE.Group();
  pivot.add(obj);
  pivot.rotation.x = (rotXdeg * Math.PI) / 180;
  const root = new THREE.Group();
  root.add(pivot);
  pivot.updateMatrixWorld(true); // 親なし → world = local
  const box = new THREE.Box3().setFromObject(pivot);
  if (!box.isEmpty()) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    pivot.position.set(-center.x, -box.min.y, -center.z);
    if (size.y > 1e-6) root.scale.setScalar(1 / size.y);
  }
  return root;
}

export type LoadedModels = Partial<Record<AssetKey, LoadedModel>>;

/** 全アセットを並列ロード。失敗したものは結果に含めない */
export async function loadAllModels(cfg: AssetConfig): Promise<LoadedModels> {
  const out: LoadedModels = {};
  await Promise.all(
    ASSET_KEYS.map(async (key) => {
      const m = await loadModel(cfg.assets[key].file);
      if (m) out[key] = m;
    })
  );
  return out;
}
