import { getLayoutOverrides } from "./layout-overrides.js";

/* global BABYLON */

const EFFECT_COLOURS = Object.freeze({
  calm: "#819bff",
  wake: "#ffca62",
  heal: "#71daa2",
  shift: "#bf86ff",
  none: "#8090a9",
});
const TEMP_COLOURS = Object.freeze({
  low: "#8570ff",
  mid: "#f4a45d",
  high: "#ff694f",
});
// Keep these visual envelopes aligned with the procedural MeshBuilder fallbacks
// in createWorkshopScene. The source meshes are intentionally still present as
// interaction/station anchors even after their render meshes are hidden.
const HERO_ASSETS = Object.freeze({
  cauldron: Object.freeze({
    path: "assets/models/cauldron.glb",
    hide: ["cauldron", "cauldron-rim"],
    anchor: "cauldron",
    size: Object.freeze({ height: 1.15, diameter: 2.05 }),
    action: "cauldron",
    family: "iron",
    special: Object.freeze({ liquidMouthFit: true }),
  }),
  cuttingBoard: Object.freeze({
    path: "assets/models/cutting-board.glb",
    hide: ["cutting-board"],
    anchor: "cutting-board",
    size: Object.freeze({ height: 0.18, diameter: 1.9 }),
    action: "board",
    family: "wood",
  }),
  knife: Object.freeze({
    path: "assets/models/knife.glb",
    hide: ["knife"],
    anchor: "knife",
    size: Object.freeze({ height: 0.07, diameter: 1.15 }),
    action: null,
    family: "iron",
  }),
  mortar: Object.freeze({
    path: "assets/models/mortar.glb",
    hide: ["mortar"],
    anchor: "mortar",
    size: Object.freeze({ height: 0.55, diameter: 1.35 }),
    action: "mortar",
    family: "stone",
  }),
  pestle: Object.freeze({
    path: "assets/models/pestle.glb",
    hide: ["pestle"],
    anchor: "pestle",
    size: Object.freeze({ height: 0.9, diameter: 0.22 }),
    action: null,
    family: "wood",
  }),
  heatDial: Object.freeze({
    path: "assets/models/heat-dial.glb",
    hide: ["heat-dial", "dial-notch"],
    anchor: "heat-dial",
    size: Object.freeze({ height: 0.17, diameter: 0.88 }),
    action: "dial",
    family: "brass",
    special: Object.freeze({ followsDialAngle: true }),
  }),
  appraisalLens: Object.freeze({
    path: "assets/models/appraisal-lens.glb",
    hide: ["appraisal-lens", "lens-handle"],
    anchor: "appraisal-lens",
    size: Object.freeze({ height: 0.95, diameter: 0.95 }),
    action: "lens",
    family: "brass",
  }),
  deliveryTray: Object.freeze({
    path: "assets/models/delivery-tray.glb",
    hide: ["delivery-tray"],
    anchor: "delivery-tray",
    size: Object.freeze({ height: 0.13, diameter: 1.25 }),
    action: "tray",
    family: "wood",
  }),
  jar: Object.freeze({
    path: "assets/models/jar.glb",
    hide: ["jar-*"],
    anchor: "jar",
    size: Object.freeze({ height: 0.95, diameter: 0.55 }),
    action: "jar",
    family: "glass",
    special: Object.freeze({ clonePerMaterial: true }),
  }),
});
// These adjust only the GLB visual anchors. Procedural meshes remain the
// gameplay source of truth for stations, stirring, and drop targets.
const HERO_VISUAL_SCALE = Object.freeze({
  cauldron: 1.618,
  cuttingBoard: 1.2,
  knife: 1.2,
  mortar: 1.2,
  pestle: 1.2,
  heatDial: 1.15,
  appraisalLens: 1.15,
  deliveryTray: 1.15,
  jar: 1.1,
});
const HERO_VISUAL_Y_OFFSET = Object.freeze({
  cauldron: -0.04,
});
// Static set dressing stays outside the interaction graph: its GLBs have no
// action registration or fallback mesh to preserve. Positions are model centres.
const DRESSING_ASSETS = Object.freeze({
  books: Object.freeze({
    path: "assets/models/dress-books.glb",
    position: Object.freeze({ x: 1.293, y: 0.81, z: 2.363 }),
    rotationY: -0.18,
    size: Object.freeze({ height: 1.115, diameter: 2.088 }),
    family: "leather",
  }),
  plant: Object.freeze({
    path: "assets/models/dress-plant.glb",
    position: Object.freeze({ x: 4.249, y: 0.875, z: 3.588 }),
    rotationY: -0.42,
    size: Object.freeze({ height: 2.032, diameter: 2.032 }),
    family: "plant",
  }),
  candle: Object.freeze({
    path: "assets/models/dress-candle.glb",
    placements: Object.freeze([
      Object.freeze({ position: Object.freeze({ x: -4.15, y: 0.79, z: 1.44 }), rotationY: 0 }),
      Object.freeze({ position: Object.freeze({ x: 4.1, y: 2.45, z: 3.72 }), rotationY: Math.PI }),
    ]),
    size: Object.freeze({ height: 0.42, diameter: 0.18 }),
    family: "wax",
    flags: Object.freeze({ hideProcedural: Object.freeze(["board-candle-body", "shelf-candle-body"]) }),
  }),
  hourglass: Object.freeze({
    path: "assets/models/dress-hourglass.glb",
    position: Object.freeze({ x: 2.988, y: 0.88, z: 2.626 }),
    rotationY: 0.36,
    size: Object.freeze({ height: 2.096, diameter: 2.131 }),
    family: "wood",
  }),
  crate: Object.freeze({
    path: "assets/models/dress-crate.glb",
    position: Object.freeze({ x: -2.396, y: 0.915, z: 1.182 }),
    rotationX: 0.5,
    rotationY: -0.88,
    size: Object.freeze({ height: 2.019, diameter: 3.207 }),
    family: "wood",
  }),
  armillary: Object.freeze({
    // 真鍮の天球儀。奥の縁に置いて背景の丸窓とシルエットが重ならない位置を選ぶ。
    path: "assets/models/dress-armillary.glb",
    position: Object.freeze({ x: 2.25, y: 1.02, z: 3.45 }),
    rotationY: -0.35,
    size: Object.freeze({ height: 0.86, diameter: 0.62 }),
    family: "brass",
  }),
  bottles: Object.freeze({
    path: "assets/models/dress-bottles.glb",
    position: Object.freeze({ x: -1.4, y: 0.82, z: 3.38 }),
    rotationY: 0.12,
    size: Object.freeze({ height: 0.735, diameter: 1.47 }),
    family: "glass",
  }),
  scroll: Object.freeze({
    path: "assets/models/dress-scroll.glb",
    position: Object.freeze({ x: 4.1, y: 0.75, z: 1.52 }),
    rotationY: -0.28,
    size: Object.freeze({ height: 0.525, diameter: 1.47 }),
    family: "parchment",
  }),
  lantern: Object.freeze({
    path: "assets/models/dress-lantern.glb",
    position: Object.freeze({ x: 4.12, y: 2.49, z: 4.12 }),
    rotationY: Math.PI,
    size: Object.freeze({ height: 0.5, diameter: 0.35 }),
    family: "brass",
  }),
  ivy: Object.freeze({
    path: "assets/models/dress-ivy.glb",
    position: Object.freeze({ x: -4.28, y: 1.79, z: 4.05 }),
    rotationY: Math.PI / 2,
    size: Object.freeze({ height: 0.9, diameter: 0.32 }),
    family: "ivy",
  }),
  moonOrb: Object.freeze({
    path: "assets/models/dress-moon-orb.glb",
    position: Object.freeze({ x: -1.288, y: 0.785, z: 0.857 }),
    rotationY: 0,
    size: Object.freeze({ height: 0.985, diameter: 1.126 }),
    family: "moonOrb",
    flags: Object.freeze({ includeGlow: true }),
  }),
  compartmentBox: Object.freeze({
    path: "assets/models/dress-compartment-box.glb",
    position: Object.freeze({ x: -5.5, y: 0.715, z: 4 }),
    rotationX: 1.05,
    rotationY: 0.32,
    rotationZ: -0.85,
    size: Object.freeze({ height: 2.488, diameter: 11.684 }),
    family: "plain",
  }),
  petalBowl: Object.freeze({
    path: "assets/models/dress-petal-bowl.glb",
    position: Object.freeze({ x: -2.116, y: 0.73, z: -1.815 }),
    rotationY: 0.1,
    size: Object.freeze({ height: 0.791, diameter: 1.888 }),
    family: "plain",
  }),
  crystalBowl: Object.freeze({
    path: "assets/models/dress-crystal-bowl.glb",
    position: Object.freeze({ x: 3.34, y: 0.73, z: -1.602 }),
    rotationY: -0.15,
    size: Object.freeze({ height: 0.831, diameter: 1.821 }),
    family: "plain",
  }),
  spellbook: Object.freeze({
    path: "assets/models/dress-spellbook.glb",
    position: Object.freeze({ x: -3.607, y: 0.76, z: -1.412 }),
    rotationY: 0.15,
    size: Object.freeze({ height: 2.138, diameter: 10.751 }),
    family: "plain",
  }),
  scale: Object.freeze({
    path: "assets/models/dress-scale.glb",
    position: Object.freeze({ x: 2.075, y: 0.965, z: 1.086 }),
    rotationX: 0.65,
    rotationY: 0.55,
    size: Object.freeze({ height: 2.478, diameter: 2.702 }),
    family: "plain",
  }),
  herbBundle: Object.freeze({
    path: "assets/models/dress-herb-bundle.glb",
    position: Object.freeze({ x: -1.113, y: 0.695, z: 0.003 }),
    rotationY: -0.5,
    size: Object.freeze({ height: 0.850, diameter: 3.826 }),
    family: "plain",
  }),
  alembic: Object.freeze({
    path: "assets/models/dress-alembic.glb",
    position: Object.freeze({ x: -3.145, y: 0.925, z: 3.301 }),
    rotationY: 0.2,
    size: Object.freeze({ height: 2.096, diameter: 1.856 }),
    family: "glass",
  }),
  inkwell: Object.freeze({
    path: "assets/models/dress-inkwell.glb",
    position: Object.freeze({ x: -1.582, y: 0.7, z: -0.865 }),
    rotationY: -0.3,
    size: Object.freeze({ height: 0.536, diameter: 0.751 }),
    family: "plain",
  }),
  candelabra: Object.freeze({
    path: "assets/models/dress-candelabra.glb",
    position: Object.freeze({ x: -0.972, y: 0.925, z: 4 }),
    rotationY: -0.1,
    size: Object.freeze({ height: 2.310, diameter: 1.980 }),
    family: "brass",
  }),
  mushroomBasket: Object.freeze({
    path: "assets/models/dress-mushroom-basket.glb",
    position: Object.freeze({ x: 1.76, y: 0.75, z: -1.514 }),
    rotationY: 0.2,
    size: Object.freeze({ height: 1.413, diameter: 2.017 }),
    family: "wood",
  }),
  starchart: Object.freeze({
    path: "assets/models/dress-starchart.glb",
    position: Object.freeze({ x: 1.906, y: 0.605, z: -1.252 }),
    rotationY: 0.35,
    fit: "flat",
    size: Object.freeze({ height: 0.291, diameter: 5.319 }),
    family: "parchment",
  }),
  flask: Object.freeze({
    path: "assets/models/dress-flask.glb",
    position: Object.freeze({ x: -1.991, y: 0.825, z: 3.431 }),
    rotationY: -0.28,
    size: Object.freeze({ height: 0.481, diameter: 0.481 }),
    family: "glass",
  }),
  censer: Object.freeze({
    path: "assets/models/dress-censer.glb",
    position: Object.freeze({ x: 1.01, y: 0.755, z: -0.16 }),
    rotationX: 0.5,
    rotationY: 0.4,
    size: Object.freeze({ height: 1.303, diameter: 1.303 }),
    family: "brass",
  }),
  keys: Object.freeze({
    path: "assets/models/dress-keys.glb",
    position: Object.freeze({ x: 3.5, y: 0.6, z: -0.05 }),
    rotationY: 0.6,
    fit: "flat",
    size: Object.freeze({ height: 0.12, diameter: 0.96 }),
    family: "brass",
  }),
  teapot: Object.freeze({
    path: "assets/models/dress-teapot.glb",
    position: Object.freeze({ x: 3.692, y: 0.8, z: 0.734 }),
    rotationY: -0.3,
    size: Object.freeze({ height: 1.164, diameter: 1.680 }),
    family: "ceramic",
  }),
  herbPlate: Object.freeze({
    path: "assets/models/dress-herb-plate.glb",
    position: Object.freeze({ x: -1.078, y: 0.615, z: -1.472 }),
    rotationY: -0.2,
    fit: "flat",
    size: Object.freeze({ height: 0.194, diameter: 1.214 }),
    family: "plain",
  }),
});
const HERO_SCALE_LIMITS = Object.freeze({ min: 0.0001, max: 10000 });
const HERO_LAYOUT_SCALE_LIMITS = Object.freeze({ min: 0.3, max: 4 });
const HERO_LAYOUT_HEIGHT_LIMITS = Object.freeze({ min: 0.3, max: 3.5 });
const heroAssetLoadScenes = new WeakSet();
const dressingAssetLoadScenes = new WeakSet();
const hammeredIronTexturesByScene = new WeakMap();
const hammeredIronMaterialsByScene = new WeakMap();
const heroStandardMaterialsByScene = new WeakMap();
const workshopAtmospheresByScene = new WeakMap();
const paintedBackdropsByScene = new WeakMap();
const HAMMERED_IRON_TEXTURE_SIZE = 512;
const HAMMERED_IRON_SEED = 0x5eeda11;
// 実機チューニング済み: 幅80だと画像中央だけが拡大されボケるため、視野適合の28へ。
// 首振り端でのわずかな見切れは許容（クリアカラーが近色のため目立たない）。
const BACKDROP_WIDTH = 28;
const BACKDROP_HEIGHT = BACKDROP_WIDTH * (941 / 1672);
// 64 bubbles + 56 steam + 32 dust + the pre-existing 48-particle pour burst = 200.
const PARTICLE_CAPACITY = Object.freeze({ bubbles: 64, steam: 56, dust: 32, pourBurst: 48 });

