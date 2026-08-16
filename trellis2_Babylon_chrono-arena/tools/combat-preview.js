import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
// 本編と同じ拡張を全て登録する。KHR_texture_transform が無いと圧縮GLBのUVが黙ってずれる。
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js";

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Viewport } from "@babylonjs/core/Maths/math.viewport.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.pure.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.pure.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.pure.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder.pure.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js";
import { Scene } from "@babylonjs/core/scene.js";

import { TexturedEffectController } from "../src/textured-effects.js";

const canvas = document.querySelector("#render-canvas");
const labelsLayer = document.querySelector("#motion-labels");
const modeSelect = document.querySelector("#mode-select");
const modelSelect = document.querySelector("#model-select");
const slowSelect = document.querySelector("#slow-select");
const attackControls = document.querySelector("#attack-controls");
const attackButtons = [...document.querySelectorAll("[data-attack]")];
const modeHint = document.querySelector("#mode-hint");
const status = document.querySelector("#status");

const FLOOR_Y = -0.025;
const MODEL_ORDER = Object.freeze(["hero", "chaser", "shooter", "thief", "boss"]);
const modelDefinitions = Object.freeze({
  hero: { label: "Hero", scale: 1.9, clips: ["Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash"], height: 3.4 },
  chaser: { label: "Chaser", scale: 1.5, clips: ["Idle", "Move", "Attack", "Hit", "Death"], height: 2.7 },
  shooter: { label: "Shooter", scale: 1.8, clips: ["Idle", "Move", "Attack", "Hit", "Death"], height: 3.2 },
  thief: { label: "Thief", scale: 1.7, clips: ["Idle", "Move", "Attack", "Hit", "Death"], height: 3.05 },
  boss: { label: "Boss", scale: 2.2, clips: ["Idle", "Move", "Attack", "Hit", "Death"], height: 4.0 }
});

const modelPaths = Object.fromEntries(
  MODEL_ORDER.map((name) => [
    name,
    new URL(`../assets/production/models/${name}-nendo-trellis2.glb`, import.meta.url).href
  ])
);

const assetPaths = Object.freeze({
  arena: new URL("../assets/production/arena-clockwork.png", import.meta.url).href,
  environment: new URL("../assets/production/env/arena-clockwork-ibl.hdr", import.meta.url).href,
  flameSheet: new URL("../assets/production/effects/flame-sheet.png", import.meta.url).href,
  smokeSheet: new URL("../assets/production/effects/smoke-sheet.png", import.meta.url).href,
  shockwaveSheet: new URL("../assets/production/effects/shockwave-sheet.png", import.meta.url).href,
  lightningArc: new URL("../assets/production/effects/lightning-arc.png", import.meta.url).href,
  spark: new URL("../assets/production/effects/spark.png", import.meta.url).href,
  softParticle: new URL("../assets/production/effects/soft-particle.png", import.meta.url).href,
  runeFire: new URL("../assets/production/effects/rune-circle-fire.png", import.meta.url).href,
  runeLightning: new URL("../assets/production/effects/rune-circle-lightning.png", import.meta.url).href,
  runeVoid: new URL("../assets/production/effects/rune-circle-void.png", import.meta.url).href,
  runeChrono: new URL("../assets/production/effects/rune-circle-chrono.png", import.meta.url).href,
  swirl: new URL("../assets/production/effects/swirl.png", import.meta.url).href
});

const elementalPalette = Object.freeze({
  fire: Object.freeze({ primary: "#ff3b30", accent: "#ffbf5a", deep: "#74121a" }),
  lightning: Object.freeze({ primary: "#df45f3", accent: "#ffffff", deep: "#7a1a9d" }),
  void: Object.freeze({ primary: "#b02fd0", accent: "#f0b8ff", deep: "#3d0b55" }),
  chrono: Object.freeze({ primary: "#58e9ff", accent: "#f1ffff", deep: "#126d91" })
});

const enabledAttacks = Object.freeze({
  hero: ["normal", "melee"],
  chaser: ["melee"],
  shooter: ["normal", "lightning"],
  thief: ["normal"],
  boss: ["normal", "lightning"]
});

let engine;
let scene;
let camera;
let shadowGenerator;
let texturedEffects;
let activeActors = [];
let activeProjectiles = [];
let activeSlashes = [];
let activeAttacks = [];
let labelRecords = [];
let loadVersion = 0;
let playbackRate = 1;
const modelContainers = new Map();
const clockwork = [];

