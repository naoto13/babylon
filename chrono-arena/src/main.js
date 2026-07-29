import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.pure.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.pure.js";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder.pure.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.pure.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.pure.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.pure.js";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder.pure.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js";

import {
  ARENA_RADIUS,
  INITIAL_ENEMY_COUNT,
  RUN_DURATION_SECONDS,
  UPGRADES,
  applyUpgrade,
  calculateRunRank,
  clampPointToCircle,
  findNearestTarget,
  formatRemainingTime,
  getEnemyCombatStats,
  getSpawnInterval,
  isWithinHorizontalRadius,
  predictFuturePosition,
  shouldSpawnBoss
} from "./game-rules.js";

const canvas = document.querySelector("#render-canvas");
const gameShell = document.querySelector("#game-shell");
const bootError = document.querySelector("#boot-error");
const hud = document.querySelector("#hud");
const startScreen = document.querySelector("#start-screen");
const upgradeScreen = document.querySelector("#upgrade-screen");
const pauseScreen = document.querySelector("#pause-screen");
const resultScreen = document.querySelector("#result-screen");
const startButton = document.querySelector("#start-button");
const pauseButton = document.querySelector("#pause-button");
const audioButton = document.querySelector("#audio-button");
const resumeButton = document.querySelector("#resume-button");
const restartFromPauseButton = document.querySelector("#restart-from-pause");
const retryButton = document.querySelector("#retry-button");
const qualitySelect = document.querySelector("#quality-select");
const timer = document.querySelector("#timer");
const timeValue = document.querySelector("#time-value");
const hpFill = document.querySelector("#hp-fill");
const hpValue = document.querySelector("#hp-value");
const xpFill = document.querySelector("#xp-fill");
const levelValue = document.querySelector("#level-value");
const killValue = document.querySelector("#kill-value");
const shardValue = document.querySelector("#shard-value");
const bossMeter = document.querySelector("#boss-meter");
const bossHpFill = document.querySelector("#boss-hp-fill");
const bossHpValue = document.querySelector("#boss-hp-value");
const toast = document.querySelector("#toast");
const announcer = document.querySelector("#announcer");
const resultRank = document.querySelector("#result-rank");
const resultKicker = document.querySelector("#result-kicker");
const resultTitle = document.querySelector("#result-title");
const resultDescription = document.querySelector("#result-description");
const resultKills = document.querySelector("#result-kills");
const resultShards = document.querySelector("#result-shards");
const resultUpgrade = document.querySelector("#result-upgrade");
const assetStatus = document.querySelector("#asset-status");
const abilityButtons = [...document.querySelectorAll("[data-skill]")];
const upgradeButtons = [...document.querySelectorAll("[data-upgrade]")];
const cooldownIndicators = new Map(
  [...document.querySelectorAll("[data-cooldown]")].map((element) => [element.dataset.cooldown, element])
);
const abilityStates = new Map(
  [...document.querySelectorAll("[data-ability-state]")].map((element) => [element.dataset.abilityState, element])
);

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const keyState = new Set();
const gamepadButtonState = new Map();
const enemies = [];
const playerProjectiles = [];
const enemyProjectiles = [];
const effects = [];
const clockwork = [];
const modelContainers = new Map();

const assetPaths = Object.freeze({
  arena: new URL("../assets/production/arena-clockwork.png", import.meta.url).href,
  environment: new URL("../assets/production/env/arena-clockwork-ibl.hdr", import.meta.url).href,
  heroModel: new URL("../assets/production/models/chrono-duelist-custom.glb", import.meta.url).href,
  chaserModel: new URL("../assets/production/models/enemy-chaser-concept.glb", import.meta.url).href,
  shooterModel: new URL("../assets/production/models/enemy-shooter-concept.glb", import.meta.url).href,
  thiefModel: new URL("../assets/production/models/enemy-thief-concept.glb", import.meta.url).href,
  bossModel: new URL("../assets/production/models/enemy-boss-concept.glb", import.meta.url).href
});

const cooldownDurations = Object.freeze({
  q: 4,
  e: 8,
  r: 12,
  dash: 2.4
});

const timeCosts = Object.freeze({ q: 2, e: 3, r: 4, dash: 0 });

let engine;
let scene;
let glow;
let ssao;
let camera;
let shadowGenerator;
let player;
let materials;
let phase = "title";
let run = null;
let toastTimer = null;
let nextEnemyId = 1;
let lastMoveDirection = new Vector3(0, 0, 1);
let frameFailureReported = false;
let audioContext = null;
let audioEnabled = true;
let masterGain = null;
let lastHitSoundAt = -Infinity;
let cameraBasePosition = null;
let cameraShakeRemaining = 0;
let cameraShakeStrength = 0;

function createMaterial(name, diffuseHex, emissiveHex = diffuseHex, emissiveStrength = 0.18) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(diffuseHex);
  material.emissiveColor = Color3.FromHexString(emissiveHex).scale(emissiveStrength);
  material.specularColor = new Color3(0.22, 0.28, 0.34);
  return material;
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) {
      audioEnabled = false;
      updateAudioButton();
      return null;
    }
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = audioEnabled ? 0.72 : 0;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

function updateAudioButton() {
  audioButton.textContent = audioEnabled ? "SFX ON" : "SFX OFF";
  audioButton.setAttribute("aria-pressed", String(!audioEnabled));
  audioButton.setAttribute("aria-label", audioEnabled ? "効果音をオフにする" : "効果音をオンにする");
  gameShell.dataset.audio = audioEnabled ? "on" : "off";
}

function toggleAudio() {
  audioEnabled = !audioEnabled;
  const context = audioEnabled ? ensureAudioContext() : audioContext;
  if (context && masterGain) {
    masterGain.gain.cancelScheduledValues(context.currentTime);
    masterGain.gain.setTargetAtTime(audioEnabled ? 0.72 : 0, context.currentTime, 0.012);
  }
  updateAudioButton();
}

function playSound(kind) {
  if (!audioEnabled) return;
  const context = ensureAudioContext();
  if (!context || !masterGain) return;
  const presets = {
    attack: ["sawtooth", 340, 145, 0.07, 0.045],
    hit: ["square", 125, 54, 0.075, 0.07],
    playerHit: ["sawtooth", 92, 38, 0.14, 0.09],
    dash: ["sine", 620, 170, 0.12, 0.055],
    ability: ["triangle", 230, 760, 0.18, 0.06],
    freeze: ["sine", 510, 190, 0.28, 0.05],
    upgrade: ["triangle", 390, 920, 0.3, 0.07],
    result: ["sine", 210, 105, 0.38, 0.055],
    enemyShot: ["square", 175, 74, 0.1, 0.035]
  };
  const [wave, from, to, duration, volume] = presets[kind] ?? presets.hit;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(from, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.01);
}

function applyCameraImpact(strength = 0.1, duration = 0.12) {
  if (prefersReducedMotion) return;
  cameraShakeStrength = Math.max(cameraShakeStrength, strength);
  cameraShakeRemaining = Math.max(cameraShakeRemaining, duration);
}

