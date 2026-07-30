import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_meshopt_compression.js";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp.js";
// gltfpack は UV を量子化する代わりに KHR_texture_transform でスケールを補正する。
// この拡張は extensionsRequired には入らないため、未登録だとローダーがエラーを出さず
// 黙って無視し、テクスチャのサンプリング位置だけがずれて別モデルのように見える。
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform.js";

import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
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

import { TexturedEffectController } from "./textured-effects.js";

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
// 開発時の実機撮影だけは中間フレームを観測できるようにする。通常ビルドの演出時間は不変。
const visualTestMode = import.meta.env.DEV && new URLSearchParams(window.location.search).has("visual-test");
const visualPreviewEnemy = visualTestMode ? new URLSearchParams(window.location.search).get("enemy-preview") : null;
const visualPreviewEffect = visualTestMode ? new URLSearchParams(window.location.search).get("effect-preview") : null;
const visualAutoStart = visualTestMode && new URLSearchParams(window.location.search).has("auto-start");
const visualPreviewSwarm = visualTestMode ? Number(new URLSearchParams(window.location.search).get("swarm")) : 0;
const visualPreviewCrowded = visualTestMode && new URLSearchParams(window.location.search).has("crowded");
const keyState = new Set();
const gamepadButtonState = new Map();
const enemies = [];
const playerProjectiles = [];
const enemyProjectiles = [];
const effects = [];
const pooledEffects = [];
const clockwork = [];
const modelContainers = new Map();
const effectPools = {
  impacts: [],
  erasures: [],
  enemyProjectiles: [],
  elementalImpacts: [],
  enemyTelegraphs: [],
  enemyMuzzles: [],
  enemyMelee: [],
  enemyDissipations: [],
  chronoSlashes: [],
  chronoRifts: [],
  chronoStopFields: [],
  chronoTrails: [],
  playerProjectiles: []
};
const effectColorCache = new Map();
const enemyAttackColors = Object.freeze({
  shooter: "#d946ef",
  boss: "#dc2626",
  thief: "#c026d3",
  chaser: "#e11d48"
});
// 敵種の役割と視覚属性を分離する。ダメージ・弾速・射程・当たり判定には使わない。
const enemyAttackElements = Object.freeze({
  chaser: "fire",
  shooter: "lightning",
  thief: "void",
  boss: "fire"
});
const elementalPalette = Object.freeze({
  fire: Object.freeze({ primary: "#ff3b30", accent: "#ffbf5a", deep: "#74121a" }),
  lightning: Object.freeze({ primary: "#df45f3", accent: "#ffffff", deep: "#7a1a9d" }),
  void: Object.freeze({ primary: "#a630b8", accent: "#df73ee", deep: "#09040f" }),
  chrono: Object.freeze({ primary: "#58e9ff", accent: "#f1ffff", deep: "#126d91" })
});
const enemyDeathColors = Object.freeze({
  ...enemyAttackColors
});
const enemyProjectileMaterials = new Map();
const effectQuality = {
  impactSlots: 10,
  impactSparks: 5,
  erasureSlots: 6,
  erasureSparks: 4,
  enemyProjectileSlots: 24,
  enemyTelegraphSlots: 10,
  enemyMuzzleSlots: 12,
  enemyMeleeSlots: 8,
  enemyDissipationSlots: 8,
  enemyProjectileDetail: true,
  elementalImpactSlots: 10,
  fireTongues: 5,
  lightningSegments: 5,
  lightningBranches: 3,
  voidShards: 5,
  chronoRiftSlots: 10,
  chronoRiftEchoes: 4,
  chronoTrailEchoes: 7,
  playerProjectileSlots: 12,
  enemyMuzzleRays: 3,
  enemyMeleeLayers: 2,
  enemyDissipationSparks: 3
};

const assetPaths = Object.freeze({
  arena: new URL("../assets/production/arena-clockwork.png", import.meta.url).href,
  environment: new URL("../assets/production/env/arena-clockwork-ibl.hdr", import.meta.url).href,
  // ねんどろいど風デフォルメ版（三面図 → 画像→3D → リメッシュ → 16骨リグ → アニメーション）。
  // 制作手順は docs/character-asset-pipeline.html を参照。
  // 旧モデル（enemy-*-concept.glb / chrono-duelist-custom.glb）はロールバック用に残してある。
  //
  // 5体すべて画像→3DをTRELLIS.2に差し替えた高精細版。SPAR3D版（demonic/animated/
  // *-nendo-animated.glb）もロールバック用に残してある。
  //
  // TRELLIS.2版はテクスチャ解像度が高く非圧縮では §12 の予算（主人公 約3.2MB、
  // 敵 1.5MB）を超えるため、gltfpack で圧縮した models/ 側を読む。圧縮すると
  // glTF 拡張が増えるので、読み込み側の import 追加も必要になる（冒頭を参照）。
  heroModel: new URL("../assets/production/models/hero-nendo-trellis2.glb", import.meta.url).href,
  chaserModel: new URL("../assets/production/models/chaser-nendo-trellis2.glb", import.meta.url).href,
  shooterModel: new URL("../assets/production/models/shooter-nendo-trellis2.glb", import.meta.url).href,
  thiefModel: new URL("../assets/production/models/thief-nendo-trellis2.glb", import.meta.url).href,
  bossModel: new URL("../assets/production/models/boss-nendo-trellis2.glb", import.meta.url).href,
  // 演出用は1回だけロードして、ParticleSystem と固定板プールで共有する。
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
let texturedEffects;

function getEffectColor(colorHex) {
  if (!effectColorCache.has(colorHex)) effectColorCache.set(colorHex, Color3.FromHexString(colorHex));
  return effectColorCache.get(colorHex);
}

function getEffectDuration(duration) {
  return visualTestMode ? duration * 60 : duration;
}

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
  // ねんどろいど版は身長 1.8m に正規化済み。旧モデル（bbox 高さ 2.58 × 1.32）と
  // 同じ見かけの大きさになるよう検証ページで合わせた値。
  modelAnchor.scaling.setAll(1.9);
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
  texturedEffects = new TexturedEffectController({
    scene,
    assetPaths,
    palette: elementalPalette,
    prefersReducedMotion,
    visualTestMode
  });
  initEffectPools();
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
    deactivatePooledEffect(item.visual);
    for (const animation of item.animations?.values?.() ?? []) animation.dispose();
    item.mesh?.dispose();
    item.rune?.dispose();
    item.material?.dispose();
    for (const record of item.dissolveMaterials ?? []) record.material.dispose();
    for (const material of item.materials ?? []) material.dispose();
  }
  collection.length = 0;
}

