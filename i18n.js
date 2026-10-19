// Page text in English and French. Item and station names come from data (items[n].fr).

export const LANGS = ["en", "fr"];

const STRINGS = {
  en: {
    title: "V Rising Craft Planner",
    tagline: "Add the items of your build, get the whole crafting chain, the resources to farm and the stations to use.",
    addItems: "Add items",
    searchPlaceholder: "Search: dawnthorn, sanguine sword, amulet…",
    searchLabel: "Search items",
    noMatch: "No craftable item matches.",
    addAll: (n) => `Add all ${n} matches`,
    build: "Build",
    clear: "Clear",
    buildEmpty: "Nothing yet. Search an item and add it — a whole armour set works too.",
    share: "Copy link to this build",
    linkCopied: "Link copied",
    copyAddress: "Copy the address bar to share this build",
    quantityOf: (n) => `Quantity of ${n}`,
    remove: "Remove",
    removeItem: (n) => `Remove ${n}`,
    perCraft: (n) => `${n} per craft`,
    toFarm: "To farm",
    alsoGet: "You will also get",
    tree: "Crafting tree",
    treeHelp: "Per item. Pick another recipe, “farm it” to stop the chain there, or “I have it” to drop it with everything below — choices apply everywhere.",
    stations: "Stations",
    station: "Station",
    unlockedBy: "Unlocked by",
    usedFor: "Used for",
    or: "or",
    default: "Default",
    at: (crafts, station) => `${crafts}× at ${station}`,
    makes: (n) => `makes ${n}`,
    oneCraftMakes: (n) => `One craft makes ${n}`,
    farm: "farm",
    farmLoop: "farm (loop)",
    farmInstead: "farm instead",
    craftInstead: "craft instead",
    farmIt: "Farm it (don't craft)",
    haveIt: "I have it",
    needIt: "I need it",
    haveBadge: "have it",
    alreadyHave: "Already have (not counted)",
    recipeFor: (n) => `Recipe for ${n}`,
    footer: (date) => `Data from the V Rising Wiki on Fandom, licensed CC BY-SA — snapshot of ${date}. Wiki pages sometimes disagree; check the linked page when a number looks off. Not affiliated with Stunlock Studios.`,
    loadError: "Could not load data/recipes.json — open the page through a web server (see README). ",
  },
  fr: {
    title: "Planificateur d'artisanat V Rising",
    tagline: "Ajoutez les objets de votre build : toute la chaîne de fabrication, les ressources à farmer et les stations à utiliser.",
    addItems: "Ajouter des objets",
    searchPlaceholder: "Rechercher : aubépine, épée sanguine, amulette…",
    searchLabel: "Rechercher des objets",
    noMatch: "Aucun objet fabricable ne correspond.",
    addAll: (n) => `Tout ajouter (${n})`,
    build: "Build",
    clear: "Vider",
    buildEmpty: "Rien pour l'instant. Recherchez un objet et ajoutez-le — un set d'armure entier aussi.",
    share: "Copier le lien de ce build",
    linkCopied: "Lien copié",
    copyAddress: "Copiez la barre d'adresse pour partager ce build",
    quantityOf: (n) => `Quantité de ${n}`,
    remove: "Retirer",
    removeItem: (n) => `Retirer ${n}`,
    perCraft: (n) => `${n} par fabrication`,
    toFarm: "À farmer",
    alsoGet: "Vous obtiendrez aussi",
    tree: "Arbre de fabrication",
    treeHelp: "Par objet. Choisissez une autre recette, « farmer » pour arrêter la chaîne, ou « je l'ai » pour l'enlever avec tout ce qu'il y a dessous — les choix s'appliquent partout.",
    stations: "Stations",
    station: "Station",
    unlockedBy: "Débloquée par",
    usedFor: "Utilisée pour",
    or: "ou",
    default: "Par défaut",
    at: (crafts, station) => `${crafts}× — ${station}`,
    makes: (n) => `produit ${n}`,
    oneCraftMakes: (n) => `Une fabrication produit ${n}`,
    farm: "à farmer",
    farmLoop: "à farmer (boucle)",
    farmInstead: "farmer plutôt",
    craftInstead: "fabriquer plutôt",
    farmIt: "Farmer (ne pas fabriquer)",
    haveIt: "je l'ai",
    needIt: "il me le faut",
    haveBadge: "possédé",
    alreadyHave: "Déjà possédé (non compté)",
    recipeFor: (n) => `Recette pour ${n}`,
    footer: (date) => `Données du wiki V Rising sur Fandom, licence CC BY-SA — instantané du ${date}. Noms français tirés du jeu. Les pages du wiki se contredisent parfois ; vérifiez la page liée si un nombre semble faux. Non affilié à Stunlock Studios.`,
    loadError: "Impossible de charger data/recipes.json — ouvrez la page via un serveur web (voir README). ",
  },
};

const TYPES_FR = {
  Weapon: "Arme", Armour: "Armure", Equipment: "Équipement", Consumable: "Consommable", Material: "Matériau",
  Jewelry: "Bijou", Jewel: "Joyau", Gem: "Gemme", Tailoring: "Couture", Alchemy: "Alchimie", Cloak: "Cape",
  Flower: "Fleur", Fish: "Poisson", Bag: "Sac", Saddle: "Selle", Head: "Tête", Coin: "Pièce", Herb: "Herbe",
  Knowledge: "Savoir", Recipebook: "Livre de recettes", "Blood essence": "Essence de sang",
  "Blood potion": "Potion de sang", Stackable: "Empilable", Item: "Objet",
};

export function translator(lang) {
  const table = STRINGS[lang] ?? STRINGS.en;
  const t = (key, ...args) => {
    const v = table[key] ?? STRINGS.en[key];
    return typeof v === "function" ? v(...args) : v;
  };
  t.type = (type) => (lang === "fr" ? TYPES_FR[type] ?? type : type);
  t.number = (n) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
  return t;
}
