// ゲーム本体: シーン構築・状態遷移・メインループ
import * as THREE from 'three';
import {
  ARENA_SIZE, ARENA_HALF, PLAY_HALF, CAMERA, COLORS, PLAYER, WEAPON,
  ENEMY_TYPES, spawnInterval, spawnBatch, enemyHpMul, enemySpeedMul, xpForLevel,
} from './config';
import { Input } from './input';
import { InkGround } from './ink';
import { Player } from './player';
import { Enemies } from './enemies';
import { Projectiles } from './projectiles';
import { Gems } from './gems';
import { Hud } from './hud';
import { rollUpgrades, type Mods, type Upgrade, type UpgradeCtx } from './upgrades';

export type GameState = 'playing' | 'levelup' | 'gameover';

export class Game implements UpgradeCtx {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly input = new Input();
  readonly player: Player;
  readonly enemies: Enemies;
  readonly projectiles: Projectiles;
  readonly gems: Gems;
  readonly ink: InkGround;
  readonly hud: Hud;

  state: GameState = 'playing';
  elapsed = 0;
  kills = 0;
  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  hp: number = PLAYER.maxHp;
  maxHp: number = PLAYER.maxHp;
  mods: Mods = {
    fireInterval: WEAPON.fireInterval,
    damage: WEAPON.damage,
    projectileCount: WEAPON.projectileCount,
    moveSpeed: PLAYER.moveSpeed,
    splashRadius: WEAPON.splashRadius,
    magnetRadius: WEAPON.magnetRadius,
  };