function updateCameraFeedback(deltaSeconds) {
  if (!camera || !cameraBasePosition) return;
  cameraShakeRemaining = Math.max(0, cameraShakeRemaining - deltaSeconds);
  if (prefersReducedMotion || cameraShakeRemaining <= 0) {
    camera.position.copyFrom(cameraBasePosition);
    cameraShakeStrength = 0;
    return;
  }
  const pulse = performance.now() * 0.052;
  const fade = Math.min(1, cameraShakeRemaining / 0.12);
  camera.position.set(
    cameraBasePosition.x + Math.sin(pulse * 1.7) * cameraShakeStrength * fade,
    cameraBasePosition.y + Math.sin(pulse * 2.3) * cameraShakeStrength * 0.35 * fade,
    cameraBasePosition.z + Math.cos(pulse * 1.4) * cameraShakeStrength * fade
  );
}

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

  const arenaTexture = new Texture(assetPaths.arena, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
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

function animationClipName(group) {
  const rawName = group.name.split("|").at(-1).replace(/\.\d+$/, "");
  const knownClip = ["FutureSlash", "Attack", "Death", "Dash", "Move", "Run", "Hit", "Idle"]
    .find((clip) => rawName === clip || rawName.endsWith(`-${clip}`));
  return knownClip ?? rawName;
}

function configureAnimationGroups(groups) {
  const animations = new Map();
  for (const group of groups) {
    const name = animationClipName(group);
    animations.set(name, group);
    for (const targetedAnimation of group.targetedAnimations) {
      targetedAnimation.animation.enableBlending = true;
      targetedAnimation.animation.blendingSpeed = 0.12;
    }
  }
  return animations;
}

function playPlayerAnimation(name, { loop = true, speedRatio = 1, lock = 0, restart = false } = {}) {
  const metadata = player?.metadata;
  const next = metadata?.animations?.get(name);
  if (!next) return;
  metadata.actionLock = Math.max(metadata.actionLock ?? 0, lock);
  if (!restart && metadata.currentAnimation === name && next.isPlaying) return;
  for (const animation of metadata.animations.values()) {
    if (animation !== next && animation.isPlaying) animation.stop();
  }
  if (next.isPlaying) next.stop();
  next.start(loop, speedRatio, next.from, next.to, false);
  metadata.currentAnimation = name;
  gameShell.dataset.animation = name;
}

function playEnemyAnimation(enemy, name, { loop = true, speedRatio = 1, lock = 0, restart = false } = {}) {
  const next = enemy?.animations?.get(name);
  if (!next) {
    gameShell.dataset.enemyAnimationMissing = `${name}:${[...(enemy?.animations?.keys?.() ?? [])].join(",")}`;
    return;
  }
  enemy.actionLock = Math.max(enemy.actionLock ?? 0, lock);
  if (!restart && enemy.currentAnimation === name && next.isPlaying) return;
  for (const animation of enemy.animations.values()) {
    if (animation !== next && animation.isPlaying) animation.stop();
  }
  if (next.isPlaying) next.stop();
  next.start(loop, speedRatio, next.from, next.to, false);
  enemy.currentAnimation = name;
  gameShell.dataset.enemyAnimation = name;
}

function createPlayer() {
  const root = new TransformNode("player-root", scene);

  const shadow = CreateDisc("player-shadow", { radius: 0.68, tessellation: 32 }, scene);
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.04;
  shadow.material = materials.shadow;
  shadow.parent = root;

  const halo = CreateDisc("player-halo", { radius: 0.84, tessellation: 48 }, scene);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.055;
  halo.material = materials.cyanHalo;
  halo.parent = root;

  const modelAnchor = new TransformNode("player-model-anchor", scene);
  modelAnchor.parent = root;
  modelAnchor.scaling.setAll(1.32);
  modelAnchor.rotation.y = Math.PI;

  const heroContainer = modelContainers.get("hero");
  heroContainer.addAllToScene();
  for (const node of heroContainer.rootNodes) node.parent = modelAnchor;
  for (const mesh of modelAnchor.getChildMeshes()) shadowGenerator.addShadowCaster(mesh);

  root.metadata = {
    modelAnchor,
    halo,
    animations: configureAnimationGroups(heroContainer.animationGroups),
    currentAnimation: null,
    actionLock: 0
  };

  return root;
}

async function loadModelAssets() {
  assetStatus.textContent = "Blenderモデルと6つのモーションを読み込み中…";
  startButton.disabled = true;
  const definitions = [
    ["hero", assetPaths.heroModel],
    ["chaser", assetPaths.chaserModel],
    ["shooter", assetPaths.shooterModel],
    ["thief", assetPaths.thiefModel],
    ["boss", assetPaths.bossModel]
  ];
  const containers = await Promise.all(
    definitions.map(async ([name, path]) => [name, await LoadAssetContainerAsync(path, scene)])
  );
  for (const [name, container] of containers) modelContainers.set(name, container);
  const heroClips = new Set(modelContainers.get("hero").animationGroups.map(animationClipName));
  const heroClipsReady = ["Idle", "Run", "Attack", "Dash", "Hit", "FutureSlash"]
    .every((clip) => heroClips.has(clip));
  const enemyClipsReady = ["chaser", "shooter", "thief", "boss"].every((name) => {
    const clips = new Set(modelContainers.get(name).animationGroups.map(animationClipName));
    return ["Idle", "Move", "Attack", "Hit", "Death"].every((clip) => clips.has(clip));
  });
  gameShell.dataset.heroAnimations = heroClipsReady ? "6" : "missing";
  gameShell.dataset.enemyAnimations = enemyClipsReady ? "5x4" : "missing";
  assetStatus.textContent = heroClipsReady && enemyClipsReady
    ? "BLENDER READY — HERO 6 MOTIONS / ENEMIES 5 × 4"
    : "Blenderモーションの読み込みに失敗しました";
  if (!heroClipsReady) throw new Error("Hero animation clips are incomplete");
  if (!enemyClipsReady) throw new Error("Enemy animation clips are incomplete");
  startButton.disabled = false;
}

function initScene() {
  engine = new Engine(canvas, true, { stencil: true, adaptToDeviceRatio: true });
  scene = new Scene(engine);
  scene.clearColor = new Color4(0.008, 0.018, 0.04, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.014;
  scene.fogColor = new Color3(0.018, 0.04, 0.072);
  // 空は描かず、アリーナの色だけをPBR金属へ反射させる軽量IBL。
  scene.environmentTexture = new HDRCubeTexture(assetPaths.environment, scene, 256, false, true, false, true);
  scene.environmentIntensity = 0.78;
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 0.98;
  scene.imageProcessingConfiguration.contrast = 1.03;

  cameraBasePosition = new Vector3(0, 22, -19);
  camera = new FreeCamera("fixed-camera", cameraBasePosition.clone(), scene);
  camera.setTarget(new Vector3(0, 0.6, 0));
  camera.fov = 0.75;
  camera.minZ = 0.1;

  const ambient = new HemisphericLight("ambient-light", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.92;
  ambient.diffuse = new Color3(0.48, 0.7, 0.88);
  ambient.groundColor = new Color3(0.03, 0.05, 0.09);

  const keyLight = new DirectionalLight("key-light", new Vector3(-0.55, -1, 0.45), scene);
  keyLight.position = new Vector3(12, 24, -12);
  keyLight.intensity = 1.4;
  keyLight.diffuse = new Color3(0.72, 0.9, 1);

  // 背後の寒色リムで、明度を上げた装甲のパネル縁とトリムを分離して見せる。
  const rimLight = new DirectionalLight("rim-light", new Vector3(0.35, -0.25, -1), scene);
  rimLight.position = new Vector3(-8, 8, 16);
  rimLight.intensity = 2.0;
  rimLight.diffuse = new Color3(0.45, 0.85, 1.0);
  rimLight.shadowEnabled = false;

  shadowGenerator = new ShadowGenerator(1024, keyLight);
  shadowGenerator.useBlurExponentialShadowMap = true;
  shadowGenerator.blurKernel = 18;
  shadowGenerator.bias = 0.0008;

  materials = {
    cyan: createMaterial("cyan", "#75e7ff", "#52dcff", 0.82),
    violet: createMaterial("violet", "#7658b8", "#b18cff", 0.58),
    danger: createMaterial("danger", "#9b3348", "#ff4f6c", 0.55),
    shadow: createMaterial("shadow", "#03070c", "#03070c", 0),
    cyanHalo: createMaterial("cyan-halo", "#36cfee", "#5ee8ff", 0.92)
  };
  materials.shadow.alpha = 0.42;
  materials.shadow.disableLighting = true;
  materials.cyanHalo.alpha = 0.32;
  materials.cyanHalo.disableLighting = true;

  glow = new GlowLayer("arena-glow", scene, { blurKernelSize: 32 });
  glow.intensity = 0.62;

  createArena();
  applyQuality(qualitySelect.value);
  return scene;
}

function setOverlay(element, visible) {
  element.hidden = !visible;
  element.toggleAttribute("inert", !visible);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1900);
}

function hideToast() {
  window.clearTimeout(toastTimer);
  toastTimer = null;
  toast.classList.remove("is-visible");
  toast.textContent = "";
}

function announce(message) {
  announcer.textContent = "";
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function setPhase(nextPhase) {
  phase = nextPhase;
  gameShell.dataset.phase = nextPhase;
  setOverlay(startScreen, nextPhase === "title");
  setOverlay(upgradeScreen, nextPhase === "upgrade");
  setOverlay(pauseScreen, nextPhase === "paused");
  setOverlay(resultScreen, nextPhase === "result");
  hud.hidden = nextPhase === "title" || nextPhase === "result";
  hud.toggleAttribute("inert", nextPhase !== "playing");
  canvas.toggleAttribute("inert", nextPhase !== "playing");
  pauseButton.disabled = nextPhase === "title" || nextPhase === "result";
  if (run) updateHud();
}

function disposeCollection(collection) {
  for (const item of collection) {
    item.alive = false;
    for (const animation of item.animations?.values?.() ?? []) animation.dispose();
    item.mesh?.dispose();
    item.rune?.dispose();
    item.material?.dispose();
  }
  collection.length = 0;
}

function resetRun() {
  disposeCollection(enemies);
  disposeCollection(playerProjectiles);
  disposeCollection(enemyProjectiles);
  disposeCollection(effects);

  run = {
    remaining: RUN_DURATION_SECONDS,
    elapsed: 0,
    hp: 100,
    maxHp: 100,
    xp: 0,
    xpTarget: 9,
    level: 1,
    kills: 0,
    shards: 0,
    spawnClock: 0,
    attackClock: 0.15,
    pendingAttacks: [],
    shotSequence: 0,
    invulnerable: 1.35,
    hitStop: 0,
    freezeRemaining: 0,
    upgradeOffered: false,
    selectedUpgrade: null,
    bossSpawned: false,
    bossDefeated: false,
    bossId: null,
    historyClock: 0,
    history: [],
    cooldowns: { q: 0, e: 0, r: 0, dash: 0 },
    stats: { attackInterval: 0.76, pierce: 0, causality: false, hourglass: false }
  };

  player.position.set(0, 0, 0);
  player.rotation.y = 0;
  player.metadata.actionLock = 0;
  playPlayerAnimation("Idle", { restart: true });
  lastMoveDirection.set(0, 0, 1);
  keyState.clear();
  nextEnemyId = 1;
  bossMeter.hidden = true;

  for (let index = 0; index < INITIAL_ENEMY_COUNT; index += 1) {
    spawnEnemy("chaser", (index / INITIAL_ENEMY_COUNT) * Math.PI * 2, 12 + (index % 2));
  }
  updateHud();
}

function startRun() {
  ensureAudioContext();
  hideToast();
  resetRun();
  setPhase("playing");
  playSound("ability");
  announce("60秒ラン開始。最も近い敵へ自動攻撃します。");
  canvas.focus({ preventScroll: true });
}

function enemyTypeForElapsed(elapsed) {
  const roll = Math.random();
  if (elapsed > 34 && roll < 0.2) return "thief";
  if (elapsed > 14 && roll < 0.47) return "shooter";
  return "chaser";
}

function createEnemyModel(type, id) {
  const container = modelContainers.get(type);
  if (!container) throw new Error(`Missing Blender enemy model: ${type}`);
  const instance = container.instantiateModelsToScene(
    (sourceName) => `${type}-${id}-${sourceName}`,
    false
  );
  const root = new TransformNode(`${type}-${id}`, scene);
  for (const node of instance.rootNodes) node.parent = root;
  const scale = { chaser: 1.28, shooter: 1.24, thief: 1.28, boss: 1.42 }[type];
  root.scaling.setAll(scale);
  root.rotation.y = Math.PI;
  root.metadata = { scale };
  for (const mesh of root.getChildMeshes()) shadowGenerator.addShadowCaster(mesh);
  return {
    root,
    animations: configureAnimationGroups(instance.animationGroups)
  };
}

function spawnEnemy(type = "chaser", fixedAngle = null, fixedRadius = 15.3) {
  if (enemies.length >= 74 && type !== "boss") return null;

  const angle = fixedAngle ?? Math.random() * Math.PI * 2;
  const radius = fixedRadius + (type === "boss" ? 0 : Math.random() * 0.45);
  const id = nextEnemyId;
  const model = createEnemyModel(type, id);
  const mesh = model.root;
  const { hp, speed, damage } = getEnemyCombatStats(type, run?.elapsed ?? 0);

  const baseY = { chaser: 0.06, shooter: 0.04, thief: 0.04, boss: 0.04 }[type];
  mesh.position.set(
    Math.sin(angle) * radius,
    baseY,
    Math.cos(angle) * radius
  );

  let rune = null;
  if (type === "boss") {
    rune = CreateTorus(
      `boss-rune-${id}`,
      { diameter: 4.4, thickness: 0.1, tessellation: 64 },
      scene
    );
    rune.position.set(mesh.position.x, 0.08, mesh.position.z);
    rune.material = materials.danger;
    rune.isPickable = false;
  }

  const enemy = {
    id,
    type,
    mesh,
    animations: model.animations,
    currentAnimation: null,
    actionLock: 0,
    rune,
    x: mesh.position.x,
    z: mesh.position.z,
    hp,
    maxHp: hp,
    speed,
    damage,
    alive: true,
    dying: false,
    deathRemaining: 0,
    contactCooldown: 0,
    shootCooldown: type === "boss" ? 0.65 : 0.8 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    baseY,
    baseScale: mesh.metadata.scale,
    hitPulse: 0,
    recoil: 0,
    velocityX: 0,
    velocityZ: 0
  };
  nextEnemyId += 1;
  enemies.push(enemy);
  playEnemyAnimation(enemy, "Move", { speedRatio: type === "boss" ? 0.78 : 1 + speed * 0.06 });
  return enemy;
}

function spawnBoss() {
  if (run.bossSpawned) return;
  run.bossSpawned = true;
  const boss = spawnEnemy("boss", Math.PI / 4, 10.7);
  run.bossId = boss?.id ?? null;
  if (boss) {
    spawnPulse(boss.mesh.position, "#ff465f", 5.4, 0.82);
    showToast("時喰らいヴァルゴス、顕現");
    announce("残り15秒。時喰らいヴァルゴスが出現しました。");
  }
}

function createEffectMaterial(name, colorHex, alpha = 0.9, emissiveStrength = 1) {
  const material = createMaterial(name, colorHex, colorHex, emissiveStrength);
  material.alpha = alpha;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.metadata = { effectBaseAlpha: alpha };
  return material;
}

function trackEffect(
  mesh,
  effectMaterials,
  {
    duration = 0.45,
    startScale = 0.2,
    endScale = 1,
    angularSpeed = 0,
    fadeStart = 0,
    rise = 0,
    rotors = []
  } = {}
) {
  const reducedScale = prefersReducedMotion ? Math.max(0.82, startScale) : startScale;
  mesh.scaling.setAll(reducedScale);
  effects.push({
    mesh,
    materials: effectMaterials,
    duration:
      prefersReducedMotion && duration < 1
        ? Math.min(duration, 0.7)
        : duration,
    age: 0,
    alive: true,
    startScale: reducedScale,
    endScale,
    angularSpeed: prefersReducedMotion ? angularSpeed * 0.12 : angularSpeed,
    fadeStart,
    rise: prefersReducedMotion ? 0 : rise,
    baseY: mesh.position.y,
    rotors: rotors.map(({ node, speed }) => ({
      node,
      speed: prefersReducedMotion ? speed * 0.12 : speed
    }))
  });
}

function attachClockDial(
  parent,
  {
    name,
    radius,
    material,
    accentMaterial = material,
    tickCount = 12,
    handAngle = 0.38,
    gearTeeth = true
  }
) {
  const layer = new TransformNode(`${name}-layer`, scene);
  layer.parent = parent;

  const outer = CreateTorus(
    `${name}-outer`,
    {
      diameter: radius * 2,
      thickness: Math.max(0.035, radius * 0.055),
      tessellation: 48
    },
    scene
  );
  outer.parent = layer;
  outer.material = material;
  outer.isPickable = false;

  const inner = CreateTorus(
    `${name}-inner`,
    {
      diameter: radius * 1.48,
      thickness: Math.max(0.018, radius * 0.024),
      tessellation: 42
    },
    scene
  );
  inner.position.y = 0.014;
  inner.parent = layer;
  inner.material = accentMaterial;
  inner.isPickable = false;

  const visibleTicks = prefersReducedMotion ? Math.max(6, Math.floor(tickCount / 2)) : tickCount;
  for (let index = 0; index < visibleTicks; index += 1) {
    const angle = (index / visibleTicks) * Math.PI * 2;
    const major = index % 3 === 0;
    const tick = CreateBox(
      `${name}-tick-${index}`,
      {
        width: Math.max(0.025, radius * (major ? 0.055 : 0.032)),
        height: Math.max(0.025, radius * 0.035),
        depth: radius * (gearTeeth && major ? 0.24 : 0.14)
      },
      scene
    );
    tick.position.set(
      Math.sin(angle) * radius * (gearTeeth ? 1.02 : 0.9),
      0.012,
      Math.cos(angle) * radius * (gearTeeth ? 1.02 : 0.9)
    );
    tick.rotation.y = angle;
    tick.parent = layer;
    tick.material = major ? accentMaterial : material;
    tick.isPickable = false;
  }

  const addHand = (label, length, width, angle, y) => {
    const hand = CreateBox(
      `${name}-${label}`,
      { width, height: Math.max(0.024, width * 0.72), depth: length },
      scene
    );
    hand.position.set(
      Math.sin(angle) * length * 0.5,
      y,
      Math.cos(angle) * length * 0.5
    );
    hand.rotation.y = angle;
    hand.parent = layer;
    hand.material = accentMaterial;
    hand.isPickable = false;
  };
  addHand("minute-hand", radius * 0.76, radius * 0.045, handAngle, 0.035);
  addHand("hour-hand", radius * 0.52, radius * 0.065, handAngle - 1.72, 0.042);
  return layer;
}

function spawnPulse(position, colorHex = "#63e5ff", radius = 1.2, duration = 0.45) {
  const id = performance.now();
  const root = new TransformNode(`clock-burst-${id}`, scene);
  root.position.set(position.x, 0.12, position.z);
  const primary = createEffectMaterial(`clock-burst-primary-${id}`, colorHex, 0.82, 1);
  const accent = createEffectMaterial(`clock-burst-accent-${id}`, "#f5fdff", 0.94, 1);
  const dial = attachClockDial(root, {
    name: `clock-burst-${id}`,
    radius: Math.max(0.42, radius * 0.5),
    material: primary,
    accentMaterial: accent,
    tickCount: radius > 3 ? 16 : 10,
    handAngle: 0.44
  });
  trackEffect(root, [primary, accent], {
    duration,
    startScale: 0.16,
    endScale: 1,
    angularSpeed: 0.72,
    rise: Math.min(0.12, radius * 0.025),
    rotors: [{ node: dial, speed: radius > 3 ? -0.8 : -1.8 }]
  });
}

function spawnFutureMark(position, { compact = false } = {}) {
  const id = performance.now();
  const root = new TransformNode(`future-mark-${id}`, scene);
  root.position.set(position.x, 0.1, position.z);
  const cyan = createEffectMaterial(`future-mark-cyan-${id}`, "#63e5ff", 0.86, 1);
  const white = createEffectMaterial(`future-mark-white-${id}`, "#e8fdff", 0.98, 1);
  const dial = compact
    ? null
    : attachClockDial(root, {
        name: `future-mark-${id}`,
        radius: 0.76,
        material: cyan,
        accentMaterial: white,
        tickCount: 12,
        handAngle: -0.86,
        gearTeeth: false
      });

  if (compact) {
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI * 0.5;
      const pointer = CreateBox(
        `future-mark-pointer-${id}-${index}`,
        { width: 0.055, height: 0.035, depth: 0.28 },
        scene
      );
      pointer.position.set(Math.sin(angle) * 0.38, 0.022, Math.cos(angle) * 0.38);
      pointer.rotation.y = angle;
      pointer.parent = root;
      pointer.material = index % 2 === 0 ? cyan : white;
      pointer.isPickable = false;
    }
  }

  const diamond = CreateBox(
    `future-mark-diamond-${id}`,
    { width: 0.27, height: 0.035, depth: 0.27 },
    scene
  );
  diamond.position.y = 0.055;
  diamond.rotation.y = Math.PI / 4;
  diamond.parent = root;
  diamond.material = white;
  diamond.isPickable = false;

  trackEffect(root, [cyan, white], {
    duration: 0.46,
    startScale: 0.58,
    endScale: 1.18,
    angularSpeed: 0.45,
    rise: 0.12,
    rotors: dial ? [{ node: dial, speed: 3.2 }] : []
  });
}

function spawnImpactBurst(position, colorHex = "#63e5ff", radius = 1) {
  const id = performance.now();
  const root = new TransformNode(`impact-burst-${id}`, scene);
  root.position.set(position.x, 0.28, position.z);
  const primary = createEffectMaterial(`impact-primary-${id}`, colorHex, 0.94, 1);
  const accent = createEffectMaterial(`impact-accent-${id}`, "#fff3c9", 0.88, 1);
  const shardCount = prefersReducedMotion ? 4 : 8;

  for (let index = 0; index < shardCount; index += 1) {
    const angle = (index / shardCount) * Math.PI * 2 + 0.18;
    const length = radius * (index % 2 === 0 ? 0.75 : 0.5);
    const shard = CreateBox(
      `impact-shard-${id}-${index}`,
      { width: 0.045, height: 0.05, depth: length },
      scene
    );
    shard.position.set(
      Math.sin(angle) * length * 0.58,
      index % 2 === 0 ? 0.08 : 0.02,
      Math.cos(angle) * length * 0.58
    );
    shard.rotation.y = angle;
    shard.parent = root;
    shard.material = index % 2 === 0 ? primary : accent;
    shard.isPickable = false;
  }

  trackEffect(root, [primary, accent], {
    duration: 0.24,
    startScale: 0.18,
    endScale: 1.15,
    angularSpeed: -1.4,
    rise: 0.18
  });
}

function spawnTimeTrail(from, to, { rewindTrail = false } = {}) {
  const id = performance.now();
  const root = new TransformNode(`time-trail-${id}`, scene);
  const primaryHex = rewindTrail ? "#b691ff" : "#63e5ff";
  const primary = createEffectMaterial(`time-trail-primary-${id}`, primaryHex, 0.84, 1);
  const accent = createEffectMaterial(`time-trail-accent-${id}`, "#eaffff", 0.7, 1);
  const delta = to.subtract(from);
  delta.y = 0;
  const distance = Math.max(0.1, delta.length());
  const direction = delta.scale(1 / distance);
  const side = new Vector3(-direction.z, 0, direction.x);
  const railCount = prefersReducedMotion ? 1 : rewindTrail ? 3 : 2;

  for (let rail = 0; rail < railCount; rail += 1) {
    const offset = (rail - (railCount - 1) / 2) * (rewindTrail ? 0.24 : 0.16);
    const path = [];
    const segments = prefersReducedMotion ? 5 : 12;
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const point = Vector3.Lerp(from, to, t);
      point.y = 0.2 + Math.sin(Math.PI * t) * (rewindTrail ? 0.8 : 0.24);
      point.addInPlace(side.scale(offset + Math.sin(t * Math.PI * 2) * 0.08));
      path.push(point);
    }
    const railMesh = CreateTube(
      `time-trail-rail-${id}-${rail}`,
      {
        path,
        radius: rewindTrail ? 0.045 : 0.032,
        tessellation: 8,
        cap: 3
      },
      scene
    );
    railMesh.parent = root;
    railMesh.material = rail % 2 === 0 ? primary : accent;
    railMesh.isPickable = false;
  }

  const echoCount = prefersReducedMotion ? 2 : rewindTrail ? 7 : 4;
  for (let index = 1; index <= echoCount; index += 1) {
    const t = index / (echoCount + 1);
    const echo = CreateBox(
      `time-trail-echo-${id}-${index}`,
      {
        width: rewindTrail ? 0.22 : 0.15,
        height: 0.025,
        depth: rewindTrail ? 0.22 : 0.15
      },
      scene
    );
    echo.position.copyFrom(Vector3.Lerp(from, to, t));
    echo.position.y = 0.18 + Math.sin(Math.PI * t) * (rewindTrail ? 0.56 : 0.2);
    echo.rotation.y = Math.PI / 4 + t * Math.PI;
    echo.parent = root;
    echo.material = index % 2 === 0 ? accent : primary;
    echo.isPickable = false;
  }

  trackEffect(root, [primary, accent], {
    duration: rewindTrail ? 0.72 : 0.36,
    startScale: 1,
    endScale: rewindTrail ? 0.92 : 1,
    fadeStart: rewindTrail ? 0.34 : 0.12,
    rise: rewindTrail ? 0.12 : 0
  });
}

function spawnStopField(position) {
  const id = performance.now();
  const root = new TransformNode(`stop-field-${id}`, scene);
  root.position.set(position.x, 0.08, position.z);
  const violet = createEffectMaterial(`stop-field-violet-${id}`, "#b691ff", 0.64, 1);
  const cyan = createEffectMaterial(`stop-field-cyan-${id}`, "#80efff", 0.82, 1);
  const veil = createEffectMaterial(`stop-field-veil-${id}`, "#492b7d", 0.11, 0.8);

  const floor = CreateCylinder(
    `stop-field-floor-${id}`,
    { diameter: 9.5, height: 0.035, tessellation: 64 },
    scene
  );
  floor.parent = root;
  floor.material = veil;
  floor.isPickable = false;

  const outerDial = attachClockDial(root, {
    name: `stop-field-outer-${id}`,
    radius: 4.65,
    material: violet,
    accentMaterial: cyan,
    tickCount: 16,
    handAngle: -1.2
  });
  const innerDial = attachClockDial(root, {
    name: `stop-field-inner-${id}`,
    radius: 2.55,
    material: cyan,
    accentMaterial: violet,
    tickCount: 12,
    handAngle: 1.7,
    gearTeeth: false
  });

  const pillarCount = prefersReducedMotion ? 4 : 8;
  for (let index = 0; index < pillarCount; index += 1) {
    const angle = (index / pillarCount) * Math.PI * 2;
    const pillar = CreateBox(
      `stop-field-pillar-${id}-${index}`,
      { width: 0.055, height: index % 2 === 0 ? 0.88 : 0.55, depth: 0.055 },
      scene
    );
    pillar.position.set(Math.sin(angle) * 4.15, pillar.getBoundingInfo().boundingBox.extendSize.y, Math.cos(angle) * 4.15);
    pillar.parent = root;
    pillar.material = index % 2 === 0 ? cyan : violet;
    pillar.isPickable = false;
  }

  trackEffect(root, [violet, cyan, veil], {
    duration: 2.5,
    startScale: 0.72,
    endScale: 1,
    fadeStart: 0.76,
    rotors: [
      { node: outerDial, speed: -0.42 },
      { node: innerDial, speed: 0.78 }
    ]
  });
}

function removeEnemy(enemy) {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.dying = true;
  enemy.deathRemaining = enemy.type === "boss" ? 0.78 : 0.52;
  enemy.rune?.setEnabled(false);
  playEnemyAnimation(enemy, "Death", {
    loop: false,
    speedRatio: enemy.type === "boss" ? 0.72 : 1.05,
    restart: true
  });
  run.hitStop = Math.max(run.hitStop, enemy.type === "boss" ? 0.095 : 0.045);
  applyCameraImpact(enemy.type === "boss" ? 0.28 : 0.08, enemy.type === "boss" ? 0.24 : 0.1);
  const isBoss = enemy.type === "boss";
  run.kills += isBoss ? 10 : 1;
  run.shards += isBoss ? 12 : enemy.type === "thief" ? 3 : 1;
  run.xp += isBoss ? 8 : enemy.type === "shooter" ? 2 : 1;

  if (isBoss) {
    run.bossDefeated = true;
    run.remaining = Math.min(RUN_DURATION_SECONDS, run.remaining + 2);
    spawnPulse(enemy.mesh.position, "#ff465f", 6.4, 0.9);
    showToast("ヴァルゴス撃破 — 時間を2秒奪還");
    announce("ボス撃破。残り時間を2秒奪還しました。");
  }

  if (!isBoss && run.kills % 6 === 0) {
    run.remaining = Math.min(RUN_DURATION_SECONDS, run.remaining + 0.25);
    showToast("時間片が共鳴 — +0.25秒");
  }

  while (run.xp >= run.xpTarget) {
    run.xp -= run.xpTarget;
    run.level += 1;
    run.xpTarget = 8 + run.level * 3;
    announce(`レベル${run.level}`);
  }

  if (!isBoss) {
    spawnPulse(enemy.mesh.position, enemy.type === "thief" ? "#f6cc73" : "#63e5ff", 1.45, 0.38);
  }
}

function damageEnemy(enemy, amount, { impact = true } = {}) {
  if (!enemy?.alive) return;
  enemy.hp -= amount;
  enemy.hitPulse = 0.12;
  const now = performance.now();
  if (now - lastHitSoundAt >= 22) {
    playSound("hit");
    lastHitSoundAt = now;
  }
  if (enemy.hp <= 0) removeEnemy(enemy);
  else {
    if (impact) {
      spawnImpactBurst(
        enemy.mesh.position,
        enemy.type === "boss" ? "#ff7788" : enemy.type === "thief" ? "#f6cc73" : "#63e5ff",
        enemy.type === "boss" ? 1.35 : 0.82
      );
    }
    playEnemyAnimation(enemy, "Hit", { loop: false, speedRatio: 1.35, lock: 0.16, restart: true });
    run.hitStop = Math.max(run.hitStop, 0.028);
    applyCameraImpact(enemy.type === "boss" ? 0.1 : 0.045, 0.08);
  }
}

function spawnPlayerProjectile(target) {
  if (!target?.alive) return;
  const mesh = CreateBox(
    `player-shot-${performance.now()}`,
    { width: 0.12, height: 0.1, depth: 0.62 },
    scene
  );
  mesh.position.copyFrom(player.position);
  mesh.position.y = 0.82;
  mesh.material = materials.cyan;

  const direction = target.mesh.position.subtract(mesh.position);
  direction.y = 0;
  direction.normalize();
  mesh.rotation.y = Math.atan2(direction.x, direction.z);

  playerProjectiles.push({
    mesh,
    velocity: direction.scale(15.5),
    target,
    life: 1.35,
    damage: 2,
    pierce: run.stats.pierce,
    hitIds: new Set(),
    alive: true
  });
}

function fireAutoAttack() {
  if ((player.metadata?.actionLock ?? 0) > 0) return;
  const target = findNearestTarget(
    { x: player.position.x, z: player.position.z },
    enemies,
    13.5
  );
  if (!target) return;

  run.shotSequence += 1;
  player.rotation.y = Math.atan2(target.x - player.position.x, target.z - player.position.z);
  const targets = [target];

  if (run.stats.causality && run.shotSequence % 3 === 0) {
    const secondTarget = findNearestTarget(
      { x: player.position.x, z: player.position.z },
      enemies,
      13.5,
      target.id
    );
    if (secondTarget) targets.push(secondTarget);
  }
  playPlayerAnimation("Attack", { loop: false, speedRatio: 2.15, lock: 0.38, restart: true });
  run.pendingAttacks.push({ kind: "projectile", targets, delay: 0.135 });
}

function spawnSlashFlash(target) {
  const direction = target?.alive
    ? target.mesh.position.subtract(player.position)
    : lastMoveDirection.clone();
  direction.y = 0;
  if (direction.lengthSquared() < 0.001) direction.z = 1;
  direction.normalize();

  const id = performance.now();
  const root = new TransformNode(`blade-crescents-${id}`, scene);
  root.position.copyFrom(player.position);
  root.position.addInPlace(direction.scale(0.34));
  root.position.y = 0.44;
  root.rotation.y = Math.atan2(direction.x, direction.z);
  const cyan = createEffectMaterial(`blade-crescent-cyan-${id}`, "#5ee8ff", 0.96, 1);
  const white = createEffectMaterial(`blade-crescent-white-${id}`, "#f2ffff", 0.9, 1);
  const arcCount = prefersReducedMotion ? 2 : 3;

  for (let arcIndex = 0; arcIndex < arcCount; arcIndex += 1) {
    const radius = 0.78 + arcIndex * 0.25;
    const path = [];
    const segments = prefersReducedMotion ? 7 : 14;
    for (let index = 0; index <= segments; index += 1) {
      const angle = -1.02 + (index / segments) * 2.04;
      path.push(
        new Vector3(
          Math.sin(angle) * radius,
          arcIndex * 0.055,
          Math.cos(angle) * radius + 0.22
        )
      );
    }
    const arc = CreateTube(
      `blade-crescent-${id}-${arcIndex}`,
      {
        path,
        radius: 0.028 + arcIndex * 0.008,
        tessellation: 8,
        cap: 3
      },
      scene
    );
    arc.parent = root;
    arc.material = arcIndex === 1 ? white : cyan;
    arc.isPickable = false;
  }

  const shardCount = prefersReducedMotion ? 2 : 5;
  for (let index = 0; index < shardCount; index += 1) {
    const shard = CreateBox(
      `blade-shard-${id}-${index}`,
      { width: 0.035, height: 0.035, depth: 0.28 + index * 0.035 },
      scene
    );
    shard.position.set((index - 2) * 0.18, 0.04 + index * 0.025, 1.08 + index * 0.08);
    shard.rotation.y = (index - 2) * 0.18;
    shard.parent = root;
    shard.material = index % 2 === 0 ? white : cyan;
    shard.isPickable = false;
  }

  trackEffect(root, [cyan, white], {
    duration: 0.24,
    startScale: 0.58,
    endScale: 1.18,
    angularSpeed: 0.62,
    rise: 0.16
  });
}

function updatePendingAttacks(deltaSeconds) {
  for (const attack of run.pendingAttacks) {
    attack.delay -= deltaSeconds;
    if (attack.delay > 0) continue;
    if (attack.kind === "projectile") {
      const primary = attack.targets.find((target) => target?.alive);
      spawnSlashFlash(primary);
      for (const target of attack.targets) spawnPlayerProjectile(target);
      playSound("attack");
    } else if (attack.kind === "future-slash") {
      let hitCount = 0;
      const impactBudget = prefersReducedMotion ? 4 : 12;
      for (const [index, mark] of attack.marks.entries()) {
        if (!mark.target.alive) continue;
        damageEnemy(mark.target, 3, { impact: false });
        if (index < impactBudget) spawnImpactBurst(mark.position, "#63e5ff", 1.45);
        hitCount += 1;
      }
      playSound("ability");
      run.hitStop = Math.max(run.hitStop, hitCount > 0 ? 0.075 : 0.025);
      applyCameraImpact(hitCount > 0 ? 0.14 : 0.05, 0.16);
      showToast(`未来斬り — 2秒先の${hitCount}体へ干渉 / −2秒`);
    }
    attack.resolved = true;
  }
  run.pendingAttacks = run.pendingAttacks.filter((attack) => !attack.resolved);
}

function spawnEnemyProjectile(enemy, angleOffset = 0) {
  const isBoss = enemy.type === "boss";
  const mesh = CreateSphere(
    `enemy-shot-${performance.now()}`,
    { diameter: isBoss ? 0.48 : 0.34, segments: 8 },
    scene
  );
  mesh.position.copyFrom(enemy.mesh.position);
  mesh.position.y = isBoss ? 1.05 : 0.88;
  mesh.material = isBoss ? materials.danger : materials.violet;
  const direction = player.position.subtract(enemy.mesh.position);
  direction.y = 0;
  direction.normalize();
  if (angleOffset !== 0) {
    const cosine = Math.cos(angleOffset);
    const sine = Math.sin(angleOffset);
    const { x, z } = direction;
    direction.set(x * cosine - z * sine, 0, x * sine + z * cosine);
  }
  enemyProjectiles.push({
    mesh,
    velocity: direction.scale(isBoss ? 7.2 : 6.4),
    life: isBoss ? 3.6 : 3.2,
    damage: isBoss ? 14 : 10,
    alive: true
  });
  enemy.recoil = Math.max(enemy.recoil, isBoss ? 0.24 : 0.18);
  playSound("enemyShot");
}

function playerHit(damage, stealsTime = false) {
  if (run.invulnerable > 0 || phase !== "playing") return;
  run.hp = Math.max(0, run.hp - damage);
  run.invulnerable = 0.7;
  playPlayerAnimation("Hit", { loop: false, speedRatio: 1.8, lock: 0.34, restart: true });
  playSound("playerHit");
  run.hitStop = Math.max(run.hitStop, 0.085);
  applyCameraImpact(0.24, 0.2);
  if (stealsTime) run.remaining = Math.max(0, run.remaining - 1);
  spawnPulse(player.position, "#ff6677", 2.2, 0.36);
  showToast(stealsTime ? `時盗りに接触 — HP −${damage} / 時間 −1秒` : `被弾 — HP −${damage}`);
  if (run.hp <= 0) finishRun(false);
}

function getMovementInput() {
  let x = 0;
  let z = 0;
  if (keyState.has("KeyA") || keyState.has("ArrowLeft")) x -= 1;
  if (keyState.has("KeyD") || keyState.has("ArrowRight")) x += 1;
  if (keyState.has("KeyW") || keyState.has("ArrowUp")) z += 1;
  if (keyState.has("KeyS") || keyState.has("ArrowDown")) z -= 1;

  const gamepad = navigator.getGamepads?.()[0];
  if (gamepad) {
    const axisX = Math.abs(gamepad.axes[0] ?? 0) > 0.18 ? gamepad.axes[0] : 0;
    const axisY = Math.abs(gamepad.axes[1] ?? 0) > 0.18 ? gamepad.axes[1] : 0;
    x += axisX;
    z -= axisY;
  }

  const direction = new Vector3(x, 0, z);
  if (direction.lengthSquared() > 1) direction.normalize();
  return direction;
}

function updateGamepadActions() {
  const gamepad = navigator.getGamepads?.()[0];
  if (!gamepad || phase !== "playing") return;
  const mapping = [
    [0, "dash"],
    [4, "q"],
    [5, "e"],
    [2, "r"]
  ];

  for (const [buttonIndex, action] of mapping) {
    const pressed = Boolean(gamepad.buttons[buttonIndex]?.pressed);
    const key = `${gamepad.index}:${buttonIndex}`;
    if (pressed && !gamepadButtonState.get(key)) useSkill(action);
    gamepadButtonState.set(key, pressed);
  }
}

function spendTime(seconds) {
  if (run.remaining <= seconds + 0.6) {
    showToast("残り時間が足りません");
    return false;
  }
  run.remaining -= seconds;
  return true;
}

function dash() {
  if (run.cooldowns.dash > 0) return;
  const input = getMovementInput();
  const direction = input.lengthSquared() > 0.01 ? input : lastMoveDirection.clone();
  direction.normalize();
  const target = clampPointToCircle(
    player.position.x + direction.x * 3.8,
    player.position.z + direction.z * 3.8,
    ARENA_RADIUS
  );
  const previous = player.position.clone();
  player.position.x = target.x;
  player.position.z = target.z;
  run.invulnerable = Math.max(run.invulnerable, 0.5);
  run.cooldowns.dash = cooldownDurations.dash;
  playPlayerAnimation("Dash", { loop: false, speedRatio: 1.8, lock: 0.3, restart: true });
  playSound("dash");
  spawnTimeTrail(previous, player.position);
  spawnImpactBurst(player.position, "#63e5ff", 0.92);
}

function futureSlash() {
  if (run.cooldowns.q > 0 || !spendTime(timeCosts.q)) return;
  run.cooldowns.q = cooldownDurations.q;
  const marks = enemies
    .filter((enemy) => enemy.alive && isWithinHorizontalRadius(enemy.mesh.position, player.position, 10.5))
    .map((target) => ({
      target,
      position: predictFuturePosition(target, 2, ARENA_RADIUS)
    }));
  const detailedMarkLimit = prefersReducedMotion ? 4 : 10;
  for (const [index, mark] of marks.entries()) {
    spawnFutureMark(mark.position, { compact: index >= detailedMarkLimit });
  }
  playPlayerAnimation("FutureSlash", { loop: false, speedRatio: 1.55, lock: 0.68, restart: true });
  playSound("ability");
  run.pendingAttacks.push({ kind: "future-slash", marks, delay: 0.24 });
  gameShell.dataset.futureTargets = String(marks.length);
  showToast(`未来斬り — 2秒先の${marks.length}体を固定 / −2秒`);
}

function stopField() {
  if (run.cooldowns.e > 0 || !spendTime(timeCosts.e)) return;
  run.cooldowns.e = cooldownDurations.e;
  run.freezeRemaining = 2.5;
  spawnStopField(player.position);
  playSound("freeze");
  showToast("停止領域 — 敵だけを2.5秒停止 / −3秒");
}

function rewind() {
  if (run.cooldowns.r > 0) return;
  const targetTime = run.elapsed - 3;
  const snapshot = [...run.history].reverse().find((entry) => entry.elapsed <= targetTime);
  if (targetTime < 0 || !snapshot) {
    showToast("3秒分の履歴がまだありません");
    return;
  }
  if (!spendTime(timeCosts.r)) return;

  const before = player.position.clone();
  player.position.set(snapshot.x, 0, snapshot.z);
  run.hp = Math.max(run.hp, snapshot.hp);
  run.invulnerable = 0.8;
  run.cooldowns.r = cooldownDurations.r;
  playPlayerAnimation("Dash", { loop: false, speedRatio: 2.2, lock: 0.28, restart: true });
  playSound("ability");
  spawnTimeTrail(before, player.position, { rewindTrail: true });
  spawnPulse(before, "#b691ff", 2.2, 0.46);
  spawnPulse(player.position, "#63e5ff", 2.7, 0.52);
  showToast("巻き戻し — 3秒前の位置とHPへ復帰 / −4秒");
}

function useSkill(skill) {
  if (phase !== "playing" || !run) return;
  if (skill === "dash") dash();
  if (skill === "q") futureSlash();
  if (skill === "e") stopField();
  if (skill === "r") rewind();
  updateHud();
}

function openUpgrade() {
  run.upgradeOffered = true;
  setPhase("upgrade");
  announce("時間停止。3つの遺物からひとつ選んでください。");
  upgradeButtons[0].focus({ preventScroll: true });
}

function selectUpgrade(upgradeId) {
  const upgrade = UPGRADES[upgradeId];
  if (!upgrade || phase !== "upgrade") return;
  run.stats = applyUpgrade(run.stats, upgradeId);
  run.selectedUpgrade = upgrade;
  setPhase("playing");
  playSound("upgrade");
  spawnPulse(player.position, upgradeId === "hourglass" ? "#f6cc73" : upgradeId === "causality" ? "#b691ff" : "#63e5ff", 4, 0.62);
  showToast(`${upgrade.name}を獲得`);
  announce(`${upgrade.name}を獲得。戦闘を再開します。`);
  canvas.focus({ preventScroll: true });
}

function togglePause(forcePaused = null) {
  if (phase === "title" || phase === "result" || phase === "upgrade") return;
  const shouldPause = forcePaused ?? phase === "playing";
  if (shouldPause && phase === "playing") {
    setPhase("paused");
    resumeButton.focus({ preventScroll: true });
  } else if (!shouldPause && phase === "paused") {
    setPhase("playing");
    canvas.focus({ preventScroll: true });
  }
}

function finishRun(survived) {
  if (phase === "result") return;
  hideToast();
  run.remaining = Math.max(0, run.remaining);
  const rank = calculateRunRank({ survived, kills: run.kills, hp: run.hp });
  resultRank.textContent = rank;
  resultKicker.textContent = survived ? "Run complete" : "Timeline collapsed";
  resultTitle.textContent = survived ? "時間は、味方した。" : "時間軸が、途切れた。";
  resultDescription.textContent = survived
    ? run.bossDefeated
      ? "60秒を生存し、時喰らいヴァルゴスも撃破しました。完全な時間軸です。"
      : "60秒を生存しました。次は時喰らいヴァルゴスの撃破を狙えます。"
    : "HPが尽きました。敵の優先順位と能力を使う瞬間を変えて再挑戦できます。";
  resultKills.textContent = String(run.kills);
  resultShards.textContent = String(run.shards);
  resultUpgrade.textContent = run.selectedUpgrade?.name ?? "なし";
  setPhase("result");
  playSound("result");
  announce(survived ? "ラン成功" : "ラン失敗");
  retryButton.focus({ preventScroll: true });
}

function updateHistory(deltaSeconds) {
  run.historyClock -= deltaSeconds;
  if (run.historyClock > 0) return;
  run.historyClock = 0.1;
  run.history.push({
    elapsed: run.elapsed,
    x: player.position.x,
    z: player.position.z,
    hp: run.hp
  });
  while (run.history.length > 42) run.history.shift();
}

function updatePlayer(deltaSeconds) {
  const direction = getMovementInput();
  player.metadata.actionLock = Math.max(0, player.metadata.actionLock - deltaSeconds);
  if (direction.lengthSquared() > 0.01) {
    lastMoveDirection.copyFrom(direction);
    player.position.addInPlace(direction.scale(7.4 * deltaSeconds));
    const clamped = clampPointToCircle(player.position.x, player.position.z, ARENA_RADIUS);
    player.position.x = clamped.x;
    player.position.z = clamped.z;
    player.rotation.y = Math.atan2(direction.x, direction.z);
  }

  if (player.metadata.actionLock <= 0) {
    playPlayerAnimation(direction.lengthSquared() > 0.01 ? "Run" : "Idle", {
      speedRatio: direction.lengthSquared() > 0.01 ? 1.16 : 1
    });
  }

  run.invulnerable = Math.max(0, run.invulnerable - deltaSeconds);
  if (!prefersReducedMotion) {
    const haloScale = 0.96 + Math.sin(run.elapsed * 5.2) * 0.04;
    player.metadata.halo.scaling.set(haloScale, haloScale, haloScale);
  }
  const flicker = run.invulnerable > 0 && Math.floor(run.invulnerable * 18) % 2 === 0;
  player.setEnabled(!flicker);
  if (run.invulnerable <= 0) player.setEnabled(true);
}

function updateEnemies(deltaSeconds) {
  const hourglassSlow = run.stats.hourglass && run.remaining <= 10 ? 0.45 : 1;
  const worldSpeed = run.freezeRemaining > 0 ? 0.035 : hourglassSlow;

  for (const enemy of enemies) {
    if (!enemy.alive) {
      if (enemy.dying) {
        enemy.deathRemaining -= deltaSeconds;
        if (enemy.deathRemaining <= 0) {
          enemy.dying = false;
          enemy.mesh.setEnabled(false);
        }
      }
      continue;
    }
    enemy.actionLock = Math.max(0, enemy.actionLock - deltaSeconds * worldSpeed);
    enemy.contactCooldown = Math.max(0, enemy.contactCooldown - deltaSeconds);
    enemy.shootCooldown -= deltaSeconds * worldSpeed;
    enemy.phase += deltaSeconds * 2;
    enemy.hitPulse = Math.max(0, enemy.hitPulse - deltaSeconds);
    enemy.recoil = Math.max(0, enemy.recoil - deltaSeconds);

    const offset = player.position.subtract(enemy.mesh.position);
    offset.y = 0;
    const distance = Math.max(0.001, offset.length());
    const direction = offset.scale(1 / distance);
    let movement = direction;

    if (enemy.type === "boss") {
      if (distance < 7.6) movement = direction.scale(-1);
      else if (distance <= 10.2) {
        movement = new Vector3(direction.z, 0, -direction.x).scale(Math.sin(enemy.phase * 0.55) > 0 ? 1 : -1);
      }
      if (enemy.shootCooldown <= 0 && distance < 14.5 && run.freezeRemaining <= 0) {
        playEnemyAnimation(enemy, "Attack", { loop: false, speedRatio: 1.05, lock: 0.48, restart: true });
        for (const spread of [-0.2, 0, 0.2]) spawnEnemyProjectile(enemy, spread);
        spawnPulse(enemy.mesh.position, "#ff465f", 2.2, 0.34);
        enemy.shootCooldown = 1.18;
      }
    } else if (enemy.type === "shooter") {
      if (distance < 7.2) movement = direction.scale(-1);
      else if (distance <= 10.5) movement = new Vector3(direction.z, 0, -direction.x).scale(Math.sin(enemy.phase) > 0 ? 1 : -1);
      if (enemy.shootCooldown <= 0 && distance < 13.5 && run.freezeRemaining <= 0) {
        playEnemyAnimation(enemy, "Attack", { loop: false, speedRatio: 1.2, lock: 0.42, restart: true });
        spawnEnemyProjectile(enemy);
        enemy.shootCooldown = 1.85 + Math.random() * 0.55;
      }
    }

    const velocity = movement.scale(enemy.speed * worldSpeed);
    enemy.velocityX = velocity.x;
    enemy.velocityZ = velocity.z;
    enemy.mesh.position.addInPlace(velocity.scale(deltaSeconds));
    const clamped = clampPointToCircle(enemy.mesh.position.x, enemy.mesh.position.z, ARENA_RADIUS + 0.35);
    enemy.mesh.position.x = clamped.x;
    enemy.mesh.position.z = clamped.z;
    const hoverAmount = enemy.type === "shooter" ? 0.12 : enemy.type === "thief" ? 0.09 : 0.035;
    enemy.mesh.position.y = enemy.baseY + Math.sin(enemy.phase * 2.2) * hoverAmount;
    enemy.mesh.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;
    enemy.mesh.rotation.x = enemy.recoil > 0 ? -Math.sin((enemy.recoil / 0.24) * Math.PI) * 0.18 : 0;
    enemy.mesh.rotation.z = movement.x * 0.055;
    const hitScale = 1 + (enemy.hitPulse / 0.12) * 0.11;
    const recoilScale = 1 - (enemy.recoil / 0.24) * 0.07;
    enemy.mesh.scaling.set(
      enemy.baseScale * hitScale,
      enemy.baseScale * recoilScale,
      enemy.baseScale * hitScale
    );
    enemy.x = enemy.mesh.position.x;
    enemy.z = enemy.mesh.position.z;
    if (enemy.rune) {
      enemy.rune.position.x = enemy.mesh.position.x;
      enemy.rune.position.z = enemy.mesh.position.z;
      enemy.rune.rotation.y += deltaSeconds * 0.75 * worldSpeed;
      const pulse = 0.9 + Math.sin(enemy.phase * 1.5) * 0.08;
      enemy.rune.scaling.set(pulse, pulse, pulse);
    }

    const contactDistance = enemy.type === "boss" ? 1.7 : 1.05;
    if (distance < contactDistance && enemy.contactCooldown <= 0) {
      playEnemyAnimation(enemy, "Attack", { loop: false, speedRatio: 1.28, lock: 0.38, restart: true });
      playerHit(enemy.damage, enemy.type === "thief");
      enemy.contactCooldown = 0.9;
      enemy.mesh.position.addInPlace(direction.scale(-1.35));
    }
    if (enemy.actionLock <= 0) {
      playEnemyAnimation(enemy, "Move", { speedRatio: enemy.type === "boss" ? 0.78 : 1 + enemy.speed * 0.06 });
    }
  }

  run.freezeRemaining = Math.max(0, run.freezeRemaining - deltaSeconds);
}

function updatePlayerProjectiles(deltaSeconds) {
  for (const projectile of playerProjectiles) {
    if (!projectile.alive) continue;
    projectile.life -= deltaSeconds;
    if (projectile.life <= 0) {
      projectile.alive = false;
      projectile.mesh.setEnabled(false);
      continue;
    }

    if (projectile.target?.alive) {
      const desired = projectile.target.mesh.position.subtract(projectile.mesh.position);
      desired.y = 0;
      if (desired.lengthSquared() > 0.001) {
        desired.normalize();
        const current = projectile.velocity.normalizeToNew();
        projectile.velocity = Vector3.Lerp(current, desired, Math.min(1, deltaSeconds * 4.8)).normalize().scale(15.5);
      }
    }

    projectile.mesh.rotation.y = Math.atan2(projectile.velocity.x, projectile.velocity.z);
    projectile.mesh.position.addInPlace(projectile.velocity.scale(deltaSeconds));

    for (const enemy of enemies) {
      if (!enemy.alive || projectile.hitIds.has(enemy.id)) continue;
      const hitRadius = enemy.type === "boss" ? 1.8 : 0.85;
      if (!isWithinHorizontalRadius(projectile.mesh.position, enemy.mesh.position, hitRadius)) continue;
      projectile.hitIds.add(enemy.id);
      damageEnemy(enemy, projectile.damage);
      if (projectile.pierce > 0) projectile.pierce -= 1;
      else {
        projectile.alive = false;
        projectile.mesh.setEnabled(false);
        break;
      }
    }
  }
}

function updateEnemyProjectiles(deltaSeconds) {
  const hourglassSlow = run.stats.hourglass && run.remaining <= 10 ? 0.45 : 1;
  const worldSpeed = run.freezeRemaining > 0 ? 0.035 : hourglassSlow;

  for (const projectile of enemyProjectiles) {
    if (!projectile.alive) continue;
    projectile.life -= deltaSeconds * worldSpeed;
    if (projectile.life <= 0) {
      projectile.alive = false;
      projectile.mesh.setEnabled(false);
      continue;
    }
    projectile.mesh.position.addInPlace(projectile.velocity.scale(deltaSeconds * worldSpeed));
    if (isWithinHorizontalRadius(projectile.mesh.position, player.position, 0.82)) {
      projectile.alive = false;
      projectile.mesh.setEnabled(false);
      playerHit(projectile.damage, false);
    }
  }
}

function updateEffects(deltaSeconds) {
  for (const effect of effects) {
    if (!effect.alive) continue;
    effect.age += deltaSeconds;
    const progress = Math.min(1, effect.age / effect.duration);
    const eased = 1 - (1 - progress) ** 3;
    const scale = effect.startScale + (effect.endScale - effect.startScale) * eased;
    effect.mesh.scaling.setAll(scale);
    effect.mesh.rotation.y += (effect.angularSpeed ?? 0) * deltaSeconds;
    effect.mesh.position.y = effect.baseY + Math.sin(progress * Math.PI) * effect.rise;
    for (const rotor of effect.rotors ?? []) {
      rotor.node.rotation.y += rotor.speed * deltaSeconds;
    }
    const fadeProgress =
      progress <= effect.fadeStart
        ? 0
        : (progress - effect.fadeStart) / Math.max(0.001, 1 - effect.fadeStart);
    for (const material of effect.materials ?? []) {
      const baseAlpha = material.metadata?.effectBaseAlpha ?? 0.9;
      material.alpha = baseAlpha * (1 - fadeProgress) ** 1.6;
    }
    if (progress >= 1) {
      effect.alive = false;
      effect.mesh.setEnabled(false);
    }
  }
}

function cleanupDisposedObjects() {
  for (const collection of [enemies, playerProjectiles, enemyProjectiles, effects]) {
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      const item = collection[index];
      if (item.alive || item.dying) continue;
      for (const animation of item.animations?.values?.() ?? []) animation.dispose();
      item.mesh?.dispose();
      item.rune?.dispose();
      item.material?.dispose();
      for (const material of item.materials ?? []) material.dispose();
      collection.splice(index, 1);
    }
  }
}

