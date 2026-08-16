import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const fatal = document.getElementById('fatal');

if (!canvas) {
  throw new Error('#game-canvas not found');
}

try {
  const game = new Game(canvas);
  game.start();
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
