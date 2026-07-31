import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.pure.js";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem.js";

const SHEET_COLUMNS = 8;
const SHEET_ROWS = 8;
const SHEET_FRAMES = SHEET_COLUMNS * SHEET_ROWS;
const EFFECT_LIFETIME_MULTIPLIER = 1.28;
const EFFECT_SCALE_BY_ELEMENT = Object.freeze({
  fire: 1.4,
  lightning: 1.15,
  void: 1.3,
  chrono: 1.4
});
const MAX_DETAILED_EFFECTS = 8;
const MAX_ACTIVE_EFFECT_EVENTS = 12;
const MAX_GROUND_TRACES = 8;
const MAX_PROJECTILE_FLAME_TRAILS = 6;

function color4(hex, alpha = 1) {
  const color = Color3.FromHexString(hex);
  return new Color4(color.r, color.g, color.b, alpha);
}

function setSheetFrame(slot, frame) {
  const column = frame % SHEET_COLUMNS;
  const row = Math.floor(frame / SHEET_COLUMNS);
  const u0 = column / SHEET_COLUMNS;
  const u1 = (column + 1) / SHEET_COLUMNS;
  const v0 = 1 - (row + 1) / SHEET_ROWS;
  const v1 = 1 - row / SHEET_ROWS;
  slot.uvs.set([u0, v1, u1, v1, u1, v0, u0, v0]);
  slot.mesh.updateVerticesData(VertexBuffer.UVKind, slot.uvs, false, false);
}

/**
 * 実行中の生成を避けるため、テクスチャ・ParticleSystem・短命の板は全て起動時に確保する。
 * ParticleSystem は属性×用途で1基だけ持ち、world space の emitter を差し替えて手動バーストする。
 */
export class TexturedEffectController {
  constructor({ scene, assetPaths, palette, prefersReducedMotion, visualTestMode = false, playbackRate = 1 }) {
    this.scene = scene;
    this.palette = palette;
    this.prefersReducedMotion = prefersReducedMotion;
    this.visualTestMode = visualTestMode;
    // 管理プレビューだけが 1/10 まで速度を落とせる。未指定の本編は常に等倍のまま。
    this.playbackRate = Math.min(1, Math.max(0.1, Number(playbackRate) || 1));
    this.elapsed = 0;
    this.quality = "mid";
    this.burstMultiplier = prefersReducedMotion ? 0.36 : 0.72;
    this.suppressedSystems = new Set();
    this.systemProfiles = new Map();
    this.activeEffectEvents = [];
    this.effectPressure = "full";
    this.textures = this.createTextures(assetPaths);
    this.materials = this.createMaterials();
    this.systems = new Map();
    this.systemIdleAt = new Map();
    // boss の左右砲弾を含め、追従炎も起動時に固定6基を確保する。
    this.projectileFlameLimit = 4;
    this.projectileFlames = this.createProjectileFlamePool(MAX_PROJECTILE_FLAME_TRAILS);
    this.pools = {
      shockwave: this.createPlanePool("shockwave", 12, { horizontal: true, size: 2.5 }),
      rune: this.createPlanePool("rune", 14, { horizontal: true, size: 2.7 }),
      lightning: this.createPlanePool("lightning", 20, { horizontal: false, size: 2.25 }),
      swirl: this.createPlanePool("swirl", 10, { horizontal: true, size: 2.8 }),
      rift: this.createPlanePool("rift", 10, { horizontal: false, size: 1.5 }),
      trace: this.createGroundTracePool(MAX_GROUND_TRACES)
    };
    // 稲妻板は常にカメラへ正対させ、俯瞰カメラで枝がエッジオンにならないようにする。
    this.pools.lightning.forEach((slot) => (slot.mesh.billboardMode = 7));
    this.pools.rift.forEach((slot) => (slot.mesh.billboardMode = 7));
    this.createParticleSystems();
    this.applyQuality("mid");
  }

