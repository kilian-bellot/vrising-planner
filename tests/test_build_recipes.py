import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_recipes as br  # noqa: E402


def recipe_tuples(found):
    return [(tuple((o["name"], o["qty"]) for o in r["outputs"]),
             tuple((i["name"], i["qty"]) for i in r["inputs"]),
             tuple(r["stations"])) for r in found]


class ItemFrameTests(unittest.TestCase):
    def test_name_quantity_and_type(self):
        frames = br.item_frames("{{ItemFrame|Iron Ore|20}}<br>{{ItemFrame|Anvil|type=Structure}}")
        self.assertEqual([(f["name"], f["qty"], f["type"]) for f in frames],
                         [("Iron Ore", 20, ""), ("Anvil", 1, "Structure")])

    def test_keyword_args_are_not_quantities(self):
        frames = br.item_frames("{{ItemFrame|Silver Coin|20|discountable=N}}")
        self.assertEqual((frames[0]["name"], frames[0]["qty"]), ("Silver Coin", 20))

    def test_pagename_and_replace(self):
        text = br.expand_magic("{{ItemFrame|Rare Ancestral {{#replace:{{PAGENAME}}|Sanguine |}}}}", "Sanguine Greatsword")
        self.assertEqual(br.item_frames(text)[0]["name"], "Rare Ancestral Greatsword")


TABLE = """==Recipes==
{| class="fandom-table"
!Resulting Item
!Recipe
!Structure
|-
|{{ItemFrame|Dark Silver Sword|type=Weapon}}
| rowspan="2" |{{ItemFrame|Dark Silver Ingot|12}}<br>{{ItemFrame|Reinforced Plank|8}}
| rowspan="3" |{{ItemFrame|Anvil|type=Structure}}
|-
|{{ItemFrame|Dark Silver Axes|type=Weapon}}
|-
|{{ItemFrame|Golden Castle Key}}
|{{ItemFrame|Primal Blood Essence|12}}
|}
"""


class TableTests(unittest.TestCase):
    def test_rowspans_are_expanded(self):
        self.assertEqual(recipe_tuples(br.table_recipes("Dark Silver Ingot", TABLE, False)), [
            ((("Dark Silver Sword", 1),), (("Dark Silver Ingot", 12), ("Reinforced Plank", 8)), ("Anvil",)),
            ((("Dark Silver Axes", 1),), (("Dark Silver Ingot", 12), ("Reinforced Plank", 8)), ("Anvil",)),
            ((("Golden Castle Key", 1),), (("Primal Blood Essence", 12),), ("Anvil",)),
        ])

    def test_station_page_without_structure_column(self):
        text = """{| class="sortable fandom-table"
! Item !! Materials !! Crafting Time !! Unlocked By
|-
|{{ItemFrame|Iron Ingot}}
|{{ItemFrame|Iron Ore|20}}
|2m (34.5s)
|[[Quincey the Bandit King]]
|}"""
        found = br.table_recipes("Furnace", text, True)
        self.assertEqual(recipe_tuples(found), [((("Iron Ingot", 1),), (("Iron Ore", 20),), ("Furnace",))])
        self.assertEqual((found[0]["time"], found[0]["unlock"]), ("2m (34.5s)", "Quincey the Bandit King"))

    def test_table_on_normal_page_needs_structure_column(self):
        text = "{|\n!Item!!Materials\n|-\n|{{ItemFrame|A}}\n|{{ItemFrame|B|2}}\n|}"
        self.assertEqual(br.table_recipes("Some Page", text, False), [])

    def test_slash_separated_outputs_are_alternatives(self):
        text = """{|
!Item!!Materials!!Structure
|-
|{{ItemFrame|Traveller's Wrap|type=Cloak}} /<br>{{ItemFrame|Immortal King's Drape|type=Cloak}}
|{{ItemFrame|Cloth|4}}<br>{{ItemFrame|Leather|4}}
|{{ItemFrame|By Hand|type=Structure}}
|}"""
        outs = [r[0] for r in recipe_tuples(br.table_recipes("Leather", text, False))]
        self.assertEqual(outs, [(("Traveller's Wrap", 1),), (("Immortal King's Drape", 1),)])

    def test_or_separated_materials_are_alternatives(self):
        text = """{|
!Item!!Materials!!Structure
|-
|{{ItemFrame|Pollen|10|discountable=N}}
| {{ItemFrame|Blood Rose|20}} or<br>{{ItemFrame|Fire Blossom|20}}
|{{ItemFrame|Grinder|type=Structure}}
|}"""
        ins = [r[1] for r in recipe_tuples(br.table_recipes("Pollen", text, False))]
        self.assertEqual(ins, [(("Blood Rose", 20),), (("Fire Blossom", 20),)])

    def test_multi_output_row(self):
        text = """{|
!Item!!Recipe!!Structure
|-
|{{ItemFrame|Iron Ingot|4|discountable=N}}<br>{{ItemFrame|Scourgestone|1}}
|{{ItemFrame|Rare Ancestral Greatsword Shard}}
|{{ItemFrame|The Devourer|type=Structure}}
|}"""
        self.assertEqual(recipe_tuples(br.table_recipes("Iron Ingot", text, False))[0][0],
                         (("Iron Ingot", 4), ("Scourgestone", 1)))


