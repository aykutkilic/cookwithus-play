// What a kitchen has in it besides what the dish needs – as a real one would:
// food in the fridge and the pantry, pots and pans in the cupboards under the
// counters, plates, bowls, cups and glasses in the wall cupboards, cutlery
// and utensils in the drawers and the crock, each board's own knife, peeler
// and grater, oil and vinegar at a counter's corner. All of it can be taken,
// carried and put away; none of it is needed (the dish's own things are kept
// as they were: what it needs of a kind is already there, so that kind isn't
// stocked twice).
//
// Spare things are marked `spare: 1`. A thing put away in a place with
// shelves has a spot there {r: shelf (0 the top one), x: 0 … 1 along it}.
import { INGREDIENTS, VESSELS, storeOf } from './ingredients.js';
import { splitPlace, storeFx, counterDecor } from './kitchens.js';

const FRIDGE = [['egg', 6], ['milk', 1], ['butter', 1], ['yogurt', 1], ['lemon', 2], ['carrot', 3], ['cucumber', 2], ['tomato', 4], ['greenPepper', 3], ['parsley', 1], ['mushroom', 5]];
const PANTRY = [['onion', 4], ['potato', 4], ['garlic', 2], ['rice', 1], ['spaghetti', 1], ['flour', 1], ['sugar', 1], ['redLentils', 1], ['chickpeas', 1], ['passata', 1], ['bread', 1]];
const CHEESE = { turkish: 'paneer', italian: 'parmesan', spanish: 'parmesan', french: 'gruyere', english: 'gruyere', indian: 'paneer' };
const DRINK = { turkish: 'tea', italian: 'coffee', spanish: 'coffee', french: 'coffee', english: 'tea', indian: 'tea' };
// under the counters (pots and pans), over them (what you eat and drink from)
const LOW = ['pot', 'pan', 'saucepan', 'colander', 'bowl', 'bigPot', 'bakingDish', 'kettle'];
const HIGH = ['plate', 'cup', 'glass', 'bowl', 'plate', 'cup', 'glass', 'bowl'];
const LOW_EXTRA = { turkish: ['cezve', 'caydanlik'], spanish: ['paellaPan'], french: ['cocotte'], english: [], italian: [], indian: [] };
// the drawers: cutlery in the first, cooking utensils in the second, a few more in the rest
const CUTLERY = ['fork', 'fork', 'spoon', 'spoon', 'tableKnife', 'tableKnife', 'teaspoon', 'teaspoon'];
const UTENSILS = ['ladle', 'whisk', 'tongs', 'masher', 'rollingPin', 'scissors', 'spatula', 'woodSpoon'];
const CROCK = ['woodSpoon', 'spatula', 'ladle', 'whisk'];

// the places of a kind in a kitchen, in map order: [place id, …]
function places(K, bays) { return Object.keys(K.bays || {}).filter((id) => bays.includes(splitPlace(id)[1])); }