function createMaterial(name, diffuseHex, emissiveHex = diffuseHex, emissiveStrength = 0.18) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(diffuseHex);
  material.emissiveColor = Color3.FromHexString(emissiveHex).scale(emissiveStrength);
  material.specularColor = new Color3(0.22, 0.28, 0.34);
  return material;
}

// src/main.js の createArena と同じ床・発光リングを、確認に必要な範囲で再現する。
function createArena() {
  const groundMaterial = createMaterial("combat-ground", "#050a12", "#071421", 0.08);
  groundMaterial.specularColor = Color3.Black();
  const ground = CreateCylinder("combat-arena-floor", { diameter: 38.5, height: 0.55, tessellation: 96 }, scene);
  ground.position.y = -0.36;
  ground.material = groundMaterial;
  ground.isPickable = false;

  const arenaTexture = new Texture(assetPaths.arena, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
  arenaTexture.anisotropicFilteringLevel = 8;
  const arenaMaterial = new StandardMaterial("combat-arena-art", scene);
  arenaMaterial.diffuseTexture = arenaTexture;
  arenaMaterial.emissiveTexture = arenaTexture;
  arenaMaterial.diffuseColor = new Color3(0.88, 0.92, 1);
  arenaMaterial.emissiveColor = new Color3(0.18, 0.22, 0.3);
  arenaMaterial.specularColor = Color3.Black();
  const arenaArt = CreatePlane("combat-arena-art", { size: 38 }, scene);
  arenaArt.rotation.x = Math.PI / 2;
  arenaArt.position.y = FLOOR_Y;
  arenaArt.material = arenaMaterial;
  arenaArt.receiveShadows = true;
  arenaArt.isPickable = false;

  for (const [diameter, color, speed] of [[8.4, "#5fe4ff", 0.04], [16.8, "#d7a94e", -0.022], [28.4, "#5fe4ff", 0.013]]) {
    const ring = CreateTorus(`combat-clock-ring-${diameter}`, { diameter, thickness: diameter > 20 ? 0.055 : 0.04, tessellation: 96 }, scene);
    ring.position.y = 0.055;
    const material = createMaterial(`combat-clock-ring-material-${diameter}`, color, color, 0.75);
    material.alpha = diameter > 20 ? 0.2 : 0.28;
    material.disableLighting = true;
    ring.material = material;
    ring.isPickable = false;
    clockwork.push({ mesh: ring, speed });
  }
}

// src/main.js:initScene の値を維持する。カメラだけは一覧・攻撃用に切り替える。
function initScene() {
  engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: true });
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.008, 0.018, 0.04, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.014;
  scene.fogColor = new Color3(0.018, 0.04, 0.072);
  scene.environmentTexture = new HDRCubeTexture(assetPaths.environment, scene, 256, false, true, false, true);
  scene.environmentIntensity = 0.78;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 0.98;
  scene.imageProcessingConfiguration.contrast = 1.03;

  camera = new FreeCamera("combat-camera", new Vector3(0, 11, -29), scene);
  camera.setTarget(new Vector3(0, 1.2, 0));
  camera.fov = 0.68;
  camera.minZ = 0.1;

  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.92;
  ambient.diffuse = new Color3(0.48, 0.7, 0.88);
  ambient.groundColor = new Color3(0.03, 0.05, 0.09);
  const keyLight = new DirectionalLight("key-light", new Vector3(-0.55, -1, 0.45), scene);
  keyLight.position = new Vector3(12, 24, -12);
  keyLight.intensity = 1.4;
  keyLight.diffuse = new Color3(0.72, 0.9, 1);
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
  texturedEffects = new TexturedEffectController({
    scene,
    assetPaths,
    palette: elementalPalette,
    prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    playbackRate
  });
}

function readSettings() {
  const query = new URLSearchParams(window.location.search);
  const mode = query.get("mode");
  const model = query.get("model");
  const slow = Number(query.get("slow"));
  return {
    mode: mode === "attack" ? "attack" : "motions",
    model: MODEL_ORDER.includes(model) ? model : "hero",
    slow: [1, 2, 4, 10].includes(slow) ? slow : 1
  };
}

function writeSettings() {
  const query = new URLSearchParams(window.location.search);
  query.set("mode", modeSelect.value);
  query.set("model", modelSelect.value);
  query.set("slow", slowSelect.value);
  history.replaceState(null, "", `${window.location.pathname}?${query.toString()}`);
}

