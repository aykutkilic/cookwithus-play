// Every ingredient and vessel a recipe can use. Shared by the host (to
// validate recipes) and the client (art.js draws them from `art`).
//
// art.type picks the drawing routine, c1/c2/c3 are its colours:
//   round   – tomato, onion, potato, lemon …   c1 skin, c2 flesh, c3 detail (seeds / rings / stem)
//   long    – carrot, cucumber, eggplant …     c1 skin, c2 flesh, c3 top / stem
//   bulb    – garlic                           c1 skin, c2 clove, c3 root
//   egg     – egg                              c1 shell, c2 white, c3 yolk
//   herb    – parsley, basil, mint …           c1 leaf, c2 dark leaf, c3 stem
//   leaf    – cabbage leaf                     c1 leaf, c2 vein
//   head    – cabbage                          c1 outer, c2 inner, c3 vein
//   mushroom                                   c1 cap, c2 flesh, c3 gills
//   pile    – rice, lentils, chickpeas …       c1 grain, c2 shade, c3 highlight (art.grain: 'rice'|'lentil'|'bean'|'pea'|'raisin'|'seed')
//   block   – butter, cheese, meat, bread …    c1 outside, c2 inside/cut, c3 detail (art.shape: 'brick'|'wedge'|'ball'|'loaf'|'chunk'|'mince'|'drumstick'|'fillet'|'strips'|'sausage'|'log'|'shrimp'|'shell'|'finger')
//   bottle  – oil, wine, vinegar               c1 liquid, c2 glass/label, c3 cap
//   carton  – milk, broth, cream               c1 box, c2 liquid, c3 label
//   jar     – yogurt, tomato paste, ghee …     c1 content, c2 glass/label, c3 lid
//   jug     – water                            c1 liquid
//   can     – passata, beans                   c1 content, c2 label, c3 metal
//   shaker  – salt, pepper, spices             c1 powder, c2 jar, c3 lid (art.coarse: flakes)
//   sack    – flour, sugar                     c1 powder, c2 paper, c3 print
//   bundle  – spaghetti                        c1 pasta, c2 band
//   dough   – pizza / bread dough              c1 dough, c2 flour dust
//   tea     – loose leaves / grounds in a tin  c1 leaves, c2 tin, c3 lid
//
// `liquid: true` kinds are poured (from their container); `powder: true`
// kinds are sprinkled or spooned; everything else is handled as a solid.

