// img2threejs code-only reconstruction: Ink Tide Scout catgirl turnaround.
// Spec authority: .img2threejs/ink-tide-scout/object-sculpt-spec.json
// Contract: minY=0, height~1.1, +Z front, deterministic, textureless, named semantic parts.
// High-fidelity override: the user explicitly prioritizes likeness over the original 48k triangle target.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Physical = THREE.MeshPhysicalMaterial;

interface ScoutMaterials {
  skin: Physical;
  skinShadow: Physical;
  hair: Physical;
  hairShadow: Physical;
  coral: Physical;
  coralDark: Physical;
  teal: Physical;
  tealDark: Physical;
  mint: Physical;
  trim: Physical;
  boot: Physical;
  bootSole: Physical;
  brown: Physical;
  earInner: Physical;
  eyeWhite: Physical;
  iris: Physical;
  pupil: Physical;
  catchlight: Physical;
  mouth: Physical;
  blush: Physical;
}

interface RuntimePart extends THREE.Group {
  userData: {
    explodeDirection?: [number, number, number];
    [key: string]: unknown;
  };
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// The reference is a clean anime turnaround, so silhouette continuity matters more than
// physically noisy surface detail. These values deliberately spend geometry on curved
// contours (face, limbs, hair and clothing) while repeated micro-parts are still batched.
const HIGH_DETAIL = {
  sphereSegments: 56,
  capsuleRadialSegments: 28,
  capsuleCapSegments: 14,
  cylinderSegments: 40,
  curveSegments: 48,
  curveRadialSegments: 16,
  loftSegments: 56,
  bevelSegments: 7,
  shapeCurveSegments: 18,
} as const;

function material(color: number, roughness: number, options: Partial<Physical> = {}): Physical {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness,
    clearcoat: 0.06,
    clearcoatRoughness: 0.5,
  });
  Object.assign(mat, options);
  return mat;
}

function buildMaterials(): ScoutMaterials {
  const eyeWhite = material(0xfffdf8, 0.16, { clearcoat: 0.8, clearcoatRoughness: 0.08 });
  const catchlight = eyeWhite.clone();
  catchlight.emissive = new THREE.Color(0xffffff);
  catchlight.emissiveIntensity = 0.85;
  return {
    skin: material(0xf0c5a5, 0.58, { sheen: 0.18, sheenColor: new THREE.Color(0xffd6c0) }),
    skinShadow: material(0xd09b79, 0.63),
    hair: material(0xdfaa83, 0.5, { sheen: 0.32, sheenColor: new THREE.Color(0xffd0ad) }),
    hairShadow: material(0xbe825f, 0.58, { sheen: 0.18, sheenColor: new THREE.Color(0xe5a47a) }),
    coral: material(0xdd5d55, 0.72, { sheen: 0.12, sheenColor: new THREE.Color(0xff9f96) }),
    coralDark: material(0xb74440, 0.76),
    teal: material(0x2e95a4, 0.67, { sheen: 0.1, sheenColor: new THREE.Color(0x8bd3d7) }),
    tealDark: material(0x1c8090, 0.72),
    mint: material(0x9bcac7, 0.76, { sheen: 0.08, sheenColor: new THREE.Color(0xdff3ed) }),
    trim: material(0xe5e9e7, 0.58),
    boot: material(0xd9e0e2, 0.52, { clearcoat: 0.12, clearcoatRoughness: 0.42 }),
    bootSole: material(0x228897, 0.7),
    brown: material(0x4c352b, 0.62),
    earInner: material(0xe7aaa5, 0.64),
    eyeWhite,
    iris: material(0x20a9ad, 0.18, { clearcoat: 0.9, clearcoatRoughness: 0.06 }),
    pupil: material(0x172225, 0.15, { clearcoat: 0.75, clearcoatRoughness: 0.08 }),
    catchlight,
    mouth: material(0xb96e69, 0.5),
    blush: material(0xee9a98, 0.72, { transparent: true, opacity: 0.42, depthWrite: false }),
  };
}

function configureMesh(mesh: THREE.Mesh, name: string, explodeWithParent = false): THREE.Mesh {
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (explodeWithParent) mesh.userData.explodeWithParent = true;
  return mesh;
}

function ellipsoid(
  name: string,
  mat: THREE.Material,
  position: THREE.Vector3Tuple,
  scale: THREE.Vector3Tuple,
  segments: number = HIGH_DETAIL.sphereSegments,
): THREE.Mesh {
  const mesh = configureMesh(new THREE.Mesh(
    new THREE.SphereGeometry(1, segments, Math.max(18, Math.round(segments * 0.72))),
    mat,
  ), name, true);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  return mesh;
}

function orientedCapsule(
  name: string,
  start: THREE.Vector3Tuple,
  end: THREE.Vector3Tuple,
  radius: number,
  mat: THREE.Material,
  radialSegments: number = HIGH_DETAIL.capsuleRadialSegments,
): THREE.Mesh {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const distance = direction.length();
  const cylinderLength = Math.max(0.001, distance - radius * 2);
  const mesh = configureMesh(
    new THREE.Mesh(new THREE.CapsuleGeometry(
      radius,
      cylinderLength,
      HIGH_DETAIL.capsuleCapSegments,
      radialSegments,
    ), mat),
    name,
    true,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(WORLD_UP, direction.normalize());
  return mesh;
}

function orientedCylinder(
  name: string,
  start: THREE.Vector3Tuple,
  end: THREE.Vector3Tuple,
  radiusTop: number,
  radiusBottom: number,
  mat: THREE.Material,
  radialSegments: number = HIGH_DETAIL.cylinderSegments,
): THREE.Mesh {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const mesh = configureMesh(
    new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, direction.length(), radialSegments), mat),
    name,
    true,
  );
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(WORLD_UP, direction.normalize());
  return mesh;
}

