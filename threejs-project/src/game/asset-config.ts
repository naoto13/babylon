// アセット/武器チューニング設定
// 優先順位: 組み込みデフォルト < public/assets/asset-config.json < localStorage 上書き
// admin.html が localStorage に書き、ゲームは起動時 + storage イベントで反映する

export const ASSET_CONFIG_LS_KEY = 'ink-survivors/asset-config';
export const ASSET_CONFIG_URL = '/assets/asset-config.json';

export const ASSET_KEYS = ['player', 'blob', 'dart', 'tank'] as const;
export type AssetKey = (typeof ASSET_KEYS)[number];

export const WEAPON_KEYS = ['shot', 'bomb', 'spinner'] as const;
export type WeaponKey = (typeof WEAPON_KEYS)[number];

export const ASSET_SOURCES = ['glb', 'procedural', 'fallback'] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

export const SOURCE_LABELS: Record<AssetSource, string> = {
  glb: 'GLB',
  procedural: 'PROC',
  fallback: 'FALLBACK',
};

export interface ModelTuning {
  /** public/assets/models/<file>.glb のベース名 */
  file: string;
  /** 表示に使うソース。glb 未配置/手続きモデル未実装時は fallback へ自動縮退 */
  source: AssetSource;
  /** 自動フィットサイズへの倍率 */
  scale: number;
  /** X 回転（度）: 横倒しモデルを立てる。回転後に接地・高さを再正規化してベイクする（glb のみ） */
  rotX: number;
  /** Y 回転（度）: モデルの正面をゲームの正面(-Z)へ合わせる */
  rotY: number;
  /** 接地からの上下オフセット（world units） */
  offsetY: number;
}

export interface ShotParams {
  fireInterval: number;
  damage: number;
  projectileSpeed: number;
  projectileLife: number;
  splashRadius: number;
}

export interface BombParams {
  fireInterval: number;
  damage: number;
  throwSpeed: number;
  blastRadius: number;
}

export interface SpinnerParams {
  fireInterval: number;
  damage: number;
  projectileSpeed: number;
  projectileLife: number;
  spreadDeg: number;
}

export interface AssetConfig {
  version: number;
  assets: Record<AssetKey, ModelTuning>;
  weapons: { shot: ShotParams; bomb: BombParams; spinner: SpinnerParams };
}

export const DEFAULT_ASSET_CONFIG: AssetConfig = {
  version: 1,
  assets: {
    player: { file: 'player_squid', source: 'glb', scale: 1, rotX: 0, rotY: 0, offsetY: 0 },
    blob: { file: 'enemy_blob', source: 'glb', scale: 1, rotX: 0, rotY: 0, offsetY: 0 },
    dart: { file: 'enemy_dart', source: 'glb', scale: 1, rotX: 0, rotY: 0, offsetY: 0 },
    tank: { file: 'enemy_tank', source: 'glb', scale: 1, rotX: 0, rotY: 0, offsetY: 0 },
  },
  weapons: {
    shot: { fireInterval: 0.5, damage: 2, projectileSpeed: 16, projectileLife: 1.4, splashRadius: 0.75 },
    bomb: { fireInterval: 2.6, damage: 5, throwSpeed: 11, blastRadius: 2.4 },
    spinner: { fireInterval: 0.09, damage: 0.7, projectileSpeed: 22, projectileLife: 0.7, spreadDeg: 16 },
  },
};

// ---- 表示メタ（admin UI 用） ----

export const ASSET_LABELS: Record<AssetKey, string> = {
  player: 'プレイヤー',
  blob: 'ブロブ',
  dart: 'ダート',
  tank: 'タンク',
};

export const WEAPON_LABELS: Record<WeaponKey, string> = {
  shot: 'インクショット',
  bomb: 'スプラッシュボム',
  spinner: 'スピナー',
};

