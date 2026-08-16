// インク塗り地面: 大平面 + CanvasTexture。splat 描画と塗り率トラッキング。
import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, COLORS } from './config';

const TEX_SIZE = 1024;
const GRID = 128; // 塗り率カウント用グリッド
const PPU = TEX_SIZE / ARENA_SIZE; // pixels per world unit

export class InkGround {
  readonly mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private grid = new Uint8Array(GRID * GRID);
  private paintedCells = 0;
  private inkColors = [COLORS.inkMain, COLORS.inkAlt, COLORS.inkLight];

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TEX_SIZE;
    this.canvas.height = TEX_SIZE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.paintBase();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    geo.rotateX(-Math.PI / 2);
    // インクの発色を素直に出すため無ライティングのフラット描画
    const mat = new THREE.MeshBasicMaterial({ map: this.texture });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = 0;
    scene.add(this.mesh);
  }

  private paintBase(): void {
    const c = this.ctx;
    c.fillStyle = COLORS.groundBase;
    c.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    // 奥行きの手がかりになる薄いグリッド
    c.strokeStyle = COLORS.groundGrid;
    c.lineWidth = 2;
    const step = TEX_SIZE / 20;
    c.beginPath();
    for (let i = 0; i <= 20; i++) {
      c.moveTo(i * step, 0);
      c.lineTo(i * step, TEX_SIZE);
      c.moveTo(0, i * step);
      c.lineTo(TEX_SIZE, i * step);
    }
    c.stroke();
  }

  /** world 座標 (x,z) に半径 r のスプラットを描く */
  splat(x: number, z: number, r: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r) || r <= 0) return;
    const px = (x + ARENA_HALF) * PPU;
    const py = (z + ARENA_HALF) * PPU;
    const pr = r * PPU;
    const c = this.ctx;
    c.fillStyle = this.inkColors[(Math.random() * this.inkColors.length) | 0];

    // メインの塊（少し潰した楕円をランダム回転）
    c.save();
    c.translate(px, py);
    c.rotate(Math.random() * Math.PI * 2);
    c.beginPath();
    c.ellipse(0, 0, pr * (0.85 + Math.random() * 0.3), pr * (0.7 + Math.random() * 0.3), 0, 0, Math.PI * 2);
    c.fill();
    // 飛び散る小滴
    const drops = 4 + ((Math.random() * 4) | 0);
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = pr * (0.8 + Math.random() * 0.9);
      const dr = pr * (0.12 + Math.random() * 0.22);
      c.beginPath();
      c.ellipse(Math.cos(a) * d, Math.sin(a) * d, dr, dr * (0.6 + Math.random() * 0.4), a, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    this.texture.needsUpdate = true;

    // 塗り率グリッド更新（メイン塊ぶんのみ、近似）
    const cellSize = ARENA_SIZE / GRID;
    const gr = Math.max(1, Math.round((r * 0.8) / cellSize));
    const gx = Math.floor((x + ARENA_HALF) / cellSize);
    const gz = Math.floor((z + ARENA_HALF) / cellSize);
    for (let iz = gz - gr; iz <= gz + gr; iz++) {
      if (iz < 0 || iz >= GRID) continue;
      for (let ix = gx - gr; ix <= gx + gr; ix++) {
        if (ix < 0 || ix >= GRID) continue;
        if ((ix - gx) * (ix - gx) + (iz - gz) * (iz - gz) > gr * gr) continue;
        const idx = iz * GRID + ix;
        if (this.grid[idx] === 0) {
          this.grid[idx] = 1;
          this.paintedCells++;
        }
      }
    }
  }

  /** 塗り面積率 (0-100) */
  coverage(): number {
    return (this.paintedCells / (GRID * GRID)) * 100;
  }

  reset(): void {
    this.grid.fill(0);
    this.paintedCells = 0;
    this.paintBase();
    this.texture.needsUpdate = true;
  }
}
