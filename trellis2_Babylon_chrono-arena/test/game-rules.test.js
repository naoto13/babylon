import test from "node:test";
import assert from "node:assert/strict";

import {
  INITIAL_ENEMY_COUNT,
  LIGHTNING_STRIKE_CONFIG,
  applyUpgrade,
  canEnemyCastLightning,
  calculateRunRank,
  clampPointToCircle,
  findNearestTarget,
  formatRemainingTime,
  getEnemyCombatStats,
  getLightningStrikeCooldown,
  getSpawnInterval,
  isWithinLineSegmentRadius,
  isWithinHorizontalRadius,
  predictFuturePosition,
  shouldSpawnBoss
} from "../src/game-rules.js";

test("arena clamp preserves inner points and clamps outer points", () => {
  assert.deepEqual(clampPointToCircle(3, 4, 10), { x: 3, z: 4 });
  const clamped = clampPointToCircle(12, 16, 10);
  assert.equal(clamped.x, 6);
  assert.equal(clamped.z, 8);
});

test("projectile collision ignores billboard height and uses the arena plane", () => {
  assert.equal(isWithinHorizontalRadius({ x: 0, y: 3, z: 0 }, { x: 0.8, y: 0, z: 0 }, 0.82), true);
  assert.equal(isWithinHorizontalRadius({ x: 0, y: 0, z: 0 }, { x: 0.83, y: 0, z: 0 }, 0.82), false);
});

test("lightning ownership is limited to a subset of shooters and every boss", () => {
  assert.equal(LIGHTNING_STRIKE_CONFIG.shooterOwnershipChance, 0.25);
  assert.equal(canEnemyCastLightning("shooter", 0.249), true);
  assert.equal(canEnemyCastLightning("shooter", 0.25), false);
  assert.equal(canEnemyCastLightning("boss", 1), true);
  assert.equal(canEnemyCastLightning("chaser", 0), false);
  assert.equal(canEnemyCastLightning("thief", 0), false);
  assert.equal(getLightningStrikeCooldown(0), 6);
  assert.equal(getLightningStrikeCooldown(1), 8);
});

test("lightning hit checks the fixed telegraph segment instead of a screen-aligned axis", () => {
  const start = { x: -3, z: 4 };
  const end = { x: 8, z: -7 };
  assert.equal(isWithinLineSegmentRadius({ x: 1, z: 0 }, start, end, 0.76), true);
  assert.equal(isWithinLineSegmentRadius({ x: 2.2, z: 0 }, start, end, 0.76), false);
  assert.equal(isWithinLineSegmentRadius({ x: -4, z: 5 }, start, end, 0.76), false);
});

test("spawn interval accelerates but never exceeds the density floor", () => {
  assert.equal(INITIAL_ENEMY_COUNT, 4);
  assert.equal(getSpawnInterval(0), 1.08);
  assert.equal(getSpawnInterval(120), 0.42);
  assert.ok(getSpawnInterval(30) > 0.75);
});

test("enemy contact damage keeps the opening readable while preserving escalation", () => {
  assert.deepEqual(getEnemyCombatStats("chaser", 0), { hp: 2, speed: 2.25, damage: 9 });
  assert.equal(getEnemyCombatStats("chaser", 60).speed, 2.91);
  assert.equal(getEnemyCombatStats("boss").damage, 18);
});

test("future slash predicts two seconds of velocity and remains inside the arena", () => {
  assert.deepEqual(
    predictFuturePosition({ x: 2, z: -3, velocityX: 1.5, velocityZ: -2 }, 2, 20),
    { x: 5, z: -7 }
  );
  const clamped = predictFuturePosition({ x: 15, z: 0, velocityX: 5, velocityZ: 0 }, 2, 15.25);
  assert.equal(clamped.x, 15.25);
  assert.equal(clamped.z, 0);
});

test("boss appears once when the active run reaches the final 15 seconds", () => {
  assert.equal(shouldSpawnBoss({ remaining: 15, bossSpawned: false, phase: "playing" }), true);
  assert.equal(shouldSpawnBoss({ remaining: 14, bossSpawned: true, phase: "playing" }), false);
  assert.equal(shouldSpawnBoss({ remaining: 10, bossSpawned: false, phase: "upgrade" }), false);
});

test("nearest target ignores dead and excluded enemies", () => {
  const target = findNearestTarget(
    { x: 0, z: 0 },
    [
      { id: 1, x: 1, z: 0, alive: false },
      { id: 2, x: 2, z: 0, alive: true },
      { id: 3, x: 3, z: 0, alive: true }
    ],
    10,
    2
  );
  assert.equal(target.id, 3);
  assert.equal(findNearestTarget({ x: 0, z: 0 }, [], 10), null);
});

test("blade upgrade is immutable and changes attack behavior", () => {
  const base = { attackInterval: 0.5, pierce: 0, causality: false, hourglass: false };
  const upgraded = applyUpgrade(base, "blade");
  assert.equal(base.attackInterval, 0.5);
  assert.equal(upgraded.attackInterval, 0.34);
  assert.equal(upgraded.pierce, 1);
});

test("time formatting and rank calculations cover run boundaries", () => {
  assert.equal(formatRemainingTime(60), "60");
  assert.equal(formatRemainingTime(9.94), "9.9");
  assert.equal(formatRemainingTime(-1), "0.0");
  assert.equal(calculateRunRank({ survived: true, kills: 72, hp: 80 }), "S");
  assert.equal(calculateRunRank({ survived: false, kills: 20, hp: 0 }), "D");
});