export interface ParamMeta {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const MODEL_PARAM_META: ParamMeta[] = [
  { key: 'scale', label: 'スケール', min: 0.2, max: 3, step: 0.05 },
  { key: 'rotX', label: '起こす（X°）', min: -180, max: 180, step: 5 },
  { key: 'rotY', label: '向き（Y°）', min: -180, max: 180, step: 5 },
  { key: 'offsetY', label: '高さ', min: -1, max: 1.5, step: 0.05 },
];

export const WEAPON_PARAM_META: Record<WeaponKey, ParamMeta[]> = {
  shot: [
    { key: 'fireInterval', label: '発射間隔（s）', min: 0.08, max: 1.5, step: 0.01 },
    { key: 'damage', label: 'ダメージ', min: 0.5, max: 10, step: 0.5 },
    { key: 'projectileSpeed', label: '弾速', min: 6, max: 30, step: 1 },
    { key: 'projectileLife', label: '弾の寿命（s）', min: 0.4, max: 3, step: 0.1 },
    { key: 'splashRadius', label: 'スプラッシュ範囲', min: 0, max: 3, step: 0.25 },
  ],
  bomb: [
    { key: 'fireInterval', label: '発射間隔（s）', min: 0.8, max: 6, step: 0.1 },
    { key: 'damage', label: 'ダメージ', min: 1, max: 15, step: 0.5 },
    { key: 'throwSpeed', label: '投擲速度', min: 5, max: 20, step: 0.5 },
    { key: 'blastRadius', label: '爆発範囲', min: 1, max: 5, step: 0.1 },
  ],
  spinner: [
    { key: 'fireInterval', label: '発射間隔（s）', min: 0.03, max: 0.5, step: 0.01 },
    { key: 'damage', label: 'ダメージ', min: 0.2, max: 5, step: 0.1 },
    { key: 'projectileSpeed', label: '弾速', min: 8, max: 35, step: 1 },
    { key: 'projectileLife', label: '弾の寿命（s）', min: 0.2, max: 2, step: 0.05 },
    { key: 'spreadDeg', label: '拡散角（°）', min: 0, max: 45, step: 1 },
  ],
};

// ---- マージ・読み書き ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** base の形だけを信じ、patch から同名キーの妥当な値のみ上書きする（未知キーは無視） */
function mergeInto<T>(base: T, patch: unknown): T {
  if (!isRecord(patch) || !isRecord(base)) return base;
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(base as Record<string, unknown>)) {
    const bv = (base as Record<string, unknown>)[key];
    const pv = patch[key];
    if (pv === undefined) continue;
    if (typeof bv === 'number') {
      // 型ガード強化: Number(null)=0 / Number('')=0 / Number(true)=1 の受理を防ぐ
      if (typeof pv === 'number' && Number.isFinite(pv)) out[key] = pv;
    } else if (typeof bv === 'string') {
      if (typeof pv === 'string' && pv.length > 0 && pv.length < 200) out[key] = pv;
    } else if (isRecord(bv)) {
      out[key] = mergeInto(bv, pv);
    }
  }
  return out as T;
}

/** ParamMeta の min/max で数値を丸める（未知の外部値による極端な設定を防ぐ） */
function clampParams(obj: Record<string, unknown>, metas: ParamMeta[]): void {
  for (const m of metas) {
    const v = obj[m.key];
    if (typeof v === 'number') obj[m.key] = Math.min(m.max, Math.max(m.min, v));
  }
}

export function mergeAssetConfig(base: AssetConfig, patch: unknown): AssetConfig {
  // mergeInto はパッチが無い枝で base の入れ子参照を共有するため、
  // クランプ（mutate）の前に必ず clone して base/DEFAULT を汚染しない
  const cfg = structuredClone(mergeInto(base, patch));
  for (const key of ASSET_KEYS) {
    clampParams(cfg.assets[key] as unknown as Record<string, unknown>, MODEL_PARAM_META);
    // source は許可リスト検証（未知の文字列は既定 'glb' へ）
    if (!ASSET_SOURCES.includes(cfg.assets[key].source)) cfg.assets[key].source = 'glb';
  }
  for (const wk of WEAPON_KEYS) {
    clampParams(cfg.weapons[wk] as unknown as Record<string, unknown>, WEAPON_PARAM_META[wk]);
  }
  return cfg;
}

/** localStorage の上書きを読む（壊れていれば null） */
export function readLocalOverride(): unknown | null {
  try {
    const raw = localStorage.getItem(ASSET_CONFIG_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeLocalOverride(cfg: AssetConfig): void {
  try {
    localStorage.setItem(ASSET_CONFIG_LS_KEY, JSON.stringify(cfg));
  } catch {
    // private mode 等で書けなくても致命ではない
  }
}

export function clearLocalOverride(): void {
  try {
    localStorage.removeItem(ASSET_CONFIG_LS_KEY);
  } catch {
    /* noop */
  }
}

/** JSON デフォルトを fetch して組み込みデフォルトへマージ（失敗時は組み込みのみ） */
export async function fetchBaseConfig(): Promise<AssetConfig> {
  try {
    const res = await fetch(ASSET_CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_ASSET_CONFIG;
    const json: unknown = await res.json();
    return mergeAssetConfig(DEFAULT_ASSET_CONFIG, json);
  } catch {
    return DEFAULT_ASSET_CONFIG;
  }
}

/** 実効 config = JSON デフォルト + localStorage 上書き */
export async function loadAssetConfig(): Promise<AssetConfig> {
  const base = await fetchBaseConfig();
  const override = readLocalOverride();
  return override ? mergeAssetConfig(base, override) : base;
}

/**
 * 別タブ（admin）からの localStorage 変更を購読する。
 * storage イベントは他タブの書き込みでのみ発火する仕様を利用。
 */
export function onAssetConfigChange(base: AssetConfig, cb: (cfg: AssetConfig) => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== null && e.key !== ASSET_CONFIG_LS_KEY) return;
    const override = readLocalOverride();
    cb(override ? mergeAssetConfig(base, override) : base);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function exportConfigJson(cfg: AssetConfig): string {
  return JSON.stringify(cfg, null, 2) + '\n';
}