const colour3 = (hex) => BABYLON.Color3.FromHexString(hex);

function material(name, hex, scene, emissive = "#000000") {
  const result = new BABYLON.StandardMaterial(name, scene);
  result.diffuseColor = colour3(hex);
  result.emissiveColor = colour3(emissive);
  result.specularColor = BABYLON.Color3.Black();
  return result;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(value) {
  return value * value * (3 - (2 * value));
}

function valueNoise(size, cells, random) {
  const gridSize = cells + 1;
  const values = new Float32Array(gridSize * gridSize);
  for (let index = 0; index < values.length; index += 1) values[index] = random();
  return (x, y) => {
    const scaledX = (x / size) * cells;
    const scaledY = (y / size) * cells;
    const cellX = Math.floor(scaledX);
    const cellY = Math.floor(scaledY);
    const blendX = smoothstep(scaledX - cellX);
    const blendY = smoothstep(scaledY - cellY);
    const top = values[(cellY * gridSize) + cellX] * (1 - blendX)
      + values[(cellY * gridSize) + cellX + 1] * blendX;
    const bottom = values[((cellY + 1) * gridSize) + cellX] * (1 - blendX)
      + values[((cellY + 1) * gridSize) + cellX + 1] * blendX;
    return top * (1 - blendY) + bottom * blendY;
  };
}

function createHammeredIronTextures(scene) {
  const cached = hammeredIronTexturesByScene.get(scene);
  if (cached) return cached;

  const size = HAMMERED_IRON_TEXTURE_SIZE;
  const random = mulberry32(HAMMERED_IRON_SEED);
  const diffuse = new BABYLON.DynamicTexture("cauldron-hammered-iron-diffuse", { width: size, height: size }, scene, true);
  const bump = new BABYLON.DynamicTexture("cauldron-hammered-iron-bump", { width: size, height: size }, scene, true);
  const diffuseContext = diffuse.getContext();
  const bumpContext = bump.getContext();
  const diffuseData = diffuseContext.createImageData(size, size);
  const bumpData = bumpContext.createImageData(size, size);
  const grainValues = new Float32Array(size * size);
  const height = new Float32Array(size * size);
  const streakDarkness = new Float32Array(size * size);
  const rustValues = new Float32Array(size * size);
  const noise = valueNoise(size, 24, random);
  const dimples = Array.from({ length: 220 }, () => ({
    x: random() * size,
    y: random() * size,
    radius: 5 + (random() * 15),
    depth: 0.08 + (random() * 0.12),
  }));
  const streaks = Array.from({ length: 11 }, () => ({
    x: random() * size,
    width: 8 + (random() * 18),
    wave: 4 + (random() * 14),
    phase: random() * size,
    darkness: 0.025 + (random() * 0.035),
  }));
  const rustSpecks = Array.from({ length: 36 }, () => ({
    x: random() * size,
    y: random() * size,
    radius: 1 + (random() * 3.5),
    strength: 0.08 + (random() * 0.12),
  }));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size) + x;
      grainValues[index] = noise(x, y);
      height[index] = (grainValues[index] - 0.5) * 0.035;
    }
  }
  for (const dimple of dimples) {
    const minX = Math.max(0, Math.floor(dimple.x - dimple.radius));
    const maxX = Math.min(size - 1, Math.ceil(dimple.x + dimple.radius));
    const minY = Math.max(0, Math.floor(dimple.y - dimple.radius));
    const maxY = Math.min(size - 1, Math.ceil(dimple.y + dimple.radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x - dimple.x, y - dimple.y);
        if (distance >= dimple.radius) continue;
        const index = (y * size) + x;
        const falloff = 1 - (distance / dimple.radius);
        height[index] -= dimple.depth * falloff * falloff * (0.65 + (grainValues[index] * 0.35));
      }
    }
  }
  for (const streak of streaks) {
    for (let y = 0; y < size; y += 1) {
      const centre = streak.x + (Math.sin((y + streak.phase) / 42) * streak.wave);
      const minX = Math.max(0, Math.floor(centre - streak.width));
      const maxX = Math.min(size - 1, Math.ceil(centre + streak.width));
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.abs(x - centre) / streak.width;
        streakDarkness[(y * size) + x] += streak.darkness * (1 - distance) * (1 - distance);
      }
    }
  }
  for (const speck of rustSpecks) {
    const minX = Math.max(0, Math.floor(speck.x - speck.radius));
    const maxX = Math.min(size - 1, Math.ceil(speck.x + speck.radius));
    const minY = Math.max(0, Math.floor(speck.y - speck.radius));
    const maxY = Math.min(size - 1, Math.ceil(speck.y + speck.radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x - speck.x, y - speck.y) / speck.radius;
        if (distance >= 1) continue;
        rustValues[(y * size) + x] += speck.strength * (1 - distance) * (1 - distance);
      }
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size) + x;
      const grain = grainValues[index];
      const dimpleDepth = height[index] - ((grain - 0.5) * 0.035);
      const shade = 0.9 + ((grain - 0.5) * 0.18) + (dimpleDepth * 0.48) - streakDarkness[index];
      const red = 32 * shade;
      const green = 40 * shade;
      const blue = 61 * shade;
      const rustMix = Math.min(rustValues[index], 0.22);
      const pixel = index * 4;
      diffuseData.data[pixel] = red + ((95 - red) * rustMix);
      diffuseData.data[pixel + 1] = green + ((55 - green) * rustMix);
      diffuseData.data[pixel + 2] = blue + ((39 - blue) * rustMix);
      diffuseData.data[pixel + 3] = 255;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size) + x;
      const left = height[(y * size) + Math.max(0, x - 1)];
      const right = height[(y * size) + Math.min(size - 1, x + 1)];
      const top = height[(Math.max(0, y - 1) * size) + x];
      const bottom = height[(Math.min(size - 1, y + 1) * size) + x];
      const normalX = (left - right) * 8;
      const normalY = (top - bottom) * 8;
      const normalLength = Math.hypot(normalX, normalY, 1);
      const pixel = index * 4;
      bumpData.data[pixel] = ((normalX / normalLength) * 0.5 + 0.5) * 255;
      bumpData.data[pixel + 1] = ((normalY / normalLength) * 0.5 + 0.5) * 255;
      bumpData.data[pixel + 2] = (1 / normalLength) * 255;
      bumpData.data[pixel + 3] = 255;
    }
  }
  diffuseContext.putImageData(diffuseData, 0, 0);
  bumpContext.putImageData(bumpData, 0, 0);
  diffuse.update();
  bump.update();
  bump.gammaSpace = false;
  const textures = { diffuse, bump };
  hammeredIronTexturesByScene.set(scene, textures);
  return textures;
}