function updateCooldowns(deltaSeconds) {
  for (const key of Object.keys(run.cooldowns)) {
    run.cooldowns[key] = Math.max(0, run.cooldowns[key] - deltaSeconds);
  }
}

function updateRun(deltaSeconds) {
  if (run.hitStop > 0) {
    run.hitStop = Math.max(0, run.hitStop - deltaSeconds);
    gameShell.dataset.hitStop = run.hitStop > 0 ? "active" : "idle";
    updateEffects(deltaSeconds * 0.35);
    return;
  }
  run.elapsed += deltaSeconds;
  gameShell.dataset.elapsed = run.elapsed.toFixed(2);
  run.remaining = Math.max(0, run.remaining - deltaSeconds);
  run.spawnClock -= deltaSeconds;
  run.attackClock -= deltaSeconds;

  updateGamepadActions();
  updatePlayer(deltaSeconds);
  updateEnemies(deltaSeconds);
  updatePendingAttacks(deltaSeconds);
  updatePlayerProjectiles(deltaSeconds);
  updateEnemyProjectiles(deltaSeconds);
  updateEffects(deltaSeconds);
  updateCooldowns(deltaSeconds);
  updateHistory(deltaSeconds);

  if (run.spawnClock <= 0) {
    const groupSize = run.elapsed > 42 ? 2 : 1;
    for (let index = 0; index < groupSize; index += 1) spawnEnemy(enemyTypeForElapsed(run.elapsed));
    run.spawnClock = getSpawnInterval(run.elapsed);
  }

  if (run.attackClock <= 0) {
    fireAutoAttack();
    run.attackClock = run.stats.attackInterval;
  }

  if (!run.upgradeOffered && run.remaining <= 30) openUpgrade();
  if (shouldSpawnBoss({ remaining: run.remaining, bossSpawned: run.bossSpawned, phase })) spawnBoss();
  if (run.remaining <= 0 && phase === "playing") finishRun(true);
  cleanupDisposedObjects();
  updateHud();
}

