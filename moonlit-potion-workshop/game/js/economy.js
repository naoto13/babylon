import { MATERIAL_BY_ID, SIDE_EFFECT_BY_ID } from "./data.js";

export const RARITY_ORDER = Object.freeze(["common", "uncommon", "rare"]);

const asset = (id, name, tier, price, kind = "dressing") => Object.freeze({ id, name, tier, price, kind });

/** Every importable workshop GLB has one stable marketplace identity. */
export const ASSET_CATALOG = Object.freeze([
  asset("cauldron", "錬金釜", 0, 0, "hero"),
  asset("cuttingBoard", "まな板", 1, 24, "hero"),
  asset("knife", "ナイフ", 1, 28, "hero"),
  asset("mortar", "乳鉢", 1, 32, "hero"),
  asset("pestle", "乳棒", 1, 36, "hero"),
  asset("heatDial", "火加減ダイヤル", 1, 40, "hero"),
  asset("appraisalLens", "鑑定レンズ", 1, 42, "hero"),
  asset("deliveryTray", "納品トレイ", 1, 44, "hero"),
  asset("jar", "素材瓶", 1, 45, "hero"),
  asset("books", "魔導書の束", 2, 65),
  asset("plant", "月影の鉢植え", 2, 70),
  asset("candle", "蜜蝋の灯", 2, 74),
  asset("hourglass", "星砂の砂時計", 2, 78),
  asset("crate", "木箱", 2, 82),
  asset("armillary", "天球儀", 2, 86),
  asset("bottles", "薬瓶の組", 2, 90),
  asset("scroll", "古い巻物", 2, 94),
  asset("lantern", "吊りランタン", 2, 98),
  asset("ivy", "蔦飾り", 2, 102),
  asset("moonOrb", "月影の宝珠", 2, 105),
  asset("compartmentBox", "仕切り箱", 3, 145),
  asset("petalBowl", "花弁の器", 3, 150),
  asset("crystalBowl", "水晶の器", 3, 155),
  asset("spellbook", "開かれた呪文書", 3, 160),
  asset("scale", "真鍮の天秤", 3, 165),
  asset("herbBundle", "薬草の束", 3, 170),
  asset("alembic", "蒸留器", 3, 175),
  asset("inkwell", "墨壺", 3, 180),
  asset("candelabra", "燭台", 3, 185),
  asset("mushroomBasket", "茸の籠", 3, 190),
  asset("starchart", "星図", 3, 195),
  asset("flask", "小さなフラスコ", 3, 200),
  asset("censer", "香炉", 3, 205),
  asset("keys", "古鍵", 3, 210),
  asset("teapot", "薬湯の急須", 3, 215),
  asset("herbPlate", "薬草皿", 3, 220),
]);

export const ASSET_BY_ID = Object.freeze(Object.fromEntries(ASSET_CATALOG.map((entry) => [entry.id, entry])));

export const MATERIAL_MARKET = Object.freeze({
  "moon-petal": Object.freeze({ rarity: "common", price: 4 }),
  mistleaf: Object.freeze({ rarity: "common", price: 4 }),
  silvermoss: Object.freeze({ rarity: "uncommon", price: 12 }),
  bitterroot: Object.freeze({ rarity: "uncommon", price: 12 }),
  dewpearl: Object.freeze({ rarity: "uncommon", price: 12 }),
  sunfeather: Object.freeze({ rarity: "rare", price: 28 }),
  toadcap: Object.freeze({ rarity: "rare", price: 28 }),
  "star-salt": Object.freeze({ rarity: "rare", price: 28 }),
});

const VALUE_BY_RARITY = Object.freeze({ common: 18, uncommon: 48, rare: 115 });
const MULTIPLIER_BY_QUALITY = Object.freeze({ great: 1.5, ok: 1.15, fail: 0.4 });
const COMMISSION_BY_RARITY = Object.freeze({ common: 6, uncommon: 13, rare: 30 });

export function createStartingEconomy() {
  return { coins: 36, inventory: { "moon-petal": 3, mistleaf: 3 }, ownedAssetIds: ["cauldron"] };
}

export function getWorkshopRank(ownedAssetIds) {
  const owned = new Set(Array.isArray(ownedAssetIds) ? ownedAssetIds : []);
  const ownedCount = owned.size;
  const tierTwoCount = [...owned].filter((id) => ASSET_BY_ID[id]?.tier === 2).length;
  if (ownedCount >= 8 && tierTwoCount >= 2) return { id: "rare", label: "稀少素材の棚", next: null };
  if (ownedCount >= 3) return { id: "uncommon", label: "上質素材の棚", next: { ownedCount: 8, tierTwoCount: 2 } };
  return { id: "common", label: "基本素材の棚", next: { ownedCount: 3, tierTwoCount: 0 } };
}

export function getAvailableMaterials(rank) {
  const rankIndex = RARITY_ORDER.indexOf(typeof rank === "string" ? rank : rank?.id);
  return Object.entries(MATERIAL_MARKET)
    .filter(([, entry]) => RARITY_ORDER.indexOf(entry.rarity) <= rankIndex)
    .map(([id]) => id);
}

export function getReserveCoins(rank) {
  const prices = getAvailableMaterials(rank).map((id) => MATERIAL_MARKET[id].price);
  return Math.min(...prices) * 2;
}

