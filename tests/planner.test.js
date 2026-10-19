import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeTotals, buildTree, searchItems, RAW } from "../planner.js";

// Tiny fixture: sword <- 12 ingot + 8 plank; ingot <- 20 ore (or a devourer shard); plank <- 20 wood (+ sawdust)
const item = (recipes = []) => ({ type: "", icon: null, wiki: true, recipes });
const fixture = {
  items: {
    Sword: item([0]), Ingot: item([1, 4]), Plank: item([2]), Ore: item(), Wood: item(), Sawdust: item([2]),
    Shard: item(), Axe: item([3]), Loop: item([5]),
  },
  recipes: [
    { id: 0, outputs: [{ item: "Sword", qty: 1 }], inputs: [{ item: "Ingot", qty: 12 }, { item: "Plank", qty: 8 }], stations: ["Anvil"] },
    { id: 1, outputs: [{ item: "Ingot", qty: 1 }], inputs: [{ item: "Ore", qty: 20 }], stations: ["Furnace", "Advanced Furnace"] },
    { id: 2, outputs: [{ item: "Plank", qty: 1 }, { item: "Sawdust", qty: 1 }], inputs: [{ item: "Wood", qty: 20 }], stations: ["Sawmill"] },
    { id: 3, outputs: [{ item: "Axe", qty: 1 }], inputs: [{ item: "Plank", qty: 3 }, { item: "Ingot", qty: 1 }], stations: ["Anvil"] },
    { id: 4, outputs: [{ item: "Ingot", qty: 4 }], inputs: [{ item: "Shard", qty: 1 }], stations: ["The Devourer"] },
    { id: 5, outputs: [{ item: "Loop", qty: 1 }], inputs: [{ item: "Loop", qty: 1 }, { item: "Wood", qty: 1 }], stations: ["By Hand"] },
  ],
  stations: {},
};

test("multiplies quantities down the chain", () => {
  const t = computeTotals(fixture, [{ item: "Sword", qty: 2 }]);
  assert.deepEqual(Object.fromEntries(t.raw), { Ore: 480, Wood: 320 });
  assert.deepEqual(Object.fromEntries(t.byproducts), { Sawdust: 16 });
});

test("merges shared intermediates before rounding", () => {
  const plank4 = structuredClone(fixture);
  plank4.recipes[2].outputs[0].qty = 4; // 4 planks per craft
  const t = computeTotals(plank4, [{ item: "Sword", qty: 1 }, { item: "Axe", qty: 1 }]);
  const plank = t.steps.find((s) => s.item === "Plank");
  assert.equal(plank.need, 11);
  assert.equal(plank.crafts, 3); // ceil(11/4), not ceil(8/4)+ceil(3/4)=3 — and Wood follows
  assert.equal(t.raw.get("Wood"), 60);
});

test("levels order crafts from raw upward and list stations", () => {
  const t = computeTotals(fixture, [{ item: "Sword", qty: 1 }]);
  assert.deepEqual(t.steps.map((s) => [s.item, s.level]), [["Ingot", 1], ["Plank", 1], ["Sword", 2]]);
  assert.deepEqual(t.stations.map((s) => s.name), ["Anvil", "Furnace", "Sawmill"]);
  assert.deepEqual([...t.stations[1].alternatives], ["Advanced Furnace"]);
});

test("a recipe choice and the raw override change the plan", () => {
  const devourer = computeTotals(fixture, [{ item: "Ingot", qty: 6 }], { Ingot: 4 });
  assert.equal(devourer.raw.get("Shard"), 2);
  const farmed = computeTotals(fixture, [{ item: "Sword", qty: 1 }], { Ingot: RAW });
  assert.equal(farmed.raw.get("Ingot"), 12);
  assert.equal(farmed.raw.has("Ore"), false);
});

test("items only made by breaking others down are farmed unless chosen", () => {
  const d = structuredClone(fixture);
  d.items.Shard = { ...item([6]), farmByDefault: true };
  d.recipes.push({ id: 6, outputs: [{ item: "Shard", qty: 1 }], inputs: [{ item: "Sword", qty: 1 }], stations: ["The Devourer"] });
  assert.equal(computeTotals(d, [{ item: "Shard", qty: 2 }]).raw.get("Shard"), 2);
  assert.equal(computeTotals(d, [{ item: "Shard", qty: 1 }], { Shard: 6 }).raw.get("Ore"), 240);
});

test("an unknown choice falls back to the default recipe", () => {
  const t = computeTotals(fixture, [{ item: "Ingot", qty: 1 }], { Ingot: 99 });
  assert.equal(t.raw.get("Ore"), 20);
});

test("cycles stop instead of recursing forever", () => {
  const t = computeTotals(fixture, [{ item: "Loop", qty: 1 }]);
  assert.deepEqual(Object.fromEntries(t.raw), { Loop: 1, Wood: 1 });
  const tree = buildTree(fixture, "Loop", 1);
  assert.equal(tree.children[0].cycle, true);
});

test("tree rounds per node", () => {
  const tree = buildTree(fixture, "Sword", 1);
  assert.equal(tree.crafts, 1);
  assert.deepEqual(tree.children.map((c) => [c.item, c.qty, c.crafts]), [["Ingot", 12, 12], ["Plank", 8, 8]]);
  assert.equal(tree.children[0].children[0].qty, 240);
});

test("search matches every word and only craftable items", () => {
  assert.deepEqual(searchItems(fixture, "ing"), ["Ingot"]);
  assert.deepEqual(searchItems(fixture, "ore"), []);
});

test("real data: Sanguine Greatsword chain matches the wiki", () => {
  const data = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url)));
  data.recipes = Object.fromEntries(data.recipes.map((r) => [r.id, r]));
  const t = computeTotals(data, [{ item: "Sanguine Greatsword", qty: 1 }]);
  const step = (n) => t.steps.find((s) => s.item === n);
  assert.equal(step("Sanguine Greatsword").recipe.stations[0], "Anvil");
  assert.equal(step("Gold Ingot").crafts, 12);
  assert.equal(step("Dark Silver Ingot").recipe.stations[0], "Advanced Furnace");
  assert.ok(t.raw.get("Silver Ore") > 0);
});
