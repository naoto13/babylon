import test from "node:test";
import assert from "node:assert/strict";

import {
  MATERIALS,
  ORDERS,
  SIDE_EFFECTS,
  TAG_AFFINITY_RULES,
} from "../js/data.js";
import { appraise, evaluateBrew, judgeDelivery } from "../js/engine.js";

const order = (id) => ORDERS.find((candidate) => candidate.id === id);

test("SPEC data has exactly 8 materials, 12 side effects, 12 orders, and 4 tag rules", () => {
  assert.equal(MATERIALS.length, 8);
  assert.equal(SIDE_EFFECTS.length, 12);
  assert.equal(ORDERS.length, 12);
  assert.equal(TAG_AFFINITY_RULES.length, 4);
  assert.deepEqual(
    MATERIALS.map(({ id, name, mainEffect, support, tempBand, recommendedPrep, tags, sideEffect }) =>
      ({ id, name, mainEffect, support, tempBand, recommendedPrep, tags, sideEffect })),
    [
      { id: "moon-petal", name: "月光花びら", mainEffect: "calm", support: null, tempBand: "low", recommendedPrep: "cut", tags: ["floral", "lunar"], sideEffect: "oversleep" },
      { id: "sunfeather", name: "陽羽根", mainEffect: "wake", support: null, tempBand: "high", recommendedPrep: "cut", tags: ["solar"], sideEffect: "jitters" },
      { id: "silvermoss", name: "銀苔", mainEffect: "heal", support: null, tempBand: "mid", recommendedPrep: "crush", tags: ["earth"], sideEffect: "glow-scar" },
      { id: "toadcap", name: "蛙鱗茸", mainEffect: "shift", support: null, tempBand: "high", recommendedPrep: "cut", tags: ["fungal"], sideEffect: "voice-change" },
      { id: "mistleaf", name: "霧葉", mainEffect: null, support: "shorten", tempBand: "low", recommendedPrep: "none", tags: ["herbal"], sideEffect: "morning-haze" },
      { id: "star-salt", name: "星塩", mainEffect: null, support: "amplify", tempBand: "any", recommendedPrep: "crush", tags: ["mineral", "lunar"], sideEffect: "vivid-dreams" },
      { id: "dewpearl", name: "露珠", mainEffect: null, support: "soften", tempBand: "low", recommendedPrep: "none", tags: ["water"], sideEffect: "numb-tongue" },
      { id: "bitterroot", name: "苦根", mainEffect: null, support: "stabilize", tempBand: "mid", recommendedPrep: "crush", tags: ["earth", "herbal"], sideEffect: "bitterness" },
    ],
  );
  assert.deepEqual(
    SIDE_EFFECTS.map(({ id, name, severity }) => ({ id, name, severity })),
    [
      { id: "oversleep", name: "深眠（起きられない）", severity: "major" },
      { id: "morning-haze", name: "朝靄の眠気", severity: "minor" },
      { id: "vivid-dreams", name: "鮮明な夢", severity: "minor" },
      { id: "jitters", name: "動悸", severity: "major" },
      { id: "glow-scar", name: "傷跡が光る", severity: "minor" },
      { id: "voice-change", name: "声変わり", severity: "major" },
      { id: "bitterness", name: "強い苦味", severity: "minor" },
      { id: "numb-tongue", name: "舌の痺れ", severity: "minor" },
      { id: "moon-mark", name: "月紋が浮かぶ", severity: "minor" },
      { id: "weeping-eyes", name: "涙が止まらない", severity: "minor" },
      { id: "heavy-limbs", name: "手足が重い", severity: "major" },
      { id: "sparks", name: "火の粉が散る", severity: "major" },
    ],
  );
  assert.deepEqual(TAG_AFFINITY_RULES, [
    { id: "solar-lunar", tags: ["solar", "lunar"], stability: -20 },
    { id: "lunar-lunar", tag: "lunar", minimumMaterials: 2, potency: 5 },
    { id: "water-fungal", tags: ["water", "fungal"], effect: "shift", potency: 10 },
    { id: "earth-herbal", tags: ["earth", "herbal"], stability: 5 },
  ]);
  assert.deepEqual(ORDERS[9].required, { effect: "calm", min: 40, requiredSideEffect: "vivid-dreams" });
  assert.deepEqual(ORDERS[11].forbidden, SIDE_EFFECTS.map((sideEffect) => sideEffect.id));
  for (const currentOrder of ORDERS) {
    assert.equal(currentOrder.question.choices.length, 2);
    assert.ok(currentOrder.hidden.epilogues.great);
    assert.ok(currentOrder.hidden.epilogues.ok);
    assert.ok(currentOrder.hidden.epilogues.fail);
  }
});

