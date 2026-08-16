/* global BABYLON */

const TEMP_BANDS = ["low", "mid", "high"];
const POUR_RATE_PER_SECOND = 45;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const deltaAngle = (next, previous) => {
  let delta = next - previous;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};
const accumulateCircularProgress = (progress, delta) => {
  // A reversal starts a new circle; back-and-forth motion cannot build a lap.
  if (!delta) return progress;
  if (progress && Math.sign(delta) !== Math.sign(progress)) return 0;
  return progress + delta;
};
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const circularityScore = (radii) => {
  if (radii.length === 0) return 50;
  const mean = average(radii);
  if (mean <= 0) return 0;
  const deviation = Math.sqrt(average(radii.map((radius) => (radius - mean) ** 2)));
  const score = Math.round(100 - (deviation / mean) * 400);
  return mean < 30 ? Math.min(40, clamp(score, 0, 100)) : clamp(score, 0, 100);
};
const pourAmount = (value, band) => {
  if (value < 35) return "scant";
  if (value < band.min) return "standard";
  return value <= band.max ? "ideal" : "heavy";
};
const pourVerdict = (amount) => ({
  scant: "少なすぎた。",
  standard: "ほどよく注げた。",
  ideal: "ぴったりだ。",
  heavy: "注ぎすぎた。",
}[amount]);
const stirVerdict = (score) => {
  if (score >= 80) return "きれいな円だ。";
  if (score >= 60) return "なめらかな円だ。";
  if (score >= 40) return "円が少し歪んだ。";
  return "円が歪んだ。";
};
const simmerVerdict = (result) => ({
  perfect: "ぴったりの火加減だ。",
  good: "ほどよく煮込めた。",
  early: "火を止めるのが早すぎた。",
  late: "煮込みすぎた。",
}[result]);

/** Maps a continuous dial angle into three stable, rounded heat bands. */
export function bandForDialAngle(angle) {
  const sector = Math.floor((angle + Math.PI / 3) / ((Math.PI * 2) / 3));
  return TEMP_BANDS[((sector % 3) + 3) % 3];
}

/**
 * Pointer-only (mouse and touch) workshop manipulation. One captured pointer
 * owns a gesture, which prevents a second touch from overlapping a drag.
 */
