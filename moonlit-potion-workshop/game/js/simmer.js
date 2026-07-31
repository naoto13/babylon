import { MATERIAL_MARKET, RARITY_ORDER } from "./economy.js";

const TARGET_SECONDS = Object.freeze({ low: 5, mid: 3.5, high: 2.5 });

export const SIMMER_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: "common", label: "基本錬金", perfectWindow: 0.45, goodWindow: 1.1 }),
  Object.freeze({ id: "uncommon", label: "上質錬金", perfectWindow: 0.32, goodWindow: 0.75 }),
  Object.freeze({ id: "rare", label: "稀少錬金", perfectWindow: 0.22, goodWindow: 0.55 }),
]);

const rarityIndex = (rarity) => Math.max(0, RARITY_ORDER.indexOf(rarity));
const rankId = (rank) => typeof rank === "string" ? rank : rank?.id;

export function getSimmerDifficulty({ materialIds = [], workshopRank = "common" } = {}) {
  const materialIndex = materialIds.reduce((highest, materialId) => (
    Math.max(highest, rarityIndex(MATERIAL_MARKET[materialId]?.rarity))
  ), 0);
  const workshopIndex = rarityIndex(rankId(workshopRank));
  const index = Math.max(materialIndex, workshopIndex);
  const source = materialIndex > workshopIndex ? "素材"
    : workshopIndex > materialIndex ? "工房"
      : "素材・工房";
  return Object.freeze({ ...SIMMER_DIFFICULTIES[index], source });
}

/**
 * Returns a visible, deterministic timing target from the active ingredients
 * and the purchased workshop rank. Higher-grade work narrows the same target.
 */
export function getSimmerSettings({ materialIds = [], workshopRank = "common", tempBand, gentleTechnique = false } = {}) {
  const targetSeconds = TARGET_SECONDS[tempBand];
  if (!targetSeconds) throw new RangeError(`unknown simmer temperature: ${String(tempBand)}`);
  const difficulty = getSimmerDifficulty({ materialIds, workshopRank });
  const multiplier = gentleTechnique ? 1.5 : 1;
  const widenedWindow = (window) => Math.round(window * multiplier * 1000) / 1000;
  return Object.freeze({
    targetSeconds,
    perfectWindow: widenedWindow(difficulty.perfectWindow),
    goodWindow: widenedWindow(difficulty.goodWindow),
    difficulty,
  });
}
