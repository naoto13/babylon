// ゲーム本体: シーン構築・状態遷移・メインループ
import * as THREE from 'three';
import {
  ARENA_SIZE, ARENA_HALF, PLAY_HALF, CAMERA, COLORS, PLAYER, WEAPON,
  ENEMY_TYPES, spawnInterval, spawnBatch, enemyHpMul, enemySpeedMul, xpForLevel,
} from './config';
import {
  DEFAULT_ASSET_CONFIG, type AssetConfig, type AssetKey, type AssetSource,
} from './asset-config';
import { rotatedGeometry, rotatedObject, type LoadedModels } from './assets';
import { PROC_BUILDERS } from './procedural';
import { Input } from './input';
import { InkGround } from './ink';
import { Player } from './player';
import { Enemies } from './enemies';
import { Projectiles, type BombSlot } from './projectiles';
import { Gems } from './gems';
import { Effects } from './effects';
import { Hud } from './hud';
import {
  rollUpgrades, findUpgrade,
  type Mods, type UpgradeChoice, type UpgradeCtx, type WeaponLevels,
} from './upgrades';

export type GameState = 'playing' | 'levelup' | 'gameover';

const DEG2RAD = Math.PI / 180;

export class Game implements UpgradeCtx {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly input = new Input();
  readonly player: Player;
  readonly enemies: Enemies;
  readonly projectiles: Projectiles;
  readonly gems: Gems;
  readonly effects: Effects;
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
  assetCfg: AssetConfig;
  mods: Mods;
  weapons: WeaponLevels = { bomb: 0, spinner: 0 };
  /** 反映済みモデル（デバッグ/検証用） */
  modelStatus: Record<AssetKey, boolean> = { player: false, blob: false, dart: false, tank: false };
  /** 実効ソース（設定と資産の有無から解決した結果。デバッグ/検証用） */
  activeSources: Record<AssetKey, AssetSource> = { player: 'fallback', blob: 'fallback', dart: 'fallback', tank: 'fallback' };
  private loadedModels: LoadedModels = {};
  /** 適用済み rotX（変化したアセットのみ再ベイクする） */
  private appliedRotX: Partial<Record<AssetKey, number>> = {};
  /** 適用済み実効ソース */
  private appliedSource: Partial<Record<AssetKey, AssetSource>> = {};
  /** rotX ベイクで生成した geometry（差し替え時に dispose する） */
  private bakedGeos: Partial<Record<AssetKey, THREE.BufferGeometry>> = {};

  private clock = new THREE.Clock();
  private spawnTimer = 1;
  private fireTimer = 0.4;
  private bombTimer = 1;
  private spinnerTimer = 0.3;
  private invincibleTimer = 0;
  private pendingLevelUps = 0;
  private cameraOffset = new THREE.Vector3(0, CAMERA.offsetY, CAMERA.offsetZ);
  private forcedInvincible = false;
  private currentChoices: UpgradeChoice[] = [];
  /** config 変更時に基礎値へ再適用するための恒久アップグレード履歴 */
  private upgradeLog: string[] = [];
  // FPS 計測
  private frameCount = 0;
  private fpsWindowStart = performance.now();
  fps = 0;

