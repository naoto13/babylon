import {
  MAIN_EFFECTS,
  MATERIAL_BY_ID,
  SIDE_EFFECT_BY_ID,
} from "./data.js";

const PREPS = new Set(["none", "cut", "crush"]);
const TEMP_BANDS = new Set(["low", "mid", "high"]);
const AMOUNTS = new Set(["scant", "standard", "ideal", "heavy"]);
const SIMMER_RESULTS = new Set(["none", "perfect", "good", "early", "late"]);
const EFFECT_NAMES = Object.freeze({
  calm: "鎮静",
  wake: "覚醒",
  heal: "治癒",
  shift: "変身",
});
const DURATION_NAMES = Object.freeze({ short: "短い", mid: "中くらい", long: "長い" });
const AMOUNT_NAMES = Object.freeze({
  scant: "少なすぎる",
  standard: "標準",
  ideal: "適量",
  heavy: "注ぎすぎ",
});
const SIMMER_NAMES = Object.freeze({
  none: "なし",
  perfect: "ぴったり",
  good: "良好",
  early: "早すぎる",
  late: "遅すぎる",
});

const clampScore = (value) => Math.min(100, Math.max(0, value));

const isTempCompatible = (material, tempBand) => (
  material.tempBand === "any" || material.tempBand === tempBand
);

const displayNumber = (value) => Number.isInteger(value) ? String(value) : String(value);

function validateInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("evaluateBrew input must be an object");
  }

  const { items, tempBand, stirLaps } = input;
  if (!Array.isArray(items) || items.length < 2 || items.length > 4) {
    throw new RangeError("items must contain between 2 and 4 materials");
  }
  if (!TEMP_BANDS.has(tempBand)) {
    throw new RangeError("tempBand must be low, mid, or high");
  }
  if (typeof stirLaps !== "number" || !Number.isFinite(stirLaps) || stirLaps < 0 || stirLaps > 10) {
    throw new RangeError("stirLaps must be a finite number from 0 to 10");
  }

  let techniqueInput = input.technique;
  if (techniqueInput === undefined) techniqueInput = {};
  if (techniqueInput === null || typeof techniqueInput !== "object" || Array.isArray(techniqueInput)) {
    throw new TypeError("technique must be an object");
  }
  const stirQuality = techniqueInput.stirQuality === undefined ? 50 : techniqueInput.stirQuality;
  const simmer = techniqueInput.simmer === undefined ? "none" : techniqueInput.simmer;
  if (typeof stirQuality !== "number" || !Number.isFinite(stirQuality) || stirQuality < 0 || stirQuality > 100) {
    throw new RangeError("technique.stirQuality must be a finite number from 0 to 100");
  }
  if (!SIMMER_RESULTS.has(simmer)) {
    throw new RangeError("technique.simmer must be none, perfect, good, early, or late");
  }

  const ingredients = items.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`items[${index}] must be an object`);
    }
    if (!PREPS.has(item.prep)) {
      throw new RangeError(`items[${index}].prep must be none, cut, or crush`);
    }
    const amount = item.amount === undefined ? "standard" : item.amount;
    if (!AMOUNTS.has(amount)) {
      throw new RangeError(`items[${index}].amount must be scant, standard, ideal, or heavy`);
    }
    const material = MATERIAL_BY_ID[item.materialId];
    if (!material) {
      throw new RangeError(`unknown materialId: ${String(item.materialId)}`);
    }
    return { material, prep: item.prep, amount, index };
  });
  return { ingredients, technique: { stirQuality, simmer } };
}

/**
 * Deterministically evaluates one 2–4 material brew.  It reads no clock,
 * DOM, Babylon, storage, or network state and does not mutate its input.
 */