export const INGREDIENTS = {
  // ---------------------------------------------------------------- produce
  egg:        { name: 'Egg', plural: 'Eggs', emoji: '🥚', art: { type: 'egg', c1: '#f4e4c8', c2: '#fffaf0', c3: '#ffb627' } },
  tomato:     { name: 'Tomato', plural: 'Tomatoes', emoji: '🍅', art: { type: 'round', c1: '#e8432e', c2: '#f26b4f', c3: '#ffd166', sx: 1.05, sy: 0.92, stem: '#3f8f3a' } },
  onion:      { name: 'Onion', plural: 'Onions', emoji: '🧅', art: { type: 'round', c1: '#c98a3c', c2: '#f6ecd6', c3: '#e8d6b0', sx: 1, sy: 1, tip: true } },
  redOnion:   { name: 'Red onion', plural: 'Red onions', emoji: '🧅', art: { type: 'round', c1: '#8a2e57', c2: '#f3dbe6', c3: '#c77a9c', sx: 1, sy: 1, tip: true } },
  potato:     { name: 'Potato', plural: 'Potatoes', emoji: '🥔', art: { type: 'round', c1: '#c49a5c', c2: '#f3e3a8', c3: '#9a7340', sx: 1.25, sy: 0.85, spots: true } },
  lemon:      { name: 'Lemon', plural: 'Lemons', emoji: '🍋', art: { type: 'round', c1: '#f7d330', c2: '#fbeea0', c3: '#fff7cf', sx: 1.2, sy: 0.9, tip: true, segments: true } },
  garlic:     { name: 'Garlic', plural: 'Garlic', emoji: '🧄', art: { type: 'bulb', c1: '#f1ead9', c2: '#fbf6e4', c3: '#b8a77e' } },
  carrot:     { name: 'Carrot', plural: 'Carrots', emoji: '🥕', art: { type: 'long', c1: '#f08a24', c2: '#f6a84a', c3: '#4f9a3a', len: 1.5, taper: 0.85, rings: true } },
  cucumber:   { name: 'Cucumber', plural: 'Cucumbers', emoji: '🥒', art: { type: 'long', c1: '#3f8a3a', c2: '#d8efb8', c3: '#2c6a2a', len: 1.6, taper: 0.1, seeds: true } },
  zucchini:   { name: 'Zucchini', plural: 'Zucchini', emoji: '🥒', art: { type: 'long', c1: '#4f9a3f', c2: '#eef3c8', c3: '#3b6b2a', len: 1.5, taper: 0.15, seeds: true, stripes: true } },
  eggplant:   { name: 'Eggplant', plural: 'Eggplants', emoji: '🍆', art: { type: 'long', c1: '#5b2a6e', c2: '#f2ecd0', c3: '#4f8a3a', len: 1.45, taper: -0.45, seeds: true } },
  greenPepper:{ name: 'Green pepper', plural: 'Green peppers', emoji: '🫑', art: { type: 'long', c1: '#5cad3c', c2: '#d9f0b8', c3: '#2f6a28', len: 1.4, taper: 0.8, hollow: true, curve: 0.25 } },
  redPepper:  { name: 'Red bell pepper', plural: 'Red bell peppers', emoji: '🫑', art: { type: 'round', c1: '#d93a2b', c2: '#f7b39e', c3: '#2f6a28', sx: 1, sy: 1.05, lobes: true, hollow: true, stem: '#2f6a28' } },
  chili:      { name: 'Chili', plural: 'Chilies', emoji: '🌶️', art: { type: 'long', c1: '#d8261c', c2: '#f7c6a8', c3: '#2f6a28', len: 0.9, taper: 0.9, curve: 0.4, thin: true } },
  ginger:     { name: 'Ginger', plural: 'Ginger', emoji: '🫚', art: { type: 'long', c1: '#d7b077', c2: '#f5e3a8', c3: '#b8915a', len: 0.9, knobby: true } },
  mushroom:   { name: 'Mushroom', plural: 'Mushrooms', emoji: '🍄', art: { type: 'mushroom', c1: '#e9dcc8', c2: '#faf4ea', c3: '#a68a6a' } },
  cabbage:    { name: 'Cabbage', plural: 'Cabbages', emoji: '🥬', art: { type: 'head', c1: '#9cc96b', c2: '#e3f1c4', c3: '#c7e3a0' } },
  cabbageLeaf:{ name: 'Cabbage leaves', plural: 'Cabbage leaves', emoji: '🥬', art: { type: 'leaf', c1: '#b9dc8a', c2: '#e8f5d0' } },
  greenBeans: { name: 'Green beans', plural: 'Green beans', emoji: '🫛', art: { type: 'long', c1: '#5aa83c', c2: '#bfe39a', c3: '#3f7a2a', len: 1.2, thin: true, bunch: 5 } },
  parsley:    { name: 'Parsley', plural: 'Parsley', emoji: '🌿', art: { type: 'herb', c1: '#4fa83a', c2: '#2f7a2a', c3: '#7cc25a', leaf: 'curly' } },
  basil:      { name: 'Basil', plural: 'Basil', emoji: '🌿', art: { type: 'herb', c1: '#3c9a3a', c2: '#26702a', c3: '#6cbf55', leaf: 'oval' } },
  mint:       { name: 'Mint', plural: 'Mint', emoji: '🌿', art: { type: 'herb', c1: '#5cbf6a', c2: '#2f8a4a', c3: '#8edb94', leaf: 'serrated' } },
  chives:     { name: 'Chives', plural: 'Chives', emoji: '🌿', art: { type: 'herb', c1: '#4f9f3a', c2: '#2f7a2a', c3: '#b98ad8', leaf: 'grass' } },
  thyme:      { name: 'Thyme', plural: 'Thyme', emoji: '🌿', art: { type: 'herb', c1: '#6f9a5a', c2: '#4a6f3a', c3: '#8a6a4a', leaf: 'tiny' } },
  rosemary:   { name: 'Rosemary', plural: 'Rosemary', emoji: '🌿', art: { type: 'herb', c1: '#5f8a5a', c2: '#3f5f3a', c3: '#7a5a3a', leaf: 'needle' } },

  // ---------------------------------------------------------------- grains, pulses, pasta, bread
  rice:       { name: 'Rice', plural: 'Rice', emoji: '🍚', powder: true, art: { type: 'pile', grain: 'rice', c1: '#fbf7ec', c2: '#e3dccb', c3: '#ffffff' } },
  redLentils: { name: 'Red lentils', plural: 'Red lentils', emoji: '🫘', powder: true, art: { type: 'pile', grain: 'lentil', c1: '#ef8a4a', c2: '#c96a32', c3: '#f9b07c' } },
  yellowDal:  { name: 'Yellow lentils', plural: 'Yellow lentils', emoji: '🫘', powder: true, art: { type: 'pile', grain: 'lentil', c1: '#f2c84b', c2: '#cfa232', c3: '#fbe08a' } },
  chickpeas:  { name: 'Chickpeas', plural: 'Chickpeas', emoji: '🫘', art: { type: 'pile', grain: 'bean', c1: '#e8c88a', c2: '#c9a466', c3: '#f6e2b4' } },
  butterBeans:{ name: 'Butter beans', plural: 'Butter beans', emoji: '🫘', art: { type: 'pile', grain: 'bean', c1: '#efe6c8', c2: '#cfc29a', c3: '#ffffff', big: true } },
  bakedBeans: { name: 'Baked beans', plural: 'Baked beans', emoji: '🥫', art: { type: 'can', c1: '#e0742e', c2: '#3a7ac0', c3: '#c9ccd2' } },
  peas:       { name: 'Peas', plural: 'Peas', emoji: '🫛', art: { type: 'pile', grain: 'pea', c1: '#6cc04a', c2: '#3f8f2f', c3: '#a6e27a' } },
  raisins:    { name: 'Raisins', plural: 'Raisins', emoji: '🍇', art: { type: 'pile', grain: 'raisin', c1: '#6a3a4a', c2: '#43222e', c3: '#9a5a6a' } },
  spaghetti:  { name: 'Spaghetti', plural: 'Spaghetti', emoji: '🍝', art: { type: 'bundle', c1: '#f3d48a', c2: '#3a6ab0' } },
  arborio:    { name: 'Risotto rice', plural: 'Risotto rice', emoji: '🍚', powder: true, art: { type: 'pile', grain: 'rice', c1: '#f6f0dc', c2: '#ddd2b4', c3: '#ffffff', big: true } },
  flour:      { name: 'Flour', plural: 'Flour', emoji: '🌾', powder: true, art: { type: 'sack', c1: '#fbf8f0', c2: '#e9dcc0', c3: '#c0412d' } },
  bread:      { name: 'Bread', plural: 'Bread', emoji: '🥖', art: { type: 'block', shape: 'loaf', c1: '#d08a3c', c2: '#f6e2b0', c3: '#a8662a' } },
  ladyfingers:{ name: 'Ladyfingers', plural: 'Ladyfingers', emoji: '🍪', art: { type: 'block', shape: 'finger', c1: '#e8b86a', c2: '#f8e6b8', c3: '#ffffff' } },
  dough:      { name: 'Dough', plural: 'Dough', emoji: '🫓', art: { type: 'dough', c1: '#f6e7c4', c2: '#ffffff' } },

  // ---------------------------------------------------------------- dairy
  butter:     { name: 'Butter', plural: 'Butter', emoji: '🧈', art: { type: 'block', shape: 'brick', c1: '#fbe38a', c2: '#fff1b8', c3: '#e8c85a' } },
  ghee:       { name: 'Ghee', plural: 'Ghee', emoji: '🫙', art: { type: 'jar', c1: '#f4cf5a', c2: '#e9f2f4', c3: '#c58a2a' } },
  milk:       { name: 'Milk', plural: 'Milk', emoji: '🥛', liquid: true, art: { type: 'carton', c1: '#eaf2fb', c2: '#ffffff', c3: '#3a7ac0' } },
  cream:      { name: 'Cream', plural: 'Cream', emoji: '🥛', liquid: true, art: { type: 'carton', c1: '#fbf3e0', c2: '#fffaf0', c3: '#d9a03a' } },
  yogurt:     { name: 'Yogurt', plural: 'Yogurt', emoji: '🥣', art: { type: 'jar', c1: '#fbfaf4', c2: '#dfeef4', c3: '#4a9ad0' } },
  mozzarella: { name: 'Mozzarella', plural: 'Mozzarella', emoji: '🧀', art: { type: 'block', shape: 'ball', c1: '#fbfaf2', c2: '#ffffff', c3: '#e9e4d0' } },
  parmesan:   { name: 'Parmesan', plural: 'Parmesan', emoji: '🧀', art: { type: 'block', shape: 'wedge', c1: '#f2d48a', c2: '#f8e6b0', c3: '#c99a3a' } },
  gorgonzola: { name: 'Gorgonzola', plural: 'Gorgonzola', emoji: '🧀', art: { type: 'block', shape: 'wedge', c1: '#f4efdc', c2: '#fbf8ec', c3: '#5a7a9a' } },
  gruyere:    { name: 'Gruyère', plural: 'Gruyère', emoji: '🧀', art: { type: 'block', shape: 'wedge', c1: '#f0c860', c2: '#f8de90', c3: '#d8a83a', holes: true } },
  mascarpone: { name: 'Mascarpone', plural: 'Mascarpone', emoji: '🫙', art: { type: 'jar', c1: '#fffaf0', c2: '#e9f2f4', c3: '#c0412d' } },
  paneer:     { name: 'Paneer', plural: 'Paneer', emoji: '🧀', art: { type: 'block', shape: 'brick', c1: '#fbf6e4', c2: '#ffffff', c3: '#e8dcbc' } },

  // ---------------------------------------------------------------- meat & fish
  chicken:    { name: 'Chicken', plural: 'Chicken', emoji: '🍗', art: { type: 'block', shape: 'drumstick', c1: '#f4c4a8', c2: '#f9dcc8', c3: '#fbf3e8' } },
  meat:       { name: 'Lamb', plural: 'Lamb', emoji: '🥩', art: { type: 'block', shape: 'chunk', c1: '#c0453e', c2: '#d9655a', c3: '#f6e4dc' } },
  mince:      { name: 'Minced meat', plural: 'Minced meat', emoji: '🥩', art: { type: 'block', shape: 'mince', c1: '#c85a50', c2: '#e07a6c', c3: '#f6d6cc' } },
  bacon:      { name: 'Bacon', plural: 'Bacon', emoji: '🥓', art: { type: 'block', shape: 'strips', c1: '#d0564a', c2: '#f6d6c8', c3: '#b8403a' } },
  sausage:    { name: 'Sausages', plural: 'Sausages', emoji: '🌭', art: { type: 'block', shape: 'sausage', c1: '#c87a5a', c2: '#e8b09a', c3: '#a85a3a' } },
  salami:     { name: 'Salami', plural: 'Salami', emoji: '🍕', art: { type: 'block', shape: 'log', c1: '#a8323a', c2: '#d9606a', c3: '#f6e4dc' } },
  fish:       { name: 'Fish fillet', plural: 'Fish fillets', emoji: '🐟', art: { type: 'block', shape: 'fillet', c1: '#f6ece6', c2: '#fbf6f2', c3: '#e8d0c8' } },
  shrimp:     { name: 'Prawns', plural: 'Prawns', emoji: '🦐', art: { type: 'block', shape: 'shrimp', c1: '#f4a07a', c2: '#fbd6c0', c3: '#e0603a' } },
  mussels:    { name: 'Mussels', plural: 'Mussels', emoji: '🦪', art: { type: 'block', shape: 'shell', c1: '#2e2f4a', c2: '#f4a65a', c3: '#5a5f8a' } },

  // ---------------------------------------------------------------- liquids
  water:      { name: 'Water', plural: 'Water', emoji: '💧', liquid: true, art: { type: 'jug', c1: '#9fd6f2' } },
  oliveOil:   { name: 'Olive oil', plural: 'Olive oil', emoji: '🫒', liquid: true, art: { type: 'bottle', c1: '#c9c83a', c2: '#e6f0d8', c3: '#3a5a2a' } },
  oil:        { name: 'Sunflower oil', plural: 'Oil', emoji: '🌻', liquid: true, art: { type: 'bottle', c1: '#f6d84a', c2: '#fbf6dc', c3: '#e0a020' } },
  broth:      { name: 'Broth', plural: 'Broth', emoji: '🍲', liquid: true, art: { type: 'carton', c1: '#e8c070', c2: '#d9a84a', c3: '#8a5a2a' } },
  redWine:    { name: 'Red wine', plural: 'Red wine', emoji: '🍷', liquid: true, art: { type: 'bottle', c1: '#7a1a2e', c2: '#2a3a2a', c3: '#a8323a', wine: true } },
  whiteWine:  { name: 'White wine', plural: 'White wine', emoji: '🥂', liquid: true, art: { type: 'bottle', c1: '#f2e6a0', c2: '#cfe0c0', c3: '#d9b23a', wine: true } },
  vinegar:    { name: 'Vinegar', plural: 'Vinegar', emoji: '🫙', liquid: true, art: { type: 'bottle', c1: '#c06a3a', c2: '#f0e6dc', c3: '#5a3a2a' } },
  passata:    { name: 'Tomato sauce', plural: 'Tomato sauce', emoji: '🥫', liquid: true, art: { type: 'can', c1: '#c8321e', c2: '#3a9a4a', c3: '#c9ccd2' } },
  tomatoPaste:{ name: 'Tomato paste', plural: 'Tomato paste', emoji: '🥫', art: { type: 'jar', c1: '#b8281a', c2: '#f0e6dc', c3: '#d8261c' } },
  coffee:     { name: 'Coffee', plural: 'Coffee', emoji: '☕', powder: true, art: { type: 'tea', c1: '#4a2a1a', c2: '#c0412d', c3: '#e8c070' } },
  espresso:   { name: 'Espresso', plural: 'Espresso', emoji: '☕', liquid: true, art: { type: 'jug', c1: '#3a1e12' } },
  tea:        { name: 'Black tea', plural: 'Black tea', emoji: '🍵', powder: true, art: { type: 'tea', c1: '#3a2418', c2: '#2a6a5a', c3: '#e8c070' } },

  // ---------------------------------------------------------------- seasonings
  salt:       { name: 'Salt', plural: 'Salt', emoji: '🧂', powder: true, art: { type: 'shaker', c1: '#ffffff', c2: '#e6eef2', c3: '#c9ccd2' } },
  pepper:     { name: 'Black pepper', plural: 'Black pepper', emoji: '🧂', powder: true, art: { type: 'shaker', c1: '#3a3330', c2: '#e6eef2', c3: '#3a3330' } },
  pulBiber:   { name: 'Pepper flakes', plural: 'Pepper flakes', emoji: '🌶️', powder: true, art: { type: 'shaker', c1: '#b8281a', c2: '#e6eef2', c3: '#d8261c', coarse: true } },
  paprika:    { name: 'Paprika', plural: 'Paprika', emoji: '🌶️', powder: true, art: { type: 'shaker', c1: '#d0401e', c2: '#e6eef2', c3: '#d0401e' } },
  cumin:      { name: 'Cumin', plural: 'Cumin', emoji: '🟤', powder: true, art: { type: 'shaker', c1: '#9a6a32', c2: '#e6eef2', c3: '#6a4a22', coarse: true } },
  turmeric:   { name: 'Turmeric', plural: 'Turmeric', emoji: '🟡', powder: true, art: { type: 'shaker', c1: '#f2b21a', c2: '#e6eef2', c3: '#d08a10' } },
  garamMasala:{ name: 'Garam masala', plural: 'Garam masala', emoji: '🟤', powder: true, art: { type: 'shaker', c1: '#8a4a22', c2: '#e6eef2', c3: '#c0412d' } },
  cardamom:   { name: 'Cardamom', plural: 'Cardamom', emoji: '🟢', powder: true, art: { type: 'pile', grain: 'seed', c1: '#9ab86a', c2: '#6a8a42', c3: '#c0d89a' } },
  cinnamon:   { name: 'Cinnamon', plural: 'Cinnamon', emoji: '🟤', powder: true, art: { type: 'shaker', c1: '#a85a2a', c2: '#e6eef2', c3: '#7a3a1a' } },
  saffron:    { name: 'Saffron', plural: 'Saffron', emoji: '🌼', powder: true, art: { type: 'shaker', c1: '#d8401a', c2: '#e6eef2', c3: '#f2b21a', coarse: true } },
  oregano:    { name: 'Oregano', plural: 'Oregano', emoji: '🌿', powder: true, art: { type: 'shaker', c1: '#6a8a3a', c2: '#e6eef2', c3: '#3a5a2a', coarse: true } },
  driedMint:  { name: 'Dried mint', plural: 'Dried mint', emoji: '🌿', powder: true, art: { type: 'shaker', c1: '#7aa05a', c2: '#e6eef2', c3: '#4a7a3a', coarse: true } },
  sugar:      { name: 'Sugar', plural: 'Sugar', emoji: '🍬', powder: true, art: { type: 'sack', c1: '#ffffff', c2: '#e8f0f6', c3: '#3a7ac0' } },
  yeast:      { name: 'Yeast', plural: 'Yeast', emoji: '🫙', powder: true, art: { type: 'shaker', c1: '#d8c08a', c2: '#e6eef2', c3: '#c0412d', coarse: true } },
  cocoa:      { name: 'Cocoa', plural: 'Cocoa', emoji: '🍫', powder: true, art: { type: 'shaker', c1: '#5a3020', c2: '#e6eef2', c3: '#3a1e12' } },
};