function roundedPanelGeometry(width: number, height: number, depth: number, radius: number): THREE.ExtrudeGeometry {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: HIGH_DETAIL.bevelSegments,
    curveSegments: HIGH_DETAIL.shapeCurveSegments,
    bevelSize: Math.min(r * 0.32, depth * 0.35),
    bevelThickness: Math.min(r * 0.26, depth * 0.28),
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function roundedPanel(
  name: string,
  width: number,
  height: number,
  depth: number,
  radius: number,
  mat: THREE.Material,
  position: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple = [0, 0, 0],
): THREE.Mesh {
  const mesh = configureMesh(new THREE.Mesh(roundedPanelGeometry(width, height, depth, radius), mat), name, true);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return mesh;
}

function triangleGeometry(width: number, height: number, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: HIGH_DETAIL.bevelSegments,
    curveSegments: HIGH_DETAIL.shapeCurveSegments,
    bevelSize: Math.min(width, height) * 0.035,
    bevelThickness: depth * 0.16,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

/** Elliptical variable-radius curve sweep with closed end caps. */
function taperedCurveGeometry(
  points: THREE.Vector3Tuple[],
  startRadius: number,
  endRadius: number,
  flatten = 0.72,
  tubularSegments: number = HIGH_DETAIL.curveSegments,
  radialSegments: number = HIGH_DETAIL.curveRadialSegments,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, 'catmullrom', 0.45);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let previousTangent = curve.getTangentAt(0).normalize();
  const initialReference = Math.abs(previousTangent.dot(WORLD_UP)) > 0.93 ? Z_AXIS : WORLD_UP;
  let transportedSide = new THREE.Vector3().crossVectors(initialReference, previousTangent).normalize();

  for (let ring = 0; ring <= tubularSegments; ring++) {
    const t = ring / tubularSegments;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    if (ring > 0) {
      transportedSide.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousTangent, tangent)).normalize();
    }
    const side = transportedSide.clone();
    const binormal = new THREE.Vector3().crossVectors(tangent, side).normalize();
    transportedSide = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
    previousTangent = tangent.clone();
    const eased = t * t * (3 - 2 * t);
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, eased);
    for (let segment = 0; segment < radialSegments; segment++) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const offset = side.clone().multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(binormal, Math.sin(angle) * radius * flatten);
      const vertex = center.clone().add(offset);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(segment / radialSegments, t);
    }
  }

  for (let ring = 0; ring < tubularSegments; ring++) {
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + next;
      const d = (ring + 1) * radialSegments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }

  const startCenterIndex = positions.length / 3;
  const start = curve.getPointAt(0);
  positions.push(start.x, start.y, start.z);
  uvs.push(0.5, 0);
  const endCenterIndex = positions.length / 3;
  const end = curve.getPointAt(1);
  positions.push(end.x, end.y, end.z);
  uvs.push(0.5, 1);
  const lastRing = tubularSegments * radialSegments;
  for (let segment = 0; segment < radialSegments; segment++) {
    const next = (segment + 1) % radialSegments;
    indices.push(startCenterIndex, next, segment);
    indices.push(endCenterIndex, lastRing + segment, lastRing + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function curveMesh(
  name: string,
  points: THREE.Vector3Tuple[],
  startRadius: number,
  endRadius: number,
  mat: THREE.Material,
  flatten = 0.72,
  tubularSegments: number = HIGH_DETAIL.curveSegments,
  radialSegments: number = HIGH_DETAIL.curveRadialSegments,
): THREE.Mesh {
  return configureMesh(
    new THREE.Mesh(taperedCurveGeometry(points, startRadius, endRadius, flatten, tubularSegments, radialSegments), mat),
    name,
    true,
  );
}

interface LoftRing {
  y: number;
  radiusX: number;
  radiusZ: number;
  centerX?: number;
  centerZ?: number;
}

/** Smooth closed volume defined by measured front/profile cross-sections. */
function loftGeometry(rings: LoftRing[], radialSegments: number = HIGH_DETAIL.loftSegments): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex];
    for (let segment = 0; segment < radialSegments; segment++) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      positions.push(
        (ring.centerX ?? 0) + sin * ring.radiusX,
        ring.y,
        (ring.centerZ ?? 0) + cos * ring.radiusZ,
      );
      uvs.push(segment / radialSegments, ringIndex / Math.max(1, rings.length - 1));
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex++) {
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = (segment + 1) % radialSegments;
      const a = ringIndex * radialSegments + segment;
      const b = ringIndex * radialSegments + next;
      const c = (ringIndex + 1) * radialSegments + next;
      const d = (ringIndex + 1) * radialSegments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }

  const cap = (ringIndex: number, flip: boolean): void => {
    const ring = rings[ringIndex];
    const center = positions.length / 3;
    positions.push(ring.centerX ?? 0, ring.y, ring.centerZ ?? 0);
    uvs.push(0.5, ringIndex === 0 ? 0 : 1);
    const offset = ringIndex * radialSegments;
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = (segment + 1) % radialSegments;
      if (flip) indices.push(center, offset + next, offset + segment);
      else indices.push(center, offset + segment, offset + next);
    }
  };
  cap(0, false);
  cap(rings.length - 1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function loftMesh(
  name: string,
  rings: LoftRing[],
  mat: THREE.Material,
  position: THREE.Vector3Tuple = [0, 0, 0],
  radialSegments: number = HIGH_DETAIL.loftSegments,
): THREE.Mesh {
  const mesh = configureMesh(new THREE.Mesh(loftGeometry(rings, radialSegments), mat), name, true);
  mesh.position.set(...position);
  return mesh;
}

type RadiusKey = readonly [t: number, radiusX: number, radiusZ: number];

function sampleRadius(keys: readonly RadiusKey[], t: number): { x: number; z: number } {
  if (t <= keys[0][0]) return { x: keys[0][1], z: keys[0][2] };
  for (let index = 1; index < keys.length; index++) {
    if (t <= keys[index][0]) {
      const previous = keys[index - 1];
      const next = keys[index];
      const local = (t - previous[0]) / Math.max(1e-6, next[0] - previous[0]);
      const eased = local * local * (3 - 2 * local);
      return {
        x: THREE.MathUtils.lerp(previous[1], next[1], eased),
        z: THREE.MathUtils.lerp(previous[2], next[2], eased),
      };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last[1], z: last[2] };
}

/** Continuous anatomical sweep with independent width/depth profiles and sealed ends. */
function profiledCurveGeometry(
  points: THREE.Vector3Tuple[],
  radii: readonly RadiusKey[],
  tubularSegments: number = HIGH_DETAIL.curveSegments,
  radialSegments: number = HIGH_DETAIL.curveRadialSegments,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
    false,
    'catmullrom',
    0.42,
  );
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let previousTangent = curve.getTangentAt(0).normalize();
  const initialReference = Math.abs(previousTangent.dot(WORLD_UP)) > 0.93 ? Z_AXIS : WORLD_UP;
  let transportedSide = new THREE.Vector3().crossVectors(initialReference, previousTangent).normalize();

  for (let ring = 0; ring <= tubularSegments; ring++) {
    const t = ring / tubularSegments;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    if (ring > 0) {
      transportedSide.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousTangent, tangent)).normalize();
    }
    const side = transportedSide.clone();
    const binormal = new THREE.Vector3().crossVectors(tangent, side).normalize();
    transportedSide = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
    previousTangent = tangent.clone();
    const radius = sampleRadius(radii, t);
    for (let segment = 0; segment < radialSegments; segment++) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const vertex = center.clone()
        .addScaledVector(side, Math.cos(angle) * radius.x)
        .addScaledVector(binormal, Math.sin(angle) * radius.z);
      positions.push(vertex.x, vertex.y, vertex.z);
      uvs.push(segment / radialSegments, t);
    }
  }

  for (let ring = 0; ring < tubularSegments; ring++) {
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + next;
      const d = (ring + 1) * radialSegments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }

  const addCap = (t: 0 | 1, flip: boolean): void => {
    const centerPoint = curve.getPointAt(t);
    const center = positions.length / 3;
    positions.push(centerPoint.x, centerPoint.y, centerPoint.z);
    uvs.push(0.5, t);
    const offset = t === 0 ? 0 : tubularSegments * radialSegments;
    for (let segment = 0; segment < radialSegments; segment++) {
      const next = (segment + 1) % radialSegments;
      if (flip) indices.push(center, offset + next, offset + segment);
      else indices.push(center, offset + segment, offset + next);
    }
  };
  addCap(0, false);
  addCap(1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function profiledCurveMesh(
  name: string,
  points: THREE.Vector3Tuple[],
  radii: readonly RadiusKey[],
  mat: THREE.Material,
  tubularSegments: number = HIGH_DETAIL.curveSegments,
  radialSegments: number = HIGH_DETAIL.curveRadialSegments,
): THREE.Mesh {
  return configureMesh(
    new THREE.Mesh(profiledCurveGeometry(points, radii, tubularSegments, radialSegments), mat),
    name,
    true,
  );
}

function addModule(
  root: THREE.Group,
  name: string,
  position: THREE.Vector3Tuple,
  explodeDirection: THREE.Vector3Tuple,
): RuntimePart {
  const group = new THREE.Group() as RuntimePart;
  group.name = name;
  group.position.set(...position);
  group.userData.explodeDirection = explodeDirection;
  root.add(group);
  return group;
}

/**
 * Merge repeated micro meshes into one draw call while retaining named transform aliases.
 * Macro/meso RuntimePart groups remain real independent assemblies for selection/explosion.
 */
function batchMicroMeshes(
  parent: THREE.Object3D,
  names: string[],
  batchName: string,
  mat: THREE.Material,
): void {
  parent.updateWorldMatrix(true, true);
  const meshes = names
    .map((name) => parent.getObjectByName(name))
    .filter((node): node is THREE.Mesh => !!node && (node as THREE.Mesh).isMesh);
  if (meshes.length < 2) return;

  const parentInverse = parent.matrixWorld.clone().invert();
  const geometries = meshes.map((mesh) => {
    const toParent = parentInverse.clone().multiply(mesh.matrixWorld);
    return mesh.geometry.clone().applyMatrix4(toParent);
  });
  const geometry = mergeGeometries(geometries, false);
  for (const item of geometries) item.dispose();
  if (!geometry) throw new Error(`Failed to batch micro meshes: ${batchName}`);

  const batch = configureMesh(new THREE.Mesh(geometry, mat), batchName, true);
  batch.userData.semanticChildren = meshes.map((mesh) => mesh.name);
  parent.add(batch);

  const sourceGeometries = new Set(meshes.map((mesh) => mesh.geometry));
  for (const mesh of meshes) {
    const alias = new THREE.Object3D();
    alias.name = mesh.name;
    alias.position.copy(mesh.position);
    alias.quaternion.copy(mesh.quaternion);
    alias.scale.copy(mesh.scale);
    alias.userData = { ...mesh.userData, batchedInto: batchName };
    const owner = mesh.parent;
    owner?.add(alias);
    owner?.remove(mesh);
  }
  for (const sourceGeometry of sourceGeometries) sourceGeometry.dispose();
}

function batchStaticDetails(root: THREE.Group, mats: ScoutMaterials): void {
  const get = (name: string): THREE.Object3D => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`Missing batch parent: ${name}`);
    return node;
  };

  const hairLocks = get('hair-lock-system');
  batchMicroMeshes(hairLocks,
    [
      'bang-center-l', 'bang-center-r', 'bang-mid-l', 'bang-mid-r',
      'temple-lock-l', 'temple-lock-r', 'cheek-wisp-l', 'cheek-wisp-r',
      'rear-lock-center-l', 'rear-lock-center-r', 'rear-lock-outer-l', 'rear-lock-outer-r',
    ],
    'hair-light-locks-batch', mats.hair);
  batchMicroMeshes(hairLocks,
    ['bang-side-l', 'bang-side-r', 'rear-lock-l', 'rear-lock-r', 'nape-lock-l', 'nape-lock-r', 'ahoge'],
    'hair-shadow-locks-batch', mats.hairShadow);

  const face = get('head-face');
  batchMicroMeshes(face, ['eye-l', 'eye-r'], 'eye-whites-batch', mats.eyeWhite);
  batchMicroMeshes(face, ['iris-l', 'iris-r'], 'irises-batch', mats.iris);
  batchMicroMeshes(face, ['pupil-l', 'pupil-r'], 'pupils-batch', mats.pupil);
  batchMicroMeshes(face, ['catchlight-l', 'catchlight-r'], 'catchlights-batch', mats.catchlight);
  batchMicroMeshes(face,
    ['eye-cavity-l', 'eye-cavity-r', 'brow-l', 'brow-r', 'outer-lash-l', 'outer-lash-r'],
    'eye-lines-batch', mats.brown);
  batchMicroMeshes(face, ['lower-lid-l', 'lower-lid-r'], 'lower-lids-batch', mats.skin);
  batchMicroMeshes(face, ['blush-l', 'blush-r'], 'blush-batch', mats.blush);

  const phalanxNames = (suffix: 'l' | 'r') =>
    ['index', 'middle', 'ring', 'little', 'thumb'].flatMap((finger) =>
      [1, 2, 3].map((segment) => `${finger}-${suffix}-${segment}`));
  batchMicroMeshes(get('arm-l'), phalanxNames('l'), 'finger-phalanxes-l-batch', mats.skin);
  batchMicroMeshes(get('arm-r'), phalanxNames('r'), 'finger-phalanxes-r-batch', mats.skin);

  batchMicroMeshes(get('belt-assembly'), ['belt-loop-1', 'belt-loop-2', 'belt-loop-3', 'belt-loop-4'], 'belt-loops-batch', mats.tealDark);
  batchMicroMeshes(get('boot-l'), ['boot-lace-l-1', 'boot-lace-l-2', 'boot-lace-l-3'], 'boot-laces-l-batch', mats.tealDark);
  batchMicroMeshes(get('boot-r'), ['boot-lace-r-1', 'boot-lace-r-2', 'boot-lace-r-3'], 'boot-laces-r-batch', mats.tealDark);
  batchMicroMeshes(get('jacket-shell'), ['jacket-pocket-l', 'jacket-pocket-r'], 'jacket-pockets-batch', mats.coralDark);
  batchMicroMeshes(get('jacket-shell'), ['sailor-piping-l', 'sailor-piping-r'], 'sailor-piping-batch', mats.trim);
  batchMicroMeshes(get('jacket-shell'), ['lapel-coral-l', 'lapel-coral-r'], 'lapel-coral-batch', mats.coral);
  batchMicroMeshes(get('pocket-system'),
    ['front-pocket-l', 'front-pocket-r', 'rear-pocket-l', 'rear-pocket-r', 'shorts-center-seam'],
    'shorts-pocket-seams-batch', mats.teal);
}