function setStatus(message, state = "ready") {
  status.dataset.state = state;
  status.textContent = message;
}

function setModeCamera(mode) {
  if (mode === "motions") {
    // Orca の縦長ペインでも、6体（幅約26m）が切れない水平画角を確保する。
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    camera.position.set(0, 11, -29);
    camera.setTarget(new Vector3(0, 1.25, 0));
    camera.fov = aspect < 0.85 ? 1.42 : 0.68;
    return;
  }
  camera.position.set(0, 7.1, -14.2);
  camera.setTarget(new Vector3(0, 1.15, 2.1));
  camera.fov = 0.66;
}

function disposeLabels() {
  for (const record of labelRecords) record.element.remove();
  labelRecords = [];
}

function clearPreview() {
  disposeLabels();
  for (const actor of activeActors) {
    for (const group of actor.animationGroups) group.stop();
    for (const group of actor.animationGroups) group.dispose();
    actor.root.dispose();
  }
  for (const projectile of activeProjectiles) {
    texturedEffects.releaseProjectileFlame(projectile);
    projectile.root.dispose();
  }
  for (const slash of activeSlashes) slash.root.dispose();
  activeActors = [];
  activeProjectiles = [];
  activeSlashes = [];
  activeAttacks = [];
  texturedEffects.reset();
}

function sourceClipName(group, clips) {
  // instantiateModelsToScene は複製名をアニメーショングループ名にも付ける。
  // 例: combat-hero-Idle-1-Attack → Attack。元のクリップ名末尾で戻す。
  return clips.find((clip) => group.name === clip || group.name.endsWith(`-${clip}`)) ?? group.name;
}

async function loadModelContainer(name) {
  if (!modelContainers.has(name)) modelContainers.set(name, LoadAssetContainerAsync(modelPaths[name], scene));
  return modelContainers.get(name);
}

