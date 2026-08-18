// レベルアップ強化: プールからランダム 3 択（新武器の解放・強化を含む）

export interface Mods {
  fireInterval: number;
  damage: number;
  projectileCount: number;
  moveSpeed: number;
  splashRadius: number;
  magnetRadius: number;
}

/** 武器レベル（0 = 未解放）。shot は常時 1 以上 */
export interface WeaponLevels {
  bomb: number;
  spinner: number;
}

export const WEAPON_LEVEL_MAX = 4;

export interface UpgradeCtx {
  mods: Mods;
  weapons: WeaponLevels;
  heal(fraction: number): void;
  hpFraction(): number;
}

export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  desc: string | ((ctx: UpgradeCtx) => string);
  /** true = HP 回復など一過性（config 変更時のリプレイ対象外） */
  transient?: boolean;
  available(ctx: UpgradeCtx): boolean;
  apply(ctx: UpgradeCtx): void;
}

/** HUD 表示用に desc を解決した選択肢 */
export interface UpgradeChoice {
  id: string;
  icon: string;
  name: string;
  desc: string;
  transient: boolean;
  apply(ctx: UpgradeCtx): void;
}

export const UPGRADE_POOL: Upgrade[] = [
  {
    id: 'fire-rate', icon: '⚡️', name: '連射スピード',
    desc: 'インクショットの発射間隔 -18%',
    available: (c) => c.mods.fireInterval > 0.12,
    // 下限は admin スライダーの min (0.08) と揃える（基礎値 0.08 設定時に強化で遅くならないように）
    apply: (c) => { c.mods.fireInterval = Math.max(0.08, c.mods.fireInterval * 0.82); },
  },
  {
    id: 'damage', icon: '💥', name: 'インク濃度',
    desc: '弾ダメージ +1',
    available: () => true,
    apply: (c) => { c.mods.damage += 1; },
  },
  {
    id: 'multi-shot', icon: '🎯', name: 'マルチショット',
    desc: '同時発射数 +1（最大 6）',
    available: (c) => c.mods.projectileCount < 6,
    apply: (c) => { c.mods.projectileCount += 1; },
  },
  {
    id: 'move-speed', icon: '👟', name: 'スイム速度',
    desc: '移動速度 +12%',
    available: (c) => c.mods.moveSpeed < 12,
    apply: (c) => { c.mods.moveSpeed *= 1.12; },
  },
  {
    id: 'heal', icon: '💚', name: 'リカバリー',
    desc: 'HP を 50% 回復',
    transient: true,
    available: (c) => c.hpFraction() < 1,
    apply: (c) => { c.heal(0.5); },
  },
  {
    id: 'splash', icon: '🌊', name: 'スプラッシュ拡大',
    desc: '着弾の爆発範囲とスプラットが拡大',
    available: (c) => c.mods.splashRadius < 3,
    apply: (c) => { c.mods.splashRadius += 0.5; },
  },
  {
    id: 'magnet', icon: '🧲', name: 'ジェムマグネット',
    desc: 'ジェム吸引範囲 +40%',
    available: (c) => c.mods.magnetRadius < 12,
    apply: (c) => { c.mods.magnetRadius *= 1.4; },
  },
  {
    id: 'bomb', icon: '💣', name: 'スプラッシュボム',
    desc: (c) => c.weapons.bomb === 0
      ? '解放: 放物線ボムで範囲爆発 + 大スプラット'
      : `強化 Lv${c.weapons.bomb + 1}: 威力と爆発範囲アップ`,
    available: (c) => c.weapons.bomb < WEAPON_LEVEL_MAX,
    apply: (c) => { c.weapons.bomb = Math.min(WEAPON_LEVEL_MAX, c.weapons.bomb + 1); },
  },
  {
    id: 'spinner', icon: '🌀', name: 'スピナー',
    desc: (c) => c.weapons.spinner === 0
      ? '解放: 高速拡散のインク連射'
      : `強化 Lv${c.weapons.spinner + 1}: 連射速度と威力アップ`,
    available: (c) => c.weapons.spinner < WEAPON_LEVEL_MAX,
    apply: (c) => { c.weapons.spinner = Math.min(WEAPON_LEVEL_MAX, c.weapons.spinner + 1); },
  },
];

/** 選択可能なものから重複なしで最大 3 つ（desc はこの時点の状態で解決） */
export function rollUpgrades(ctx: UpgradeCtx): UpgradeChoice[] {
  const avail = UPGRADE_POOL.filter((u) => u.available(ctx));
  // Fisher–Yates shuffle
  for (let i = avail.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [avail[i], avail[j]] = [avail[j], avail[i]];
  }
  return avail.slice(0, Math.min(3, avail.length)).map((u) => ({
    id: u.id,
    icon: u.icon,
    name: u.name,
    desc: typeof u.desc === 'function' ? u.desc(ctx) : u.desc,
    transient: u.transient === true,
    apply: u.apply,
  }));
}

/** config 変更時のリプレイ用: id から Upgrade を引く */
export function findUpgrade(id: string): Upgrade | undefined {
  return UPGRADE_POOL.find((u) => u.id === id);
}