  constructor(canvas: HTMLCanvasElement, assetCfg: AssetConfig = DEFAULT_ASSET_CONFIG) {
    this.assetCfg = assetCfg;
    this.mods = this.baseMods();
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
    this.effects = new Effects(this.scene);
    this.hud = new Hud(document.getElementById('hud-root')!);

    this.applyTuning();
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

  // ---- アセット設定 ----

  /** config の武器基礎値から初期 mods を作る */
  private baseMods(): Mods {
    const shot = this.assetCfg.weapons.shot;
    return {
      fireInterval: shot.fireInterval,
      damage: shot.damage,
      projectileCount: WEAPON.projectileCount,
      moveSpeed: PLAYER.moveSpeed,
      splashRadius: shot.splashRadius,
      magnetRadius: WEAPON.magnetRadius,
    };
  }

  /** 基礎値を差し替えて恒久アップグレードを再適用（admin からの変更に即応する） */
  private rederiveMods(): void {
    this.mods = this.baseMods();
    this.weapons = { bomb: 0, spinner: 0 };
    for (const id of this.upgradeLog) {
      findUpgrade(id)?.apply(this);
    }
  }

  /** モデル位置・スケール調整を player/enemies へ反映 */
  private applyTuning(): void {
    const a = this.assetCfg.assets;
    this.player.setTuning(a.player.scale, a.player.rotY * DEG2RAD, a.player.offsetY);
    for (const type of ENEMY_TYPES) {
      const t = a[type.id];
      this.enemies.setTypeTuning(type.id, { scale: t.scale, rotY: t.rotY * DEG2RAD, offsetY: t.offsetY });
    }
  }

  /** admin タブからの localStorage 変更・起動時の設定読み込みを反映 */
  applyConfig(cfg: AssetConfig): void {
    this.assetCfg = cfg;
    this.rederiveMods();
    this.applyTuning();
    this.refreshModelBakes(false);
  }

  /** glb ロード結果を反映（失敗したアセットはフォールバック継続） */
  applyModels(models: LoadedModels): void {
    this.loadedModels = models;
    this.refreshModelBakes(true);
  }

  /** 設定 source と資産の有無から実効ソースを解決（無いものは fallback へ縮退） */
  private resolveSource(key: AssetKey): AssetSource {
    const want = this.assetCfg.assets[key].source;
    if (want === 'glb') {
      const m = this.loadedModels[key];
      const usable = key === 'player' ? !!m : !!(m && m.geometry && m.material);
      return usable ? 'glb' : 'fallback';
    }
    if (want === 'procedural') return PROC_BUILDERS[key] ? 'procedural' : 'fallback';
    return 'fallback';
  }

  /** source / rotX を正規化済みモデルへ反映（変化時のみ再ベイク） */
  private refreshModelBakes(force: boolean): void {
    let enemyMeshChanged = false;
    // ---- player: Object3D 差し替え ----
    const src = this.resolveSource('player');
    const playerRotX = this.assetCfg.assets.player.rotX;
    if (force || this.appliedSource.player !== src || (src === 'glb' && this.appliedRotX.player !== playerRotX)) {
      this.appliedSource.player = src;
      this.appliedRotX.player = playerRotX;
      const model = this.loadedModels.player;
      if (src === 'glb' && model) {
        this.player.setModel(rotatedObject(model.object, playerRotX), 'full');
      } else if (src === 'procedural') {
        // 手続きモデルは正規化済み（接地/+Z正面）: rotX/rotY/offsetY 補正は掛けない。
        // +Z 正面 → ゲーム規約の -Z 前方への 180° はエンジン側でベイクする（cfg 非依存）
        const obj = rotatedObject(PROC_BUILDERS.player!(), 0, false);
        obj.rotation.y = Math.PI;
        this.player.setModel(obj, 'scale-only');
      } else {
        this.player.setModel(null);
      }
      this.activeSources.player = src;
      this.modelStatus.player = src === 'glb';
    }
    // ---- enemies: per-type InstancedMesh ----
    for (const type of ENEMY_TYPES) {
      const eSrc = this.resolveSource(type.id);
      const rotX = this.assetCfg.assets[type.id].rotX;
      if (!force && this.appliedSource[type.id] === eSrc && (eSrc !== 'glb' || this.appliedRotX[type.id] === rotX)) {
        continue;
      }
      this.appliedSource[type.id] = eSrc;
      this.appliedRotX[type.id] = rotX;
      const m = this.loadedModels[type.id];
      if (eSrc === 'glb' && m && m.geometry && m.material) {
        const baked = rotatedGeometry(m.geometry, rotX);
        this.enemies.setTypeModel(type.id, baked, m.material);
        const prev = this.bakedGeos[type.id];
        if (prev && prev !== m.geometry && prev !== baked) prev.dispose();
        this.bakedGeos[type.id] = baked;
      } else {
        this.enemies.removeTypeModel(type.id);
        const prev = this.bakedGeos[type.id];
        if (prev && prev !== m?.geometry) prev.dispose();
        delete this.bakedGeos[type.id];
      }
      this.activeSources[type.id] = eSrc;
      this.modelStatus[type.id] = eSrc === 'glb';
      enemyMeshChanged = true;
    }
    // levelup/gameover 中は update が回らず新 InstancedMesh が count=0 のままになるため、
    // dt=0 の update で行列/カウントを 1 回再書込して表示を維持する（移動・被弾進行なし）
    if (enemyMeshChanged && this.state !== 'playing') {
      this.enemies.update(0, this.player.x, this.player.z, this.player.radius, this.elapsed);
    }
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
    this.effects.update(dt);
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
    this.updateBomb(dt);
    this.updateSpinner(dt);

    // --- 弾更新 & 衝突 ---
    this.projectiles.update(
      dt,
      (x, z) => this.ink.splat(x, z, 0.55),
      (b) => this.explodeBomb(b)
    );
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
    const shot = this.assetCfg.weapons.shot;
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
        shot.projectileSpeed, shot.projectileLife, this.mods.damage, this.mods.splashRadius
      );
    }
  }

  // ---- スプラッシュボム（放物線 → 範囲爆発） ----

  private updateBomb(dt: number): void {
    if (this.weapons.bomb <= 0) return;
    this.bombTimer -= dt;
    if (this.bombTimer > 0 || this.enemies.activeCount === 0) return;
    const lvl = this.weapons.bomb;
    const cfg = this.assetCfg.weapons.bomb;
    this.bombTimer = cfg.fireInterval * Math.pow(0.88, lvl - 1);
    const targets = this.enemies.nearest(this.player.x, this.player.z, 1);
    if (targets.length === 0) return;
    const t = this.enemies.slots[targets[0]];
    const damage = cfg.damage * (1 + 0.45 * (lvl - 1));
    const radius = cfg.blastRadius * (1 + 0.16 * (lvl - 1));
    this.projectiles.fireBomb(
      this.player.x, this.player.z,
      t.x + (Math.random() - 0.5) * 1.2, t.z + (Math.random() - 0.5) * 1.2,
      cfg.throwSpeed, damage, radius
    );
  }

  private explodeBomb(b: BombSlot): void {
    // 大スプラット + 爆発リング
    this.ink.splat(b.x, b.z, b.blastRadius * 1.15);
    this.effects.ring(b.x, b.z, b.blastRadius, COLORS.projectile);
    // 範囲内の敵へフルダメージ
    for (let i = 0; i < this.enemies.slots.length; i++) {
      const s = this.enemies.slots[i];
      if (!s.active) continue;
      if (Math.hypot(s.x - b.x, s.z - b.z) < b.blastRadius + s.radius) {
        if (this.enemies.applyDamage(i, b.damage)) this.killEnemy(i);
      }
    }
  }

  // ---- スピナー（高速拡散連射） ----

  private updateSpinner(dt: number): void {
    if (this.weapons.spinner <= 0) return;
    this.spinnerTimer -= dt;
    if (this.spinnerTimer > 0 || this.enemies.activeCount === 0) return;
    const lvl = this.weapons.spinner;
    const cfg = this.assetCfg.weapons.spinner;
    this.spinnerTimer = cfg.fireInterval * Math.pow(0.85, lvl - 1);
    const targets = this.enemies.nearest(this.player.x, this.player.z, 1);
    if (targets.length === 0) return;
    const t = this.enemies.slots[targets[0]];
    let dx = t.x - this.player.x;
    let dz = t.z - this.player.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    dx /= len;
    dz /= len;
    const spread = (Math.random() - 0.5) * 2 * cfg.spreadDeg * DEG2RAD;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const nx = dx * cos - dz * sin;
    const nz = dx * sin + dz * cos;
    const damage = cfg.damage * (1 + 0.35 * (lvl - 1));
    this.projectiles.fire(
      this.player.x, this.player.z, nx, nz,
      cfg.projectileSpeed, cfg.projectileLife, damage, 0,
      'spinner', 0.7
    );
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
    this.effects.pop(s.x, s.z, s.color, s.scale); // 撃破ポップ演出
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
    if (!u.transient) this.upgradeLog.push(u.id); // config 変更時の再適用用
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
    this.upgradeLog = [];
    this.mods = this.baseMods();
    this.weapons = { bomb: 0, spinner: 0 };
    this.spawnTimer = 1;
    this.fireTimer = 0.4;
    this.bombTimer = 1;
    this.spinnerTimer = 0.3;
    this.invincibleTimer = 0;
    this.pendingLevelUps = 0;
    this.currentChoices = [];
    this.forcedInvincible = false;
    this.input.overrideDir = null;
    this.player.reset();
    this.enemies.reset();
    this.projectiles.reset();
    this.gems.reset();
    this.effects.reset();
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

  /**
   * デバッグ: rAF に依存せずゲームを決定的に進める（orca パネル非表示でも検証可能にする）。
   * 通常プレイのループとは独立で、挙動は update/effects の呼び出しのみ。
   */
  debugStep(seconds: number): void {
    let remain = Math.max(0, Math.min(120, Number(seconds) || 0));
    const step = 1 / 60;
    while (remain > 0) {
      const dt = Math.min(step, remain);
      if (this.state === 'playing') this.update(dt);
      this.effects.update(dt);
      this.updateCamera(dt);
      remain -= dt;
    }
  }

  /** デバッグ: 武器レベルを直接設定（検証用。upgradeLog にも反映して再適用に耐える） */
  debugSetWeaponLevel(id: 'bomb' | 'spinner', level: number): void {
    const lvl = Math.max(0, Math.min(4, Math.floor(Number(level) || 0)));
    this.upgradeLog = this.upgradeLog.filter((u) => u !== id);
    for (let i = 0; i < lvl; i++) this.upgradeLog.push(id);
    this.rederiveMods();
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
