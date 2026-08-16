// ゲーム全体の定数・配色（カラフルなインクの世界）

export const ARENA_SIZE = 80; // 地面プレーンの一辺
export const ARENA_HALF = ARENA_SIZE / 2;
export const PLAY_HALF = ARENA_HALF - 2; // プレイヤー・敵の移動可能範囲

export const COLORS = {
  sky: 0xbfeaf2,
  groundBase: '#f4f1ea',
  groundGrid: 'rgba(60, 70, 90, 0.06)',
  wall: 0xe8e2d8,
  playerBody: 0x19d3dc, // シアンインク
  playerBelly: 0xd9fbfd,
  inkMain: '#19d3dc',
  inkAlt: '#0fb8c9',
  inkLight: '#4fe4ec',
  projectile: 0x22e0ea,
  gem: 0xb7f04b,
  enemyBlob: 0xe85fae, // マゼンタ
  enemyDart: 0xff8a2b, // オレンジ
  enemyTank: 0x9b5cff, // バイオレット
} as const;

export const POOL = {
  enemies: 220,
  projectiles: 140,
  gems: 300,
} as const;

export const PLAYER = {
  maxHp: 100,
  radius: 0.6,
  moveSpeed: 6.5,
  invincibleTime: 0.9,
} as const;

export const WEAPON = {
  fireInterval: 0.5,
  damage: 2,
  projectileCount: 1,
  projectileSpeed: 16,
  projectileLife: 1.4,
  splashRadius: 0.75,
  magnetRadius: 3.5,
} as const;

export const CAMERA = {
  fov: 55,
  offsetY: 16,
  offsetZ: 10,
  followLerp: 6, // 指数平滑係数
} as const;

// 敵タイプ定義
export interface EnemyType {
  id: 'blob' | 'dart' | 'tank';
  hp: number;
  speed: number;
  radius: number;
  scale: number;
  color: number;
  contactDamage: number;
  xp: number;
  appearAt: number; // 出現開始秒
}

export const ENEMY_TYPES: EnemyType[] = [
  { id: 'blob', hp: 3, speed: 2.4, radius: 0.55, scale: 1.0, color: COLORS.enemyBlob, contactDamage: 10, xp: 1, appearAt: 0 },
  { id: 'dart', hp: 1.5, speed: 4.2, radius: 0.4, scale: 0.7, color: COLORS.enemyDart, contactDamage: 7, xp: 1, appearAt: 40 },
  { id: 'tank', hp: 10, speed: 1.5, radius: 0.9, scale: 1.6, color: COLORS.enemyTank, contactDamage: 18, xp: 3, appearAt: 75 },
];

// 難易度曲線
export function spawnInterval(elapsed: number): number {
  return Math.max(0.35, 1.3 - elapsed * 0.004);
}
export function spawnBatch(elapsed: number): number {
  return 1 + Math.floor(elapsed / 45);
}
export function enemyHpMul(elapsed: number): number {
  return 1 + elapsed / 90;
}
export function enemySpeedMul(elapsed: number): number {
  return 1 + Math.min(0.6, (elapsed / 180) * 0.4);
}

export function xpForLevel(level: number): number {
  return 5 + (level - 1) * 3;
}
