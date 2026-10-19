# V Rising Craft Planner

Plan a V Rising build — weapons, armour set, jewelry, potions — and see everything it takes:

- **To farm**: raw resources for the whole build, merged.
- **Crafting tree**: per item, what to craft where and how many times, with a recipe picker
  where the wiki lists several ways (or “farm it” to stop the chain there, e.g. when you loot Leather).
  “I have it” drops an item you already own with everything below it.
- **Stations**: every station used, with the boss that unlocks it.

Live page: https://kilian-bellot.github.io/vrising-planner/

The build list and recipe choices are kept in your browser; the URL also carries the build,
so it can be shared.

**EN / FR** switch at the top. French item, station and boss names come from the game's own
string tables (as extracted by the [Bloodcraft](https://github.com/mfoltz/Bloodcraft) mod), with the
French wiki as fallback; search works in both languages and ignores accents.

## Data

`data/recipes.json` is a snapshot built from the [V Rising Wiki](https://vrising.fandom.com/)
(content licensed [CC BY-SA](https://creativecommons.org/licenses/by-sa/3.0/)). Refresh it with:

```sh
python scripts/fetch_wiki.py      # downloads all wiki pages into cache/ (~1 min)
python scripts/build_recipes.py   # parses recipes into data/recipes.json
```

then commit `data/recipes.json`. A GitHub Action (`.github/workflows/refresh-data.yml`) does this
every Monday and commits only when recipes actually changed; it can also be started by hand from
the Actions tab. The parser reads every crafting table on the wiki
(item pages and station pages) — see `docs/superpowers/specs/` for the rules
(default recipe choice, alternatives, byproducts, Devourer-only items).

Wiki pages sometimes disagree with each other (e.g. 6 vs 8 Leather); both versions
are kept and selectable, the item's own page wins by default.

## Develop

No build step. Serve the folder and open it:

```sh
python -m http.server 8000        # then http://localhost:8000
```

Tests:

```sh
python -m unittest discover -s tests   # wiki parser
node --test tests/planner.test.js      # planner maths
```