  private clock = new THREE.Clock();
  private spawnTimer = 1;
  private fireTimer = 0.4;
  private invincibleTimer = 0;
  private pendingLevelUps = 0;
  private cameraOffset = new THREE.Vector3(0, CAMERA.offsetY, CAMERA.offsetZ);
  private forcedInvincible = false;
  private currentChoices: Upgrade[] = [];
  // FPS 計測
  private frameCount = 0;
  private fpsWindowStart = performance.now();
  fps = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 45, 95);

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.5, 200);
    this.camera.position.copy(this.cameraOffset);
    this.camera.lookAt(0, 0, 0);

    // ライト: 明るくポップに
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e6f0, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(8, 14, 6);
    this.scene.add(dir);

    this.ink = new InkGround(this.scene);
    this.buildWalls();
    this.player = new Player(this.scene);
    this.enemies = new Enemies(this.scene);
    this.projectiles = new Projectiles(this.scene);
    this.gems = new Gems(this.scene);
    this.hud = new Hud(document.getElementById('hud-root')!);

    this.input.attach();
    window.addEventListener('resize', this.onResize);
  }

  private buildWalls(): void {
    const mat = new THREE.MeshToonMaterial({ color: COLORS.wall });
    const h = 1.2;
    const t = 1;
    const geoNS = new THREE.BoxGeometry(ARENA_SIZE + t * 2, h, t);
    const geoEW = new THREE.BoxGeometry(t, h, ARENA_SIZE);
    const walls = [
      { geo: geoNS, x: 0, z: -ARENA_HALF - t / 2 },
      { geo: geoNS, x: 0, z: ARENA_HALF + t / 2 },
      { geo: geoEW, x: -ARENA_HALF - t / 2, z: 0 },
      { geo: geoEW, x: ARENA_HALF + t / 2, z: 0 },
    ];
    for (const w of walls) {
      const mesh = new THREE.Mesh(w.geo, mat);
      mesh.position.set(w.x, h / 2, w.z);
      this.scene.add(mesh);
    }
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private tick = (): void => {
    // タブ非表示復帰などの巨大 dt を抑制
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'playing') this.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.hud.update({
      hp: this.hp, maxHp: this.maxHp, xp: this.xp, xpNext: this.xpNext,
      level: this.level, elapsed: this.elapsed, kills: this.kills, coverage: this.ink.coverage(),
    });
    // FPS は実時間で計測（クランプ済み dt だとスロットリング時に値が古くなる）
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
  };

  private update(dt: number): void {
    this.elapsed += dt;

    // --- プレイヤー移動 ---
    const dir = this.input.dir();
    const invincible = this.invincibleTimer > 0 || this.forcedInvincible;
    this.player.update(dt, dir.x, dir.z, this.mods.moveSpeed, PLAY_HALF, invincible);
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;

    // --- 敵スポーン ---
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnInterval(this.elapsed);
      const batch = spawnBatch(this.elapsed);
      for (let i = 0; i < batch; i++) {
        this.enemies.spawnAround(
          this.player.x, this.player.z,
          Enemies.pickType(this.elapsed),
          enemyHpMul(this.elapsed), enemySpeedMul(this.elapsed)
        );
      }
    }

    // --- 敵更新 + 接触ダメージ ---
    const contact = this.enemies.update(dt, this.player.x, this.player.z, this.player.radius, this.elapsed);
    if (contact > 0 && !invincible) {
      this.hp = Math.max(0, this.hp - contact);
      this.invincibleTimer = PLAYER.invincibleTime;
      if (this.hp <= 0) {
        this.gameOver();
        return;
      }
    }

    // --- 自動発射（最近接敵へ） ---
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && this.enemies.activeCount > 0) {
      this.fireTimer = this.mods.fireInterval;
      this.fireVolley();
    }

    // --- 弾更新 & 衝突 ---
    this.projectiles.update(dt, (x, z) => this.ink.splat(x, z, 0.55));
    for (const p of this.projectiles.slots) {
      if (!p.active) continue;
      const hit = this.enemies.queryHit(p.x, p.z, 0.25);
      if (hit < 0) continue;
      p.active = false;
      this.hitEnemy(hit, p.damage, p.x, p.z, p.splash);
    }
    this.projectiles.render();

    // --- ジェム ---
    const gained = this.gems.update(dt, this.player.x, this.player.z, this.mods.magnetRadius, this.elapsed);
    if (gained > 0) this.gainXp(gained);
  }

  private fireVolley(): void {
    const count = this.mods.projectileCount;
    const targets = this.enemies.nearest(this.player.x, this.player.z, count);
    for (let i = 0; i < count; i++) {
      // ターゲットが足りない分は最近接に角度スプレッドで撃つ
      const t = this.enemies.slots[targets[Math.min(i, targets.length - 1)]];
      let dx = t.x - this.player.x;
      let dz = t.z - this.player.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) {
        dx = Math.sin(this.player.facing + Math.PI);
        dz = Math.cos(this.player.facing + Math.PI);
      } else {
        dx /= len;
        dz /= len;
      }
      if (i >= targets.length) {
        const spread = (i - targets.length + 1) * 0.18 * (i % 2 === 0 ? 1 : -1);
        const cos = Math.cos(spread);
        const sin = Math.sin(spread);
        const nx = dx * cos - dz * sin;
        dz = dx * sin + dz * cos;
        dx = nx;
      }
      this.projectiles.fire(
        this.player.x, this.player.z, dx, dz,
        WEAPON.projectileSpeed, WEAPON.projectileLife, this.mods.damage, this.mods.splashRadius
      );
    }
  }

  private hitEnemy(index: number, damage: number, hx: number, hz: number, splash: number): void {
    // 着弾スプラット（スプラッシュ範囲でサイズ拡大）
    this.ink.splat(hx, hz, 0.8 + splash * 0.4);
    const died = this.enemies.applyDamage(index, damage);
    // スプラッシュ範囲の巻き込みダメージ
    if (splash > 0) {
      for (let i = 0; i < this.enemies.slots.length; i++) {
        if (i === index) continue;
        const s = this.enemies.slots[i];
        if (!s.active) continue;
        if (Math.hypot(s.x - hx, s.z - hz) < splash + s.radius) {
          if (this.enemies.applyDamage(i, damage * 0.5)) this.killEnemy(i);
        }
      }
    }
    if (died) this.killEnemy(index);
  }

  private killEnemy(index: number): void {
    const s = this.enemies.slots[index];
    if (!s.active) return;
    this.kills++;
    this.ink.splat(s.x, s.z, s.splatRadius);
    this.gems.spawn(s.x, s.z, s.xp);
    this.enemies.release(index);
  }

  private gainXp(amount: number): void {
    this.xp += amount;
    let leveled = false;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpForLevel(this.level);
      this.pendingLevelUps++;
      leveled = true;
    }
    if (leveled && this.state === 'playing') this.openLevelUp();
  }

  private openLevelUp(): void {
    if (this.pendingLevelUps <= 0) return;
    this.state = 'levelup';
    this.currentChoices = rollUpgrades(this);
    if (this.currentChoices.length === 0) {
      // 全部打ち止めなら回復だけ与えて続行
      this.heal(0.25);
      this.pendingLevelUps = 0;
      this.state = 'playing';
      return;
    }
    this.hud.showLevelUp(this.currentChoices, (i) => this.chooseUpgrade(i));
  }

  chooseUpgrade(index: number): void {
    if (this.state !== 'levelup') return;
    const u = this.currentChoices[index];
    if (!u) return;
    u.apply(this);
    this.currentChoices = [];
    this.pendingLevelUps--;
    if (this.pendingLevelUps > 0) {
      this.openLevelUp(); // 多段レベルアップは連続で選ばせる
    } else {
      this.state = 'playing';
      this.hud.hideOverlay();
    }
  }

  private gameOver(): void {
    this.state = 'gameover';
    this.hud.showGameOver(
      { elapsed: this.elapsed, kills: this.kills, level: this.level, coverage: this.ink.coverage() },
      () => this.restart()
    );
  }

  restart(): void {
    this.state = 'playing';
    this.elapsed = 0;
    this.kills = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForLevel(1);
    this.hp = this.maxHp;
    this.mods = {
      fireInterval: WEAPON.fireInterval,
      damage: WEAPON.damage,
      projectileCount: WEAPON.projectileCount,
      moveSpeed: PLAYER.moveSpeed,
      splashRadius: WEAPON.splashRadius,
      magnetRadius: WEAPON.magnetRadius,
    };
    this.spawnTimer = 1;
    this.fireTimer = 0.4;
    this.invincibleTimer = 0;
    this.pendingLevelUps = 0;
    this.currentChoices = [];
    this.forcedInvincible = false;
    this.input.overrideDir = null;
    this.player.reset();
    this.enemies.reset();
    this.projectiles.reset();
    this.gems.reset();
    this.ink.reset();
    // levelup 中の restart でもキーハンドラを残留させない
    this.hud.cancelOverlay();
  }

  private updateCamera(dt: number): void {
    // 固定角度・平滑追従（回転なし）
    const k = 1 - Math.exp(-CAMERA.followLerp * dt);
    const tx = this.player.x + this.cameraOffset.x;
    const ty = this.cameraOffset.y;
    const tz = this.player.z + this.cameraOffset.z;
    this.camera.position.x += (tx - this.camera.position.x) * k;
    this.camera.position.y += (ty - this.camera.position.y) * k;
    this.camera.position.z += (tz - this.camera.position.z) * k;
    this.camera.lookAt(this.camera.position.x, 0, this.camera.position.z - this.cameraOffset.z * 1.35);
  }

  // ---- UpgradeCtx ----
  heal(fraction: number): void {
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * fraction);
  }
  hpFraction(): number {
    return this.hp / this.maxHp;
  }

  // ---- デバッグ用フック ----
  debugSpawnEnemy(n = 1, typeId?: string): number {
    let spawned = 0;
    const count = Math.max(1, Math.min(100, Math.floor(Number(n) || 1)));
    const type = ENEMY_TYPES.find((t) => t.id === typeId) ?? null;
    for (let i = 0; i < count; i++) {
      const t = type ?? Enemies.pickType(this.elapsed);
      if (this.enemies.spawnAround(this.player.x, this.player.z, t, enemyHpMul(this.elapsed), enemySpeedMul(this.elapsed))) {
        spawned++;
      }
    }
    return spawned;
  }

  debugLevelUp(): void {
    this.gainXp(this.xpNext - this.xp);
  }

  setInvincible(on: boolean): void {
    this.forcedInvincible = Boolean(on);
  }

  setCameraOffset(y: number, z: number): void {
    if (Number.isFinite(y) && Number.isFinite(z)) {
      this.cameraOffset.set(0, y, z);
    }
  }
}
