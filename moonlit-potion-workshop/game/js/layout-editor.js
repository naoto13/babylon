import {
  clearLayoutOverrides,
  getLayoutOverrides,
  removeLayoutOverride,
  saveLayoutOverride,
} from "./layout-overrides.js";

const TABLE_BOUNDS = Object.freeze({ minX: -5.5, maxX: 5.5, minZ: -2, maxZ: 4 });
const HEIGHT_BOUNDS = Object.freeze({ min: 0.3, max: 3.5 });
const SCALE_BOUNDS = Object.freeze({ min: 0.3, max: 4 });
const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value) => Number(value).toFixed(2);
const wrapAngle = (value) => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;

function copyWithLegacyFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand?.("copy") ?? false;
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

/** Layout-only pointer controls. It deliberately never calls the game input controller. */
export function createLayoutEditor({ canvas, sceneApi }) {
  let selected = null;
  let active = null;
  let clearConfirmUntil = 0;
  let clearTimer = null;
  const panel = document.createElement("aside");
  panel.className = "panel layout-editor-panel";
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `
    <h2>配置エディタ</h2>
    <p class="layout-editor-readout" data-layout-readout>小物または操作アセットをクリックして選択。</p>
    <p class="muted">操作ガイド一覧: クリック選択 / ドラッグ移動 / ホイール拡縮 / Shift+ホイール・W/S 高さ / Q/E ヨー / A/D ピッチ / Z/C ロール</p>
    <div class="button-row">
      <button type="button" data-layout-action="copy">配置をコピー</button>
      <button type="button" data-layout-action="reset-selected" class="quiet" disabled>この選択をリセット</button>
      <button type="button" data-layout-action="reset-all" class="quiet">全リセット</button>
    </div>
    <p class="muted layout-editor-status" data-layout-status>通常のゲーム操作は無効です。</p>
  `;
  document.body.append(panel);
  const readout = panel.querySelector("[data-layout-readout]");
  const resetSelectedButton = panel.querySelector("[data-layout-action='reset-selected']");
  const status = panel.querySelector("[data-layout-status]");

  function setStatus(message) {
    status.textContent = message;
  }

  function renderSelection() {
    resetSelectedButton.disabled = !selected;
    if (!selected) {
      readout.textContent = "小物または操作アセットをクリックして選択。";
      return;
    }
    const { anchor, key, hero } = selected;
    const label = hero ? "操作アセット（拡縮と高さのみ）" : "小物";
    readout.textContent = `${label}: ${key}  x: ${number(anchor.position.x)} / z: ${number(anchor.position.z)} / y: ${number(anchor.position.y)} / rotY: ${number(anchor.rotation.y)} / rotX: ${number(anchor.rotation.x)} / rotZ: ${number(anchor.rotation.z)} / scale: ${number(anchor.scaling.x)}`;
  }

  function setSelection(nextSelection) {
    selected = nextSelection;
    sceneApi.setLayoutHighlight(selected?.anchor ?? null);
    canvas.style.cursor = selected && !selected.hero ? "grab" : "default";
    renderSelection();
  }

  function pickedLayoutAsset(event) {
    const rect = canvas.getBoundingClientRect();
    const pick = sceneApi.scene.pick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      (mesh) => Boolean(sceneApi.getLayoutAnchor(mesh)),
    );
    if (!pick?.hit) return null;
    const anchor = sceneApi.getLayoutAnchor(pick.pickedMesh);
    const key = sceneApi.getLayoutKey(anchor);
    return anchor && key ? { anchor, key, hero: sceneApi.isHeroLayoutAnchor(anchor) } : null;
  }

  function persistSelection() {
    if (!selected) return;
    const { anchor, key, hero } = selected;
    if (hero) {
      const override = sceneApi.getHeroLayoutOverride(key);
      if (override) saveLayoutOverride(key, override);
      renderSelection();
      return;
    }
    saveLayoutOverride(key, {
      x: anchor.position.x,
      y: anchor.position.y,
      z: anchor.position.z,
      rotY: anchor.rotation.y,
      rotX: anchor.rotation.x,
      rotZ: anchor.rotation.z,
      scaleMul: anchor.scaling.x,
    });
    renderSelection();
  }

  function updateHeroLayout(partial) {
    if (!selected?.hero) return false;
    const override = sceneApi.setHeroLayoutOverride(selected.key, partial);
    if (!override) return false;
    persistSelection();
    return true;
  }

  function releasePointer(event) {
    if (!active || active.pointerId !== event.pointerId) return;
    try {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Browsers can release capture before a pointercancel is delivered.
    }
    active = null;
    if (selected && !selected.hero) canvas.style.cursor = "grab";
  }

  function onPointerDown(event) {
    if (event.button !== 0 || active) return;
    const nextSelection = pickedLayoutAsset(event);
    if (!nextSelection) {
      setSelection(null);
      return;
    }
    event.preventDefault();
    setSelection(nextSelection);
    if (nextSelection.hero) return;
    const world = sceneApi.worldFromPointerAtHeight(event.clientX, event.clientY, nextSelection.anchor.position.y);
    active = {
      pointerId: event.pointerId,
      offsetX: world ? nextSelection.anchor.position.x - world.x : 0,
      offsetZ: world ? nextSelection.anchor.position.z - world.z : 0,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  }

  function onPointerMove(event) {
    if (!active || active.pointerId !== event.pointerId || !selected) {
      if (!active) {
        const hovered = pickedLayoutAsset(event);
        canvas.style.cursor = hovered && !hovered.hero ? "grab" : "default";
      }
      return;
    }
    const world = sceneApi.worldFromPointerAtHeight(event.clientX, event.clientY, selected.anchor.position.y);
    if (!world) return;
    selected.anchor.position.x = clamp(world.x + active.offsetX, TABLE_BOUNDS.minX, TABLE_BOUNDS.maxX);
    selected.anchor.position.z = clamp(world.z + active.offsetZ, TABLE_BOUNDS.minZ, TABLE_BOUNDS.maxZ);
    persistSelection();
  }

  function onWheel(event) {
    if (!selected) return;
    const picked = pickedLayoutAsset(event);
    if (!picked || picked.key !== selected.key || event.deltaY === 0) return;
    event.preventDefault();
    if (event.shiftKey) {
      const step = event.deltaY < 0 ? 0.01 : -0.01;
      if (selected.hero) {
        const current = sceneApi.getHeroLayoutOverride(selected.key);
        updateHeroLayout({ yOffset: (current?.yOffset ?? 0) + step });
      } else {
        selected.anchor.position.y = clamp(selected.anchor.position.y + step, HEIGHT_BOUNDS.min, HEIGHT_BOUNDS.max);
        persistSelection();
      }
      return;
    }
    const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05;
    if (selected.hero) {
      const current = sceneApi.getHeroLayoutOverride(selected.key);
      updateHeroLayout({ scaleMul: clamp((current?.scaleMul ?? 1) * factor, SCALE_BOUNDS.min, SCALE_BOUNDS.max) });
      return;
    }
    selected.anchor.scaling.setAll(clamp(selected.anchor.scaling.x * factor, SCALE_BOUNDS.min, SCALE_BOUNDS.max));
    persistSelection();
  }

  function onKeyDown(event) {
    if (!selected || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    let changed = false;
    if (key === "w" || key === "s") {
      const step = key === "w" ? 0.02 : -0.02;
      if (selected.hero) {
        const current = sceneApi.getHeroLayoutOverride(selected.key);
        changed = updateHeroLayout({ yOffset: (current?.yOffset ?? 0) + step });
      } else {
        selected.anchor.position.y = clamp(selected.anchor.position.y + step, HEIGHT_BOUNDS.min, HEIGHT_BOUNDS.max);
        changed = true;
      }
    } else if (!selected.hero && key === "q") {
      selected.anchor.rotation.y = wrapAngle(selected.anchor.rotation.y - 0.1);
      changed = true;
    } else if (!selected.hero && key === "e") {
      selected.anchor.rotation.y = wrapAngle(selected.anchor.rotation.y + 0.1);
      changed = true;
    } else if (!selected.hero && key === "a") {
      selected.anchor.rotation.x = wrapAngle(selected.anchor.rotation.x - 0.05);
      changed = true;
    } else if (!selected.hero && key === "d") {
      selected.anchor.rotation.x = wrapAngle(selected.anchor.rotation.x + 0.05);
      changed = true;
    } else if (!selected.hero && key === "z") {
      selected.anchor.rotation.z = wrapAngle(selected.anchor.rotation.z - 0.05);
      changed = true;
    } else if (!selected.hero && key === "c") {
      selected.anchor.rotation.z = wrapAngle(selected.anchor.rotation.z + 0.05);
      changed = true;
    } else if (!selected.hero && event.key === "ArrowLeft") {
      selected.anchor.position.x = clamp(selected.anchor.position.x - 0.05, TABLE_BOUNDS.minX, TABLE_BOUNDS.maxX);
      changed = true;
    } else if (!selected.hero && event.key === "ArrowRight") {
      selected.anchor.position.x = clamp(selected.anchor.position.x + 0.05, TABLE_BOUNDS.minX, TABLE_BOUNDS.maxX);
      changed = true;
    } else if (!selected.hero && event.key === "ArrowUp") {
      selected.anchor.position.z = clamp(selected.anchor.position.z - 0.05, TABLE_BOUNDS.minZ, TABLE_BOUNDS.maxZ);
      changed = true;
    } else if (!selected.hero && event.key === "ArrowDown") {
      selected.anchor.position.z = clamp(selected.anchor.position.z + 0.05, TABLE_BOUNDS.minZ, TABLE_BOUNDS.maxZ);
      changed = true;
    }
    if (!changed) return;
    event.preventDefault();
    if (!selected.hero) persistSelection();
  }

  async function copyOverrides() {
    const json = JSON.stringify(getLayoutOverrides(), null, 2);
    console.log(json);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        copied = true;
      }
    } catch {
      copied = copyWithLegacyFallback(json);
    }
    if (!copied) copied = copyWithLegacyFallback(json);
    setStatus(copied ? "配置JSONをクリップボードへコピーしました。コンソールにも出力しました。" : "配置JSONをコンソールへ出力しました。クリップボードへのアクセスは許可されませんでした。");
  }

  function resetSelected() {
    if (!selected) return;
    removeLayoutOverride(selected.key);
    sceneApi.resetLayoutAnchor(selected.key);
    setStatus(`${selected.key} の配置を初期値へ戻しました。`);
    renderSelection();
  }

  function resetAll() {
    const now = Date.now();
    if (now > clearConfirmUntil) {
      clearConfirmUntil = now + 3000;
      setStatus("全リセットします。3秒以内にもう一度「全リセット」を押してください。");
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        clearConfirmUntil = 0;
        clearTimer = null;
        setStatus("全リセットは取り消されました。");
      }, 3000);
      return;
    }
    clearConfirmUntil = 0;
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = null;
    clearLayoutOverrides();
    sceneApi.resetAllLayoutAnchors();
    setSelection(null);
    setStatus("すべての配置を初期値へ戻しました。");
  }

  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-layout-action]")?.dataset.layoutAction;
    if (action === "copy") void copyOverrides();
    if (action === "reset-selected") resetSelected();
    if (action === "reset-all") resetAll();
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);

  return {
    // The normal UI can still call these safely, but it is hidden in layout mode.
    startSimmer: () => false,
    finishSimmer: () => false,
    dispose() {
      if (clearTimer !== null) clearTimeout(clearTimer);
      sceneApi.setLayoutHighlight(null);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", releasePointer);
      canvas.removeEventListener("pointercancel", releasePointer);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      panel.remove();
    },
  };
}
