import { MATERIAL_BY_ID, MATERIALS, ORDERS } from "./data.js";
import { appraise, evaluateBrew, judgeDelivery } from "./engine.js";
import { clearGame, freshGameState, loadGame, saveGame } from "./save.js";
import { createWorkshopScene } from "./scene.js";
import { createInteractions } from "./interactions.js";
import { createLayoutEditor } from "./layout-editor.js";
import { createUI } from "./ui.js";

const canvas = document.getElementById("workshop-canvas");
const root = document.getElementById("ui-root");
const bootError = document.getElementById("boot-error");
// Read once: this mode is intentionally selected only during page boot.
const layoutMode = new URLSearchParams(window.location.search).get("layout") === "1";
const SIMMER_TARGET_SECONDS = Object.freeze({ low: 5, mid: 3.5, high: 2.5 });
const defaultTechnique = () => ({ stirQuality: 50, simmer: "none" });
const effectivePourBand = (material, gentleTechnique) => {
  const band = material.pourBand;
  if (!gentleTechnique) return { min: band.min, max: band.max };
  const centre = (band.min + band.max) / 2;
  const halfWidth = (band.max - band.min) * 0.75;
  return { min: Math.max(0, centre - halfWidth), max: Math.min(100, centre + halfWidth) };
};

let state = loadGame();
const savedPhase = state.phase;
const canContinue = savedPhase !== "TITLE" || state.orderIndex > 0 || state.journal.length > 0;
const resumePhase = savedPhase === "TITLE" && canContinue
  ? (state.delivery ? "EPILOGUE" : state.appraisal ? "APPRAISE" : state.brew.items.length ? "CRAFT" : "ORDER")
  : savedPhase;
// A reload always arrives at the title, where the player chooses continue/new.
state.phase = "TITLE";

// The UI is built before the 3D CDN guard; dispatch is attached once startup succeeds.
let handleAction = () => {};
const ui = createUI({ root, onAction: (...args) => handleAction(...args) });

if (window.__babylonLoadFailed || !window.BABYLON) {
  const message = "3D表示ライブラリを読み込めませんでした。通信を確認して再読み込みしてください。";
  bootError.textContent = message;
  bootError.classList.add("visible");
  ui.showFatalError(message);
} else {
  startWorkshop();
}