function placeOnArena(root) {
  root.computeWorldMatrix(true);
  const meshes = root.getChildMeshes(false);
  for (const mesh of meshes) mesh.computeWorldMatrix(true);
  const lowestY = Math.min(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
  root.position.y += FLOOR_Y - lowestY;
}

async function createActor(name, id, position) {
  const definition = modelDefinitions[name];
  const container = await loadModelContainer(name);
  const instance = container.instantiateModelsToScene((sourceName) => `combat-${id}-${sourceName}`, false);
  const root = new TransformNode(`combat-${id}`, scene);
  for (const node of instance.rootNodes) node.parent = root;
  root.position.copyFrom(position);
  root.rotation.y = Math.PI;
  root.scaling.setAll(definition.scale);
  placeOnArena(root);
  for (const mesh of root.getChildMeshes(false)) shadowGenerator.addShadowCaster(mesh);
  for (const group of instance.animationGroups) group.stop();
  const groups = new Map(instance.animationGroups.map((group) => [sourceClipName(group, definition.clips), group]));
  return { name, root, groups, animationGroups: instance.animationGroups, labelHeight: definition.height };
}

function startClip(actor, clip, loop = true) {
  for (const group of actor.animationGroups) group.stop();
  const group = actor.groups.get(clip);
  if (!group) return false;
  group.start(loop, playbackRate);
  return true;
}

function createMotionLabel(actor, clip) {
  const element = document.createElement("div");
  element.className = "motion-label";
  element.textContent = clip;
  labelsLayer.append(element);
  labelRecords.push({ element, actor });
}

function horizontalPosition(index, count) {
  return (index - (count - 1) / 2) * 5.15;
}

async function renderMotionMode(version) {
  const name = modelSelect.value;
  const definition = modelDefinitions[name];
  modeHint.textContent = `${definition.label} の ${definition.clips.length} クリップを同時にループ再生します。`;
  setStatus(`${definition.label} の全モーションを読み込み中…`, "loading");
  const actors = await Promise.all(definition.clips.map((clip, index) => createActor(name, `${name}-${clip}-${version}`, new Vector3(horizontalPosition(index, definition.clips.length), 0, 0))));
  if (version !== loadVersion) {
    for (const actor of actors) actor.root.dispose();
    return;
  }
  activeActors = actors;
  for (const [index, actor] of actors.entries()) {
    const clip = definition.clips[index];
    if (!startClip(actor, clip)) console.warn(`Missing animation clip: ${name}/${clip}`);
    actor.clip = clip;
    createMotionLabel(actor, clip);
  }
  setStatus(`${definition.label}: ${definition.clips.join(" / ")} を同時再生中`);
}

function updateAttackButtons() {
  const allowed = enabledAttacks[modelSelect.value] ?? [];
  for (const button of attackButtons) {
    const attack = button.dataset.attack;
    button.disabled = !allowed.includes(attack);
    if (attack === "normal" && modelSelect.value === "boss") button.textContent = "通常弾（3方向）";
    else button.textContent = attack === "normal" ? "通常弾" : attack === "lightning" ? "雷" : "近接";
  }
}

function createTargetMarker() {
  const material = createMaterial("combat-target-marker", "#8cecff", "#58e9ff", 0.9);
  material.disableLighting = true;
  material.alpha = 0.62;
  const marker = CreateTorus("combat-target-marker", { diameter: 1.26, thickness: 0.04, tessellation: 40 }, scene);
  marker.position.set(0, 0.055, -3.1);
  marker.material = material;
  return marker;
}

async function renderAttackMode(version) {
  const name = modelSelect.value;
  modeHint.textContent = "キャラはカメラ側へ攻撃します。発火後は同じボタンで何度でも確認できます。";
  setStatus(`${modelDefinitions[name].label} を読み込み中…`, "loading");
  const actor = await createActor(name, `${name}-attacker-${version}`, new Vector3(0, 0, 4.25));
  if (version !== loadVersion) {
    actor.root.dispose();
    return;
  }
  activeActors = [actor];
  startClip(actor, "Idle");
  const marker = createTargetMarker();
  activeSlashes.push({ root: marker, age: 0, duration: Number.POSITIVE_INFINITY, marker: true });
  updateAttackButtons();
  setStatus(`${modelDefinitions[name].label} は待機中。使用可能な攻撃を選んでください。`);
}

async function renderCurrent() {
  const version = ++loadVersion;
  clearPreview();
  setModeCamera(modeSelect.value);
  attackControls.hidden = modeSelect.value !== "attack";
  writeSettings();
  try {
    if (modeSelect.value === "motions") await renderMotionMode(version);
    else await renderAttackMode(version);
  } catch (error) {
    if (version !== loadVersion) return;
    clearPreview();
    console.error("Combat preview model load failed", error);
    setStatus(`読み込み失敗: ${error.message}`, "error");
  }
}

function attackElement(type, attack) {
  if (attack === "lightning") return "lightning";
  if (attack === "melee") return "fire";
  return type === "hero" ? "chrono" : type === "shooter" ? "lightning" : type === "thief" ? "void" : type === "boss" ? "void" : "fire";
}

function attackSource(actor) {
  const bossOffset = actor.name === "boss" ? 1.36 : 1.04;
  return new Vector3(actor.root.position.x, bossOffset, actor.root.position.z - 0.68);
}

function createProjectile(position, target, element) {
  const palette = elementalPalette[element];
  const root = new TransformNode(`combat-projectile-${performance.now()}`, scene);
  root.position.copyFrom(position);
  const shellMaterial = createMaterial(`combat-projectile-shell-${performance.now()}`, palette.primary, palette.primary, 1.15);
  shellMaterial.alpha = 0.9;
  const coreMaterial = createMaterial(`combat-projectile-core-${performance.now()}`, palette.accent, palette.accent, 1.4);
  const shell = CreateSphere("combat-projectile-shell", { diameter: 0.46, segments: 10 }, scene);
  shell.parent = root;
  shell.material = shellMaterial;
  const core = CreateSphere("combat-projectile-core", { diameter: 0.2, segments: 8 }, scene);
  core.parent = root;
  core.material = coreMaterial;
  const ring = CreateTorus("combat-projectile-ring", { diameter: 0.64, thickness: 0.042, tessellation: 16 }, scene);
  ring.parent = root;
  ring.rotation.x = Math.PI / 2;
  ring.material = coreMaterial;
  const velocity = target.subtract(position);
  velocity.y = 0;
  const duration = 1.18;
  velocity.scaleInPlace(1 / duration);
  const projectile = { root, position: root.position, target, velocity, element, age: 0, duration, alive: true, shellMaterial, coreMaterial };
  root.rotation.y = Math.atan2(velocity.x, velocity.z);
  if (element === "fire") texturedEffects.attachProjectileFlame(projectile);
  activeProjectiles.push(projectile);
}

function createMeleeSlash(actor) {
  const root = new TransformNode(`combat-melee-${performance.now()}`, scene);
  root.position.copyFrom(actor.root.position);
  const primary = createMaterial(`combat-melee-primary-${performance.now()}`, "#e11d48", "#ff526d", 1.15);
  const accent = createMaterial(`combat-melee-accent-${performance.now()}`, "#fff1f4", "#fff1f4", 1.2);
  for (const [index, material] of [primary, accent].entries()) {
    const path = [];
    const radius = 1.15 - index * 0.22;
    for (let step = 0; step <= 14; step += 1) {
      const angle = -1.18 + (step / 14) * 2.36;
      path.push(new Vector3(Math.sin(angle) * radius, 0.65 + Math.cos(angle) * 0.34, -0.45 - Math.cos(angle) * radius * 0.72));
    }
    const arc = CreateTube(`combat-melee-arc-${index}`, { path, radius: index === 0 ? 0.075 : 0.038, tessellation: 8, cap: 3 }, scene);
    arc.parent = root;
    arc.material = material;
  }
  activeSlashes.push({ root, age: 0, duration: 0.52, primary, accent });
}

function createLightningBeam(from, to) {
  const root = new TransformNode(`combat-lightning-beam-${performance.now()}`, scene);
  const material = createMaterial(`combat-lightning-material-${performance.now()}`, "#df45f3", "#ffffff", 1.4);
  const path = [];
  for (let index = 0; index <= 9; index += 1) {
    const t = index / 9;
    const point = Vector3.Lerp(from, to, t);
    if (index > 0 && index < 9) point.x += (index % 2 ? -1 : 1) * 0.18;
    point.y += 0.12 + Math.sin(t * Math.PI) * 0.32;
    path.push(point);
  }
  const beam = CreateTube("combat-lightning-beam", { path, radius: 0.055, tessellation: 6, cap: 3 }, scene);
  beam.parent = root;
  beam.material = material;
  activeSlashes.push({ root, age: 0, duration: 0.48, primary: material });
}

function fireAttack(kind) {
  const actor = activeActors[0];
  if (!actor || modeSelect.value !== "attack") return;
  if (!(enabledAttacks[actor.name] ?? []).includes(kind)) return;
  startClip(actor, "Attack", false);
  const element = attackElement(actor.name, kind);
  const source = attackSource(actor);
  texturedEffects.spawnTelegraph(actor.root.position, element, kind === "lightning" ? 0.54 : 0.34);
  activeAttacks.push({ actor, kind, element, source, age: 0, fired: false });
  const label = kind === "normal" && actor.name === "boss" ? "3方向の通常弾" : kind === "normal" ? "通常弾" : kind === "lightning" ? "雷撃" : "近接斬り";
  setStatus(`${modelDefinitions[actor.name].label} の${label}を発火しました（${slowSelect.options[slowSelect.selectedIndex].text}）。`);
}

function resolveAttack(attack) {
  const impact = new Vector3(0, 0.04, -3.1);
  if (attack.kind === "normal") {
    const targets = attack.actor.name === "boss"
      ? [new Vector3(-2.3, 0.04, -2.5), impact, new Vector3(2.3, 0.04, -2.5)]
      : [impact];
    for (const target of targets) createProjectile(attack.source, target, attack.element);
  } else if (attack.kind === "lightning") {
    createLightningBeam(attack.source, impact);
    texturedEffects.spawnLightning(impact, "lightning", 1.65, 0.58, 5);
    texturedEffects.spawnElementalImpact(impact, "lightning", new Vector3(0, 0, -1));
  } else {
    createMeleeSlash(attack.actor);
    const slashImpact = new Vector3(0, 0.04, 2.3);
    texturedEffects.spawnElementalImpact(slashImpact, "fire", new Vector3(0, 0, -1));
  }
}

function updateAttacks(deltaSeconds) {
  for (const attack of activeAttacks) {
    attack.age += deltaSeconds * playbackRate;
    if (!attack.fired && attack.age >= (attack.kind === "lightning" ? 0.43 : 0.25)) {
      attack.fired = true;
      resolveAttack(attack);
    }
    if (attack.age >= 1.18 && attack.actor.groups.has("Idle")) startClip(attack.actor, "Idle");
  }
  activeAttacks = activeAttacks.filter((attack) => attack.age < 1.3);
}

function updateProjectiles(deltaSeconds) {
  for (const projectile of activeProjectiles) {
    if (!projectile.alive) continue;
    projectile.age += deltaSeconds * playbackRate;
    projectile.position.addInPlace(projectile.velocity.scale(deltaSeconds * playbackRate));
    projectile.root.rotation.y += deltaSeconds * playbackRate * 11;
    if (projectile.age < projectile.duration) continue;
    projectile.alive = false;
    texturedEffects.releaseProjectileFlame(projectile);
    texturedEffects.spawnElementalImpact(projectile.target, projectile.element, projectile.velocity);
    projectile.root.dispose();
  }
  activeProjectiles = activeProjectiles.filter((projectile) => projectile.alive);
}

function updateSlashes(deltaSeconds) {
  for (const slash of activeSlashes) {
    if (slash.marker) {
      slash.root.rotation.y += deltaSeconds * playbackRate * 0.8;
      continue;
    }
    slash.age += deltaSeconds * playbackRate;
    const progress = Math.min(1, slash.age / slash.duration);
    slash.root.scaling.setAll(0.72 + progress * 0.68);
    if (slash.primary) slash.primary.alpha = (1 - progress) ** 1.35;
    if (slash.accent) slash.accent.alpha = (1 - progress) ** 1.7;
    if (progress >= 1) slash.root.dispose();
  }
  activeSlashes = activeSlashes.filter((slash) => slash.marker || slash.age < slash.duration);
}

function updateLabelPositions() {
  const viewport = new Viewport(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
  for (const record of labelRecords) {
    const actor = record.actor;
    actor.root.computeWorldMatrix(true);
    const point = new Vector3(actor.root.position.x, actor.root.position.y + actor.labelHeight + 0.38, actor.root.position.z);
    const projected = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), viewport);
    const visible = projected.z > 0 && projected.z < 1;
    record.element.hidden = !visible;
    record.element.style.left = `${(projected.x / engine.getRenderWidth()) * canvas.clientWidth}px`;
    record.element.style.top = `${(projected.y / engine.getRenderHeight()) * canvas.clientHeight}px`;
  }
}

