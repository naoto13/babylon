// img2threejs コード手続きモデリング経路: プレイヤーイカ (参照: assets/refs/player_squid.png)
// 復元判断の正本は .img2threejs/object-sculpt-spec.json (spec-first、本ファイルは spec の実装)。
// 規約: 接地 minY=0 / 高さ約 1.1 / +Z 正面 (既存 glb 正規化と同一)。決定的 (乱数なし)・テクスチャなし。
import * as THREE from 'three';

// ---- spec 定数 (object-sculpt-spec.json と一致させること) ----
const BODY_H = 1.1; // 全高
const BODY_R = 0.44; // 最大半径 (最大幅 0.88, 高さ比 1.25 ≒ 参照 1.25)
const PROFILE_EXP = 0.62; // r(t) = R * sin(pi * t^0.62) → 最大径が高さ33%付近
const TIP_LEAN = 0.16; // 涙滴の先端を -Z (背面) へ曲げる量
const LEAN_START = 0.62; // 先端曲げ開始 (t = y/H)
const LIMB_R = 0.115;
const LIMB_LEN = 0.17; // capsule 円筒部長
const EYE_R = 0.125; // 白目ドーム半径 (直径 0.25 ≒ 体幅の28%)
const EYE_FLATTEN = 0.45; // ドームの奥行き圧縮率
const PUPIL_RATIO = 0.52; // 黒目/白目 径比
const GAZE_X = 0.026; // 瞳オフセット (目ローカル, 参照は左下視線)
const GAZE_Y = -0.03;

/** 涙滴プロファイル半径 r(y)。目・触腕の面配置にも使う */
function bodyRadiusAt(y: number): number {
  const t = Math.min(Math.max(y / BODY_H, 0), 1);
  return BODY_R * Math.sin(Math.PI * Math.pow(t, PROFILE_EXP));
}

/** 涙滴ボディ: lathe プロファイル + 上部38%に -Z 二次カーブの先端リーン */
function buildBodyGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(new THREE.Vector2(Math.max(bodyRadiusAt(t * BODY_H), 0.0005), t * BODY_H));
  }
  const geo = new THREE.LatheGeometry(points, 48);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / BODY_H;
    if (t > LEAN_START) {
      const k = (t - LEAN_START) / (1 - LEAN_START);
      pos.setZ(i, pos.getZ(i) - TIP_LEAN * k * k);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

interface SquidMaterials {
  ink: THREE.MeshPhysicalMaterial;
  eyeWhite: THREE.MeshPhysicalMaterial;
  pupil: THREE.MeshPhysicalMaterial;
  catch: THREE.MeshPhysicalMaterial;
}

/** spec materials: ink-cyan / eye-white / ink-black (+catchlight は eye-white 派生の微発光) */
function buildMaterials(): SquidMaterials {
  const ink = new THREE.MeshPhysicalMaterial({
    color: 0x19d3dc, // 参照のシアン (COLORS.playerBody と一致)。旧 0x35dcdf は淡すぎた
    roughness: 0.5, // 抽出 PBR 値。二層目のシャープなハイライトは clearcoat 側が担う
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const eyeWhite = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.12,
  });
  const pupil = new THREE.MeshPhysicalMaterial({
    color: 0x101014,
    roughness: 0.12,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.08,
  });
  const catchMat = eyeWhite.clone();
  catchMat.emissive = new THREE.Color(0xffffff);
  catchMat.emissiveIntensity = 0.9;
  return { ink, eyeWhite, pupil, catch: catchMat };
}

/** 触腕スタブ: 内端をボディに埋め込む (embedDepth ≈ 0.09、浮遊部品なし) */
function buildLimb(side: 1 | -1, mats: SquidMaterials): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = side < 0 ? 'limb-l' : 'limb-r';
  // socket: ボディ下部前面
  pivot.position.set(side * 0.26, 0.16, 0.3);
  const dir = new THREE.Vector3(side * 0.32, -0.22, 0.92).normalize();
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(LIMB_R, LIMB_LEN, 6, 14), mats.ink);
  mesh.name = pivot.name + '-mesh';
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // capsule 中心を socket から先端方向へ出し、後端 (半長 0.2) をボディ内へ
  mesh.position.copy(dir).multiplyScalar(0.07);
  pivot.add(mesh);
  return pivot;
}

