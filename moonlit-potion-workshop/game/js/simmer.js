const TARGET_SECONDS = Object.freeze({ low: 5, mid: 3.5, high: 2.5 });

export const SIMMER_DIFFICULTIES = Object.freeze([
  Object.freeze({ id: "apprentice", label: "第1夜・見習い", perfectWindow: 0.45, goodWindow: 1.1 }),
  Object.freeze({ id: "adept", label: "第2夜・熟練", perfectWindow: 0.32, goodWindow: 0.75 }),
  Object.freeze({ id: "master", label: "第3夜・極意", perfectWindow: 0.22, goodWindow: 0.55 }),
]);

export function getSimmerDifficulty(orderIndex = 0) {
  const safeOrderIndex = Number.isFinite(orderIndex) ? Math.max(0, Math.floor(orderIndex)) : 0;
  return SIMMER_DIFFICULTIES[Math.min(SIMMER_DIFFICULTIES.length - 1, Math.floor(safeOrderIndex / 4))];
}

/**
 * Returns the visible timing target for the current order without adding RNG.
 * Higher nights narrow the same target zone, so players can learn and improve.
 */
export function getSimmerSettings({ orderIndex = 0, tempBand, gentleTechnique = false } = {}) {
  const targetSeconds = TARGET_SECONDS[tempBand];
  if (!targetSeconds) throw new RangeError(`unknown simmer temperature: ${String(tempBand)}`);
  const difficulty = getSimmerDifficulty(orderIndex);
  const multiplier = gentleTechnique ? 1.5 : 1;
  const widenedWindow = (window) => Math.round(window * multiplier * 1000) / 1000;
  return Object.freeze({
    targetSeconds,
    perfectWindow: widenedWindow(difficulty.perfectWindow),
    goodWindow: widenedWindow(difficulty.goodWindow),
    difficulty,
  });
}