function marketTierUnlocked(assetTier, ownedAssetIds) {
  const owned = new Set(ownedAssetIds);
  const tierTwoCount = [...owned].filter((id) => ASSET_BY_ID[id]?.tier === 2).length;
  if (assetTier <= 1) return true;
  if (assetTier === 2) return owned.size >= 3;
  return owned.size >= 8 && tierTwoCount >= 2;
}

export function canBuyAsset(economy, assetId) {
  const item = ASSET_BY_ID[assetId];
  if (!item || item.tier === 0) return { ok: false, reason: "unknown" };
  const owned = new Set(economy?.ownedAssetIds ?? []);
  if (owned.has(assetId)) return { ok: false, reason: "owned" };
  if (!marketTierUnlocked(item.tier, owned)) return { ok: false, reason: "locked" };
  const coins = economy?.coins ?? 0;
  if (coins < item.price) return { ok: false, reason: "funds" };
  if (coins - item.price < getReserveCoins(getWorkshopRank([...owned]))) return { ok: false, reason: "reserve" };
  return { ok: true, reason: null };
}

export function canBuyMaterial(economy, materialId) {
  const item = MATERIAL_MARKET[materialId];
  if (!item || !MATERIAL_BY_ID[materialId]) return { ok: false, reason: "unknown" };
  const rank = getWorkshopRank(economy?.ownedAssetIds ?? []);
  if (RARITY_ORDER.indexOf(item.rarity) > RARITY_ORDER.indexOf(rank.id)) return { ok: false, reason: "locked" };
  if ((economy?.coins ?? 0) < item.price) return { ok: false, reason: "funds" };
  return { ok: true, reason: null };
}

const cloneEconomy = (economy) => ({
  coins: economy.coins,
  inventory: { ...economy.inventory },
  ownedAssetIds: [...economy.ownedAssetIds],
});

export function purchaseAsset(economy, assetId) {
  const permission = canBuyAsset(economy, assetId);
  if (!permission.ok) return { ok: false, reason: permission.reason, economy };
  const next = cloneEconomy(economy);
  next.coins -= ASSET_BY_ID[assetId].price;
  next.ownedAssetIds.push(assetId);
  return { ok: true, reason: null, economy: next };
}

export function purchaseMaterial(economy, materialId) {
  const permission = canBuyMaterial(economy, materialId);
  if (!permission.ok) return { ok: false, reason: permission.reason, economy };
  const next = cloneEconomy(economy);
  next.coins -= MATERIAL_MARKET[materialId].price;
  next.inventory[materialId] = (next.inventory[materialId] ?? 0) + 1;
  return { ok: true, reason: null, economy: next };
}

export function reserveMaterial(economy, materialId) {
  if (!MATERIAL_MARKET[materialId] || (economy?.inventory?.[materialId] ?? 0) < 1) {
    return { ok: false, reason: "stock", economy };
  }
  const next = cloneEconomy(economy);
  next.inventory[materialId] -= 1;
  return { ok: true, reason: null, economy: next };
}

export function refundMaterials(economy, materialIds) {
  const next = cloneEconomy(economy);
  for (const materialId of materialIds) {
    if (!MATERIAL_MARKET[materialId]) continue;
    next.inventory[materialId] = (next.inventory[materialId] ?? 0) + 1;
  }
  return next;
}

function qualityForMarket(result) {
  const hasMajorSideEffect = (result?.sideEffects ?? []).some((id) => SIDE_EFFECT_BY_ID[id]?.severity === "major");
  if ((result?.stability ?? 0) >= 75 && !hasMajorSideEffect) return "great";
  if ((result?.stability ?? 0) >= 60) return "ok";
  return "fail";
}

export function getPotionOffer(brewInput, brewResult, judgement = null) {
  const itemRarities = (brewInput?.items ?? []).map((item) => MATERIAL_MARKET[item.materialId]?.rarity ?? "common");
  const rarity = itemRarities.reduce((highest, current) => (
    RARITY_ORDER.indexOf(current) > RARITY_ORDER.indexOf(highest) ? current : highest
  ), "common");
  const quality = judgement?.tier ?? qualityForMarket(brewResult);
  const baseValue = VALUE_BY_RARITY[rarity];
  const multiplier = MULTIPLIER_BY_QUALITY[quality] ?? MULTIPLIER_BY_QUALITY.fail;
  const marketValue = Math.max(1, Math.round(baseValue * multiplier));
  const commission = judgement && judgement.tier !== "fail" ? COMMISSION_BY_RARITY[rarity] : 0;
  return { rarity, quality, baseValue, multiplier, marketValue, commission, totalValue: marketValue + commission };
}

export function isValidEconomy(economy) {
  if (!economy || !Number.isInteger(economy.coins) || economy.coins < 0 || !economy.inventory || !Array.isArray(economy.ownedAssetIds)) return false;
  const ids = economy.ownedAssetIds;
  if (!ids.includes("cauldron") || new Set(ids).size !== ids.length || !ids.every((id) => Boolean(ASSET_BY_ID[id]))) return false;
  return Object.entries(economy.inventory).every(([id, amount]) => Boolean(MATERIAL_MARKET[id]) && Number.isInteger(amount) && amount >= 0);
}
