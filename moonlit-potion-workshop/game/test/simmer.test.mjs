import test from "node:test";
import assert from "node:assert/strict";

import { getSimmerDifficulty, getSimmerSettings } from "../js/simmer.js";

test("simmer timing windows narrow with the active material and workshop ranks", () => {
  const first = getSimmerSettings({ materialIds: ["moon-petal"], workshopRank: "common", tempBand: "low" });
  const middle = getSimmerSettings({ materialIds: ["silvermoss"], workshopRank: "common", tempBand: "mid" });
  const final = getSimmerSettings({ materialIds: ["moon-petal"], workshopRank: "rare", tempBand: "high" });

  assert.deepEqual(first, {
    targetSeconds: 5,
    perfectWindow: 0.45,
    goodWindow: 1.1,
    difficulty: { id: "common", label: "基本錬金", perfectWindow: 0.45, goodWindow: 1.1, source: "素材・工房" },
  });
  assert.equal(middle.difficulty.id, "uncommon");
  assert.equal(middle.difficulty.source, "素材");
  assert.equal(middle.targetSeconds, 3.5);
  assert.equal(middle.perfectWindow, 0.32);
  assert.equal(middle.goodWindow, 0.75);
  assert.equal(final.difficulty.id, "rare");
  assert.equal(final.difficulty.source, "工房");
  assert.equal(final.targetSeconds, 2.5);
  assert.equal(final.perfectWindow, 0.22);
  assert.equal(final.goodWindow, 0.55);
  assert.ok(first.perfectWindow > middle.perfectWindow && middle.perfectWindow > final.perfectWindow);
  assert.ok(first.goodWindow > middle.goodWindow && middle.goodWindow > final.goodWindow);
});

test("gentle timing mode widens every visible simmer band without changing its target", () => {
  const standard = getSimmerSettings({ materialIds: ["star-salt"], workshopRank: "rare", tempBand: "high" });
  const gentle = getSimmerSettings({ materialIds: ["star-salt"], workshopRank: "rare", tempBand: "high", gentleTechnique: true });
  assert.equal(gentle.targetSeconds, standard.targetSeconds);
  assert.equal(gentle.perfectWindow, 0.33);
  assert.equal(gentle.goodWindow, 0.825);
});

test("the higher of active material and workshop rank wins, and invalid heat is rejected", () => {
  assert.equal(getSimmerDifficulty({ materialIds: ["toadcap"], workshopRank: "common" }).id, "rare");
  assert.equal(getSimmerDifficulty({ materialIds: ["moon-petal"], workshopRank: "uncommon" }).id, "uncommon");
  assert.equal(getSimmerDifficulty({ materialIds: ["unknown"], workshopRank: "common" }).id, "common");
  assert.throws(() => getSimmerSettings({ materialIds: [], workshopRank: "common", tempBand: "ember" }), /unknown simmer temperature/);
});