  createTextures(assetPaths) {
    const textureNames = [
      "flameSheet",
      "smokeSheet",
      "shockwaveSheet",
      "lightningArc",
      "spark",
      "softParticle",
      "runeFire",
      "runeLightning",
      "runeVoid",
      "runeChrono",
      "swirl"
    ];
    return Object.fromEntries(textureNames.map((name) => {
      const texture = new Texture(assetPaths[name], this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
      texture.hasAlpha = true;
      texture.wrapU = Texture.CLAMP_ADDRESSMODE;
      texture.wrapV = Texture.CLAMP_ADDRESSMODE;
      return [name, texture];
    }));
  }

  createMaterial(name, textureName, colorHex, alpha = 1) {
    const material = new StandardMaterial(`textured-${name}`, this.scene);
    const texture = this.textures[textureName];
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.diffuseColor = Color3.FromHexString(colorHex);
    material.emissiveColor = Color3.FromHexString(colorHex).scale(1.18);
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.backFaceCulling = false;
    return material;
  }

  createMaterials() {
    const materials = { flame: {}, smoke: {}, spark: {}, soft: {}, shockwave: {}, rune: {}, trace: {} };
    for (const [element, colors] of Object.entries(this.palette)) {
      materials.flame[element] = this.createMaterial(`flame-${element}`, "flameSheet", colors.primary, 0.98);
      materials.smoke[element] = this.createMaterial(`smoke-${element}`, "smokeSheet", colors.deep, element === "void" ? 0.78 : 0.54);
      materials.spark[element] = this.createMaterial(`spark-${element}`, "spark", colors.accent, 0.96);
      materials.soft[element] = this.createMaterial(`soft-${element}`, "softParticle", colors.primary, 0.72);
      materials.shockwave[element] = this.createMaterial(`shockwave-${element}`, "shockwaveSheet", colors.primary, 0.94);
      materials.rune[element] = this.createMaterial(`rune-${element}`, `rune${element[0].toUpperCase()}${element.slice(1)}`, colors.primary, 0.9);
    }
    // 稲妻は白い芯を残し、周囲の紫火花と分離して読ませる。
    materials.lightning = this.createMaterial("lightning-arc", "lightningArc", "#fff8ff", 1);
    materials.swirl = this.createMaterial("void-swirl", "swirl", this.palette.void.primary, 0.86);
    materials.rift = this.createMaterial("chrono-rift", "lightningArc", this.palette.chrono.primary, 0.92);
    // 地面痕跡は既存テクスチャを共有し、ParticleSystemを増やさず余韻だけを残す。
    materials.trace.scorch = this.createMaterial("trace-scorch", "softParticle", "#21070a", 0.74);
    materials.trace.shadow = this.createMaterial("trace-shadow", "softParticle", "#05030a", 0.78);
    materials.trace.lightning = this.createMaterial("trace-lightning", "lightningArc", "#c9d7ff", 0.52);
    return materials;
  }

  createPlanePool(name, capacity, { horizontal, size }) {
    return Array.from({ length: capacity }, (_, index) => {
      const mesh = CreatePlane(`textured-${name}-${index}`, { size }, this.scene);
      mesh.rotation.x = horizontal ? Math.PI / 2 : 0;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      return {
        mesh,
        uvs: new Float32Array(8),
        active: false,
        age: 0,
        duration: 0,
        radius: 1,
        rotation: 0,
        height: 0,
        element: "chrono"
      };
    });
  }

  createGroundTracePool(capacity) {
    return Array.from({ length: capacity }, (_, index) => {
      const base = CreatePlane(`textured-trace-base-${index}`, { size: 2 }, this.scene);
      const accent = CreatePlane(`textured-trace-accent-${index}`, { size: 2 }, this.scene);
      for (const mesh of [base, accent]) {
        mesh.rotation.x = Math.PI / 2;
        mesh.isPickable = false;
        mesh.setEnabled(false);
      }
      return {
        base,
        accent,
        active: false,
        age: 0,
        duration: 0,
        radius: 1,
        element: "chrono"
      };
    });
  }

  createSpriteSheetState(mesh) {
    return { mesh, uvs: new Float32Array(8) };
  }

  setSpriteSheetFrame(state, frame) {
    setSheetFrame(state, frame);
  }

  createParticleSystem(name, capacity, textureName, {
    colorA,
    colorB,
    colorDead,
    minSize,
    maxSize,
    minLife,
    maxLife,
    minPower,
    maxPower,
    directionA,
    directionB,
    gravity = Vector3.Zero(),
    blendMode = ParticleSystem.BLENDMODE_ADD,
    spriteSheet = false,
    billboardMode = ParticleSystem.BILLBOARDMODE_ALL,
    element = "chrono"
  }) {
    const system = new ParticleSystem(`textured-${name}`, capacity, this.scene, undefined, spriteSheet);
    system.particleTexture = this.textures[textureName];
    system.emitter = new Vector3(0, -100, 0);
    system.emitRate = 0;
    system.manualEmitCount = 0;
    system.isLocal = false;
    system.blendMode = blendMode;
    system.billboardMode = billboardMode;
    system.minSize = minSize;
    system.maxSize = maxSize;
    system.minLifeTime = minLife;
    system.maxLifeTime = maxLife;
    system.minEmitPower = minPower;
    system.maxEmitPower = maxPower;
    system.minEmitBox = new Vector3(-0.16, 0, -0.16);
    system.maxEmitBox = new Vector3(0.16, 0.16, 0.16);
    system.direction1 = directionA;
    system.direction2 = directionB;
    system.gravity = gravity;
    system.color1 = colorA;
    system.color2 = colorB;
    system.colorDead = colorDead;
    system.minInitialRotation = 0;
    system.maxInitialRotation = Math.PI * 2;
    if (spriteSheet) {
      system.spriteCellWidth = 128;
      system.spriteCellHeight = 128;
      system.startSpriteCellID = 0;
      system.endSpriteCellID = SHEET_FRAMES - 1;
      system.spriteCellChangeSpeed = 2.5;
      system.spriteCellLoop = true;
      system.spriteRandomStartCell = true;
    }
    this.systems.set(name, system);
    this.systemProfiles.set(name, {
      element,
      minSize,
      maxSize,
      minLife,
      maxLife,
      minEmitBox: new Vector3(-0.16, 0, -0.16),
      maxEmitBox: new Vector3(0.16, 0.16, 0.16)
    });
    this.systemIdleAt.set(name, 0);
  }

  createProjectileFlamePool(capacity) {
    return Array.from({ length: capacity }, (_, index) => {
      const system = new ParticleSystem(`textured-projectile-flame-${index}`, 26, this.scene, undefined, true);
      // 既存の fireFlame と同じ flame-sheet / 8x8 sprite-sheet を共有し、弾の後方だけへ少量ずつ出す。
      system.particleTexture = this.textures.flameSheet;
      system.emitter = new Vector3(0, -100, 0);
      system.emitRate = 0;
      system.manualEmitCount = 0;
      system.isLocal = false;
      system.blendMode = ParticleSystem.BLENDMODE_ADD;
      system.billboardMode = ParticleSystem.BILLBOARDMODE_ALL;
      system.minSize = 0.28;
      system.maxSize = 0.54;
      system.minLifeTime = 0.24;
      system.maxLifeTime = 0.4;
      system.minEmitPower = 0.55;
      system.maxEmitPower = 1.05;
      system.minEmitBox = new Vector3(-0.08, -0.04, -0.08);
      system.maxEmitBox = new Vector3(0.08, 0.04, 0.08);
      system.direction1 = new Vector3(-0.35, 0.45, -0.35);
      system.direction2 = new Vector3(0.35, 0.85, 0.35);
      system.gravity = new Vector3(0, 0.12, 0);
      system.color1 = color4("#ffdf8a", 0.96);
      system.color2 = color4("#ff4b31", 0.8);
      system.colorDead = color4("#74121a", 0);
      system.minInitialRotation = 0;
      system.maxInitialRotation = Math.PI * 2;
      system.spriteCellWidth = 128;
      system.spriteCellHeight = 128;
      system.startSpriteCellID = 0;
      system.endSpriteCellID = SHEET_FRAMES - 1;
      system.spriteCellChangeSpeed = 2.5;
      system.spriteCellLoop = true;
      system.spriteRandomStartCell = true;
      return { system, projectile: null, active: false, emitClock: 0 };
    });
  }

  createParticleSystems() {
    // capacity は高品質時の上限。low は発火する system 数と manualEmitCount を下げる。
    this.createParticleSystem("fireFlame", 80, "flameSheet", {
      colorA: color4("#ffbf5a", 0.98), colorB: color4("#ff3b30", 0.9), colorDead: color4("#74121a", 0),
      minSize: 0.82, maxSize: 1.46, minLife: 0.42, maxLife: 0.72, minPower: 0.65, maxPower: 1.35,
      directionA: new Vector3(-0.3, 1.65, -0.3), directionB: new Vector3(0.3, 2.55, 0.3),
      gravity: new Vector3(0, 0.18, 0), spriteSheet: true, billboardMode: ParticleSystem.BILLBOARDMODE_Y, element: "fire"
    });
    this.createParticleSystem("fireSmoke", 40, "smokeSheet", {
      colorA: color4("#5b171a", 0.38), colorB: color4("#bc4e28", 0.25), colorDead: color4("#100a12", 0),
      minSize: 0.72, maxSize: 1.48, minLife: 0.76, maxLife: 1.15, minPower: 0.22, maxPower: 0.72,
      directionA: new Vector3(-0.45, 0.72, -0.45), directionB: new Vector3(0.45, 1.22, 0.45),
      gravity: new Vector3(0, 0.08, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, spriteSheet: true, element: "fire"
    });
    this.createParticleSystem("fireSpark", 60, "spark", {
      colorA: color4("#fff3c9", 1), colorB: color4("#ff6d36", 0.94), colorDead: color4("#74121a", 0),
      minSize: 0.12, maxSize: 0.3, minLife: 0.22, maxLife: 0.46, minPower: 1.25, maxPower: 3.7,
      directionA: new Vector3(-1.4, 0.55, -1.4), directionB: new Vector3(1.4, 2.2, 1.4), gravity: new Vector3(0, -3.3, 0), element: "fire"
    });
    this.createParticleSystem("lightningSpark", 60, "spark", {
      colorA: color4("#ffffff", 1), colorB: color4("#df45f3", 0.95), colorDead: color4("#7a1a9d", 0),
      minSize: 0.1, maxSize: 0.26, minLife: 0.16, maxLife: 0.34, minPower: 1.35, maxPower: 4.3,
      directionA: new Vector3(-1.7, 0.2, -1.7), directionB: new Vector3(1.7, 1.45, 1.7), gravity: new Vector3(0, -1.4, 0), element: "lightning"
    });
    this.createParticleSystem("voidSmoke", 40, "smokeSheet", {
      colorA: color4("#42105b", 0.78), colorB: color4("#df73ee", 0.52), colorDead: color4("#09040f", 0),
      minSize: 0.82, maxSize: 1.78, minLife: 0.72, maxLife: 1.16, minPower: 0.16, maxPower: 0.58,
      directionA: new Vector3(-0.45, 0.28, -0.45), directionB: new Vector3(0.45, 0.84, 0.45),
      gravity: new Vector3(0, 0.04, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, spriteSheet: true, element: "void"
    });
    this.createParticleSystem("voidSoft", 40, "softParticle", {
      colorA: color4("#df73ee", 0.7), colorB: color4("#a630b8", 0.48), colorDead: color4("#09040f", 0),
      minSize: 0.2, maxSize: 0.54, minLife: 0.4, maxLife: 0.7, minPower: 0.42, maxPower: 1.22,
      directionA: new Vector3(-0.9, 0.12, -0.9), directionB: new Vector3(0.9, 0.86, 0.9), element: "void"
    });
    this.createParticleSystem("chronoSoft", 60, "softParticle", {
      colorA: color4("#f1ffff", 0.9), colorB: color4("#58e9ff", 0.68), colorDead: color4("#126d91", 0),
      minSize: 0.13, maxSize: 0.42, minLife: 0.28, maxLife: 0.62, minPower: 0.78, maxPower: 2.2,
      directionA: new Vector3(-1.05, 0.18, -1.05), directionB: new Vector3(1.05, 1.12, 1.05), element: "chrono"
    });
    this.createParticleSystem("chronoSpark", 48, "spark", {
      colorA: color4("#ffffff", 0.92), colorB: color4("#58e9ff", 0.8), colorDead: color4("#126d91", 0),
      minSize: 0.08, maxSize: 0.2, minLife: 0.18, maxLife: 0.38, minPower: 0.92, maxPower: 2.95,
      directionA: new Vector3(-1.22, 0.15, -1.22), directionB: new Vector3(1.22, 1.38, 1.22), element: "chrono"
    });
    this.createParticleSystem("chronoMist", 40, "smokeSheet", {
      colorA: color4("#1e617f", 0.38), colorB: color4("#58e9ff", 0.3), colorDead: color4("#071b2b", 0),
      minSize: 0.64, maxSize: 1.28, minLife: 0.65, maxLife: 1.05, minPower: 0.14, maxPower: 0.54,
      directionA: new Vector3(-0.52, 0.24, -0.52), directionB: new Vector3(0.52, 0.78, 0.52),
      gravity: new Vector3(0, 0.03, 0), blendMode: ParticleSystem.BLENDMODE_STANDARD, spriteSheet: true, element: "chrono"
    });
    this.createParticleSystem("impactSpark", 60, "spark", {
      colorA: color4("#f1ffff", 0.95), colorB: color4("#58e9ff", 0.74), colorDead: color4("#126d91", 0),
      minSize: 0.1, maxSize: 0.24, minLife: 0.16, maxLife: 0.34, minPower: 0.85, maxPower: 2.7,
      directionA: new Vector3(-1.4, 0.18, -1.4), directionB: new Vector3(1.4, 1.4, 1.4), element: "chrono"
    });
  }

  applyQuality(quality) {
    this.quality = quality;
    this.burstMultiplier = this.prefersReducedMotion ? 0.36 : this.visualTestMode ? 1 : quality === "low" ? 0.44 : quality === "high" ? 1 : 0.72;
    this.projectileFlameLimit = this.prefersReducedMotion ? 1 : quality === "low" ? 2 : quality === "high" ? 6 : 4;
    for (const [index, slot] of this.projectileFlames.entries()) {
      if (index >= this.projectileFlameLimit && slot.active) this.releaseProjectileFlame(slot.projectile);
    }
    this.suppressedSystems = quality === "low"
      ? new Set(["fireSmoke", "voidSoft", "chronoMist", "chronoSpark"])
      : new Set();
    // lowは旧スケールを維持し、粒子数と詳細レイヤーも従来どおり抑える。
    for (const [name, system] of this.systems) {
      const profile = this.systemProfiles.get(name);
      if (!profile) continue;
      const scale = this.scaleFor(profile.element);
      const lifetime = EFFECT_LIFETIME_MULTIPLIER * (this.visualTestMode ? 3 : 1);
      system.minSize = profile.minSize * scale;
      system.maxSize = profile.maxSize * scale;
      system.minLifeTime = profile.minLife * lifetime;
      system.maxLifeTime = profile.maxLife * lifetime;
      system.minEmitBox.copyFrom(profile.minEmitBox.scale(scale));
      system.maxEmitBox.copyFrom(profile.maxEmitBox.scale(scale));
      system.updateSpeed = 0.01 * this.playbackRate;
      if (system.isAnimationSheetEnabled) system.spriteCellChangeSpeed = 2.5 * this.playbackRate;
    }
  }

  setPlaybackRate(rate = 1) {
    this.playbackRate = Math.min(1, Math.max(0.1, Number(rate) || 1));
    this.applyQuality(this.quality);
  }

  scaleFor(element) {
    return this.quality === "low" ? 1 : (EFFECT_SCALE_BY_ELEMENT[element] ?? 1);
  }

  burst(name, position, amount, lifetime = 0.8, intensity = 1) {
    if (this.suppressedSystems.has(name)) return;
    const system = this.systems.get(name);
    if (!system) return;
    system.emitter.copyFrom(position);
    const pressureMultiplier = this.effectPressure === "full" ? 1 : this.effectPressure === "simple" ? 0.58 : 0.32;
    system.manualEmitCount = Math.max(1, Math.round(amount * this.burstMultiplier * intensity * pressureMultiplier));
    system.start();
    this.systemIdleAt.set(name, Math.max(this.systemIdleAt.get(name) ?? 0, this.elapsed + this.durationFor(lifetime)));
  }

  durationFor(duration) {
    return duration * EFFECT_LIFETIME_MULTIPLIER * (this.visualTestMode ? 3 : 1);
  }

  beginEffect(lifetime) {
    this.activeEffectEvents = this.activeEffectEvents.filter((until) => until > this.elapsed);
    const active = this.activeEffectEvents.length;
    if (active < MAX_ACTIVE_EFFECT_EVENTS) this.activeEffectEvents.push(this.elapsed + this.durationFor(lifetime));
    this.effectPressure = active < MAX_DETAILED_EFFECTS ? "full" : active < MAX_ACTIVE_EFFECT_EVENTS ? "simple" : "minimal";
    return this.effectPressure;
  }

  acquire(poolName) {
    return this.pools[poolName].find((slot) => !slot.active) ?? null;
  }

  acquireTrace() {
    return this.pools.trace.find((slot) => !slot.active)
      ?? this.pools.trace.reduce((oldest, slot) => (slot.age / slot.duration > oldest.age / oldest.duration ? slot : oldest));
  }

  spawnShockwave(position, element = "chrono", radius = 1, duration = 0.44) {
    const slot = this.acquire("shockwave");
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = this.durationFor(duration);
    slot.radius = radius;
    slot.element = element;
    slot.mesh.material = this.materials.shockwave[element] ?? this.materials.shockwave.chrono;
    slot.mesh.position.set(position.x, position.y + 0.045, position.z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.visibility = 1;
    setSheetFrame(slot, 0);
    slot.mesh.setEnabled(true);
  }

  spawnRune(position, element = "chrono", radius = 1, duration = 0.56) {
    const slot = this.acquire("rune");
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = this.durationFor(duration);
    slot.radius = radius;
    slot.element = element;
    slot.mesh.material = this.materials.rune[element] ?? this.materials.rune.chrono;
    slot.mesh.position.set(position.x, position.y + 0.035, position.z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.visibility = 0.92;
    slot.mesh.setEnabled(true);
  }

  spawnLightning(position, element = "lightning", scale = 1, duration = 0.3, count = 3) {
    for (let index = 0; index < count; index += 1) {
      const slot = this.acquire("lightning");
      if (!slot) return;
      slot.active = true;
      slot.age = index * 0.018;
      slot.duration = this.durationFor(duration);
      slot.radius = scale * (1.1 + index * 0.18);
      slot.rotation = index * ((Math.PI * 2) / count) + Math.random() * 0.22;
      slot.element = element;
      slot.mesh.material = this.materials.lightning;
      const offset = (index - (count - 1) / 2) * 0.22;
      slot.mesh.position.set(position.x + offset, position.y + 1.18 + index * 0.08, position.z - offset * 0.45);
      slot.mesh.rotation.set(0, slot.rotation, index % 2 ? 0.12 : -0.1);
      slot.mesh.visibility = 0.96;
      slot.mesh.setEnabled(true);
    }
  }

  spawnSwirl(position, radius = 1, duration = 0.66) {
    const slot = this.acquire("swirl");
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = this.durationFor(duration);
    slot.radius = radius;
    slot.mesh.material = this.materials.swirl;
    slot.mesh.position.set(position.x, position.y + 0.05, position.z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.visibility = 0.9;
    slot.mesh.setEnabled(true);
  }

  spawnRift(position, radius = 1, duration = 0.48) {
    const slot = this.acquire("rift");
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = this.durationFor(duration);
    slot.radius = radius;
    slot.mesh.material = this.materials.rift;
    slot.mesh.position.set(position.x, position.y + 1.05, position.z);
    slot.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    slot.mesh.visibility = 0.92;
    slot.mesh.setEnabled(true);
  }

  spawnTelegraph(position, element, duration) {
    const scale = this.scaleFor(element);
    this.spawnRune(position, element, (element === "fire" ? 1.08 : 0.94) * scale, duration);
    if (element === "lightning" && this.quality !== "low") this.spawnLightning(position, element, 0.78 * scale, duration * 0.78, 2);
    if (element === "void" && this.quality !== "low") this.spawnSwirl(position, 0.7 * scale, duration);
  }

  spawnElementalImpact(position, element, direction = Vector3.Zero()) {
    // direction はゲームロジックを変えずに呼び出し側と同じ契約を保つため受け取る。演出はworld-spaceに残す。
    void direction;
    const pressure = this.beginEffect(1.18);
    const scale = this.scaleFor(element);
    if (element === "fire") {
      this.spawnShockwave(position, "fire", 1.12 * scale, 0.48);
      this.spawnRune(position, "fire", 0.92 * scale, 0.46);
      this.burst("fireFlame", position, 32, 0.72);
      if (pressure === "full") this.burst("fireSmoke", position, 13, 1.18);
      this.burst("fireSpark", position, 18, 0.52);
      this.spawnGroundTrace(position, "fire", 1.02 * scale, 3.1);
      return;
    }
    if (element === "lightning") {
      this.spawnShockwave(position, "lightning", 1.04 * scale, 0.38);
      this.spawnRune(position, "lightning", 0.88 * scale, 0.38);
      this.spawnLightning(position, "lightning", 1.12 * scale, 0.34, pressure === "full" && this.quality !== "low" ? 4 : 1);
      this.burst("lightningSpark", position, 20, 0.4);
      this.spawnGroundTrace(position, "lightning", 1.02 * scale, 1.55);
      return;
    }
    if (element === "void") {
      this.spawnShockwave(position, "void", 1.22 * scale, 0.62);
      this.spawnRune(position, "void", 1.04 * scale, 0.62);
      this.spawnSwirl(position, 1.18 * scale, 0.68);
      this.burst("voidSmoke", position, 22, 1.2);
      if (pressure === "full") this.burst("voidSoft", position, 16, 0.74);
      this.spawnGroundTrace(position, "void", 1.08 * scale, 2.45);
      return;
    }
    this.spawnChronoImpact(position, 1);
  }

  spawnChronoImpact(position, radius = 1) {
    const pressure = this.beginEffect(0.68);
    const scale = this.scaleFor("chrono");
    this.spawnShockwave(position, "chrono", radius * scale, 0.46);
    this.burst("impactSpark", position, 16, 0.42);
    if (pressure === "full") this.burst("chronoSoft", position, 18, 0.68);
    this.spawnGroundTrace(position, "chrono", radius * scale, 2.65);
  }

  spawnChronoRift(position, radius = 1) {
    const pressure = this.beginEffect(0.66);
    const scale = this.scaleFor("chrono");
    this.spawnRune(position, "chrono", radius * scale, 0.5);
    this.spawnRift(position, radius * scale, 0.5);
    this.burst("chronoSoft", position, 16, 0.66);
    if (pressure === "full") this.burst("chronoSpark", position, 10, 0.42);
    this.spawnGroundTrace(position, "chrono", radius * scale, 2.65);
  }

  spawnChronoField(position) {
    const pressure = this.beginEffect(2.45);
    const scale = this.scaleFor("chrono");
    this.spawnRune(position, "chrono", 4.4 * scale, 2.45);
    this.spawnShockwave(position, "chrono", 3.8 * scale, 0.74);
    this.burst("chronoMist", position, 28, 1.12);
    if (pressure === "full") this.burst("chronoSoft", position, 22, 0.8);
    this.spawnGroundTrace(position, "chrono", 3.8 * scale, 2.9);
  }

  spawnChronoTrail(from, to) {
    this.beginEffect(0.62);
    this.burst("chronoSoft", from, 12, 0.58);
    this.burst("chronoSoft", to, 14, 0.62);
    this.burst("chronoSpark", to, 9, 0.42);
    this.spawnGroundTrace(to, "chrono", 0.74 * this.scaleFor("chrono"), 2.3);
  }

  spawnErasure(position, type) {
    const element = type === "thief" ? "void" : type === "shooter" ? "lightning" : "fire";
    const pressure = this.beginEffect(1.08);
    const scale = this.scaleFor(element);
    this.spawnShockwave(position, element, (type === "boss" ? 1.72 : 1.08) * scale, 0.62);
    this.spawnRune(position, element, (type === "boss" ? 1.42 : 0.94) * scale, 0.56);
    if (element === "void") this.spawnSwirl(position, 1.2 * scale, 0.74);
    if (element === "lightning") this.spawnLightning(position, element, 1.15 * scale, 0.4, pressure === "full" ? 3 : 1);
    this.burst(element === "fire" ? "fireSpark" : element === "lightning" ? "lightningSpark" : "voidSoft", position, 18, 0.58);
    this.spawnGroundTrace(position, element, (type === "boss" ? 1.36 : 0.88) * scale, element === "fire" ? 3.1 : element === "void" ? 2.45 : 1.55);
  }

  spawnGroundTrace(position, element, radius, duration) {
    const slot = this.acquireTrace();
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = this.durationFor(this.quality === "low" ? duration * 0.62 : duration);
    slot.radius = radius;
    slot.element = element;
    slot.base.position.set(position.x, position.y + 0.012, position.z);
    slot.accent.position.set(position.x, position.y + 0.02, position.z);
    slot.base.rotation.y = Math.random() * Math.PI * 2;
    slot.accent.rotation.y = slot.base.rotation.y + 0.18;
    slot.base.material = element === "fire" ? this.materials.trace.scorch : element === "void" ? this.materials.trace.shadow : element === "lightning" ? this.materials.trace.lightning : this.materials.rune.chrono;
    slot.accent.material = this.materials.rune[element] ?? this.materials.rune.chrono;
    slot.base.visibility = element === "lightning" ? 0.34 : element === "chrono" ? 0.28 : 0.58;
    slot.accent.visibility = element === "fire" ? 0.22 : 0;
    slot.base.setEnabled(true);
    slot.accent.setEnabled(element === "fire");
  }

  attachProjectileFlame(projectile) {
    if (this.projectileFlames.some((slot) => slot.active && slot.projectile === projectile)) return;
    const slot = this.projectileFlames.slice(0, this.projectileFlameLimit).find((candidate) => !candidate.active);
    if (!slot) return;
    slot.projectile = projectile;
    slot.active = true;
    slot.emitClock = 0;
  }

  releaseProjectileFlame(projectile) {
    const slot = this.projectileFlames.find((candidate) => candidate.projectile === projectile);
    if (!slot) return;
    slot.active = false;
    slot.projectile = null;
    slot.emitClock = 0;
    // 既に出た炎は寿命まで自然に消え、新規放出だけを止める。
    slot.system.stop();
  }

  updateProjectileFlames(deltaSeconds) {
    for (const slot of this.projectileFlames) {
      if (!slot.active) continue;
      if (!slot.projectile?.alive) {
        this.releaseProjectileFlame(slot.projectile);
        continue;
      }
      slot.emitClock -= deltaSeconds;
      if (slot.emitClock > 0) continue;
      const { position, velocity } = slot.projectile;
      const inverseLength = 1 / Math.max(0.001, Math.hypot(velocity.x, velocity.z));
      const backwardX = -velocity.x * inverseLength;
      const backwardZ = -velocity.z * inverseLength;
      const sideX = -backwardZ;
      const sideZ = backwardX;
      slot.system.emitter.set(position.x + backwardX * 0.46, position.y - 0.06, position.z + backwardZ * 0.46);
      slot.system.direction1.set(backwardX * 1.55 + sideX * 0.28, 0.5, backwardZ * 1.55 + sideZ * 0.28);
      slot.system.direction2.set(backwardX * 2.2 - sideX * 0.28, 1.02, backwardZ * 2.2 - sideZ * 0.28);
      slot.system.manualEmitCount = this.quality === "low" || this.prefersReducedMotion ? 1 : 2;
      slot.system.start();
      slot.emitClock = this.quality === "low" || this.prefersReducedMotion ? 0.12 : 0.075;
    }
  }

  update(deltaSeconds) {
    this.elapsed += deltaSeconds;
    this.activeEffectEvents = this.activeEffectEvents.filter((until) => until > this.elapsed);
    for (const [name, system] of this.systems) {
      if (this.elapsed >= (this.systemIdleAt.get(name) ?? 0) && system.getActiveCount() === 0 && system.isStarted()) system.stop();
    }
    this.updateProjectileFlames(deltaSeconds);
    this.updateShockwaves(deltaSeconds);
    this.updateRunes(deltaSeconds);
    this.updateLightning(deltaSeconds);
    this.updateSwirls(deltaSeconds);
    this.updateRifts(deltaSeconds);
    this.updateGroundTraces(deltaSeconds);
  }

  finish(slot) {
    slot.active = false;
    if (slot.mesh) slot.mesh.setEnabled(false);
    if (slot.base) slot.base.setEnabled(false);
    if (slot.accent) slot.accent.setEnabled(false);
  }

  updateShockwaves(deltaSeconds) {
    for (const slot of this.pools.shockwave) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      const eased = 1 - (1 - progress) ** 3;
      setSheetFrame(slot, Math.min(SHEET_FRAMES - 1, Math.floor(progress * (SHEET_FRAMES - 1))));
      slot.mesh.scaling.setAll(slot.radius * (0.24 + eased * 1.14));
      slot.mesh.visibility = (1 - progress) ** 1.35;
      if (progress >= 1) this.finish(slot);
    }
  }

  updateRunes(deltaSeconds) {
    for (const slot of this.pools.rune) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      slot.mesh.scaling.setAll(slot.radius * (0.58 + Math.min(1, progress * 3) * 0.42));
      slot.mesh.rotation.y += (this.prefersReducedMotion ? 0.18 : 1.8) * (1 - progress * 0.4) * 0.016;
      slot.mesh.visibility = progress < 0.72 ? 0.9 : (1 - progress) / 0.28;
      if (progress >= 1) this.finish(slot);
    }
  }

  updateLightning(deltaSeconds) {
    for (const slot of this.pools.lightning) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      slot.mesh.scaling.set(slot.radius * (0.7 + progress * 0.38), slot.radius * (2.1 + (1 - progress) * 0.65), 1);
      slot.mesh.visibility = (1 - progress) * (this.prefersReducedMotion || Math.floor(progress * 14) % 3 ? 0.96 : 0.34);
      if (progress >= 1) this.finish(slot);
    }
  }

  updateSwirls(deltaSeconds) {
    for (const slot of this.pools.swirl) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      slot.mesh.scaling.setAll(slot.radius * (1.2 - progress * 0.92));
      slot.mesh.rotation.y += (this.prefersReducedMotion ? 0.16 : 0.32) * Math.PI;
      slot.mesh.visibility = (1 - progress) ** 1.15;
      if (progress >= 1) this.finish(slot);
    }
  }

  updateRifts(deltaSeconds) {
    for (const slot of this.pools.rift) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      slot.mesh.scaling.set(slot.radius * (0.5 + Math.sin(progress * Math.PI) * 0.92), slot.radius * (1.35 + Math.sin(progress * Math.PI) * 1.16), 1);
      slot.mesh.visibility = Math.sin(progress * Math.PI) * 0.94;
      if (progress >= 1) this.finish(slot);
    }
  }

  updateGroundTraces(deltaSeconds) {
    for (const slot of this.pools.trace) {
      if (!slot.active) continue;
      slot.age += deltaSeconds;
      const progress = Math.min(1, slot.age / slot.duration);
      const fade = (1 - progress) ** 1.45;
      if (slot.element === "lightning") {
        slot.base.scaling.set(slot.radius * (1.8 - progress * 0.34), slot.radius * 0.18, 1);
        slot.base.visibility = fade * 0.34;
      } else if (slot.element === "void") {
        slot.base.scaling.setAll(slot.radius * (1.08 - progress * 0.72));
        slot.base.visibility = fade * 0.58;
      } else if (slot.element === "chrono") {
        slot.base.scaling.setAll(slot.radius * (0.78 + progress * 0.2));
        slot.base.visibility = fade * 0.28;
        slot.base.rotation.y += (this.prefersReducedMotion ? 0.08 : 0.38) * deltaSeconds;
      } else {
        slot.base.scaling.setAll(slot.radius * (1.08 - progress * 0.12));
        slot.accent.scaling.setAll(slot.radius * (0.76 + progress * 0.16));
        slot.base.visibility = fade * 0.58;
        slot.accent.visibility = fade * 0.22;
        slot.accent.rotation.y -= (this.prefersReducedMotion ? 0.08 : 0.3) * deltaSeconds;
      }
      if (progress >= 1) this.finish(slot);
    }
  }

  reset() {
    for (const pool of Object.values(this.pools)) {
      for (const slot of pool) this.finish(slot);
    }
    for (const [name, system] of this.systems) {
      system.stop();
      this.systemIdleAt.set(name, 0);
    }
    for (const slot of this.projectileFlames) {
      slot.active = false;
      slot.projectile = null;
      slot.emitClock = 0;
      slot.system.stop();
    }
    this.activeEffectEvents = [];
    this.effectPressure = "full";
  }

  getDiagnostics() {
    return {
      systems: [...this.systems].map(([name, system]) => ({ name, capacity: system.getCapacity(), active: system.getActiveCount() })),
      quality: this.quality,
      suppressedSystems: [...this.suppressedSystems],
      scaleByElement: Object.fromEntries(Object.keys(EFFECT_SCALE_BY_ELEMENT).map((element) => [element, this.scaleFor(element)])),
      activeEffectEvents: this.activeEffectEvents.length,
      maxDetailedEffects: MAX_DETAILED_EFFECTS,
      maxActiveEffectEvents: MAX_ACTIVE_EFFECT_EVENTS,
      activeProjectileFlames: this.projectileFlames.filter((slot) => slot.active).length,
      maxProjectileFlames: this.projectileFlameLimit,
      activeGroundTraces: this.pools.trace.filter((slot) => slot.active).length,
      maxGroundTraces: MAX_GROUND_TRACES
    };
  }
}