test("order #1's correct short calm recipe is great", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });

  assert.deepEqual(brew.effects, { calm: 85, wake: 0, heal: 0, shift: 0 });
  assert.equal(brew.stability, 80);
  assert.equal(brew.duration, "short");
  assert.deepEqual(brew.sideEffects, []);
  assert.deepEqual(judgeDelivery(brew, order(1)), {
    tier: "great",
    reputationDelta: 3,
    reasons: ["必須条件を満たし、大きな副作用なく安定している"],
  });
});

test("solar and lunar tags clash with the specified stability penalty", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "moon-petal", prep: "cut" },
    ],
    tempBand: "high",
    stirLaps: 2,
  });

  assert.equal(brew.stability, 30); // 70 - 20 solar/lunar - 20 muddle
  assert.ok(brew.notes.includes("タグ相性 solar×lunar: 安定度-20"));
});

test("too little and too much stirring apply their separate penalties", () => {
  const baseInput = {
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "low",
  };
  const underStirred = evaluateBrew({ ...baseInput, stirLaps: 1 });
  const overStirred = evaluateBrew({ ...baseInput, stirLaps: 8 });

  assert.equal(underStirred.stability, 65);
  assert.equal(underStirred.effects.calm, 75);
  assert.ok(underStirred.notes.includes("かき混ぜ不足: 安定度-15、全効力-10"));
  assert.equal(overStirred.stability, 72);
  assert.ok(overStirred.notes.includes("かき混ぜ超過 2周: 安定度-8"));
});

test("dewpearl cancels exactly the earliest fired side effect", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "dewpearl", prep: "none" },
    ],
    tempBand: "high",
    stirLaps: 2,
  });

  assert.equal(brew.stability, 30);
  assert.ok(!brew.sideEffects.includes("oversleep"));
  assert.deepEqual(brew.sideEffects, ["jitters", "numb-tongue"]);
  assert.ok(brew.notes.some((note) => note.startsWith("露珠: 最初に発現した副作用「深眠")));
});

test("bitterroot adds bitterness whenever final stability is below 80", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "bitterroot", prep: "crush" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "mid",
    stirLaps: 1,
  });

  assert.equal(brew.stability, 75);
  assert.ok(brew.sideEffects.includes("bitterness"));
  assert.ok(brew.notes.includes("副作用「強い苦味」: 苦根使用中かつ安定度が80未満"));
});

test("order #10 requires vivid-dreams to be present, not merely calm potency", () => {
  const withoutDreams = {
    effects: { calm: 80, wake: 0, heal: 0, shift: 0 },
    stability: 90,
    duration: "mid",
    sideEffects: [],
  };
  assert.equal(judgeDelivery(withoutDreams, order(10)).tier, "fail");

  const brew = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "star-salt", prep: "crush" },
      { materialId: "mistleaf", prep: "none" },
      { materialId: "dewpearl", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 1,
  });
  assert.equal(brew.stability, 55);
  assert.ok(brew.sideEffects.includes("vivid-dreams"));
  assert.equal(judgeDelivery(brew, order(10)).tier, "ok");
});

test("order #4 rejects potency above its maxPotency ceiling", () => {
  const tooPotent = {
    effects: { calm: 71, wake: 0, heal: 0, shift: 0 },
    stability: 90,
    duration: "mid",
    sideEffects: [],
  };
  const judgement = judgeDelivery(tooPotent, order(4));
  assert.equal(judgement.tier, "fail");
  assert.ok(judgement.reasons.includes("鎮静が効きすぎている"));
});