function updateHud() {
  if (!run) return;
  const timeProgress = Math.max(0, Math.min(1, run.remaining / RUN_DURATION_SECONDS));
  timer.style.setProperty("--time-progress", timeProgress.toFixed(4));
  timer.classList.toggle("is-critical", run.remaining <= 10);
  timeValue.textContent = formatRemainingTime(run.remaining);
  hpValue.textContent = String(Math.ceil(run.hp));
  hpFill.style.width = `${Math.max(0, (run.hp / run.maxHp) * 100)}%`;
  xpFill.style.width = `${Math.max(0, Math.min(100, (run.xp / run.xpTarget) * 100))}%`;
  levelValue.textContent = String(run.level).padStart(2, "0");
  killValue.textContent = String(run.kills).padStart(3, "0");
  shardValue.textContent = String(run.shards).padStart(3, "0");

  const boss = enemies.find((enemy) => enemy.alive && enemy.id === run.bossId);
  bossMeter.hidden = !boss;
  if (boss) {
    bossHpFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    bossHpValue.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
  }

  for (const button of abilityButtons) {
    const skill = button.dataset.skill;
    const cooldown = run.cooldowns[skill];
    const duration = cooldownDurations[skill];
    const cannotAfford = run.remaining <= timeCosts[skill] + 0.6;
    const skillName = button.querySelector("strong").textContent;
    const costLabel = timeCosts[skill] > 0 ? `−${timeCosts[skill]}秒` : "消費なし";
    const state = cooldown > 0 ? "cooldown" : cannotAfford ? "cost" : "ready";
    button.disabled = phase !== "playing" || cooldown > 0 || cannotAfford;
    button.dataset.state = state;
    button.setAttribute(
      "aria-label",
      cooldown > 0
        ? `${skillName}、${costLabel}、クールダウン残り${Math.ceil(cooldown)}秒`
        : cannotAfford
          ? `${skillName}、${costLabel}、残り時間不足`
          : `${skillName}、${costLabel}、使用可能`
    );
    const stateOutput = abilityStates.get(skill);
    if (stateOutput) {
      stateOutput.textContent = cooldown > 0
        ? `${cooldown.toFixed(1)}s`
        : cannotAfford
          ? "NO TIME"
          : timeCosts[skill] > 0
            ? `READY · −${timeCosts[skill]}s`
            : "READY";
    }
    const indicator = cooldownIndicators.get(skill);
    if (indicator) indicator.style.height = `${duration ? (cooldown / duration) * 100 : 0}%`;
  }
}