function buildBody(root: THREE.Group, mats: ScoutMaterials): RuntimePart[] {
  const body = addModule(root, 'body-core', [0, 0.704, 0], [0, 0.2, -0.25]);
  body.add(
    ellipsoid('chest', mats.skinShadow, [0, 0.04, -0.004], [0.078, 0.122, 0.057]),
    ellipsoid('abdomen', mats.skinShadow, [0, -0.065, -0.004], [0.068, 0.074, 0.052]),
    ellipsoid('pelvis', mats.skinShadow, [0, -0.122, -0.002], [0.076, 0.052, 0.055]),
    orientedCylinder('neck', [0, 0.125, 0], [0, 0.185, 0.004], 0.031, 0.035, mats.skin),
    orientedCapsule('clavicle-l', [-0.006, 0.108, 0.02], [-0.057, 0.099, 0.023], 0.007, mats.skinShadow, 10),
    orientedCapsule('clavicle-r', [0.006, 0.108, 0.02], [0.057, 0.099, 0.023], 0.007, mats.skinShadow, 10),
  );

  const innerTop = addModule(root, 'inner-top-shell', [0, 0.718, 0.018], [0, 0.15, 0.75]);
  const top = loftMesh('mint-top-volume', [
    { y: -0.112, radiusX: 0.061, radiusZ: 0.043, centerZ: -0.003 },
    { y: -0.078, radiusX: 0.071, radiusZ: 0.049 },
    { y: -0.018, radiusX: 0.077, radiusZ: 0.055, centerZ: 0.002 },
    { y: 0.054, radiusX: 0.073, radiusZ: 0.053, centerZ: 0.002 },
    { y: 0.112, radiusX: 0.054, radiusZ: 0.043, centerZ: -0.002 },
  ], mats.mint, [0, 0.005, 0], 64);
  innerTop.add(top);
  innerTop.add(roundedPanel('mint-center-panel', 0.071, 0.153, 0.009, 0.012, mats.mint, [0, 0.004, 0.058]));

  const jacket = addModule(root, 'jacket-shell', [0, 0.735, 0], [0, 0.35, -0.6]);
  jacket.add(
    loftMesh('jacket-back', [
      { y: -0.09, radiusX: 0.081, radiusZ: 0.05, centerZ: -0.004 },
      { y: -0.055, radiusX: 0.09, radiusZ: 0.056, centerZ: -0.002 },
      { y: 0.008, radiusX: 0.097, radiusZ: 0.061 },
      { y: 0.065, radiusX: 0.092, radiusZ: 0.058, centerZ: -0.002 },
      { y: 0.087, radiusX: 0.077, radiusZ: 0.049, centerZ: -0.004 },
    ], mats.coral, [0, -0.003, -0.006], 64),
    roundedPanel('jacket-front-l', 0.052, 0.15, 0.022, 0.016, mats.coral, [-0.059, -0.006, 0.053], [0, -0.08, 0.018]),
    roundedPanel('jacket-front-r', 0.052, 0.15, 0.022, 0.016, mats.coral, [0.059, -0.006, 0.053], [0, 0.08, -0.018]),
    roundedPanel('rear-sailor-collar', 0.142, 0.058, 0.014, 0.008, mats.coralDark, [0, 0.068, -0.071]),
    roundedPanel('rear-collar-trim', 0.124, 0.042, 0.006, 0.006, mats.trim, [0, 0.068, -0.081]),
    roundedPanel('rear-collar-inset', 0.112, 0.032, 0.006, 0.005, mats.coral, [0, 0.069, -0.086]),
    roundedPanel('jacket-pocket-l', 0.019, 0.05, 0.009, 0.004, mats.coralDark, [-0.064, -0.012, 0.066]),
    roundedPanel('jacket-pocket-r', 0.019, 0.05, 0.009, 0.004, mats.coralDark, [0.064, -0.012, 0.066]),
  );
  jacket.add(
    curveMesh('sailor-piping-l', [[-0.074, 0.07, 0.074], [-0.047, 0.052, 0.081], [-0.016, 0.025, 0.083]], 0.0042, 0.0035, mats.trim, 0.8, 8, 6),
    curveMesh('sailor-piping-r', [[0.074, 0.07, 0.074], [0.047, 0.052, 0.081], [0.016, 0.025, 0.083]], 0.0042, 0.0035, mats.trim, 0.8, 8, 6),
    curveMesh('lapel-coral-l', [[-0.078, 0.076, 0.068], [-0.05, 0.056, 0.074], [-0.012, 0.016, 0.077]], 0.009, 0.004, mats.coral, 0.72, 8, 7),
    curveMesh('lapel-coral-r', [[0.078, 0.076, 0.068], [0.05, 0.056, 0.074], [0.012, 0.016, 0.077]], 0.009, 0.004, mats.coral, 0.72, 8, 7),
  );
  const pendantGroup = new THREE.Group();
  pendantGroup.name = 'pendant';
  const pendant = roundedPanel('pendant-badge', 0.032, 0.03, 0.012, 0.006, mats.coral, [0, 0.008, 0.09]);
  const pendantMark = ellipsoid('pendant-mark', mats.trim, [0, 0.01, 0.098], [0.006, 0.009, 0.003], 12);
  pendantGroup.add(pendant, pendantMark);
  jacket.add(pendantGroup);

  const shorts = addModule(root, 'shorts-shell', [0, 0.574, 0], [0, -0.15, -0.45]);
  shorts.add(
    loftMesh('shorts-pelvis-volume', [
      { y: -0.094, radiusX: 0.083, radiusZ: 0.054 },
      { y: -0.045, radiusX: 0.096, radiusZ: 0.062, centerZ: 0.002 },
      { y: 0.025, radiusX: 0.099, radiusZ: 0.066, centerZ: 0.002 },
      { y: 0.081, radiusX: 0.091, radiusZ: 0.06 },
      { y: 0.108, radiusX: 0.078, radiusZ: 0.052 },
    ], mats.teal, [0, 0.018, 0], 64),
    loftMesh('shorts-leg-l', [
      { y: -0.104, radiusX: 0.045, radiusZ: 0.049 },
      { y: -0.055, radiusX: 0.05, radiusZ: 0.056 },
      { y: 0.03, radiusX: 0.051, radiusZ: 0.059 },
    ], mats.teal, [-0.047, 0, 0], 56),
    loftMesh('shorts-leg-r', [
      { y: -0.104, radiusX: 0.045, radiusZ: 0.049 },
      { y: -0.055, radiusX: 0.05, radiusZ: 0.056 },
      { y: 0.03, radiusX: 0.051, radiusZ: 0.059 },
    ], mats.teal, [0.047, 0, 0], 56),
  );
  const pocketSystem = new THREE.Group();
  pocketSystem.name = 'pocket-system';
  pocketSystem.add(
    roundedPanel('front-pocket-l', 0.044, 0.055, 0.006, 0.009, mats.teal, [-0.057, 0.036, 0.067], [0, 0.06, -0.06]),
    roundedPanel('front-pocket-r', 0.044, 0.055, 0.006, 0.009, mats.teal, [0.057, 0.036, 0.067], [0, -0.06, 0.06]),
    roundedPanel('rear-pocket-l', 0.047, 0.055, 0.006, 0.008, mats.teal, [-0.054, 0.027, -0.069]),
    roundedPanel('rear-pocket-r', 0.047, 0.055, 0.006, 0.008, mats.teal, [0.054, 0.027, -0.069]),
    roundedPanel('shorts-center-seam', 0.004, 0.103, 0.004, 0.0015, mats.teal, [0, -0.003, 0.071]),
  );
  shorts.add(pocketSystem);
  shorts.add(
    orientedCylinder('shorts-cuff-l', [-0.047, -0.106, 0], [-0.047, -0.121, 0], 0.0495, 0.0495, mats.trim),
    orientedCylinder('shorts-cuff-r', [0.047, -0.106, 0], [0.047, -0.121, 0], 0.0495, 0.0495, mats.trim),
  );

  const belt = addModule(root, 'belt-assembly', [0, 0.672, 0], [0, 0.02, 0.95]);
  const band = configureMesh(new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.106, 0.019, 56), mats.trim), 'belt-band', true);
  band.scale.z = 0.735;
  belt.add(
    band,
    roundedPanel('belt-front-band', 0.184, 0.019, 0.009, 0.004, mats.trim, [0, 0, 0.078]),
    roundedPanel('belt-buckle', 0.036, 0.027, 0.012, 0.005, mats.trim, [0, 0, 0.084]),
  );
  belt.add(roundedPanel('buckle-inset', 0.021, 0.013, 0.007, 0.003, mats.teal, [0, 0, 0.089]));
  for (const [index, x] of [-0.075, -0.038, 0.038, 0.075].entries()) {
    const frontZ = 0.079 * Math.sqrt(Math.max(0, 1 - (x / 0.106) ** 2));
    belt.add(roundedPanel(`belt-loop-${index + 1}`, 0.011, 0.028, 0.007, 0.002, mats.tealDark, [x, 0.004, frontZ]));
  }

  return [body, innerTop, jacket, shorts, belt];
}

