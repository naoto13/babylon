import { MATERIAL_BY_ID } from "./data.js";

/** Browser-only, versioned persistence for the workshop's player-owned state. */

export const SAVE_KEY = "moonlit-potion-workshop.save";
export const SAVE_VERSION = 1;

const TEMP_BANDS = new Set(["low", "mid", "high"]);
const PREPS = new Set(["none", "cut", "crush"]);
const AMOUNTS = new Set(["scant", "standard", "ideal", "heavy"]);
const SIMMER_RESULTS = new Set(["none", "perfect", "good", "early", "late"]);
const PHASES = new Set([
  "TITLE", "NIGHT_INTRO", "ORDER", "CRAFT", "APPRAISE", "DELIVER", "EPILOGUE", "ENDING",
]);

export function freshGameState() {
  return {
    reputation: 0,
    night: 1,
    orderIndex: 0,
    phase: "TITLE",
    questionAsked: false,
    dialogue: "",
    brew: { items: [], tempBand: "mid", stirLaps: 0, preps: {}, technique: { stirQuality: 50, simmer: "none" } },
    appraisal: null,
    delivery: null,
    journal: [],
    holdShelf: [null, null],
    settings: { numericValues: false, gentleTechnique: false },
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function validItem(item) {
  return isRecord(item) && typeof item.materialId === "string"
    && Boolean(MATERIAL_BY_ID[item.materialId]) && PREPS.has(item.prep)
    && (item.amount === undefined || AMOUNTS.has(item.amount));
}

function validTechnique(technique) {
  return technique === undefined || (isRecord(technique)
    && (technique.stirQuality === undefined || (Number.isFinite(technique.stirQuality) && technique.stirQuality >= 0 && technique.stirQuality <= 100))
    && (technique.simmer === undefined || SIMMER_RESULTS.has(technique.simmer)));
}

function validBrew(brew) {
  return isRecord(brew)
    && Array.isArray(brew.items)
    && brew.items.length <= 4
    && brew.items.every(validItem)
    && TEMP_BANDS.has(brew.tempBand)
    && Number.isFinite(brew.stirLaps)
    && brew.stirLaps >= 0
    && brew.stirLaps <= 10
    && isRecord(brew.preps)
    && Object.values(brew.preps).every((prep) => PREPS.has(prep))
    && validTechnique(brew.technique);
}

function validResult(result) {
  return isRecord(result)
    && isRecord(result.effects)
    && Number.isFinite(result.stability)
    && result.stability >= 0 && result.stability <= 100
    && ["short", "mid", "long"].includes(result.duration)
    && ["calm", "wake", "heal", "shift"].every((effect) => Number.isFinite(result.effects[effect]))
    && Array.isArray(result.sideEffects) && result.sideEffects.every((effect) => typeof effect === "string")
    && Array.isArray(result.notes) && result.notes.every((note) => typeof note === "string");
}

function validBottle(bottle) {
  return isRecord(bottle)
    && validBrew({ ...bottle.input, preps: bottle.input?.preps ?? {} })
    && bottle.input.items.length >= 2
    && validResult(bottle.result);
}

function validJournalEntry(entry) {
  return isRecord(entry)
    && validBrew({ ...entry.input, preps: entry.input?.preps ?? {} })
    && entry.input.items.length >= 2
    && validResult(entry.result)
    && typeof entry.recordedAt === "string";
}

function validDelivery(delivery) {
  return isRecord(delivery)
    && isRecord(delivery.judgement)
    && ["great", "ok", "fail"].includes(delivery.judgement.tier)
    && Number.isInteger(delivery.judgement.reputationDelta)
    && Array.isArray(delivery.judgement.reasons)
    && ["current", "shelf"].includes(delivery.source);
}

/**
 * Validates the complete persisted shape. A malformed / old / hand-edited save
 * is deliberately treated as no save so it cannot strand the player mid-order.
 */
export function validateSavedState(candidate) {
  if (!isRecord(candidate) || candidate.v !== SAVE_VERSION || !isRecord(candidate.state)) return null;
  const { state } = candidate;
  if (!Number.isInteger(state.reputation) || !Number.isInteger(state.night) || state.night < 1 || state.night > 3 || !Number.isInteger(state.orderIndex)
    || state.orderIndex < 0 || state.orderIndex > 12 || !PHASES.has(state.phase)
    || !validBrew(state.brew) || !Array.isArray(state.journal) || !state.journal.every(validJournalEntry) || !Array.isArray(state.holdShelf)
    || state.holdShelf.length !== 2 || !isRecord(state.settings)) return null;
  if (!state.holdShelf.every((bottle) => bottle === null || validBottle(bottle))) return null;
  if (state.appraisal !== null && (!isRecord(state.appraisal)
    || !validBrew({ ...state.appraisal.input, preps: state.appraisal.input?.preps ?? {} })
    || !validResult(state.appraisal.result) || !Array.isArray(state.appraisal.lines)
    || !state.appraisal.lines.every((line) => typeof line === "string"))) return null;
  if (state.delivery !== null && !validDelivery(state.delivery)) return null;
  if ((state.phase === "EPILOGUE" && state.delivery === null)
    || (state.phase === "APPRAISE" && state.appraisal === null)
    || (state.phase === "DELIVER" && state.appraisal === null)
    || (state.orderIndex === 12 && !["ENDING", "TITLE"].includes(state.phase))
    || (state.orderIndex < 12 && state.phase === "ENDING")) return null;

  const sanitized = clone(state);
  sanitized.night = Math.min(3, Math.max(1, Math.floor(sanitized.orderIndex / 4) + 1));
  sanitized.questionAsked = Boolean(sanitized.questionAsked);
  sanitized.dialogue = typeof sanitized.dialogue === "string" ? sanitized.dialogue : "";
  sanitized.settings.numericValues = Boolean(sanitized.settings.numericValues);
  sanitized.settings.gentleTechnique = Boolean(sanitized.settings.gentleTechnique);
  sanitized.brew.technique = {
    stirQuality: sanitized.brew.technique?.stirQuality ?? 50,
    simmer: sanitized.brew.technique?.simmer ?? "none",
  };
  sanitized.brew.items = sanitized.brew.items.map((item) => ({ ...item, amount: item.amount ?? "standard" }));
  return sanitized;
}

function browserStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadGame() {
  const storage = browserStorage();
  if (!storage) return freshGameState();
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return freshGameState();
    return validateSavedState(JSON.parse(raw)) ?? freshGameState();
  } catch {
    return freshGameState();
  }
}

export function saveGame(state) {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, state: clone(state) }));
    return true;
  } catch {
    return false;
  }
}

export function clearGame() {
  const storage = browserStorage();
  try {
    storage?.removeItem(SAVE_KEY);
  } catch {
    // Private mode / a full quota must not prevent starting a new workshop.
  }
}
