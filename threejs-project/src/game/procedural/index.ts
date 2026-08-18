// 手続きモデル（img2threejs 経路）のレジストリ。
// アセットに builder があるものだけ 'procedural' ソースを選択できる。
import type * as THREE from 'three';
import type { AssetKey } from '../asset-config';
import { createPlayerSquidProcModel } from './playerSquidProc';

export const PROC_BUILDERS: Partial<Record<AssetKey, () => THREE.Group>> = {
  player: createPlayerSquidProcModel,
};

export function hasProcModel(key: AssetKey): boolean {
  return key in PROC_BUILDERS;
}