// Vessels: pots, pans and dishes the cooking happens in. art.type is the
// drawing routine; `hob` vessels can sit on a burner, `bake` ones go in an oven.
// Where things live. Staples – salt, pepper, the spices, oil, vinegar, water
// from the tap – stand within reach at every station; everything else is
// fetched: cold things from the fridge, the rest (and every pot, pan, bowl
// and plate) from the pantry shelf.
export const STAPLES = new Set(['water', 'salt', 'pepper', 'pulBiber', 'paprika', 'cumin', 'turmeric', 'garamMasala',
  'cardamom', 'cinnamon', 'saffron', 'oregano', 'driedMint', 'oil', 'oliveOil', 'vinegar']);
const COLD = new Set(['egg', 'butter', 'ghee', 'milk', 'cream', 'yogurt', 'mozzarella', 'parmesan', 'gorgonzola', 'gruyere',
  'mascarpone', 'paneer', 'chicken', 'meat', 'mince', 'bacon', 'sausage', 'salami', 'fish', 'shrimp', 'mussels', 'dough',
  'parsley', 'basil', 'mint', 'chives', 'thyme', 'rosemary', 'mushroom', 'greenBeans', 'cabbage', 'cabbageLeaf', 'carrot',
  'cucumber', 'zucchini', 'eggplant', 'greenPepper', 'redPepper', 'chili', 'lemon', 'peas']);
