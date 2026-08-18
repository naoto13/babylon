// DEV 限定のデバッグ窓口: orca eval からの検証・操作用
import type { Game } from './game/game';

export function exposeDebug(game: Game): void {
  (window as unknown as Record<string, unknown>).__game = {
    get scene() { return game.scene; },
    get camera() { return game.camera; },
    get renderer() { return game.renderer; },
    /** 1フレーム描画して PNG dataURL を返す（スクリーンショット取得用） */
    capture: () => {
      game.renderer.render(game.scene, game.camera);
      return game.renderer.domElement.toDataURL('image/png');
    },
    get player() { return game.player; },
    get enemies() { return game.enemies; },
    /** 主要な状態のスナップショット（orca eval で JSON 化しやすい形） */
    get state() {
      return {
        state: game.state,
        elapsed: Math.round(game.elapsed * 10) / 10,
        kills: game.kills,
        level: game.level,
        xp: game.xp,
        xpNext: game.xpNext,
        hp: game.hp,
        maxHp: game.maxHp,
        coverage: Math.round(game.ink.coverage() * 100) / 100,
        enemies: game.enemies.activeCount,
        projectiles: game.projectiles.slots.filter((s) => s.active).length,
        projectilesByKind: {
          shot: game.projectiles.slots.filter((s) => s.active && s.kind === 'shot').length,
          spinner: game.projectiles.slots.filter((s) => s.active && s.kind === 'spinner').length,
        },
        bombs: game.projectiles.bombs.filter((s) => s.active).length,
        gems: game.gems.slots.filter((s) => s.active).length,
        fps: Math.round(game.fps),
        player: { x: Math.round(game.player.x * 100) / 100, z: Math.round(game.player.z * 100) / 100 },
        mods: { ...game.mods },
        weapons: { ...game.weapons },
        models: { ...game.modelStatus },
        sources: { ...game.activeSources },
      };
    },
    /** 実効アセット設定（localStorage 反映済み） */
    get assetConfig() { return game.assetCfg; },
    /** config を直接適用（rotX 等の検証用。localStorage は変更しない） */
    applyConfig: (cfg: Parameters<Game['applyConfig']>[0]) => game.applyConfig(cfg),
    spawnEnemy: (n?: number, typeId?: string) => game.debugSpawnEnemy(n, typeId),
    levelUp: () => game.debugLevelUp(),
    /** rAF が止まる環境（orca パネル非表示）でも決定的にゲームを進める */
    step: (seconds: number) => game.debugStep(seconds),
    chooseUpgrade: (i: number) => game.chooseUpgrade(i),
    /** 武器レベルを直接設定（'bomb' | 'spinner'） */
    setWeaponLevel: (id: 'bomb' | 'spinner', level: number) => game.debugSetWeaponLevel(id, level),
    setInvincible: (on: boolean) => game.setInvincible(on),
    setCameraOffset: (y: number, z: number) => game.setCameraOffset(y, z),
    /** 移動方向を固定（null で解除）。キーイベントに依存せず検証できる */
    setMoveDir: (x: number | null, z?: number) => {
      if (x === null || x === undefined) {
        game.input.overrideDir = null;
      } else {
        game.input.overrideDir = { x: Number(x) || 0, z: Number(z) || 0 };
      }
    },
    addXp: (n: number) => {
      const v = Math.max(0, Math.floor(Number(n) || 0));
      for (let i = 0; i < v; i++) game.gems.spawn(game.player.x, game.player.z, 1);
    },
    paint: (x: number, z: number, r: number) => game.ink.splat(x, z, r),
    restart: () => game.restart(),
  };
}