test("order #12 enforces stability >= 85 and accepts a fully clean solution", () => {
  const belowGate = {
    effects: { calm: 70, wake: 0, heal: 0, shift: 0 },
    stability: 84,
    duration: "mid",
    sideEffects: [],
  };
  assert.equal(judgeDelivery(belowGate, order(12)).tier, "fail");
  assert.equal(judgeDelivery({ ...belowGate, stability: 90, sideEffects: ["bitterness"] }, order(12)).tier, "fail");

  const brew = evaluateBrew({
    items: [
      { materialId: "bitterroot", prep: "crush" },
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "dewpearl", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });
  assert.deepEqual(brew.sideEffects, []);
  assert.equal(brew.stability, 90);
  assert.equal(brew.effects.calm, 80);
  assert.equal(judgeDelivery(brew, order(12)).tier, "great");
});

test("scores clamp to 0–100", () => {
  const high = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "star-salt", prep: "crush" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });
  const low = evaluateBrew({
    items: [
      { materialId: "sunfeather", prep: "none" },
      { materialId: "toadcap", prep: "none" },
      { materialId: "moon-petal", prep: "none" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 1,
  });

  assert.equal(high.effects.calm, 100);
  assert.equal(low.effects.wake, 0);
  assert.equal(low.effects.shift, 0);
  for (const value of [...Object.values(high.effects), high.stability, ...Object.values(low.effects), low.stability]) {
    assert.ok(value >= 0 && value <= 100);
  }
});

test("invalid item counts and unknown material IDs throw before evaluation", () => {
  const validItem = { materialId: "moon-petal", prep: "cut" };
  assert.throws(
    () => evaluateBrew({ items: [validItem], tempBand: "low", stirLaps: 2 }),
    /between 2 and 4/,
  );
  assert.throws(
    () => evaluateBrew({
      items: [validItem, validItem, validItem, validItem, validItem],
      tempBand: "low",
      stirLaps: 2,
    }),
    /between 2 and 4/,
  );
  assert.throws(
    () => evaluateBrew({
      items: [validItem, { materialId: "unknown-root", prep: "none" }],
      tempBand: "low",
      stirLaps: 2,
    }),
    /unknown materialId/,
  );
});

test("four items incur the independent stability penalty", () => {
  const twoItems = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });
  const fourItems = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none" },
      { materialId: "star-salt", prep: "crush" },
      { materialId: "dewpearl", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });

  assert.equal(twoItems.stability, 80);
  assert.equal(fourItems.stability, 70);
  assert.ok(fourItems.notes.includes("4素材使用: 安定度-10"));
});

test("evaluation is deterministic, does not mutate input, and appraise explains its result", () => {
  const input = {
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "low",
    stirLaps: 1.6,
  };
  const original = structuredClone(input);
  const first = evaluateBrew(input);
  const second = evaluateBrew(input);

  assert.deepEqual(first, second);
  assert.deepEqual(input, original);
  assert.equal(first.stability, 80); // fractional laps are rounded to two laps
  const lines = appraise(first);
  assert.ok(lines.includes("安定度: 80"));
  assert.ok(!lines.some((line) => line.includes("かき混ぜ不足")));
});

const calmBaseInput = {
  items: [
    { materialId: "moon-petal", prep: "cut" },
    { materialId: "mistleaf", prep: "none" },
  ],
  tempBand: "low",
  stirLaps: 2,
};

const coreResult = ({ effects, stability, duration, sideEffects, notes }) => (
  { effects, stability, duration, sideEffects, notes }
);

test("each material exposes the SPEC §8.6 pour band", () => {
  assert.deepEqual(
    Object.fromEntries(MATERIALS.map(({ id, pourBand }) => [id, pourBand])),
    {
      "moon-petal": { min: 50, max: 80 },
      sunfeather: { min: 55, max: 80 },
      silvermoss: { min: 50, max: 80 },
      toadcap: { min: 55, max: 78 },
      mistleaf: { min: 45, max: 75 },
      "star-salt": { min: 60, max: 75 },
      dewpearl: { min: 55, max: 78 },
      bitterroot: { min: 45, max: 80 },
    },
  );
});

