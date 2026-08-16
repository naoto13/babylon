import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_CATALOG,
  canBuyAsset,
  canBuyMaterial,
  createStartingEconomy,
  getPotionOffer,
  getWorkshopRank,
  MATERIAL_MARKET,
  purchaseAsset,
  purchaseMaterial,
  rarityForAssetTier,
  refundMaterials,
  reserveMaterial,
} from "../js/economy.js";

test("the market catalogs all 36 workshop assets and starts with only the cauldron", () => {
  assert.equal(ASSET_CATALOG.length, 36);
  assert.equal(new Set(ASSET_CATALOG.map((asset) => asset.id)).size, 36);
  assert.deepEqual(createStartingEconomy(), {
    coins: 36,
    inventory: { "moon-petal": 3, mistleaf: 3 },
    ownedAssetIds: ["cauldron"],
  });
});

test("workshop items receive rarity from their market tier", () => {
  assert.equal(rarityForAssetTier(0), "common");
  assert.equal(rarityForAssetTier(1), "common");
  assert.equal(rarityForAssetTier(2), "uncommon");
  assert.equal(rarityForAssetTier(3), "rare");
  assert.equal(ASSET_CATALOG.find((asset) => asset.id === "cauldron")?.rarity, "common");
  assert.equal(ASSET_CATALOG.find((asset) => asset.id === "books")?.rarity, "uncommon");
  assert.equal(ASSET_CATALOG.find((asset) => asset.id === "alembic")?.rarity, "rare");
});

test("workshop ownership unlocks material ranks gradually", () => {
  assert.equal(getWorkshopRank(["cauldron"]).id, "common");
  assert.equal(getWorkshopRank(["cauldron", "cuttingBoard", "knife"]).id, "uncommon");
  assert.equal(getWorkshopRank([
    "cauldron", "cuttingBoard", "knife", "mortar", "pestle", "heatDial", "appraisalLens", "deliveryTray", "books", "plant",
  ]).id, "rare");
});

test("asset purchases preserve enough coins for two unlocked basic materials", () => {
  const economy = createStartingEconomy();
  assert.equal(canBuyAsset(economy, "cuttingBoard").ok, true);
  assert.equal(canBuyAsset({ ...economy, coins: 31 }, "cuttingBoard").reason, "reserve");
  assert.equal(canBuyAsset(economy, "books").reason, "locked");
});

test("material purchases require an unlocked rank and sufficient coins", () => {
  const economy = createStartingEconomy();
  assert.equal(canBuyMaterial(economy, "moon-petal").ok, true);
  assert.equal(canBuyMaterial(economy, "silvermoss").reason, "locked");
  assert.equal(MATERIAL_MARKET["star-salt"].price, 28);
});

test("potion offers have deterministic tier prices, quality multipliers, and commission", () => {
  const common = getPotionOffer(
    { items: [{ materialId: "moon-petal" }, { materialId: "mistleaf" }] },
    { stability: 80, sideEffects: [] },
  );
  assert.deepEqual(common, {
    rarity: "common", quality: "great", baseValue: 18, multiplier: 1.5, marketValue: 27, commission: 0, totalValue: 27,
  });

  const rareDelivery = getPotionOffer(
    { items: [{ materialId: "sunfeather" }, { materialId: "star-salt" }] },
    { stability: 72, sideEffects: [] },
    { tier: "ok" },
  );
  assert.equal(rareDelivery.rarity, "rare");
  assert.equal(rareDelivery.marketValue, 132);
  assert.equal(rareDelivery.commission, 30);
  assert.equal(rareDelivery.totalValue, 162);
});

test("failed products retain a minimum market value", () => {
  const offer = getPotionOffer(
    { items: [{ materialId: "moon-petal" }, { materialId: "mistleaf" }] },
    { stability: 20, sideEffects: ["oversleep"] },
  );
  assert.equal(offer.quality, "fail");
  assert.equal(offer.marketValue, 7);
  assert.ok(offer.totalValue > 0);
});

test("purchasing and reserving inventory produce new economy states without mutating the prior state", () => {
  const start = { ...createStartingEconomy(), coins: 100 };
  const assetPurchase = purchaseAsset(start, "cuttingBoard");
  assert.equal(assetPurchase.ok, true);
  assert.equal(start.coins, 100);
  assert.equal(assetPurchase.economy.coins, 76);
  assert.deepEqual(assetPurchase.economy.ownedAssetIds, ["cauldron", "cuttingBoard"]);

  const materialPurchase = purchaseMaterial(assetPurchase.economy, "moon-petal");
  const reservation = reserveMaterial(materialPurchase.economy, "moon-petal");
  assert.equal(materialPurchase.economy.inventory["moon-petal"], 4);
  assert.equal(reservation.economy.inventory["moon-petal"], 3);
  assert.equal(reserveMaterial({ ...reservation.economy, inventory: { ...reservation.economy.inventory, "moon-petal": 0 } }, "moon-petal").reason, "stock");
  assert.equal(refundMaterials(reservation.economy, ["moon-petal"]).inventory["moon-petal"], 4);
});
