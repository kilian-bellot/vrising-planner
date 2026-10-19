import { computeTotals, buildTree, searchItems, recipeFor, outputQty, defaultChoice, RAW } from "./planner.js";

const WIKI = "https://vrising.fandom.com/wiki/";
const STORE = "vrising-planner/v1";

let data;
let build = [];     // [{ item, qty }]
let choices = {};   // { item: recipeId | "raw" }

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const fmt = (n) => n.toLocaleString("en-US");

function icon(name, small = false) {
  const src = data.items[name]?.icon ?? data.stations[name]?.icon;
  const img = h("img", { class: "icon" + (small ? " small" : ""), alt: "", loading: "lazy",
    referrerpolicy: "no-referrer", src: src ?? undefined });
  if (!src) img.classList.add("missing");
  img.addEventListener("error", () => img.classList.add("missing"));
  return img;
}

function link(name) {
  return h("a", { href: WIKI + encodeURIComponent(name.replaceAll(" ", "_")), target: "_blank", rel: "noopener" }, name);
}

// A recipe's identity that survives a data refresh (ids do not).
function signature(recipe) {
  return recipe.inputs.map((i) => `${i.qty} ${i.item}`).sort().join("+") + "@" + recipe.stations.join("/");
}

function recipeLabel(recipe, item) {
  const ins = recipe.inputs.map((i) => `${i.qty} ${i.item}`).join(" + ");
  const made = outputQty(recipe, item);
  return `${ins}${made > 1 ? " → " + made : ""} · ${recipe.stations[0]}`;
}

// ---------------------------------------------------------------- state

function save() {
  const saved = Object.fromEntries(Object.entries(choices).map(([item, c]) =>
    [item, c === RAW ? RAW : signature(data.recipes[c])]));
  try { localStorage.setItem(STORE, JSON.stringify({ build, choices: saved })); } catch { /* private mode */ }
  history.replaceState(null, "", build.length ? "#build=" + encodeURIComponent(JSON.stringify(build.map((b) => [b.item, b.qty]))) : location.pathname);
}

function load() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { /* ignore */ }
  for (const [item, sig] of Object.entries(stored.choices ?? {})) {
    if (sig === RAW) { choices[item] = RAW; continue; }
    const id = data.items[item]?.recipes.find((r) => signature(data.recipes[r]) === sig);
    if (id !== undefined) choices[item] = id;
  }
  let fromHash = null;
  const m = location.hash.match(/^#build=(.+)$/);
  if (m) {
    try { fromHash = JSON.parse(decodeURIComponent(m[1])).map(([item, qty]) => ({ item, qty: Number(qty) || 1 })); } catch { /* ignore */ }
  }
  build = (fromHash ?? stored.build ?? []).filter((b) => data.items[b.item]);
}

function addItems(names) {
  for (const item of names) {
    const existing = build.find((b) => b.item === item);
    if (existing) existing.qty += 1;
    else build.push({ item, qty: 1 });
  }
  render();
}

function setChoice(item, value) {
  const choice = value === RAW ? RAW : Number(value);
  if (choice === defaultChoice(data, item)) delete choices[item];
  else choices[item] = choice;
  render();
}

// ---------------------------------------------------------------- search

const searchInput = document.getElementById("search");
const results = document.getElementById("results");
const addAll = document.getElementById("add-all");
let matches = [];
let active = -1;

function renderSearch() {
  matches = searchItems(data, searchInput.value, 60);
  active = matches.length ? 0 : -1;
  results.replaceChildren(...matches.map((name, i) => h("li", {
    class: i === active ? "active" : "", role: "option",
    onmousedown: (e) => { e.preventDefault(); pick([name]); },
  }, icon(name, true), h("span", { class: "name" }, name), h("span", { class: "type" }, data.items[name].type))));
  results.hidden = !matches.length;
  if (searchInput.value.trim() && !matches.length) {
    results.replaceChildren(h("li", {}, h("span", { class: "muted" }, "No craftable item matches.")));
    results.hidden = false;
  }
  addAll.hidden = matches.length < 2;
  addAll.textContent = `Add all ${matches.length} matches`;
}

searchInput.addEventListener("input", renderSearch);
searchInput.addEventListener("keydown", (e) => {
  if (!matches.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    [...results.children].forEach((li, i) => li.classList.toggle("active", i === active));
    results.children[active]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && active >= 0) {
    pick([matches[active]]);
  } else if (e.key === "Escape") {
    searchInput.value = ""; renderSearch();
  }
});
addAll.addEventListener("click", () => pick(matches));

function pick(names) {
  addItems(names);
  searchInput.value = "";
  renderSearch();
  searchInput.focus();
}

// ---------------------------------------------------------------- build list

function renderBuild() {
  const list = document.getElementById("build");
  list.replaceChildren(...build.map((entry) => h("li", {},
    icon(entry.item, true),
    h("span", { class: "name" }, entry.item),
    h("input", { type: "number", min: "1", value: entry.qty, "aria-label": `Quantity of ${entry.item}`,
      onchange: (e) => { entry.qty = Math.max(1, Math.floor(Number(e.target.value)) || 1); render(); } }),
    h("button", { class: "icon-btn", title: "Remove", "aria-label": `Remove ${entry.item}`,
      onclick: () => { build = build.filter((b) => b !== entry); render(); } }, "×"),
  )));
  const empty = !build.length;
  document.getElementById("build-empty").hidden = !empty;
  document.getElementById("clear").hidden = empty;
  document.getElementById("share").hidden = empty;
  document.getElementById("output").hidden = empty;
}

