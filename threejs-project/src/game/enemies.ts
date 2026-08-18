// 敵プール: InstancedMesh + 固定長スロット配列
// glb がロードできたタイプは per-type InstancedMesh へ振り分け、他はフォールバック形状
import * as THREE from 'three';
import { ENEMY_TYPES, EnemyType, POOL, PLAY_HALF } from './config';

export interface EnemySlot {
  active: boolean;
  typeId: string;
  x: number;
  z: number;
  hp: number;
  speed: number;
  radius: number;
  scale: number;
  color: THREE.Color;
  contactDamage: number;
  xp: number;
  phase: number; // ぷるぷるアニメ位相
  splatRadius: number;
  hitT: number; // 被弾からの経過秒（-1 = 未被弾）
}

/** アセット調整（rotY はラジアン） */
export interface TypeTuning {
  scale: number;
  rotY: number;
  offsetY: number;
}

const HIT_SQUASH_TIME = 0.28;
const GLB_BASE_HEIGHT = 0.95; // scale=1 の敵 glb の目標高さ（フォールバック球と釣り合う値）

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

export class Enemies {
  readonly slots: EnemySlot[] = [];
  private mesh: THREE.InstancedMesh;
  private scene: THREE.Scene;
  private typeMeshes = new Map<string, THREE.InstancedMesh>();
  private typeTuning = new Map<string, TypeTuning>();
  activeCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // インクの塊っぽい潰れた球
    const geo = new THREE.SphereGeometry(0.55, 12, 10);
    geo.scale(1, 0.8, 1);
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL.enemies);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    for (let i = 0; i < POOL.enemies; i++) {
      this.slots.push({
        active: false, typeId: 'blob', x: 0, z: 0, hp: 1, speed: 1, radius: 0.5, scale: 1,
        color: new THREE.Color(), contactDamage: 10, xp: 1, phase: 0, splatRadius: 1, hitT: -1,
      });
    }
  }

  /** glb 由来の geometry/material をこのタイプの描画に使う（呼ばなければフォールバック継続） */
  setTypeModel(typeId: string, geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const prev = this.typeMeshes.get(typeId);
    if (prev) {
      this.scene.remove(prev);
      prev.dispose();
    }
    const mesh = new THREE.InstancedMesh(geometry, material, POOL.enemies);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.typeMeshes.set(typeId, mesh);
  }

  /** glb 描画をやめてフォールバック形状へ戻す（source 切替用） */
  removeTypeModel(typeId: string): void {
    const prev = this.typeMeshes.get(typeId);
    if (prev) {
      this.scene.remove(prev);
      prev.dispose();
      this.typeMeshes.delete(typeId);
    }
  }

  /** admin / config からのタイプ別チューニング反映 */
  setTypeTuning(typeId: string, tuning: TypeTuning): void {
    this.typeTuning.set(typeId, tuning);
  }

  /** プレイヤー位置を中心に画面外周リングへスポーン。プール満杯なら false */
  spawnAround(px: number, pz: number, type: EnemyType, hpMul: number, speedMul: number): boolean {
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return false;
    // 6 方向試して、クランプ後もプレイヤーから十分離れる位置を選ぶ
    const MIN_SPAWN_DIST = 10;
    let bestX = 0;
    let bestZ = 0;
    let bestDist = -1;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 6;
      const x = THREE.MathUtils.clamp(px + Math.cos(a) * r, -PLAY_HALF, PLAY_HALF);
      const z = THREE.MathUtils.clamp(pz + Math.sin(a) * r, -PLAY_HALF, PLAY_HALF);
      const d = Math.hypot(x - px, z - pz);
      if (d < MIN_SPAWN_DIST) continue; // 角付近でクランプされ近すぎる候補は棄却
      if (d > bestDist) {
        bestDist = d;
        bestX = x;
        bestZ = z;
      }
      if (d > 14) break;
    }
    if (bestDist < MIN_SPAWN_DIST) {
      // 全候補失敗（プレイヤーが角付近）: アリーナ中央向きにリング再投影して最低距離を保証。
      // 中央向きなら p_i と逆符号方向に進むため、投影点は必ず ±PLAY_HALF 内に収まる。
      const len = Math.hypot(px, pz);
      const ringR = 26;
      const dirX = len > 1e-4 ? -px / len : 1;
      const dirZ = len > 1e-4 ? -pz / len : 0;
      bestX = px + dirX * ringR;
      bestZ = pz + dirZ * ringR;
    }
    slot.active = true;
    slot.typeId = type.id;
    slot.x = bestX;
    slot.z = bestZ;
    slot.hp = type.hp * hpMul;
    slot.speed = type.speed * speedMul * (0.9 + Math.random() * 0.2);
    slot.radius = type.radius;
    slot.scale = type.scale;
    slot.color.setHex(type.color);
    slot.contactDamage = type.contactDamage;
    slot.xp = type.xp;
    slot.phase = Math.random() * Math.PI * 2;
    slot.splatRadius = 0.9 + type.scale * 0.5;
    slot.hitT = -1;
    this.activeCount++;
    return true;
  }

  /** 経過時間に応じた重み付きランダムでタイプを選ぶ */
  static pickType(elapsed: number): EnemyType {
    const avail = ENEMY_TYPES.filter((t) => elapsed >= t.appearAt);
    return avail[(Math.random() * avail.length) | 0];
  }

  /** 移動 + 描画行列更新。プレイヤー接触ダメージ（最大値）を返す */
  update(dt: number, px: number, pz: number, playerRadius: number, time: number): number {
    let contactDamage = 0;
    let fallbackWrite = 0;
    const typeWrites = new Map<string, number>();

    for (const s of this.slots) {
      if (!s.active) continue;
      const dx = px - s.x;
      const dz = pz - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        s.x += (dx / dist) * s.speed * dt;
        s.z += (dz / dist) * s.speed * dt;
      }
      if (dist < s.radius + playerRadius) {
        contactDamage = Math.max(contactDamage, s.contactDamage);
      }
      // 被弾スカッシュ&ストレッチ（減衰）
      let hitY = 1;
      let hitXZ = 1;
      if (s.hitT >= 0) {
        s.hitT += dt;
        if (s.hitT > HIT_SQUASH_TIME) {
          s.hitT = -1;
        } else {
          const k = 1 - s.hitT / HIT_SQUASH_TIME;
          const kk = k * k;
          hitY = 1 - 0.45 * kk;
          hitXZ = 1 + 0.32 * kk;
        }
      }
      // ぷるぷる squash & stretch
      const squash = 1 + Math.sin(time * 8 + s.phase) * 0.12;
      const yaw = Math.atan2(dx, dz);

      const glbMesh = this.typeMeshes.get(s.typeId);
      const tun = this.typeTuning.get(s.typeId);
      const mul = tun?.scale ?? 1;
      if (glbMesh) {
        // 姿勢補正(rotY/offsetY)は glb のみ
        const h = GLB_BASE_HEIGHT * s.scale * mul;
        _pos.set(s.x, tun?.offsetY ?? 0, s.z);
        _quat.setFromAxisAngle(_yAxis, yaw + (tun?.rotY ?? 0));
        const xz = h * ((2 - squash) * 0.55 + 0.45) * hitXZ;
        _scale.set(xz, h * squash * hitY, xz);
        _mat.compose(_pos, _quat, _scale);
        const w = typeWrites.get(s.typeId) ?? 0;
        glbMesh.setMatrixAt(w, _mat);
        typeWrites.set(s.typeId, w + 1);
      } else {
        // フォールバックは正規姿勢済み: scale のみ反映
        _pos.set(s.x, 0.45 * s.scale * mul, s.z);
        _quat.setFromAxisAngle(_yAxis, yaw);
        _scale.set(
          (s.scale * (2 - squash) * 0.55 + s.scale * 0.45) * hitXZ * mul,
          s.scale * squash * hitY * mul,
          s.scale * hitXZ * mul
        );
        _mat.compose(_pos, _quat, _scale);
        this.mesh.setMatrixAt(fallbackWrite, _mat);
        this.mesh.setColorAt(fallbackWrite, s.color);
        fallbackWrite++;
      }
    }

    this.mesh.count = fallbackWrite;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const [typeId, mesh] of this.typeMeshes) {
      mesh.count = typeWrites.get(typeId) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    return contactDamage;
  }

  /** (x,z) に当たる敵スロットの index（なければ -1） */
  queryHit(x: number, z: number, extraRadius: number): number {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < s.radius + extraRadius) return i;
    }
    return -1;
  }

  /** ダメージ適用。死んだら true（スロットは呼び出し側が kill 情報を読んでから解放） */
  applyDamage(index: number, dmg: number): boolean {
    const s = this.slots[index];
    if (!s.active) return false;
    s.hp -= dmg;
    s.hitT = 0; // 被弾スカッシュ開始
    return s.hp <= 0;
  }

  release(index: number): void {
    if (this.slots[index].active) {
      this.slots[index].active = false;
      this.activeCount--;
    }
  }

  /** 最も近い敵を最大 k 体（近い順の index 配列） */
  nearest(x: number, z: number, k: number): number[] {
    const found: { i: number; d: number }[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      found.push({ i, d: Math.hypot(s.x - x, s.z - z) });
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, k).map((f) => f.i);
  }

  reset(): void {
    for (const s of this.slots) s.active = false;
    this.activeCount = 0;
    this.mesh.count = 0;
    for (const mesh of this.typeMeshes.values()) mesh.count = 0;
  }
}
