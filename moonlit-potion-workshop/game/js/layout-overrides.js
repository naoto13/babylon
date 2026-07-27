export const LAYOUT_OVERRIDES_KEY = "moonlit-layout-overrides";

const TABLE_BOUNDS = Object.freeze({ minX: -5.5, maxX: 5.5, minZ: -2, maxZ: 4 });
const HEIGHT_BOUNDS = Object.freeze({ min: 0.3, max: 3.5 });
const SCALE_BOUNDS = Object.freeze({ min: 0.3, max: 4 });
const TAU = Math.PI * 2;
let inMemoryOverrides = {};
let useInMemoryFallback = false;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const wrapAngle = (value) => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;

function cloneOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { ...value }]));
}

function normaliseOverride(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const override = {};
  if (finiteNumber(value.x)) override.x = clamp(value.x, TABLE_BOUNDS.minX, TABLE_BOUNDS.maxX);
  if (finiteNumber(value.y)) override.y = clamp(value.y, HEIGHT_BOUNDS.min, HEIGHT_BOUNDS.max);
  if (finiteNumber(value.z)) override.z = clamp(value.z, TABLE_BOUNDS.minZ, TABLE_BOUNDS.maxZ);
  if (finiteNumber(value.rotY)) override.rotY = wrapAngle(value.rotY);
  if (finiteNumber(value.rotX)) override.rotX = wrapAngle(value.rotX);
  if (finiteNumber(value.rotZ)) override.rotZ = wrapAngle(value.rotZ);
  if (finiteNumber(value.scaleMul)) override.scaleMul = clamp(value.scaleMul, SCALE_BOUNDS.min, SCALE_BOUNDS.max);
  if (finiteNumber(value.yOffset)) override.yOffset = value.yOffset;
  return Object.keys(override).length ? override : null;
}

function normaliseOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, override]) => [key, normaliseOverride(override)])
    .filter(([, override]) => override));
}

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeOverrides(overrides) {
  inMemoryOverrides = cloneOverrides(overrides);
  const browserStorage = storage();
  if (!browserStorage) {
    useInMemoryFallback = true;
    return false;
  }
  try {
    browserStorage.setItem(LAYOUT_OVERRIDES_KEY, JSON.stringify(overrides));
    useInMemoryFallback = false;
    return true;
  } catch {
    // Private browsing and quota failures still leave this editor session usable.
    useInMemoryFallback = true;
    return false;
  }
}

export function getLayoutOverrides() {
  if (useInMemoryFallback) return cloneOverrides(inMemoryOverrides);
  const browserStorage = storage();
  if (!browserStorage) {
    useInMemoryFallback = true;
    return cloneOverrides(inMemoryOverrides);
  }
  let raw;
  try {
    raw = browserStorage.getItem(LAYOUT_OVERRIDES_KEY);
  } catch {
    useInMemoryFallback = true;
    return cloneOverrides(inMemoryOverrides);
  }
  if (!raw) {
    inMemoryOverrides = {};
    return {};
  }
  try {
    inMemoryOverrides = normaliseOverrides(JSON.parse(raw));
    return cloneOverrides(inMemoryOverrides);
  } catch {
    // A hand-edited or interrupted value must never prevent scene boot.
    inMemoryOverrides = {};
    return {};
  }
}

export function saveLayoutOverride(key, override) {
  const normalised = normaliseOverride(override);
  if (!normalised) return false;
  const overrides = getLayoutOverrides();
  overrides[key] = normalised;
  return writeOverrides(overrides);
}

export function removeLayoutOverride(key) {
  const overrides = getLayoutOverrides();
  delete overrides[key];
  return writeOverrides(overrides);
}

export function clearLayoutOverrides() {
  inMemoryOverrides = {};
  const browserStorage = storage();
  if (!browserStorage) {
    useInMemoryFallback = true;
    return false;
  }
  try {
    browserStorage.removeItem(LAYOUT_OVERRIDES_KEY);
    useInMemoryFallback = false;
    return true;
  } catch {
    useInMemoryFallback = true;
    return false;
  }
}