export function evaluateBrew(input) {
  const { ingredients, technique } = validateInput(input);
  const { tempBand } = input;
  // §8 introduces continuous input but its lap penalties are per whole lap.
  const stirLaps = Math.round(input.stirLaps);
  const notes = [];
  const effects = Object.fromEntries(MAIN_EFFECTS.map((effect) => [effect, 0]));

  const hasStarSalt = ingredients.some(({ material }) => material.id === "star-salt");
  const hasActiveStarSalt = ingredients.some(
    ({ material, amount }) => material.id === "star-salt" && amount !== "scant",
  );
  const hasBitterroot = ingredients.some(({ material }) => material.id === "bitterroot");
  const hasActiveBitterroot = ingredients.some(
    ({ material, amount }) => material.id === "bitterroot" && amount !== "scant",
  );
  const hasActiveDewpearl = ingredients.some(
    ({ material, amount }) => material.id === "dewpearl" && amount !== "scant",
  );
  const mainEffectsPresent = new Set(
    ingredients.flatMap(({ material }) => material.mainEffect ? [material.mainEffect] : []),
  );
  const muddled = mainEffectsPresent.size >= 2;
  const tagCounts = new Map();
  for (const { material } of ingredients) {
    for (const tag of material.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const hasTag = (tag) => tagCounts.has(tag);
  const solarLunar = hasTag("solar") && hasTag("lunar");
  const lunarLunar = (tagCounts.get("lunar") ?? 0) >= 2;
  const waterFungal = hasTag("water") && hasTag("fungal");
  const earthHerbal = hasTag("earth") && hasTag("herbal");

  if (hasActiveStarSalt) notes.push("星塩: 主効能素材の効力を各+20");
  if (lunarLunar) notes.push("タグ相性 lunar×lunar: 効力+5");
  if (waterFungal) notes.push("タグ相性 water×fungal: 変身効力+10");

  for (const { material, prep, index } of ingredients) {
    if (!material.mainEffect) continue;

    let potency = 50;
    if (prep === material.recommendedPrep) {
      potency += 15;
      notes.push(`${material.name}: 前処理一致で効力+15`);
    } else {
      potency -= 10;
      notes.push(`${material.name}: 前処理不一致で効力-10`);
    }
    if (isTempCompatible(material, tempBand)) {
      potency += 15;
      notes.push(`${material.name}: 適温で効力+15`);
    } else {
      potency -= 15;
      notes.push(`${material.name}: 温度不一致で効力-15`);
    }
    if (hasActiveStarSalt) potency += 20;
    if (index === 0) {
      potency += 5;
      notes.push(`${material.name}: 最初の投入で効力+5`);
    }
    if (lunarLunar) potency += 5;
    if (waterFungal && material.mainEffect === "shift") potency += 10;

    effects[material.mainEffect] += potency;
  }

  if (muddled) {
    for (const effect of mainEffectsPresent) effects[effect] -= 20;
    notes.push("混濁: 異なる主効能で各効力-20、安定度-20");
  }
  if (stirLaps < 2) {
    for (const effect of MAIN_EFFECTS) effects[effect] -= 10;
    notes.push("かき混ぜ不足: 安定度-15、全効力-10");
  }

  let stability = 70;
  if (hasActiveBitterroot) {
    stability += 15;
    notes.push("苦根: 安定度+15");
  }
  if (solarLunar) {
    stability -= 20;
    notes.push("タグ相性 solar×lunar: 安定度-20");
  }
  if (earthHerbal) {
    stability += 5;
    notes.push("タグ相性 earth×herbal: 安定度+5");
  }
  if (ingredients.every(({ material }) => isTempCompatible(material, tempBand))) {
    stability += 10;
    notes.push("全素材が適温: 安定度+10");
  }
  if (stirLaps < 2) stability -= 15;
  if (stirLaps > 6) {
    const penalty = (stirLaps - 6) * 4;
    stability -= penalty;
    notes.push(`かき混ぜ超過 ${displayNumber(stirLaps - 6)}周: 安定度-${displayNumber(penalty)}`);
  }
  if (ingredients.length === 4) {
    stability -= 10;
    notes.push("4素材使用: 安定度-10");
  }
  if (muddled) stability -= 20;

  // §8.6 modifiers are intentionally applied to the complete §8.5 base scores,
  // before either score is clamped.
  for (const { material, amount } of ingredients) {
    if (material.mainEffect) {
      const potencyDelta = { scant: -20, standard: 0, ideal: 8, heavy: 5 }[amount];
      if (potencyDelta !== 0) {
        effects[material.mainEffect] += potencyDelta;
        notes.push(`${material.name}: 注ぎ量${AMOUNT_NAMES[amount]}で効力${potencyDelta > 0 ? "+" : ""}${potencyDelta}`);
      }
      continue;
    }

    if (amount === "scant") {
      notes.push(`${material.name}: 注ぎ量が少なすぎて補助効果なし`);
    } else if (amount === "ideal") {
      stability += 2;
      notes.push(`${material.name}: 注ぎ量適量で安定度+2`);
    }
  }

  const stirStabilityDelta = Math.round((technique.stirQuality - 50) / 10);
  const stirPotencyDelta = Math.round((technique.stirQuality - 50) / 12.5);
  if (stirStabilityDelta !== 0 || stirPotencyDelta !== 0) {
    stability += stirStabilityDelta;
    for (const effect of mainEffectsPresent) effects[effect] += stirPotencyDelta;
    notes.push(`かき混ぜ真円度 ${displayNumber(technique.stirQuality)}: 安定度${stirStabilityDelta >= 0 ? "+" : ""}${stirStabilityDelta}、主効能${stirPotencyDelta >= 0 ? "+" : ""}${stirPotencyDelta}`);
  }

  if (technique.simmer === "perfect") {
    stability += 8;
    for (const effect of mainEffectsPresent) effects[effect] += 4;
    notes.push("煮込みぴったり: 安定度+8、主効能+4");
  } else if (technique.simmer === "good") {
    stability += 3;
    notes.push("煮込み良好: 安定度+3");
  } else if (technique.simmer === "early") {
    for (const effect of mainEffectsPresent) effects[effect] -= 6;
    notes.push("煮込みが早すぎる: 主効能-6");
  } else if (technique.simmer === "late") {
    stability -= 8;
    notes.push("煮込みが遅すぎる: 安定度-8");
  }

  for (const effect of MAIN_EFFECTS) effects[effect] = clampScore(effects[effect]);
  stability = clampScore(stability);

  const hasShorten = ingredients.some(
    ({ material, amount }) => material.support === "shorten" && amount !== "scant",
  );
  const hasAmplify = ingredients.some(
    ({ material, amount }) => material.support === "amplify" && amount !== "scant",
  );
  const duration = hasShorten === hasAmplify ? "mid" : hasShorten ? "short" : "long";
  if (hasShorten && hasAmplify) notes.push("霧葉と星塩: 持続時間は相殺してmid");
  else if (hasShorten) notes.push("霧葉: 持続時間をshortへ");
  else if (hasAmplify) notes.push("星塩: 持続時間をlongへ");

  const fired = [];
  for (const ingredient of ingredients) {
    const triggers = [];
    if (stability < 60) triggers.push("安定度が60未満");
    if (!isTempCompatible(ingredient.material, tempBand)) triggers.push("適温帯と不一致");
    if (hasStarSalt && ingredient.material.mainEffect) triggers.push("星塩と主効能素材の組合せ");
    if (ingredient.amount === "heavy") triggers.push("注ぎすぎ");
    if (triggers.length > 0) {
      fired.push({ id: ingredient.material.sideEffect, index: ingredient.index, triggers });
    }
  }

  if (hasActiveDewpearl && fired.length > 0) {
    const [cancelled] = fired.splice(0, 1);
    notes.push(`露珠: 最初に発現した副作用「${SIDE_EFFECT_BY_ID[cancelled.id].name}」を打ち消した`);
  }
  for (const sideEffect of fired) {
    notes.push(`副作用「${SIDE_EFFECT_BY_ID[sideEffect.id].name}」: ${sideEffect.triggers.join("・")}`);
  }
  if (hasBitterroot && stability < 80) {
    fired.push({ id: "bitterness", index: Number.POSITIVE_INFINITY, triggers: ["苦根使用中かつ安定度が80未満"] });
    notes.push("副作用「強い苦味」: 苦根使用中かつ安定度が80未満");
  }
  if (technique.simmer === "late" && tempBand === "high") {
    fired.push({ id: "sparks", index: Number.POSITIVE_INFINITY, triggers: ["煮込みが遅すぎ、強火"] });
    notes.push("副作用「火の粉が散る」: 煮込みが遅すぎ、強火で火の粉が散った");
  }

  return {
    effects,
    stability,
    duration,
    sideEffects: [...new Set(fired.map((sideEffect) => sideEffect.id))],
    notes,
    technique: {
      stirQuality: technique.stirQuality,
      simmer: technique.simmer,
      pours: ingredients.map(({ material, amount }) => ({ materialId: material.id, amount })),
    },
  };
}

function validateDeliveryInput(brewResult, order) {
  if (brewResult === null || typeof brewResult !== "object") {
    throw new TypeError("brewResult must be an object");
  }
  if (order === null || typeof order !== "object" || order.required === null || typeof order.required !== "object") {
    throw new TypeError("order with required conditions must be an object");
  }
  if (brewResult.effects === null || typeof brewResult.effects !== "object" || !Array.isArray(brewResult.sideEffects)) {
    throw new TypeError("brewResult must contain effects and sideEffects");
  }
}

/** Applies the required/forbidden delivery rubric in SPEC.md §8.6. */
export function judgeDelivery(brewResult, order) {
  validateDeliveryInput(brewResult, order);
  const reasons = [];
  const { required } = order;
  const potency = brewResult.effects[required.effect] ?? 0;
  const forbidden = Array.isArray(order.forbidden) ? order.forbidden : [];

  if (potency < required.min) reasons.push(`${EFFECT_NAMES[required.effect] ?? required.effect}の効力が${required.min}未満`);
  if (required.maxPotency !== undefined && potency > required.maxPotency) {
    reasons.push(`${EFFECT_NAMES[required.effect] ?? required.effect}が効きすぎている`);
  }
  if (required.duration !== undefined && brewResult.duration !== required.duration) {
    reasons.push(`持続時間が${DURATION_NAMES[required.duration] ?? required.duration}ではない`);
  }
  if (required.stabilityMin !== undefined && brewResult.stability < required.stabilityMin) {
    reasons.push(`安定度が${required.stabilityMin}未満`);
  }
  if (required.requiredSideEffect !== undefined && !brewResult.sideEffects.includes(required.requiredSideEffect)) {
    const name = SIDE_EFFECT_BY_ID[required.requiredSideEffect]?.name ?? required.requiredSideEffect;
    reasons.push(`必要な副作用「${name}」が発現していない`);
  }

  for (const condition of forbidden) {
    if (typeof condition === "string" && brewResult.sideEffects.includes(condition)) {
      reasons.push(`避けたい副作用「${SIDE_EFFECT_BY_ID[condition]?.name ?? condition}」が発現した`);
    }
    if (condition !== null && typeof condition === "object" && condition.duration !== undefined
      && brewResult.duration === condition.duration) {
      reasons.push(`避けたい持続時間「${DURATION_NAMES[condition.duration] ?? condition.duration}」になった`);
    }
  }

  if (reasons.length > 0) return { tier: "fail", reputationDelta: -1, reasons };

  const hasMajorSideEffect = brewResult.sideEffects.some(
    (id) => SIDE_EFFECT_BY_ID[id]?.severity === "major",
  );
  if (!hasMajorSideEffect && brewResult.stability >= 75) {
    return {
      tier: "great",
      reputationDelta: 3,
      reasons: ["必須条件を満たし、大きな副作用なく安定している"],
    };
  }
  return {
    tier: "ok",
    reputationDelta: 1,
    reasons: ["必須条件を満たして納品できる"],
  };
}

/** Builds concise Japanese appraisal lines from an evaluateBrew result. */
export function appraise(brewResult) {
  if (brewResult === null || typeof brewResult !== "object" || brewResult.effects === null || typeof brewResult.effects !== "object") {
    throw new TypeError("brewResult must contain effects");
  }
  const scoreLines = MAIN_EFFECTS.map((effect) => `${EFFECT_NAMES[effect]}: ${brewResult.effects[effect] ?? 0}`);
  scoreLines.push(`安定度: ${brewResult.stability ?? 0}`);
  scoreLines.push(`持続: ${DURATION_NAMES[brewResult.duration] ?? brewResult.duration ?? "mid"}`);

  const techniqueLines = [];
  const technique = brewResult.technique;
  if (technique !== null && typeof technique === "object" && !Array.isArray(technique)) {
    if (typeof technique.stirQuality === "number") {
      const verdict = technique.stirQuality >= 80
        ? "きれいな円"
        : technique.stirQuality >= 60
          ? "なめらかな円"
          : technique.stirQuality >= 40
            ? "標準"
            : "乱れた円";
      techniqueLines.push(`かき混ぜ真円度: ${displayNumber(technique.stirQuality)}（${verdict}）`);
    }
    if (Array.isArray(technique.pours)) {
      for (const pour of technique.pours) {
        if (pour === null || typeof pour !== "object") continue;
        const materialName = MATERIAL_BY_ID[pour.materialId]?.name ?? pour.materialId;
        const amountName = AMOUNT_NAMES[pour.amount] ?? pour.amount;
        techniqueLines.push(`注ぎ量 ${materialName}: ${amountName}`);
      }
    }
    if (typeof technique.simmer === "string") {
      techniqueLines.push(`煮込み: ${SIMMER_NAMES[technique.simmer] ?? technique.simmer}`);
    }
    if (technique.simmer === "late" && Array.isArray(brewResult.sideEffects)
      && brewResult.sideEffects.includes("sparks")) {
      techniqueLines.push("火の粉の理由: 煮込みが遅すぎ、強火だったため");
    }
  }

  const explanationLines = Array.isArray(brewResult.notes)
    ? brewResult.notes.filter((note) => typeof note === "string")
    : [];
  if (explanationLines.length === 0 && Array.isArray(brewResult.sideEffects)) {
    for (const id of brewResult.sideEffects) {
      scoreLines.push(`副作用「${SIDE_EFFECT_BY_ID[id]?.name ?? id}」が発現`);
    }
  }
  return [...scoreLines, ...techniqueLines, ...explanationLines];
}
