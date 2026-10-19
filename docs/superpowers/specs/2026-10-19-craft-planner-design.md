# V Rising craft planner — design

## Goal

Plan a full build (weapons, armour set, jewelry, potions…) and see everything
needed to craft it, down to what has to be farmed. Data comes from the
V Rising Fandom wiki (https://vrising.fandom.com, CC BY-SA).

Agreed with the user (2026-10-19):

- Several end products at once, each with a quantity ("build list").
- Output: the full crafting tree **and** a raw farm total **and** the list of
  stations needed (with the boss that unlocks each one).
- No inventory tracking: always the full need from zero.
- Station build costs are not added to the totals.
- Public repo `kilian-bellot/vrising-planner`, served by GitHub Pages.
- Approach A: static site + committed JSON snapshot built by Python scripts.

## Repo layout

```
index.html, app.js, planner.js, style.css   the page (no build step)
data/recipes.json                            committed snapshot
scripts/fetch_wiki.py                        wiki -> cache/ (git-ignored)
scripts/build_recipes.py                     cache -> data/recipes.json
tests/                                       Python parser tests, JS planner tests
```

## Data pipeline

`fetch_wiki.py` downloads the wikitext of every article, the redirect map and
`Template:Recipe/data`. `build_recipes.py` then:

1. Reads every wikitable with an *Item* column, a *Materials/Recipe* column and
   either a *Structure* column or a station page around it (station = page).
   Rowspans/colspans are expanded.
2. Reads `{{Recipe|name|station}}` calls through `Template:Recipe/data`.
3. Normalises names through redirects, merges identical recipes found on
   several pages (union of stations, first non-empty time/unlock).
4. A `/`-separated output cell lists alternatives sharing one recipe.
5. Drops recipes whose output is also an input (tier upgrades of the same item).
6. Resolves an icon per item with the `ItemFrame` naming rule
   (`File:<Type>_<NameNoSpacesNoApostrophes>.png`), falling back to `Item_`,
   via the imageinfo API (cached in `cache/icons.json`).

`recipes.json`: `items{name: {type, icon, wiki}}`,
`recipes[{id, outputs[{item,qty}], inputs[{item,qty}], stations[], time, unlock, sources[]}]`,
`stations{name: {unlock, room}}`.

**Default recipe** for an item: the first recipe listed on the item's own page
that is not made at The Devourer; else the first remaining one. Each item with
several recipes gets a selector in the tree, plus "farm it" (treat as raw).
Choices are remembered in localStorage, as is the build list.

## Changes after first release (2026-10-19)

- Panels: To farm, Crafting tree, Stations. "Crafting steps" was removed (duplicated the tree).
- "N per craft" / "makes N" hints: batch recipes (Power Core x2) otherwise look stuck between 1 and 2.
- EN/FR switch. French names: game string tables (English and French share GUIDs) from the
  Bloodcraft mod repo, then wiki `[[fr:...]]` links; derived names for rarity-prefixed ancestral
  gear and legendary shards. Search matches both languages, accent-insensitive.
- Weekly GitHub Action refreshes the data and commits when recipes change.
- "I have it" toggle per tree node (user request, replaces "no inventory tracking"): the item and
  its whole chain are skipped and listed under "Already have"; yes/no, no quantities. Kept apart from
  recipe choices so undoing it restores the chosen recipe.

## Planner maths (planner.js, pure functions)

- Totals: demand per item propagated in topological order of the chosen
  recipes, so shared intermediates are merged before rounding:
  `crafts = ceil(demand / outputQty)`, inputs += `crafts × qty`.
- Items without a chosen recipe are raw (farm list).
- Cycles: an item reached again while expanding its own chain is treated as raw.
- Tree: per build-list entry, recursive, with its own rounding (the merged
  totals are the reference).

## Page

- Search box with suggestions (icon, name, type) over craftable items;
  "add all matches" button to add a whole armour set at once.
- Build list with quantity inputs and remove buttons.
- Panels: **Farm** (raw totals), **Crafting steps** (merged intermediates
  grouped by station, deepest first), **Stations** (station + unlock boss),
  **Tree** (collapsible per build entry: icon, name, qty, crafts × station,
  alternative stations, time, recipe selector).
- Footer: data date, wiki credit and CC BY-SA notice.

## Testing

- Python `unittest` on saved wikitext snippets: table/rowspan parsing,
  ItemFrame parsing, PAGENAME expansion, `/` alternatives.
- `node --test` on planner.js: rounding, merged intermediates, alternative
  recipe choice, farm override, cycle guard.
- Spot-check known chains against the wiki (Sanguine Greatsword, Leather, Iron Ingot).
