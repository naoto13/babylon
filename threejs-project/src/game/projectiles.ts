// インク弾プール: InstancedMesh（shot / spinner 共用）+ 放物線ボムプール
import * as THREE from 'three';
import { COLORS, POOL } from './config';

export type ProjectileKind = 'shot' | 'spinner';

export interface ProjectileSlot {
  active: boolean;
  kind: ProjectileKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  age: number;
  damage: number;
  splash: number;
  size: number;
}

export interface BombSlot {
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  flightTime: number;
  damage: number;
  blastRadius: number;
}

const BOMB_POOL = 12;

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

export class Projectiles {
  readonly slots: ProjectileSlot[] = [];
  readonly bombs: BombSlot[] = [];

  private mesh: THREE.InstancedMesh;
  private bombMesh: THREE.InstancedMesh;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(0.2, 8, 8);
    geo.scale(1, 0.85, 1.4); // 進行方向に伸びた雫
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.projectile });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL.projectiles);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    for (let i = 0; i < POOL.projectiles; i++) {
      this.slots.push({
        active: false, kind: 'shot', x: 0, z: 0, vx: 0, vz: 0,
        life: 0, age: 0, damage: 1, splash: 0.7, size: 1,
      });
    }

    // ボム: ひと回り大きい球
    const bombGeo = new THREE.SphereGeometry(0.34, 10, 10);
    bombGeo.scale(1, 0.9, 1);
    const bombMat = new THREE.MeshToonMaterial({ color: COLORS.inkAlt });
    this.bombMesh = new THREE.InstancedMesh(bombGeo, bombMat, BOMB_POOL);
    this.bombMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bombMesh.count = 0;
    this.bombMesh.frustumCulled = false;
    scene.add(this.bombMesh);

    for (let i = 0; i < BOMB_POOL; i++) {
      this.bombs.push({ active: false, x: 0, z: 0, vx: 0, vz: 0, age: 0, flightTime: 1, damage: 1, blastRadius: 2 });
    }
  }

  fire(
    x: number, z: number, dirX: number, dirZ: number,
    speed: number, life: number, damage: number, splash: number,
    kind: ProjectileKind = 'shot', size = 1
  ): void {
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return; // プール満杯時は発射スキップ（最古を潰すより攻撃間隔で自然回復）
    slot.active = true;
    slot.kind = kind;
    slot.x = x;
    slot.z = z;
    slot.vx = dirX * speed;
    slot.vz = dirZ * speed;
    slot.life = life;
    slot.age = 0;
    slot.damage = damage;
    slot.splash = splash;
    slot.size = size;
  }

  /** 放物線ボムを (tx,tz) へ投げる。プール満杯なら false */
  fireBomb(x: number, z: number, tx: number, tz: number, throwSpeed: number, damage: number, blastRadius: number): boolean {
    const slot = this.bombs.find((s) => !s.active);
    if (!slot) return false;
    const dx = tx - x;
    const dz = tz - z;
    const dist = Math.hypot(dx, dz);
    const t = THREE.MathUtils.clamp(dist / Math.max(1, throwSpeed), 0.35, 1.6);
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.vx = dx / t;
    slot.vz = dz / t;
    slot.age = 0;
    slot.flightTime = t;
    slot.damage = damage;
    slot.blastRadius = blastRadius;
    return true;
  }

  /** 移動と寿命。寿命切れは onExpire（着地スプラット用）、ボム着弾は onBombLand へ */
  update(
    dt: number,
    onExpire: (x: number, z: number) => void,
    onBombLand?: (b: BombSlot) => void
  ): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.life -= dt;
      s.age += dt;
      if (s.life <= 0) {
        s.active = false;
        onExpire(s.x, s.z);
      }
    }
    for (const b of this.bombs) {
      if (!b.active) continue;
      b.age += dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      if (b.age >= b.flightTime) {
        b.active = false;
        onBombLand?.(b);
      }
    }
  }

  render(): void {
    let write = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      // 発射直後のスケールポップ（0.12s で 0.45→1、軽いオーバーシュート）
      const t = Math.min(1, s.age / 0.12);
      const pop = 0.45 + 0.55 * (1 - (1 - t) * (1 - t)) + 0.12 * Math.sin(Math.min(s.age, 0.3) / 0.3 * Math.PI);
      const sc = s.size * pop;
      _quat.setFromAxisAngle(_yAxis, Math.atan2(s.vx, s.vz));
      if (s.kind === 'spinner') {
        // スピナー弾は進行軸まわりに高速回転
        _roll.setFromAxisAngle(_zAxis, s.age * 22);
        _quat.multiply(_roll);
      }
      _pos.set(s.x, 0.6, s.z);
      _scale.set(sc, sc, sc);
      _mat.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(write, _mat);
      write++;
    }
    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;

    let bw = 0;
    for (const b of this.bombs) {
      if (!b.active) continue;
      const u = Math.min(1, b.age / b.flightTime);
      // 放物線: 発射高 0.6 → 頂点 → 着地 0.1
      const peak = 1.4 + b.flightTime * 1.6;
      const y = 0.6 * (1 - u) + 0.1 * u + peak * 4 * u * (1 - u);
      // 飛行中はくるくる回る
      _quat.setFromAxisAngle(_yAxis, Math.atan2(b.vx, b.vz));
      _roll.setFromAxisAngle(_zAxis, b.age * 9);
      _quat.multiply(_roll);
      _pos.set(b.x, y, b.z);
      const sc = 1 + 0.2 * Math.sin(u * Math.PI);
      _scale.set(sc, sc, sc);
      _mat.compose(_pos, _quat, _scale);
      this.bombMesh.setMatrixAt(bw, _mat);
      bw++;
    }
    this.bombMesh.count = bw;
    this.bombMesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (const s of this.slots) s.active = false;
    for (const b of this.bombs) b.active = false;
    this.mesh.count = 0;
    this.bombMesh.count = 0;
  }
}