test("omitted amounts and technique reproduce the explicit standard defaults", () => {
  const omitted = evaluateBrew(calmBaseInput);
  const explicitDefaults = evaluateBrew({
    ...calmBaseInput,
    items: calmBaseInput.items.map((item) => ({ ...item, amount: "standard" })),
    technique: { stirQuality: 50, simmer: "none" },
  });

  assert.deepEqual(coreResult(omitted), coreResult(explicitDefaults));
  assert.deepEqual(omitted.technique, {
    stirQuality: 50,
    simmer: "none",
    pours: [
      { materialId: "moon-petal", amount: "standard" },
      { materialId: "mistleaf", amount: "standard" },
    ],
  });
});

test("stir quality uses the specified rounded stability and potency modifiers", () => {
  const high = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 90, simmer: "none" },
  });
  const low = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 10, simmer: "none" },
  });

  assert.equal(high.stability, 84); // 80 + round(40 / 10)
  assert.equal(high.effects.calm, 88); // 85 + round(40 / 12.5)
  assert.equal(low.stability, 76); // 80 + round(-40 / 10)
  assert.equal(low.effects.calm, 82); // 85 + round(-40 / 12.5)
});

test("ideal amounts add +8 to a main effect and +2 stability to a support", () => {
  const brew = evaluateBrew({
    ...calmBaseInput,
    items: [
      { materialId: "moon-petal", prep: "cut", amount: "ideal" },
      { materialId: "mistleaf", prep: "none", amount: "ideal" },
    ],
  });

  assert.equal(brew.effects.calm, 93);
  assert.equal(brew.stability, 82);
  assert.equal(brew.duration, "short");
});

test("main-effect amount bands use the exact scant, standard, ideal, and heavy potency deltas", () => {
  const potencyFor = (amount) => evaluateBrew({
    ...calmBaseInput,
    items: [
      { materialId: "moon-petal", prep: "cut", amount },
      { materialId: "mistleaf", prep: "none" },
    ],
  }).effects.calm;

  assert.deepEqual(
    ["scant", "standard", "ideal", "heavy"].map((amount) => potencyFor(amount)),
    [65, 85, 93, 90],
  );
});

test("scant support materials disable soften and stabilize but retain material side-effect rules", () => {
  const standardDewpearl = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "dewpearl", prep: "none", amount: "standard" },
    ],
    tempBand: "high",
    stirLaps: 2,
  });
  const scantDewpearl = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "dewpearl", prep: "none", amount: "scant" },
    ],
    tempBand: "high",
    stirLaps: 2,
  });
  const standardBitterroot = evaluateBrew({
    items: [
      { materialId: "bitterroot", prep: "crush" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "mid",
    stirLaps: 1,
  });
  const scantBitterroot = evaluateBrew({
    items: [
      { materialId: "bitterroot", prep: "crush", amount: "scant" },
      { materialId: "mistleaf", prep: "none" },
    ],
    tempBand: "mid",
    stirLaps: 1,
  });
  const scantMistleaf = evaluateBrew({
    ...calmBaseInput,
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "mistleaf", prep: "none", amount: "scant" },
    ],
  });
  const scantStarSalt = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "star-salt", prep: "crush", amount: "scant" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });

  assert.ok(!standardDewpearl.sideEffects.includes("oversleep"));
  assert.ok(scantDewpearl.sideEffects.includes("oversleep"));
  assert.equal(standardBitterroot.stability, 75);
  assert.equal(scantBitterroot.stability, 60);
  assert.ok(scantBitterroot.sideEffects.includes("bitterness"));
  assert.equal(scantMistleaf.duration, "mid");
  assert.deepEqual([scantStarSalt.effects.calm, scantStarSalt.duration], [90, "mid"]);
});