function addEye(group: THREE.Group, side: -1 | 1, mats: ScoutMaterials): void {
  const x = side * 0.032;
  const suffix = side < 0 ? 'l' : 'r';
  const white = ellipsoid(`eye-${suffix}`, mats.eyeWhite, [x, 0.008, 0.081], [0.0185, 0.0132, 0.0048], 48);
  const iris = ellipsoid(`iris-${suffix}`, mats.iris, [x + side * 0.0008, 0.007, 0.0855], [0.0084, 0.0103, 0.0026], 40);
  const pupil = ellipsoid(`pupil-${suffix}`, mats.pupil, [x + side * 0.0008, 0.007, 0.088], [0.0038, 0.007, 0.0016], 36);
  const catchlight = ellipsoid(`catchlight-${suffix}`, mats.catchlight, [x - side * 0.0025, 0.013, 0.09], [0.0024, 0.0031, 0.001], 24);
  const cavity = curveMesh(
    `eye-cavity-${suffix}`,
    [[x - 0.018, 0.017, 0.086], [x, 0.023, 0.09], [x + 0.018, 0.017, 0.086]],
    0.00145,
    0.0007,
    mats.brown,
    0.58,
    24,
    8,
  );
  const brow = curveMesh(
    `brow-${suffix}`,
    [[x - 0.016, 0.039, 0.083], [x, 0.044, 0.087], [x + 0.016, 0.039, 0.083]],
    0.0018,
    0.0011,
    mats.brown,
    0.55,
    20,
    8,
  );
  const lowerLid = curveMesh(
    `lower-lid-${suffix}`,
    [[x - 0.014, -0.002, 0.085], [x, -0.006, 0.087], [x + 0.014, -0.002, 0.085]],
    0.00065,
    0.00025,
    mats.skin,
    0.5,
    18,
    7,
  );
  const outerLash = curveMesh(
    `outer-lash-${suffix}`,
    side < 0
      ? [[x - 0.017, 0.018, 0.086], [x - 0.022, 0.022, 0.085], [x - 0.025, 0.024, 0.083]]
      : [[x + 0.017, 0.018, 0.086], [x + 0.022, 0.022, 0.085], [x + 0.025, 0.024, 0.083]],
    0.0012,
    0.00035,
    mats.brown,
    0.5,
    16,
    7,
  );
  group.add(white, iris, pupil, catchlight, cavity, brow, lowerLid, outerLash);
}