function resetRun() {
  disposeCollection(enemies);
  disposeCollection(playerProjectiles);
  disposeCollection(enemyProjectiles);
  disposeCollection(effects);
  resetPooledEffects();
  texturedEffects?.reset();

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
    invulnerable: visualTestMode ? 999 : 1.35,
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
  // DEVの撮影URLだけで、実際の敵更新経路へ近距離の一体を置く。通常ランの敵配置・難度には影響しない。
  if (visualPreviewEnemy) {
    disposeCollection(enemies);
    spawnVisualEnemyPreview(visualPreviewEnemy);
  }
  if (visualPreviewSwarm > 0) spawnVisualSwarm(visualPreviewSwarm);
  // 実機撮影専用。通常ビルドでは到達せず、実装済みの共有テクスチャ経路だけを初期フレームで起動する。
  if (visualPreviewEffect && elementalPalette[visualPreviewEffect]) {
    if (!visualPreviewSwarm) {
      // 単体撮影では自動攻撃を止め、対象の余韻だけを画面で追えるようにする。
      disposeCollection(enemies);
      run.spawnClock = Number.POSITIVE_INFINITY;
      run.attackClock = Number.POSITIVE_INFINITY;
    }
    const previewPosition = player.position.clone();
    // 自機モデルに隠れない右前方の床で、実機撮影時だけ同じ演出を観測する。
    previewPosition.x += 3.2;
    previewPosition.z += 1.2;
    if (visualPreviewEffect === "chrono") {
      texturedEffects.spawnChronoRift(previewPosition, 1.28);
      texturedEffects.spawnChronoImpact(previewPosition, 1.45);
    } else {
      texturedEffects.spawnElementalImpact(previewPosition, visualPreviewEffect, lastMoveDirection);
    }
  }
  if (visualPreviewCrowded) spawnCrowdedEffectPreview();
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
  // ねんどろいど版は全員 身長 1.8m に正規化済みなので、この係数がそのまま
  // 画面上の大きさを決める。検証ページ（tools/asset-preview.html）で合わせた値。
  const scale = { chaser: 1.5, shooter: 1.8, thief: 1.7, boss: 2.2 }[type];
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
    deathDuration: 0,
    dissolveMaterials: [],
    contactCooldown: 0,
    shootCooldown: type === "boss" ? 0.65 : 0.8 + Math.random() * 1.1,
    attackTelegraphActive: false,
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

function spawnVisualEnemyPreview(type) {
  if (phase !== "playing" || !enemyAttackColors[type]) return false;
  const distance = type === "boss" ? 6.8 : type === "chaser" ? 0.82 : 6.1;
  const enemy = spawnEnemy(type, 0, distance);
  if (!enemy) return false;
  enemy.speed = 0;
  enemy.mesh.position.set(player.position.x, enemy.baseY, player.position.z + distance);
  enemy.x = enemy.mesh.position.x;
  enemy.z = enemy.mesh.position.z;
  enemy.shootCooldown = type === "boss" ? 0.48 : 0.42;
  enemy.contactCooldown = 0;
  run.spawnClock = Number.POSITIVE_INFINITY;
  // visual-testでは生存固定を外し、衝突時の衝撃波まで実機画面で確認する。
  run.invulnerable = 0;
  return { id: enemy.id, type };
}

function spawnVisualSwarm(count = 12) {
  if (phase !== "playing") return false;
  // DEV撮影だけで密集時を再現する。通常ランの敵数・AI・戦闘値は変更しない。
  disposeCollection(enemies);
  const safeCount = Math.max(10, Math.min(24, Math.round(Number(count) || 12)));
  const types = ["chaser", "shooter", "thief"];
  for (let index = 0; index < safeCount; index += 1) {
    const enemy = spawnEnemy(types[index % types.length], (index / safeCount) * Math.PI * 2, 5.7 + (index % 3) * 0.78);
    if (!enemy) continue;
    enemy.speed = 0;
    enemy.shootCooldown = Number.POSITIVE_INFINITY;
  }
  run.spawnClock = Number.POSITIVE_INFINITY;
  run.attackClock = Number.POSITIVE_INFINITY;
  run.invulnerable = 999;
  gameShell.dataset.visualEnemyCount = String(enemies.length);
  return { enemies: enemies.length, phase };
}

function spawnCrowdedEffectPreview() {
  if (phase !== "playing" || !texturedEffects || enemies.length < 10) return false;
  // 実装済みの属性別バーストを敵位置で起動し、密集時の上限・簡略化を実機確認する。
  const elements = ["fire", "lightning", "void", "chrono"];
  for (const [index, enemy] of enemies.entries()) {
    const element = elements[index % elements.length];
    if (element === "chrono") texturedEffects.spawnChronoRift(enemy.mesh.position, 0.92);
    else texturedEffects.spawnElementalImpact(enemy.mesh.position, element, lastMoveDirection);
  }
  const diagnostics = texturedEffects.getDiagnostics();
  gameShell.dataset.visualEffectEvents = String(diagnostics.activeEffectEvents);
  gameShell.dataset.visualGroundTraces = String(diagnostics.activeGroundTraces);
  gameShell.dataset.visualParticleSystems = String(diagnostics.systems.length);
  return { enemies: enemies.length, textured: diagnostics };
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

function setPooledEffectMaterial(material, colorHex, alpha) {
  const color = getEffectColor(colorHex);
  material.diffuseColor.copyFrom(color);
  material.emissiveColor.copyFrom(color);
  material.alpha = alpha;
  material.metadata.effectBaseAlpha = alpha;
}

function setPooledEffectAlpha(material, progress, exponent = 1.6) {
  const baseAlpha = material.metadata?.effectBaseAlpha ?? 0.9;
  material.alpha = baseAlpha * (1 - progress) ** exponent;
}

function createImpactArc(name, radius, height, material) {
  const path = [];
  const segments = 10;
  for (let index = 0; index <= segments; index += 1) {
    const angle = -1.2 + (index / segments) * 2.4;
    path.push(new Vector3(Math.sin(angle) * radius, height + Math.cos(angle) * radius * 0.5, 0));
  }
  const arc = CreateTube(name, { path, radius: 0.052, tessellation: 8, cap: 3 }, scene);
  arc.material = material;
  arc.isPickable = false;
  return arc;
}

function createImpactPoolSlot(index) {
  const root = new TransformNode(`impact-pool-${index}`, scene);
  const primary = createEffectMaterial(`impact-pool-primary-${index}`, "#63e5ff", 0.94, 1);
  const accent = createEffectMaterial(`impact-pool-accent-${index}`, "#fff3c9", 0.86, 1);
  const arcs = [
    createImpactArc(`impact-arc-primary-${index}`, 1.08, 0.62, primary),
    createImpactArc(`impact-arc-accent-${index}`, 0.78, 0.82, accent)
  ];
  arcs.forEach((arc) => (arc.parent = root));

  const rings = [0, 1].map((ringIndex) => {
    const ring = CreateTorus(
      `impact-ring-${index}-${ringIndex}`,
      { diameter: ringIndex === 0 ? 1.72 : 1.04, thickness: ringIndex === 0 ? 0.085 : 0.055, tessellation: 24 },
      scene
    );
    ring.position.y = 0.035 + ringIndex * 0.05;
    ring.material = ringIndex === 0 ? primary : accent;
    ring.parent = root;
    ring.isPickable = false;
    return ring;
  });

  const core = CreateSphere(`impact-core-${index}`, { diameter: 0.96, segments: 8 }, scene);
  core.position.y = 0.68;
  core.material = accent;
  core.parent = root;
  core.isPickable = false;

  const sparks = [];
  for (let sparkIndex = 0; sparkIndex < 7; sparkIndex += 1) {
    const spark = CreateBox(`impact-spark-${index}-${sparkIndex}`, { width: 0.075, height: 0.075, depth: 0.3 }, scene);
    spark.material = sparkIndex % 3 === 0 ? accent : primary;
    spark.parent = root;
    spark.isPickable = false;
    sparks.push({ mesh: spark, velocity: new Vector3() });
  }

  const slot = {
    root,
    primary,
    accent,
    arcs,
    rings,
    core,
    sparks,
    alive: false,
    age: 0,
    duration: 0.38,
    radius: 1,
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const eased = 1 - (1 - progress) ** 3;
      const fade = Math.max(0, (progress - 0.2) / 0.8);
      this.root.rotation.y += deltaSeconds * 2.8;
      this.arcs[0].scaling.setAll(this.radius * (0.76 + eased * 0.44));
      this.arcs[1].scaling.setAll(this.radius * (0.68 + eased * 0.34));
      this.rings[0].scaling.setAll(this.radius * (0.2 + eased * 1.42));
      this.rings[1].scaling.setAll(this.radius * (0.28 + eased * 1.04));
      const coreScale = this.radius * (0.3 + (1 - progress) * 0.68);
      this.core.scaling.setAll(coreScale);
      for (const spark of this.sparks) {
        if (!spark.mesh.isEnabled()) continue;
        spark.velocity.y -= deltaSeconds * 5.8;
        spark.mesh.position.x += spark.velocity.x * deltaSeconds;
        spark.mesh.position.y += spark.velocity.y * deltaSeconds;
        spark.mesh.position.z += spark.velocity.z * deltaSeconds;
        spark.mesh.rotation.x += deltaSeconds * 9;
        spark.mesh.rotation.z += deltaSeconds * 7;
      }
      setPooledEffectAlpha(this.primary, fade);
      setPooledEffectAlpha(this.accent, Math.min(1, fade * 1.15));
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const sparkCount = getEffectParticleCount("impact");
      this.sparks.forEach((spark, sparkIndex) => spark.mesh.setEnabled(sparkIndex < sparkCount && this.alive));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.impacts.push(slot);
}

function createErasurePoolSlot(index) {
  const root = new TransformNode(`erasure-pool-${index}`, scene);
  const primary = createEffectMaterial(`erasure-pool-primary-${index}`, "#e11d48", 0.86, 1);
  const accent = createEffectMaterial(`erasure-pool-accent-${index}`, "#fff1df", 0.74, 1);
  const rings = [0, 1].map((ringIndex) => {
    const ring = CreateTorus(
      `erasure-clock-ring-${index}-${ringIndex}`,
      { diameter: ringIndex === 0 ? 2.55 : 1.72, thickness: ringIndex === 0 ? 0.065 : 0.042, tessellation: 32 },
      scene
    );
    ring.position.y = 0.05 + ringIndex * 0.045;
    ring.material = ringIndex === 0 ? primary : accent;
    ring.parent = root;
    ring.isPickable = false;
    return ring;
  });
  const hand = CreateBox(`erasure-clock-hand-${index}`, { width: 0.06, height: 0.035, depth: 0.82 }, scene);
  hand.position.set(0, 0.09, 0.35);
  hand.material = accent;
  hand.parent = root;
  hand.isPickable = false;

  const sparks = [];
  for (let sparkIndex = 0; sparkIndex < 6; sparkIndex += 1) {
    const spark = CreateBox(`erasure-fragment-${index}-${sparkIndex}`, { width: 0.075, height: 0.055, depth: 0.28 }, scene);
    spark.material = sparkIndex % 2 === 0 ? primary : accent;
    spark.parent = root;
    spark.isPickable = false;
    sparks.push({ mesh: spark, velocity: new Vector3() });
  }

  const slot = {
    root,
    primary,
    accent,
    rings,
    hand,
    sparks,
    alive: false,
    age: 0,
    duration: 0.52,
    scale: 1,
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const dissolve = progress ** 1.16;
      this.rings[0].scaling.setAll(this.scale * (1 - dissolve * 0.88));
      this.rings[1].scaling.setAll(this.scale * (0.72 - dissolve * 0.64));
      this.rings[0].rotation.y -= deltaSeconds * 4.4;
      this.rings[1].rotation.y += deltaSeconds * 6.2;
      this.hand.rotation.y -= deltaSeconds * 8.6;
      for (const spark of this.sparks) {
        if (!spark.mesh.isEnabled()) continue;
        spark.velocity.y -= deltaSeconds * 1.25;
        spark.mesh.position.x += spark.velocity.x * deltaSeconds;
        spark.mesh.position.y += spark.velocity.y * deltaSeconds;
        spark.mesh.position.z += spark.velocity.z * deltaSeconds;
        spark.mesh.rotation.y += deltaSeconds * 8;
      }
      setPooledEffectAlpha(this.primary, dissolve, 1.35);
      setPooledEffectAlpha(this.accent, Math.min(1, dissolve * 1.16), 1.45);
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const sparkCount = getEffectParticleCount("erasure");
      this.sparks.forEach((spark, sparkIndex) => spark.mesh.setEnabled(sparkIndex < sparkCount && this.alive));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.erasures.push(slot);
}

function getEnemyAttackElement(type, angleOffset = 0) {
  // ボス斉射は中央の闇を軸に、左右の炎で危険方向を一目で読ませる。
  if (type === "boss") return Math.abs(angleOffset) < 0.001 ? "void" : "fire";
  return enemyAttackElements[type] ?? "fire";
}

function createEnemyProjectileMaterials() {
  for (const [element, palette] of Object.entries(elementalPalette)) {
    enemyProjectileMaterials.set(element, {
      core: createEffectMaterial(`element-${element}-shot-core`, palette.accent, 0.98, 1.44),
      shell: createEffectMaterial(`element-${element}-shot-shell`, palette.primary, element === "void" ? 0.44 : 0.34, 1.04),
      trail: createEffectMaterial(`element-${element}-shot-trail`, palette.deep, 0.58, 0.94),
      ring: createEffectMaterial(`element-${element}-shot-ring`, palette.accent, 0.84, 1.16),
      shadow: createEffectMaterial(`element-${element}-shot-shadow`, palette.deep, element === "void" ? 0.48 : 0.26, 0.2)
    });
  }
}

function createEnemyProjectilePoolSlot(index) {
  const root = new TransformNode(`enemy-projectile-pool-${index}`, scene);
  const core = CreateSphere(`enemy-projectile-core-${index}`, { diameter: 0.34, segments: 8 }, scene);
  const shell = CreateSphere(`enemy-projectile-shell-${index}`, { diameter: 0.66, segments: 8 }, scene);
  const ring = CreateTorus(
    `enemy-projectile-ring-${index}`,
    { diameter: 0.7, thickness: 0.044, tessellation: 12 },
    scene
  );
  const trail = CreateBox(`enemy-projectile-trail-${index}`, { width: 0.16, height: 0.12, depth: 2.1 }, scene);
  core.parent = root;
  shell.parent = root;
  ring.parent = root;
  trail.parent = root;
  ring.rotation.x = Math.PI / 2;
  trail.position.z = -1.02;
  // 属性形状は全て起動時に確保する。発射中は有効化とTransform更新だけで、GCを発生させない。
  const fireTongues = [];
  for (let tongueIndex = 0; tongueIndex < 5; tongueIndex += 1) {
    const tongue = CreateBox(
      `enemy-fire-tongue-${index}-${tongueIndex}`,
      { width: 0.12, height: 0.52 - tongueIndex * 0.045, depth: 0.13 },
      scene
    );
    tongue.parent = root;
    fireTongues.push(tongue);
  }
  const lightningSegments = [];
  for (let segmentIndex = 0; segmentIndex < 5; segmentIndex += 1) {
    const segment = CreateBox(
      `enemy-lightning-segment-${index}-${segmentIndex}`,
      { width: 0.058, height: 0.058, depth: 0.56 },
      scene
    );
    segment.parent = root;
    lightningSegments.push(segment);
  }
  const lightningBranches = [];
  for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
    const branch = CreateBox(
      `enemy-lightning-branch-${index}-${branchIndex}`,
      { width: 0.042, height: 0.042, depth: 0.38 },
      scene
    );
    branch.parent = root;
    lightningBranches.push(branch);
  }
  const voidShards = [];
  for (let shardIndex = 0; shardIndex < 5; shardIndex += 1) {
    const shard = CreatePlane(`enemy-void-shard-${index}-${shardIndex}`, { size: 0.46 }, scene);
    shard.parent = root;
    voidShards.push(shard);
  }
  const voidShadow = CreateDisc(`enemy-void-shadow-${index}`, { radius: 0.68, tessellation: 16 }, scene);
  voidShadow.rotation.x = Math.PI / 2;
  voidShadow.position.y = -0.86;
  voidShadow.parent = root;
  // 弾本体も属性テクスチャで読ませる。既存の球・箱・トーラスは補助にも使わない。
  const fireSprite = CreatePlane(`enemy-fire-sprite-${index}`, { size: 1.28 }, scene);
  fireSprite.parent = root;
  fireSprite.position.y = 0.42;
  fireSprite.material = texturedEffects.materials.flame.fire;
  fireSprite.billboardMode = 7;
  const fireSpriteState = texturedEffects.createSpriteSheetState(fireSprite);
  const lightningSprites = [0, 1].map((spriteIndex) => {
    const sprite = CreatePlane(`enemy-lightning-sprite-${index}-${spriteIndex}`, { size: 1.12 + spriteIndex * 0.16 }, scene);
    sprite.parent = root;
    sprite.position.y = 0.62 + spriteIndex * 0.12;
    sprite.material = texturedEffects.materials.lightning;
    sprite.billboardMode = 7;
    return sprite;
  });
  const voidSprite = CreatePlane(`enemy-void-swirl-${index}`, { size: 1.36 }, scene);
  voidSprite.parent = root;
  voidSprite.position.y = 0.08;
  voidSprite.rotation.x = Math.PI / 2;
  voidSprite.material = texturedEffects.materials.swirl;
  for (const mesh of [
    core, shell, ring, trail, ...fireTongues, ...lightningSegments, ...lightningBranches, ...voidShards, voidShadow,
    fireSprite, ...lightningSprites, voidSprite
  ]) {
    mesh.isPickable = false;
  }

  const slot = {
    root,
    core,
    shell,
    ring,
    trail,
    fireTongues,
    lightningSegments,
    lightningBranches,
    voidShards,
    voidShadow,
    fireSprite,
    fireSpriteState,
    lightningSprites,
    voidSprite,
    element: "fire",
    projectile: null,
    alive: false,
    activate(projectile) {
      const materialSet = enemyProjectileMaterials.get(projectile.element) ?? enemyProjectileMaterials.get("fire");
      this.element = projectile.element;
      this.core.material = materialSet.core;
      this.shell.material = materialSet.shell;
      this.ring.material = materialSet.ring;
      this.trail.material = materialSet.trail;
      this.fireTongues.forEach((tongue, tongueIndex) => (tongue.material = tongueIndex % 2 ? materialSet.core : materialSet.shell));
      this.lightningSegments.forEach((segment) => (segment.material = materialSet.core));
      this.lightningBranches.forEach((branch) => (branch.material = materialSet.ring));
      this.voidShards.forEach((shard, shardIndex) => (shard.material = shardIndex % 2 ? materialSet.shell : materialSet.trail));
      this.voidShadow.material = materialSet.shadow;
      this.projectile = projectile;
      this.alive = true;
      this.root.position.copyFrom(projectile.position);
      this.root.rotation.y = Math.atan2(projectile.velocity.x, projectile.velocity.z);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      if (!this.projectile?.alive) {
        deactivatePooledEffect(this);
        return;
      }
      const progress = 1 - this.projectile.life / this.projectile.maxLife;
      const pulse = prefersReducedMotion ? 1 : 0.92 + Math.sin((progress + index * 0.13) * Math.PI * 8) * 0.08;
      const size = this.projectile.isBoss ? 1.18 : 1;
      this.root.position.copyFrom(this.projectile.position);
      this.root.rotation.y = Math.atan2(this.projectile.velocity.x, this.projectile.velocity.z);
      const motionScale = prefersReducedMotion ? 0.12 : 1;
      if (this.element === "fire") {
        // 当たり判定は直進のまま、見た目だけを炎らしく横揺れ・上昇させる。
        this.root.position.x += Math.sin((progress * 14 + index) * Math.PI) * 0.12 * motionScale;
        this.root.position.y += 0.1 + Math.sin(progress * Math.PI) * 0.16 * motionScale;
        this.core.scaling.set(size * 0.82 * pulse, size * 1.6 * pulse, size * 0.82 * pulse);
        this.shell.scaling.set(size * 1.15, size * 1.72, size * 1.15);
        this.fireTongues.forEach((tongue, tongueIndex) => {
          const wave = Math.sin(progress * 18 + tongueIndex * 1.8 + index) * 0.16 * motionScale;
          tongue.position.set((tongueIndex - 2) * 0.11 + wave, 0.16 + tongueIndex * 0.055, -0.36 - tongueIndex * 0.26);
          tongue.rotation.z = wave * 1.8;
          tongue.scaling.y = 0.7 + (1 - progress) * 0.8;
        });
        this.trail.scaling.z = size * (effectQuality.enemyProjectileDetail ? 1.24 : 0.7);
        this.trail.position.z = -1.14 * this.trail.scaling.z;
        texturedEffects.setSpriteSheetFrame(this.fireSpriteState, Math.floor((progress * 28 + index * 5) % 64));
        this.fireSprite.scaling.set(size * (0.88 + pulse * 0.18), size * (1.2 + pulse * 0.46), 1);
      } else if (this.element === "lightning") {
        // 折線を複数の板で表現し、枝と点滅を個別に制御する。
        this.core.scaling.setAll(size * (0.72 + pulse * 0.25));
        this.shell.scaling.setAll(size * 0.68);
        this.lightningSegments.forEach((segment, segmentIndex) => {
          const bend = (segmentIndex % 2 === 0 ? 1 : -1) * (0.16 + Math.sin(progress * 18 + segmentIndex) * 0.045);
          segment.position.set(bend, (segmentIndex % 2) * 0.06, -0.72 + segmentIndex * 0.38);
          segment.rotation.y = bend * 1.7;
          segment.scaling.z = 0.82 + Math.sin(progress * 23 + segmentIndex) * 0.12;
        });
        this.lightningBranches.forEach((branch, branchIndex) => {
          const source = branchIndex === 0 ? 1 : branchIndex === 1 ? 3 : 4;
          branch.position.copyFrom(this.lightningSegments[source].position);
          branch.position.x += branchIndex % 2 ? -0.28 : 0.28;
          branch.rotation.y = branchIndex % 2 ? -0.82 : 0.82;
        });
        const flashOn = prefersReducedMotion || Math.sin(progress * 42 + index * 2.7) > -0.28;
        this.lightningSprites.forEach((sprite, spriteIndex) => {
          sprite.rotation.z = Math.sin(progress * 24 + spriteIndex * 1.6 + index) * 0.18;
          sprite.scaling.set(size * (0.8 + spriteIndex * 0.2), size * (1.35 - spriteIndex * 0.12), 1);
          sprite.setEnabled(this.alive && flashOn);
        });
      } else {
        // 闇は破片が渦巻きながら中心へ縮み、地面影が進行方向へ長く伸びる。
        const orbit = 0.42 * (1 - progress * 0.45);
        this.core.scaling.setAll(size * (0.88 + Math.sin(progress * Math.PI * 5) * 0.08));
        this.shell.scaling.setAll(size * (1.18 - progress * 0.22));
        this.voidShards.forEach((shard, shardIndex) => {
          const angle = progress * 13 * motionScale + shardIndex * ((Math.PI * 2) / this.voidShards.length);
          const radius = orbit * (1 - progress * 0.7);
          shard.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.12, Math.sin(angle) * radius);
          shard.rotation.set(0.35 + shardIndex * 0.22, -angle * 1.6, angle * 0.55);
          shard.scaling.setAll(0.72 + (1 - progress) * 0.42);
        });
        this.voidShadow.scaling.set(0.76 + progress * 0.36, 1, 1.55 + progress * 0.85);
        this.trail.scaling.z = 0.6;
        this.voidSprite.scaling.setAll(size * (1.08 - progress * 0.36));
        this.voidSprite.rotation.y += deltaSeconds * (prefersReducedMotion ? 0.35 : 3.8);
      }
      this.ring.rotation.z += deltaSeconds * (this.projectile.isBoss ? 8.2 : 10.6) * motionScale;
      this.ring.rotation.y += deltaSeconds * 4.4 * motionScale;
    },
    applyQuality() {
      this.core.setEnabled(false);
      this.shell.setEnabled(false);
      this.ring.setEnabled(false);
      this.trail.setEnabled(false);
      this.fireTongues.forEach((tongue) => tongue.setEnabled(false));
      this.lightningSegments.forEach((segment) => segment.setEnabled(false));
      this.lightningBranches.forEach((branch) => branch.setEnabled(false));
      this.voidShards.forEach((shard) => shard.setEnabled(false));
      this.voidShadow.setEnabled(false);
      this.fireSprite.setEnabled(this.alive && this.element === "fire");
      this.lightningSprites.forEach((sprite) => sprite.setEnabled(this.alive && this.element === "lightning"));
      this.voidSprite.setEnabled(this.alive && this.element === "void");
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.enemyProjectiles.push(slot);
}

function createElementalImpactPoolSlot(index) {
  const root = new TransformNode(`elemental-impact-pool-${index}`, scene);
  const core = CreateSphere(`elemental-impact-core-${index}`, { diameter: 0.44, segments: 8 }, scene);
  core.parent = root;
  const scorch = CreateTorus(`elemental-impact-scorch-${index}`, { diameter: 1.1, thickness: 0.075, tessellation: 16 }, scene);
  scorch.position.y = 0.035;
  scorch.parent = root;
  const firePillars = [];
  for (let pillarIndex = 0; pillarIndex < 5; pillarIndex += 1) {
    const pillar = CreateCylinder(
      `elemental-fire-pillar-${index}-${pillarIndex}`,
      { height: 1.55 - pillarIndex * 0.12, diameterTop: 0.08, diameterBottom: 0.36, tessellation: 7 },
      scene
    );
    pillar.parent = root;
    firePillars.push(pillar);
  }
  const lightningRays = [];
  for (let rayIndex = 0; rayIndex < 8; rayIndex += 1) {
    const ray = CreateBox(`elemental-lightning-ray-${index}-${rayIndex}`, { width: 0.05, height: 0.045, depth: 0.72 }, scene);
    ray.parent = root;
    lightningRays.push(ray);
  }
  const voidRings = [0, 1, 2].map((ringIndex) => {
    const ring = CreateTorus(
      `elemental-void-ring-${index}-${ringIndex}`,
      { diameter: 0.72 + ringIndex * 0.34, thickness: 0.055 - ringIndex * 0.009, tessellation: 16 },
      scene
    );
    ring.position.y = 0.03 + ringIndex * 0.025;
    ring.parent = root;
    return ring;
  });
  const voidSheets = [];
  for (let sheetIndex = 0; sheetIndex < 5; sheetIndex += 1) {
    const sheet = CreatePlane(`elemental-void-sheet-${index}-${sheetIndex}`, { size: 0.64 }, scene);
    sheet.parent = root;
    voidSheets.push(sheet);
  }
  const voidDarkness = CreateDisc(`elemental-void-darkness-${index}`, { radius: 0.76, tessellation: 16 }, scene);
  voidDarkness.rotation.x = Math.PI / 2;
  voidDarkness.position.y = 0.02;
  voidDarkness.parent = root;
  for (const mesh of [core, scorch, ...firePillars, ...lightningRays, ...voidRings, ...voidSheets, voidDarkness]) {
    mesh.isPickable = false;
  }

  const slot = {
    root,
    core,
    scorch,
    firePillars,
    lightningRays,
    voidRings,
    voidSheets,
    voidDarkness,
    element: "fire",
    age: 0,
    duration: 0.48,
    alive: false,
    activate(position, element, direction = lastMoveDirection) {
      const materials = enemyProjectileMaterials.get(element) ?? enemyProjectileMaterials.get("fire");
      this.element = element;
      this.age = 0;
      this.duration = getEffectDuration(element === "void" ? 0.64 : 0.46);
      this.alive = true;
      this.root.position.set(position.x, 0.025, position.z);
      this.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      this.core.material = materials.core;
      this.scorch.material = element === "void" ? materials.shadow : materials.trail;
      this.firePillars.forEach((pillar, pillarIndex) => (pillar.material = pillarIndex % 2 ? materials.core : materials.shell));
      this.lightningRays.forEach((ray, rayIndex) => (ray.material = rayIndex % 3 ? materials.core : materials.ring));
      this.voidRings.forEach((ring, ringIndex) => (ring.material = ringIndex === 1 ? materials.shell : materials.trail));
      this.voidSheets.forEach((sheet, sheetIndex) => (sheet.material = sheetIndex % 2 ? materials.shell : materials.trail));
      this.voidDarkness.material = materials.shadow;
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const eased = 1 - (1 - progress) ** 3;
      if (this.element === "fire") {
        this.scorch.scaling.setAll(0.36 + eased * 1.4);
        this.core.position.y = 0.34 + (1 - progress) * 0.5;
        this.core.scaling.set(0.9 - progress * 0.32, 1.45 - progress * 0.68, 0.9 - progress * 0.32);
        this.firePillars.forEach((pillar, pillarIndex) => {
          const angle = pillarIndex * ((Math.PI * 2) / this.firePillars.length) + progress * 1.6;
          const radius = 0.1 + pillarIndex * 0.055;
          pillar.position.set(Math.sin(angle) * radius, 0.58 + progress * 0.34, Math.cos(angle) * radius);
          pillar.scaling.set(0.8 + Math.sin(progress * 15 + pillarIndex) * 0.16, 0.28 + eased * 1.38, 0.8 + Math.sin(progress * 15 + pillarIndex) * 0.16);
        });
      } else if (this.element === "lightning") {
        this.core.scaling.setAll(0.8 + Math.sin(progress * 31) * 0.18);
        this.lightningRays.forEach((ray, rayIndex) => {
          const angle = rayIndex * ((Math.PI * 2) / this.lightningRays.length) + (rayIndex % 2 ? 0.22 : -0.13);
          ray.position.set(Math.sin(angle) * (0.22 + eased * 0.72), 0.07, Math.cos(angle) * (0.22 + eased * 0.72));
          ray.rotation.y = angle + Math.sin(progress * 24 + rayIndex) * 0.24;
          ray.scaling.z = 0.25 + (1 - progress) * 1.46;
        });
        const flashOn = prefersReducedMotion || Math.sin(progress * 46 + index) > -0.25;
        this.lightningRays.forEach((ray, rayIndex) => ray.setEnabled(this.alive && flashOn && rayIndex < effectQuality.lightningSegments + effectQuality.lightningBranches));
      } else {
        this.voidDarkness.scaling.setAll(0.35 + eased * 1.8);
        this.core.scaling.setAll(1.18 - eased * 0.98);
        this.voidRings.forEach((ring, ringIndex) => {
          const scale = 0.25 + (1 - progress) * (1.1 - ringIndex * 0.12);
          ring.scaling.setAll(scale);
          ring.rotation.y += deltaSeconds * (ringIndex % 2 ? -7.4 : 6.2) * (prefersReducedMotion ? 0.12 : 1);
        });
        this.voidSheets.forEach((sheet, sheetIndex) => {
          const angle = progress * 9 + sheetIndex * ((Math.PI * 2) / this.voidSheets.length);
          const radius = (1 - progress) * (0.7 + sheetIndex * 0.06);
          sheet.position.set(Math.cos(angle) * radius, 0.08 + sheetIndex * 0.025, Math.sin(angle) * radius);
          sheet.rotation.set(Math.PI / 2, 0, angle);
          sheet.scaling.setAll(0.42 + (1 - progress) * 0.86);
        });
      }
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      this.core.setEnabled(this.alive);
      this.scorch.setEnabled(this.alive && this.element === "fire");
      this.firePillars.forEach((pillar, pillarIndex) => pillar.setEnabled(this.alive && this.element === "fire" && pillarIndex < effectQuality.fireTongues));
      this.lightningRays.forEach((ray, rayIndex) => ray.setEnabled(this.alive && this.element === "lightning" && rayIndex < effectQuality.lightningSegments + effectQuality.lightningBranches));
      this.voidRings.forEach((ring) => ring.setEnabled(this.alive && this.element === "void"));
      this.voidSheets.forEach((sheet, sheetIndex) => sheet.setEnabled(this.alive && this.element === "void" && sheetIndex < effectQuality.voidShards));
      this.voidDarkness.setEnabled(this.alive && this.element === "void");
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.elementalImpacts.push(slot);
}

function createChronoSlashPoolSlot(index) {
  const root = new TransformNode(`chrono-slash-pool-${index}`, scene);
  const materials = enemyProjectileMaterials.get("chrono");
  const arcs = [0, 1, 2].map((arcIndex) => {
    const path = [];
    const radius = 0.78 + arcIndex * 0.23;
    for (let step = 0; step <= 12; step += 1) {
      const angle = -1.05 + (step / 12) * 2.1;
      path.push(new Vector3(Math.sin(angle) * radius, arcIndex * 0.055, Math.cos(angle) * radius + 0.32));
    }
    const arc = CreateTube(`chrono-slash-arc-${index}-${arcIndex}`, { path, radius: 0.03 + arcIndex * 0.008, tessellation: 7, cap: 3 }, scene);
    arc.parent = root;
    arc.material = arcIndex === 1 ? materials.core : materials.shell;
    arc.isPickable = false;
    return arc;
  });
  const rings = [0, 1].map((ringIndex) => {
    const ring = CreateTorus(`chrono-slash-ring-${index}-${ringIndex}`, { diameter: 0.72 + ringIndex * 0.3, thickness: 0.04, tessellation: 14 }, scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.7;
    ring.parent = root;
    ring.material = ringIndex ? materials.shell : materials.core;
    ring.isPickable = false;
    return ring;
  });
  const echoes = [];
  for (let echoIndex = 0; echoIndex < 5; echoIndex += 1) {
    const echo = CreateBox(`chrono-slash-echo-${index}-${echoIndex}`, { width: 0.04, height: 0.04, depth: 0.26 + echoIndex * 0.035 }, scene);
    echo.parent = root;
    echo.material = echoIndex % 2 ? materials.shell : materials.core;
    echo.isPickable = false;
    echoes.push(echo);
  }
  const slot = {
    root, arcs, rings, echoes, age: 0, duration: 0.24, alive: false,
    activate(position, direction) {
      this.age = 0;
      this.duration = getEffectDuration(0.24);
      this.alive = true;
      this.root.position.copyFrom(position);
      this.root.position.addInPlace(direction.scale(0.34));
      this.root.position.y = 0.44;
      this.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const sweep = 0.58 + progress * 0.68;
      this.arcs.forEach((arc, arcIndex) => arc.scaling.setAll(sweep * (1 + arcIndex * 0.04)));
      this.rings.forEach((ring, ringIndex) => {
        ring.scaling.setAll(0.32 + progress * (1.24 - ringIndex * 0.12));
        ring.rotation.z += deltaSeconds * (ringIndex ? -10 : 13) * (prefersReducedMotion ? 0.12 : 1);
      });
      this.echoes.forEach((echo, echoIndex) => {
        echo.position.set((echoIndex - 2) * 0.18, 0.04 + echoIndex * 0.025, 0.88 + echoIndex * 0.12 + progress * 0.55);
        echo.rotation.y = (echoIndex - 2) * 0.18;
      });
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      this.arcs.forEach((arc, arcIndex) => arc.setEnabled(this.alive && (effectQuality.enemyProjectileDetail || arcIndex < 2)));
      this.rings.forEach((ring) => ring.setEnabled(this.alive));
      this.echoes.forEach((echo, echoIndex) => echo.setEnabled(this.alive && echoIndex < effectQuality.chronoRiftEchoes + 1));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.chronoSlashes.push(slot);
}

function createChronoRiftPoolSlot(index) {
  const root = new TransformNode(`chrono-rift-pool-${index}`, scene);
  const materials = enemyProjectileMaterials.get("chrono");
  const seams = [];
  for (let seamIndex = 0; seamIndex < 3; seamIndex += 1) {
    const seam = CreateBox(`chrono-rift-seam-${index}-${seamIndex}`, { width: 0.07, height: 0.94, depth: 0.11 }, scene);
    seam.parent = root;
    seam.material = seamIndex === 1 ? materials.core : materials.shell;
    seam.isPickable = false;
    seams.push(seam);
  }
  const echoes = [];
  for (let echoIndex = 0; echoIndex < 4; echoIndex += 1) {
    const echo = CreateBox(`chrono-rift-echo-${index}-${echoIndex}`, { width: 0.045, height: 0.52, depth: 0.075 }, scene);
    echo.parent = root;
    echo.material = echoIndex % 2 ? materials.shell : materials.core;
    echo.isPickable = false;
    echoes.push(echo);
  }
  const slot = {
    root, seams, echoes, age: 0, duration: 0.46, alive: false,
    activate(position) {
      this.age = 0;
      this.duration = getEffectDuration(0.46);
      this.alive = true;
      this.root.position.set(position.x, 0.5, position.z);
      this.root.rotation.set(0, (index * 0.71) % Math.PI, 0);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const open = Math.sin(progress * Math.PI) * 0.52;
      this.seams.forEach((seam, seamIndex) => {
        seam.position.x = (seamIndex - 1) * open;
        seam.position.y = Math.sin(progress * Math.PI + seamIndex) * 0.08;
        seam.scaling.y = 0.58 + open * 0.9;
      });
      this.echoes.forEach((echo, echoIndex) => {
        echo.position.set((echoIndex - 1.5) * (0.28 + open), 0.02 + echoIndex * 0.08, -0.2 - progress * (0.32 + echoIndex * 0.08));
        echo.scaling.y = 0.45 + (1 - progress) * 0.55;
      });
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      this.seams.forEach((seam) => seam.setEnabled(this.alive));
      this.echoes.forEach((echo, echoIndex) => echo.setEnabled(this.alive && echoIndex < effectQuality.chronoRiftEchoes));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.chronoRifts.push(slot);
}

function createChronoStopFieldPoolSlot(index) {
  const root = new TransformNode(`chrono-stop-field-pool-${index}`, scene);
  const materials = enemyProjectileMaterials.get("chrono");
  const floor = CreateCylinder(`chrono-stop-floor-${index}`, { diameter: 9.5, height: 0.035, tessellation: 32 }, scene);
  floor.parent = root;
  floor.material = materials.shadow;
  floor.isPickable = false;
  const outerDial = attachClockDial(root, { name: `chrono-stop-outer-${index}`, radius: 4.65, material: materials.shell, accentMaterial: materials.core, tickCount: 16, handAngle: -1.2 });
  const innerDial = attachClockDial(root, { name: `chrono-stop-inner-${index}`, radius: 2.55, material: materials.core, accentMaterial: materials.shell, tickCount: 12, handAngle: 1.7, gearTeeth: false });
  const crystals = [];
  for (let crystalIndex = 0; crystalIndex < 8; crystalIndex += 1) {
    const crystal = CreateBox(`chrono-stop-crystal-${index}-${crystalIndex}`, { width: 0.24, height: 0.055, depth: 0.66 }, scene);
    crystal.parent = root;
    crystal.material = crystalIndex % 2 ? materials.shell : materials.core;
    crystal.isPickable = false;
    crystals.push(crystal);
  }
  const slot = {
    root, floor, outerDial, innerDial, crystals, age: 0, duration: 2.5, alive: false,
    activate(position) {
      this.age = 0;
      this.duration = getEffectDuration(2.5);
      this.alive = true;
      this.root.position.set(position.x, 0.08, position.z);
      this.root.scaling.setAll(0.72);
      this.crystals.forEach((crystal, crystalIndex) => {
        const angle = crystalIndex * ((Math.PI * 2) / this.crystals.length);
        crystal.position.set(Math.sin(angle) * 4.12, 0.055, Math.cos(angle) * 4.12);
        crystal.rotation.y = angle + Math.PI / 2;
      });
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const settle = 0.72 + Math.min(1, progress * 4) * 0.28;
      this.root.scaling.setAll(settle);
      // 時計の針は止め、結晶板だけを薄く明滅して凍結を示す。
      this.crystals.forEach((crystal, crystalIndex) => {
        crystal.position.y = 0.055 + (prefersReducedMotion ? 0 : Math.sin(progress * 7 + crystalIndex) * 0.025);
      });
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      this.floor.setEnabled(this.alive);
      this.outerDial.setEnabled(this.alive);
      this.innerDial.setEnabled(this.alive && effectQuality.enemyProjectileDetail);
      this.crystals.forEach((crystal, crystalIndex) => crystal.setEnabled(this.alive && crystalIndex < effectQuality.fireTongues + 2));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.chronoStopFields.push(slot);
}

function createChronoTrailPoolSlot(index) {
  const root = new TransformNode(`chrono-trail-pool-${index}`, scene);
  const materials = enemyProjectileMaterials.get("chrono");
  const rails = [0, 1, 2].map((railIndex) => {
    const rail = CreateBox(`chrono-trail-rail-${index}-${railIndex}`, { width: 0.05, height: 0.05, depth: 1 }, scene);
    rail.parent = root;
    rail.material = railIndex === 1 ? materials.core : materials.shell;
    rail.isPickable = false;
    return rail;
  });
  const echoes = [];
  for (let echoIndex = 0; echoIndex < 7; echoIndex += 1) {
    const echo = CreateBox(`chrono-trail-echo-${index}-${echoIndex}`, { width: 0.18, height: 0.03, depth: 0.18 }, scene);
    echo.parent = root;
    echo.material = echoIndex % 2 ? materials.shell : materials.core;
    echo.isPickable = false;
    echoes.push(echo);
  }
  const slot = {
    root, rails, echoes, from: new Vector3(), to: new Vector3(), distance: 1, rewindTrail: false, age: 0, duration: 0.36, alive: false,
    activate(from, to, { rewindTrail = false } = {}) {
      const delta = to.subtract(from);
      delta.y = 0;
      this.distance = Math.max(0.1, delta.length());
      delta.scaleInPlace(1 / this.distance);
      this.from.copyFrom(from);
      this.to.copyFrom(to);
      this.rewindTrail = rewindTrail;
      this.age = 0;
      this.duration = getEffectDuration(rewindTrail ? 0.72 : 0.36);
      this.alive = true;
      this.root.position.copyFrom(from);
      this.root.position.y = 0.18;
      this.root.rotation.set(0, Math.atan2(delta.x, delta.z), 0);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      this.rails.forEach((rail, railIndex) => {
        rail.position.set((railIndex - 1) * (this.rewindTrail ? 0.22 : 0.15), Math.sin(progress * Math.PI) * (this.rewindTrail ? 0.46 : 0.18), this.distance * 0.5);
        rail.scaling.z = this.distance;
      });
      this.echoes.forEach((echo, echoIndex) => {
        const t = (echoIndex + 1) / (this.echoes.length + 1);
        const trailT = this.rewindTrail ? Math.max(0, t - progress * 0.55) : Math.min(1, t + progress * 0.28);
        echo.position.set((echoIndex % 2 ? -1 : 1) * 0.1, Math.sin(trailT * Math.PI) * (this.rewindTrail ? 0.58 : 0.2), this.distance * trailT);
        echo.rotation.y = Math.PI / 4 + trailT * Math.PI;
      });
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      this.rails.forEach((rail, railIndex) => rail.setEnabled(this.alive && (effectQuality.enemyProjectileDetail || railIndex === 1)));
      this.echoes.forEach((echo, echoIndex) => echo.setEnabled(this.alive && echoIndex < effectQuality.chronoTrailEchoes));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.chronoTrails.push(slot);
}

function createPlayerProjectilePoolSlot(index) {
  const root = new TransformNode(`player-projectile-pool-${index}`, scene);
  const materials = enemyProjectileMaterials.get("chrono");
  const blade = CreateBox(`player-projectile-blade-${index}`, { width: 0.12, height: 0.1, depth: 0.62 }, scene);
  blade.parent = root;
  blade.material = materials.core;
  const ring = CreateTorus(`player-projectile-ring-${index}`, { diameter: 0.42, thickness: 0.03, tessellation: 10 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.parent = root;
  ring.material = materials.shell;
  // 単色の刃箱を主役にせず、時空の裂け目テクスチャをカメラ正対で飛ばす。
  const rift = CreatePlane(`player-projectile-rift-${index}`, { size: 0.78 }, scene);
  rift.parent = root;
  rift.position.y = 0.12;
  rift.material = texturedEffects.materials.rift;
  rift.billboardMode = 7;
  for (const mesh of [blade, ring, rift]) mesh.isPickable = false;
  const slot = {
    root, blade, ring, rift, projectile: null, alive: false,
    activate(projectile) {
      this.projectile = projectile;
      this.alive = true;
      this.root.position.copyFrom(projectile.position);
      this.root.rotation.y = Math.atan2(projectile.velocity.x, projectile.velocity.z);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      if (!this.projectile?.alive) {
        deactivatePooledEffect(this);
        return;
      }
      this.root.position.copyFrom(this.projectile.position);
      this.root.rotation.y = Math.atan2(this.projectile.velocity.x, this.projectile.velocity.z);
      this.ring.rotation.z += deltaSeconds * 12 * (prefersReducedMotion ? 0.12 : 1);
      this.rift.rotation.z += deltaSeconds * 8 * (prefersReducedMotion ? 0.12 : 1);
      const pulse = 0.78 + Math.sin((performance.now() + index * 71) * 0.016) * 0.13;
      this.rift.scaling.set(pulse * 0.74, pulse * 1.42, 1);
    },
    applyQuality() {
      this.blade.setEnabled(false);
      this.ring.setEnabled(false);
      this.rift.setEnabled(this.alive);
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.playerProjectiles.push(slot);
}

function createEnemyTelegraphPoolSlot(index) {
  const root = new TransformNode(`enemy-telegraph-pool-${index}`, scene);
  const primary = createEffectMaterial(`enemy-telegraph-primary-${index}`, "#d946ef", 0.9, 1.05);
  const accent = createEffectMaterial(`enemy-telegraph-accent-${index}`, "#fff1f5", 0.82, 1.15);
  const core = CreateSphere(`enemy-telegraph-core-${index}`, { diameter: 0.3, segments: 8 }, scene);
  const shell = CreateSphere(`enemy-telegraph-shell-${index}`, { diameter: 0.58, segments: 8 }, scene);
  core.position.y = 1.22;
  shell.position.y = 1.22;
  core.parent = root;
  shell.parent = root;
  core.material = accent;
  shell.material = primary;

  const rings = [0, 1].map((ringIndex) => {
    const ring = CreateTorus(
      `enemy-telegraph-ring-${index}-${ringIndex}`,
      { diameter: ringIndex === 0 ? 1.45 : 0.94, thickness: ringIndex === 0 ? 0.052 : 0.032, tessellation: 20 },
      scene
    );
    ring.position.y = 0.06 + ringIndex * 0.035;
    ring.material = ringIndex === 0 ? primary : accent;
    ring.parent = root;
    ring.isPickable = false;
    return ring;
  });
  const rays = [];
  for (let rayIndex = 0; rayIndex < 4; rayIndex += 1) {
    const ray = CreateBox(`enemy-telegraph-ray-${index}-${rayIndex}`, { width: 0.045, height: 0.035, depth: 0.42 }, scene);
    const angle = rayIndex * Math.PI * 0.5 + Math.PI * 0.25;
    ray.position.set(Math.sin(angle) * 0.62, 0.1, Math.cos(angle) * 0.62);
    ray.rotation.y = angle;
    ray.material = rayIndex % 2 === 0 ? accent : primary;
    ray.parent = root;
    ray.isPickable = false;
    rays.push(ray);
  }

  const slot = {
    root,
    primary,
    accent,
    core,
    shell,
    rings,
    rays,
    owner: null,
    age: 0,
    duration: 0.42,
    alive: false,
    activate(enemy, duration) {
      this.owner = enemy;
      this.age = 0;
      this.duration = getEffectDuration(duration);
      this.alive = true;
      this.root.position.copyFrom(enemy.mesh.position);
      this.root.rotation.set(0, 0, 0);
      const palette = elementalPalette[getEnemyAttackElement(enemy.type)] ?? elementalPalette.lightning;
      setPooledEffectMaterial(this.primary, palette.primary, 0.9);
      setPooledEffectMaterial(this.accent, palette.accent, 0.84);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const charge = 0.48 + (1 - (1 - progress) ** 3) * 0.82;
      if (this.owner?.alive) this.root.position.copyFrom(this.owner.mesh.position);
      this.core.scaling.setAll(charge);
      this.shell.scaling.setAll(0.58 + charge * 0.64);
      this.rings[0].scaling.setAll(0.42 + charge * 0.9);
      this.rings[1].scaling.setAll(0.52 + charge * 0.58);
      const motionScale = prefersReducedMotion ? 0.12 : 1;
      this.rings[0].rotation.y -= deltaSeconds * 6.4 * motionScale;
      this.rings[1].rotation.y += deltaSeconds * 8.2 * motionScale;
      this.rays.forEach((ray, rayIndex) => {
        ray.scaling.z = 0.56 + charge * (0.86 + rayIndex * 0.06);
      });
      setPooledEffectAlpha(this.primary, Math.max(0, (progress - 0.72) / 0.28));
      setPooledEffectAlpha(this.accent, Math.max(0, (progress - 0.68) / 0.32));
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const detailed = effectQuality.enemyProjectileDetail && !prefersReducedMotion;
      this.rings[1].setEnabled(detailed && this.alive);
      this.rays.forEach((ray, rayIndex) => ray.setEnabled(this.alive && (detailed || rayIndex % 2 === 0)));
    }
  };
  for (const mesh of [core, shell]) mesh.isPickable = false;
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.enemyTelegraphs.push(slot);
}

function createEnemyMuzzlePoolSlot(index) {
  const root = new TransformNode(`enemy-muzzle-pool-${index}`, scene);
  const primary = createEffectMaterial(`enemy-muzzle-primary-${index}`, "#d946ef", 0.92, 1.2);
  const accent = createEffectMaterial(`enemy-muzzle-accent-${index}`, "#fff1f5", 0.88, 1.3);
  const ring = CreateTorus(`enemy-muzzle-ring-${index}`, { diameter: 0.76, thickness: 0.055, tessellation: 16 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.material = primary;
  ring.parent = root;
  ring.isPickable = false;
  const rays = [];
  for (let rayIndex = 0; rayIndex < 3; rayIndex += 1) {
    const ray = CreateBox(`enemy-muzzle-ray-${index}-${rayIndex}`, { width: 0.055, height: 0.045, depth: 0.74 }, scene);
    ray.position.set((rayIndex - 1) * 0.16, 0, 0.38 + rayIndex * 0.06);
    ray.rotation.y = (rayIndex - 1) * 0.22;
    ray.material = rayIndex === 1 ? accent : primary;
    ray.parent = root;
    ray.isPickable = false;
    rays.push(ray);
  }
  const slot = {
    root,
    primary,
    accent,
    ring,
    rays,
    age: 0,
    duration: 0.32,
    alive: false,
    activate(position, direction, colorHex, size = 1) {
      this.age = 0;
      this.duration = getEffectDuration(0.32);
      this.alive = true;
      this.root.position.copyFrom(position);
      this.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      this.root.scaling.setAll(size);
      setPooledEffectMaterial(this.primary, colorHex, 0.92);
      setPooledEffectMaterial(this.accent, "#fff7f9", 0.9);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const flare = 0.38 + progress * 1.62;
      this.ring.scaling.set(flare, flare, flare);
      this.ring.rotation.z += deltaSeconds * 11 * (prefersReducedMotion ? 0.12 : 1);
      this.rays.forEach((ray, rayIndex) => {
        ray.scaling.z = 0.62 + progress * (1.7 - rayIndex * 0.16);
      });
      setPooledEffectAlpha(this.primary, progress, 1.8);
      setPooledEffectAlpha(this.accent, Math.min(1, progress * 1.16), 1.9);
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const rayLimit = prefersReducedMotion ? 1 : effectQuality.enemyMuzzleRays;
      this.rays.forEach((ray, rayIndex) => ray.setEnabled(this.alive && rayIndex < rayLimit));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.enemyMuzzles.push(slot);
}

function createEnemyMeleePoolSlot(index) {
  const root = new TransformNode(`enemy-melee-pool-${index}`, scene);
  const primary = createEffectMaterial(`enemy-melee-primary-${index}`, "#e11d48", 0.94, 1.08);
  const accent = createEffectMaterial(`enemy-melee-accent-${index}`, "#fff1f4", 0.82, 1.12);
  const arcs = [0, 1].map((arcIndex) => {
    const path = [];
    const radius = 0.84 + arcIndex * 0.16;
    for (let step = 0; step <= 10; step += 1) {
      const angle = -0.96 + (step / 10) * 1.92;
      path.push(new Vector3(Math.sin(angle) * radius, Math.cos(angle) * 0.28 + 0.28, Math.cos(angle) * radius + 0.46));
    }
    const arc = CreateTube(
      `enemy-melee-arc-${index}-${arcIndex}`,
      { path, radius: arcIndex === 0 ? 0.072 : 0.042, tessellation: 7, cap: 3 },
      scene
    );
    arc.parent = root;
    arc.material = arcIndex === 0 ? primary : accent;
    arc.isPickable = false;
    return arc;
  });
  const slot = {
    root,
    primary,
    accent,
    arcs,
    age: 0,
    duration: 0.24,
    alive: false,
    activate(position, direction, colorHex) {
      this.age = 0;
      this.duration = getEffectDuration(0.24);
      this.alive = true;
      this.root.position.copyFrom(position);
      this.root.position.y += 0.62;
      this.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      setPooledEffectMaterial(this.primary, colorHex, 0.94);
      setPooledEffectMaterial(this.accent, "#fff1f4", 0.82);
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      const sweep = 0.56 + progress * 0.78;
      this.root.scaling.setAll(sweep);
      this.root.rotation.y += deltaSeconds * 4.8 * (prefersReducedMotion ? 0.12 : 1);
      setPooledEffectAlpha(this.primary, progress, 1.65);
      setPooledEffectAlpha(this.accent, Math.min(1, progress * 1.2), 1.8);
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const layerLimit = prefersReducedMotion ? 1 : effectQuality.enemyMeleeLayers;
      this.arcs.forEach((arc, arcIndex) => arc.setEnabled(this.alive && arcIndex < layerLimit));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.enemyMelee.push(slot);
}

function createEnemyDissipationPoolSlot(index) {
  const root = new TransformNode(`enemy-dissipation-pool-${index}`, scene);
  const primary = createEffectMaterial(`enemy-dissipation-primary-${index}`, "#d946ef", 0.54, 0.9);
  const accent = createEffectMaterial(`enemy-dissipation-accent-${index}`, "#fff1f5", 0.68, 1.05);
  const ring = CreateTorus(`enemy-dissipation-ring-${index}`, { diameter: 0.68, thickness: 0.035, tessellation: 14 }, scene);
  ring.rotation.x = Math.PI / 2;
  ring.material = primary;
  ring.parent = root;
  ring.isPickable = false;
  const sparks = [];
  for (let sparkIndex = 0; sparkIndex < 3; sparkIndex += 1) {
    const spark = CreateBox(`enemy-dissipation-spark-${index}-${sparkIndex}`, { width: 0.04, height: 0.04, depth: 0.24 }, scene);
    spark.material = sparkIndex === 1 ? accent : primary;
    spark.parent = root;
    spark.isPickable = false;
    sparks.push(spark);
  }
  const slot = {
    root,
    primary,
    accent,
    ring,
    sparks,
    age: 0,
    duration: 0.28,
    alive: false,
    activate(position, direction, colorHex) {
      this.age = 0;
      this.duration = getEffectDuration(0.28);
      this.alive = true;
      this.root.position.copyFrom(position);
      this.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      setPooledEffectMaterial(this.primary, colorHex, 0.54);
      setPooledEffectMaterial(this.accent, "#fff1f5", 0.68);
      this.sparks.forEach((spark, sparkIndex) => {
        spark.position.set((sparkIndex - 1) * 0.1, (sparkIndex % 2) * 0.08, sparkIndex * 0.08);
      });
      this.applyQuality();
      this.root.setEnabled(true);
    },
    update(deltaSeconds) {
      this.age += deltaSeconds;
      const progress = Math.min(1, this.age / this.duration);
      this.ring.scaling.setAll(0.44 + progress * 0.82);
      this.ring.rotation.z += deltaSeconds * 7.6 * (prefersReducedMotion ? 0.12 : 1);
      this.sparks.forEach((spark, sparkIndex) => {
        spark.position.z -= deltaSeconds * (0.65 + sparkIndex * 0.15);
        spark.position.y += deltaSeconds * (0.18 + sparkIndex * 0.08);
      });
      setPooledEffectAlpha(this.primary, progress, 1.7);
      setPooledEffectAlpha(this.accent, Math.min(1, progress * 1.18), 1.8);
      if (progress >= 1) deactivatePooledEffect(this);
    },
    applyQuality() {
      const sparkLimit = prefersReducedMotion ? 1 : effectQuality.enemyDissipationSparks;
      this.sparks.forEach((spark, sparkIndex) => spark.setEnabled(this.alive && sparkIndex < sparkLimit));
    }
  };
  root.setEnabled(false);
  pooledEffects.push(slot);
  effectPools.enemyDissipations.push(slot);
}

function initEffectPools() {
  // 飛翔体だけは位置追従が必要なので固定メッシュプール。着弾・消滅は共有ParticleSystemへ集約する。
  createEnemyProjectileMaterials();
  for (let index = 0; index < 40; index += 1) createEnemyProjectilePoolSlot(index);
  for (let index = 0; index < 20; index += 1) createPlayerProjectilePoolSlot(index);
}

function getEffectParticleCount(kind) {
  const configured = kind === "impact" ? effectQuality.impactSparks : effectQuality.erasureSparks;
  return prefersReducedMotion ? Math.min(2, configured) : configured;
}

function deactivatePooledEffect(slot) {
  if (!slot) return;
  if (slot.projectile?.visual === slot) slot.projectile.visual = null;
  slot.alive = false;
  slot.projectile = null;
  slot.owner = null;
  slot.root.setEnabled(false);
}

function updatePooledEffects(deltaSeconds) {
  for (const slot of pooledEffects) {
    if (slot.alive) slot.update(deltaSeconds);
  }
}

function resetPooledEffects() {
  for (const slot of pooledEffects) deactivatePooledEffect(slot);
}

function findPooledEffect(pool, limit) {
  return pool.slice(0, limit).find((slot) => !slot.alive) ?? null;
}

function spawnEnemyProjectileVisual(projectile) {
  const slot = findPooledEffect(effectPools.enemyProjectiles, effectQuality.enemyProjectileSlots);
  if (!slot) return;
  projectile.visual = slot;
  slot.activate(projectile);
}

function spawnElementalImpact(position, element, direction = lastMoveDirection) {
  // 属性ごとの主役はテクスチャ付きバースト。旧プリミティブのimpact slotは互換用に残すだけで発火しない。
  texturedEffects?.spawnElementalImpact(position, element, direction);
  return;
  const slot = findPooledEffect(effectPools.elementalImpacts, effectQuality.elementalImpactSlots);
  if (slot) slot.activate(position, element, direction);
}

function spawnChronoSlash(position, direction) {
  texturedEffects?.spawnChronoRift(position, 0.76);
  return;
  const slot = findPooledEffect(effectPools.chronoSlashes, effectQuality.enemyMeleeSlots);
  if (slot) slot.activate(position, direction);
}

function spawnChronoRift(position) {
  texturedEffects?.spawnChronoRift(position, 0.92);
  return;
  const slot = findPooledEffect(effectPools.chronoRifts, effectQuality.chronoRiftSlots);
  if (slot) slot.activate(position);
}

function spawnChronoStopField(position) {
  texturedEffects?.spawnChronoField(position);
  return;
  const slot = findPooledEffect(effectPools.chronoStopFields, 1);
  if (slot) slot.activate(position);
}

function spawnChronoTrail(from, to, options) {
  void options;
  texturedEffects?.spawnChronoTrail(from, to);
  return;
  const slot = findPooledEffect(effectPools.chronoTrails, 4);
  if (slot) slot.activate(from, to, options);
}

function spawnPlayerProjectileVisual(projectile) {
  const slot = findPooledEffect(effectPools.playerProjectiles, effectQuality.playerProjectileSlots);
  if (!slot) return;
  projectile.visual = slot;
  slot.activate(projectile);
}

function spawnEnemyMuzzleFlash(position, direction, colorHex, size) {
  void position;
  void direction;
  void colorHex;
  void size;
  return;
  const slot = findPooledEffect(effectPools.enemyMuzzles, effectQuality.enemyMuzzleSlots);
  if (slot) slot.activate(position, direction, colorHex, size);
}

function spawnEnemyTelegraph(enemy, duration) {
  texturedEffects?.spawnTelegraph(enemy.mesh.position, getEnemyAttackElement(enemy.type), duration);
  return;
  const slot = findPooledEffect(effectPools.enemyTelegraphs, effectQuality.enemyTelegraphSlots);
  if (slot) slot.activate(enemy, duration);
}

function spawnEnemyMeleeArc(enemy, direction) {
  void enemy;
  void direction;
  return;
  const slot = findPooledEffect(effectPools.enemyMelee, effectQuality.enemyMeleeSlots);
  const element = getEnemyAttackElement(enemy.type);
  if (slot) slot.activate(enemy.mesh.position, direction, elementalPalette[element]?.primary ?? enemyAttackColors.chaser);
}

function spawnEnemyProjectileDissipation(projectile) {
  spawnElementalImpact(projectile.position, projectile.element ?? "fire", projectile.velocity);
}

function spawnTimeErasureBurst(position, type) {
  texturedEffects?.spawnErasure(position, type);
  return;
  const slot = findPooledEffect(effectPools.erasures, effectQuality.erasureSlots);
  if (!slot) return;
  const isBoss = type === "boss";
  const colorHex = enemyDeathColors[type] ?? enemyDeathColors.chaser;
  slot.alive = true;
  slot.age = 0;
  slot.duration = getEffectDuration(isBoss ? 0.78 : 0.52);
  slot.scale = isBoss ? 1.58 : 0.96;
  slot.root.position.set(position.x, 0.02, position.z);
  slot.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
  slot.root.setEnabled(true);
  setPooledEffectMaterial(slot.primary, colorHex, isBoss ? 0.96 : 0.86);
  setPooledEffectMaterial(slot.accent, "#fff1df", isBoss ? 0.86 : 0.74);
  slot.rings.forEach((ring) => ring.scaling.setAll(slot.scale));
  const sparkCount = getEffectParticleCount("erasure");
  slot.sparks.forEach((spark, sparkIndex) => {
    const enabled = sparkIndex < sparkCount;
    spark.mesh.setEnabled(enabled);
    if (!enabled) return;
    const angle = (sparkIndex / sparkCount) * Math.PI * 2 + Math.random() * 0.42;
    const radial = 0.14 + (sparkIndex % 3) * 0.08;
    spark.mesh.position.set(Math.sin(angle) * radial, 0.34 + sparkIndex * 0.13, Math.cos(angle) * radial);
    spark.mesh.rotation.set(0.2 * sparkIndex, angle, -0.14 * sparkIndex);
    spark.velocity.set(Math.sin(angle) * (0.48 + sparkIndex * 0.08), 1.15 + sparkIndex * 0.2, Math.cos(angle) * (0.48 + sparkIndex * 0.08));
  });
}

function configureEffectQuality(quality) {
  const profile =
    quality === "low"
      ? {
          impactSlots: 5,
          impactSparks: 3,
          erasureSlots: 4,
          erasureSparks: 3,
          enemyProjectileSlots: 16,
          enemyTelegraphSlots: 6,
          enemyMuzzleSlots: 8,
          enemyMeleeSlots: 6,
          enemyDissipationSlots: 5,
          elementalImpactSlots: 6,
          enemyProjectileDetail: false,
          fireTongues: 2,
          lightningSegments: 3,
          lightningBranches: 1,
          voidShards: 2,
          chronoRiftSlots: 5,
          chronoRiftEchoes: 1,
          chronoTrailEchoes: 3,
          playerProjectileSlots: 8,
          enemyMuzzleRays: 1,
          enemyMeleeLayers: 1,
          enemyDissipationSparks: 1
        }
      : quality === "high"
        ? {
            impactSlots: 14,
            impactSparks: 7,
            erasureSlots: 8,
            erasureSparks: 6,
            enemyProjectileSlots: 40,
            enemyTelegraphSlots: 14,
            enemyMuzzleSlots: 20,
            enemyMeleeSlots: 12,
            enemyDissipationSlots: 10,
            elementalImpactSlots: 14,
            enemyProjectileDetail: true,
            fireTongues: 5,
            lightningSegments: 5,
            lightningBranches: 3,
            voidShards: 5,
            chronoRiftSlots: 12,
            chronoRiftEchoes: 4,
            chronoTrailEchoes: 7,
            playerProjectileSlots: 20,
            enemyMuzzleRays: 3,
            enemyMeleeLayers: 2,
            enemyDissipationSparks: 3
          }
        : {
            impactSlots: 10,
            impactSparks: 5,
            erasureSlots: 6,
            erasureSparks: 4,
            enemyProjectileSlots: 24,
            enemyTelegraphSlots: 10,
            enemyMuzzleSlots: 12,
            enemyMeleeSlots: 8,
            enemyDissipationSlots: 8,
            elementalImpactSlots: 10,
            enemyProjectileDetail: true,
            fireTongues: 4,
            lightningSegments: 5,
            lightningBranches: 2,
            voidShards: 4,
            chronoRiftSlots: 10,
            chronoRiftEchoes: 3,
            chronoTrailEchoes: 5,
            playerProjectileSlots: 12,
            enemyMuzzleRays: 3,
            enemyMeleeLayers: 2,
            enemyDissipationSparks: 3
          };
  Object.assign(effectQuality, profile);
  for (const [index, slot] of effectPools.impacts.entries()) {
    if (index >= effectQuality.impactSlots) deactivatePooledEffect(slot);
    else slot.applyQuality();
  }
  for (const [index, slot] of effectPools.erasures.entries()) {
    if (index >= effectQuality.erasureSlots) deactivatePooledEffect(slot);
    else slot.applyQuality();
  }
  const enemyPools = [
    [effectPools.enemyProjectiles, effectQuality.enemyProjectileSlots],
    [effectPools.elementalImpacts, effectQuality.elementalImpactSlots],
    [effectPools.enemyTelegraphs, effectQuality.enemyTelegraphSlots],
    [effectPools.enemyMuzzles, effectQuality.enemyMuzzleSlots],
    [effectPools.enemyMelee, effectQuality.enemyMeleeSlots],
    [effectPools.enemyDissipations, effectQuality.enemyDissipationSlots]
  ];
  for (const [pool, limit] of enemyPools) {
    for (const [index, slot] of pool.entries()) {
      if (index >= limit) deactivatePooledEffect(slot);
      else slot.applyQuality();
    }
  }
  const chronoPools = [
    [effectPools.chronoSlashes, effectQuality.enemyMeleeSlots],
    [effectPools.chronoRifts, effectQuality.chronoRiftSlots],
    [effectPools.chronoStopFields, 1],
    [effectPools.chronoTrails, 4],
    [effectPools.playerProjectiles, effectQuality.playerProjectileSlots]
  ];
  for (const [pool, limit] of chronoPools) {
    for (const [index, slot] of pool.entries()) {
      if (index >= limit) deactivatePooledEffect(slot);
      else slot.applyQuality();
    }
  }
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
  // 共通パルスも衝撃プールを再利用する。ここから下の旧生成経路は互換参照用で実行しない。
  spawnImpactBurst(position, colorHex, radius, lastMoveDirection, 0.12);
  return;
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
  // Qは線状の裂け目と残像を固定プールから出す。敵数に比例してメッシュを生成しない。
  spawnChronoRift(position);
  return;
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

function spawnImpactBurst(position, colorHex = "#63e5ff", radius = 1, direction = lastMoveDirection, height = 0.04) {
  // 時空の通常攻撃・ダッシュも衝撃波シートとsoft-particleを主役にする。引数は旧呼び出し互換のため維持する。
  void colorHex;
  void direction;
  void height;
  texturedEffects?.spawnChronoImpact(position, radius);
  return;
  const slot = findPooledEffect(effectPools.impacts, effectQuality.impactSlots);
  if (!slot) return;
  slot.alive = true;
  slot.age = 0;
  slot.duration = getEffectDuration(prefersReducedMotion ? 0.26 : 0.38);
  slot.radius = radius;
  slot.root.position.set(position.x, height, position.z);
  slot.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
  slot.root.setEnabled(true);
  setPooledEffectMaterial(slot.primary, colorHex, 0.94);
  setPooledEffectMaterial(slot.accent, "#fff3c9", 0.88);
  const sparkCount = getEffectParticleCount("impact");
  slot.sparks.forEach((spark, sparkIndex) => {
    const enabled = sparkIndex < sparkCount;
    spark.mesh.setEnabled(enabled);
    if (!enabled) return;
    const angle = (sparkIndex / sparkCount) * Math.PI * 2 + 0.32;
    const speed = radius * (1.8 + (sparkIndex % 3) * 0.34);
    spark.mesh.position.set(Math.sin(angle) * 0.11, 0.32 + (sparkIndex % 2) * 0.1, Math.cos(angle) * 0.11);
    spark.mesh.rotation.set(angle, angle * 0.7, 0);
    spark.velocity.set(Math.sin(angle) * speed, 1.2 + (sparkIndex % 3) * 0.34, Math.cos(angle) * speed);
  });
}

function spawnTimeTrail(from, to, { rewindTrail = false } = {}) {
  // Rでは残像片を終点へ寄せる。通常ダッシュも同じ固定レールを再利用する。
  spawnChronoTrail(from, to, { rewindTrail });
  return;
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
  // Eは停止した時計針と結晶板を持つ固定フィールド。発動ごとの生成を避ける。
  spawnChronoStopField(position);
  return;
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

function cloneEnemyDissolveMaterials(enemy) {
  const clonesBySource = new Map();
  const deathColor = getEffectColor(enemyDeathColors[enemy.type] ?? enemyDeathColors.chaser);
  enemy.dissolveMaterials = [];
  for (const mesh of enemy.mesh.getChildMeshes()) {
    const source = mesh.material;
    if (!source?.clone) continue;
    let material = clonesBySource.get(source);
    if (!material) {
      // GLB由来PBRは共有されるため、敵インスタンスごとに複製してから透明度・発光を動かす。
      material = source.clone(`dissolve-${enemy.id}-${source.name}`);
      if ("transparencyMode" in material) material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      clonesBySource.set(source, material);
      const baseEmissive = material.emissiveColor?.clone?.() ?? Color3.Black();
      enemy.dissolveMaterials.push({
        material,
        baseAlpha: material.alpha ?? 1,
        baseEmissive,
        deathColor
      });
    }
    mesh.material = material;
  }
}

function updateEnemyDissolve(enemy, deltaSeconds) {
  enemy.deathRemaining -= deltaSeconds;
  const progress = Math.min(1, 1 - enemy.deathRemaining / enemy.deathDuration);
  const dissolve = progress ** 1.18;
  const flare = 0.28 + dissolve * (enemy.type === "boss" ? 2.5 : 1.72);
  // 倒れず足元を保持したまま、縮退と発光だけを時間方向へ進める。
  const horizontalScale = enemy.baseScale * (1 - dissolve * 0.1);
  enemy.mesh.position.y = enemy.baseY + (prefersReducedMotion ? 0 : dissolve * 0.04);
  enemy.mesh.rotation.x = 0;
  enemy.mesh.rotation.z = 0;
  enemy.mesh.scaling.set(horizontalScale, enemy.baseScale * (1 - dissolve * 0.035), horizontalScale);
  for (const record of enemy.dissolveMaterials ?? []) {
    const { material, baseAlpha, baseEmissive, deathColor } = record;
    material.alpha = baseAlpha * (1 - dissolve) ** 1.45;
    if (material.emissiveColor?.copyFromFloats) {
      material.emissiveColor.copyFromFloats(
        baseEmissive.r * (1 - dissolve * 0.55) + deathColor.r * flare,
        baseEmissive.g * (1 - dissolve * 0.55) + deathColor.g * flare,
        baseEmissive.b * (1 - dissolve * 0.55) + deathColor.b * flare
      );
    }
  }
  if (enemy.deathRemaining <= 0) {
    enemy.dying = false;
    enemy.mesh.setEnabled(false);
  }
}

function removeEnemy(enemy) {
  if (!enemy.alive) return;
  enemy.alive = false;
  enemy.dying = true;
  enemy.deathDuration = getEffectDuration(enemy.type === "boss" ? 0.78 : 0.52);
  enemy.deathRemaining = enemy.deathDuration;
  enemy.rune?.setEnabled(false);
  cloneEnemyDissolveMaterials(enemy);
  spawnTimeErasureBurst(enemy.mesh.position, enemy.type);
  shadowGenerator.removeShadowCaster(enemy.mesh, true);
  run.hitStop = Math.max(run.hitStop, enemy.type === "boss" ? 0.095 : 0.045);
  applyCameraImpact(enemy.type === "boss" ? 0.28 : 0.08, enemy.type === "boss" ? 0.24 : 0.1);
  const isBoss = enemy.type === "boss";
  run.kills += isBoss ? 10 : 1;
  run.shards += isBoss ? 12 : enemy.type === "thief" ? 3 : 1;
  run.xp += isBoss ? 8 : enemy.type === "shooter" ? 2 : 1;

  if (isBoss) {
    run.bossDefeated = true;
    run.remaining = Math.min(RUN_DURATION_SECONDS, run.remaining + 2);
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
  const position = player.position.clone();
  position.y = 0.82;
  const direction = target.mesh.position.subtract(position);
  direction.y = 0;
  direction.normalize();
  const projectile = {
    position,
    velocity: direction.scale(15.5),
    target,
    life: 1.35,
    damage: 2,
    pierce: run.stats.pierce,
    hitIds: new Set(),
    visual: null,
    alive: true
  };
  // 通常攻撃も固定スロットを使い、連射時にメッシュをnewしない。
  spawnPlayerProjectileVisual(projectile);
  playerProjectiles.push(projectile);
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

  // 通常攻撃は光の斬撃弧と衝撃輪を一つの時空スロットで表す。
  spawnChronoSlash(player.position, direction);
  return;

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

function spawnEnemyProjectile(enemy, angleOffset = 0, { element = getEnemyAttackElement(enemy.type, angleOffset), cosmetic = false } = {}) {
  const isBoss = enemy.type === "boss";
  const position = enemy.mesh.position.clone();
  position.y = isBoss ? 1.05 : 0.88;
  const direction = player.position.subtract(enemy.mesh.position);
  direction.y = 0;
  direction.normalize();
  if (angleOffset !== 0) {
    const cosine = Math.cos(angleOffset);
    const sine = Math.sin(angleOffset);
    const { x, z } = direction;
    direction.set(x * cosine - z * sine, 0, x * sine + z * cosine);
  }
  const palette = elementalPalette[element] ?? elementalPalette.fire;
  const projectile = {
    position,
    velocity: direction.scale(isBoss ? 7.2 : 6.4),
    life: isBoss ? 3.6 : 3.2,
    maxLife: isBoss ? 3.6 : 3.2,
    damage: cosmetic ? 0 : isBoss ? 14 : 10,
    type: enemy.type,
    element,
    colorHex: palette.primary,
    isBoss,
    cosmetic,
    visual: null,
    alive: true
  };
  // 弾は発射ごとにメッシュを作らず、コア・殻・トレイル・リングの固定プールを割り当てる。
  spawnEnemyProjectileVisual(projectile);
  spawnEnemyMuzzleFlash(position, direction, projectile.colorHex, isBoss ? 1.34 : 1);
  enemyProjectiles.push(projectile);
  enemy.recoil = Math.max(enemy.recoil, isBoss ? 0.24 : 0.18);
  playSound("enemyShot");
}

function playerHit(damage, stealsTime = false, { sourceType = null, element = null, direction = lastMoveDirection } = {}) {
  if (run.invulnerable > 0 || phase !== "playing") return false;
  run.hp = Math.max(0, run.hp - damage);
  run.invulnerable = 0.7;
  playPlayerAnimation("Hit", { loop: false, speedRatio: 1.8, lock: 0.34, restart: true });
  playSound("playerHit");
  run.hitStop = Math.max(run.hitStop, 0.085);
  applyCameraImpact(0.24, 0.2);
  if (stealsTime) run.remaining = Math.max(0, run.remaining - 1);
  spawnPulse(player.position, "#ff6677", 2.2, 0.36);
  if (sourceType) {
    const attackElement = element ?? getEnemyAttackElement(sourceType);
    spawnElementalImpact(player.position, attackElement, direction);
    // 被弾は既存の時計パルスに、色付き衝撃波・火花・白いフラッシュを重ねて原因を即読できるようにする。
    spawnImpactBurst(
      player.position,
      elementalPalette[attackElement]?.primary ?? enemyAttackColors[sourceType] ?? enemyAttackColors.chaser,
      sourceType === "boss" ? 1.72 : 1.32,
      direction,
      0.24
    );
  }
  showToast(stealsTime ? `時盗りに接触 — HP −${damage} / 時間 −1秒` : `被弾 — HP −${damage}`);
  if (run.hp <= 0) finishRun(false);
  return true;
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

function updateEnemyShotTelegraph(enemy, distance, range, worldSpeed) {
  const lead = enemy.type === "boss" ? 0.48 : 0.42;
  if (enemy.attackTelegraphActive || enemy.shootCooldown > lead || distance >= range) return;
  // クールダウンが従来どおり0へ到達する前だけを可視化する。発射時刻・弾速は触らない。
  spawnEnemyTelegraph(enemy, lead / Math.max(0.035, worldSpeed));
  enemy.attackTelegraphActive = true;
}

function updateEnemies(deltaSeconds) {
  const hourglassSlow = run.stats.hourglass && run.remaining <= 10 ? 0.45 : 1;
  const worldSpeed = run.freezeRemaining > 0 ? 0.035 : hourglassSlow;

  for (const enemy of enemies) {
    if (!enemy.alive) {
      if (enemy.dying) updateEnemyDissolve(enemy, deltaSeconds);
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
      updateEnemyShotTelegraph(enemy, distance, 14.5, worldSpeed);
      if (enemy.shootCooldown <= 0 && distance < 14.5 && run.freezeRemaining <= 0) {
        playEnemyAnimation(enemy, "Attack", { loop: false, speedRatio: 1.05, lock: 0.48, restart: true });
        for (const spread of [-0.2, 0, 0.2]) spawnEnemyProjectile(enemy, spread);
        spawnPulse(enemy.mesh.position, "#ff465f", 2.2, 0.34);
        enemy.attackTelegraphActive = false;
        enemy.shootCooldown = 1.18;
      }
    } else if (enemy.type === "shooter") {
      if (distance < 7.2) movement = direction.scale(-1);
      else if (distance <= 10.5) movement = new Vector3(direction.z, 0, -direction.x).scale(Math.sin(enemy.phase) > 0 ? 1 : -1);
      updateEnemyShotTelegraph(enemy, distance, 13.5, worldSpeed);
      if (enemy.shootCooldown <= 0 && distance < 13.5 && run.freezeRemaining <= 0) {
        playEnemyAnimation(enemy, "Attack", { loop: false, speedRatio: 1.2, lock: 0.42, restart: true });
        spawnEnemyProjectile(enemy);
        enemy.attackTelegraphActive = false;
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
      if (enemy.type === "chaser") spawnEnemyMeleeArc(enemy, direction);
      // Thiefの接触ダメージは変えず、同じ瞬間に短命の闇弾だけを足す。
      if (enemy.type === "thief") spawnEnemyProjectile(enemy, 0, { element: "void", cosmetic: true });
      playerHit(enemy.damage, enemy.type === "thief", { sourceType: enemy.type, direction });
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
      deactivatePooledEffect(projectile.visual);
      continue;
    }

    if (projectile.target?.alive) {
      const desired = projectile.target.mesh.position.subtract(projectile.position);
      desired.y = 0;
      if (desired.lengthSquared() > 0.001) {
        desired.normalize();
        const current = projectile.velocity.normalizeToNew();
        projectile.velocity = Vector3.Lerp(current, desired, Math.min(1, deltaSeconds * 4.8)).normalize().scale(15.5);
      }
    }

    projectile.position.addInPlace(projectile.velocity.scale(deltaSeconds));

    for (const enemy of enemies) {
      if (!enemy.alive || projectile.hitIds.has(enemy.id)) continue;
      const hitRadius = enemy.type === "boss" ? 1.8 : 0.85;
      if (!isWithinHorizontalRadius(projectile.position, enemy.mesh.position, hitRadius)) continue;
      projectile.hitIds.add(enemy.id);
      damageEnemy(enemy, projectile.damage);
      if (projectile.pierce > 0) projectile.pierce -= 1;
      else {
        projectile.alive = false;
        deactivatePooledEffect(projectile.visual);
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
      spawnEnemyProjectileDissipation(projectile);
      deactivatePooledEffect(projectile.visual);
      continue;
    }
    projectile.position.addInPlace(projectile.velocity.scale(deltaSeconds * worldSpeed));
    if (isWithinHorizontalRadius(projectile.position, player.position, 0.82)) {
      projectile.alive = false;
      deactivatePooledEffect(projectile.visual);
      const hit = projectile.cosmetic
        ? false
        : playerHit(projectile.damage, false, {
            sourceType: projectile.type,
            element: projectile.element,
            direction: projectile.velocity
          });
      if (!hit) spawnEnemyProjectileDissipation(projectile);
    }
  }
}

function updateEffects(deltaSeconds) {
  texturedEffects?.update(deltaSeconds);
  updatePooledEffects(deltaSeconds);
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
      deactivatePooledEffect(item.visual);
      for (const animation of item.animations?.values?.() ?? []) animation.dispose();
      item.mesh?.dispose();
      item.rune?.dispose();
      item.material?.dispose();
      for (const record of item.dissolveMaterials ?? []) record.material.dispose();
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
  if (!visualTestMode) run.remaining = Math.max(0, run.remaining - deltaSeconds);
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
  // lowでは同時エフェクト枠と火花を落とし、描画メッシュ数を確実に抑える。
  configureEffectQuality(quality);
  texturedEffects?.applyQuality(quality);
  if (visualTestMode) {
    const diagnostics = texturedEffects?.getDiagnostics();
    gameShell.dataset.visualQuality = diagnostics?.quality ?? quality;
    gameShell.dataset.visualScaleByElement = JSON.stringify(diagnostics?.scaleByElement ?? {});
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
      },
      impactNearest() {
        const target = enemies.find((enemy) => enemy.alive && enemy.hp > 1);
        if (!target || phase !== "playing") return false;
        damageEnemy(target, 1);
        return true;
      },
      eraseNearest() {
        const target = enemies.find((enemy) => enemy.alive);
        if (!target || phase !== "playing") return false;
        damageEnemy(target, target.hp);
        return true;
      },
      effectState() {
        return {
          impacts: effectPools.impacts.filter((slot) => slot.alive).length,
          erasures: effectPools.erasures.filter((slot) => slot.alive).length,
          enemyProjectiles: effectPools.enemyProjectiles.filter((slot) => slot.alive).length,
          enemyTelegraphs: effectPools.enemyTelegraphs.filter((slot) => slot.alive).length,
          enemyMuzzles: effectPools.enemyMuzzles.filter((slot) => slot.alive).length,
          enemyMelee: effectPools.enemyMelee.filter((slot) => slot.alive).length,
          enemyDissipations: effectPools.enemyDissipations.filter((slot) => slot.alive).length,
          textured: texturedEffects?.getDiagnostics(),
          visualTestMode
        };
      },
      previewEffect(element = "chrono") {
        if (phase !== "playing" || !texturedEffects || !elementalPalette[element]) return false;
        if (element === "chrono") {
          texturedEffects.spawnChronoRift(player.position, 1.25);
          texturedEffects.spawnChronoImpact(player.position, 1.45);
        } else {
          texturedEffects.spawnElementalImpact(player.position, element, lastMoveDirection);
        }
        return texturedEffects.getDiagnostics();
      },
      previewEnemyAttack(type = "shooter") {
        return spawnVisualEnemyPreview(type);
      },
      previewSwarm(count = 12) {
        return spawnVisualSwarm(count);
      },
      previewCrowdedEffects() {
        return spawnCrowdedEffectPreview();
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
  if (visualAutoStart) startRun();

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
