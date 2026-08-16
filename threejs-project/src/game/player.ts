// プレイヤー: イカ的なシンプル形状（primitive 組み合わせ）
import * as THREE from 'three';
import { COLORS, PLAYER } from './config';

export class Player {
  readonly group = new THREE.Group();
  readonly radius = PLAYER.radius;
  x = 0;
  z = 0;
  facing = 0;
  private bobTime = 0;
  private blinkTime = 0;

  constructor(scene: THREE.Scene) {
    const bodyMat = new THREE.MeshToonMaterial({ color: COLORS.playerBody });
    const bellyMat = new THREE.MeshToonMaterial({ color: COLORS.playerBelly });
    const whiteMat = new THREE.MeshToonMaterial({ color: 0xffffff });
    const blackMat = new THREE.MeshToonMaterial({ color: 0x223038 });

    // 胴体: 前後に伸びたイカ型（capsule を横倒し）
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 6, 14), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.scale.set(1, 1, 0.82);
    body.position.y = 0.55;
    this.group.add(body);

    // 頭側の三角ヒレ（イカ耳）
    const finGeo = new THREE.ConeGeometry(0.22, 0.55, 4);
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(finGeo, bodyMat);
      fin.position.set(side * 0.28, 0.72, 0.42);
      fin.rotation.z = side * -0.5;
      fin.rotation.x = 0.5;
      this.group.add(fin);
    }
    // 腹側の淡色パーツ
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bellyMat);
    belly.position.set(0, 0.38, -0.1);
    belly.scale.set(1.1, 0.6, 1.3);
    this.group.add(belly);

    // 目（白 + 黒目）— 進行方向(-z)側
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), whiteMat);
      eye.position.set(side * 0.2, 0.72, -0.42);
      this.group.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), blackMat);
      pupil.position.set(side * 0.2, 0.73, -0.53);
      this.group.add(pupil);
    }

    scene.add(this.group);
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
    this.group.visible = true;
  }
}
