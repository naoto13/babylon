// 管理ダッシュボード: アセット一覧（カードグリッド）⇔ 詳細（プレビュー・比較/ソース切替・調整）
// 変更は即 localStorage 保存（rotX のみドラッグ確定時）→ ゲームタブが storage イベントで反映する
// apple-design: restraint / 明快なタイポ / 押下即時フィードバック / reduced-motion 対応
import './admin.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  ASSET_KEYS, ASSET_LABELS, MODEL_PARAM_META, WEAPON_KEYS, WEAPON_LABELS, WEAPON_PARAM_META,
  SOURCE_LABELS,
  fetchBaseConfig, mergeAssetConfig, readLocalOverride, writeLocalOverride, clearLocalOverride,
  exportConfigJson,
  type AssetConfig, type AssetKey, type AssetSource, type ParamMeta,
} from '../game/asset-config';
import { disposeOwnedObjectResources, loadModel, rotatedObject, type LoadedModel } from '../game/assets';
import { buildFallbackModel } from '../game/fallback-models';
import { PROC_BUILDERS, hasProcModel } from '../game/procedural';
import { ENEMY_TYPES } from '../game/config';

const DEG2RAD = Math.PI / 180;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** アセットの glb 目標高さ（ゲーム側と同じ基準でプレビューする） */
function glbBaseHeight(key: AssetKey): number {
  if (key === 'player') return 1.1;
  const type = ENEMY_TYPES.find((t) => t.id === key);
  return 0.95 * (type?.scale ?? 1);
}

// ---- glb ロードキャッシュ（一覧/詳細/比較で共有） ----

const modelCache = new Map<string, Promise<LoadedModel | null>>();
function cachedLoadModel(file: string): Promise<LoadedModel | null> {
  let p = modelCache.get(file);
  if (!p) {
    p = loadModel(file);
    modelCache.set(file, p);
  }
  return p;
}

/** glb ファイルサイズ（KB）。HEAD が使えない環境では null */
const sizeCache = new Map<string, Promise<number | null>>();
function fetchGlbSizeKB(file: string): Promise<number | null> {
  let p = sizeCache.get(file);
  if (!p) {
    p = fetch(`/assets/models/${file}.glb`, { method: 'HEAD' })
      .then((r) => {
        if (!r.ok) return null;
        const len = Number(r.headers.get('content-length'));
        return Number.isFinite(len) && len > 0 ? Math.round(len / 1024) : null;
      })
      .catch(() => null);
    sizeCache.set(file, p);
  }
  return p;
}

function countVerts(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const pos = mesh.geometry.getAttribute('position');
      if (pos) n += pos.count;
    }
  });
  return n;
}

function hasTexture(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as THREE.MeshStandardMaterial).map) found = true;
      }
    }
  });
  return found;
}

/**
 * 表示用オブジェクトをソース別に構築（すべて高さ1へ正規化）。
 * 向きは「ゲーム内の前方(-Z)がプレビューカメラ(+Z)を向く」= 正面が見えるよう統一。
 * 姿勢補正 rotX/rotY はゲームと同じく glb のみ適用（proc は +Z 正面 / fallback は -Z 正面の規約）。
 */
async function buildSourceObject(key: AssetKey, source: AssetSource, cfg: AssetConfig): Promise<THREE.Group | null> {
  let obj: THREE.Group | null = null;
  let gameYaw = 0; // ゲーム内でモデルに掛かる Y 回転
  if (source === 'glb') {
    const model = await cachedLoadModel(cfg.assets[key].file);
    obj = model ? rotatedObject(model.object, cfg.assets[key].rotX) : null;
    gameYaw = cfg.assets[key].rotY * DEG2RAD;
  } else if (source === 'procedural') {
    const builder = PROC_BUILDERS[key];
    obj = builder ? rotatedObject(builder(), 0, false) : null;
    gameYaw = Math.PI; // +Z 正面 → -Z 前方の規約変換（エンジン側ベイクと同じ）
  } else {
    obj = rotatedObject(buildFallbackModel(key), 0);
  }
  if (obj) obj.rotation.y = gameYaw + Math.PI; // 前方(-Z)をカメラへ
  return obj;
}

// ---- 共有ミニレンダラー: 1 WebGL コンテキストで複数の回転プレビューを描く ----

interface MiniView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Group;
  target: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