function animateArena(deltaSeconds) {
  for (const item of clockwork) item.mesh.rotation.y += item.speed * deltaSeconds;
}

function ensureSsao() {
  if (ssao || !SSAO2RenderingPipeline.IsSupported) return;
  // 半解像度でだけ生成し、lowではこのパイプライン自体を持たない。
  ssao = new SSAO2RenderingPipeline("arena-ssao", scene, { ssaoRatio: 0.5, blurRatio: 0.5 });
  ssao.radius = 1.18;
  ssao.base = 0.03;
  ssao.epsilon = 0.03;
  ssao.expensiveBlur = true;
  ssao.bilateralSoften = 0.08;
  ssao.bilateralTolerance = 0.18;
}

function disposeSsao() {
  if (!ssao) return;
  ssao.dispose();
  ssao = null;
  // SSAO2が有効化したPrePassも破棄し、lowの追加GPUコストを残さない。
  scene.disablePrePassRenderer();
}

function applyQuality(quality) {
  if (!engine || !glow) return;
  if (quality === "low") {
    disposeSsao();
  } else {
    ensureSsao();
    if (ssao) {
      // 重ねてアタッチしないよう毎回外してから、mid/highだけを戻す。
      scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(ssao.name, camera);
      const highQuality = quality === "high";
      ssao.samples = highQuality ? 8 : 4;
      ssao.bilateralSamples = highQuality ? 6 : 4;
      ssao.totalStrength = highQuality ? 0.58 : 0.42;
      scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(ssao.name, camera, true);
    }
  }
  if (quality === "low") {
    engine.setHardwareScalingLevel(1.55);
    glow.intensity = 0.34;
  } else if (quality === "high") {
    engine.setHardwareScalingLevel(1);
    glow.intensity = 0.72;
  } else {
    engine.setHardwareScalingLevel(1.2);
    glow.intensity = 0.56;
  }
  engine.resize();
}