function hammeredIronMaterial(scene) {
  if (hammeredIronMaterialsByScene.has(scene)) return hammeredIronMaterialsByScene.get(scene);
  if (window.__babylonMaterialsLoadFailed || typeof BABYLON.TriPlanarMaterial !== "function") {
    hammeredIronMaterialsByScene.set(scene, null);
    return null;
  }
  try {
    const { diffuse, bump } = createHammeredIronTextures(scene);
    const result = new BABYLON.TriPlanarMaterial("cauldron-hammered-iron", scene);
    result.diffuseColor = BABYLON.Color3.White();
    result.diffuseTextureX = diffuse;
    result.diffuseTextureY = diffuse;
    result.diffuseTextureZ = diffuse;
    result.normalTextureX = bump;
    result.normalTextureY = bump;
    result.normalTextureZ = bump;
    result.tileSize = 1.25;
    result.specularColor = colour3("#17213a");
    result.specularPower = 18;
    hammeredIronMaterialsByScene.set(scene, result);
    return result;
  } catch (error) {
    hammeredIronMaterialsByScene.set(scene, null);
    console.info(`[hero-assets] hammered iron material を使用できません: ${String(error?.message ?? error)}`);
    return null;
  }
}

function heroStandardMaterials(scene) {
  const cached = heroStandardMaterialsByScene.get(scene);
  if (cached) return cached;

  const materials = {
    wood: material("hero-wood", "#725040", scene),
    stone: material("hero-dark-stone", "#404854", scene),
    brass: material("hero-brass", "#c59b54", scene),
    glass: material("hero-blue-glass", "#1d5275", scene, "#0c203b"),
    ironFallback: material("hero-iron-fallback", "#20283d", scene, "#070a12"),
    leather: material("decor-dark-leather", "#2c2a3e", scene),
    plant: material("decor-desaturated-green", "#4a6b52", scene),
    wax: material("decor-wax-ivory", "#e8e0cc", scene),
    parchment: material("decor-parchment", "#d8c9a3", scene),
    ivy: material("decor-deep-ivy", "#39543f", scene),
    moonOrb: material("decor-moon-orb", "#dfe4f2", scene),
  };
  materials.glass.alpha = 0.85;
  materials.glass.backFaceCulling = false;
  materials.moonOrb.emissiveColor = colour3("#aab4d8").scale(0.12);
  heroStandardMaterialsByScene.set(scene, materials);
  return materials;
}

function heroMaterialForFamily(family, scene) {
  if (family === "iron") return hammeredIronMaterial(scene) ?? heroStandardMaterials(scene).ironFallback;
  return heroStandardMaterials(scene)[family] ?? null;
}

function ensureImportedNormals(mesh) {
  if (mesh.getTotalVertices?.() <= 0 || mesh.getVerticesData?.(BABYLON.VertexBuffer.NormalKind)) return;
  try {
    if (typeof mesh.createNormals === "function") {
      mesh.createNormals(true);
      return;
    }
    const positions = mesh.getVerticesData?.(BABYLON.VertexBuffer.PositionKind);
    const indices = mesh.getIndices?.();
    if (!positions || !indices || !BABYLON.VertexData?.ComputeNormals) return;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, true);
  } catch (error) {
    console.info(`[hero-assets] ${mesh.name} の法線を再計算できません: ${String(error?.message ?? error)}`);
  }
}

function labeledMaterial(name, label, colour, scene) {
  const result = material(`${name}-material`, colour, scene);
  const texture = new BABYLON.DynamicTexture(`${name}-label`, { width: 256, height: 96 }, scene, true);
  texture.hasAlpha = true;
  const context = texture.getContext();
  context.clearRect(0, 0, 256, 96);
  context.fillStyle = "rgba(14, 19, 42, .9)";
  context.fillRect(4, 4, 248, 88);
  context.font = "bold 30px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fffbea";
  context.fillText(label, 128, 48);
  texture.update();
  texture.uScale = -1;
  texture.uOffset = 1;
  result.diffuseTexture = texture;
  result.emissiveColor = colour3("#ffffff");
  result.emissiveTexture = texture;
  result.disableLighting = true;
  return result;
}

function particleTexture(name, scene) {
  try {
    const texture = new BABYLON.DynamicTexture(name, { width: 32, height: 32 }, scene, false);
    const context = texture.getContext();
    context.clearRect(0, 0, 32, 32);
    context.fillStyle = "white";
    context.beginPath();
    context.arc(16, 16, 12, 0, Math.PI * 2);
    context.fill();
    texture.hasAlpha = true;
    texture.update();
    return texture;
  } catch (error) {
    console.info(`[atmosphere] ${name} を作成できません: ${String(error?.message ?? error)}`);
    return null;
  }
}

function createSoftParticleSystem(name, capacity, scene) {
  if (typeof BABYLON.ParticleSystem !== "function") return null;
  const texture = particleTexture(`${name}-texture`, scene);
  if (!texture) return null;
  try {
    const system = new BABYLON.ParticleSystem(name, capacity, scene);
    system.particleTexture = texture;
    return system;
  } catch (error) {
    texture.dispose?.();
    console.info(`[atmosphere] ${name} を開始できません: ${String(error?.message ?? error)}`);
    return null;
  }
}

function createPaintedBackdrop(scene) {
  const existing = paintedBackdropsByScene.get(scene);
  if (existing) return existing;

  const backdrop = BABYLON.MeshBuilder.CreatePlane("painted-backdrop", {
    width: BACKDROP_WIDTH,
    height: BACKDROP_HEIGHT,
  }, scene);
  backdrop.position.set(0, 4.2, 5.2);
  backdrop.rotation.y = Math.PI;
  backdrop.isPickable = false;

  // emissive は「uniform色 + テクスチャ」の加算合成のため、テクスチャを唯一の光源にするには
  // emissiveColor を黒にする（明るい uniform を残すと全面がパステルに白化する）。
  const backdropMaterial = material("painted-backdrop-material", "#000000", scene, "#000000");
  backdropMaterial.disableLighting = true;
  backdropMaterial.backFaceCulling = false;
  let textureLoadFailed = false;
  const useFallbackWall = (error) => {
    textureLoadFailed = true;
    backdropMaterial.emissiveTexture = null;
    backdropMaterial.emissiveColor = colour3("#29324a");
    console.info(`[atmosphere] 背景テクスチャを使用できません: ${String(error?.message ?? error)}`);
  };
  try {
    const backdropTexture = new BABYLON.Texture(
      "assets/textures/backdrop.png",
      scene,
      false,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      undefined,
      useFallbackWall,
    );
    backdropTexture.level = 0.92;
    if (!textureLoadFailed) backdropMaterial.emissiveTexture = backdropTexture;
  } catch (error) {
    useFallbackWall(error);
  }
  backdrop.material = backdropMaterial;
  paintedBackdropsByScene.set(scene, backdrop);
  scene.onDisposeObservable.addOnce(() => paintedBackdropsByScene.delete(scene));
  return backdrop;
}

function createCandle(scene, name, position, candleMaterial, flameMaterial) {
  const body = BABYLON.MeshBuilder.CreateCylinder(`${name}-body`, { diameter: 0.18, height: 0.42, tessellation: 8 }, scene);
  body.position.copyFrom(position);
  body.position.y += 0.21;
  body.material = candleMaterial;
  body.isPickable = false;
  const flame = BABYLON.MeshBuilder.CreateCylinder(`${name}-flame`, {
    diameterTop: 0,
    diameterBottom: 0.15,
    height: 0.3,
    tessellation: 8,
  }, scene);
  flame.position.copyFrom(position);
  flame.position.y += 0.55;
  flame.material = flameMaterial;
  flame.isPickable = false;
  const light = new BABYLON.PointLight(`${name}-light`, flame.position.clone(), scene);
  light.diffuse = colour3("#ffbe72");
  light.intensity = 0.48;
  light.range = 3.2;
  return { flame, light, baseIntensity: 0.48 };
}

