// プレイヤー: glb があれば差し替え、無ければイカ的なプリミティブ形状
import * as THREE from 'three';
import { PLAYER } from './config';
import { buildPlayerFallback } from './fallback-models';
import { disposeOwnedObjectResources } from './assets';

const PLAYER_GLB_HEIGHT = 1.1; // scale=1 の glb の目標高さ（プリミティブと釣り合う値）

/** full = 姿勢補正(rotY/offsetY)も適用（glb 用）。scale-only = 正規化済みモデル用 */
export type TuningMode = 'full' | 'scale-only';

export class Player {
  readonly group = new THREE.Group();
  readonly radius = PLAYER.radius;
  x = 0;
  z = 0;
  facing = 0;
  private bobTime = 0;
  private blinkTime = 0;
  private lean = 0; // 移動時の前傾（スプリング風平滑）
  private primitive: THREE.Group;
  private modelWrapper: THREE.Group | null = null;
  private tuningMode: TuningMode = 'full';
  private tuning = { scale: 1, rotY: 0, offsetY: 0 };

  constructor(scene: THREE.Scene) {
    this.primitive = buildPlayerFallback();
    this.group.add(this.primitive);
    // yaw(Y) → pitch(X) の順で適用し、向いている方向へ前傾できるようにする
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
  }

  /** モデルへ差し替え（null でプリミティブに戻す）。mode='scale-only' は正規化済みモデル用 */
  setModel(object: THREE.Object3D | null, mode: TuningMode = 'full'): void {
    if (this.modelWrapper) {
      disposeOwnedObjectResources(this.modelWrapper);
      this.group.remove(this.modelWrapper);
      this.modelWrapper = null;
    }
    this.tuningMode = mode;
    if (object) {
      const wrapper = new THREE.Group();
      wrapper.add(object);
      this.modelWrapper = wrapper;
      this.group.add(wrapper);
      this.primitive.visible = false;
      this.applyTuning();
    } else {
      this.primitive.visible = true;
      this.applyTuning();
    }
  }

  /** アセット調整（rotY はラジアン）。glb 未ロードでも保持して後で適用 */
  setTuning(scale: number, rotY: number, offsetY: number): void {
    this.tuning = { scale, rotY, offsetY };
    this.applyTuning();
  }

  private applyTuning(): void {
    if (this.modelWrapper) {
      const full = this.tuningMode === 'full';
      const s = PLAYER_GLB_HEIGHT * this.tuning.scale;
      this.modelWrapper.scale.setScalar(s);
      // 姿勢補正(rotY/offsetY)は glb のみ。正規化済みモデル(手続き)には掛けない
      this.modelWrapper.rotation.y = full ? this.tuning.rotY : 0;
      this.modelWrapper.position.y = full ? this.tuning.offsetY : 0;
    }
    // フォールバックは -Z 正面・接地済みの規約: scale のみ反映
    this.primitive.scale.setScalar(this.tuning.scale);
    this.primitive.rotation.y = 0;
    this.primitive.position.y = 0;
  }

  update(dt: number, dirX: number, dirZ: number, speed: number, halfBound: number, invincible: boolean): void {
    const moving = dirX !== 0 || dirZ !== 0;
    if (moving) {
      this.x = THREE.MathUtils.clamp(this.x + dirX * speed * dt, -halfBound, halfBound);
      this.z = THREE.MathUtils.clamp(this.z + dirZ * speed * dt, -halfBound, halfBound);
      // 進行方向へスムーズに旋回（目のある -z 面を向ける）
      const target = Math.atan2(-dirX, -dirZ);
      let diff = target - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 14);
      this.bobTime += dt;
    }
    this.group.position.set(this.x, Math.abs(Math.sin(this.bobTime * 9)) * (moving ? 0.12 : 0), this.z);
    this.group.rotation.y = this.facing;
    // 移動中は進行方向へ軽く前傾（クリティカルダンピング風の平滑）
    const leanTarget = moving ? -0.14 : 0;
    this.lean += (leanTarget - this.lean) * Math.min(1, dt * 10);
    this.group.rotation.x = this.lean;

    // 無敵時間中は点滅
    if (invincible) {
      this.blinkTime += dt;
      this.group.visible = Math.floor(this.blinkTime * 12) % 2 === 0;
    } else {
      this.blinkTime = 0;
      this.group.visible = true;
    }
  }

  reset(): void {
    this.x = 0;
    this.z = 0;
    this.facing = 0;
    this.lean = 0;
    this.group.visible = true;
  }
}