function handleKeyDown(event) {
  if (
    event.target instanceof HTMLElement
    && event.target.closest("button, a, input, select, textarea, [contenteditable='true']")
  ) return;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
  if (event.code === "Escape") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.repeat) return;
  keyState.add(event.code);
  if (event.code === "Space") useSkill("dash");
  if (event.code === "KeyQ") useSkill("q");
  if (event.code === "KeyE") useSkill("e");
  if (event.code === "KeyR") useSkill("r");
}

function bindEvents() {
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", (event) => keyState.delete(event.code));
  window.addEventListener("blur", () => keyState.clear());
  window.addEventListener("resize", () => engine.resize());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && phase === "playing") togglePause(true);
  });

  canvas.addEventListener("pointerdown", () => canvas.focus({ preventScroll: true }));
  startButton.addEventListener("click", startRun);
  retryButton.addEventListener("click", startRun);
  pauseButton.addEventListener("click", () => togglePause());
  resumeButton.addEventListener("click", () => togglePause(false));
  restartFromPauseButton.addEventListener("click", startRun);
  audioButton.addEventListener("click", toggleAudio);
  qualitySelect.addEventListener("change", () => applyQuality(qualitySelect.value));
  abilityButtons.forEach((button) => button.addEventListener("click", () => useSkill(button.dataset.skill)));
  upgradeButtons.forEach((button) => button.addEventListener("click", () => selectUpgrade(button.dataset.upgrade)));
}