function addGlowMesh(glow, mesh) {
  if (!glow || !mesh) return;
  if (typeof glow.addIncludedOnlyMesh === "function") glow.addIncludedOnlyMesh(mesh);
  else glow.includedOnlyMeshes.push(mesh);
}

function createWorkshopAtmosphere(scene, {
  liquid,
  hearthFlame,
  lensRim,
  prefersReducedMotion,
}) {
  const existing = workshopAtmospheresByScene.get(scene);
  if (existing) return existing;

  let glow = null;
  try {
    if (typeof BABYLON.GlowLayer === "function") {
      glow = new BABYLON.GlowLayer("workshop-selective-glow", scene, { blurKernelSize: 32 });
      glow.intensity = 0.5;
      addGlowMesh(glow, liquid);
      addGlowMesh(glow, hearthFlame);
      addGlowMesh(glow, lensRim);
    }
  } catch (error) {
    glow?.dispose?.();
    glow = null;
    console.info(`[atmosphere] GlowLayer を使用できません: ${String(error?.message ?? error)}`);
  }

  const candleWax = material("candle-wax", "#f0d7a0", scene, "#3c2618");
  const candleFlameMaterial = material("candle-flame", "#ffc46c", scene, "#ff9d45");
  const candles = [
    createCandle(scene, "board-candle", new BABYLON.Vector3(-4.15, 0.58, 1.44), candleWax, candleFlameMaterial),
    createCandle(scene, "shelf-candle", new BABYLON.Vector3(4.1, 2.24, 3.72), candleWax, candleFlameMaterial),
  ];
  for (const candle of candles) addGlowMesh(glow, candle.flame);

  const steam = createSoftParticleSystem("cauldron-steam", PARTICLE_CAPACITY.steam, scene);
  if (steam) {
    steam.emitter = new BABYLON.Vector3(0, 1.63, 0.3);
    steam.minEmitBox = new BABYLON.Vector3(-0.46, 0, -0.46);
    steam.maxEmitBox = new BABYLON.Vector3(0.46, 0.06, 0.46);
    steam.color1 = new BABYLON.Color4(0.72, 0.83, 1, 0.2);
    steam.color2 = new BABYLON.Color4(0.48, 0.63, 0.9, 0.04);
    steam.minSize = 0.14;
    steam.maxSize = 0.3;
    steam.minLifeTime = 1.15;
    steam.maxLifeTime = 2.1;
    steam.direction1 = new BABYLON.Vector3(-0.08, 0.56, -0.08);
    steam.direction2 = new BABYLON.Vector3(0.08, 1.02, 0.08);
    steam.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    steam.start();
  }

  const dust = createSoftParticleSystem("moonlight-dust", PARTICLE_CAPACITY.dust, scene);
  if (dust) {
    dust.emitter = new BABYLON.Vector3(0, 3.8, 4.2);
    dust.minEmitBox = new BABYLON.Vector3(-1.25, -1.45, -0.18);
    dust.maxEmitBox = new BABYLON.Vector3(1.25, 1.1, 0.18);
    dust.color1 = new BABYLON.Color4(0.76, 0.86, 1, 0.22);
    dust.color2 = new BABYLON.Color4(0.48, 0.6, 0.9, 0.04);
    dust.minSize = 0.018;
    dust.maxSize = 0.045;
    dust.minLifeTime = 5;
    dust.maxLifeTime = 8;
    dust.direction1 = new BABYLON.Vector3(-0.035, -0.015, -0.025);
    dust.direction2 = new BABYLON.Vector3(0.035, 0.025, 0.025);
    dust.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    dust.emitRate = prefersReducedMotion ? 0 : 3;
    dust.start();
  }

  const effects = {
    addGlowMesh(mesh) {
      addGlowMesh(glow, mesh);
    },
    setTemperature(tempBand, simmerActive) {
      if (!steam) return;
      const rate = tempBand === "low" ? 3 : tempBand === "high" ? 18 : 9;
      steam.emitRate = rate * (simmerActive ? 1.2 : 1) * (prefersReducedMotion ? 0.35 : 1);
    },
    tick(clock) {
      // Pure clock-based sin sums keep candle flicker reproducible without per-frame allocations.
      for (let index = 0; index < candles.length; index += 1) {
        const candle = candles[index];
        const phase = index * 1.73;
        const flicker = 0.91 + (Math.sin((clock * 5.1) + phase) * 0.055)
          + (Math.sin((clock * 8.7) + (phase * 1.7)) * 0.035);
        candle.light.intensity = candle.baseIntensity * flicker;
        candle.flame.scaling.y = 0.94 + (flicker * 0.08);
      }
    },
  };
  workshopAtmospheresByScene.set(scene, effects);
  scene.onDisposeObservable.addOnce(() => workshopAtmospheresByScene.delete(scene));
  return effects;
}

function makeAction(mesh, action, actions) {
  mesh.isPickable = true;
  mesh.metadata = { action };
  actions.set(mesh.uniqueId, action);
  return mesh;
}

function assetUrlParts(assetPath) {
  const separator = assetPath.lastIndexOf("/");
  return {
    rootUrl: assetPath.slice(0, separator + 1),
    filename: assetPath.slice(separator + 1),
  };
}

function importedBounds(meshes) {
  const renderable = meshes.filter((mesh) => mesh.getTotalVertices?.() > 0);
  if (!renderable.length) throw new Error("GLB に描画可能な mesh がありません");
  const minimum = new BABYLON.Vector3(Infinity, Infinity, Infinity);
  const maximum = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of renderable) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    minimum.minimizeInPlace(box.minimumWorld);
    maximum.maximizeInPlace(box.maximumWorld);
  }
  const size = maximum.subtract(minimum);
  const diameter = Math.max(size.x, size.z);
  if (!Number.isFinite(diameter) || !Number.isFinite(size.y) || diameter <= 0.000001 || size.y <= 0.000001) {
    throw new Error("GLB の寸法を正規化できません");
  }
  return { centre: minimum.add(maximum).scale(0.5), diameter, height: size.y };
}

function importedRoots(meshes) {
  const roots = new Set();
  for (const mesh of meshes) {
    let root = mesh;
    while (root.parent) root = root.parent;
    roots.add(root);
  }
  return roots;
}

function importedMouthRadius(meshes, centre, minY) {
  let radius = 0;
  for (const mesh of meshes) {
    const positions = mesh.getVerticesData?.(BABYLON.VertexBuffer.PositionKind);
    if (!positions) continue;
    mesh.computeWorldMatrix(true);
    const matrix = mesh.getWorldMatrix();
    for (let i = 0; i < positions.length; i += 3) {
      const world = BABYLON.Vector3.TransformCoordinates(new BABYLON.Vector3(positions[i], positions[i + 1], positions[i + 2]), matrix);
      if (world.y > minY) radius = Math.max(radius, Math.hypot(world.x - centre.x, world.z - centre.z));
    }
  }
  return radius;
}

function logHeroFallback(name, reason) {
  const detail = String(reason?.message ?? reason).replace(/\s+/g, " ").slice(0, 180);
  console.info(`[hero-assets] ${name} は手続き生成を使用します: ${detail}`);
}

function copyTransform(target, source) {
  target.position.copyFrom(source.position);
  target.scaling.copyFrom(source.scaling);
  if (source.rotationQuaternion) target.rotationQuaternion = source.rotationQuaternion.clone();
  else {
    target.rotationQuaternion = null;
    target.rotation.copyFrom(source.rotation);
  }
}

function heroLayoutKey(name) {
  return `hero:${name}`;
}

function heroLayoutValues(anchor) {
  const baseScaling = anchor?.metadata?.heroBaseScaling;
  const baseY = anchor?.metadata?.heroBaseY;
  if (!baseScaling || !Number.isFinite(baseScaling.x) || !Number.isFinite(baseY) || baseScaling.x === 0) return null;
  return {
    scaleMul: BABYLON.Scalar.Clamp(anchor.scaling.x / baseScaling.x, HERO_LAYOUT_SCALE_LIMITS.min, HERO_LAYOUT_SCALE_LIMITS.max),
    yOffset: anchor.position.y - baseY,
  };
}

function applyHeroLayoutOverride(anchor, override = {}) {
  const baseScaling = anchor.metadata?.heroBaseScaling;
  const baseY = anchor.metadata?.heroBaseY;
  if (!baseScaling || !Number.isFinite(baseY)) return;
  const scaleMul = Number.isFinite(override.scaleMul)
    ? BABYLON.Scalar.Clamp(override.scaleMul, HERO_LAYOUT_SCALE_LIMITS.min, HERO_LAYOUT_SCALE_LIMITS.max)
    : 1;
  const yOffset = Number.isFinite(override.yOffset) ? override.yOffset : 0;
  anchor.scaling.copyFrom(baseScaling).scaleInPlace(scaleMul);
  anchor.position.y = BABYLON.Scalar.Clamp(baseY + yOffset, HERO_LAYOUT_HEIGHT_LIMITS.min, HERO_LAYOUT_HEIGHT_LIMITS.max);
}

function registerHeroLayoutAnchor(name, anchor, context) {
  const key = heroLayoutKey(name);
  anchor.scaling.scaleInPlace(HERO_VISUAL_SCALE[name] ?? 1);
  anchor.position.y += HERO_VISUAL_Y_OFFSET[name] ?? 0;
  anchor.metadata = {
    ...(anchor.metadata ?? {}),
    heroLayoutKey: key,
    heroBaseScaling: anchor.scaling.clone(),
    heroBaseY: anchor.position.y,
  };
  const anchors = context.heroLayoutAnchors.get(key) ?? [];
  anchors.push(anchor);
  context.heroLayoutAnchors.set(key, anchors);
  applyHeroLayoutOverride(anchor, context.layoutOverrides[key]);
}