document.getElementById("clear").addEventListener("click", () => { build = []; render(); });
document.getElementById("share").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
  catch { toast("Copy the address bar to share this build"); }
});

function toast(text) {
  const el = h("div", { class: "toast", role: "status" }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------------------------------------------------------------- results

function chip(item, qty) {
  return h("li", {}, icon(item, true), h("span", { class: "qty" }, fmt(qty)), link(item));
}

function recipeSelect(item) {
  const ids = data.items[item]?.recipes ?? [];
  if (!ids.length) return null;
  const current = choices[item] ?? defaultChoice(data, item);
  if (ids.length === 1) {
    const farmed = current === RAW;
    return h("button", { class: "link toggle", onclick: (e) => { e.preventDefault(); setChoice(item, farmed ? ids[0] : RAW); } },
      farmed ? "craft instead" : "farm instead");
  }
  return h("select", { "aria-label": `Recipe for ${item}`, onchange: (e) => setChoice(item, e.target.value) },
    ids.map((id) => h("option", { value: id, selected: id === current }, recipeLabel(data.recipes[id], item))),
    h("option", { value: RAW, selected: current === RAW }, "Farm it (don't craft)"));
}

function renderTotals() {
  const totals = computeTotals(data, build, choices);
  const byQty = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  document.getElementById("farm").replaceChildren(...byQty(totals.raw).map(([i, q]) => chip(i, q)));
  document.getElementById("byproducts-wrap").hidden = !totals.byproducts.size;
  document.getElementById("byproducts").replaceChildren(...byQty(totals.byproducts).map(([i, q]) => chip(i, q)));

  document.getElementById("stations").replaceChildren(...totals.stations.map((s) => {
    const info = data.stations[s.name] ?? {};
    return h("tr", {},
      h("td", {}, h("div", { class: "station" }, icon(s.name, true),
        h("div", {}, s.name === "By Hand" ? "By hand" : link(s.name),
          s.alternatives.size ? h("div", { class: "alt" }, "or " + [...s.alternatives].join(", ")) : null))),
      h("td", {}, info.unlock || (s.name === "By Hand" ? "—" : "Default")),
      h("td", { class: "alt" }, s.items.join(", ")));
  }));

  const levels = new Map();
  for (const step of totals.steps) {
    if (!levels.has(step.level)) levels.set(step.level, []);
    levels.get(step.level).push(step);
  }
  document.getElementById("steps").replaceChildren(...[...levels.entries()].map(([level, steps]) =>
    h("div", { class: "level" },
      h("h3", {}, `Step ${level}`),
      steps.map((s) => h("div", { class: "step" },
        icon(s.item),
        h("div", { class: "what" },
          h("span", { class: "times" }, `${fmt(s.crafts)}×`),
          link(s.item),
          h("span", { class: "at" }, `at ${s.recipe.stations[0]}`),
          s.made > s.need ? h("span", { class: "badge" }, `makes ${fmt(s.made)}, need ${fmt(s.need)}`) : null),
        h("div", { class: "details" },
          s.recipe.inputs.map((i) => `${fmt(i.qty * s.crafts)} ${i.item}`).join(" + "),
          s.recipe.time ? ` · ${s.recipe.time} each` : ""))))));
}

function treeNode(node, depth) {
  const head = [
    icon(node.item, true),
    h("span", { class: "qty" }, fmt(node.qty)),
    link(node.item),
  ];
  if (node.recipe) {
    head.push(h("span", { class: "at" }, `${fmt(node.crafts)}× at ${node.recipe.stations[0]}` +
      (node.recipe.stations.length > 1 ? ` (or ${node.recipe.stations.slice(1).join(", ")})` : "")));
  } else {
    head.push(h("span", { class: "badge raw" }, node.cycle ? "farm (loop)" : "farm"));
  }
  // Farming the end product itself makes no sense: no control on a single-recipe root.
  if (node.options.length && !node.cycle && !(depth === 0 && node.options.length === 1)) head.push(recipeSelect(node.item));
  if (!node.children.length) return h("li", { class: "node" }, h("div", { class: "leaf" }, head));
  return h("li", { class: "node" }, h("details", { open: depth < 3 },
    h("summary", {}, head),
    h("ul", {}, node.children.map((c) => treeNode(c, depth + 1)))));
}

function renderTrees() {
  document.getElementById("trees").replaceChildren(...build.map((entry) =>
    h("div", { class: "tree" }, h("ul", {}, treeNode(buildTree(data, entry.item, entry.qty, choices), 0)))));
}

function render() {
  renderBuild();
  if (build.length) { renderTotals(); renderTrees(); }
  save();
}

// ---------------------------------------------------------------- start

async function start() {
  const resp = await fetch("data/recipes.json");
  data = await resp.json();
  document.getElementById("data-date").textContent = data.generated;
  load();
  render();
  // recipeFor is re-exported for debugging in the console.
  Object.assign(window, { planner: { data, recipeFor: (item) => recipeFor(data, item, choices) } });
}

start().catch((err) => {
  document.querySelector("main").prepend(h("p", { class: "panel" },
    "Could not load data/recipes.json — open the page through a web server (see README). ", String(err)));
});