function installDevHarness() {
  if (!import.meta.env.DEV) return;
  Object.defineProperty(window, "__chronoArenaTest", {
    configurable: true,
    value: Object.freeze({
      advance(seconds) {
        const requested = Math.max(0, Number(seconds) || 0);
        let simulated = 0;
        while (phase === "playing" && simulated < requested) {
          const step = Math.min(0.04, requested - simulated);
          updateRun(step);
          simulated += step;
        }
        return {
          simulated,
          phase,
          elapsed: run?.elapsed ?? 0,
          hp: run?.hp ?? 0,
          kills: run?.kills ?? 0
        };
      }
    })
  });
}

async function boot() {
  initScene();
  updateAudioButton();
  await loadModelAssets();
  player = createPlayer();
  playPlayerAnimation("Idle");
  bindEvents();
  installDevHarness();
  setPhase("title");

  scene.onBeforeRenderObservable.add(() => {
    try {
      const deltaSeconds = Math.min(0.04, engine.getDeltaTime() / 1000);
      animateArena(deltaSeconds);
      if (phase === "playing") updateRun(deltaSeconds);
      else updateEffects(deltaSeconds);
      updateCameraFeedback(deltaSeconds);
    } catch (error) {
      if (!frameFailureReported) {
        frameFailureReported = true;
        console.error("Chrono Arena frame failed", error);
        bootError.hidden = false;
        bootError.textContent = "ゲーム更新中にエラーが発生しました。Consoleの詳細を確認してください。";
      }
    }
  });

  let renderedFrames = 0;
  engine.runRenderLoop(() => {
    renderedFrames += 1;
    gameShell.dataset.frame = String(renderedFrames);
    try {
      scene.render();
    } catch (error) {
      if (!frameFailureReported) {
        frameFailureReported = true;
        console.error("Chrono Arena render failed", error);
        bootError.hidden = false;
        bootError.textContent = "3D描画中にエラーが発生しました。Consoleの詳細を確認してください。";
      }
    }
  });
  gameShell.dataset.ready = "true";
  bootError.hidden = true;
  startButton.textContent = "60秒ランを開始";
}

boot().catch((error) => {
  console.error("Chrono Arena failed to boot", error);
  bootError.hidden = false;
  startButton.disabled = true;
  startButton.textContent = "3Dエンジンを開始できません";
  assetStatus.textContent = "Blenderアセットの読み込みに失敗しました";
});