export function createInteractions({
  canvas,
  sceneApi,
  canInteract,
  onIngredient,
  onPrep,
  onTemperature,
  onStir,
  getPourBand,
  onPourGauge,
  getSimmerSettings,
  onSimmerProgress,
  onSimmerEnd,
  onAppraise,
  onDeliveryTray,
  onRelease,
  onStatus,
}) {
  let active = null;
  let yaw = 0;
  let pitch = 0;
  let pourFrame = null;
  let simmerFrame = null;

  const pointerXY = (event) => ({ x: event.clientX, y: event.clientY });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pickAction = (event) => {
    const rect = canvas.getBoundingClientRect();
    const pick = sceneApi.scene.pick(event.clientX - rect.left, event.clientY - rect.top);
    return pick?.hit ? { mesh: pick.pickedMesh, action: sceneApi.getAction(pick.pickedMesh) } : null;
  };
  const setHover = (event) => {
    const picked = pickAction(event);
    sceneApi.setHighlight(picked?.action ? picked.mesh : null);
    canvas.style.cursor = picked?.action ? "grab" : "default";
  };

  function releasePointerAndFocus(previous) {
    try {
      if (typeof previous.pointerId === "number" && canvas.hasPointerCapture(previous.pointerId)) {
        canvas.releasePointerCapture(previous.pointerId);
      }
    } catch {
      // A browser can implicitly release capture during a context-menu gesture.
    }
    sceneApi.releaseFocus();
    sceneApi.setHighlight(null);
    canvas.style.cursor = "default";
  }

  function currentPourValue(pour) {
    return clamp((performance.now() - pour.startedAt) / 1000 * POUR_RATE_PER_SECOND, 0, 100);
  }

  function updatePourGauge() {
    const current = active;
    if (!current || current.mode !== "jar" || !current.pour) return;
    const value = currentPourValue(current.pour);
    onPourGauge?.({ materialId: current.action.materialId, value, pourBand: current.pour.band });
    if (value < 100) pourFrame = requestAnimationFrame(updatePourGauge);
  }

  function beginPourGauge() {
    if (!active || active.mode !== "jar" || active.pour) return;
    const band = getPourBand?.(active.action.materialId);
    if (!band) return;
    active.pour = { startedAt: performance.now(), band };
    sceneApi.setJarPouring(active.action.materialId, true);
    updatePourGauge();
  }

  function abortPourGauge() {
    if (!active?.pour) return;
    if (pourFrame !== null) cancelAnimationFrame(pourFrame);
    pourFrame = null;
    sceneApi.setJarPouring(active.action.materialId, false);
    active.pour = null;
    onPourGauge?.(null);
  }

  function updateSimmer() {
    const current = active;
    if (!current || current.mode !== "simmer") return;
    const elapsed = (performance.now() - current.startedAt) / 1000;
    const progress = { active: true, elapsed, ...current.settings };
    sceneApi.setSimmerState(progress);
    onSimmerProgress?.(progress);
    simmerFrame = requestAnimationFrame(updateSimmer);
  }

  function startSimmer({ pointerId = null, action = null } = {}) {
    if (active) return false;
    const settings = getSimmerSettings?.();
    if (!settings) {
      onStatus("煮込むには、先に素材を1個以上入れよう。");
      return false;
    }
    active = { pointerId, mode: "simmer", action, startedAt: performance.now(), settings };
    updateSimmer();
    return true;
  }

  function finishSimmer({ cancelled = false } = {}) {
    if (!active || active.mode !== "simmer") return false;
    const previous = active;
    active = null;
    if (simmerFrame !== null) cancelAnimationFrame(simmerFrame);
    simmerFrame = null;
    const elapsed = (performance.now() - previous.startedAt) / 1000;
    sceneApi.setSimmerState({ active: false });
    onSimmerProgress?.({ active: false });
    releasePointerAndFocus(previous);
    if (!cancelled) {
      const difference = elapsed - previous.settings.targetSeconds;
      const absoluteDifference = Math.abs(difference);
      const result = absoluteDifference <= previous.settings.perfectWindow ? "perfect"
        : absoluteDifference <= previous.settings.goodWindow ? "good"
          : difference < 0 ? "early" : "late";
      onSimmerEnd?.({ result, elapsed });
      onStatus(simmerVerdict(result));
    }
    return true;
  }

  function release(reason = "release") {
    if (!active) {
      if (reason === "back") onRelease?.();
      return;
    }
    if (active.mode === "simmer") {
      finishSimmer({ cancelled: reason === "cancel" });
      return;
    }
    const previous = active;
    if (previous.mode === "jar") {
      abortPourGauge();
      sceneApi.resetJar(previous.action.materialId);
    }
    active = null;
    releasePointerAndFocus(previous);
    if (reason === "back") onRelease?.();
  }

  function dialAngle(event) {
    const centre = sceneApi.screenPosition(new BABYLON.Vector3(-3.55, 0.78, 1.9));
    return Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
  }

  function stirAngle(event) {
    const centre = sceneApi.screenPosition(new BABYLON.Vector3(0, 1.59, 0.3));
    return Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
  }

  function stirRadius(event) {
    const centre = sceneApi.screenPosition(new BABYLON.Vector3(0, 1.59, 0.3));
    return Math.hypot(event.clientX - centre.x, event.clientY - centre.y);
  }

  function mortarAngle(event) {
    const centre = sceneApi.screenPosition(new BABYLON.Vector3(2.35, 0.92, 0.72));
    return Math.atan2(event.clientY - centre.y, event.clientX - centre.x);
  }

  function updatePrepGesture(event) {
    const world = sceneApi.worldFromPointer(event.clientX, event.clientY);
    const station = sceneApi.nearestStation(world);
    active.station = station?.kind ?? null;
    if (!station || active.prepared) return;
    if (station.kind === "board") {
      const dx = event.clientX - active.last.x;
      active.horizontalDistance += Math.abs(dx);
      const sign = Math.sign(dx);
      if (sign && active.lastDirection && sign !== active.lastDirection && Math.abs(dx) > 3) active.reversals += 1;
      if (sign) active.lastDirection = sign;
      if (active.reversals >= 2 && active.horizontalDistance >= 46) {
        active.prepared = true;
        onPrep(active.action.materialId, "cut");
        onStatus("切り込みを入れた。次は釜へ注ごう。");
      }
    }
    if (station.kind === "mortar") {
      const angle = mortarAngle(event);
      if (active.prepAngle !== null) {
        const d = deltaAngle(angle, active.prepAngle);
        // Ignore a teleported pointer sample so it cannot accidentally complete a circle.
        if (Math.abs(d) < 1.15) active.prepArc = accumulateCircularProgress(active.prepArc, d);
      }
      active.prepAngle = angle;
      if (Math.abs(active.prepArc) >= Math.PI * 1.55) {
        active.prepared = true;
        onPrep(active.action.materialId, "crush");
        onStatus("細かく潰した。次は釜へ注ごう。");
      }
    }
  }

  function onPointerDown(event) {
    if (active || event.button === 2) return;
    const picked = pickAction(event);
    const action = picked?.action;
    const start = pointerXY(event);
    if (!action || !canInteract(action)) {
      active = { pointerId: event.pointerId, mode: "look", start, last: start };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    sceneApi.setHighlight(picked.mesh);
    sceneApi.focus(action);
    if (action.kind === "jar") {
      active = {
        pointerId: event.pointerId,
        mode: "jar",
        action,
        start,
        last: start,
        station: null,
        prepared: false,
        horizontalDistance: 0,
        reversals: 0,
        lastDirection: 0,
        prepAngle: null,
        prepArc: 0,
      };
      canvas.style.cursor = "grabbing";
      return;
    }
    if (action.kind === "dial") {
      active = { pointerId: event.pointerId, mode: "dial", action, start, last: start, angle: dialAngle(event) };
      return;
    }
    if (action.kind === "flame") {
      if (!startSimmer({ pointerId: event.pointerId, action })) releasePointerAndFocus({ pointerId: event.pointerId });
      return;
    }
    if (action.kind === "cauldron") {
      active = {
        pointerId: event.pointerId,
        mode: "stir",
        action,
        start,
        last: start,
        angle: stirAngle(event),
        arc: 0,
        lapRadii: [],
      };
      return;
    }
    active = { pointerId: event.pointerId, mode: "tap", action, start, last: start };
  }

  function onPointerMove(event) {
    if (!active) {
      setHover(event);
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    const point = pointerXY(event);
    if (active.mode === "look") {
      yaw = clamp(yaw + (point.x - active.last.x) * 0.004, -Math.PI / 6, Math.PI / 6);
      pitch = clamp(pitch - (point.y - active.last.y) * 0.0035, -Math.PI / 9, Math.PI / 9);
      sceneApi.setCameraLook(yaw, pitch);
    }
    if (active.mode === "jar") {
      const previousStation = active.station;
      const world = sceneApi.worldFromPointer(event.clientX, event.clientY);
      sceneApi.moveJar(active.action.materialId, world);
      updatePrepGesture(event);
      if (active.station === "cauldron" && !active.prepared) beginPourGauge();
      else abortPourGauge();
      if (active.station) sceneApi.snapJar(active.action.materialId, active.station);
      if (active.station !== previousStation) {
        if (active.station === "cauldron") onStatus("釜の上で注ぎ量を合わせる。");
        else if (active.station) onStatus("ジェスチャーで前処理する。");
      }
    }
    if (active.mode === "dial") {
      const angle = dialAngle(event);
      active.angle = angle;
      sceneApi.setDialAngle(angle);
      onTemperature(bandForDialAngle(angle));
    }
    if (active.mode === "stir") {
      const angle = stirAngle(event);
      const d = deltaAngle(angle, active.angle);
      // A large discontinuity usually means the cursor left/re-entered the cauldron.
      if (Math.abs(d) < 1.15) {
        const nextArc = accumulateCircularProgress(active.arc, d);
        // A reversal restarts the circle; drop radii from the abandoned partial lap.
        if (active.arc && nextArc === 0) active.lapRadii = [];
        active.arc = nextArc;
        active.lapRadii.push(stirRadius(event));
      } else {
        // Do not let a teleported sample bridge two partial circles or contaminate its CV.
        active.arc = 0;
        active.lapRadii = [];
      }
      active.angle = angle;
      if (Math.abs(active.arc) >= Math.PI * 2) {
        const score = circularityScore(active.lapRadii);
        if (onStir(score)) onStatus(stirVerdict(score));
        active.arc -= Math.sign(active.arc) * Math.PI * 2;
        active.lapRadii = [];
      }
    }
    active.last = point;
  }

  function onPointerUp(event) {
    if (!active || active.pointerId !== event.pointerId) return;
    const previous = active;
    if (previous.mode === "jar") {
      const world = sceneApi.worldFromPointer(event.clientX, event.clientY);
      const station = sceneApi.nearestStation(world);
      if (station?.kind === "cauldron" && !previous.prepared && previous.pour) {
        const value = currentPourValue(previous.pour);
        const amount = pourAmount(value, previous.pour.band);
        abortPourGauge();
        if (onIngredient(previous.action.materialId, amount)) {
          // The particle burst is intentionally after the synchronous state mutation callback.
          sceneApi.playPourBurst();
          onStatus(pourVerdict(amount));
        }
      } else if (!previous.prepared && station) {
        abortPourGauge();
        onStatus(station.kind === "board" ? "まな板の上で往復ドラッグして切る。" : "乳鉢の上で円を描いて潰す。");
      } else {
        abortPourGauge();
      }
    }
    if (previous.mode === "tap" && distance(previous.start, pointerXY(event)) < 12) {
      if (previous.action.kind === "lens") onAppraise();
      if (previous.action.kind === "tray") onDeliveryTray();
    }
    release();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", () => release("cancel"));
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    release("back");
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (active) release("back");
    else onRelease?.();
  });

  return {
    release,
    startSimmer,
    finishSimmer,
    dispose() {
      release();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