function heroFallbackMeshes(config, context) {
  return config.hide.flatMap((name) => {
    if (name === "jar-*") return [...context.jars.values()];
    const mesh = context.fallbacks.get(name);
    return mesh ? [mesh] : [];
  });
}

function importedHasTexture(importedMaterial) {
  return Boolean(importedMaterial?.albedoTexture || importedMaterial?.diffuseTexture || importedMaterial?.baseTexture);
}

function applyHeroMaterial(meshes, family, scene) {
  const replacement = heroMaterialForFamily(family, scene);
  if (!replacement) return;
  for (const mesh of meshes) {
    if (importedHasTexture(mesh.material)) continue;
    ensureImportedNormals(mesh);
    mesh.material = replacement;
  }
}

function registerHeroAction(meshes, action, actions) {
  if (!action) return;
  for (const mesh of meshes) makeAction(mesh, action, actions);
}

function descendantMeshes(node) {
  return node.getChildMeshes?.(false) ?? [];
}

function prepareJarHeroClones(name, prototypeAnchor, context) {
  const clones = [];
  const createdRoots = [];
  try {
    for (const [materialId, fallback] of context.jars) {
      const clone = prototypeAnchor.clone(`jar-${materialId}-hero-anchor`, null);
      if (!clone) throw new Error(`${materialId} 用の jar hero clone を作成できません`);
      createdRoots.push(clone);
      copyTransform(clone, fallback);
      const action = fallback.metadata?.action;
      const home = fallback.metadata?.home?.clone?.() ?? fallback.position.clone();
      clone.metadata = { action, home };
      registerHeroLayoutAnchor(name, clone, context);
      const meshes = descendantMeshes(clone);
      if (!meshes.length) throw new Error(`${materialId} 用の jar hero mesh がありません`);
      registerHeroAction(meshes, action, context.actions);
      const ingredient = context.ingredientsById.get(materialId);
      if (ingredient) {
        const label = createLabelPlane(`jar-${materialId}-hero-label`, ingredient.name, BABYLON.Vector3.Zero(), context.scene);
        label.parent = clone;
        label.position = new BABYLON.Vector3(0, 0.66, -0.34);
      }
      clones.push({ materialId, fallback, clone });
    }
  } catch (error) {
    for (const clone of createdRoots) {
      for (const mesh of descendantMeshes(clone)) context.actions.delete(mesh.uniqueId);
      clone.dispose();
    }
    throw error;
  }
  return clones;
}

function fitCauldronLiquid(meshes, context) {
  const liquid = context.scene.getMeshByName("cauldron-liquid");
  if (!liquid) return;
  const mouthRadius = importedMouthRadius(meshes, context.cauldron.position, 1.45);
  if (mouthRadius <= 0.2) return;
  const fit = BABYLON.Scalar.Clamp((mouthRadius * 0.88) / 0.83, 0.35, 1);
  liquid.scaling.x = fit;
  liquid.scaling.y = fit;
  liquid.metadata = { ...(liquid.metadata ?? {}), baseY: 1.52 };
}

async function loadHeroProp(name, config, context) {
  const { scene, actions } = context;
  if (window.__babylonLoaderLoadFailed || !BABYLON.SceneLoader?.ImportMeshAsync) {
    logHeroFallback(name, "glTF loader CDN を読み込めませんでした");
    return;
  }
  let sceneDisposed = false;
  scene.onDisposeObservable.addOnce(() => { sceneDisposed = true; });
  let meshes = [];
  let heroAnchor = null;
  try {
    const fallbacks = heroFallbackMeshes(config, context);
    const anchorSource = config.anchor === "jar" ? fallbacks[0] : context.fallbacks.get(config.anchor);
    if (!anchorSource) throw new Error("手続き生成アンカーがありません");

    const { rootUrl, filename } = assetUrlParts(config.path);
    const result = await BABYLON.SceneLoader.ImportMeshAsync("", rootUrl, filename, scene);
    meshes = result.meshes;
    if (sceneDisposed) return;
    if (context.layoutMode) {
      for (const mesh of meshes) mesh.isPickable = true;
    }

    const bounds = importedBounds(meshes);
    const rawScale = Math.min(config.size.diameter / bounds.diameter, config.size.height / bounds.height);
    const scale = BABYLON.Scalar.Clamp(rawScale, HERO_SCALE_LIMITS.min, HERO_SCALE_LIMITS.max);
    heroAnchor = new BABYLON.TransformNode(`${name}-hero-anchor`, scene);
    copyTransform(heroAnchor, anchorSource);
    const modelRoot = new BABYLON.TransformNode(`${name}-hero-model`, scene);
    modelRoot.parent = heroAnchor;
    modelRoot.scaling.setAll(scale);
    modelRoot.position.copyFrom(bounds.centre.scale(-scale));
    for (const root of importedRoots(meshes)) root.parent = modelRoot;

    const action = config.action === "jar" ? fallbacks[0]?.metadata?.action : context.actionByName.get(config.action);
    registerHeroAction(meshes, action, actions);
    applyHeroMaterial(meshes, config.family, scene);

    if (config.special?.clonePerMaterial) {
      const clones = prepareJarHeroClones(name, heroAnchor, context);
      heroAnchor.setEnabled(false);
      for (const { materialId, fallback, clone } of clones) {
        context.jars.set(materialId, clone);
        fallback.setEnabled(false);
      }
    } else {
      context.heroMeshes.set(name, meshes);
      // Visual scale is a parent-layer multiplier after fit normalisation.
      // The cauldron fit below therefore measures the final rendered mouth.
      registerHeroLayoutAnchor(name, heroAnchor, context);
      if (config.special?.liquidMouthFit) fitCauldronLiquid(meshes, context);
      for (const fallback of fallbacks) fallback.setEnabled(false);
      context.heroAnchors.set(name, heroAnchor);
    }
  } catch (error) {
    for (const mesh of meshes) {
      mesh.setEnabled?.(false);
      actions.delete(mesh.uniqueId);
    }
    heroAnchor?.setEnabled(false);
    logHeroFallback(name, error);
  }
}

function loadHeroAssets(context) {
  const { scene } = context;
  if (heroAssetLoadScenes.has(scene)) return;
  heroAssetLoadScenes.add(scene);
  for (const [name, config] of Object.entries(HERO_ASSETS)) void loadHeroProp(name, config, context);
}

function logDressingFallback(name, reason) {
  const detail = String(reason?.message ?? reason).replace(/\s+/g, " ").slice(0, 180);
  console.info(`[dressing-assets] ${name} は表示しません: ${detail}`);
}

function dressingPlacements(config) {
  return config.placements ?? [config];
}

function dressingKey(name, index) {
  return index === 0 ? name : `${name}-${index + 1}`;
}

function placeDressingAnchor(anchor, placement, key, context) {
  const { position } = placement;
  anchor.position.set(position.x, position.y, position.z);
  anchor.rotationQuaternion = null;
  anchor.rotation.x = placement.rotationX ?? 0;
  anchor.rotation.y = placement.rotationY ?? 0;
  anchor.rotation.z = placement.rotationZ ?? 0;
  anchor.scaling.setAll(1);
  const override = context.layoutOverrides[key];
  if (override) {
    if (typeof override.x === "number") anchor.position.x = override.x;
    if (typeof override.y === "number") anchor.position.y = override.y;
    if (typeof override.z === "number") anchor.position.z = override.z;
    if (typeof override.rotY === "number") anchor.rotation.y = override.rotY;
    if (typeof override.rotX === "number") anchor.rotation.x = override.rotX;
    if (typeof override.rotZ === "number") anchor.rotation.z = override.rotZ;
    if (typeof override.scaleMul === "number") anchor.scaling.setAll(override.scaleMul);
  }
  anchor.metadata = { ...(anchor.metadata ?? {}), dressingKey: key };
  context.dressingAnchors.set(key, { anchor, placement });
}

function hideProceduralDressing(config, scene) {
  for (const name of config.flags?.hideProcedural ?? []) scene.getMeshByName(name)?.setEnabled(false);
}

async function loadDressingProp(name, config, context) {
  const { scene, addGlowMesh: includeGlowMesh } = context;
  if (window.__babylonLoaderLoadFailed || !BABYLON.SceneLoader?.ImportMeshAsync) {
    logDressingFallback(name, "glTF loader CDN を読み込めませんでした");
    return;
  }
  let sceneDisposed = false;
  scene.onDisposeObservable.addOnce(() => { sceneDisposed = true; });
  let meshes = [];
  const anchors = [];
  try {
    const { rootUrl, filename } = assetUrlParts(config.path);
    const result = await BABYLON.SceneLoader.ImportMeshAsync("", rootUrl, filename, scene);
    meshes = result.meshes;
    if (sceneDisposed) return;

    const bounds = importedBounds(meshes);
    const rawScale = Math.min(config.size.diameter / bounds.diameter, config.size.height / bounds.height);
    const scale = BABYLON.Scalar.Clamp(rawScale, HERO_SCALE_LIMITS.min, HERO_SCALE_LIMITS.max);
    const horizontalScale = config.fit === "flat"
      ? BABYLON.Scalar.Clamp(config.size.diameter / bounds.diameter, HERO_SCALE_LIMITS.min, HERO_SCALE_LIMITS.max)
      : scale;
    const verticalScale = config.fit === "flat"
      ? BABYLON.Scalar.Clamp(config.size.height / bounds.height, HERO_SCALE_LIMITS.min, HERO_SCALE_LIMITS.max)
      : scale;
    const placements = dressingPlacements(config);
    const anchor = new BABYLON.TransformNode(`${name}-dressing-anchor`, scene);
    placeDressingAnchor(anchor, placements[0], dressingKey(name, 0), context);
    anchors.push(anchor);
    const modelRoot = new BABYLON.TransformNode(`${name}-dressing-model`, scene);
    modelRoot.parent = anchor;
    modelRoot.scaling.set(horizontalScale, verticalScale, horizontalScale);
    modelRoot.position.set(
      -bounds.centre.x * horizontalScale,
      -bounds.centre.y * verticalScale,
      -bounds.centre.z * horizontalScale,
    );
    for (const root of importedRoots(meshes)) root.parent = modelRoot;
    for (const mesh of meshes) mesh.isPickable = Boolean(context.layoutMode);
    applyHeroMaterial(meshes, config.family, scene);

    for (const [index, placement] of placements.slice(1).entries()) {
      const clone = anchor.clone(`${name}-dressing-anchor-${index + 1}`, null);
      if (!clone) throw new Error("装飾用 GLB を複製できません");
      placeDressingAnchor(clone, placement, dressingKey(name, index + 1), context);
      anchors.push(clone);
    }

    if (config.flags?.includeGlow) {
      for (const mesh of meshes) {
        if (mesh.getTotalVertices?.() > 0) includeGlowMesh?.(mesh);
      }
    }
    hideProceduralDressing(config, scene);
  } catch (error) {
    for (const mesh of meshes) mesh.setEnabled?.(false);
    for (const anchor of anchors) anchor.setEnabled(false);
    logDressingFallback(name, error);
  }
}

