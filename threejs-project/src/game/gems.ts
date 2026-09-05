// XP ジェムプール: InstancedMesh。近づくと吸引。
import * as THREE from 'three';
import { COLORS, POOL } from './config';

export interface GemSlot {
  active: boolean;
  x: number;
  z: number;
  value: number;
  phase: number;
  pull: number; // 吸引中の速度（加速する）
  age: number;
}

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3(1, 1, 1);

export class Gems {
  readonly slots: GemSlot[] = [];
  private mesh: THREE.InstancedMesh;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.OctahedronGeometry(0.28);
    const mat = new THREE.MeshToonMaterial({ color: COLORS.gem, emissive: 0x3a5a10 });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL.gems);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    for (let i = 0; i < POOL.gems; i++) {
      this.slots.push({ active: false, x: 0, z: 0, value: 1, phase: 0, pull: 0, age: 0 });
    }
  }

  spawn(x: number, z: number, value: number): void {
    // 満杯なら最古スロットを再利用し、旧ジェムの XP は新スロットに合算（XP を失わせない）
    let slot = this.slots.find((s) => !s.active);
    let carriedValue = 0;
    if (!slot) {
      slot = this.slots.reduce((a, b) => (a.age >= b.age ? a : b));
      carriedValue = slot.value;
    }
    slot.active = true;
    slot.x = x + (Math.random() - 0.5) * 0.6;
    slot.z = z + (Math.random() - 0.5) * 0.6;
    slot.value = value + carriedValue;
    slot.phase = Math.random() * Math.PI * 2;
    slot.pull = 0;
    slot.age = 0;
  }

  /** 吸引と回収。回収した合計 XP を返す */
  update(dt: number, px: number, pz: number, magnetRadius: number, time: number): number {
    let collected = 0;
    let write = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      const dx = px - s.x;
      const dz = pz - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist < magnetRadius) {
        s.pull = Math.min(16, s.pull + 40 * dt);
        if (dist > 1e-4) {
          s.x += (dx / dist) * s.pull * dt;
          s.z += (dz / dist) * s.pull * dt;
        }
      } else {
        s.pull = 0;
      }
      if (dist < 0.75) {
        s.active = false;
        collected += s.value;
        continue;
      }
      _pos.set(s.x, 0.4 + Math.sin(time * 3 + s.phase) * 0.1, s.z);
      _euler.set(0, time * 2 + s.phase, 0);
      _quat.setFromEuler(_euler);
      _mat.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(write, _mat);
      write++;
    }
    this.mesh.count = write;
    this.mesh.instanceMatrix.needsUpdate = true;
    return collected;
  }

  reset(): void {
    for (const s of this.slots) s.active = false;
    this.mesh.count = 0;
  }
}