/** 目スタック: 白目ドーム (半埋め込み) + 黒目 + キャッチライト */
function buildEye(side: 1 | -1, mats: SquidMaterials): THREE.Group {
  const eyeY = 0.52;
  const eyeX = side * 0.155;
  const r = bodyRadiusAt(eyeY);
  const eyeZ = Math.sqrt(Math.max(r * r - eyeX * eyeX, 0.01));
  const normal = new THREE.Vector3(eyeX / r, 0.08, eyeZ / r).normalize();

  const group = new THREE.Group();
  group.name = side < 0 ? 'eye-l' : 'eye-r';
  group.position.set(eyeX, eyeY, eyeZ).addScaledVector(normal, -0.012);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  const white = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 16), mats.eyeWhite);
  white.name = (side < 0 ? 'eye-white-l' : 'eye-white-r');
  white.scale.set(1, 1, EYE_FLATTEN);
  group.add(white);

  const pupilR = EYE_R * PUPIL_RATIO;
  const domeZ =
    EYE_FLATTEN * Math.sqrt(Math.max(EYE_R * EYE_R - (GAZE_X * GAZE_X + GAZE_Y * GAZE_Y), 0));
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(pupilR, 20, 12), mats.pupil);
  pupil.name = (side < 0 ? 'pupil-l' : 'pupil-r');
  pupil.userData.explodeWithParent = true;
  pupil.scale.set(1, 1, 0.4);
  pupil.position.set(GAZE_X, GAZE_Y, domeZ - 0.014);
  group.add(pupil);

  const catchlight = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mats.catch);
  catchlight.name = (side < 0 ? 'catchlight-l' : 'catchlight-r');
  catchlight.userData.explodeWithParent = true;
  catchlight.scale.set(1, 1, 0.5);
  catchlight.position.set(GAZE_X - 0.026, GAZE_Y + 0.026, domeZ + 0.012);
  group.add(catchlight);
  return group;
}

/**
 * プレイヤーイカの手続きモデル (img2threejs 経路)。
 * 返り値規約: 接地 minY=0 / 全高 ≈ 1.1 / +Z 正面。
 * userData.sculptRuntime に parts / sockets / explode() を公開 (action-ready)。
 */
export function createPlayerSquidProcModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'player-squid-proc';
  const mats = buildMaterials();

  const body = new THREE.Mesh(buildBodyGeometry(), mats.ink);
  body.name = 'body';
  root.add(body);

  const limbL = buildLimb(-1, mats);
  const limbR = buildLimb(1, mats);
  const eyeL = buildEye(-1, mats);
  const eyeR = buildEye(1, mats);
  root.add(limbL, limbR, eyeL, eyeR);

  // 接地正規化: minY を 0 に合わせる (触腕の下端がわずかに沈む場合の保険)
  const box = new THREE.Box3().setFromObject(root);
  if (box.min.y !== 0) {
    for (const child of root.children) child.position.y -= box.min.y;
  }

  // action-ready runtime: パーツ列挙 / socket / 分解表示
  const parts: THREE.Object3D[] = [body, limbL, limbR, eyeL, eyeR];
  const basePos = parts.map((p) => p.position.clone());
  const center = new THREE.Vector3(0, BODY_H * 0.45, 0);
  root.userData.sculptRuntime = {
    source: 'img2threejs procedural (spec: .img2threejs/object-sculpt-spec.json)',
    parts: parts.map((p) => p.name),
    sockets: {
      'body-limb-l': [-0.26, 0.16, 0.3],
      'body-limb-r': [0.26, 0.16, 0.3],
      'body-eye-l': [-0.155, 0.52, 0.37],
      'body-eye-r': [0.155, 0.52, 0.37],
      tip: [0, BODY_H, -TIP_LEAN],
    },
    /** 分解表示: モデル中心を基準に配置をスケールして隙間を開ける (平行移動ではない) */
    explode(factor: number): void {
      parts.forEach((p, i) => {
        p.position.copy(basePos[i]).sub(center).multiplyScalar(1 + factor).add(center);
      });
    },
  };
  return root;
}
