import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
// 本編と同じ拡張を登録しておく。gltfpack 圧縮後の GLB もこの画面で検証できるようにする。
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js";

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.pure.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.pure.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js";
import { Scene } from "@babylonjs/core/scene.js";

const canvas = document.querySelector("#render-canvas");
const modelSelect = document.querySelector("#model-select");
const setSelect = document.querySelector("#set-select");
const viewSelect = document.querySelector("#view-select");
const motionSelect = document.querySelector("#motion-select");
const status = document.querySelector("#status");

const MODEL_ORDER = Object.freeze(["hero", "chaser", "shooter", "thief", "boss"]);
const FLOOR_Y = -0.025;

// new = ねんどろいど風の三面図から生成した版（三面図の3ビューを法線方向で投影済み）。
// 5体とも身長 1.0 に正規化されているので、見かけの高さは newScale がそのまま決める。
const models = Object.freeze({
  hero: {
    label: "Hero",
    // リグ付き版（Voxel Remesh → UV再展開 → 三面図投影 → 16ボーン）。身長1.8m基準。
    newPath: new URL("../assets/production/demonic/rigged/hero-nendo-rigged.glb", import.meta.url).href,
    oldPath: new URL("../assets/production/models/chrono-duelist-custom.glb", import.meta.url).href,
    // TRELLIS.2版はアニメーション込みの成果物を見たいので -animated を指す。
    trellis2Path: new URL("../assets/production/demonic/animated/hero-nendo-trellis2-animated.glb", import.meta.url).href,
    // gltfpack 圧縮後の、本編が実際に読む GLB。圧縮で見た目が変わっていないかを
    // 同じライティング下で直接比較できるようにしておく。
    packedPath: new URL("../assets/production/models/hero-nendo-trellis2.glb", import.meta.url).href,
    newScale: 1.9,
    oldScale: 1.32,
    trellis2Scale: 1.9,
    packedScale: 1.9
  },
  chaser: {
    label: "Chaser",
    newPath: new URL("../assets/production/demonic/rigged/chaser-nendo-rigged.glb", import.meta.url).href,
    oldPath: new URL("../assets/production/models/enemy-chaser-concept.glb", import.meta.url).href,
    trellis2Path: new URL("../assets/production/demonic/animated/chaser-nendo-trellis2-animated.glb", import.meta.url).href,
    packedPath: new URL("../assets/production/models/chaser-nendo-trellis2.glb", import.meta.url).href,
    newScale: 1.5,
    oldScale: 1.28,
    trellis2Scale: 1.5,
    packedScale: 1.5
  },
  shooter: {
    label: "Shooter",
    newPath: new URL("../assets/production/demonic/rigged/shooter-nendo-rigged.glb", import.meta.url).href,
    oldPath: new URL("../assets/production/models/enemy-shooter-concept.glb", import.meta.url).href,
    trellis2Path: new URL("../assets/production/demonic/animated/shooter-nendo-trellis2-animated.glb", import.meta.url).href,
    packedPath: new URL("../assets/production/models/shooter-nendo-trellis2.glb", import.meta.url).href,
    newScale: 1.8,
    oldScale: 1.24,
    trellis2Scale: 1.8,
    packedScale: 1.8
  },
  thief: {
    label: "Thief",
    newPath: new URL("../assets/production/demonic/rigged/thief-nendo-rigged.glb", import.meta.url).href,
    oldPath: new URL("../assets/production/models/enemy-thief-concept.glb", import.meta.url).href,
    trellis2Path: new URL("../assets/production/demonic/animated/thief-nendo-trellis2-animated.glb", import.meta.url).href,
    packedPath: new URL("../assets/production/models/thief-nendo-trellis2.glb", import.meta.url).href,
    newScale: 1.7,
    oldScale: 1.28,
    trellis2Scale: 1.7,
    packedScale: 1.7
  },
  boss: {
    label: "Boss",
    newPath: new URL("../assets/production/demonic/rigged/boss-nendo-rigged.glb", import.meta.url).href,
    oldPath: new URL("../assets/production/models/enemy-boss-concept.glb", import.meta.url).href,
    trellis2Path: new URL("../assets/production/demonic/animated/boss-nendo-trellis2-animated.glb", import.meta.url).href,
    packedPath: new URL("../assets/production/models/boss-nendo-trellis2.glb", import.meta.url).href,
    newScale: 2.2,
    oldScale: 1.42,
    trellis2Scale: 2.2,
    packedScale: 2.2
  }
});