class MiniViews {
  private renderer: THREE.WebGLRenderer;
  private views = new Map<string, MiniView>();
  private lastT = performance.now();
  private curW = 0;
  private curH = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setSize(200, 200, false);
    this.renderer.setPixelRatio(1);
    const loop = () => {
      this.tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  register(id: string, target: HTMLCanvasElement): void {
    this.remove(id);
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e6f0, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(3, 5, 2);
    scene.add(dir);
    const root = new THREE.Group();
    root.rotation.y = 0.6;
    scene.add(root);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.85, 2.35);
    camera.lookAt(0, 0.45, 0);
    this.views.set(id, { scene, camera, root, target, ctx });
  }

  setObject(id: string, obj: THREE.Object3D | null): void {
    const v = this.views.get(id);
    if (!v) {
      if (obj) disposeOwnedObjectResources(obj);
      return;
    }
    for (const child of v.root.children) disposeOwnedObjectResources(child);
    v.root.clear();
    if (obj) v.root.add(obj);
    this.renderView(v); // 即時反映（rAF 停止環境でも 1 フレーム描く）
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (v) {
      for (const child of v.root.children) disposeOwnedObjectResources(child);
      v.root.clear();
    }
    this.views.delete(id);
  }

  private renderView(v: MiniView): void {
    const w = v.target.width;
    const h = v.target.height;
    // setSize は同値でもバッファをクリアするため、寸法変化時のみ呼ぶ
    if (w !== this.curW || h !== this.curH) {
      this.renderer.setSize(w, h, false);
      this.curW = w;
      this.curH = h;
    }
    this.renderer.render(v.scene, v.camera);
    v.ctx.clearRect(0, 0, w, h);
    v.ctx.drawImage(this.renderer.domElement, 0, 0, w, h);
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    const spin = !reducedMotion.matches;
    for (const v of this.views.values()) {
      if (!v.target.isConnected || v.target.offsetParent === null) continue; // 非表示ビューは描かない
      if (spin) v.root.rotation.y += dt * 0.9;
      this.renderView(v);
    }
  }

  /** orca 検証用: 指定ビューを強制レンダリングして PNG dataURL を返す */
  capture(id: string): string | null {
    const v = this.views.get(id);
    if (!v) return null;
    this.renderView(v);
    return v.target.toDataURL('image/png');
  }
}

// ---- 詳細ビューの大プレビュー（OrbitControls 付き） ----

