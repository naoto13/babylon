import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SEGMENTS = 20;
const force = process.argv.slice(2).includes("--force");
const outputDir = fileURLToPath(new URL("../assets/models/", import.meta.url));

// Include cauldron so a clean checkout is completely runnable, but never
// replace a supplied hero asset unless --force was explicitly requested.
const PLACEHOLDERS = [
  { filename: "cauldron.glb", shape: "cone", size: [2.05, 1.15, 2.05], colour: "#17213a" },
  { filename: "cutting-board.glb", shape: "box", size: [1.9, 0.18, 1.45], colour: "#8b5c3c" },
  { filename: "knife.glb", shape: "box", size: [1.15, 0.07, 0.12], colour: "#9ba7b7" },
  { filename: "mortar.glb", shape: "cone", size: [1.35, 0.55, 1.35], colour: "#464d57" },
  { filename: "pestle.glb", shape: "cylinder", size: [0.22, 0.9, 0.22], colour: "#805738" },
  { filename: "heat-dial.glb", shape: "cylinder", size: [0.88, 0.17, 0.88], colour: "#c59b54" },
  { filename: "appraisal-lens.glb", shape: "cone", size: [0.95, 0.95, 0.95], colour: "#d1a94f" },
  { filename: "delivery-tray.glb", shape: "cylinder", size: [1.25, 0.13, 1.25], colour: "#725040" },
  { filename: "jar.glb", shape: "cone", size: [0.55, 0.95, 0.55], colour: "#205c8f" },
];

function addVertex(geometry, position, normal) {
  const index = geometry.positions.length / 3;
  geometry.positions.push(...position);
  geometry.normals.push(...normal);
  return index;
}

function addTriangle(geometry, a, b, c, normalA, normalB = normalA, normalC = normalA) {
  geometry.indices.push(
    addVertex(geometry, a, normalA),
    addVertex(geometry, b, normalB),
    addVertex(geometry, c, normalC),
  );
}

function buildBox(width, height, depth) {
  const geometry = { positions: [], normals: [], indices: [] };
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces = [
    { normal: [1, 0, 0], points: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
    { normal: [-1, 0, 0], points: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
    { normal: [0, 1, 0], points: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
    { normal: [0, -1, 0], points: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
    { normal: [0, 0, 1], points: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { normal: [0, 0, -1], points: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
  ];
  for (const { normal, points } of faces) {
    addTriangle(geometry, points[0], points[1], points[2], normal);
    addTriangle(geometry, points[0], points[2], points[3], normal);
  }
  return geometry;
}

function buildCylinder(width, height, depth, topScale = 1) {
  const geometry = { positions: [], normals: [], indices: [] };
  const bottomRadiusX = width / 2;
  const bottomRadiusZ = depth / 2;
  const topRadiusX = bottomRadiusX * topScale;
  const topRadiusZ = bottomRadiusZ * topScale;
  const lowerY = -height / 2;
  const upperY = height / 2;
  const slope = (bottomRadiusX - topRadiusX) / Math.max(height, 0.00001);
  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    const theta0 = (segment / SEGMENTS) * Math.PI * 2;
    const theta1 = ((segment + 1) / SEGMENTS) * Math.PI * 2;
    const point = (radiusX, radiusZ, y, theta) => [radiusX * Math.cos(theta), y, radiusZ * Math.sin(theta)];
    const normal = (theta) => {
      const x = Math.cos(theta);
      const z = Math.sin(theta);
      const length = Math.hypot(x, slope, z);
      return [x / length, slope / length, z / length];
    };
    const bottom0 = point(bottomRadiusX, bottomRadiusZ, lowerY, theta0);
    const bottom1 = point(bottomRadiusX, bottomRadiusZ, lowerY, theta1);
    const top0 = point(topRadiusX, topRadiusZ, upperY, theta0);
    const top1 = point(topRadiusX, topRadiusZ, upperY, theta1);
    addTriangle(geometry, bottom0, top1, bottom1, normal(theta0), normal(theta1), normal(theta1));
    addTriangle(geometry, bottom0, top0, top1, normal(theta0), normal(theta0), normal(theta1));
    addTriangle(geometry, [0, lowerY, 0], bottom1, bottom0, [0, -1, 0]);
    addTriangle(geometry, [0, upperY, 0], top0, top1, [0, 1, 0]);
  }
  return geometry;
}

function geometryFor({ shape, size }) {
  const [width, height, depth] = size;
  if (shape === "box") return buildBox(width, height, depth);
  if (shape === "cone") return buildCylinder(width, height, depth, 0.48);
  return buildCylinder(width, height, depth);
}

function pad4(buffer) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, 0x20)]) : buffer;
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255, 1];
}

function makeGlb(placeholder) {
  const geometry = geometryFor(placeholder);
  const positions = Buffer.from(new Float32Array(geometry.positions).buffer);
  const normals = Buffer.from(new Float32Array(geometry.normals).buffer);
  const indices = Buffer.from(new Uint16Array(geometry.indices).buffer);
  const positionChunk = pad4(positions);
  const normalChunk = pad4(normals);
  const indexChunk = pad4(indices);
  const binary = Buffer.concat([positionChunk, normalChunk, indexChunk]);
  const xs = geometry.positions.filter((_, index) => index % 3 === 0);
  const ys = geometry.positions.filter((_, index) => index % 3 === 1);
  const zs = geometry.positions.filter((_, index) => index % 3 === 2);
  const json = {
    asset: { version: "2.0", generator: "moonlit-potion-workshop make-placeholder-glbs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: placeholder.filename.replace(".glb", "-placeholder") }],
    meshes: [{
      name: placeholder.filename.replace(".glb", "-placeholder"),
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    }],
    materials: [{
      name: `${placeholder.shape}-tint`,
      pbrMetallicRoughness: {
        baseColorFactor: rgb(placeholder.colour),
        metallicFactor: placeholder.shape === "box" ? 0.2 : 0.55,
        roughnessFactor: 0.48,
      },
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positionChunk.length, byteLength: normals.length, target: 34962 },
      { buffer: 0, byteOffset: positionChunk.length + normalChunk.length, byteLength: indices.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: geometry.positions.length / 3, type: "VEC3", min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)] },
      { bufferView: 1, componentType: 5126, count: geometry.normals.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: geometry.indices.length, type: "SCALAR" },
    ],
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), "utf8"));
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]);
}

mkdirSync(outputDir, { recursive: true });
for (const placeholder of PLACEHOLDERS) {
  const outputPath = new URL(placeholder.filename, `file://${outputDir}`).pathname;
  if (existsSync(outputPath) && !force) {
    console.log(`SKIPPED ${relative(process.cwd(), outputPath) || outputPath} (exists; pass --force to replace)`);
    continue;
  }
  const glb = makeGlb(placeholder);
  writeFileSync(outputPath, glb);
  console.log(`CREATED ${relative(process.cwd(), outputPath) || outputPath} (${glb.length} bytes)`);
}
