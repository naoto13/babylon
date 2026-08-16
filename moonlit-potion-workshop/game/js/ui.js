import { SIDE_EFFECT_BY_ID } from "./data.js";
import { MATERIAL_MARKET } from "./economy.js";

const TEMP_LABELS = Object.freeze({ low: "弱火", mid: "中火", high: "強火" });
const PREP_LABELS = Object.freeze({ none: "そのまま", cut: "刻む", crush: "潰す" });
const EFFECT_LABELS = Object.freeze({ calm: "鎮静", wake: "覚醒", heal: "治癒", shift: "変身" });
const RARITY_LABELS = Object.freeze({ common: "Common", uncommon: "Uncommon", rare: "Rare" });

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const numericMask = (line, enabled) => enabled ? line : line.replace(/\d+(?:\.\d+)?/g, "●");
const dots = (value, max = 10) => {
  const filled = Math.min(max, Math.max(0, Math.round(value)));
  return `<span class="dots" aria-label="段階 ${filled}">${"●".repeat(filled)}${"○".repeat(Math.max(0, Math.min(max, 5) - filled))}</span>`;
};
const panel = (title, body, extra = "") => `<section class="panel ${extra}" aria-label="${escapeHtml(title)}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
const materialArt = (material, extra = "") => `<img class="material-art ${extra}" src="assets/materials/${encodeURIComponent(material.id)}.webp" alt="" aria-hidden="true" loading="lazy" decoding="async">`;
const rarityClass = (rarity) => RARITY_LABELS[rarity] ? rarity : "common";
const rarityBadge = (rarity) => {
  const normalized = rarityClass(rarity);
  return `<span class="rarity-badge rarity-${normalized}">${RARITY_LABELS[normalized]}</span>`;
};

function bottleMaterials(bottle, materialById) {
  return bottle.input.items.map((item) => materialById[item.materialId]?.name ?? item.materialId).join("・");
}

function brewSummary(state, materialById, interaction) {
  const items = state.brew.items;
  const names = items.length
    ? items.map((item) => `${materialById[item.materialId]?.name ?? item.materialId}（${PREP_LABELS[item.prep] ?? item.prep}）`).join("、")
    : "まだ何も入っていない";
  const numeric = state.settings.numericValues;
  const laps = numeric ? `${state.brew.stirLaps} 周` : dots(state.brew.stirLaps);
  const warning = state.brew.stirLaps > 6 ? "<p class=\"warning\">混ぜすぎ：液面が濁っている。</p>" : "";
  const pour = interaction.pour;
  const pourGauge = pour ? (() => {
    const value = Math.min(100, Math.max(0, pour.value));
    const start = Math.min(100, Math.max(0, pour.pourBand.min));
    const end = Math.min(100, Math.max(start, pour.pourBand.max));
    return `<div class="pour-gauge" style="--pour-value:${value}%;--ideal-start:${start}%;--ideal-end:${end}%" aria-label="注ぎ量を調整中">
      <div class="pour-gauge-track"><i></i></div>
      <div class="pour-gauge-label"><span>注ぎ量</span><strong>${numeric ? `${Math.round(value)} / 100` : "適量帯をねらう"}</strong></div>
    </div>`;
  })() : "";
  const simmer = interaction.simmer;
  const simmerMeter = simmer?.active ? (() => {
    const meterLimit = simmer.targetSeconds + simmer.goodWindow * 1.2;
    const percent = (value) => Math.min(100, Math.max(0, value / meterLimit * 100));
    const elapsed = percent(simmer.elapsed);
    const goodStart = percent(simmer.targetSeconds - simmer.goodWindow);
    const goodEnd = percent(simmer.targetSeconds + simmer.goodWindow);
    const perfectStart = percent(simmer.targetSeconds - simmer.perfectWindow);
    const perfectEnd = percent(simmer.targetSeconds + simmer.perfectWindow);
    const readout = numeric ? `${simmer.elapsed.toFixed(1)} / ${simmer.targetSeconds.toFixed(1)} 秒` : "黄金の芯で離す";
    return `<div class="simmer-meter" style="--simmer-value:${elapsed}%;--good-start:${goodStart}%;--good-end:${goodEnd}%;--perfect-start:${perfectStart}%;--perfect-end:${perfectEnd}%" aria-label="火加減メーター。黄金の帯で離すと成功しやすい">
      <div class="simmer-meter-track" aria-hidden="true"><i class="simmer-good-zone"></i><i class="simmer-perfect-zone"></i><b class="simmer-cursor"></b></div>
      <div class="simmer-meter-label"><span>${escapeHtml(simmer.difficulty ? `${simmer.difficulty.label}・${simmer.difficulty.source}` : "火加減の山")}</span><strong>${readout}</strong></div>
    </div>`;
  })() : "";
  const simmerButton = state.phase === "CRAFT"
    ? `<button type="button" class="quiet simmer-button ${simmer?.active ? "simmer-active" : ""}" data-hold-action="simmer">${simmer?.active ? "ここで離す" : "煮込みを始める（押し続ける）"}</button>`
    : "";
  return `<aside class="brew-summary" aria-live="polite">
    <p class="eyebrow">いまの調合</p>
    <p class="ingredients">${escapeHtml(names)}</p>
    <div><span>火加減</span><strong>${TEMP_LABELS[state.brew.tempBand]}</strong></div>
    <div><span>かき混ぜ</span><strong>${laps}</strong></div>${simmerMeter}${pourGauge}${warning}${simmerButton}
  </aside>`;
}

function orderCard(order, state) {
  if (!order) return "";
  const question = !state.questionAsked
    ? `<div class="question"><p>${escapeHtml(order.question.prompt)}</p>${order.question.choices.map((choice, index) =>
      `<button data-action="ask" data-index="${index}" class="quiet">${escapeHtml(choice.label)}</button>`).join("")}</div>`
    : "<p class=\"muted\">質問はこの注文で一度だけ。言葉と手触りから続きを考えよう。</p>";
  return panel(`${order.clientName}の依頼`, `
    <blockquote>「${escapeHtml(order.quote)}」</blockquote>
    <p class="hint">観察の手がかり：${escapeHtml(order.hint)}</p>
    ${state.dialogue ? `<p class="dialogue">${escapeHtml(state.dialogue)}</p>` : ""}
    ${state.phase === "ORDER" ? question : ""}
  `, "order-card");
}

function ingredientPanel(state, materialById) {
  const inventory = Object.entries(state.economy?.inventory ?? {})
    .filter(([, count]) => count > 0)
    .map(([id, count]) => ({ id, count, material: materialById[id], rarity: MATERIAL_MARKET[id]?.rarity ?? "common" }))
    .filter(({ material }) => Boolean(material));
  const controls = inventory.length
    ? inventory.map(({ id, count, material, rarity }) => `<button class="rarity-frame rarity-${rarityClass(rarity)}" data-action="add-ingredient" data-id="${escapeHtml(id)}">${materialArt(material, "ingredient-art")}<span>${escapeHtml(material.name)}を釜へ入れる <small>${rarityBadge(rarity)} ×${count}</small></span></button>`).join("")
    : "<p class=\"muted\">手持ちの素材がない。夜市で仕入れよう。</p>";
  return panel("所持素材", `
    <p class="muted">瓶を釜へドラッグして注ぐか、この所持品から確実に投入できる。</p>
    <div class="ingredient-actions">${controls}</div>
    <div class="button-row"><button data-action="appraise-current" ${state.brew.items.length < 2 ? "disabled" : ""}>鑑定する</button></div>
  `, "ingredient-panel");
}

function appraisalPanel(state) {
  const appraisal = state.appraisal;
  if (!appraisal) return "";
  const result = appraisal.result;
  const numeric = state.settings.numericValues;
  const scoreCards = Object.entries(result.effects).map(([effect, value]) => `<li>
    <span>${EFFECT_LABELS[effect]}</span><b>${numeric ? value : dots(value / 20)}</b>
  </li>`).join("");
  const stability = numeric ? result.stability : dots(result.stability / 20);
  const offer = appraisal.offer;
  const offerLine = offer ? `<p class="market-offer"><b>市場の買取:</b> ${offer.totalValue} 月貨 <span class="muted">(${offer.rarity}・${offer.quality})</span></p>` : "";
  return panel("鑑定結果", `
    <ul class="scores">${scoreCards}<li><span>安定度</span><b>${stability}</b></li><li><span>持続</span><b>${escapeHtml(result.duration === "short" ? "短い" : result.duration === "long" ? "長い" : "中くらい")}</b></li></ul>
    <div class="reason-lines">${appraisal.lines.map((line) => `<p>${escapeHtml(numericMask(line, numeric))}</p>`).join("")}</div>
    ${result.sideEffects.length ? `<p class="warning">副作用：${escapeHtml(result.sideEffects.map((id) => SIDE_EFFECT_BY_ID[id]?.name ?? id).join("・"))}</p>` : "<p class=\"success\">副作用は見つからない。</p>"}
    ${offerLine}
    <div class="button-row"><button data-action="sell-current">市場へ売却</button><button data-action="adjust" class="quiet">調整へ戻る</button><button data-action="to-deliver" class="quiet">納品へ進む</button></div>
  `, "appraisal-panel");
}

const MARKET_REASON = Object.freeze({
  locked: "工房ランクが足りない", funds: "月貨が足りない", reserve: "基本素材2個分を残す必要がある", owned: "購入済み", unknown: "購入できない",
});

function marketPanel(market) {
  const assetCards = market.assets.map((asset) => {
    const status = asset.owned ? "購入済み" : asset.canBuy.ok ? "購入できる" : MARKET_REASON[asset.canBuy.reason];
    return `<li class="market-card rarity-frame rarity-${rarityClass(asset.rarity)}"><div><b>${escapeHtml(asset.name)}</b><small>${rarityBadge(asset.rarity)} Tier ${asset.tier} · ${asset.price} 月貨</small></div><button data-action="buy-asset" data-id="${escapeHtml(asset.id)}" ${asset.canBuy.ok ? "" : "disabled"}>${escapeHtml(status)}</button></li>`;
  }).join("");
  const materialCards = market.materials.map((material) => {
    const status = material.canBuy.ok ? "1個購入" : MARKET_REASON[material.canBuy.reason];
    return `<li class="market-card material-market-card rarity-frame rarity-${rarityClass(material.rarity)}">${materialArt(material)}<div><b>${escapeHtml(material.name)}</b><small>${rarityBadge(material.rarity)} 所持 ${material.count} · ${material.price} 月貨</small></div><button data-action="buy-material" data-id="${escapeHtml(material.id)}" ${material.canBuy.ok ? "" : "disabled"}>${escapeHtml(status)}</button></li>`;
  }).join("");
  const next = market.rank.next
    ? `次の棚: 所有 ${market.rank.next.ownedCount} 点${market.rank.next.tierTwoCount ? `（Tier 2を${market.rank.next.tierTwoCount}点含む）` : ""}`
    : "すべての素材棚を開放済み";
  return panel("夜市", `
    <p class="market-balance"><b>${market.coins} 月貨</b><span>${escapeHtml(market.rank.label)}</span></p>
    <p class="muted">${escapeHtml(next)}。工房品を買った後も、基本素材2個分の月貨は残しておこう。</p>
    <h3>素材棚</h3><ul class="market-list">${materialCards}</ul>
    <h3>工房アセット</h3><ul class="market-list">${assetCards}</ul>
    <button data-action="close-overlay" class="quiet">工房へ戻る</button>
  `, "modal-panel market-panel");
}

function deliveryPanel(state, order, materialById) {
  const emptySlots = state.holdShelf.map((bottle, index) => bottle === null ? index : null).filter((index) => index !== null);
  const slots = state.holdShelf.map((bottle, index) => {
    if (!bottle) return `<li><span>保留棚 ${index + 1}</span><em>空き</em></li>`;
    return `<li><span>保留棚 ${index + 1}</span><small>${escapeHtml(bottleMaterials(bottle, materialById))}</small><button data-action="deliver-held" data-index="${index}">この依頼へ納品</button></li>`;
  }).join("");
  const holdButtons = emptySlots.length
    ? emptySlots.map((index) => `<button data-action="hold" data-index="${index}" class="quiet">保留棚 ${index + 1} へ置く</button>`).join("")
    : "<span class=\"muted\">保留棚は満杯です。</span>";
  return panel("納品の判断", `
    <p>${escapeHtml(order.clientName)}へ渡す瓶を選ぶ。保留瓶は今夜の別の依頼にだけ使える。</p>
    <div class="button-row"><button data-action="deliver-current">いまの瓶を納品</button><button data-action="adjust" class="quiet">調整する</button>${holdButtons}</div>
    <h3>保留棚</h3><ul class="shelf-list">${slots}</ul>
  `, "delivery-panel");
}

function journalPanel(journal, materialById, numeric) {
  const entries = journal.length ? journal.slice().reverse().map((entry) => {
    const materials = entry.input.items.map((item) => `${materialById[item.materialId]?.name ?? item.materialId}（${PREP_LABELS[item.prep] ?? item.prep}）`).join("、");
    const outcome = entry.result;
    const scores = Object.entries(outcome.effects).filter(([, value]) => value > 0)
      .map(([effect, value]) => `${EFFECT_LABELS[effect]} ${numeric ? value : dots(value / 20)}`).join(" / ") || "主効能なし";
    return `<li><h3>調合の記録</h3><p><b>素材：</b>${escapeHtml(materials)}</p><p><b>手順：</b>${TEMP_LABELS[entry.input.tempBand]}・${numeric ? `${entry.input.stirLaps}周` : dots(entry.input.stirLaps)}</p><p><b>結果：</b>${scores}、安定 ${numeric ? outcome.stability : dots(outcome.stability / 20)}</p></li>`;
  }).join("") : "<li class=\"muted\">まだ鑑定した調合はない。</li>";
  return panel("調合日誌", `<p class="muted">ここには自分で鑑定した結果だけが残る。正解レシピは書かれない。</p><ul class="journal-list">${entries}</ul><button data-action="close-overlay" class="quiet">閉じる</button>`, "modal-panel");
}

function settingsPanel(settings) {
  return panel("設定", `<label class="toggle-row"><input type="checkbox" data-action="toggle-numeric" ${settings.numericValues ? "checked" : ""}><span>数値で表示する</span></label><label class="toggle-row"><input type="checkbox" data-action="toggle-gentle-technique" ${settings.gentleTechnique ? "checked" : ""}><span>判定をやさしく</span></label><p class="muted">「判定をやさしく」は注ぎの適量帯と煮込みの判定窓を広げます。数値表示は既定では段階と点に置き換えます。端末の「視差効果を減らす」設定では視点移動を短いフェードに置き換えます。</p><button data-action="close-overlay" class="quiet">閉じる</button>`, "modal-panel");
}

/** DOM overlay. It remains useful even when the 3D canvas cannot boot. */
export function createUI({ root, onAction }) {
  let model = null;
  let overlay = null;
  let message = "";
  let interaction = { pour: null, simmer: null };
  let heldPointerId = null;

  const releaseHold = (event, cancelled = false) => {
    if (heldPointerId === null || event.pointerId !== heldPointerId) return;
    heldPointerId = null;
    onAction(cancelled ? "simmer-cancel" : "simmer-end");
  };

  root.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-hold-action='simmer']");
    if (!button || event.button === 2 || heldPointerId !== null) return;
    event.preventDefault();
    heldPointerId = event.pointerId;
    // Capture on the persistent root: rendering the gauge replaces the button itself.
    root.setPointerCapture(event.pointerId);
    onAction("simmer-start");
  });
  root.addEventListener("pointerup", (event) => releaseHold(event));
  root.addEventListener("pointercancel", (event) => releaseHold(event, true));
  root.addEventListener("lostpointercapture", (event) => releaseHold(event, true));
  root.addEventListener("contextmenu", (event) => {
    if (heldPointerId === null) return;
    event.preventDefault();
    heldPointerId = null;
    onAction("simmer-end");
  });

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === "journal" || action === "settings" || action === "market") {
      overlay = action;
      render();
      return;
    }
    if (action === "close-overlay") {
      overlay = null;
      render();
      return;
    }
    onAction(action, button.dataset.id ?? (button.dataset.index === undefined ? undefined : Number(button.dataset.index)));
  });

  function render(nextModel = model) {
    model = nextModel;
    if (!model) return;
    const { state, order, materialById, canContinue, market } = model;
    const topbar = `<header class="topbar"><div><span class="moon">◐</span><span>月夜のポーション工房</span></div><div><span class="coin-readout" aria-label="所持月貨">${market.coins} 月貨</span><button data-action="market" class="icon-button" aria-label="夜市">市場</button><button data-action="journal" class="icon-button" aria-label="調合日誌">日誌</button><button data-action="settings" class="icon-button" aria-label="設定">設定</button></div></header>`;
    let main = "";
    if (state.phase === "TITLE") {
      main = panel("月夜のポーション工房", `<p class="lede">客の言葉を聞き、手元の道具で一瓶を仕立てよう。</p><p class="muted">ドラッグで素材を運び、釜の上で円を描いて混ぜる。右クリックまたは Esc で手放す。</p><div class="button-row"><button data-action="new-game">新しく始める</button>${canContinue ? "<button data-action=\"continue\" class=\"quiet\">続きから</button>" : ""}</div>`, "title-panel");
    } else if (state.phase === "NIGHT_INTRO") {
      main = panel(`第${state.night}夜`, `<p class="lede">窓の外は深い青。今夜も四人が工房の灯りを頼りにしている。</p><button data-action="begin-night">注文を迎える</button>`, "center-panel");
    } else if (state.phase === "ORDER") {
      main = `${orderCard(order, state)}${panel("準備", `<p>質問は一度だけ。答えと依頼の言葉を胸に、作業台へ向かおう。</p><button data-action="start-craft">調合を始める</button>`, "center-panel")}`;
    } else if (state.phase === "CRAFT") {
      main = `${orderCard(order, state)}${panel("作業台", `<p>素材瓶を釜へ。まな板では往復、乳鉢では円を描いて前処理できる。レンズを押すと鑑定する。</p><p class="muted">納品には素材を2〜4個選び、十分に混ぜる必要があります。</p>`, "craft-note")}${ingredientPanel(state, materialById)}`;
    } else if (state.phase === "APPRAISE") {
      main = `${orderCard(order, state)}${appraisalPanel(state)}`;
    } else if (state.phase === "DELIVER") {
      main = `${orderCard(order, state)}${deliveryPanel(state, order, materialById)}`;
    } else if (state.phase === "EPILOGUE" && state.delivery) {
      const delivery = state.delivery;
      const epilogue = order.hidden.epilogues[delivery.judgement.tier];
      const reputation = state.settings.numericValues ? `評判 ${state.reputation >= 0 ? "+" : ""}${state.reputation}` : "評判は月明かりのように変わった。";
      const earnings = delivery.offer ? `<p class="success">売上：${delivery.offer.totalValue} 月貨</p>` : "";
      main = panel("後日談", `<p class="lede">${escapeHtml(epilogue)}</p><p class="${delivery.judgement.tier === "fail" ? "warning" : "success"}">${escapeHtml(delivery.judgement.reasons.join("。"))}</p><p>${escapeHtml(reputation)}</p>${earnings}<button data-action="next-order">次へ</button>`, "center-panel");
    } else if (state.phase === "ENDING") {
      const reputation = state.settings.numericValues ? `${state.reputation}` : dots(Math.max(0, state.reputation + 6) / 3, 8);
      main = panel("月が沈むころ", `<p class="lede">十二の依頼を終え、工房には静かな香りだけが残った。</p><p>最終評判：<strong>${reputation}</strong></p><p class="muted">日誌には、あなた自身が確かめた十二通りの手触りが残っている。</p><button data-action="new-game" class="quiet">新しい夜を始める</button>`, "center-panel");
    }
    const notice = message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : "";
    const modal = overlay === "journal" ? journalPanel(state.journal, materialById, state.settings.numericValues)
      : overlay === "settings" ? settingsPanel(state.settings)
        : overlay === "market" ? marketPanel(market) : "";
    root.innerHTML = `${topbar}<main class="overlay-main">${main}</main>${brewSummary(state, materialById, interaction)}${notice}${modal ? `<div class="modal-scrim">${modal}</div>` : ""}`;
  }

  return {
    render,
    setMessage(nextMessage) { message = nextMessage; render(); },
    setInteraction(nextInteraction) {
      interaction = { ...interaction, ...nextInteraction };
      render();
    },
    dismissOverlay() {
      if (!overlay) return false;
      overlay = null;
      render();
      return true;
    },
    showFatalError(text) {
      root.innerHTML = panel("起動できませんでした", `<p>${escapeHtml(text)}</p><p class="muted">通信を確認してからページを再読み込みしてください。</p>`, "title-panel");
    },
  };
}