function loadDressingAssets(context) {
  const { scene } = context;
  if (dressingAssetLoadScenes.has(scene)) return;
  dressingAssetLoadScenes.add(scene);
  for (const [name, config] of Object.entries(DRESSING_ASSETS)) void loadDressingProp(name, config, context);
}

function createLabelPlane(name, text, position, scene) {
  const plane = BABYLON.MeshBuilder.CreatePlane(name, { width: 1.25, height: 0.45 }, scene);
  plane.position.copyFrom(position);
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  const texture = new BABYLON.DynamicTexture(`${name}-texture`, { width: 256, height: 92 }, scene, true);
  texture.hasAlpha = true;
  const context = texture.getContext();
  context.clearRect(0, 0, 256, 92);
  context.fillStyle = "rgba(11, 18, 43, .82)";
  context.fillRect(0, 0, 256, 92);
  context.fillStyle = "#f5eedf";
  context.font = "28px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 46);
  texture.update();
  const labelMaterial = new BABYLON.StandardMaterial(`${name}-label-material`, scene);
  labelMaterial.diffuseTexture = texture;
  labelMaterial.opacityTexture = texture;
  labelMaterial.emissiveColor = BABYLON.Color3.White();
  labelMaterial.emissiveTexture = texture;
  labelMaterial.disableLighting = true;
  plane.material = labelMaterial;
  plane.isPickable = false;
  return plane;
}