function buildHead(root: THREE.Group, mats: ScoutMaterials): RuntimePart[] {
  const face = addModule(root, 'head-face', [0, 0.925, 0.006], [0, 0.75, 0.6]);
  face.add(
    loftMesh('head', [
      { y: -0.095, radiusX: 0.012, radiusZ: 0.019, centerZ: 0.014 },
      { y: -0.084, radiusX: 0.039, radiusZ: 0.049, centerZ: 0.011 },
      { y: -0.06, radiusX: 0.061, radiusZ: 0.067, centerZ: 0.008 },
      { y: -0.022, radiusX: 0.08, radiusZ: 0.078, centerZ: 0.004 },
      { y: 0.024, radiusX: 0.082, radiusZ: 0.08 },
      { y: 0.061, radiusX: 0.073, radiusZ: 0.074, centerZ: -0.004 },
      { y: 0.085, radiusX: 0.052, radiusZ: 0.058, centerZ: -0.008 },
      { y: 0.097, radiusX: 0.018, radiusZ: 0.024, centerZ: -0.01 },
    ], mats.skin, [0, -0.004, 0], 72),
    ellipsoid('ear-l', mats.skin, [-0.079, -0.004, 0.002], [0.011, 0.02, 0.008], 36),
    ellipsoid('ear-r', mats.skin, [0.079, -0.004, 0.002], [0.011, 0.02, 0.008], 36),
  );
  addEye(face, -1, mats);
  addEye(face, 1, mats);
  face.add(
    profiledCurveMesh('nose', [[0, 0.004, 0.079], [0, -0.014, 0.086], [0, -0.025, 0.087]], [[0, 0.0034, 0.0028], [0.65, 0.003, 0.0026], [1, 0.0044, 0.0034]], mats.skinShadow, 20, 12),
    curveMesh('mouth', [[-0.014, -0.055, 0.081], [0, -0.059, 0.085], [0.014, -0.055, 0.081]], 0.00115, 0.00055, mats.mouth, 0.46, 22, 8),
    ellipsoid('blush-l', mats.blush, [-0.054, -0.031, 0.074], [0.013, 0.005, 0.0016], 28),
    ellipsoid('blush-r', mats.blush, [0.054, -0.031, 0.074], [0.013, 0.005, 0.0016], 28),
  );

  const hair = addModule(root, 'hair-assembly', [0, 0.932, -0.012], [0, 0.95, -0.5]);
  hair.add(loftMesh('hair', [
    { y: -0.112, radiusX: 0.057, radiusZ: 0.052, centerZ: -0.032 },
    { y: -0.082, radiusX: 0.087, radiusZ: 0.078, centerZ: -0.032 },
    { y: -0.02, radiusX: 0.099, radiusZ: 0.09, centerZ: -0.033 },
    { y: 0.048, radiusX: 0.096, radiusZ: 0.088, centerZ: -0.034 },
    { y: 0.095, radiusX: 0.077, radiusZ: 0.075, centerZ: -0.033 },
    { y: 0.118, radiusX: 0.038, radiusZ: 0.046, centerZ: -0.031 },
  ], mats.hairShadow, [0, 0, 0], 72));
  const hairLocks = new THREE.Group();
  hairLocks.name = 'hair-lock-system';
  const locks: Array<{ name: string; points: THREE.Vector3Tuple[]; r: number; mat: Physical; flatten?: number }> = [
    { name: 'bang-center-l', points: [[-0.012, 0.098, 0.052], [-0.018, 0.048, 0.078], [-0.013, -0.022, 0.084]], r: 0.015, mat: mats.hair, flatten: 0.34 },
    { name: 'bang-center-r', points: [[0.012, 0.098, 0.052], [0.019, 0.046, 0.078], [0.014, -0.018, 0.084]], r: 0.015, mat: mats.hair, flatten: 0.34 },
    { name: 'bang-mid-l', points: [[-0.032, 0.094, 0.047], [-0.041, 0.044, 0.076], [-0.035, -0.015, 0.083]], r: 0.017, mat: mats.hair, flatten: 0.34 },
    { name: 'bang-mid-r', points: [[0.032, 0.094, 0.047], [0.041, 0.044, 0.076], [0.035, -0.011, 0.083]], r: 0.017, mat: mats.hair, flatten: 0.34 },
    { name: 'bang-side-l', points: [[-0.052, 0.084, 0.038], [-0.07, 0.026, 0.069], [-0.074, -0.055, 0.067]], r: 0.019, mat: mats.hairShadow, flatten: 0.38 },
    { name: 'bang-side-r', points: [[0.052, 0.084, 0.038], [0.07, 0.026, 0.069], [0.074, -0.052, 0.067]], r: 0.019, mat: mats.hairShadow, flatten: 0.38 },
    { name: 'temple-lock-l', points: [[-0.077, 0.071, 0.015], [-0.091, 0.004, 0.04], [-0.086, -0.087, 0.03]], r: 0.02, mat: mats.hair, flatten: 0.42 },
    { name: 'temple-lock-r', points: [[0.077, 0.071, 0.015], [0.091, 0.004, 0.04], [0.086, -0.084, 0.03]], r: 0.02, mat: mats.hair, flatten: 0.42 },
    { name: 'cheek-wisp-l', points: [[-0.084, 0.036, 0.018], [-0.094, -0.026, 0.047], [-0.078, -0.096, 0.036]], r: 0.013, mat: mats.hair, flatten: 0.32 },
    { name: 'cheek-wisp-r', points: [[0.084, 0.036, 0.018], [0.094, -0.026, 0.047], [0.078, -0.094, 0.036]], r: 0.013, mat: mats.hair, flatten: 0.32 },
    { name: 'rear-lock-l', points: [[-0.07, 0.087, -0.055], [-0.096, 0.0, -0.087], [-0.078, -0.103, -0.072]], r: 0.024, mat: mats.hairShadow, flatten: 0.48 },
    { name: 'rear-lock-r', points: [[0.07, 0.087, -0.055], [0.096, 0.0, -0.087], [0.078, -0.1, -0.072]], r: 0.024, mat: mats.hairShadow, flatten: 0.48 },
    { name: 'rear-lock-center-l', points: [[-0.026, 0.108, -0.079], [-0.038, 0.012, -0.112], [-0.025, -0.11, -0.088]], r: 0.026, mat: mats.hair, flatten: 0.52 },
    { name: 'rear-lock-center-r', points: [[0.026, 0.108, -0.079], [0.038, 0.012, -0.112], [0.025, -0.108, -0.088]], r: 0.026, mat: mats.hair, flatten: 0.52 },
    { name: 'rear-lock-outer-l', points: [[-0.048, 0.101, -0.072], [-0.07, 0.004, -0.105], [-0.055, -0.11, -0.08]], r: 0.023, mat: mats.hair, flatten: 0.5 },
    { name: 'rear-lock-outer-r', points: [[0.048, 0.101, -0.072], [0.07, 0.004, -0.105], [0.055, -0.108, -0.08]], r: 0.023, mat: mats.hair, flatten: 0.5 },
    { name: 'nape-lock-l', points: [[-0.061, 0.006, -0.088], [-0.069, -0.055, -0.101], [-0.052, -0.116, -0.077]], r: 0.018, mat: mats.hairShadow, flatten: 0.4 },
    { name: 'nape-lock-r', points: [[0.061, 0.006, -0.088], [0.069, -0.055, -0.101], [0.052, -0.114, -0.077]], r: 0.018, mat: mats.hairShadow, flatten: 0.4 },
  ];
  for (const lock of locks) {
    hairLocks.add(curveMesh(lock.name, lock.points, lock.r, 0.0022, lock.mat, lock.flatten ?? 0.42, 44, 14));
  }
  hairLocks.add(curveMesh('ahoge', [[0, 0.112, -0.004], [-0.012, 0.145, -0.002], [0.004, 0.174, 0], [0.031, 0.162, 0.002], [0.022, 0.142, 0.004]], 0.0035, 0.0008, mats.hairShadow, 0.62, 40, 12));
  hair.add(hairLocks);

  const earL = buildCatEar(root, -1, mats);
  const earR = buildCatEar(root, 1, mats);
  return [face, hair, earL, earR];
}