function startWorkshop() {
  const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const sceneApi = createWorkshopScene(engine, canvas, MATERIALS, { layoutMode });
  // The layout editor is the only interactive surface in this mode.
  if (layoutMode) root.hidden = true;
  const stateForSave = () => state.phase === "TITLE" && canContinue
    ? { ...state, phase: resumePhase }
    : state;
  const refresh = () => {
    state.night = state.orderIndex >= 12 ? 3 : Math.floor(state.orderIndex / 4) + 1;
    const visualItems = state.brew.items.map((item) => MATERIAL_BY_ID[item.materialId]).filter(Boolean);
    sceneApi.setLiquidState({
      items: visualItems,
      result: state.appraisal?.result ?? null,
      tempBand: state.brew.tempBand,
      stirLaps: state.brew.stirLaps,
    });
    ui.render({ state, order: ORDERS[state.orderIndex], materialById: MATERIAL_BY_ID, canContinue });
  };
  const saveAndRender = () => {
    state.night = state.orderIndex >= 12 ? 3 : Math.floor(state.orderIndex / 4) + 1;
    saveGame(stateForSave());
    refresh();
  };

  const setNotice = (message) => ui.setMessage(message);
  const resetBrew = () => {
    state.brew = { items: [], tempBand: "mid", stirLaps: 0, preps: {}, technique: defaultTechnique() };
    state.appraisal = null;
    ui.setInteraction({ pour: null, simmer: null });
  };
  const invalidateAppraisal = () => { state.appraisal = null; };
  const currentOrder = () => ORDERS[state.orderIndex];

  function goBack() {
    if (ui.dismissOverlay()) return;
    if (state.phase === "DELIVER") state.phase = "APPRAISE";
    else if (state.phase === "APPRAISE") state.phase = "CRAFT";
    else if (state.phase === "CRAFT") state.phase = "ORDER";
    else if (state.phase === "ORDER") state.phase = "NIGHT_INTRO";
    else return;
    setNotice("一段階戻った。");
    saveAndRender();
  }

  function addIngredient(materialId, amount = "standard") {
    if (state.phase !== "CRAFT") return false;
    if (state.brew.items.length >= 4) {
      setNotice("一瓶には素材を4個まで入れられる。");
      return false;
    }
    const material = MATERIAL_BY_ID[materialId];
    if (!material) return false;
    state.brew.items.push({ materialId, prep: state.brew.preps[materialId] ?? "none", amount });
    invalidateAppraisal();
    saveAndRender(); // State changes before the independent pour burst in interactions.js.
    return true;
  }

  function prepare(materialId, prep) {
    if (state.phase !== "CRAFT" || !MATERIAL_BY_ID[materialId]) return;
    state.brew.preps[materialId] = prep;
    setNotice(`${MATERIAL_BY_ID[materialId].name}を${prep === "cut" ? "刻んだ" : "潰した"}。`);
    saveAndRender();
  }

  function setTemperature(tempBand) {
    if (state.phase !== "CRAFT") return;
    state.brew.tempBand = tempBand;
    invalidateAppraisal();
    saveAndRender();
  }

  function addStirLaps(lapScore) {
    if (state.phase !== "CRAFT" || state.brew.stirLaps >= 10) return false;
    const previous = state.brew.stirLaps;
    state.brew.stirLaps = previous + 1;
    const previousQuality = state.brew.technique?.stirQuality ?? 50;
    state.brew.technique = {
      ...defaultTechnique(),
      ...state.brew.technique,
      stirQuality: (previousQuality * previous + lapScore) / state.brew.stirLaps,
    };
    invalidateAppraisal();
    saveAndRender();
    return true;
  }

  function appraiseCurrentBrew() {
    if (state.phase !== "CRAFT") return;
    if (state.brew.items.length < 2) {
      setNotice("鑑定には素材を2〜4個入れてから、レンズを押そう。");
      return;
    }
    try {
      const input = {
        items: state.brew.items.map((item) => ({ ...item })),
        tempBand: state.brew.tempBand,
        stirLaps: state.brew.stirLaps,
        technique: { ...state.brew.technique },
      };
      const result = evaluateBrew(input);
      state.appraisal = { input, result, lines: appraise(result) };
      // The journal records the player's observed brew, never an authored solution.
      state.journal.push({ input, result, recordedAt: new Date().toISOString() });
      state.phase = "APPRAISE";
      setNotice("レンズの中で、効能と理由が浮かんだ。");
      saveAndRender();
    } catch {
      setNotice("この調合は鑑定できない。素材と手順を確かめよう。");
    }
  }

  function enterDelivery() {
    if (state.phase !== "APPRAISE" || !state.appraisal) return;
    state.phase = "DELIVER";
    setNotice("納品する瓶を選ぼう。");
    saveAndRender();
  }

  let deliveryCommitted = false;
  function deliverBottle(bottle, heldIndex = null) {
    // The guard makes a double click / repeated tap idempotent.
    if (state.phase !== "DELIVER" || deliveryCommitted || !bottle || !currentOrder()) return;
    deliveryCommitted = true;
    const judgement = judgeDelivery(bottle.result, currentOrder()); // Held bottles are judged again for this order.
    state.reputation += judgement.reputationDelta;
    if (heldIndex !== null) state.holdShelf[heldIndex] = null;
    state.delivery = { judgement, source: heldIndex === null ? "current" : "shelf" };
    state.phase = "EPILOGUE";
    setNotice("瓶を納品トレイへ置いた。");
    saveAndRender();
  }

  function holdCurrentBottle(index) {
    if (state.phase !== "DELIVER" || state.holdShelf[index] !== null || !state.appraisal) return;
    const { input, result } = state.appraisal;
    state.holdShelf[index] = {
      input: {
        items: input.items.map((item) => ({ ...item })),
        tempBand: input.tempBand,
        stirLaps: input.stirLaps,
        technique: { ...input.technique },
      },
      result: structuredClone(result),
    };
    // Phase first: resetBrew re-renders via ui.setInteraction, so the state must already be consistent.
    state.phase = "CRAFT";
    resetBrew();
    setNotice("保留棚へ置いた。今夜の別の依頼に納品できる。");
    saveAndRender();
  }

  function advanceOrder() {
    if (state.phase !== "EPILOGUE") return;
    state.orderIndex += 1;
    state.questionAsked = false;
    state.dialogue = "";
    state.delivery = null;
    deliveryCommitted = false;
    if (state.orderIndex >= ORDERS.length) {
      state.phase = "ENDING";
    } else if (state.orderIndex % 4 === 0) {
      // Shelf bottles are intentionally only available inside the night that made them.
      state.holdShelf = [null, null];
      state.phase = "NIGHT_INTRO";
    } else {
      state.phase = "ORDER";
    }
    // Phase first: resetBrew re-renders via ui.setInteraction, so the state must already be consistent.
    resetBrew();
    saveAndRender();
  }

  const interactions = layoutMode ? createLayoutEditor({ canvas, sceneApi }) : createInteractions({
    canvas,
    sceneApi,
    canInteract: (action) => state.phase === "CRAFT"
      || (state.phase === "APPRAISE" && action?.kind === "tray"),
    onIngredient: addIngredient,
    onPrep: prepare,
    onTemperature: setTemperature,
    onStir: addStirLaps,
    getPourBand: (materialId) => {
      const material = MATERIAL_BY_ID[materialId];
      return material ? effectivePourBand(material, state.settings.gentleTechnique) : null;
    },
    onPourGauge: (pour) => ui.setInteraction({ pour }),
    getSimmerSettings: () => {
      if (state.phase !== "CRAFT" || state.brew.items.length === 0) return null;
      const windowMultiplier = state.settings.gentleTechnique ? 1.5 : 1;
      return {
        targetSeconds: SIMMER_TARGET_SECONDS[state.brew.tempBand],
        perfectWindow: 0.4 * windowMultiplier,
        goodWindow: 1 * windowMultiplier,
      };
    },
    onSimmerProgress: (simmer) => ui.setInteraction({ simmer: simmer.active ? simmer : null }),
    onSimmerEnd: ({ result }) => {
      if (state.phase !== "CRAFT") return;
      state.brew.technique = { ...defaultTechnique(), ...state.brew.technique, simmer: result };
      invalidateAppraisal();
      saveAndRender();
    },
    onAppraise: appraiseCurrentBrew,
    onDeliveryTray: enterDelivery,
    onRelease: goBack,
    onStatus: setNotice,
  });

  window.addEventListener("resize", () => engine.resize());
  window.addEventListener("beforeunload", () => {
    saveGame(stateForSave());
    interactions.dispose();
    sceneApi.dispose();
    engine.dispose();
  }, { once: true });
  engine.runRenderLoop(() => sceneApi.scene.render());
  // Do not overwrite a resumable phase with TITLE before the player chooses it.
  refresh();

  // `handleAction` is declared outside startup so the UI can be created before the CDN guard.
  function action(actionName, index) {
    if (actionName === "new-game") {
      clearGame();
      state = freshGameState();
      state.phase = "NIGHT_INTRO";
      deliveryCommitted = false;
      setNotice("新しい帳面を開いた。");
      saveAndRender();
      return;
    }
    if (actionName === "continue" && state.phase === "TITLE") {
      state.phase = resumePhase === "TITLE" ? "NIGHT_INTRO" : resumePhase;
      setNotice("保存した工房へ戻った。");
      saveAndRender();
      return;
    }
    if (actionName === "begin-night" && state.phase === "NIGHT_INTRO") {
      state.phase = "ORDER";
      setNotice("客を迎え入れた。");
      saveAndRender();
      return;
    }
    if (actionName === "ask" && state.phase === "ORDER" && !state.questionAsked) {
      const choice = currentOrder()?.question.choices[index];
      if (!choice) return;
      state.questionAsked = true;
      state.dialogue = choice.reply;
      saveAndRender();
      return;
    }
    if (actionName === "start-craft" && state.phase === "ORDER") {
      state.phase = "CRAFT";
      setNotice("作業台へ向かった。");
      saveAndRender();
      return;
    }
    if (actionName === "adjust" && (state.phase === "APPRAISE" || state.phase === "DELIVER")) {
      state.phase = "CRAFT";
      setNotice("作業台へ戻った。手順を変えてもう一度確かめよう。");
      saveAndRender();
      return;
    }
    if (actionName === "to-deliver") {
      enterDelivery();
      return;
    }
    if (actionName === "deliver-current" && state.phase === "DELIVER" && state.appraisal) {
      deliverBottle(state.appraisal);
      return;
    }
    if (actionName === "deliver-held" && state.phase === "DELIVER") {
      deliverBottle(state.holdShelf[index], index);
      return;
    }
    if (actionName === "hold" && state.phase === "DELIVER") {
      holdCurrentBottle(index);
      return;
    }
    if (actionName === "next-order") advanceOrder();
    if (actionName === "simmer-start") {
      interactions.startSimmer();
      return;
    }
    if (actionName === "simmer-end") {
      interactions.finishSimmer();
      return;
    }
    if (actionName === "simmer-cancel") {
      interactions.finishSimmer({ cancelled: true });
      return;
    }
    if (actionName === "toggle-numeric") {
      state.settings.numericValues = !state.settings.numericValues;
      saveAndRender();
    }
    if (actionName === "toggle-gentle-technique") {
      state.settings.gentleTechnique = !state.settings.gentleTechnique;
      saveAndRender();
    }
  }

  // Expose the action handler only after dependencies are ready, without putting game state on window.
  handleAction = action;
}