class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private wrapper = new THREE.Group(); // tuning 適用先
  private badge: HTMLElement;
  private currentKey: AssetKey = 'player';
  private sourceKind: AssetSource = 'fallback';
  private currentModel: LoadedModel | null = null;
  private lastRotX = 0;
  private loadSeq = 0;
  private container: HTMLElement;

  constructor(container: HTMLElement, badge: HTMLElement) {
    this.badge = badge;
    this.container = container;
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 50);
    this.camera.position.set(2.1, 1.6, 2.6);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e6f0, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(3, 5, 2);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(4, 8, 0x9fb8c2, 0xc9dbe2);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);

    this.scene.add(this.wrapper);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);
    this.controls.autoRotate = !reducedMotion.matches;
    this.controls.autoRotateSpeed = 2.2;
    reducedMotion.addEventListener?.('change', () => {
      this.controls.autoRotate = !reducedMotion.matches;
    });

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);
    new ResizeObserver(resize).observe(container);

    this.renderer.setAnimationLoop(() => {
      if (this.container.offsetParent === null) return; // 一覧ビュー表示中（detail 非表示）はレンダしない
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** 表示アセット/ソースを切り替え（glb 未配置などは fallback 縮退） */
  async show(key: AssetKey, cfg: AssetConfig): Promise<void> {
    this.currentKey = key;
    const seq = ++this.loadSeq;
    const want = cfg.assets[key].source;
    // まずフォールバックを即表示（応答性優先）
    this.setObject(rotatedObject(buildFallbackModel(key), 0), 'fallback', cfg);

    if (want === 'procedural' && hasProcModel(key)) {
      this.currentModel = null;
      const obj = rotatedObject(PROC_BUILDERS[key]!(), 0, false);
      obj.rotation.y = Math.PI; // ゲームと同じ規約変換（+Z 正面 → -Z 前方）
      this.setObject(obj, 'procedural', cfg);
      return;
    }
    if (want !== 'glb') return;
    const model = await cachedLoadModel(cfg.assets[key].file);
    if (seq !== this.loadSeq || this.currentKey !== key) return; // 切替済みなら破棄
    if (model) {
      this.currentModel = model;
      this.lastRotX = cfg.assets[key].rotX;
      this.setObject(rotatedObject(model.object, this.lastRotX), 'glb', cfg);
    }
  }

  private setObject(obj: THREE.Object3D, kind: AssetSource, cfg: AssetConfig): void {
    for (const child of this.wrapper.children) disposeOwnedObjectResources(child);
    this.wrapper.clear();
    this.wrapper.add(obj);
    this.sourceKind = kind;
    if (kind !== 'glb') this.currentModel = null;
    this.badge.textContent = kind === 'fallback' ? 'フォールバック形状' : SOURCE_LABELS[kind];
    this.badge.classList.toggle('glb', kind === 'glb');
    this.badge.classList.toggle('procedural', kind === 'procedural'); // CSS の .procedural と統一
    this.applyTuning(cfg);
  }

  /** ゲーム側と同じ規則で反映: scale は全ソース、rotX/rotY/offsetY は glb のみ */
  applyTuning(cfg: AssetConfig): void {
    const t = cfg.assets[this.currentKey];
    const isGlb = this.sourceKind === 'glb';
    if (isGlb && this.currentModel && t.rotX !== this.lastRotX) {
      this.lastRotX = t.rotX;
      for (const child of this.wrapper.children) disposeOwnedObjectResources(child);
      this.wrapper.clear();
      this.wrapper.add(rotatedObject(this.currentModel.object, t.rotX));
    }
    const s = this.sourceKind === 'fallback' ? t.scale : glbBaseHeight(this.currentKey) * t.scale;
    this.wrapper.scale.setScalar(s);
    this.wrapper.rotation.y = isGlb ? t.rotY * DEG2RAD : 0;
    this.wrapper.position.y = isGlb ? t.offsetY : 0;
  }

  /** 1フレーム描画して PNG dataURL を返す（orca 検証用） */
  capture(): string {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  get kind(): AssetSource {
    return this.sourceKind;
  }
}

// ---- UI 構築ヘルパー ----

function fmtValue(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface SliderRef {
  input: HTMLInputElement;
  value: HTMLElement;
  meta: ParamMeta;
  read: () => number;
}

function buildSlider(
  meta: ParamMeta,
  read: () => number,
  onChange: (v: number) => void,
  onCommit?: (v: number) => void
): { row: HTMLElement; ref: SliderRef } {
  const row = el('div', 'param');
  const label = el('span', 'param-label', meta.label);
  const value = el('span', 'param-value', fmtValue(read(), meta.step));
  const input = el('input');
  input.type = 'range';
  input.min = String(meta.min);
  input.max = String(meta.max);
  input.step = String(meta.step);
  input.value = String(read());
  input.setAttribute('aria-label', meta.label);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = fmtValue(v, meta.step);
    onChange(v); // 1:1 の即時フィードバック（input 中も連続反映）
  });
  // 重い反映（保存→ゲーム側再ベイク）はドラッグ確定時のみに分離できる
  if (onCommit) {
    input.addEventListener('change', () => onCommit(Number(input.value)));
  }
  row.append(label, value, input);
  return { row, ref: { input, value, meta, read } };
}

// ---- 本体 ----

async function init(): Promise<void> {
  const root = document.getElementById('admin-root')!;
  const baseCfg = await fetchBaseConfig();
  const override = readLocalOverride();
  // baseCfg の入れ子参照を共有しないよう必ず clone してからマージする
  let cfg: AssetConfig = override
    ? mergeAssetConfig(structuredClone(baseCfg), override)
    : structuredClone(baseCfg);

  let selected: AssetKey = 'player';
  const weaponSliders: SliderRef[] = [];
  const mini = new MiniViews();

  // ---- header ----
  const header = el('header', 'adm-header');
  header.append(
    el('p', 'adm-eyebrow', 'INK SURVIVORS'),
    el('h1', 'adm-title', 'アセット管理'),
    el('p', 'adm-sub', '変更は自動保存され、ゲームタブに即反映されます'),
  );

  // ================= 一覧ビュー =================
  const listView = el('section', 'view view-list');
  const grid = el('div', 'dash-grid');
  listView.append(grid);

  interface CardRefs {
    badge: HTMLElement;
    meta: HTMLElement;
    canvas: HTMLCanvasElement;
  }
  const cards = new Map<AssetKey, CardRefs>();

  for (const key of ASSET_KEYS) {
    const card = el('button', 'asset-card');
    card.type = 'button';
    const wrap = el('div', 'card-canvas-wrap');
    const canvas = el('canvas');
    canvas.width = 176;
    canvas.height = 176;
    const badge = el('span', 'src-badge', '…');
    wrap.append(canvas, badge);
    const titleRow = el('div', 'card-title-row');
    const ref = el('img', 'card-ref') as HTMLImageElement;
    ref.alt = `${ASSET_LABELS[key]} 参照画像`;
    ref.src = `/assets/refs/${cfg.assets[key].file}.png`;
    ref.addEventListener('error', () => ref.classList.add('missing'));
    titleRow.append(el('span', 'card-name', ASSET_LABELS[key]), ref);
    const meta = el('p', 'card-meta', '読込中…');
    card.append(wrap, titleRow, meta);
    card.addEventListener('click', () => openDetail(key));
    grid.append(card);
    cards.set(key, { badge, meta, canvas });
    mini.register(`card:${key}`, canvas);
  }

  /** 並走した refreshCard の古い結果が新しい表示を上書きしないための世代ガード */
  const cardSeq = new Map<AssetKey, number>();

  /** カードの 3D・バッジ・メタを現在の設定で更新 */
  async function refreshCard(key: AssetKey): Promise<void> {
    const seq = (cardSeq.get(key) ?? 0) + 1;
    cardSeq.set(key, seq);
    const c = cards.get(key)!;
    const want = cfg.assets[key].source;
    const model = await cachedLoadModel(cfg.assets[key].file);
    if (cardSeq.get(key) !== seq) return; // 新しい更新が走り出していたら破棄
    // 実効ソース解決（ゲームと同じ縮退規則）
    const effective: AssetSource =
      want === 'glb' ? (model ? 'glb' : 'fallback')
      : want === 'procedural' ? (hasProcModel(key) ? 'procedural' : 'fallback')
      : 'fallback';
    c.badge.textContent = SOURCE_LABELS[effective];
    c.badge.className = `src-badge ${effective}`;
    const obj = await buildSourceObject(key, effective, cfg);
    if (cardSeq.get(key) !== seq) {
      if (obj) disposeOwnedObjectResources(obj);
      return;
    }
    mini.setObject(`card:${key}`, obj);
    // メタ: glb 基準（無ければ実効ソースの頂点数のみ）
    const sizeKB = await fetchGlbSizeKB(cfg.assets[key].file);
    if (cardSeq.get(key) !== seq) return;
    if (model) {
      const verts = countVerts(model.object).toLocaleString();
      const tex = hasTexture(model.object) ? 'テクスチャあり' : 'テクスチャなし';
      c.meta.textContent = `${verts} 頂点 · ${sizeKB !== null ? `${sizeKB.toLocaleString()} KB` : 'サイズ不明'} · ${tex}`;
    } else if (obj) {
      c.meta.textContent = `${countVerts(obj).toLocaleString()} 頂点 · GLB 未配置`;
    } else {
      c.meta.textContent = 'GLB 未配置';
    }
  }

  // ================= 詳細ビュー =================
  const detailView = el('section', 'view view-detail');
  detailView.hidden = true;

  const detailNav = el('div', 'detail-nav');
  const backBtn = el('button', 'back-btn', '← 一覧');
  backBtn.type = 'button';
  const detailTitle = el('h2', 'detail-title', '');
  detailNav.append(backBtn, detailTitle);

  // 大プレビュー
  const previewCard = el('section', 'adm-card');
  previewCard.append(el('h2', undefined, 'プレビュー'));
  const previewWrap = el('div', 'preview-wrap');
  const previewBadge = el('span', 'preview-badge', '…');
  previewWrap.append(previewBadge);
  previewCard.append(previewWrap);

  // 比較・ソース切替
  const compareCard = el('section', 'adm-card');
  compareCard.append(el('h2', undefined, '比較・ソース切替'));
  const compareRow = el('div', 'compare-row');
  compareCard.append(compareRow, el('p', 'compare-hint', 'タイルを選ぶとゲームの表示ソースが切り替わります'));

  // 調整スライダー
  const modelCard = el('section', 'adm-card');
  const modelTitle = el('h2', undefined, '配置調整');
  const modelParams = el('div');
  modelCard.append(modelTitle, modelParams);

  // 武器パラメータ
  const weaponCard = el('section', 'adm-card');
  weaponCard.append(el('h2', undefined, '武器パラメータ'));
  for (const wk of WEAPON_KEYS) {
    const wrap = el('div', 'weapon-card');
    const head = el('div', 'weapon-head');
    head.append(
      el('span', 'weapon-name', WEAPON_LABELS[wk]),
      el('span', 'weapon-note', wk === 'shot' ? '初期武器' : 'レベルアップで解放'),
    );
    wrap.append(head);
    for (const meta of WEAPON_PARAM_META[wk]) {
      const { row, ref } = buildSlider(
        meta,
        () => (cfg.weapons[wk] as unknown as Record<string, number>)[meta.key],
        (v) => {
          (cfg.weapons[wk] as unknown as Record<string, number>)[meta.key] = v;
          save();
        }
      );
      weaponSliders.push(ref);
      wrap.append(row);
    }
    weaponCard.append(wrap);
  }

  // アクション
  const actionsCard = el('section', 'adm-card');
  const actions = el('div', 'actions');
  const exportBtn = el('button', 'btn btn-primary', 'JSON エクスポート');
  exportBtn.type = 'button';
  const resetBtn = el('button', 'btn btn-ghost', 'リセット');
  resetBtn.type = 'button';
  actions.append(exportBtn, resetBtn);
  const saveNote = el('p', 'save-note', '保存しました');
  actionsCard.append(actions, saveNote);

  detailView.append(detailNav, previewCard, compareCard, modelCard, weaponCard, actionsCard);
  root.append(header, listView, detailView);

  const preview = new Preview(previewWrap, previewBadge);

  // ---- 保存（即 localStorage → ゲームは storage イベントで反映） ----
  let saveNoteTimer = 0;
  function save(): void {
    writeLocalOverride(cfg);
    saveNote.classList.add('shown');
    window.clearTimeout(saveNoteTimer);
    saveNoteTimer = window.setTimeout(() => saveNote.classList.remove('shown'), 1200);
  }

  // ---- 比較タイル ----
  const TILE_DEFS: { source: AssetSource | 'ref'; label: string }[] = [
    { source: 'ref', label: '参照画像' },
    { source: 'glb', label: 'GLB' },
    { source: 'procedural', label: '手続き' },
    { source: 'fallback', label: 'フォールバック' },
  ];

  /** 並走した rebuildCompare の古い結果が新しい表示に混ざらないための世代ガード */
  let compareSeq = 0;

  async function rebuildCompare(): Promise<void> {
    const seq = ++compareSeq;
    const key = selected; // await 中に selected が変わっても、このビルドは開始時点のアセットに固定
    for (const def of TILE_DEFS) {
      if (def.source !== 'ref') mini.remove(`tile:${def.source}`);
    }
    compareRow.textContent = '';
    const model = await cachedLoadModel(cfg.assets[key].file);
    if (seq !== compareSeq) return; // 新しいビルドが走り出していたら破棄
    for (const def of TILE_DEFS) {
      if (def.source === 'procedural' && !hasProcModel(key)) continue; // 手続きは実装済みアセットのみ
      const tile = el('button', 'tile');
      tile.type = 'button';
      tile.dataset.source = def.source;
      const head = el('span', 'tile-label', def.label);
      tile.append(head);
      if (def.source === 'ref') {
        const img = el('img', 'tile-img') as HTMLImageElement;
        img.alt = '参照画像';
        img.src = `/assets/refs/${cfg.assets[key].file}.png`;
        img.addEventListener('error', () => {
          img.replaceWith(el('span', 'tile-none', '参照なし'));
        });
        tile.append(img);
        tile.disabled = true; // 参照は選択対象外
      } else {
        const canvas = el('canvas', 'tile-canvas');
        canvas.width = 120;
        canvas.height = 120;
        tile.append(canvas);
        const id = `tile:${def.source}`;
        mini.register(id, canvas);
        const obj = await buildSourceObject(key, def.source, cfg);
        if (seq !== compareSeq) {
          if (obj) disposeOwnedObjectResources(obj);
          return;
        }
        mini.setObject(id, obj);
        if (def.source === 'glb' && !model) {
          tile.classList.add('unavailable');
          tile.append(el('span', 'tile-none', 'GLB 未配置'));
        }
        tile.classList.toggle('active', cfg.assets[key].source === def.source);
        tile.addEventListener('click', () => {
          cfg.assets[key].source = def.source as AssetSource;
          save();
          for (const t of compareRow.querySelectorAll('.tile')) {
            t.classList.toggle('active', (t as HTMLElement).dataset.source === def.source);
          }
          rebuildModelSliders(); // 姿勢スライダーの有効/無効を source に追従
          void preview.show(key, cfg);
          void refreshCard(key);
        });
      }
      compareRow.append(tile);
    }
  }

  // ---- 調整スライダー（選択アセットに応じて張り替え） ----
  const POSE_KEYS = ['rotX', 'rotY', 'offsetY']; // 姿勢補正は glb ソースのみ有効
  function rebuildModelSliders(): void {
    modelParams.textContent = '';
    modelTitle.textContent = `${ASSET_LABELS[selected]} の配置調整`;
    const isGlbSource = cfg.assets[selected].source === 'glb';
    for (const meta of MODEL_PARAM_META) {
      // rotX はゲーム側で geometry 再ベイク + InstancedMesh 再生成を伴うため、
      // ドラッグ中(input)はプレビューのみ更新し、確定(change)時に一度だけ保存する
      const isRotX = meta.key === 'rotX';
      const { row, ref } = buildSlider(
        meta,
        () => (cfg.assets[selected] as unknown as Record<string, number>)[meta.key],
        (v) => {
          (cfg.assets[selected] as unknown as Record<string, number>)[meta.key] = v;
          preview.applyTuning(cfg);
          if (!isRotX) save();
        },
        isRotX ? () => save() : undefined
      );
      // 姿勢補正は glb のみ効くため、他ソースでは無効化して「効かない操作」を見せない
      if (POSE_KEYS.includes(meta.key) && !isGlbSource) {
        ref.input.disabled = true;
        row.classList.add('disabled');
      }
      modelParams.append(row);
    }
    if (!isGlbSource) {
      modelParams.append(el('p', 'model-hint', '姿勢補正（起こす・向き・高さ）は GLB ソースのみ有効です'));
    }
  }

  // ---- ビュー遷移 ----
  function openDetail(key: AssetKey): void {
    selected = key;
    detailTitle.textContent = ASSET_LABELS[key];
    listView.hidden = true;
    detailView.hidden = false;
    detailView.classList.remove('entered');
    requestAnimationFrame(() => detailView.classList.add('entered'));
    rebuildModelSliders();
    void preview.show(key, cfg);
    void rebuildCompare();
    window.scrollTo({ top: 0 });
  }

  function backToList(): void {
    detailView.hidden = true;
    listView.hidden = false;
    for (const def of TILE_DEFS) {
      if (def.source !== 'ref') mini.remove(`tile:${def.source}`);
    }
    void refreshAllCards();
  }
  backBtn.addEventListener('click', backToList);

  async function refreshAllCards(): Promise<void> {
    await Promise.all(ASSET_KEYS.map((k) => refreshCard(k)));
  }

  function refreshAllSliders(): void {
    for (const s of weaponSliders) {
      s.input.value = String(s.read());
      s.value.textContent = fmtValue(s.read(), s.meta.step);
    }
    if (!detailView.hidden) rebuildModelSliders();
  }

  // ---- export ----
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([exportConfigJson(cfg)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'asset-config.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---- reset（誤操作防止に 2 段階。モーダルは使わない） ----
  let armed = false;
  let armTimer = 0;
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = 'もう一度押して確定';
      resetBtn.classList.add('confirm');
      armTimer = window.setTimeout(() => {
        armed = false;
        resetBtn.textContent = 'リセット';
        resetBtn.classList.remove('confirm');
      }, 2500);
      return;
    }
    window.clearTimeout(armTimer);
    armed = false;
    resetBtn.textContent = 'リセット';
    resetBtn.classList.remove('confirm');
    // removeItem でも storage イベントは発火するのでゲーム側はデフォルトへ戻る
    clearLocalOverride();
    cfg = structuredClone(baseCfg);
    refreshAllSliders();
    if (!detailView.hidden) {
      void preview.show(selected, cfg);
      void rebuildCompare();
    }
    void refreshAllCards();
    saveNote.textContent = 'デフォルトに戻しました';
    saveNote.classList.add('shown');
    window.setTimeout(() => {
      saveNote.classList.remove('shown');
      saveNote.textContent = '保存しました';
    }, 1500);
  });

  void refreshAllCards();

  // DEV 限定: orca eval からの検証用フック
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__admin = {
      capture: () => preview.capture(),
      captureCard: (key: AssetKey) => mini.capture(`card:${key}`),
      captureTile: (source: string) => mini.capture(`tile:${source}`),
      get cfg() { return cfg; },
      get selected() { return selected; },
      get previewKind() { return preview.kind; },
      get view() { return detailView.hidden ? 'list' : 'detail'; },
      openDetail,
      backToList,
      refreshAllCards,
    };
  }
}

void init();