function buildCatEar(root: THREE.Group, side: -1 | 1, mats: ScoutMaterials): RuntimePart {
  const ear = addModule(root, side < 0 ? 'cat-ear-l' : 'cat-ear-r', [side * 0.057, 1.012, -0.005], [side * 0.85, 0.95, 0]);
  // A shallow outward cant keeps the ear triangular in both front and profile views.
  ear.rotation.y = side * 0.24;
  const outer = loftMesh(`${ear.name}-outer`, [
    { y: 0, radiusX: 0.03, radiusZ: 0.024 },
    { y: 0.025, radiusX: 0.027, radiusZ: 0.021 },
    { y: 0.052, radiusX: 0.018, radiusZ: 0.014, centerX: side * -0.002 },
    { y: 0.075, radiusX: 0.0025, radiusZ: 0.003, centerX: side * -0.004 },
  ], mats.hair, [0, 0, 0], 48);
  outer.rotation.z = side * -0.08;
  const tip = loftMesh(`${ear.name}-dark-tip`, [
    { y: 0, radiusX: 0.016, radiusZ: 0.013 },
    { y: 0.017, radiusX: 0.009, radiusZ: 0.008 },
    { y: 0.025, radiusX: 0.002, radiusZ: 0.002 },
  ], mats.brown, [side * -0.003, 0.052, 0], 36);
  tip.rotation.z = side * -0.08;
  const inner = configureMesh(new THREE.Mesh(triangleGeometry(0.038, 0.048, 0.006), mats.earInner), `${ear.name}-inner`, true);
  inner.position.set(side * -0.002, 0.011, 0.022);
  inner.rotation.z = side * -0.08;
  const tuftA = curveMesh(`${ear.name}-tuft-a`, [[side * -0.014, 0.014, 0.026], [side * -0.01, 0.032, 0.03], [side * -0.004, 0.041, 0.027]], 0.003, 0.00045, mats.trim, 0.38, 22, 8);
  const tuftB = curveMesh(`${ear.name}-tuft-b`, [[0, 0.012, 0.027], [side * 0.001, 0.03, 0.031], [side * 0.006, 0.044, 0.027]], 0.0032, 0.00045, mats.trim, 0.38, 22, 8);
  const tuftC = curveMesh(`${ear.name}-tuft-c`, [[side * 0.013, 0.014, 0.026], [side * 0.011, 0.03, 0.03], [side * 0.008, 0.039, 0.026]], 0.0028, 0.0004, mats.trim, 0.38, 22, 8);
  ear.add(outer, tip, inner, tuftA, tuftB, tuftC);
  return ear;
}

