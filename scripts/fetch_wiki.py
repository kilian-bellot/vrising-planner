"""Download the wikitext of every article on the V Rising Fandom wiki.

Output: cache/wiki_pages.json  ({title: wikitext}), consumed by build_recipes.py.
"""
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://vrising.fandom.com/api.php"
OUT = Path(__file__).resolve().parent.parent / "cache" / "wiki_pages.json"


def call(params):
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "v-rising-tools craft planner"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def main():
    pages = {}
    cont = {}
    while True:
        data = call({
            "action": "query",
            "generator": "allpages",
            "gapnamespace": 0,
            "gapfilterredir": "nonredirects",
            "gaplimit": 50,
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            **cont,
        })
        for page in data.get("query", {}).get("pages", []):
            revs = page.get("revisions")
            if revs:
                pages[page["title"]] = revs[0]["slots"]["main"]["content"]
        print(f"{len(pages)} pages", flush=True)
        if "continue" not in data:
            break
        cont = data["continue"]
        time.sleep(0.3)

    # Redirects, so ingredient names that point to a renamed page still resolve.
    redirect_titles = []
    cont = {}
    while True:
        data = call({"action": "query", "list": "allpages", "apnamespace": 0,
                     "apfilterredir": "redirects", "aplimit": 500, **cont})
        redirect_titles += [p["title"] for p in data["query"]["allpages"]]
        if "continue" not in data:
            break
        cont = data["continue"]
    redirects = {}
    for i in range(0, len(redirect_titles), 50):
        data = call({"action": "query", "titles": "|".join(redirect_titles[i:i + 50]), "redirects": 1})
        for r in data["query"].get("redirects", []):
            redirects[r["from"]] = r["to"]
        time.sleep(0.2)

    # Recipes stored as data for the {{Recipe}} template.
    data = call({"action": "parse", "page": "Template:Recipe/data", "prop": "wikitext"})
    recipe_data = data["parse"]["wikitext"]

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"pages": pages, "redirects": redirects, "recipe_data": recipe_data}, ensure_ascii=False), encoding="utf-8")
    print(f"saved {len(pages)} pages, {len(redirects)} redirects -> {OUT}")


if __name__ == "__main__":
    main()