function dominantEffect(items) {
  const counts = new Map();
  for (const item of items) {
    if (item?.mainEffect) counts.set(item.mainEffect, (counts.get(item.mainEffect) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "none";
}

/** Builds the complete low-poly workshop and exposes only scene-facing controls. */
export function createWorkshopScene(engine, canvas, materials, { layoutMode = false } = {}) {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = BABYLON.Color4.FromHexString("#081124ff");
  scene.ambientColor = colour3("#172b4b");

  const camera = new BABYLON.UniversalCamera("workshop-camera", new BABYLON.Vector3(0, 2.75, -8.2), scene);
  camera.minZ = 0.1;
  camera.fov = 0.82;
  camera.inputs.clear();
  const baseCamera = { position: camera.position.clone(), rotation: new BABYLON.Vector3(-0.11, 0, 0) };
  camera.rotation.copyFrom(baseCamera.rotation);

  const moon = new BABYLON.DirectionalLight("moonlight", new BABYLON.Vector3(-0.45, -1, 0.3), scene);
  moon.position = new BABYLON.Vector3(2, 8, -4);
  moon.diffuse = colour3("#809eff");
  moon.intensity = 0.82;
  const hearth = new BABYLON.PointLight("hearth", new BABYLON.Vector3(0, 1.2, 0.25), scene);
  hearth.diffuse = colour3(TEMP_COLOURS.mid);
  hearth.intensity = 2.1;
  hearth.range = 8;
  const fill = new BABYLON.HemisphericLight("night-fill", new BABYLON.Vector3(0, 1, 0), scene);
  fill.diffuse = colour3("#49658c");
  fill.groundColor = colour3("#101226");
  fill.intensity = 0.46;
  const warmFill = new BABYLON.PointLight("warm-room-fill", new BABYLON.Vector3(-2.8, 3.1, 1.4), scene);
  warmFill.diffuse = colour3("#c7804c");
  warmFill.intensity = 0.3;
  warmFill.range = 8;

  const actions = new Map();
  const heroAnchors = new Map();
  const heroLayoutAnchors = new Map();
  const heroMeshes = new Map();
  const layoutOverrides = getLayoutOverrides();
  const wood = material("wood", "#47322d", scene);
  const woodLight = material("wood-light", "#725040", scene);
  const iron = material("iron", "#20283d", scene, "#070a12");
  const brass = material("brass", "#c59b54", scene);
  const stone = material("stone", "#5e6375", scene);
  const glass = material("glass", "#7ea4c2", scene, "#172a45");
  glass.alpha = 0.75;

  createPaintedBackdrop(scene);

  const table = BABYLON.MeshBuilder.CreateBox("table", { width: 9.6, depth: 5.9, height: 0.45 }, scene);
  table.position = new BABYLON.Vector3(0, 0.35, 1.1);
  table.material = wood;
  table.isPickable = false;
  for (const x of [-4.1, 4.1]) {
    for (const z of [-1.2, 3.25]) {
      const leg = BABYLON.MeshBuilder.CreateBox(`table-leg-${x}-${z}`, { width: 0.34, depth: 0.34, height: 2.2 }, scene);
      leg.position = new BABYLON.Vector3(x, -0.8, z);
      leg.material = woodLight;
      leg.isPickable = false;
    }
  }

  const cauldronAction = { kind: "cauldron", label: "釜：円を描いて混ぜる", focus: new BABYLON.Vector3(0, 1.3, 0.2) };
  const cauldron = makeAction(
    BABYLON.MeshBuilder.CreateCylinder("cauldron", { diameterTop: 2.05, diameterBottom: 1.52, height: 1.15, tessellation: 16 }, scene),
    cauldronAction, actions,
  );
  cauldron.position = new BABYLON.Vector3(0, 1.02, 0.3);
  cauldron.material = iron;
  const rim = BABYLON.MeshBuilder.CreateTorus("cauldron-rim", { diameter: 2.05, thickness: 0.15, tessellation: 16 }, scene);
  rim.position.y = 1.59;
  rim.position.z = 0.3;
  const rimMaterial = material("cauldron-rim", "#c59b54", scene);
  rim.material = rimMaterial;
  rim.isPickable = false;
  const liquid = BABYLON.MeshBuilder.CreateDisc("cauldron-liquid", { radius: 0.83, tessellation: 32 }, scene);
  liquid.rotation.x = Math.PI / 2;
  liquid.position = new BABYLON.Vector3(0, 1.59, 0.3);
  const liquidMaterial = material("liquid", EFFECT_COLOURS.none, scene, "#203049");
  liquidMaterial.alpha = 0.9;
  liquid.material = liquidMaterial;
  liquid.isPickable = false;
  // The original flame sat inside the pot silhouette from the fixed camera.
  // Keep the hearth light at the pot, but move its interactive flame in front.
  const flame = makeAction(
    BABYLON.MeshBuilder.CreateCylinder("hearth-flame", { diameterTop: 0.25, diameterBottom: 0.9, height: 0.9, tessellation: 8 }, scene),
    { kind: "flame", label: "煮込み：押し続ける", focus: new BABYLON.Vector3(0, 0.78, -0.88) }, actions,
  );
  flame.position = new BABYLON.Vector3(0, 0.78, -0.88);
  const flameMaterial = material("flame", TEMP_COLOURS.mid, scene, TEMP_COLOURS.mid);
  flame.material = flameMaterial;

  const board = makeAction(
    BABYLON.MeshBuilder.CreateBox("cutting-board", { width: 1.9, depth: 1.45, height: 0.18 }, scene),
    { kind: "board", label: "まな板：短く往復して切る", focus: new BABYLON.Vector3(-2.35, 0.95, 0.65) }, actions,
  );
  board.position = new BABYLON.Vector3(-2.45, 0.72, 0.72);
  board.material = woodLight;
  const knife = BABYLON.MeshBuilder.CreateBox("knife", { width: 1.15, depth: 0.12, height: 0.07 }, scene);
  knife.position = new BABYLON.Vector3(-2.45, 0.88, 0.72);
  knife.rotation.y = -0.45;
  knife.material = brass;
  knife.isPickable = false;

  const mortar = makeAction(
    BABYLON.MeshBuilder.CreateCylinder("mortar", { diameterTop: 1.35, diameterBottom: 1.0, height: 0.55, tessellation: 12 }, scene),
    { kind: "mortar", label: "乳鉢：円を描いて潰す", focus: new BABYLON.Vector3(2.3, 1.05, 0.7) }, actions,
  );
  mortar.position = new BABYLON.Vector3(2.35, 0.92, 0.72);
  mortar.material = stone;
  const pestle = BABYLON.MeshBuilder.CreateCylinder("pestle", { diameter: 0.22, height: 0.9, tessellation: 10 }, scene);
  pestle.position = new BABYLON.Vector3(2.35, 1.38, 0.72);
  pestle.rotation.z = 0.4;
  pestle.material = stone;
  pestle.isPickable = false;

  const dial = makeAction(
    BABYLON.MeshBuilder.CreateCylinder("heat-dial", { diameter: 0.88, height: 0.17, tessellation: 18 }, scene),
    { kind: "dial", label: "火加減：回して温度を選ぶ", focus: new BABYLON.Vector3(-3.55, 0.98, 1.9) }, actions,
  );
  dial.position = new BABYLON.Vector3(-3.55, 0.78, 1.9);
  dial.material = brass;
  const dialNotch = BABYLON.MeshBuilder.CreateBox("dial-notch", { width: 0.12, depth: 0.34, height: 0.08 }, scene);
  dialNotch.parent = dial;
  dialNotch.position = new BABYLON.Vector3(0, 0.12, 0.26);
  dialNotch.material = iron;
  dialNotch.isPickable = false;

  const lens = makeAction(
    BABYLON.MeshBuilder.CreateTorus("appraisal-lens", { diameter: 0.95, thickness: 0.11, tessellation: 18 }, scene),
    { kind: "lens", label: "鑑定レンズ：結果を見る", focus: new BABYLON.Vector3(3.35, 1.02, 1.85) }, actions,
  );
  lens.position = new BABYLON.Vector3(3.35, 0.82, 1.85);
  lens.rotation.x = Math.PI / 2;
  lens.material = glass;
  // This thin, independent rim remains visible when the hero GLB replaces the
  // procedural lens, preserving the appraisal station's readable glow accent.
  const lensGlowRim = BABYLON.MeshBuilder.CreateTorus("appraisal-lens-glow-rim", { diameter: 1.01, thickness: 0.035, tessellation: 18 }, scene);
  lensGlowRim.position.copyFrom(lens.position);
  lensGlowRim.rotation.copyFrom(lens.rotation);
  lensGlowRim.material = material("appraisal-lens-glow-material", "#79b8de", scene, "#4d9fd8");
  lensGlowRim.isPickable = false;
  const lensHandle = BABYLON.MeshBuilder.CreateCylinder("lens-handle", { diameter: 0.13, height: 0.75, tessellation: 8 }, scene);
  lensHandle.position = new BABYLON.Vector3(3.75, 0.75, 2.23);
  lensHandle.rotation.z = -0.75;
  lensHandle.material = brass;
  lensHandle.isPickable = false;

  const tray = makeAction(
    BABYLON.MeshBuilder.CreateCylinder("delivery-tray", { diameter: 1.25, height: 0.13, tessellation: 18 }, scene),
    { kind: "tray", label: "納品トレイ", focus: new BABYLON.Vector3(3.6, 1.0, -0.5) }, actions,
  );
  tray.position = new BABYLON.Vector3(3.6, 0.72, -0.5);
  tray.material = brass;
  createLabelPlane("tray-label", "納品", new BABYLON.Vector3(3.6, 1.14, -0.3), scene);

  const shelf = BABYLON.MeshBuilder.CreateBox("jar-shelf", { width: 8.8, height: 0.18, depth: 0.58 }, scene);
  shelf.position = new BABYLON.Vector3(0, 2.15, 4.12);
  shelf.material = woodLight;
  shelf.isPickable = false;
  const jars = new Map();
  materials.forEach((ingredient, index) => {
    const x = -3.5 + index;
    const jar = makeAction(
      BABYLON.MeshBuilder.CreateCylinder(`jar-${ingredient.id}`, { diameter: 0.55, height: 0.95, tessellation: 10 }, scene),
      { kind: "jar", materialId: ingredient.id, label: ingredient.name, focus: new BABYLON.Vector3(x, 2.55, 3.65) }, actions,
    );
    jar.position = new BABYLON.Vector3(x, 2.7, 3.85);
    jar.material = labeledMaterial(`jar-${ingredient.id}`, ingredient.name, EFFECT_COLOURS[ingredient.mainEffect] ?? "#a5b1c7", scene);
    jar.metadata.home = jar.position.clone();
    jars.set(ingredient.id, jar);
  });

  // Begin all independent imports only after every procedural fallback exists.
  // The hidden fallbacks retain their positions for nearestStation and for a
  // late-arriving jar clone to inherit the transform of an in-progress drag.
  const fallbackMeshes = new Map([
    ["cauldron", cauldron],
    ["cauldron-rim", rim],
    ["cutting-board", board],
    ["knife", knife],
    ["mortar", mortar],
    ["pestle", pestle],
    ["heat-dial", dial],
    ["dial-notch", dialNotch],
    ["appraisal-lens", lens],
    ["lens-handle", lensHandle],
    ["delivery-tray", tray],
  ]);
  const actionByName = new Map([
    ["cauldron", cauldronAction],
    ["board", board.metadata.action],
    ["mortar", mortar.metadata.action],
    ["dial", dial.metadata.action],
    ["lens", lens.metadata.action],
    ["tray", tray.metadata.action],
  ]);
  loadHeroAssets({
    scene,
    actions,
    actionByName,
    fallbacks: fallbackMeshes,
    jars,
    ingredientsById: new Map(materials.map((ingredient) => [ingredient.id, ingredient])),
    cauldron,
    heroAnchors,
    heroLayoutAnchors,
    heroMeshes,
    layoutOverrides,
    layoutMode,
  });

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const highlight = new BABYLON.HighlightLayer("hover-highlight", scene, { blurHorizontalSize: 0.35, blurVerticalSize: 0.35 });
  highlight.outerGlow = false;
  highlight.innerGlow = true;
  const atmosphere = createWorkshopAtmosphere(scene, {
    liquid,
    hearthFlame: flame,
    lensRim: lensGlowRim,
    prefersReducedMotion,
  });
  const dressingAnchors = new Map();
  loadDressingAssets({
    scene,
    addGlowMesh: atmosphere.addGlowMesh,
    dressingAnchors,
    layoutMode,
    layoutOverrides,
  });
  let highlighted = [];
  let liquidStability = 70;
  let liquidOvermixed = false;
  let currentTemp = "mid";
  let baseBubbleRate = 12;
  let simmerActive = false;
  let simmerInWindow = false;
  let liquidClock = 0;
  let focusTarget = null;
  let focusOrigin = null;
  let focusProgress = 0;
  const rimGlowColour = colour3("#f6d987");
  const black = BABYLON.Color3.Black();

  const bubble = createSoftParticleSystem("cauldron-bubbles", PARTICLE_CAPACITY.bubbles, scene);
  if (bubble) {
    bubble.emitter = new BABYLON.Vector3(0, 1.59, 0.3);
    bubble.minEmitBox = new BABYLON.Vector3(-0.65, 0, -0.65);
    bubble.maxEmitBox = new BABYLON.Vector3(0.65, 0.05, 0.65);
    bubble.color1 = new BABYLON.Color4(0.92, 0.96, 1, 0.65);
    bubble.color2 = new BABYLON.Color4(0.6, 0.78, 1, 0.35);
    bubble.minSize = 0.025;
    bubble.maxSize = 0.085;
    bubble.minLifeTime = 0.45;
    bubble.maxLifeTime = 0.9;
    bubble.direction1 = new BABYLON.Vector3(-0.1, 0.7, -0.1);
    bubble.direction2 = new BABYLON.Vector3(0.1, 1.25, 0.1);
    bubble.emitRate = 12;
    bubble.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
    bubble.start();
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    liquidClock += dt;
    // Lower stability makes the disc visibly less calm; overmixing adds a small haze pulse.
    const waveAmplitude = 0.006 + (100 - liquidStability) * 0.00032 + (liquidOvermixed ? 0.018 : 0);
    liquid.position.y = (liquid.metadata?.baseY ?? 1.59) + Math.sin(liquidClock * 3.2) * waveAmplitude;
    liquid.rotation.z = Math.sin(liquidClock * 1.7) * waveAmplitude * 4;
    atmosphere.tick(liquidClock);
    if (simmerActive && simmerInWindow && !prefersReducedMotion) {
      rimGlowColour.scaleToRef(0.62 + Math.sin(liquidClock * 10) * 0.22, rimMaterial.emissiveColor);
    }
    if (focusTarget) {
      focusProgress = Math.min(1, focusProgress + dt * (prefersReducedMotion ? 9 : 4.8));
      const eased = prefersReducedMotion ? 1 : 1 - ((1 - focusProgress) ** 3);
      BABYLON.Vector3.LerpToRef(focusOrigin.position, focusTarget.position, eased, camera.position);
      camera.rotation.x = BABYLON.Scalar.Lerp(focusOrigin.rotation.x, focusTarget.rotation.x, eased);
      if (focusProgress === 1) {
        if (prefersReducedMotion) canvas.style.opacity = "1";
        // Leave camera rotation available to manual pointer-look once a focus tween settles.
        focusTarget = null;
      }
    }
  });

  function setTemperature(tempBand) {
    currentTemp = tempBand;
    const colour = TEMP_COLOURS[tempBand] ?? TEMP_COLOURS.mid;
    hearth.diffuse = colour3(colour);
    hearth.intensity = tempBand === "low" ? 1.3 : tempBand === "high" ? 3.1 : 2.1;
    flameMaterial.diffuseColor = colour3(colour);
    flameMaterial.emissiveColor = colour3(colour);
    baseBubbleRate = tempBand === "low" ? 3 : tempBand === "high" ? 30 : 12;
    if (!simmerActive && bubble) bubble.emitRate = baseBubbleRate;
    atmosphere.setTemperature(tempBand, simmerActive);
  }

  function setLiquidState({ items = [], result = null, tempBand = currentTemp, stirLaps = 0 } = {}) {
    const effect = result
      ? Object.entries(result.effects).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "none"
      : dominantEffect(items);
    liquidStability = result?.stability ?? 70;
    liquidOvermixed = stirLaps > 6;
    liquidMaterial.diffuseColor = colour3(EFFECT_COLOURS[effect] ?? EFFECT_COLOURS.none);
    liquidMaterial.emissiveColor = colour3(EFFECT_COLOURS[effect] ?? EFFECT_COLOURS.none).scale(0.22 + (liquidOvermixed ? 0.08 : 0));
    setTemperature(tempBand);
  }

  function playPourBurst() {
    const burst = createSoftParticleSystem(`pour-burst-${performance.now()}`, PARTICLE_CAPACITY.pourBurst, scene);
    if (!burst) return;
    burst.emitter = new BABYLON.Vector3(0, 1.72, 0.3);
    burst.minEmitBox = BABYLON.Vector3.Zero();
    burst.maxEmitBox = BABYLON.Vector3.Zero();
    burst.color1 = new BABYLON.Color4(0.86, 0.9, 1, 0.95);
    burst.color2 = new BABYLON.Color4(0.45, 0.7, 1, 0.2);
    burst.minSize = 0.04;
    burst.maxSize = 0.12;
    burst.minLifeTime = 0.25;
    burst.maxLifeTime = 0.55;
    burst.direction1 = new BABYLON.Vector3(-0.6, 0.2, -0.6);
    burst.direction2 = new BABYLON.Vector3(0.6, 1.1, 0.6);
    burst.manualEmitCount = 28;
    burst.targetStopDuration = 0.04;
    burst.start();
    window.setTimeout(() => burst.dispose(), 850);
  }

  function setJarPouring(materialId, pouring) {
    const jar = jars.get(materialId);
    if (!jar) return;
    jar.rotation.z = pouring ? -0.78 : 0;
  }

  function setSimmerState({ active = false, elapsed = 0, targetSeconds = 0, perfectWindow = 0 } = {}) {
    simmerActive = active;
    simmerInWindow = active && Math.abs(elapsed - targetSeconds) <= perfectWindow;
    atmosphere.setTemperature(currentTemp, active);
    if (!active) {
      if (bubble) bubble.emitRate = baseBubbleRate;
      rimMaterial.emissiveColor.copyFrom(black);
      return;
    }
    const approach = targetSeconds > 0 ? BABYLON.Scalar.Clamp(elapsed / targetSeconds, 0, 1) : 1;
    if (bubble) bubble.emitRate = baseBubbleRate + 9 + approach * 48;
    if (simmerInWindow) rimGlowColour.scaleToRef(0.8, rimMaterial.emissiveColor);
    else rimMaterial.emissiveColor.copyFrom(black);
  }

  function actionForMesh(mesh) {
    let current = mesh;
    while (current) {
      const action = actions.get(current.uniqueId);
      if (action) return action;
      current = current.parent;
    }
    return null;
  }

  function worldFromPointerAtHeight(clientX, clientY, height) {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.createPickingRay(clientX - rect.left, clientY - rect.top, BABYLON.Matrix.Identity(), camera);
    const plane = new BABYLON.Plane(0, 1, 0, -height);
    const distance = ray.intersectsPlane(plane);
    return distance === null ? null : ray.origin.add(ray.direction.scale(distance));
  }

  function worldFromPointer(clientX, clientY) {
    return worldFromPointerAtHeight(clientX, clientY, 0.96);
  }

  function nearestStation(world) {
    if (!world) return null;
    const stations = [
      { kind: "cauldron", position: cauldron.position, radius: 1.2 },
      { kind: "board", position: board.position, radius: 1.12 },
      { kind: "mortar", position: mortar.position, radius: 1.02 },
    ];
    return stations.find((station) => BABYLON.Vector3.DistanceSquared(world, station.position) <= station.radius ** 2) ?? null;
  }

  function moveJar(materialId, world) {
    const jar = jars.get(materialId);
    if (!jar || !world) return;
    jar.position.x = world.x;
    jar.position.z = world.z;
    jar.position.y = 1.3;
  }

  function resetJar(materialId) {
    const jar = jars.get(materialId);
    if (!jar) return;
    jar.position.copyFrom(jar.metadata.home);
    jar.rotation.z = 0;
  }

  function snapJar(materialId, stationKind) {
    const jar = jars.get(materialId);
    if (!jar) return;
    const target = stationKind === "cauldron" ? new BABYLON.Vector3(0, 2.08, 0.3)
      : stationKind === "board" ? new BABYLON.Vector3(-2.45, 1.18, 0.72)
        : stationKind === "mortar" ? new BABYLON.Vector3(2.35, 1.45, 0.72) : null;
    if (target) jar.position.copyFrom(target);
  }

  function setHighlight(meshOrMeshes) {
    const next = (Array.isArray(meshOrMeshes) ? meshOrMeshes : [meshOrMeshes]).filter(Boolean);
    if (highlighted.length === next.length && highlighted.every((mesh, index) => mesh === next[index])) return;
    for (const mesh of highlighted) highlight.removeMesh(mesh);
    highlighted = next;
    for (const mesh of highlighted) highlight.addMesh(mesh, colour3("#f6d987"));
  }

  function getLayoutAnchor(mesh) {
    let current = mesh;
    while (current) {
      const dressingKey = current.metadata?.dressingKey;
      if (dressingKey) return dressingAnchors.get(dressingKey)?.anchor ?? null;
      if (current.metadata?.heroLayoutKey) return current;
      current = current.parent;
    }
    return null;
  }

  function getLayoutKey(anchor) {
    return anchor?.metadata?.dressingKey ?? anchor?.metadata?.heroLayoutKey ?? null;
  }

  function isHeroLayoutAnchor(anchor) {
    return Boolean(anchor?.metadata?.heroLayoutKey);
  }

  function applyHeroLayoutGroup(key, override) {
    const anchors = heroLayoutAnchors.get(key);
    if (!anchors?.length) return null;
    for (const anchor of anchors) applyHeroLayoutOverride(anchor, override);
    if (key === heroLayoutKey("cauldron")) {
      const meshes = heroMeshes.get("cauldron");
      if (meshes) fitCauldronLiquid(meshes, { scene, cauldron });
    }
    return heroLayoutValues(anchors[0]);
  }

  function getHeroLayoutOverride(key) {
    return heroLayoutValues(heroLayoutAnchors.get(key)?.[0]);
  }

  function setHeroLayoutOverride(key, partial = {}) {
    const current = getHeroLayoutOverride(key);
    if (!current) return null;
    return applyHeroLayoutGroup(key, {
      scaleMul: Number.isFinite(partial.scaleMul) ? partial.scaleMul : current.scaleMul,
      yOffset: Number.isFinite(partial.yOffset) ? partial.yOffset : current.yOffset,
    });
  }

  function resetDressingAnchor(key) {
    const entry = dressingAnchors.get(key);
    if (!entry) return;
    placeDressingAnchor(entry.anchor, entry.placement, key, { dressingAnchors, layoutOverrides: getLayoutOverrides() });
  }

  function resetHeroLayoutAnchor(key) {
    return applyHeroLayoutGroup(key, {});
  }

  function resetLayoutAnchor(key) {
    if (key.startsWith("hero:")) return resetHeroLayoutAnchor(key);
    return resetDressingAnchor(key);
  }

  function resetAllLayoutAnchors() {
    for (const key of [...dressingAnchors.keys()]) resetDressingAnchor(key);
    for (const key of heroLayoutAnchors.keys()) resetHeroLayoutAnchor(key);
  }

  function focus(action) {
    if (!action?.focus) return;
    const focusPosition = baseCamera.position.add(action.focus.subtract(new BABYLON.Vector3(0, 1.3, 0.3)).scale(0.05));
    focusOrigin = { position: camera.position.clone(), rotation: camera.rotation.clone() };
    focusTarget = { position: focusPosition, rotation: baseCamera.rotation.clone() };
    focusProgress = 0;
    if (prefersReducedMotion) canvas.style.opacity = "0.84";
  }

  function releaseFocus() {
    focusOrigin = { position: camera.position.clone(), rotation: camera.rotation.clone() };
    focusTarget = { position: baseCamera.position.clone(), rotation: baseCamera.rotation.clone() };
    focusProgress = 0;
  }

  function setCameraLook(yaw, pitch) {
    camera.rotation.y = yaw;
    camera.rotation.x = BABYLON.Scalar.Clamp(baseCamera.rotation.x + pitch, -0.46, 0.24);
  }

  function screenPosition(position) {
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    return BABYLON.Vector3.Project(position, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), viewport);
  }

  setTemperature("mid");
  setLiquidState();
  return {
    scene,
    camera,
    actions,
    getAction: actionForMesh,
    setHighlight,
    setLayoutHighlight: (anchor) => setHighlight(anchor ? descendantMeshes(anchor) : null),
    getLayoutAnchor,
    getLayoutKey,
    isHeroLayoutAnchor,
    worldFromPointer,
    worldFromPointerAtHeight,
    getHeroLayoutOverride,
    setHeroLayoutOverride,
    resetLayoutAnchor,
    resetAllLayoutAnchors,
    nearestStation,
    moveJar,
    resetJar,
    snapJar,
    setJarPouring,
    focus,
    releaseFocus,
    setCameraLook,
    screenPosition,
    setDialAngle: (angle) => {
      dial.rotation.y = angle;
      heroAnchors.get("heatDial")?.rotation.copyFrom(dial.rotation);
    },
    setTemperature,
    setLiquidState,
    setSimmerState,
    playPourBurst,
    dispose: () => scene.dispose(),
  };
}
