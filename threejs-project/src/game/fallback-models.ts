// glb 未配置時のフォールバック形状（ゲーム本体と admin プレビューで共用）
import * as THREE from 'three';
import { COLORS, ENEMY_TYPES } from './config';
import type { AssetKey } from './asset-config';

/** イカ型プレイヤーのプリミティブ形状。原点=接地中心、目は -Z 向き */
export function buildPlayerFallback(): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshToonMaterial({ color: COLORS.playerBody });
  const bellyMat = new THREE.MeshToonMaterial({ color: COLORS.playerBelly });
  const whiteMat = new THREE.MeshToonMaterial({ color: 0xffffff });
  const blackMat = new THREE.MeshToonMaterial({ color: 0x223038 });

  // 胴体: 前後に伸びたイカ型（capsule を横倒し）
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 6, 14), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.82);
  body.position.y = 0.55;
  group.add(body);

  // 頭側の三角ヒレ（イカ耳）
  const finGeo = new THREE.ConeGeometry(0.22, 0.55, 4);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(finGeo, bodyMat);
    fin.position.set(side * 0.28, 0.72, 0.42);
    fin.rotation.z = side * -0.5;
    fin.rotation.x = 0.5;
    group.add(fin);
  }
  // 腹側の淡色パーツ
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bellyMat);
  belly.position.set(0, 0.38, -0.1);
  belly.scale.set(1.1, 0.6, 1.3);
  group.add(belly);

  // 目（白 + 黒目）— 進行方向(-z)側
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), whiteMat);
    eye.position.set(side * 0.2, 0.72, -0.42);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), blackMat);
    pupil.position.set(side * 0.2, 0.73, -0.53);
    group.add(pupil);
  }
  return group;
}

/** 敵タイプのフォールバック（潰れ球 + タイプ色）。admin プレビュー用 */
export function buildEnemyFallback(key: Exclude<AssetKey, 'player'>): THREE.Group {
  const type = ENEMY_TYPES.find((t) => t.id === key) ?? ENEMY_TYPES[0];
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.55, 12, 10);
  geo.scale(1, 0.8, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: type.color }));
  mesh.position.y = 0.45 * type.scale;
  mesh.scale.setScalar(type.scale);
  group.add(mesh);
  return group;
}

export function buildFallbackModel(key: AssetKey): THREE.Group {
  return key === 'player' ? buildPlayerFallback() : buildEnemyFallback(key);
}