function buildArm(root: THREE.Group, side: -1 | 1, mats: ScoutMaterials): RuntimePart {
  const suffix = side < 0 ? 'l' : 'r';
  const arm = addModule(root, `arm-${suffix}`, [side * 0.1, 0.785, 0], [side, 0.18, 0.22]);
  const shoulder: THREE.Vector3Tuple = [0, 0, 0];
  const cuffTop: THREE.Vector3Tuple = [side * 0.034, -0.083, 0.003];
  const cuffBottom: THREE.Vector3Tuple = [side * 0.047, -0.111, 0.004];
  const elbow: THREE.Vector3Tuple = [side * 0.083, -0.188, 0.008];
  const wrist: THREE.Vector3Tuple = [side * 0.132, -0.294, 0.014];
  const palmEnd: THREE.Vector3Tuple = [side * 0.143, -0.339, 0.025];

  const glove = new THREE.Group();
  glove.name = `glove-${suffix}`;
  glove.add(
    profiledCurveMesh(
      `glove-cuff-${suffix}`,
      [[side * 0.115, -0.258, 0.012], [side * 0.126, -0.28, 0.014], wrist],
      [[0, 0.023, 0.021], [0.62, 0.024, 0.022], [1, 0.021, 0.019]],
      mats.teal,
      28,
      20,
    ),
    profiledCurveMesh(
      `hand-${suffix}`,
      [wrist, [side * 0.139, -0.318, 0.019], palmEnd],
      [[0, 0.021, 0.019], [0.55, 0.023, 0.015], [1, 0.017, 0.012]],
      mats.tealDark,
      28,
      20,
    ),
  );
  glove.add(roundedPanel(
    `glove-strap-${suffix}`,
    0.032,
    0.011,
    0.006,
    0.003,
    mats.teal,
    [side * 0.133, -0.301, 0.033],
    [0, 0, side * -0.2],
  ));

  const skinLimb = profiledCurveMesh(
    `upper-arm-${suffix}`,
    [cuffBottom, [side * 0.064, -0.15, 0.006], elbow, [side * 0.107, -0.238, 0.011], wrist],
    [
      [0, 0.022, 0.021],
      [0.34, 0.023, 0.022],
      [0.5, 0.021, 0.021],
      [0.76, 0.0195, 0.019],
      [1, 0.016, 0.016],
    ],
    mats.skin,
    60,
    24,
  );
  const forearmAlias = new THREE.Object3D();
  forearmAlias.name = `forearm-${suffix}`;
  forearmAlias.position.set(...elbow);
  forearmAlias.userData.continuousWith = `upper-arm-${suffix}`;

  arm.add(
    profiledCurveMesh(
      `sleeve-${suffix}`,
      [shoulder, [side * 0.012, -0.04, 0.002], cuffTop],
      [[0, 0.041, 0.037], [0.52, 0.044, 0.039], [1, 0.036, 0.033]],
      mats.coral,
      32,
      28,
    ),
    profiledCurveMesh(
      `sleeve-cuff-${suffix}`,
      [cuffTop, cuffBottom],
      [[0, 0.037, 0.034], [1, 0.034, 0.031]],
      mats.trim,
      18,
      28,
    ),
    skinLimb,
    forearmAlias,
    glove,
  );

  const emblem = ellipsoid(`sleeve-emblem-${suffix}`, mats.teal, [side * 0.031, -0.097, 0.036], [0.0055, 0.0075, 0.0022], 28);
  arm.add(emblem);
  const fingerStartY = -0.332;
  const fingerLengths = [0.043, 0.049, 0.047, 0.039];
  const fingerZ = [0.02, 0.025, 0.026, 0.023];
  const fingerNames = ['index', 'middle', 'ring', 'little'];
  for (let i = 0; i < fingerNames.length; i++) {
    const spread = (i - 1.5) * 0.0075;
    const start = new THREE.Vector3(side * 0.142 + spread, fingerStartY, fingerZ[i]);
    const end = new THREE.Vector3(side * 0.143 + spread, fingerStartY - fingerLengths[i], fingerZ[i] + 0.004);
    for (let segment = 0; segment < 3; segment++) {
      const a = start.clone().lerp(end, segment / 3).toArray() as THREE.Vector3Tuple;
      const b = start.clone().lerp(end, (segment + 1) / 3).toArray() as THREE.Vector3Tuple;
      const radius = 0.0043 - segment * 0.00028;
      arm.add(orientedCylinder(
        `${fingerNames[i]}-${suffix}-${segment + 1}`,
        a,
        b,
        radius * 0.92,
        radius,
        mats.skin,
        14,
      ));
    }
  }
  const thumbStart = new THREE.Vector3(side * 0.127, -0.315, 0.025);
  const thumbEnd = new THREE.Vector3(side * 0.113, -0.341, 0.034);
  for (let segment = 0; segment < 3; segment++) {
    const a = thumbStart.clone().lerp(thumbEnd, segment / 3).toArray() as THREE.Vector3Tuple;
    const b = thumbStart.clone().lerp(thumbEnd, (segment + 1) / 3).toArray() as THREE.Vector3Tuple;
    const radius = 0.0054 - segment * 0.0003;
    arm.add(orientedCylinder(`thumb-${suffix}-${segment + 1}`, a, b, radius * 0.92, radius, mats.skin, 14));
  }
  return arm;
}

function buildLeg(root: THREE.Group, side: -1 | 1, mats: ScoutMaterials): RuntimePart {
  const suffix = side < 0 ? 'l' : 'r';
  const leg = addModule(root, `leg-${suffix}`, [side * 0.055, 0.575, 0], [side * 0.55, -0.9, 0]);
  const continuousLeg = profiledCurveMesh(
    `thigh-${suffix}`,
    [
      [0, -0.052, 0],
      [side * 0.003, -0.14, 0.002],
      [0, -0.226, 0.006],
      [side * 0.002, -0.302, 0.01],
      [0, -0.408, 0.015],
    ],
    [
      [0, 0.039, 0.036],
      [0.28, 0.041, 0.037],
      [0.49, 0.03, 0.029],
      [0.7, 0.034, 0.032],
      [1, 0.024, 0.024],
    ],
    mats.skin,
    72,
    28,
  );
  const kneeAlias = new THREE.Object3D();
  kneeAlias.name = `knee-${suffix}`;
  kneeAlias.position.set(0, -0.226, 0.006);
  kneeAlias.userData.continuousWith = `thigh-${suffix}`;
  const shinAlias = new THREE.Object3D();
  shinAlias.name = `shin-${suffix}`;
  shinAlias.position.set(0, -0.31, 0.011);
  shinAlias.userData.continuousWith = `thigh-${suffix}`;
  leg.add(continuousLeg, kneeAlias, shinAlias);
  return leg;
}

function buildBoot(root: THREE.Group, side: -1 | 1, mats: ScoutMaterials): RuntimePart {
  const suffix = side < 0 ? 'l' : 'r';
  const boot = addModule(root, `boot-${suffix}`, [side * 0.055, 0.12, 0.012], [side * 0.75, -0.95, 0.55]);
  const shaft = loftMesh(`boot-shaft-${suffix}`, [
    { y: -0.054, radiusX: 0.031, radiusZ: 0.027, centerZ: 0.003 },
    { y: -0.008, radiusX: 0.033, radiusZ: 0.029, centerZ: 0.002 },
    { y: 0.052, radiusX: 0.036, radiusZ: 0.031 },
    { y: 0.068, radiusX: 0.038, radiusZ: 0.033 },
  ], mats.boot, [0, 0, 0], 48);
  const toe = profiledCurveMesh(
    `foot-${suffix}`,
    [[0, -0.054, -0.004], [0, -0.071, 0.028], [0, -0.079, 0.076]],
    [[0, 0.031, 0.028], [0.5, 0.039, 0.027], [1, 0.039, 0.019]],
    mats.boot,
    44,
    28,
  );
  const sole = roundedPanel(`boot-sole-${suffix}`, 0.076, 0.016, 0.115, 0.01, mats.bootSole, [0, -0.106, 0.03]);
  const strap = loftMesh(`boot-strap-${suffix}`, [
    { y: -0.01, radiusX: 0.038, radiusZ: 0.033 },
    { y: 0.01, radiusX: 0.039, radiusZ: 0.034 },
  ], mats.coral, [0, 0.043, 0], 48);
  const tongue = roundedPanel(`boot-tongue-${suffix}`, 0.025, 0.09, 0.01, 0.006, mats.teal, [0, -0.006, 0.043], [-0.08, 0, 0]);
  const toeCap = roundedPanel(`boot-toe-cap-${suffix}`, 0.065, 0.022, 0.044, 0.009, mats.bootSole, [0, -0.073, 0.077]);
  const heel = roundedPanel(`boot-heel-${suffix}`, 0.057, 0.019, 0.028, 0.007, mats.bootSole, [0, -0.087, -0.018]);
  boot.add(shaft, toe, sole, strap, tongue, toeCap, heel);
  for (let i = 0; i < 3; i++) {
    boot.add(roundedPanel(`boot-lace-${suffix}-${i + 1}`, 0.031, 0.0038, 0.0045, 0.0015, mats.tealDark, [0, 0.009 - i * 0.018, 0.05]));
  }
  return boot;
}

