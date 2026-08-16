import test from "node:test";
import assert from "node:assert/strict";

import { SAVE_VERSION, freshGameState, validateSavedState } from "../js/save.js";

test("a fresh save includes the starter economy and low cauldron temperature", () => {
  const state = freshGameState();
  assert.equal(SAVE_VERSION, 2);
  assert.equal(state.brew.tempBand, "low");
  assert.deepEqual(state.economy, {
    coins: 36,
    inventory: { "moon-petal": 3, mistleaf: 3 },
    ownedAssetIds: ["cauldron"],
  });
});

test("a valid v1 save migrates without losing its existing progress", () => {
  const legacy = freshGameState();
  delete legacy.economy;
  legacy.orderIndex = 3;
  legacy.reputation = 5;
  const migrated = validateSavedState({ v: 1, state: legacy });
  assert.equal(migrated.orderIndex, 3);
  assert.equal(migrated.reputation, 5);
  assert.equal(migrated.economy.coins, 36);
  assert.deepEqual(migrated.economy.ownedAssetIds, ["cauldron"]);
});

test("v2 rejects malformed economy state", () => {
  const state = freshGameState();
  state.economy.coins = -1;
  assert.equal(validateSavedState({ v: 2, state }), null);
});
