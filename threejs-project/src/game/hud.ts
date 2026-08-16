// HUD: HP/XP バー、統計チップ、レベルアップ 3 択、ゲームオーバー画面
// apple-design 原則: 半透明マテリアル + restraint、変化した値だけ DOM 更新
import type { Upgrade } from './upgrades';

export interface HudView {
  hp: number;
  maxHp: number;
  xp: number;
  xpNext: number;
  level: number;
  elapsed: number;
  kills: number;
  coverage: number;
}

export interface GameResult {
  elapsed: number;
  kills: number;
  level: number;
  coverage: number;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Hud {
  private root: HTMLElement;
  private hpFill!: HTMLElement;
  private xpFill!: HTMLElement;
  private levelEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private killsEl!: HTMLElement;
  private inkEl!: HTMLElement;
  private overlay!: HTMLElement;
  private cache: Partial<HudView> = {};
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud">
        <div class="hud-left">
          <div class="bar hp"><div class="bar-fill"></div></div>
          <div class="bar xp"><div class="bar-fill"></div></div>
        </div>
        <div class="hud-right">
          <span class="chip level">Lv 1</span>
          <span class="chip time">0:00</span>
          <span class="chip kills">✕ 0</span>
          <span class="chip ink">▨ 0.0%</span>
        </div>
      </div>
      <div class="overlay" hidden></div>
    `;
    this.hpFill = root.querySelector('.hp .bar-fill')!;
    this.xpFill = root.querySelector('.xp .bar-fill')!;
    this.levelEl = root.querySelector('.chip.level')!;
    this.timeEl = root.querySelector('.chip.time')!;
    this.killsEl = root.querySelector('.chip.kills')!;
    this.inkEl = root.querySelector('.chip.ink')!;
    this.overlay = root.querySelector('.overlay')!;
  }

  update(v: HudView): void {
    const c = this.cache;
    if (c.hp !== v.hp || c.maxHp !== v.maxHp) {
      const frac = Math.max(0, v.hp / v.maxHp);
      this.hpFill.style.width = `${frac * 100}%`;
      this.hpFill.classList.toggle('low', frac < 0.3);
    }
    if (c.xp !== v.xp || c.xpNext !== v.xpNext) {
      this.xpFill.style.width = `${Math.min(1, v.xp / v.xpNext) * 100}%`;
    }
    if (c.level !== v.level) this.levelEl.textContent = `Lv ${v.level}`;
    const t = Math.floor(v.elapsed);
    if (Math.floor(c.elapsed ?? -1) !== t) this.timeEl.textContent = fmtTime(v.elapsed);
    if (c.kills !== v.kills) this.killsEl.textContent = `✕ ${v.kills}`;
    const cov = v.coverage.toFixed(1);
    if ((c.coverage ?? -1).toFixed?.(1) !== cov) this.inkEl.textContent = `▨ ${cov}%`;
    this.cache = { ...v };
  }

  /** レベルアップ 3 択。onPick は一度だけ呼ばれる */
  showLevelUp(options: Upgrade[], onPick: (index: number) => void): void {
    this.clearKeyHandler();
    let picked = false;
    const pick = (i: number) => {
      if (picked || i < 0 || i >= options.length) return;
      picked = true;
      this.clearKeyHandler();
      this.hideOverlay();
      onPick(i);
    };
    this.overlay.innerHTML = `
      <div class="panel levelup">
        <p class="panel-eyebrow">LEVEL UP</p>
        <h2 class="panel-title">強化を1つ選ぶ</h2>
        <div class="cards">
          ${options
            .map(
              (u, i) => `
            <button class="card" data-i="${i}" style="--stagger:${i}">
              <span class="card-icon">${u.icon}</span>
              <span class="card-body">
                <span class="card-name">${u.name}</span>
                <span class="card-desc">${u.desc}</span>
              </span>
              <span class="card-key">${i + 1}</span>
            </button>`
            )
            .join('')}
        </div>
      </div>
    `;
    this.overlay.hidden = false;
    requestAnimationFrame(() => this.overlay.classList.add('shown'));
    this.overlay.querySelectorAll<HTMLButtonElement>('.card').forEach((btn) => {
      btn.addEventListener('click', () => pick(Number(btn.dataset.i)));
    });
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') pick(0);
      if (e.code === 'Digit2' || e.code === 'Numpad2') pick(1);
      if (e.code === 'Digit3' || e.code === 'Numpad3') pick(2);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  showGameOver(r: GameResult, onRestart: () => void): void {
    this.clearKeyHandler();
    let restarted = false;
    this.overlay.innerHTML = `
      <div class="panel gameover">
        <p class="panel-eyebrow">GAME OVER</p>
        <h2 class="panel-title">インクに沈んだ…</h2>
        <dl class="results">
          <div><dt>生存時間</dt><dd>${fmtTime(r.elapsed)}</dd></div>
          <div><dt>撃破数</dt><dd>${r.kills}</dd></div>
          <div><dt>レベル</dt><dd>${r.level}</dd></div>
          <div><dt>塗り率</dt><dd>${r.coverage.toFixed(1)}%</dd></div>
        </dl>
        <button class="restart">もう一度ぬる</button>
      </div>
    `;
    this.overlay.hidden = false;
    requestAnimationFrame(() => this.overlay.classList.add('shown'));
    this.overlay.querySelector<HTMLButtonElement>('.restart')!.addEventListener('click', () => {
      if (restarted) return;
      restarted = true;
      this.hideOverlay();
      onRestart();
    });
  }

  hideOverlay(): void {
    this.overlay.classList.remove('shown');
    this.overlay.hidden = true;
    this.overlay.innerHTML = '';
  }

  /** オーバーレイとキーハンドラを確実に両方破棄する（restart 経路用） */
  cancelOverlay(): void {
    this.clearKeyHandler();
    this.hideOverlay();
  }

  private clearKeyHandler(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
  }

  destroy(): void {
    this.clearKeyHandler();
    this.root.innerHTML = '';
  }
}