// Fill the kitchen (a new cook state C for kitchen K, the expanded recipe x).
export function stockKitchen(C, K, x) {
  C.tools = C.tools || {};
  const cuisine = K.cuisine || 'turkish';
  const used = new Set([...Object.values(x.ing).map((i) => i.kind), ...Object.values(x.ves).map((v) => v.kind)]);
  let n = 0;
  const id = (kind) => `s${++n}.${kind}`;
  // food: a few of each, where it's kept
  const food = [...FRIDGE, [CHEESE[cuisine], 1], ...PANTRY, [DRINK[cuisine], 1]];
  for (const [kind, qty] of food) {
    if (!INGREDIENTS[kind] || used.has(kind)) continue;
    used.add(kind);
    const at = storeFx(K, storeOf(kind) || 'shelf');
    if (!at) continue;
    C.items[id(kind)] = { kind, qty, washed: 0, peeled: 0, cut: null, k: 0, n: 0, cook: 0, at, in: null, held: null, used: 0, stored: 1, spare: 1 };
  }
  // pots and pans, dishes: into the cupboards, one in each in turn
  const vessel = (kind, home, spot) => { C.vessels[id(kind)] = { kind, water: 0, liquid: null, contents: [], heat: 0, boil: 0, lid: 0, cook: 0, at: null, home, held: null, items: [], spare: 1, spot }; };
  const fill = (list, ids, make) => {
    const free = ids.map((p) => { const B = K.bays[p], q = []; for (let r = B.levels - 1; r >= 0; r--) for (let i = 0; i < B.slots; i++) q.push({ r, x: B.slots > 1 ? i / (B.slots - 1) : 0.5 }); return q; });
    let j = 0;
    for (const kind of list) {
      let tries = 0;
      while (tries < ids.length && !free[j % ids.length].length) { j++; tries++; }
      if (tries >= ids.length) break;
      const p = j % ids.length;
      make(kind, ids[p], free[p].shift());
      j++;
    }
  };
  // (a big kitchen has more cupboards: the same again, till there's something in each)
  const enough = (list, ids) => { const out = []; while (list.length && out.length < Math.max(list.length, ids.length)) out.push(...list); return out.slice(0, Math.max(list.length, ids.length)); };
  const lowIds = places(K, ['c0', 'c1']), highIds = places(K, ['u0', 'u1']);
  fill(enough([...LOW, ...(LOW_EXTRA[cuisine] || [])].filter((k) => VESSELS[k] && !used.has(k)), lowIds), lowIds, vessel);
  fill(enough(HIGH.filter((k) => !used.has(k)), highIds), highIds, vessel);
  // tools
  const tool = (kind, at, spot) => { C.tools[id(kind)] = { kind, at, home: at, held: null, spot }; };
  for (const p of places(K, ['board'])) ['chefKnife', 'peeler', 'grater'].forEach((k, i) => tool(k, p, { r: 0, x: i / 2 }));
  for (const p of places(K, ['crock'])) CROCK.forEach((k, i) => tool(k, p, { r: 0, x: i / 3 }));
  for (const p of places(K, ['corner'])) cornerKind(K, p).forEach((k, i) => tool(k, p, { r: 0, x: i }));
  for (const p of places(K, ['gloves'])) tool('ovenGloves', p, { r: 0, x: 0 });
  // (the stack of empty containers beside each board: the big one at the bottom, the small one on top)
  for (const p of places(K, ['nest'])) [2, 1, 0].forEach((size, i) => { tool('box', p, { r: 0, x: i / 2 }); C.tools[`s${n}.box`].size = size; });
  const drawers = places(K, ['dr']);
  drawers.forEach((p, d) => {
    const list = d === 0 ? CUTLERY : d === 1 ? UTENSILS : UTENSILS.slice((d * 3) % 8, (d * 3) % 8 + 3);
    list.forEach((k, i) => tool(k, p, { r: 0, x: i / 7 }));
  });
  return C;
}

// the bottles or the jar at a counter's corner (shared/kitchens.js counterDecor)
function cornerKind(K, p) { return counterDecor(K)[splitPlace(p)[0]] === 1 ? ['oilBottle', 'vinegarBottle'] : ['sugarJar']; }

// Things kept in a place: [key, thing] (items, vessels put away there, tools)
export function thingsIn(C, place) {
  const out = [];
  for (const [id, it] of Object.entries(C.items)) if (it.at === place && it.held == null && !it.in && !it.hidden) out.push([`i:${id}`, it]);
  for (const [id, v] of Object.entries(C.vessels)) if (!v.at && v.held == null && v.home === place) out.push([`v:${id}`, v]);
  for (const [id, t] of Object.entries(C.tools || {})) if (t.at === place && t.held == null) out.push([`u:${id}`, t]);
  return out;
}

// The slot a spot is in, in a place with `slots` along each shelf.
export function slotOf(B, spot) {
  return { r: Math.max(0, Math.min(B.levels - 1, Math.round(spot ? spot.r : B.levels - 1))), i: Math.max(0, Math.min(B.slots - 1, Math.round((spot ? spot.x : 0) * (B.slots - 1)))) };
}
// A free spot in a place (near the one wanted, on its shelf first) – null: it's full.
export function freeSpot(C, K, place, want = null, except = null) {
  const B = K.bays && K.bays[place];
  if (!B) return null;
  const taken = new Set(thingsIn(C, place).filter(([k]) => k !== except).map(([, t]) => { const s = slotOf(B, t.spot); return `${s.r}|${s.i}`; }));
  const w = slotOf(B, want);
  const order = [];
  for (let r = B.levels - 1; r >= 0; r--) for (let i = 0; i < B.slots; i++) order.push({ r, i });
  // (the one wanted, then along its shelf nearest first, then the rest)
  order.sort((a, b) => (want ? (a.r !== w.r) - (b.r !== w.r) || Math.abs(a.i - w.i) - Math.abs(b.i - w.i) : 0));
  const s = order.find((q) => !taken.has(`${q.r}|${q.i}`));
  return s ? { r: s.r, x: B.slots > 1 ? s.i / (B.slots - 1) : 0.5 } : null;
}