const arenaTextureUrl = new URL("../assets/production/arena-clockwork.png", import.meta.url).href;
const arenaEnvironmentUrl = new URL("../assets/production/env/arena-clockwork-ibl.hdr", import.meta.url).href;
let engine;
let scene;
let shadowGenerator;
let previewItems = [];
const clockwork = [];
let loadVersion = 0;

function createMaterial(name, diffuseHex, emissiveHex = diffuseHex, emissiveStrength = 0.18) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(diffuseHex);
  material.emissiveColor = Color3.FromHexString(emissiveHex).scale(emissiveStrength);
  material.specularColor = new Color3(0.22, 0.28, 0.34);
  return material;
}

// src/main.js の createArena と同じ床・アート・発光リングを作る。
function createArena() {
  const groundMaterial = createMaterial("ground-material", "#050a12", "#071421", 0.08);
  groundMaterial.specularColor = Color3.Black();

  const ground = CreateCylinder(
    "arena-floor",
    { diameter: 38.5, height: 0.55, tessellation: 96 },
    scene
  );
  ground.position.y = -0.36;
  ground.material = groundMaterial;
  ground.isPickable = false;

  const arenaTexture = new Texture(arenaTextureUrl, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  arenaTexture.anisotropicFilteringLevel = 8;
  const arenaMaterial = new StandardMaterial("arena-art-material", scene);
  arenaMaterial.diffuseTexture = arenaTexture;
  arenaMaterial.emissiveTexture = arenaTexture;
  arenaMaterial.diffuseColor = new Color3(0.88, 0.92, 1);
  arenaMaterial.emissiveColor = new Color3(0.18, 0.22, 0.3);
  arenaMaterial.specularColor = Color3.Black();

  const arenaArt = CreatePlane("arena-art", { size: 38 }, scene);
  arenaArt.rotation.x = Math.PI / 2;
  arenaArt.position.y = -0.025;
  arenaArt.material = arenaMaterial;
  arenaArt.isPickable = false;
  arenaArt.receiveShadows = true;

  for (const [diameter, color, speed] of [
    [8.4, "#5fe4ff", 0.04],
    [16.8, "#d7a94e", -0.022],
    [28.4, "#5fe4ff", 0.013]
  ]) {
    const ring = CreateTorus(
      `clock-ring-${diameter}`,
      { diameter, thickness: diameter > 20 ? 0.055 : 0.04, tessellation: 96 },
      scene
    );
    ring.position.y = 0.055;
    const ringMaterial = createMaterial(`clock-ring-material-${diameter}`, color, color, 0.75);
    ringMaterial.alpha = diameter > 20 ? 0.2 : 0.28;
    ringMaterial.disableLighting = true;
    ring.material = ringMaterial;
    ring.isPickable = false;
    clockwork.push({ mesh: ring, speed });
  }
}

// 本編と同じ IBL/ACES/SSAO・照明条件を保ち、近接カメラだけで材質の可読性を確認する。
function initScene() {
  engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: true });
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.008, 0.018, 0.04, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.014;
  scene.fogColor = new Color3(0.018, 0.04, 0.072);
  scene.environmentTexture = new HDRCubeTexture(arenaEnvironmentUrl, scene, 256, false, true, false, true);
  scene.environmentIntensity = 0.78;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 0.98;
  scene.imageProcessingConfiguration.contrast = 1.03;

  // 本編の俯瞰カメラでは法線の段差を判定できないため、検証画面だけは同じ角度の近接構図にする。
  const cameraBasePosition = new Vector3(0, 5.9, -4.8);
  const camera = new FreeCamera("fixed-camera", cameraBasePosition.clone(), scene);
  camera.setTarget(new Vector3(0, 1.05, 0));
  camera.fov = 0.58;
  camera.minZ = 0.1;
  activeCamera = camera;

  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.92;
  ambient.diffuse = new Color3(0.48, 0.7, 0.88);
  ambient.groundColor = new Color3(0.03, 0.05, 0.09);

  const keyLight = new DirectionalLight("key-light", new Vector3(-0.55, -1, 0.45), scene);
  keyLight.position = new Vector3(12, 24, -12);
  keyLight.intensity = 1.4;
  keyLight.diffuse = new Color3(0.72, 0.9, 1);

  // 本編と同じ背面リム。装甲の段差と白銀トリムをプレビューでも読めるようにする。
  const rimLight = new DirectionalLight("rim-light", new Vector3(0.35, -0.25, -1), scene);
  rimLight.position = new Vector3(-8, 8, 16);
  rimLight.intensity = 2.0;
  rimLight.diffuse = new Color3(0.45, 0.85, 1.0);
  rimLight.shadowEnabled = false;

  shadowGenerator = new ShadowGenerator(1024, keyLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 18;
  shadowGenerator.bias = 0.0008;

  const glow = new GlowLayer("arena-glow", scene, { blurKernelSize: 32 });
  glow.intensity = 0.62;

  if (SSAO2RenderingPipeline.IsSupported) {
    const ssao = new SSAO2RenderingPipeline("arena-ssao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]);
    ssao.samples = 8;
    ssao.bilateralSamples = 6;
    ssao.totalStrength = 0.58;
    ssao.radius = 1.18;
    ssao.base = 0.03;
    ssao.epsilon = 0.03;
    ssao.expensiveBlur = true;
    ssao.bilateralSoften = 0.08;
    ssao.bilateralTolerance = 0.18;
  }

  createArena();
}

const SETS = Object.freeze(["trellis2", "packed", "new", "old"]);
// 主人公は Run/Dash/FutureSlash、敵は Move/Death を持つ。相手が持たないクリップを
// 選んでも applyMotion が無視するだけなので、両方まとめて並べておく。
const MOTIONS = Object.freeze([
  "none", "Idle", "Run", "Move", "Attack", "Dash", "Hit", "Death", "FutureSlash"
]);

function readSettings() {
  const query = new URLSearchParams(window.location.search);
  const model = query.get("model");
  const set = query.get("set");
  const view = query.get("view");
  const motion = query.get("motion");
  return {
    model: model === "all" || MODEL_ORDER.includes(model) ? model : "hero",
    set: SETS.includes(set) ? set : "trellis2",
    view: view in CAMERA_VIEWS ? view : "front",
    motion: MOTIONS.includes(motion) ? motion : "none"
  };
}

function writeSettings(settings) {
  const query = new URLSearchParams(window.location.search);
  query.set("model", settings.model);
  query.set("set", settings.set);
  query.set("view", settings.view);
  query.set("motion", settings.motion);
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
}

function disposePreviewItems() {
  for (const item of previewItems) {
    item.container.dispose();
    item.anchor.dispose();
  }
  previewItems = [];
}

function horizontalPosition(index, count) {
  if (count === 1) return 0;
  return (index - (count - 1) / 2) * 6;
}

function placeOnArena(anchor) {
  anchor.computeWorldMatrix(true);
  const meshes = anchor.getChildMeshes(false);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  const lowestY = Math.min(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
  anchor.position.y += FLOOR_Y - lowestY;
}

function sourceFor(definition, set) {
  // TRELLIS.2版・packed版が無いモデル（敵4体）は、比較のためSPAR3D版へフォールバックする。
  if (set === "trellis2") {
    return {
      path: definition.trellis2Path ?? definition.newPath,
      scale: definition.trellis2Scale ?? definition.newScale,
      isFallback: !definition.trellis2Path
    };
  }
  if (set === "packed") {
    return {
      path: definition.packedPath ?? definition.newPath,
      scale: definition.packedScale ?? definition.newScale,
      isFallback: !definition.packedPath
    };
  }
  if (set === "new") return { path: definition.newPath, scale: definition.newScale, isFallback: false };
  return { path: definition.oldPath, scale: definition.oldScale, isFallback: false };
}

async function loadModel(name, set, x, version) {
  const definition = models[name];
  const { path: source, scale, isFallback } = sourceFor(definition, set);
  const container = await LoadAssetContainerAsync(source, scene);
  if (version !== loadVersion) {
    container.dispose();
    return null;
  }

  container.addAllToScene();
  const anchor = new TransformNode(`preview-${set}-${name}`, scene);
  for (const node of container.rootNodes) node.parent = anchor;
  anchor.position.x = x;
  anchor.rotation.y = Math.PI;
  anchor.scaling.setAll(scale);
  placeOnArena(anchor);
  for (const mesh of anchor.getChildMeshes(false)) shadowGenerator.addShadowCaster(mesh);
  const animations = new Map(container.animationGroups.map((group) => [group.name, group]));
  for (const group of container.animationGroups) group.stop();
  const item = { anchor, container, label: definition.label, scale, animations, isFallback };
  // 読み込み途中にセットを切り替えても、完了済みのモデルを必ず破棄できるよう登録する。
  previewItems.push(item);
  return item;
}

function applyMotion(items, motion) {
  for (const item of items) {
    for (const group of item.animations.values()) group.stop();
    if (motion === "none") continue;
    const group = item.animations.get(motion);
    if (group) group.start(true);
  }
}

// 俯瞰の本編カメラでは装甲の陰影しか読めないので、意匠の確認用に真正面/側面/背面も選べるようにする。
// Hero は身長1.8m×スケール1.9 ≒ 3.4m あるので、全身が収まる距離まで引く。
const CAMERA_VIEWS = Object.freeze({
  front: { position: new Vector3(0, 1.8, -8.4), target: new Vector3(0, 1.7, 0), fov: 0.58 },
  game: { position: new Vector3(0, 5.9, -4.8), target: new Vector3(0, 1.05, 0), fov: 0.58 },
  side: { position: new Vector3(-8.4, 1.8, 0), target: new Vector3(0, 1.7, 0), fov: 0.58 },
  back: { position: new Vector3(0, 1.8, 8.4), target: new Vector3(0, 1.7, 0), fov: 0.58 },
  turntable: { position: new Vector3(0, 2.2, -8.4), target: new Vector3(0, 1.7, 0), fov: 0.58, spin: true }
});

let activeCamera;
let turntableEnabled = false;

function applyView(viewName) {
  const view = CAMERA_VIEWS[viewName] ?? CAMERA_VIEWS.front;
  activeCamera.position.copyFrom(view.position);
  activeCamera.setTarget(view.target);
  activeCamera.fov = view.fov;
  turntableEnabled = Boolean(view.spin);
}

const SET_LABELS = Object.freeze({
  trellis2: "TRELLIS.2 GLB",
  packed: "TRELLIS.2 packed (in-game)",
  new: "SPAR3D nendo GLB",
  old: "current game GLB"
});

function formatStatus(items, settings) {
  const kind = SET_LABELS[settings.set] ?? settings.set;
  const parts = items.map((item) => {
    const clips = item.animations.size ? `${item.animations.size} clips` : "no clips";
    const fallback = item.isFallback ? " (SPAR3D fallback)" : "";
    return `${item.label} × ${item.scale.toFixed(2)} / ${clips}${fallback}`;
  });
  return `${kind} / ${settings.view} / motion:${settings.motion} — ${parts.join(" · ")}`;
}

async function renderSelection() {
  const settings = {
    model: modelSelect.value,
    set: setSelect.value,
    view: viewSelect.value,
    motion: motionSelect.value
  };
  const version = ++loadVersion;
  writeSettings(settings);
  disposePreviewItems();
  status.dataset.state = "loading";
  status.textContent = "モデルを読み込み中…";

  const names = settings.model === "all" ? MODEL_ORDER : [settings.model];
  try {
    const items = await Promise.all(
      names.map((name, index) => loadModel(name, settings.set, horizontalPosition(index, names.length), version))
    );
    if (version !== loadVersion) return;
    previewItems = items.filter(Boolean);
    applyView(settings.view);
    applyMotion(previewItems, settings.motion);
    status.dataset.state = "ready";
    status.textContent = formatStatus(previewItems, settings);
  } catch (error) {
    if (version !== loadVersion) return;
    // 残りの並列ロードを無効化し、先に完了したモデルも片付ける。
    loadVersion += 1;
    disposePreviewItems();
    status.dataset.state = "error";
    status.textContent = `読み込み失敗: ${error.message}`;
    console.error("Asset preview model load failed", error);
  }
}

function bindControls() {
  const settings = readSettings();
  modelSelect.value = settings.model;
  setSelect.value = settings.set;
  viewSelect.value = settings.view;
  motionSelect.value = settings.motion;
  modelSelect.addEventListener("change", renderSelection);
  setSelect.addEventListener("change", renderSelection);
  // View と Motion はモデルを読み直す必要がないので、その場で反映して待ち時間をなくす。
  viewSelect.addEventListener("change", () => {
    applyView(viewSelect.value);
    const current = { model: modelSelect.value, set: setSelect.value, view: viewSelect.value, motion: motionSelect.value };
    writeSettings(current);
    status.textContent = formatStatus(previewItems, current);
  });
  motionSelect.addEventListener("change", () => {
    applyMotion(previewItems, motionSelect.value);
    const current = { model: modelSelect.value, set: setSelect.value, view: viewSelect.value, motion: motionSelect.value };
    writeSettings(current);
    status.textContent = formatStatus(previewItems, current);
  });
}

initScene();
bindControls();
renderSelection();

// 検証ページのデバッグ用。ブラウザのコンソールからシーンの状態を確認できるようにする。
window.__preview = { get engine() { return engine; }, get scene() { return scene; }, get items() { return previewItems; } };

engine.runRenderLoop(() => {
  const deltaSeconds = Math.min(0.04, engine.getDeltaTime() / 1000);
  for (const item of clockwork) item.mesh.rotation.y += item.speed * deltaSeconds;
  if (turntableEnabled) {
    for (const item of previewItems) item.anchor.rotation.y += 0.6 * deltaSeconds;
  }
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
window.addEventListener("beforeunload", () => engine.dispose());