function buildTail(root: THREE.Group, mats: ScoutMaterials): RuntimePart {
  const tail = addModule(root, 'tail-assembly', [0, 0.617, -0.07], [0, -0.35, -1]);
  tail.add(
    profiledCurveMesh(
      'tail-main',
      [[0, 0, 0], [0, 0.018, -0.065], [0, -0.06, -0.126], [0, -0.205, -0.143], [0, -0.318, -0.126]],
      [[0, 0.024, 0.022], [0.38, 0.023, 0.021], [0.75, 0.02, 0.019], [1, 0.0175, 0.017]],
      mats.hair,
      72,
      24,
    ),
    profiledCurveMesh(
      'tail-dark-tip',
      [[0, -0.312, -0.127], [0, -0.352, -0.121], [0, -0.393, -0.111]],
      [[0, 0.018, 0.0175], [0.55, 0.014, 0.0135], [1, 0.007, 0.0065]],
      mats.brown,
      32,
      20,
    ),
  );
  return tail;
}

function createSocket(root: THREE.Group, name: string, position: THREE.Vector3Tuple): THREE.Object3D {
  const socket = new THREE.Object3D();
  socket.name = name;
  socket.position.set(...position);
  socket.visible = false;
  root.add(socket);
  return socket;
}

function collectNodes(root: THREE.Object3D): Record<string, THREE.Object3D> {
  const nodes: Record<string, THREE.Object3D> = {};
  root.traverse((node) => {
    if (node.name) nodes[node.name] = node;
  });
  return nodes;
}

/**
 * Textureless procedural Ink Tide Scout catgirl.
 * The model is a rigid semantic-pivot assembly (not a deforming skin rig): each major module is
 * independently named/selectable and can be replaced by a future SkinnedMesh without changing IDs.
 */
export function createInkTideScoutProcModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ink-tide-scout-proc';
  const mats = buildMaterials();

  const parts: RuntimePart[] = [
    ...buildBody(root, mats),
    ...buildHead(root, mats),
    buildArm(root, -1, mats),
    buildArm(root, 1, mats),
    buildLeg(root, -1, mats),
    buildLeg(root, 1, mats),
    buildBoot(root, -1, mats),
    buildBoot(root, 1, mats),
    buildTail(root, mats),
  ];
  batchStaticDetails(root, mats);

  const sockets = {
    pelvis: createSocket(root, 'socket-pelvis', [0, 0.59, 0]),
    head: createSocket(root, 'socket-head', [0, 0.825, 0]),
    shoulderL: createSocket(root, 'socket-shoulder-l', [-0.1, 0.785, 0]),
    shoulderR: createSocket(root, 'socket-shoulder-r', [0.1, 0.785, 0]),
    hipL: createSocket(root, 'socket-hip-l', [-0.055, 0.575, 0]),
    hipR: createSocket(root, 'socket-hip-r', [0.055, 0.575, 0]),
    tailRoot: createSocket(root, 'socket-tail-root', [0, 0.617, -0.07]),
    handL: createSocket(root, 'socket-hand-l', [-0.24, 0.45, 0.025]),
    handR: createSocket(root, 'socket-hand-r', [0.24, 0.45, 0.025]),
  };

  // Normalize after construction: minY=0 and exact total height=1.1, while preserving +Z front.
  const unscaledBox = new THREE.Box3().setFromObject(root);
  const unscaledHeight = unscaledBox.max.y - unscaledBox.min.y;
  const normalizationScale = 1.1 / unscaledHeight;
  root.scale.setScalar(normalizationScale);
  root.position.y = -unscaledBox.min.y * normalizationScale;
  root.updateMatrixWorld(true);

  const basePositions = new Map(parts.map((part) => [part.name, part.position.clone()]));
  const baseQuaternions = new Map(parts.map((part) => [part.name, part.quaternion.clone()]));
  const center = new THREE.Vector3(0, 0.55 / normalizationScale, 0);
  const nodes = collectNodes(root);
  const sculptRuntime = {
    source: 'img2threejs procedural (spec: .img2threejs/ink-tide-scout/object-sculpt-spec.json)',
    rigKind: 'rigid-semantic-pivots',
    parts: parts.map((part) => part.name),
    nodes,
    sockets,
    colliders: {
      torso: { type: 'capsule', center: [0, 0.69, 0], radius: 0.09, height: 0.31 },
      head: { type: 'sphere', center: [0, 0.91, 0], radius: 0.12 },
      legs: { type: 'capsule-pair', centers: [[-0.055, 0.35, 0], [0.055, 0.35, 0]], radius: 0.05, height: 0.43 },
    },
    destructionGroups: {
      head: ['head-face', 'hair-assembly', 'cat-ear-l', 'cat-ear-r'],
      outfit: ['inner-top-shell', 'jacket-shell', 'shorts-shell', 'belt-assembly'],
      limbs: ['arm-l', 'arm-r', 'leg-l', 'leg-r', 'boot-l', 'boot-r'],
      tail: ['tail-assembly'],
    },
    normalizationScale,
    /** Exploded layout scales each pivot about the model center, with clearance for central shells. */
    explode(factor: number): void {
      const amount = Number.isFinite(factor) ? Math.max(0, factor) : 0;
      for (const part of parts) {
        const base = basePositions.get(part.name)!;
        const scaled = base.clone().sub(center).multiplyScalar(1 + amount).add(center);
        const direction = new THREE.Vector3(...(part.userData.explodeDirection ?? [0, 0, 0])).normalize();
        const centerDistance = base.distanceTo(center);
        const clearance = centerDistance < 0.12 ? 0.1 * amount : 0.035 * amount;
        part.position.copy(scaled).addScaledVector(direction, clearance);
      }
      root.updateMatrixWorld(true);
    },
    resetPose(): void {
      for (const part of parts) {
        part.position.copy(basePositions.get(part.name)!);
        part.quaternion.copy(baseQuaternions.get(part.name)!);
      }
      root.updateMatrixWorld(true);
    },
  };
  // Object3D.clone serializes enumerable userData as JSON. Keep live Object3D references and
  // methods non-enumerable so explicit clones stay cycle-safe; factory-owned display paths keep
  // this original instance through rotatedObject(..., false), preserving the live runtime.
  Object.defineProperty(root.userData, 'sculptRuntime', {
    value: sculptRuntime,
    enumerable: false,
    configurable: false,
  });
  root.userData.sculptRuntimeMeta = {
    source: sculptRuntime.source,
    rigKind: sculptRuntime.rigKind,
    qualityPreset: 'high-fidelity-200k',
    surfaceStrategy: 'lofted-anatomy-and-parallel-transport-sweeps',
    parts: sculptRuntime.parts,
    socketNames: Object.keys(sockets),
    colliderNames: Object.keys(sculptRuntime.colliders),
    destructionGroupNames: Object.keys(sculptRuntime.destructionGroups),
    normalizationScale,
  };

  return root;
}
