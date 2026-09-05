import './style.css';
import { Game } from './game/game';
import { fetchBaseConfig, mergeAssetConfig, onAssetConfigChange, readLocalOverride } from './game/asset-config';
import { loadAllModels } from './game/assets';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const fatal = document.getElementById('fatal');

if (!canvas) {
  throw new Error('#game-canvas not found');
}

try {
  // JSON デフォルト + localStorage 上書きで実効 config を作る
  const baseCfg = await fetchBaseConfig();
  const override = readLocalOverride();
  const cfg = override ? mergeAssetConfig(baseCfg, override) : baseCfg;

  const game = new Game(canvas, cfg);
  game.start();

  // glb は非同期ロードし、成功した分だけ差し替える（欠落・破損はフォールバック継続）
  void loadAllModels(cfg).then((models) => game.applyModels(models));

  // admin タブからの localStorage 変更に即応
  onAssetConfigChange(baseCfg, (next) => game.applyConfig(next));

  if (import.meta.env.DEV) {
    const { exposeDebug } = await import('./debug');
    exposeDebug(game);
  }
} catch (err) {
  // WebGL 非対応環境などのフォールバック表示
  console.error(err);
  if (fatal) {
    fatal.hidden = false;
    fatal.textContent = 'このブラウザでは WebGL を利用できないため、ゲームを起動できませんでした。';
  }
}