class TemplateRecipeTests(unittest.TestCase):
    def test_recipe_template_reads_data(self):
        data = ",Recipe_Holy Resistance Potion,60,Sunflower,1,Grave Dust,,,,,,Recipe_Other,1,X,,,"
        found = br.template_recipes("Holy Resistance Potion",
                                    "{{Recipe||Alchemy Table|unlocked_by=[[Mairwyn the Elementalist]]}}", data)
        self.assertEqual(recipe_tuples(found), [((("Holy Resistance Potion", 1),),
                                                 (("Sunflower", 60), ("Grave Dust", 1)), ("Alchemy Table",))])
        self.assertEqual(found[0]["unlock"], "Mairwyn the Elementalist")


class BuildTests(unittest.TestCase):
    def setUp(self):
        br.resolve_icons = lambda candidates: {n: None for n in candidates}

    def page(self, rows):
        return "{|\n!Item!!Materials!!Structure\n" + "".join(
            f"|-\n|{o}\n|{i}\n|{{{{ItemFrame|{s}|type=Structure}}}}\n" for o, i, s in rows) + "|}"

    def test_byproduct_duplicate_is_merged_and_preferred_input_wins(self):
        pages = {
            "Plank": self.page([("{{ItemFrame|Plank|4}}<br>{{ItemFrame|Oil}}", "{{ItemFrame|Hallow Wood|40}}", "Sawmill"),
                                ("{{ItemFrame|Plank}}", "{{ItemFrame|Wood|20}}", "Sawmill")]),
            "Sawdust": self.page([("{{ItemFrame|Plank}}<br>{{ItemFrame|Sawdust}}", "{{ItemFrame|Wood|20}}", "Sawmill")]),
        }
        data = br.build({"pages": pages, "redirects": {}})
        plank = data["items"]["Plank"]["recipes"]
        recipes = {r["id"]: r for r in data["recipes"]}
        self.assertEqual(len(data["recipes"]), 2)
        self.assertEqual([i["item"] for i in recipes[plank[0]]["inputs"]], ["Wood"])
        self.assertEqual(len(recipes[plank[0]]["outputs"]), 2)

    def test_devourer_is_never_default_and_shared_redirects_are_not_merged(self):
        pages = {
            "Iron Ingot": self.page([("{{ItemFrame|Iron Ingot|4}}", "{{ItemFrame|Shard}}", "The Devourer"),
                                     ("{{ItemFrame|Iron Ingot}}", "{{ItemFrame|Iron Ore|20}}", "Furnace")]),
            "Dawnthorn Armour Set": self.page([("{{ItemFrame|Dawnthorn Boots}}", "{{ItemFrame|Iron Ingot}}", "Anvil"),
                                               ("{{ItemFrame|Dawnthorn Gloves}}", "{{ItemFrame|Iron Ingot}}", "Anvil")]),
        }
        redirects = {"Dawnthorn Boots": "Dawnthorn Armour Set", "Dawnthorn Gloves": "Dawnthorn Armour Set"}
        data = br.build({"pages": pages, "redirects": redirects})
        recipes = {r["id"]: r for r in data["recipes"]}
        first = recipes[data["items"]["Iron Ingot"]["recipes"][0]]
        self.assertEqual(first["stations"], ["Furnace"])
        self.assertIn("Dawnthorn Boots", data["items"])
        self.assertIn("Dawnthorn Gloves", data["items"])
        self.assertTrue(data["items"]["Dawnthorn Boots"]["wiki"])


if __name__ == "__main__":
    unittest.main()
