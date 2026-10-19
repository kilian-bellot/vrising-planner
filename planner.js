// Craft planning maths. Pure functions over data/recipes.json; no DOM.
//
// choices: { [item]: recipeId | "raw" } — overrides of the default recipe.
// build:   [{ item, qty }] — the end products wanted.
// have:    Set of items already owned: neither crafted nor farmed, their chain is skipped.

export const RAW = "raw";

export function recipeFor(data, item, choices = {}) {
  const choice = choices[item];
  if (choice === RAW || (choice === undefined && data.items[item]?.farmByDefault)) return null;
  const ids = data.items[item]?.recipes ?? [];
  const id = ids.includes(choice) ? choice : ids[0];
  return id === undefined ? null : data.recipes[id];
}

export function defaultChoice(data, item) {
  return data.items[item]?.farmByDefault ? RAW : data.items[item]?.recipes[0];
}

export function outputQty(recipe, item) {
  return recipe.outputs.find((o) => o.item === item)?.qty ?? 1;
}

// Items in an order where every item comes before the items it is made from.
// An input that leads back to an item being expanded closes a cycle: that input is taken as raw.
function plan(data, build, choices, have) {
  const order = [];
  const done = new Set();
  const onPath = new Set();
  const cyclic = new Set(); // "parent\u0000input" edges that close a cycle

  const visit = (item) => {
    if (done.has(item)) return;
    onPath.add(item);
    const recipe = have.has(item) ? null : recipeFor(data, item, choices);
    for (const input of recipe?.inputs ?? []) {
      if (onPath.has(input.item)) cyclic.add(item + "\u0000" + input.item);
      else visit(input.item);
    }
    onPath.delete(item);
    done.add(item);
    order.push(item);
  };
  for (const { item } of build) visit(item);
  return { order: order.reverse(), cyclic };
}

export function computeTotals(data, build, choices = {}, have = new Set()) {
  const { order, cyclic } = plan(data, build, choices, have);
  const demand = new Map();
  for (const { item, qty } of build) demand.set(item, (demand.get(item) ?? 0) + qty);

  const raw = new Map();
  const owned = new Map();
  const byproducts = new Map();
  const steps = new Map();
  for (const item of order) {
    const need = demand.get(item) ?? 0;
    if (need <= 0) continue;
    if (have.has(item)) { owned.set(item, need); continue; }
    const recipe = recipeFor(data, item, choices);
    if (!recipe) { raw.set(item, (raw.get(item) ?? 0) + need); continue; }
    const crafts = Math.ceil(need / outputQty(recipe, item));
    steps.set(item, { item, recipe, crafts, need, made: crafts * outputQty(recipe, item), level: 0 });
    for (const input of recipe.inputs) {
      const target = cyclic.has(item + "\u0000" + input.item) ? raw : demand;
      target.set(input.item, (target.get(input.item) ?? 0) + crafts * input.qty);
    }
    for (const out of recipe.outputs) {
      if (out.item !== item) byproducts.set(out.item, (byproducts.get(out.item) ?? 0) + crafts * out.qty);
    }
  }

  // Level = 1 + highest level among crafted inputs: level 1 is made from raw only.
  for (const item of [...order].reverse()) {
    const step = steps.get(item);
    if (!step) continue;
    step.level = 1 + Math.max(0, ...step.recipe.inputs.map((i) => steps.get(i.item)?.level ?? 0));
  }

  const stations = new Map();
  for (const step of steps.values()) {
    const [main, ...others] = step.recipe.stations;
    const entry = stations.get(main) ?? { name: main, alternatives: new Set(), items: [] };
    others.forEach((s) => entry.alternatives.add(s));
    entry.items.push(step.item);
    stations.set(main, entry);
  }

  return {
    raw,
    owned,
    byproducts,
    steps: [...steps.values()].sort((a, b) =>
      a.level - b.level || a.recipe.stations[0].localeCompare(b.recipe.stations[0]) || a.item.localeCompare(b.item)),
    stations: [...stations.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Tree for one build entry, rounded on its own (the totals are the merged reference).
export function buildTree(data, item, qty, choices = {}, have = new Set(), path = new Set()) {
  const cycle = path.has(item);
  const owned = have.has(item);
  const recipe = cycle || owned ? null : recipeFor(data, item, choices);
  const node = { item, qty, recipe, crafts: 0, children: [], cycle, owned,
    options: data.items[item]?.recipes ?? [] };
  if (!recipe) return node;
  node.crafts = Math.ceil(qty / outputQty(recipe, item));
  const next = new Set(path).add(item);
  node.children = recipe.inputs.map((i) => buildTree(data, i.item, node.crafts * i.qty, choices, have, next));
  return node;
}

// label(name) is the displayed (maybe translated) name; both it and the English name are searched.
// Accents are ignored, so "epee" finds "Épée".
export function searchItems(data, query, limit = 30, label = (n) => n) {
  const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2019']/g, "'").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  return Object.keys(data.items)
    .filter((name) => data.items[name].recipes.length &&
      words.every((w) => fold(label(name)).includes(w) || fold(name).includes(w)))
    .sort((a, b) => (fold(label(b)).startsWith(q) - fold(label(a)).startsWith(q)) || label(a).localeCompare(label(b)))
    .slice(0, limit);
}
