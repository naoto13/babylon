import test from "node:test";
import assert from "node:assert/strict";

import { getSimmerDifficulty, getSimmerSettings } from "../js/simmer.js";

test("simmer timing windows narrow from the first night through the final night", () => {
  const first = getSimmerSettings({ orderIndex: 0, tempBand: "low" });
  const middle = getSimmerSettings({ orderIndex: 4, tempBand: "mid" });
  const final = getSimmerSettings({ orderIndex: 8, tempBand: "high" });

  assert.deepEqual(first, {
    targetSeconds: 5,
    perfectWindow: 0.45,
    goodWindow: 1.1,
    difficulty: { id: "apprentice", label: "第1夜・見習い", perfectWindow: 0.45, goodWindow: 1.1 },
  });
  assert.equal(middle.difficulty.id, "adept");
  assert.equal(middle.targetSeconds, 3.5);
  assert.equal(middle.perfectWindow, 0.32);
  assert.equal(middle.goodWindow, 0.75);
  assert.equal(final.difficulty.id, "master");
  assert.equal(final.targetSeconds, 2.5);
  assert.equal(final.perfectWindow, 0.22);
  assert.equal(final.goodWindow, 0.55);
  assert.ok(first.perfectWindow > middle.perfectWindow && middle.perfectWindow > final.perfectWindow);
  assert.ok(first.goodWindow > middle.goodWindow && middle.goodWindow > final.goodWindow);
});

test("gentle timing mode widens every visible simmer band without changing its target", () => {
  const standard = getSimmerSettings({ orderIndex: 8, tempBand: "high" });
  const gentle = getSimmerSettings({ orderIndex: 8, tempBand: "high", gentleTechnique: true });
  assert.equal(gentle.targetSeconds, standard.targetSeconds);
  assert.equal(gentle.perfectWindow, 0.33);
  assert.equal(gentle.goodWindow, 0.825);
});

test("difficulty is clamped to the final night and rejects an unknown heat band", () => {
  assert.equal(getSimmerDifficulty(999).id, "master");
  assert.throws(() => getSimmerSettings({ orderIndex: 0, tempBand: "ember" }), /unknown simmer temperature/);
});
