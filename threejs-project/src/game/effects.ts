// プロシージャルなワンショット演出プール: 撃破ポップ / 爆発リング
// tween ライブラリ不使用（ease 関数のみ）
import * as THREE from 'three';

interface FxSlot {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  baseScale: number;
  kind: 'pop' | 'ring';
}

const POP_COUNT = 20;
const RING_COUNT = 8;

/** easeOutCubic */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export class Effects {
  private slots: FxSlot[] = [];

  constructor(scene: THREE.Scene) {
    const popGeo = new THREE.SphereGeometry(0.5, 10, 8);
    popGeo.scale(1, 0.75, 1);
    const ringGeo = new THREE.RingGeometry(0.72, 1, 28);
    ringGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < POP_COUNT + RING_COUNT; i++) {
      const kind: FxSlot['kind'] = i < POP_COUNT ? 'pop' : 'ring';
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(kind === 'pop' ? popGeo : ringGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({ active: false, mesh, mat, age: 0, life: 0.35, baseScale: 1, kind });
    }
  }

  private acquire(kind: FxSlot['kind']): FxSlot | null {
    let oldest: FxSlot | null = null;
    for (const s of this.slots) {
      if (s.kind !== kind) continue;
      if (!s.active) return s;
      if (!oldest || s.age > oldest.age) oldest = s;
    }
    return oldest; // 満杯なら最古を再利用
  }

  /** 敵撃破ポップ: 色付きの塊がふくらんで消える */
  pop(x: number, z: number, color: THREE.Color, size: number): void {
    const s = this.acquire('pop');
    if (!s) return;
    s.active = true;
    s.age = 0;
    s.life = 0.32;
    s.baseScale = size;
    s.mat.color.copy(color);
    s.mesh.position.set(x, 0.35 * size, z);
    s.mesh.rotation.y = Math.random() * Math.PI * 2;
    s.mesh.visible = true;
  }

  /** ボム爆発リング: 地面を走る輪 */
  ring(x: number, z: number, radius: number, colorHex: number): void {
    const s = this.acquire('ring');
    if (!s) return;
    s.active = true;
    s.age = 0;
    s.life = 0.45;
    s.baseScale = radius;
    s.mat.color.setHex(colorHex);
    s.mesh.position.set(x, 0.05, z);
    s.mesh.visible = true;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      const t = Math.min(1, s.age / s.life);
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const e = easeOut(t);
      if (s.kind === 'pop') {
        // ふくらみながらフェード（スケールポップ）
        const sc = s.baseScale * (0.5 + 0.9 * e);
        s.mesh.scale.set(sc, sc * (1 - 0.4 * e), sc);
        s.mat.opacity = 0.85 * (1 - t);
      } else {
        const sc = Math.max(0.01, s.baseScale * (0.25 + 0.75 * e));
        s.mesh.scale.set(sc, 1, sc);
        s.mat.opacity = 0.7 * (1 - t * t);
      }
    }
  }

  reset(): void {
    for (const s of this.slots) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
}
