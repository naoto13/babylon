// インク弾プール: InstancedMesh
import * as THREE from 'three';
import { COLORS, POOL } from './config';

export interface ProjectileSlot {
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  damage: number;
  splash: number;
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

export class Projectiles {
  readonly slots: ProjectileSlot[] = [];

  private mesh: THREE.InstancedMesh;

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
      this.slots.push({ active: false, x: 0, z: 0, vx: 0, vz: 0, life: 0, damage: 1, splash: 0.7 });
    }
  }

  fire(x: number, z: number, dirX: number, dirZ: number, speed: number, life: number, damage: number, splash: number): void {
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return; // プール満杯時は発射スキップ（最古を潰すより攻撃間隔で自然回復）
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.vx = dirX * speed;
    slot.vz = dirZ * speed;
    slot.life = life;
    slot.damage = damage;
    slot.splash = splash;
  }

  /** 移動と寿命。寿命切れは onExpire（着地スプラット用）へ */
  update(dt: number, onExpire: (x: number, z: number) => void): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        onExpire(s.x, s.z);
      }
    }
  }

  render(): void {
    let write = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      _pos.set(s.x, 0.6, s.z);
      _quat.setFromAxisAngle(_pos.set(0, 1, 0).normalize(), Math.atan2(s.vx, s.vz));
      _pos.set(s.x, 0.6, s.z);
      _mat.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(write, _mat);
      write++;
    }
    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    for (const s of this.slots) s.active = false;
    this.mesh.count = 0;
  }
}