export function storeOf(kind) { return STAPLES.has(kind) ? null : COLD.has(kind) ? 'fridge' : 'shelf'; }

// Heavy things take both hands (a pot, a tray, the blender); a saucepan, a
// pan, a bowl, the plates, a kettle you carry in one, leaving the other free
// (to shut the fridge door behind you, say).
const TWO_HANDED = new Set(['pot', 'bigPot', 'copperPot', 'cocotte', 'paellaPan', 'tray', 'bakingDish', 'peel', 'blender', 'skewer']);
export function twoHanded(kind) { return TWO_HANDED.has(kind); }

export const VESSELS = {
  pot:        { name: 'Pot', emoji: '🍲', hob: true, art: { type: 'pot', c1: '#c9ccd2', c2: '#8a8f99' } },
  bigPot:     { name: 'Big pot', emoji: '🍲', hob: true, art: { type: 'pot', c1: '#c9ccd2', c2: '#8a8f99', big: true } },
  copperPot:  { name: 'Copper pot', emoji: '🍲', hob: true, art: { type: 'pot', c1: '#d9844a', c2: '#a8582a' } },
  cocotte:    { name: 'Cocotte', emoji: '🍲', hob: true, bake: true, art: { type: 'pot', c1: '#c0412d', c2: '#8a2a1a', big: true } },
  saucepan:   { name: 'Saucepan', emoji: '🥘', hob: true, art: { type: 'saucepan', c1: '#c9ccd2', c2: '#8a8f99' } },
  pan:        { name: 'Frying pan', emoji: '🍳', hob: true, art: { type: 'pan', c1: '#3a3a42', c2: '#22222a' } },
  paellaPan:  { name: 'Paella pan', emoji: '🥘', hob: true, art: { type: 'pan', c1: '#4a4a52', c2: '#2a2a32', wide: true, handles: 2 } },
  bowl:       { name: 'Mixing bowl', emoji: '🥣', art: { type: 'bowl', c1: '#f2efe6', c2: '#5aa0c8' } },
  tray:       { name: 'Baking tray', emoji: '🍽️', bake: true, art: { type: 'tray', c1: '#9aa0aa', c2: '#6a707a' } },
  bakingDish: { name: 'Baking dish', emoji: '🍽️', bake: true, art: { type: 'dish', c1: '#f2efe6', c2: '#d8603a' } },
  peel:       { name: 'Pizza peel', emoji: '🍕', bake: true, art: { type: 'peel', c1: '#d8a868', c2: '#a8783a' } },
  caydanlik:  { name: 'Çaydanlık', emoji: '🫖', hob: true, art: { type: 'caydanlik', c1: '#d9dde4', c2: '#e8b84a' } },
  cezve:      { name: 'Cezve', emoji: '☕', hob: true, art: { type: 'cezve', c1: '#d9844a', c2: '#6a3a1a' } },
  kettle:     { name: 'Kettle', emoji: '🫖', hob: true, art: { type: 'kettle', c1: '#e8e2d4', c2: '#3a7ac0' } },
  colander:   { name: 'Colander', emoji: '🥣', art: { type: 'colander', c1: '#e0e4ea', c2: '#9aa0aa' } },
  blender:    { name: 'Blender', emoji: '🥤', art: { type: 'blender', c1: '#dbe8ef', c2: '#3a3a42' } },
  plate:      { name: 'Plates', emoji: '🍽️', art: { type: 'plate', c1: '#ffffff', c2: '#5aa0c8' } },
  glass:      { name: 'Tea glasses', emoji: '🍵', art: { type: 'glass', c1: '#f4f8fa', c2: '#c8a24a' } },
  cup:        { name: 'Cups', emoji: '☕', art: { type: 'cup', c1: '#ffffff', c2: '#c0412d' } },
  skewer:     { name: 'Skewers', emoji: '🍢', bake: true, art: { type: 'skewer', c1: '#c9ccd2', c2: '#8a8f99' } },
};

export const ING_KINDS = Object.keys(INGREDIENTS);
export const VESSEL_KINDS = Object.keys(VESSELS);

// Loose food is kept, carried and put down in a food container; what comes in
// its own pack (a bottle, a carton, a can, a jar, a sack, a shaker …) and dough don't.
export const PACKED = new Set(['bottle', 'carton', 'can', 'jar', 'sack', 'shaker', 'tea', 'jug', 'dough']);
export function boxable(kind) { const i = INGREDIENTS[kind]; return !!i && !PACKED.has(i.art.type); }

export function ingName(kind, n = 1) {
  const i = INGREDIENTS[kind];
  if (!i) return kind;
  return n > 1 ? i.plural : i.name;
}
