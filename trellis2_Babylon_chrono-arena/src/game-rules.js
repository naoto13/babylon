export const RUN_DURATION_SECONDS = 60;
export const ARENA_RADIUS = 15.25;
export const BOSS_SPAWN_REMAINING_SECONDS = 15;
export const INITIAL_ENEMY_COUNT = 4;

// 雷撃は通常弾とは独立した、予兆を見て回避するための直線攻撃。
// 調整対象の数値をここへ集約し、描画と当たり判定の幅を同じ値から参照する。
export const LIGHTNING_STRIKE_CONFIG = Object.freeze({
  shooterOwnershipChance: 0.25,
  cooldownMinSeconds: 6,
  cooldownMaxSeconds: 8,
  telegraphSeconds: 1,
  length: 22,
  width: 0.5,
  playerRadius: 0.5,
  damage: 18,
  travelSeconds: 0.15,
  lingerSeconds: 0.25,
  poolCapacity: 6,
  activationRange: 17
});

export const UPGRADES = Object.freeze({
  blade: Object.freeze({
    id: "blade",
    name: "秒針の刃",
    description: "自動攻撃が32%高速化し、弾が敵を1体貫通する。"
  }),
  causality: Object.freeze({
    id: "causality",
    name: "因果の環",
    description: "3回目ごとの自動攻撃が別の標的へ複製される。"
  }),
  hourglass: Object.freeze({
    id: "hourglass",
    name: "砂時計の心臓",
    description: "残り10秒になると敵と敵弾だけが55%遅くなる。"
  })
});

export function clampPointToCircle(x, z, radius = ARENA_RADIUS) {
  const length = Math.hypot(x, z);
  if (length <= radius || length === 0) return { x, z };
  const scale = radius / length;
  return { x: x * scale, z: z * scale };
}

export function isWithinHorizontalRadius(a, b, radius) {
  const deltaX = a.x - b.x;
  const deltaZ = a.z - b.z;
  return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
}

export function isWithinLineSegmentRadius(point, start, end, radius) {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (lengthSquared === 0) return isWithinHorizontalRadius(point, start, radius);

  const projection = ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared;
  const t = Math.max(0, Math.min(1, projection));
  const closestX = start.x + segmentX * t;
  const closestZ = start.z + segmentZ * t;
  const deltaX = point.x - closestX;
  const deltaZ = point.z - closestZ;
  return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
}

export function canEnemyCastLightning(type, roll = Math.random()) {
  return type === "boss" || (type === "shooter" && roll < LIGHTNING_STRIKE_CONFIG.shooterOwnershipChance);
}

export function getLightningStrikeCooldown(roll = Math.random()) {
  const clampedRoll = Math.max(0, Math.min(1, roll));
  return LIGHTNING_STRIKE_CONFIG.cooldownMinSeconds
    + (LIGHTNING_STRIKE_CONFIG.cooldownMaxSeconds - LIGHTNING_STRIKE_CONFIG.cooldownMinSeconds) * clampedRoll;
}

export function getSpawnInterval(elapsedSeconds) {
  return Math.max(0.42, 1.08 - elapsedSeconds * 0.0105);
}

export function getEnemyCombatStats(type, elapsedSeconds = 0) {
  if (type === "boss") return { hp: 52, speed: 1.15, damage: 18 };
  if (type === "shooter") return { hp: 3, speed: 1.68, damage: 10 };
  if (type === "thief") return { hp: 2, speed: 2.65, damage: 8 };
  return {
    hp: 2,
    speed: 2.25 + Math.min(0.72, elapsedSeconds * 0.011),
    damage: 9
  };
}

export function predictFuturePosition(entity, seconds = 2, radius = ARENA_RADIUS) {
  return clampPointToCircle(
    entity.x + (entity.velocityX ?? 0) * seconds,
    entity.z + (entity.velocityZ ?? 0) * seconds,
    radius
  );
}

export function shouldSpawnBoss({ remaining, bossSpawned, phase }) {
  return !bossSpawned && phase === "playing" && remaining <= BOSS_SPAWN_REMAINING_SECONDS;
}

export function findNearestTarget(origin, targets, maxDistance = Infinity, excludedId = null) {
  let nearest = null;
  let nearestDistance = maxDistance;

  for (const target of targets) {
    if (!target.alive || target.id === excludedId) continue;
    const distance = Math.hypot(target.x - origin.x, target.z - origin.z);
    if (distance < nearestDistance) {
      nearest = target;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function applyUpgrade(stats, upgradeId) {
  const next = { ...stats };

  if (upgradeId === "blade") {
    next.attackInterval = Math.max(0.16, stats.attackInterval * 0.68);
    next.pierce = stats.pierce + 1;
  }
  if (upgradeId === "causality") next.causality = true;
  if (upgradeId === "hourglass") next.hourglass = true;

  return next;
}

export function formatRemainingTime(seconds) {
  const safeSeconds = Math.max(0, seconds);
  return safeSeconds < 10 ? safeSeconds.toFixed(1) : String(Math.ceil(safeSeconds));
}

export function calculateRunRank({ survived, kills, hp }) {
  if (!survived) return kills >= 30 ? "C" : "D";
  if (kills >= 70 && hp >= 60) return "S";
  if (kills >= 48) return "A";
  return "B";
}
