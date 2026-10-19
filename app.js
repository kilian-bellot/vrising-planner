import { computeTotals, buildTree, searchItems, recipeFor, outputQty, defaultChoice, RAW } from "./planner.js";
import { translator, LANGS } from "./i18n.js";

const WIKI = "https://vrising.fandom.com/wiki/";
const STORE = "vrising-planner/v1";
const LANG_STORE = "vrising-planner/lang";

let data;
let build = [];     // [{ item, qty }]
let choices = {};   // { item: recipeId | "raw" }
let have = new Set(); // items already owned: skipped with their chain
let lang = "en";
let t = translator(lang);

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

const fmt = (n) => t.number(n);

// Displayed name: French from the game when available, else the English (wiki) name.
function name(n) {
  if (lang !== "fr") return n;
  return data.items[n]?.fr ?? data.stations[n]?.fr ?? n;
}

function icon(item, small = false) {
  const src = data.items[item]?.icon ?? data.stations[item]?.icon;
  const img = h("img", { class: "icon" + (small ? " small" : ""), alt: "", loading: "lazy",
    referrerpolicy: "no-referrer", src: src ?? undefined });
  if (!src) img.classList.add("missing");
  img.addEventListener("error", () => img.classList.add("missing"));
  return img;
}

// Links go to the English wiki: the French one covers few items.
function link(item) {
  return h("a", { href: WIKI + encodeURIComponent(item.replaceAll(" ", "_")), target: "_blank", rel: "noopener",
    title: lang === "fr" ? item : undefined }, name(item));
}

// A recipe's identity that survives a data refresh (ids do not).
function signature(recipe) {
  return recipe.inputs.map((i) => `${i.qty} ${i.item}`).sort().join("+") + "@" + recipe.stations.join("/");
}

function recipeLabel(recipe, item) {
  const ins = recipe.inputs.map((i) => `${i.qty} ${name(i.item)}`).join(" + ");
  const made = outputQty(recipe, item);
  return `${ins}${made > 1 ? " → " + made : ""} · ${name(recipe.stations[0])}`;
}

// ---------------------------------------------------------------- state

function save() {
  const saved = Object.fromEntries(Object.entries(choices).map(([item, c]) =>
    [item, c === RAW ? RAW : signature(data.recipes[c])]));
  try { localStorage.setItem(STORE, JSON.stringify({ build, choices: saved, have: [...have] })); } catch { /* private mode */ }
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
  have = new Set((stored.have ?? []).filter((item) => data.items[item]));
  let fromHash = null;
  const m = location.hash.match(/^#build=(.+)$/);
  if (m) {
    try { fromHash = JSON.parse(decodeURIComponent(m[1])).map(([item, qty]) => ({ item, qty: Number(qty) || 1 })); } catch { /* ignore */ }
  }
  build = (fromHash ?? stored.build ?? []).filter((b) => data.items[b.item]);
}

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_STORE);
    if (LANGS.includes(saved)) return saved;
  } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