test("heavy amounts add a side-effect trigger, which active dewpearl may cancel even for itself", () => {
  const heavyMoonPetal = evaluateBrew({
    ...calmBaseInput,
    items: [
      { materialId: "moon-petal", prep: "cut", amount: "heavy" },
      { materialId: "mistleaf", prep: "none" },
    ],
  });
  const heavyDewpearl = evaluateBrew({
    items: [
      { materialId: "moon-petal", prep: "cut" },
      { materialId: "dewpearl", prep: "none", amount: "heavy" },
    ],
    tempBand: "low",
    stirLaps: 2,
  });

  assert.deepEqual(heavyMoonPetal.sideEffects, ["oversleep"]);
  assert.ok(heavyMoonPetal.notes.some((note) => note.includes("深眠") && note.includes("注ぎすぎ")));
  assert.deepEqual(heavyDewpearl.sideEffects, []);
  assert.ok(heavyDewpearl.notes.some((note) => note.startsWith("露珠: 最初に発現した副作用「舌の痺れ")));
});

test("simmer outcomes apply the exact perfect, good, early, and late modifiers", () => {
  const perfect = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 50, simmer: "perfect" },
  });
  const good = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 50, simmer: "good" },
  });
  const early = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 50, simmer: "early" },
  });
  const late = evaluateBrew({
    ...calmBaseInput,
    technique: { stirQuality: 50, simmer: "late" },
  });

  assert.deepEqual([perfect.stability, perfect.effects.calm], [88, 89]);
  assert.deepEqual([good.stability, good.effects.calm], [83, 85]);
  assert.deepEqual([early.stability, early.effects.calm], [80, 79]);
  assert.deepEqual([late.stability, late.effects.calm], [72, 85]);
});

test("late high-temperature simmer fires sparks and appraisal explains the technique", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "toadcap", prep: "cut" },
    ],
    tempBand: "high",
    stirLaps: 2,
    technique: { stirQuality: 90, simmer: "late" },
  });
  const lines = appraise(brew);

  assert.ok(brew.sideEffects.includes("sparks"));
  assert.ok(lines.includes("かき混ぜ真円度: 90（きれいな円）"));
  assert.ok(lines.includes("注ぎ量 陽羽根: 標準"));
  assert.ok(lines.includes("注ぎ量 蛙鱗茸: 標準"));
  assert.ok(lines.includes("煮込み: 遅すぎる"));
  assert.ok(lines.includes("火の粉の理由: 煮込みが遅すぎ、強火だったため"));
});

test("late high-temperature sparks have no pour slot, so dewpearl does not cancel them", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "sunfeather", prep: "cut" },
      { materialId: "dewpearl", prep: "none" },
    ],
    tempBand: "high",
    stirLaps: 2,
    technique: { stirQuality: 50, simmer: "late" },
  });

  assert.deepEqual(brew.sideEffects, ["sparks"]);
  assert.ok(brew.notes.some((note) => note.startsWith("露珠: 最初に発現した副作用「舌の痺れ")));
});

test("technique modifiers are applied before clamping", () => {
  const brew = evaluateBrew({
    items: [
      { materialId: "star-salt", prep: "crush" },
      { materialId: "moon-petal", prep: "cut" },
    ],
    tempBand: "low",
    stirLaps: 2,
    technique: { stirQuality: 50, simmer: "early" },
  });

  // Base potency is 105. Applying early (-6) before clamping yields 99,
  // whereas clamping the base score first would have incorrectly yielded 94.
  assert.equal(brew.effects.calm, 99);
});

test("invalid technique and amount bands reject evaluation input", () => {
  const invalidAmount = {
    ...calmBaseInput,
    items: [
      { materialId: "moon-petal", prep: "cut", amount: "overflow" },
      { materialId: "mistleaf", prep: "none" },
    ],
  };

  assert.throws(() => evaluateBrew(invalidAmount), /amount must be scant, standard, ideal, or heavy/);
  assert.throws(
    () => evaluateBrew({ ...calmBaseInput, technique: { stirQuality: 101, simmer: "none" } }),
    /stirQuality must be a finite number from 0 to 100/,
  );
  assert.throws(
    () => evaluateBrew({ ...calmBaseInput, technique: { stirQuality: 50, simmer: "burned" } }),
    /simmer must be none, perfect, good, early, or late/,
  );
});
