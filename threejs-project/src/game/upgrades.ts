// レベルアップ強化: プールからランダム 3 択

export interface Mods {
  fireInterval: number;
  damage: number;
  projectileCount: number;
  moveSpeed: number;
  splashRadius: number;
  magnetRadius: number;
}

export interface UpgradeCtx {
  mods: Mods;
  heal(fraction: number): void;
  hpFraction(): number;
}

export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  desc: string;
  available(ctx: UpgradeCtx): boolean;
  apply(ctx: UpgradeCtx): void;
}

export const UPGRADE_POOL: Upgrade[] = [
  {
    id: 'fire-rate', icon: '⚡️', name: '連射スピード',
    desc: 'インクショットの発射間隔 -18%',
    available: (c) => c.mods.fireInterval > 0.12,
    apply: (c) => { c.mods.fireInterval = Math.max(0.1, c.mods.fireInterval * 0.82); },
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
];

/** 選択可能なものから重複なしで最大 3 つ */
export function rollUpgrades(ctx: UpgradeCtx): Upgrade[] {
  const avail = UPGRADE_POOL.filter((u) => u.available(ctx));
  // Fisher–Yates shuffle
  for (let i = avail.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [avail[i], avail[j]] = [avail[j], avail[i]];
  }
  return avail.slice(0, Math.min(3, avail.length));
}
