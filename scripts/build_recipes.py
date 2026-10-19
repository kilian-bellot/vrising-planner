"""Turn the wiki dump (cache/wiki_pages.json) into data/recipes.json.

Every wikitable that has an item column, a materials column and (a structure
column, or sits on a structure page) becomes recipes. Rowspans are expanded,
and recipes found on several pages are merged. See docs/superpowers/specs.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "cache" / "wiki_pages.json"
ICON_CACHE = ROOT / "cache" / "icons.json"
OUT = ROOT / "data" / "recipes.json"
API = "https://vrising.fandom.com/api.php"

OUTPUT_HEADERS = {"item", "items", "resulting item", "result", "product"}
INPUT_HEADERS = {"materials", "material", "recipe", "ingredients", "cost", "required materials", "resources"}
STATION_HEADERS = {"structure", "station", "crafting station", "workstation"}
TIME_HEADERS = {"crafting time", "time"}
UNLOCK_HEADERS = {"unlocked by", "unlock", "unlocked"}

# Stations whose recipes are never picked by default (shard breakdowns, summons…).
NON_DEFAULT_STATIONS = {"The Devourer"}
# Default recipe for items whose wiki page lists the usual way after others.
PREFERRED_INPUT = {"Plank": "Wood"}


# ---------------------------------------------------------------- wikitext helpers

def split_top(text, sep):
    """Split on `sep` outside {{ }} and [[ ]]."""
    parts, cur, depth_t, depth_l, i = [], [], 0, 0, 0
    while i < len(text):
        two = text[i:i + 2]
        if two == "{{":
            depth_t += 1; cur.append(two); i += 2; continue
        if two == "}}" and depth_t:
            depth_t -= 1; cur.append(two); i += 2; continue
        if two == "[[":
            depth_l += 1; cur.append(two); i += 2; continue
        if two == "]]" and depth_l:
            depth_l -= 1; cur.append(two); i += 2; continue
        if not depth_t and not depth_l and text.startswith(sep, i):
            parts.append("".join(cur)); cur = []; i += len(sep); continue
        cur.append(text[i]); i += 1
    parts.append("".join(cur))
    return parts


def templates(text, name):
    """Yield the argument list of every {{name|...}} (nested ones included)."""
    pattern = re.compile(r"\{\{\s*" + re.escape(name) + r"\s*(\||\}\})", re.I)
    i = 0
    while True:
        m = pattern.search(text, i)
        if not m:
            return
        depth, j = 0, m.start()
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1; j += 2; continue
            if text.startswith("}}", j):
                depth -= 1; j += 2
                if depth == 0:
                    break
                continue
            j += 1
        args = split_top(text[m.start() + 2:j - 2], "|")
        yield args[1:]
        i = m.end()


def kwargs(args):
    out = {}
    for a in args:
        head = a.split("{{")[0].split("[[")[0]
        if "=" in head:
            k, v = a.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def positional(args):
    return [a for a in args if "=" not in a.split("{{")[0].split("[[")[0]]


def expand_magic(text, title):
    text = re.sub(r"\{\{\s*PAGENAME\s*\}\}", title, text)

    def rep(m):
        a = split_top(m.group(1), "|")
        return a[0].replace(a[1], a[2] if len(a) > 2 else "") if len(a) >= 2 else a[0]
    for _ in range(3):
        text = re.sub(r"\{\{#replace:((?:[^{}]|\{\{[^{}]*\}\})*)\}\}", rep, text)
    return text


def clean_name(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&#39;", "'").replace("’", "'").replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:1].upper() + s[1:]


def plain(s):
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"<br\s*/?>", " / ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"'''?", "", s)
    return re.sub(r"\s+", " ", s).strip(" /")


def item_frames(cell):
    """[{name, qty, type, image}] for each {{ItemFrame}} in a cell."""
    out = []
    for args in templates(cell, "ItemFrame"):
        pos, kw = positional(args), kwargs(args)
        name = clean_name(kw.get("sub") or kw.get("itemname") or (pos[0] if pos else ""))
        if not name:
            continue
        qty = 1
        if len(pos) > 1:
            m = re.match(r"\s*(\d+)", pos[1])
            if m:
                qty = int(m.group(1))
        out.append({"name": name, "qty": qty,
                    "type": kw.get("type") or kw.get("itemtype") or "",
                    "image": kw.get("image", "")})
    return out


def wiki_links(cell):
    return [clean_name(m.group(1)) for m in re.finditer(r"\[\[([^|\]#]+)[^\]]*\]\]", cell)]


# ---------------------------------------------------------------- tables

ATTR_RE = re.compile(r"(rowspan|colspan|style|class|width|align|scope)\s*=", re.I)


def parse_tables(text):
    """Tables as lists of rows; a row is a list of [is_header, attrs, content]."""
    tables, stack = [], []
    for raw in text.split("\n"):
        line = raw.strip()
        if line.startswith("{|"):
            stack.append({"rows": [], "row": None})
            continue
        if not stack:
            continue
        t = stack[-1]
        if line.startswith("|}"):
            if t["row"] is not None:
                t["rows"].append(t["row"])
            stack.pop()
            if not stack:
                tables.append(t["rows"])
            continue
        if line.startswith("|-"):
            if t["row"] is not None:
                t["rows"].append(t["row"])
            t["row"] = []
            continue
        if line.startswith("|+"):
            continue
        if line.startswith("!") or line.startswith("|"):
            if t["row"] is None:
                t["row"] = []
            header = line.startswith("!")
            body = line[1:]
            cells = split_top(body, "!!") if header else split_top(body, "||")
            if header and len(cells) == 1:
                cells = split_top(body, "||")
            for c in cells:
                parts = split_top(c, "|")
                if len(parts) > 1 and ATTR_RE.search(parts[0]) and "{{" not in parts[0]:
                    attrs, content = parts[0], "|".join(parts[1:])
                else:
                    attrs, content = "", c
                t["row"].append([header, attrs, content])
            continue
        if t["row"]:
            t["row"][-1][2] += "\n" + raw
    return tables


def grid(rows):
    """Expand rowspan/colspan: a list of rows of (is_header, content)."""
    out, pending = [], {}  # pending[col] = [remaining_rows, cell]
    for row in rows:
        cells, col, queue = [], 0, list(row)
        while queue or any(c >= col for c in pending):
            if col in pending:
                pending[col][0] -= 1
                cells.append(pending[col][1])
                if pending[col][0] == 0:
                    del pending[col]
                col += 1
                continue
            if not queue:
                break
            header, attrs, content = queue.pop(0)
            rs = re.search(r"rowspan\s*=\s*[\"']?(\d+)", attrs)
            cs = re.search(r"colspan\s*=\s*[\"']?(\d+)", attrs)
            for _ in range(int(cs.group(1)) if cs else 1):
                cells.append((header, content))
                if rs and int(rs.group(1)) > 1:
                    pending[col] = [int(rs.group(1)) - 1, (header, content)]
                col += 1
        out.append(cells)
    return out


def table_recipes(title, text, is_station_page):
    """Raw recipes from every crafting table on one page."""
    found = []
    for rows in parse_tables(expand_magic(text, title)):
        g = grid(rows)
        hdr = next((r for r in g if r and all(h for h, _ in r)), None)
        if not hdr:
            continue
        labels = [plain(c).lower().strip(" :") for _, c in hdr]

        def col(names):
            return next((i for i, l in enumerate(labels) if l in names), None)
        c_out, c_in, c_st = col(OUTPUT_HEADERS), col(INPUT_HEADERS), col(STATION_HEADERS)
        c_time, c_unl = col(TIME_HEADERS), col(UNLOCK_HEADERS)
        if c_out is None or c_in is None or (c_st is None and not is_station_page):
            continue
        for r in g:
            if all(h for h, _ in r):
                continue

            def cell(i):
                return r[i][1] if i is not None and i < len(r) else ""
            outs = item_frames(cell(c_out))
            # "A or B or C" in the materials cell: one recipe per alternative.
            alternatives = [a for a in (item_frames(part) for part in split_top(cell(c_in), " or")) if a]
            if not outs or not alternatives:
                continue
            if c_st is not None:
                stations = [f["name"] for f in item_frames(cell(c_st))] or wiki_links(cell(c_st))
                if not stations and plain(cell(c_st)):
                    stations = [clean_name(plain(cell(c_st)))]
            else:
                stations = [title]
            # A "/" between outputs lists variants sharing the recipe (e.g. cosmetic cloaks).
            alt = len(outs) > 1 and "/" in re.sub(r"\{\{(?:[^{}]|\{\{[^{}]*\}\})*\}\}", "", cell(c_out))
            for group in ([[o] for o in outs] if alt else [outs]):
              for ins in alternatives:
                found.append({
                    "outputs": group, "inputs": ins, "stations": stations,
                    "time": plain(cell(c_time)) if c_time is not None else "",
                    "unlock": plain(cell(c_unl)) if c_unl is not None else "",
                    "source": title,
                })
    return found


def template_recipes(title, text, recipe_data):
    """Recipes written as {{Recipe|name|station}} backed by Template:Recipe/data."""
    found = []
    for args in templates(text, "Recipe"):
        pos, kw = positional(args), kwargs(args)
        name = clean_name(pos[0]) if pos and pos[0].strip() else title
        station = clean_name(pos[1]) if len(pos) > 1 else ""
        m = re.search(r",Recipe_" + re.escape(name) + r",((?:[^,]*,)*?),", recipe_data)
        if not m or not station:
            continue
        vals = [v.strip() for v in m.group(1).split(",") if v.strip()]
        ins = [{"name": clean_name(vals[i + 1]), "qty": int(vals[i]), "type": "", "image": ""}
               for i in range(0, len(vals) - 1, 2) if vals[i].isdigit()]
        if ins:
            found.append({"outputs": [{"name": title, "qty": 1, "type": "", "image": ""}],
                          "inputs": ins, "stations": [station], "time": "",
                          "unlock": plain(kw.get("unlocked_by", "")), "source": title})
    return found


# ---------------------------------------------------------------- icons

def icon_name(name):
    return name.replace(" ", "").replace("'", "").replace("JewelTier", "Tier")


def resolve_icons(candidates):
    """{item: [file names]} -> {item: thumb url}, querying the wiki for unknown files."""
    cache = json.loads(ICON_CACHE.read_text(encoding="utf-8")) if ICON_CACHE.exists() else {}
    wanted = sorted({f for files in candidates.values() for f in files if f not in cache})
    for i in range(0, len(wanted), 50):
        batch = wanted[i:i + 50]
        params = {"action": "query", "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 64,
                  "titles": "|".join("File:" + f for f in batch), "format": "json", "formatversion": 2}
        req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "vrising-planner"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        norm = {n["to"]: n["from"] for n in data["query"].get("normalized", [])}
        for p in data["query"]["pages"]:
            file = norm.get(p["title"], p["title"]).removeprefix("File:")
            info = p.get("imageinfo")
            cache[file.replace(" ", "_")] = info[0].get("thumburl") or info[0]["url"] if info else None
        for f in batch:
            cache.setdefault(f, None)
        time.sleep(0.2)
    ICON_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    return {item: next((cache.get(f) for f in files if cache.get(f)), None)
            for item, files in candidates.items()}


# ---------------------------------------------------------------- build

def build(dump):
    pages, redirects, recipe_data = dump["pages"], dump["redirects"], dump.get("recipe_data", "")

    def follow(n):
        seen = set()
        while n in redirects and n not in seen:
            seen.add(n); n = redirects[n]
        return n

    stations, infobox = {}, {}
    for title, text in pages.items():
        head = text.lstrip()[:40].lower()
        for args in templates(text, "Structure"):
            kw = kwargs(args)
            stations[title] = {"unlock": plain(kw.get("unlocked_by", "")), "room": plain(kw.get("room", ""))}
            break
        for box in ("WeaponInfobox", "EquipmentInfobox", "ItemInfobox"):
            if head.startswith("{{" + box.lower()):
                kw = kwargs(next(templates(text, box), []))
                kind = {"WeaponInfobox": "Weapon", "EquipmentInfobox": "Equipment"}.get(box) \
                    or plain(kw.get("category", "")) or "Item"
                infobox[title] = {"type": kind, "image": kw.get("image", "").strip()}

    raw = []
    for title, text in pages.items():
        raw += table_recipes(title, text, title in stations)
        raw += template_recipes(title, text, recipe_data)

    # Follow a redirect only when it is a rename. Several names redirecting to one
    # page (armour pieces -> "X Armour Set") are distinct items sharing a page.
    # The target must also be an item (or a station, for station names).
    used_items = {f["name"] for r in raw for f in r["outputs"] + r["inputs"]}
    used_stations = {s for r in raw for s in r["stations"]}
    sharing = {}
    for n in used_items | used_stations | set(pages):
        sharing.setdefault(follow(n), set()).add(n)

    def canon(n, kinds):
        t = follow(n)
        return t if sharing[t] <= {n, t} and t in kinds else n
    item_pages = used_items | set(infobox)

    frame_meta = {}  # item -> first ItemFrame type/image seen
    recipes = {}
    for r in raw:
        if any(f["name"].startswith("Any ") for f in r["outputs"] + r["inputs"]):
            continue  # generic placeholder ("Any Gem")
        for f in r["outputs"] + r["inputs"]:
            f["name"] = canon(f["name"], item_pages)
            meta = frame_meta.setdefault(f["name"], {"type": "", "image": ""})
            meta["type"] = meta["type"] or f["type"]
            meta["image"] = meta["image"] or f["image"]
        outs = [{"item": f["name"], "qty": f["qty"]} for f in r["outputs"]]
        ins = [{"item": f["name"], "qty": f["qty"]} for f in r["inputs"]]
        if {o["item"] for o in outs} & {i["item"] for i in ins}:
            continue  # upgrade of the item into itself
        key = json.dumps([outs, sorted(ins, key=lambda x: x["item"])], sort_keys=True)
        rec = recipes.setdefault(key, {"outputs": outs, "inputs": ins, "stations": [],
                                       "time": "", "unlock": "", "sources": []})
        for s in r["stations"]:
            s = canon(s, used_stations | set(stations))
            if s not in rec["stations"]:
                rec["stations"].append(s)
        rec["time"] = rec["time"] or r["time"]
        rec["unlock"] = rec["unlock"] or r["unlock"]
        if r["source"] not in rec["sources"]:
            rec["sources"].append(r["source"])

    # "20 Wood -> 1 Plank" and "20 Wood -> 1 Plank + 1 Sawdust" are one recipe,
    # written with and without its byproduct: keep the fuller one.
    rec_list = list(recipes.values())
    def ins_key(r):
        return json.dumps(sorted(r["inputs"], key=lambda x: x["item"]), sort_keys=True)
    def outs_set(r):
        return {(o["item"], o["qty"]) for o in r["outputs"]}
    merged = []
    for r in rec_list:
        fuller = next((o for o in rec_list if o is not r and ins_key(o) == ins_key(r)
                       and outs_set(r) < outs_set(o) and set(r["stations"]) & set(o["stations"])), None)
        if fuller:
            for s in r["stations"]:
                if s not in fuller["stations"]:
                    fuller["stations"].append(s)
            fuller["time"] = fuller["time"] or r["time"]
            fuller["unlock"] = fuller["unlock"] or r["unlock"]
            fuller["sources"] += [x for x in r["sources"] if x not in fuller["sources"]]
        else:
            merged.append(r)
    rec_list = merged
    for i, r in enumerate(rec_list):
        r["id"] = i
        r["stations"].sort(key=lambda s: (s == "By Hand", s.startswith("Advanced"), s))

    by_output = {}
    for r in rec_list:
        for o in r["outputs"]:
            by_output.setdefault(o["item"], []).append(r)

    def rank(item, r):
        preferred = PREFERRED_INPUT.get(item)
        return (all(s in NON_DEFAULT_STATIONS for s in r["stations"]),
                bool(preferred) and preferred not in {i["item"] for i in r["inputs"]},
                item not in r["sources"],
                len(r["outputs"]) > 1,
                r["id"])

    names = {x["item"] for r in rec_list for x in r["outputs"] + r["inputs"]}
    used_stations = {s for r in rec_list for s in r["stations"]}

    candidates = {}
    for n in names | used_stations:
        files = []
        if infobox.get(n, {}).get("image"):
            files.append(infobox[n]["image"].replace(" ", "_"))
        meta = frame_meta.get(n, {})
        base = meta.get("image") or icon_name(n)
        prefix = (meta.get("type") or ("Structure" if n in stations else "Item")).capitalize()
        files += [f"{prefix}_{base}.png", f"Item_{base}.png", f"Structure_{base}.png"]
        candidates[n] = list(dict.fromkeys(files))
    icons = resolve_icons(candidates)

    items = {}
    for n in sorted(names):
        kind = frame_meta.get(n, {}).get("type") or infobox.get(n, {}).get("type") or ""
        own = by_output.get(n, [])
        items[n] = {
            "type": kind.capitalize() if kind else "",
            "icon": icons.get(n),
            "wiki": n in pages or n in redirects,
            "recipes": [r["id"] for r in sorted(own, key=lambda r: rank(n, r))],
            # Only obtainable by breaking other items down: farm it unless asked otherwise.
            "farmByDefault": bool(own) and all(set(r["stations"]) <= NON_DEFAULT_STATIONS for r in own),
        }
    station_out = {s: {**stations.get(s, {"unlock": "", "room": ""}), "icon": icons.get(s), "wiki": s in pages or s in redirects}
                   for s in sorted(used_stations)}
    return {"generated": date.today().isoformat(), "items": items, "recipes": rec_list, "stations": station_out}


def main():
    data = build(json.loads(SRC.read_text(encoding="utf-8")))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    missing_icons = [n for n, i in data["items"].items() if not i["icon"]]
    no_page = [n for n, i in data["items"].items() if not i["wiki"]]
    print(f"{len(data['recipes'])} recipes, {len(data['items'])} items, {len(data['stations'])} stations")
    print(f"{len(missing_icons)} items without icon, {len(no_page)} items without wiki page", file=sys.stderr)


if __name__ == "__main__":
    main()