function bindControls() {
  const settings = readSettings();
  modeSelect.value = settings.mode;
  modelSelect.value = settings.model;
  slowSelect.value = String(settings.slow);
  playbackRate = 1 / settings.slow;
  texturedEffects.setPlaybackRate(playbackRate);
  modeSelect.addEventListener("change", renderCurrent);
  modelSelect.addEventListener("change", renderCurrent);
  slowSelect.addEventListener("change", () => {
    playbackRate = 1 / Number(slowSelect.value);
    texturedEffects.setPlaybackRate(playbackRate);
    for (const actor of activeActors) {
      for (const group of actor.animationGroups) group.speedRatio = playbackRate;
    }
    writeSettings();
    setStatus(`再生速度を ${slowSelect.options[slowSelect.selectedIndex].text} に変更しました。`);
  });
  for (const button of attackButtons) button.addEventListener("click", () => fireAttack(button.dataset.attack));
}

initScene();
bindControls();
renderCurrent();

// Orca の確認時に、現在のモード・演出数・速度を安全に観測できるようにする。
window.__combatPreview = {
  get mode() { return modeSelect.value; },
  get model() { return modelSelect.value; },
  get playbackRate() { return playbackRate; },
  get activeProjectiles() { return activeProjectiles.length; },
  get activeAttacks() { return activeAttacks.length; },
  get attackState() { return activeAttacks.map((attack) => ({ kind: attack.kind, age: attack.age, fired: attack.fired })); },
  get actors() {
    return activeActors.map((actor) => ({
      name: actor.name,
      clips: [...actor.groups.keys()],
      playing: actor.animationGroups.filter((group) => group.isPlaying).map((group) => sourceClipName(group, modelDefinitions[actor.name].clips))
    }));
  },
  fire(kind) { fireAttack(kind); }
};

engine.runRenderLoop(() => {
  const deltaSeconds = Math.min(0.04, engine.getDeltaTime() / 1000);
  for (const ring of clockwork) ring.mesh.rotation.y += ring.speed * deltaSeconds * playbackRate;
  updateAttacks(deltaSeconds);
  updateProjectiles(deltaSeconds);
  updateSlashes(deltaSeconds);
  texturedEffects.update(deltaSeconds * playbackRate);
  updateLabelPositions();
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
  setModeCamera(modeSelect.value);
});
window.addEventListener("beforeunload", () => engine.dispose());