function setLang(next) {
  lang = next;
  t = translator(lang);
  try { localStorage.setItem(LANG_STORE, lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  searchInput.placeholder = t("searchPlaceholder");
  searchInput.setAttribute("aria-label", t("searchLabel"));
  for (const b of document.querySelectorAll("[data-lang]")) b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  if (data) {
    document.getElementById("footer-text").textContent = t("footer", data.generated);
    renderSearch();
    render();
  }
}

function addItems(names) {
  for (const item of names) {
    const existing = build.find((b) => b.item === item);
    if (existing) existing.qty += 1;
    else build.push({ item, qty: 1 });
  }
  render();
}

function toggleHave(item) {
  if (have.has(item)) have.delete(item);
  else have.add(item);
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
  matches = searchItems(data, searchInput.value, 60, name);
  active = matches.length ? 0 : -1;
  results.replaceChildren(...matches.map((item, i) => h("li", {
    class: i === active ? "active" : "", role: "option",
    onmousedown: (e) => { e.preventDefault(); pick([item]); },
  }, icon(item, true), h("span", { class: "name" }, name(item)), h("span", { class: "type" }, t.type(data.items[item].type)))));
  results.hidden = !matches.length;
  if (searchInput.value.trim() && !matches.length) {
    results.replaceChildren(h("li", {}, h("span", { class: "muted" }, t("noMatch"))));
    results.hidden = false;
  }
  addAll.hidden = matches.length < 2;
  addAll.textContent = t("addAll", matches.length);
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

// "makes 2 per craft": explains why 1 and 2 cost the same.
function batchHint(entry) {
  const recipe = recipeFor(data, entry.item, choices);
  const per = recipe ? outputQty(recipe, entry.item) : 1;
  return per > 1 ? h("span", { class: "alt hint" }, ` · ${t("perCraft", per)}`) : null;
}

function renderBuild() {
  const list = document.getElementById("build");
  list.replaceChildren(...build.map((entry) => h("li", {},
    icon(entry.item, true),
    h("span", { class: "name" }, name(entry.item), batchHint(entry)),
    h("input", { type: "number", min: "1", value: entry.qty, "aria-label": t("quantityOf", name(entry.item)),
      onchange: (e) => { entry.qty = Math.max(1, Math.floor(Number(e.target.value)) || 1); render(); } }),
    h("button", { class: "icon-btn", title: t("remove"), "aria-label": t("removeItem", name(entry.item)),
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
  try { await navigator.clipboard.writeText(location.href); toast(t("linkCopied")); }
  catch { toast(t("copyAddress")); }
});
for (const b of document.querySelectorAll("[data-lang]")) b.addEventListener("click", () => setLang(b.dataset.lang));

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
      t(farmed ? "craftInstead" : "farmInstead"));
  }
  return h("select", { "aria-label": t("recipeFor", name(item)), onchange: (e) => setChoice(item, e.target.value) },
    ids.map((id) => h("option", { value: id, selected: id === current }, recipeLabel(data.recipes[id], item))),
    h("option", { value: RAW, selected: current === RAW }, t("farmIt")));
}

function renderTotals() {
  const totals = computeTotals(data, build, choices, have);
  const byQty = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));

  document.getElementById("farm").replaceChildren(...byQty(totals.raw).map(([i, q]) => chip(i, q)));
  document.getElementById("byproducts-wrap").hidden = !totals.byproducts.size;
  document.getElementById("byproducts").replaceChildren(...byQty(totals.byproducts).map(([i, q]) => chip(i, q)));
  document.getElementById("owned-wrap").hidden = !totals.owned.size;
  document.getElementById("owned").replaceChildren(...byQty(totals.owned).map(([i, q]) => {
    const li = chip(i, q);
    li.append(h("button", { class: "icon-btn", title: t("needIt"), "aria-label": t("needIt") + " — " + name(i),
      onclick: () => toggleHave(i) }, "×"));
    return li;
  }));

  document.getElementById("stations").replaceChildren(...totals.stations.map((s) => {
    const info = data.stations[s.name] ?? {};
    const unlock = (lang === "fr" && info.unlockFr) || info.unlock;
    return h("tr", {},
      h("td", {}, h("div", { class: "station" }, icon(s.name, true),
        h("div", {}, s.name === "By Hand" ? name(s.name) : link(s.name),
          s.alternatives.size ? h("div", { class: "alt" }, t("or") + " " + [...s.alternatives].map(name).join(", ")) : null))),
      h("td", {}, unlock || (s.name === "By Hand" ? "—" : t("default"))),
      h("td", { class: "alt" }, s.items.map(name).join(", ")));
  }));
}

function treeNode(node, depth) {
  const head = [
    icon(node.item, true),
    h("span", { class: "qty" }, fmt(node.qty)),
    link(node.item),
  ];
  if (node.recipe) {
    const [main, ...others] = node.recipe.stations;
    head.push(h("span", { class: "at" }, t("at", fmt(node.crafts), name(main)) +
      (others.length ? ` (${t("or")} ${others.map(name).join(", ")})` : "")));
    const per = outputQty(node.recipe, node.item);
    const made = node.crafts * per;
    if (made > node.qty) head.push(h("span", { class: "badge", title: t("oneCraftMakes", per) }, t("makes", fmt(made))));
  } else if (node.owned) {
    head.push(h("span", { class: "badge have" }, t("haveBadge")));
  } else {
    head.push(h("span", { class: "badge raw" }, t(node.cycle ? "farmLoop" : "farm")));
  }
  // Farming the end product itself makes no sense: no control on a single-recipe root.
  if (!node.owned && node.options.length && !node.cycle && !(depth === 0 && node.options.length === 1)) head.push(recipeSelect(node.item));
  if (depth > 0) head.push(h("button", { class: "link toggle", onclick: (e) => { e.preventDefault(); toggleHave(node.item); } },
    t(node.owned ? "needIt" : "haveIt")));
  if (node.owned) return h("li", { class: "node owned" }, h("div", { class: "leaf" }, head));
  if (!node.children.length) return h("li", { class: "node" }, h("div", { class: "leaf" }, head));
  return h("li", { class: "node" }, h("details", { open: depth < 3 },
    h("summary", {}, head),
    h("ul", {}, node.children.map((c) => treeNode(c, depth + 1)))));
}

function renderTrees() {
  document.getElementById("trees").replaceChildren(...build.map((entry) =>
    h("div", { class: "tree" }, h("ul", {}, treeNode(buildTree(data, entry.item, entry.qty, choices, have), 0)))));
}

function render() {
  renderBuild();
  if (build.length) { renderTotals(); renderTrees(); }
  save();
}

// ---------------------------------------------------------------- start

async function start() {
  setLang(initialLang());
  const resp = await fetch("data/recipes.json");
  data = await resp.json();
  load();
  setLang(lang);
  // recipeFor is exposed for debugging in the console.
  Object.assign(window, { planner: { data, recipeFor: (item) => recipeFor(data, item, choices) } });
}

start().catch((err) => {
  document.querySelector("main").prepend(h("p", { class: "panel" }, t("loadError"), String(err)));
});
