// WASD / 矢印キー入力。デバッグ用の移動オーバーライド付き。

export class Input {
  private keys = new Set<string>();
  /** デバッグ用: 非 null なら常にこの方向へ移動（orca eval からの検証用） */
  overrideDir: { x: number; z: number } | null = null;

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** 正規化済み移動方向を返す（入力なしなら 0,0） */
  dir(): { x: number; z: number } {
    if (this.overrideDir) {
      const { x, z } = this.overrideDir;
      const len = Math.hypot(x, z);
      if (len < 1e-6) return { x: 0, z: 0 };
      return { x: x / len, z: z / len };
    }
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    const len = Math.hypot(x, z);
    if (len < 1e-6) return { x: 0, z: 0 };
    return { x: x / len, z: z / len };
  }
}
