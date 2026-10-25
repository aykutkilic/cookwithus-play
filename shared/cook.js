// The cooking state machine – pure functions over a plain JSON state, run by
// whoever hosts the kitchen (and by the tests). Clients get the same state and
// use displayState() to draw the work in progress.
//
// Recipe → steps (a DAG through `after`). A step is
//   locked   – waiting for the steps it comes after
//   open     – ready for anyone to do
//   active   – a cook is at it (step.by), going through its phases (gestures)
//   running  – a timer (do: 'wait') is ticking, sped up by the kitchen speed
//   ready    – the timer has run out; it keeps counting "over" (real time)
//              until someone starts a step that follows it
//   done
// Progress is kept when a cook walks away, so anyone can pick a step up
// where it was left – cooks can jump in and out at any time.
//
// Things have places. Every ingredient and every pot, pan, bowl and plate is
// in the fridge or on the pantry shelf to begin with; cooks fetch them, carry
// them (a few ingredients or one pot at a time) and put them down where the
// work is. A step starts only when what it needs is there (or in your hands –
// you put it down as you start). Nothing walks by itself.

import { ACTIONS, phasesOf, stepCap, stepTitle, stepVessel, scrapsOf, stepHands } from './actions.js';
import { INGREDIENTS, VESSELS, ingName, storeOf, twoHanded } from './ingredients.js';
import { FIXTURES, SIZES, SIZE_ORDER, kitchenCaps, fixtureById, bakeKind, isStore, storeFx } from './kitchens.js';
import { RECIPES } from './recipes.js';

export const SPEEDS = [1, 2, 4, 8, 16];
export const SCRAP_LIMIT = 3; // scraps on a counter before it's messy (a tidy cook clears them)
const EARLY_Q = 0.85;    // a step done before the ones the recipe puts first (it's up to you – it shows a little)
const MISSED_Q = 0.3;    // a step left out (what it needed went into something else)
export const HANDS = 2;       // one thing in each hand; a heavy pot, a tray, a stack of plates takes both
const OVER_GRACE = 45;   // seconds a finished timer can run over before it costs
const DONE_HOLD = 1;     // seconds

export function recipeById(id) { return RECIPES.find((r) => r.id === id) || null; }

// ------------------------------------------------------------------ recipe expansion

function normIng(r) {
  const out = {};
  for (const [id, v] of Object.entries(r.ing || {})) {
    if (typeof v === 'number') out[id] = { kind: id, qty: v };
    else if (Array.isArray(v)) out[id] = { kind: v[0], qty: v[1] ?? 1, ...(v[2] || {}) };
    else out[id] = { kind: v.kind || id, qty: v.qty ?? 1, ...v };
  }
  return out;
}
function normVes(r) {
  const out = {};
  const v = r.ves || {};
  if (Array.isArray(v)) for (const k of v) out[k] = { kind: k };
  else for (const [id, k] of Object.entries(v)) out[id] = typeof k === 'string' ? { kind: k } : { kind: k.kind, name: k.name };
  return out;
}

// Steps with `split: k` (rolling 12 dolmas…) are shared out between up to k
// cooks: they become k parallel steps, each with its share of the pieces.
export function expandRecipe(r, cap = 1) {
  const ing = normIng(r);
  const ves = normVes(r);
  const names = {};
  for (const [id, i] of Object.entries(ing)) names[id] = i.name || ingName(i.kind, i.qty).toLowerCase();
  for (const [id, v] of Object.entries(ves)) names[id] = v.name || (VESSELS[v.kind] ? VESSELS[v.kind].name.toLowerCase() : id);
  const splitOf = {};
  const steps = [];
  for (const s0 of r.steps) {
    const k = s0.split ? Math.max(1, Math.min(s0.split, cap, s0.n || 99)) : 1;
    if (k === 1) { steps.push({ ...s0, after: [...(s0.after || [])] }); continue; }
    splitOf[s0.id] = [];
    let left = s0.n;
    for (let i = 0; i < k; i++) {
      const n = Math.round(left / (k - i));
      left -= n;
      const id = `${s0.id}~${i + 1}`;
      splitOf[s0.id].push(id);
      steps.push({ ...s0, id, n, part: [i + 1, k], after: [...(s0.after || [])] });
    }
  }
  for (const s of steps) s.after = s.after.flatMap((a) => splitOf[a] || [a]);
  for (const s of steps) {
    s.name = stepTitle(s, names) + (s.part ? ` (${s.part[0]}/${s.part[1]})` : '');
  }
  return { ...r, ing, ves, names, steps };
}

// What a recipe needs from a kitchen.
export function recipeNeeds(r) {
  const x = r.steps ? r : expandRecipe(r);
  const hobVessels = new Set();
  let bake = null, chill = false;
  for (const s of x.steps) {
    if (s.do === 'heat') hobVessels.add(s.vessel);
    if (s.do === 'bakeIn') bake = s.ovens || ['electric', 'dome'];
    if (s.do === 'chillIn') chill = true;
  }
  return { hob: r.needs?.hob ?? hobVessels.size, bake, chill };
}

export function canCook(r, kitchen) {
  const n = recipeNeeds(r);
  const c = kitchenCaps(kitchen);
  if (r.minSize && SIZE_ORDER.indexOf(kitchen.size) < SIZE_ORDER.indexOf(r.minSize)) return { ok: false, why: `Needs a ${SIZES[r.minSize].name} kitchen or bigger` };
  if (n.hob > c.hob) return { ok: false, why: `Needs ${n.hob} burners` };
  if (n.bake) {
    const has = kitchen.fixtures.some((f) => f.caps.includes('bake') && n.bake.includes(bakeKind(f)));
    if (!has) {
      const what = n.bake.includes('tandoor') && !n.bake.includes('electric') ? 'a tandoor' : n.bake.includes('electric') ? 'an oven' : 'a stone oven';
      return { ok: false, why: `Needs ${what}` };
    }
  }
  if (n.chill && !c.chill) return { ok: false, why: 'Needs a fridge' };
  return { ok: true, why: '' };
}

// ------------------------------------------------------------------ state

export function newCook(r, kitchen) {
  const x = expandRecipe(r, kitchen.cap);
  const made = new Set(x.steps.filter((s) => s.makes).map((s) => s.makes));
  const items = {};
  for (const [id, i] of Object.entries(x.ing)) {
    items[id] = { kind: i.kind, qty: i.qty, washed: 0, peeled: 0, cut: null, k: 0, n: 0, cook: 0, at: null, in: null, held: null, used: 0 };
    if (i.kind === 'dough') items[id].shape = 'rough';
    if (i.form) items[id].form = i.form; // naan is a teardrop, pide a boat
    if (i.boiled) items[id].boiled = 1;
    const store = storeOf(i.kind);
    if (made.has(id)) items[id].hidden = 1;
    else if (!store) items[id].staple = 1; // salt, spices, oil, water: within reach everywhere
    else items[id].at = storeFx(kitchen, store); // in the fridge / on the pantry shelf
  }
  const vessels = {};
  const shelf = storeFx(kitchen, 'shelf');
  for (const [id, v] of Object.entries(x.ves)) {
    // at: where it stands ({fx, slot}); null while it's put away on the shelf (home) or in someone's hands
    vessels[id] = { kind: v.kind, water: 0, liquid: null, contents: [], heat: 0, boil: 0, lid: 0, cook: 0, at: null, home: shelf, held: null, items: [] };
  }
  const steps = {};
  for (const s of x.steps) steps[s.id] = { s: 'locked', ph: 0, k: 0, v: 0, by: null, fx: null, slot: 0, t: 0, over: 0, q: 1, claim: [], extra: [], who: [] };
  const C = {
    recipe: r.id, steps, items, vessels, fx: {}, speed: 1,
    started: 0, elapsed: 0, finished: 0, stars: 0, credits: {},
    scraps: {},  // fixture -> {n, kinds}: peel, shells, stems lying on a counter
    bins: {},    // bin fixture -> {fill, bags}
    carry: {},   // cook -> {n, kinds}: scraps in their hands (null when empty)
    dw: {},      // dishwasher fixture -> {run, t}: running, how long
    bagsOut: 0,  // full bags taken out to the back door
  };
  refresh(C, x);
  return C;
}

// The expanded recipe for a cook state (cached per recipe and kitchen size).
const xCache = new Map();
export function expanded(C, cap) {
  const key = `${C.recipe}|${cap}`;
  let x = xCache.get(key);
  if (!x) { x = expandRecipe(recipeById(C.recipe), cap); xCache.set(key, x); }
  return x;
}

export function stepDef(x, sid) {
  if (sid && sid[0] === '#') return choreDef(sid);
  return x.steps.find((s) => s.id === sid) || null;
}

// ------------------------------------------------------------------ chores (the trash)
// A chore is a step that isn't in the recipe: '#clear@counter2' (sweep the
// scraps off a counter into your hands), '#toss@binS1' (throw what you hold
// into a bin), '#bag@binS1' (change a full bag). Same gestures, same locks.
// (The fridge and the pantry aren't chores: you open them by the handle and
// take what you like – swingDoor, takeThing, putDown.)

export function choreId(kind, fx) { return `#${kind}@${fx}`; }
export function choreDef(sid) {
  const m = /^#(clear|toss|bag|knob|scrub|wipe|dw)@([a-zA-Z]+\d*)$/.exec(sid);
  if (!m) return null;
  return { id: sid, do: m[1], fx: m[2], chore: true, after: [], name: ACTIONS[m[1]].verb };
}

// every step a cook can be busy with: the recipe's and the chores under way
function allDefs(C, x) {
  const out = x.steps.slice();
  for (const id of Object.keys(C.steps)) if (id[0] === '#') { const d = choreDef(id); if (d) out.push(d); }
  return out;
}

export function binHolds(f) { return (f && FIXTURES[f.type].holds) || 0; }
export function carrying(C, memberId) { const c = C.carry && C.carry[memberId]; return c && c.n > 0 ? c : null; }

function addScraps(C, fx, sc) {
  if (!fx) return;
  const p = (C.scraps[fx] = C.scraps[fx] || { n: 0, kinds: [] });
  p.n += sc.n;
  if (sc.kind) { p.kinds.push(sc.kind); if (p.kinds.length > 8) p.kinds.shift(); }
}

// Why a chore can't be done right now ('' = it can).
function choreBlocked(C, x, K, d, memberId) {
  const f = fixtureById(K, d.fx);
  if (!f) return 'No such place';
  const sc = C.scraps[d.fx];
  const bin = C.bins[d.fx] || { fill: 0 };
  switch (d.do) {
    case 'knob':
      if (!freeHand(C, memberId)) return 'Both your hands are full – no hand free for the knob';
      return C.fx[d.fx] && C.fx[d.fx].lit && Object.keys(C.fx[d.fx].lit).length ? '' : 'No burner is on';
    case 'clear':
      if (heldBy(C, memberId).length) return `Put down the ${thingName(C, x, heldBy(C, memberId)[0])} first`;
      return sc && sc.n > 0 ? '' : 'Nothing to clear here';
    case 'toss':
      if (!f.caps.includes('bin')) return 'That isn’t a bin';
      if (!carrying(C, memberId)) return 'Your hands are empty';
      return bin.fill >= binHolds(f) ? 'This bin is full – change the bag first' : '';
    case 'bag':
      if (!f.caps.includes('bin')) return 'That isn’t a bin';
      return bin.fill >= binHolds(f) * 0.5 ? '' : 'The bag isn’t full yet';
    case 'scrub': {
      if (!f.caps.includes('sink')) return 'That isn’t a sink';
      if (!dirtyAt(C, x, d.fx)) return 'Nothing dirty in the sink';
      const h = heldBy(C, memberId);
      return h.length ? `Put the ${thingName(C, x, h[0])} down first – washing up takes both hands` : '';
    }
    case 'wipe':
      if (!(C.fx[d.fx] && C.fx[d.fx].dirty)) return 'The board is clean';
      return handsUsed(C, memberId) >= HANDS ? 'No hand free for the sponge' : '';
    case 'dw': {
      if (!f.caps.includes('dishwasher')) return 'That isn’t a dishwasher';
      const dw = C.dw && C.dw[d.fx];
      if (dw && dw.run) return 'It’s running';
      return dwLoad(C, d.fx).some((id) => C.vessels[id].dirty) ? '' : 'Nothing dirty in it – load it first';
    }
  }
  return 'Nothing to do';
}

// ------------------------------------------------------------------ washing up
// Pots, pans, bowls get dirty when a step uses them; a board after knife work.
// Before the dish is served the kitchen must be clean: no scraps lying about
// or in anyone's hands, no dirty board, nothing dirty but what holds the dish.

// What can go in the dishwasher – not wooden, copper or electric things (the
// pizza peel, a copper pot, the cezve, the blender, the kettle …): by hand.
const HAND_WASH = new Set(['peel', 'copperPot', 'cezve', 'cocotte', 'blender', 'kettle', 'caydanlik']);
export function dishwasherSafe(kind) { return !HAND_WASH.has(kind); }
export const DW_DUR = 90; // seconds a dishwasher runs (sped up with the kitchen, or skipped)
// what's in a dishwasher (vessel ids)
export function dwLoad(C, fx) { return Object.keys(C.vessels).filter((id) => C.vessels[id].inDw && C.vessels[id].at && C.vessels[id].at.fx === fx); }
// is it running?
export function dwRunning(C, fx) { return !!(C.dw && C.dw[fx] && C.dw[fx].run); }
// done: everything in it clean
function dwFinish(C, fx, ev) {
  const dw = C.dw && C.dw[fx];
  if (!dw || !dw.run) return false;
  dw.run = 0; dw.t = 0;
  for (const id of dwLoad(C, fx)) Object.assign(C.vessels[id], { dirty: 0, water: 0, contents: [], liquid: null });
  if (ev) ev.push({ k: 'ding', dw: fx });
  return true;
}
// ⏭ – the dishwashers that are running finish now
export function skipDw(C, fx = null) {
  let any = false;
  for (const f of Object.keys(C.dw || {})) if ((!fx || f === fx) && dwFinish(C, f, null)) any = true;
  return any;
}

// a pot / pan / bowl that wants washing: used, done with (off the heat, no
// step left that needs it) and nothing but water left in it
export function needsWash(C, x, id) {
  const v = C.vessels[id];
  if (!v || !v.dirty || v.inDw || v.heat > 0 || (v.contents || []).some((c) => c.kind !== 'water') || (v.items || []).length) return false;
  return !x.steps.some((s) => !['done', 'ready'].includes(C.steps[s.id].s) && (stepVessel(s) === id || s.from === id || s.into === id || s.vessel === id));
}
// the dirty one standing in this sink (vessel id), if any
function dirtyAt(C, x, fx) {
  for (const [id, v] of Object.entries(C.vessels)) if (v.held == null && v.at && v.at.fx === fx && needsWash(C, x, id)) return id;
  return null;
}
// What's still to clean up: [{kind: 'scraps' | 'carry' | 'board' | 'vessel' | 'dw', fx?, key?, m?, run?}]
// ('dw': dirty things in a dishwasher – run: it's running)
export function cleanup(C, x) {
  const out = [];
  for (const [fx, sc] of Object.entries(C.scraps || {})) if (sc && sc.n > 0) out.push({ kind: 'scraps', fx });
  for (const [m, c] of Object.entries(C.carry || {})) if (c && c.n > 0) out.push({ kind: 'carry', m: Number(m) });
  for (const [fx, s] of Object.entries(C.fx || {})) if (s && s.dirty) out.push({ kind: 'board', fx });
  for (const id of Object.keys(C.vessels)) {
    const v = C.vessels[id];
    if (v.inDw && v.dirty && v.at) out.push({ kind: 'dw', key: `v:${id}`, fx: v.at.fx, run: dwRunning(C, v.at.fx) });
    else if (needsWash(C, x, id)) out.push({ kind: 'vessel', key: `v:${id}` });
  }
  return out;
}

function choreDone(C, x, K, d, st) {
  const by = st.by;
  const f = fixtureById(K, d.fx);
  if (d.do === 'clear') {
    const sc = C.scraps[d.fx] || { n: 0, kinds: [] };
    const c = carrying(C, by) || { n: 0, kinds: [] };
    C.carry[by] = { n: c.n + sc.n, kinds: [...c.kinds, ...sc.kinds].slice(-8) };
    C.scraps[d.fx] = { n: 0, kinds: [] };
  } else if (d.do === 'toss') {
    const bin = (C.bins[d.fx] = C.bins[d.fx] || { fill: 0, bags: 0 });
    const c = carrying(C, by);
    const put = c ? Math.min(c.n, binHolds(f) - bin.fill) : 0;
    bin.fill += put;
    if (c) { c.n -= put; if (c.n <= 0) C.carry[by] = null; }
  } else if (d.do === 'bag') {
    const bin = (C.bins[d.fx] = C.bins[d.fx] || { fill: 0, bags: 0 });
    bin.fill = 0;
    bin.bags++;
    C.bagsOut = (C.bagsOut || 0) + 1;
  } else if (d.do === 'scrub') {
    const id = st.vid && needsWash(C, x, st.vid) ? st.vid : dirtyAt(C, x, d.fx);
    const v = id && C.vessels[id];
    if (v) { v.dirty = 0; v.water = 0; v.contents = []; v.liquid = null; }
  } else if (d.do === 'wipe') {
    if (C.fx[d.fx]) C.fx[d.fx].dirty = 0;
  } else if (d.do === 'dw') {
    C.dw = C.dw || {};
    C.dw[d.fx] = { run: 1, t: 0 };
  }
}

// ------------------------------------------------------------------ the fridge / pantry door
// Swung by a cook's hand: `swing` follows their drag (everyone sees the door
// move), and when they let go it's open or shut (`door`).
export function swingDoor(C, K, m, fx, v, done) {
  const f = fixtureById(K, fx);
  if (!f || !isStore(f)) return 'There’s no door to swing there';
  if (!freeHand(C, m)) return 'Both your hands are full – put it down first, then come back for the door';
  const s = fxState(C, fx);
  v = Math.max(0, Math.min(1, Number(v) || 0));
  if (done) { s.door = v >= 0.5 ? 1 : 0; s.swing = null; s.by = null; }
  else { s.swing = Math.round(v * 100) / 100; s.by = m; }
  return '';
}
export function doorOpen(C, fx) { return !!(C.fx[fx] && C.fx[fx].door); }

// how many hands a thing takes, how many a cook has busy
export function handsFor(C, key) {
  const t = thingOf(C, key);
  return key[0] === 'v' && t && twoHanded(t.kind) ? 2 : 1;
}
export function handsUsed(C, m) {
  if (carrying(C, m)) return HANDS; // a double handful of scraps
  return heldBy(C, m).reduce((n, k) => n + handsFor(C, k), 0);
}
// Has cook m a hand free?
export function freeHand(C, m) { return handsUsed(C, m) < HANDS; }

// Where a thing stands in the fridge / pantry, if a cook put it somewhere
// particular: shelf r (0 = the top one) and how far along it x (0 … 1).
// Things without a spot are kept in the usual order.
export const SHELVES = 4;
function spotOf(r, x) {
  return { r: Math.max(0, Math.min(SHELVES - 1, Math.round(Number(r) || 0))), x: Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 100) / 100 };
}

// Rearranging the fridge / pantry as you like.
export function arrange(C, K, m, key, fx, r, xpos) {
  const f = fixtureById(K, fx);
  if (!f || !isStore(f)) return 'Nothing is kept there';
  if (!doorOpen(C, fx)) return `Open the ${f.type === 'fridge' ? 'fridge' : 'pantry'} door first`;
  const L = locate(C, K, key);
  if (!L.stored || L.fx !== fx) return 'That isn’t in there';
  thingOf(C, key).spot = spotOf(r, xpos);
  return '';
}

// ------------------------------------------------------------------ things and hands
// A thing is 'i:<item id>' or 'v:<vessel id>'.

export function thingOf(C, key) { const id = key.slice(2); return key[0] === 'v' ? C.vessels[id] : C.items[id]; }
export function thingName(C, x, key) {
  const id = key.slice(2);
  return (x && x.names[id]) || (key[0] === 'v' ? (VESSELS[C.vessels[id]?.kind]?.name || id) : ingName(C.items[id]?.kind || id, 1)).toLowerCase();
}

export function thingEmoji(C, key) {
  const t = thingOf(C, key);
  if (!t) return '•';
  return (key[0] === 'v' ? VESSELS[t.kind]?.emoji : INGREDIENTS[t.kind]?.emoji) || (key[0] === 'v' ? '🍲' : '🥕');
}

// Where a thing is: {fx, slot, stored} on a fixture (stored: kept in the
// fridge / on the shelf), {held: cook}, {staple}, {gone}; inV: inside that vessel.
export function locate(C, K, key) {
  const id = key.slice(2);
  if (key[0] === 'v') {
    const v = C.vessels[id];
    if (!v) return { gone: true };
    if (v.held != null) return { held: v.held };
    if (v.at) return { fx: v.at.fx, slot: v.at.slot };
    return { fx: v.home, stored: true };
  }
  const it = C.items[id];
  if (!it || it.hidden) return { gone: true };
  if (it.staple) return { staple: true };
  if (it.in) { const L = locate(C, K, `v:${it.in}`); return { ...L, stored: false, inV: it.in }; }
  if (it.held != null) return { held: it.held };
  if (!it.at) return { gone: true };
  return { fx: it.at, stored: isStore(fixtureById(K, it.at)) };
}

// The things a step works with that have to be at hand (staples always are).
export function needsOf(C, s) {
  if (!s || s.chore || s.do === 'wait' || s.do === 'serve') return [];
  const out = [];
  for (const id of [s.item, ...(s.items || []), s.with, s.target]) {
    const it = id && C.items[id];
    if (it && !it.staple && !out.includes(`i:${id}`)) out.push(`i:${id}`);
  }
  for (const id of [s.vessel, s.into, s.from]) if (id && C.vessels[id] && !out.includes(`v:${id}`)) out.push(`v:${id}`);
  return out;
}

// what a cook is holding
export function heldBy(C, m) {
  const out = [];
  for (const [id, it] of Object.entries(C.items)) if (it.held === m && !it.in) out.push(`i:${id}`);
  for (const [id, v] of Object.entries(C.vessels)) if (v.held === m) out.push(`v:${id}`);
  return out;
}

// is it here (on this fixture, or inside a pot that is), or in my hands?
function atPlace(C, K, key, fx, m) {
  const L = locate(C, K, key);
  return !!L.staple || L.held === m || (!L.stored && !L.gone && L.held == null && L.fx === fx);
}
// a pot I'm holding with something the step needs inside it
function holdsNeeded(C, key, need) {
  if (key[0] !== 'v') return false;
  const vid = key.slice(2);
  return need.some((k) => k[0] === 'i' && C.items[k.slice(2)] && C.items[k.slice(2)].in === vid);
}

// Can this cook pick that up? ('' = yes)
export function handsFree(C, x, m, key) {
  if (carrying(C, m)) return 'Your hands are full of scraps – take them to a bin first 🗑️';
  const need = handsFor(C, key);
  if (handsUsed(C, m) + need <= HANDS) return '';
  const h = heldBy(C, m);
  if (need === 2) return `You need both hands for the ${thingName(C, x, key)} – put down what you're holding`;
  return `Both your hands are full – put the ${thingName(C, x, h[0])} down first`;
}

// a step is under way with it (someone's hands are on it)
function inUse(C, x, key) {
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s === 'active' && needsOf(C, s).includes(key)) return st.by;
  }
  return null;
}
// a job on it was started here and isn't finished: it stays put
function halfDone(C, x, key, fx) {
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s === 'open' && st.fx === fx && (st.ph > 0 || st.k > 0) && needsOf(C, s).includes(key)) return true;
  }
  return false;
}

// Pick something up: from a counter, the sink, the stove – or out of the
// fridge / pantry once its door is open.
export function takeThing(C, x, K, m, key, fx) {
  const t = thingOf(C, key);
  const f = fixtureById(K, fx);
  if (!t || !f) return 'Nothing like that here';
  if (C.finished) return 'The dish is finished';
  const L = locate(C, K, key);
  if (L.stored && (L.fx !== fx || !doorOpen(C, fx))) return L.fx === fx ? `Open the ${f.type === 'fridge' ? 'fridge' : 'pantry'} door first` : 'That’s put away';
  if (L.inV) return `It’s in the ${thingName(C, x, `v:${L.inV}`)} – take that`;
  if (L.held != null || L.fx !== fx) return 'It isn’t here';
  if (t.inDw && dwRunning(C, fx)) return 'The dishwasher is running – wait till it’s done';
  const why = handsFree(C, x, m, key);
  if (why) return why;
  if (key[0] === 'v' && !L.stored) {
    const vid = key.slice(2);
    const timer = x.steps.find((q) => q.do === 'wait' && q.vessel === vid && C.steps[q.id].s === 'running');
    if (timer && t.heat > 0) return `It’s cooking – ${timer.label || 'wait for the timer'} first`;
    if (f.caps.includes('chill')) return 'Take it out of the fridge with its step';
    if (f.caps.includes('bake') && !t.onHob) return 'Take it out of the oven with its step';
  }
  if (inUse(C, x, key) != null) return 'Someone is working on that';
  if (halfDone(C, x, key, fx)) return 'Finish the job on it here first';
  if (key[0] === 'v' && t.heat > 0 && t.at && f.caps.includes('hob')) {
    // lifted off: the burner keeps burning until someone turns its knob off
    const s = fxState(C, fx);
    s.lit = { ...(s.lit || {}), [t.at.slot]: t.heat };
  }
  t.held = m;
  t.at = null;
  t.inDw = 0;
  delete t.spot; // its place on the shelf is free now
  if (key[0] === 'v') { t.onHob = 0; t.heat = 0; }
  return '';
}

// what can be put down on a fixture: ingredients on counters, tables, in the
// sink, back in the fridge / on the shelf; pots also on a free burner
function putBlocked(C, x, K, held, f) {
  const surface = f.caps.includes('board') || f.caps.includes('plate') || f.caps.includes('sink');
  const store = isStore(f);
  if (store && !(C.fx[f.id] && C.fx[f.id].door)) return `Open the ${f.type === 'fridge' ? 'fridge' : 'pantry'} door first`;
  for (const k of held) {
    if (k[0] === 'i' && !surface && !store && !f.caps.includes('hob')) return 'Put it on a counter, a table or in the sink';
    if (k[0] === 'v') {
      const v = thingOf(C, k);
      if (store && (f.type === 'fridge' || v.contents.length || v.water > 0.05 || (v.items && v.items.length))) return f.type === 'fridge' ? 'Pots go in the fridge with their step' : 'Empty it before you put it away';
      if (!surface && !store && !(f.caps.includes('hob') && freeSlot(C, x, f) >= 0)) return f.caps.includes('hob') ? 'No free burner' : 'Put it on a counter, the stove or the shelf';
    }
  }
  return '';
}
function freeSlot(C, x, f) {
  for (let slot = 0; slot < f.slots; slot++) if (!slotTaken(C, x, f.id, slot, null)) return slot;
  return -1;
}

// Could cook m put what they hold down here? ('' = yes)
export function canPut(C, x, K, m, fx) {
  const held = heldBy(C, m);
  const f = fixtureById(K, fx);
  if (!held.length) return 'Your hands are empty';
  return f ? putBlocked(C, x, K, held, f) : 'Nowhere to put it';
}

// Put down everything in your hands here (or just `only`, one of them; into
// the fridge / pantry at `spot` {r, x} if you put it somewhere particular).
export function putDown(C, x, K, m, fx, only = null, spot = null) {
  const f = fixtureById(K, fx);
  const held = heldBy(C, m).filter((k) => !only || k === only);
  if (!held.length) return only ? 'You aren’t holding that' : 'Your hands are empty';
  if (!f) return 'Nowhere to put it';
  const why = putBlocked(C, x, K, held, f);
  if (why) return why;
  const surface = f.caps.includes('board') || f.caps.includes('plate') || f.caps.includes('sink');
  for (const k of held) {
    const t = thingOf(C, k);
    t.held = null;
    delete t.spot;
    if (isStore(f) && spot) t.spot = spotOf(spot.r, spot.x);
    if (k[0] === 'i') { t.at = fx; continue; }
    if (isStore(f)) { t.at = null; t.home = fx; continue; }
    const onHob = !surface && f.caps.includes('hob');
    t.at = { fx, slot: onHob ? freeSlot(C, x, f) : 0 };
    // a dirty one put down at the dishwasher goes in it (if it may – and it isn't running)
    if (f.caps.includes('dishwasher') && dishwasherSafe(t.kind) && needsWash(C, x, k.slice(2)) && !dwRunning(C, fx)) t.inDw = 1;
    t.onHob = onHob ? 1 : 0;
    // onto a burner that was left on: it heats again
    const lit = onHob && C.fx[fx] && C.fx[fx].lit;
    if (lit && lit[t.at.slot]) { t.heat = lit[t.at.slot]; delete lit[t.at.slot]; }
  }
  return '';
}

// "Bring the eggs here first – they’re in the fridge"
function bringMsg(C, x, K, miss) {
  const k = miss[0];
  const L = locate(C, K, k);
  const name = thingName(C, x, k);
  const f = L.fx && fixtureById(K, L.fx);
  const many = /s$/.test(name);
  const is = many ? 'they’re' : 'it’s';
  const where = L.held != null ? `someone else has ${many ? 'them' : 'it'}`
    : L.stored ? `${is} ${f && f.type === 'fridge' ? 'in the fridge 🧊' : 'on the pantry shelf'}`
      : f ? `${is} ${f.caps.includes('sink') ? 'in' : 'on'} the ${FIXTURES[f.type].name.toLowerCase()}` : '';
  return `Bring the ${name} here first${miss.length > 1 ? ` (and ${miss.length - 1} more)` : ''}${where ? ` – ${where}` : ''}`;
}

// ------------------------------------------------------------------ the plan
// What a cook has to do next to get a step going – what a sensible player
// would do, and what the 📍 guide points at:
//   {do: 'take', key, fx, store}  fetch something (store: from the fridge / shelf)
//   {do: 'put', fx}                put down what's in your hands first
//   {do: 'go', fx, slot}           all at hand: go and start it there
//   {do: 'wait', why}              someone else has what it needs
//   {do: 'bin'}                    your hands are full of scraps
//   null                           not a step you can do now
export function planStep(C, x, K, sid, m) {
  const s = stepDef(x, sid);
  if (s && s.chore && (s.do === 'scrub' || s.do === 'wipe')) return planWash(C, x, K, s, m);
  const st = s && C.steps[sid];
  if (!s || !st || s.chore || s.do === 'wait') return null;
  if (st.s === 'active' && st.by === m) return { do: 'go', fx: st.fx, slot: st.slot };
  if (st.s !== 'open') return null;
  if (carrying(C, m)) return { do: 'bin' };
  const need = needsOf(C, s);
  const held = heldBy(C, m);
  const place = targetPlace(C, x, K, s, m);
  const extra = held.filter((k) => !need.includes(k) && !holdsNeeded(C, k, need));
  const mine = held.filter((k) => !extra.includes(k));
  // what I hold for something else can stay in one hand – unless this takes both
  if (extra.length && (stepHands(s) === 2 || extra.reduce((n, k) => n + handsFor(C, k), 0) >= HANDS)) return { do: 'put', fx: putSpot(C, x, K, m, place, extra), keys: extra };
  const missing = place ? need.filter((k) => !atPlace(C, K, k, place.fx, m)) : need.filter((k) => locate(C, K, k).held !== m);
  if (place && !missing.length) return { do: 'go', fx: place.fx, slot: place.slot };
  // the pot / bowl it happens in comes first (its place decides where), then the rest
  const loc = s.into || s.vessel;
  if (!place && loc) {
    const LL = locate(C, K, `v:${loc}`);
    if (LL.held != null && LL.held !== m) return { do: 'wait', why: `Someone has the ${thingName(C, x, `v:${loc}`)}` };
  }
  const order = place ? missing : [...missing].sort((a, b) => (b === `v:${loc}`) - (a === `v:${loc}`));
  let blocked = '';
  for (const k0 of order) {
    let k = k0;
    let L = locate(C, K, k);
    if (L.gone) continue;
    if (L.inV && L.held == null) { k = `v:${L.inV}`; L = locate(C, K, k); } // it's in a pot: bring the pot
    if (L.held != null && L.held !== m) { blocked = `Someone has the ${thingName(C, x, k)}`; continue; }
    if (L.held === m) continue;
    if (handsFree(C, x, m, k)) {
      // make room: what I hold for something else first; else leave what I've brought where it'll be used
      const keys = extra.length ? extra : place && !putBlocked(C, x, K, mine, fixtureById(K, place.fx)) ? mine : held;
      return { do: 'put', fx: putSpot(C, x, K, m, extra.length ? null : place, keys), keys };
    }
    return { do: 'take', key: k, fx: L.fx, store: !!L.stored };
  }
  // someone else is holding the rest: leave my share at the spot for whoever does it
  if (blocked && held.length) return { do: 'put', fx: putSpot(C, x, K, m, place), keys: held };
  if (!place && held.length) return { do: 'put', fx: putSpot(C, x, K, m, null), keys: held };
  return { do: 'wait', why: blocked || 'Not yet' };
}

// Getting the washing up going: a dirty pot to the sink (my hands free of the
// rest), then wash it there; the board: a free hand for the sponge.
function planWash(C, x, K, s, m) {
  if (carrying(C, m)) return { do: 'bin' };
  const st = C.steps[s.id];
  if (st && st.s === 'active' && st.by === m) return { do: 'go', fx: s.fx, slot: 0 };
  const held = heldBy(C, m);
  if (s.do === 'wipe') {
    if (!(C.fx[s.fx] && C.fx[s.fx].dirty)) return null;
    if (handsUsed(C, m) >= HANDS) return { do: 'put', fx: putSpot(C, x, K, m, { fx: s.fx }, held), keys: held };
    return { do: 'go', fx: s.fx, slot: 0 };
  }
  const mine = held.find((k) => k[0] === 'v' && needsWash(C, x, k.slice(2)));
  if (mine) return { do: 'put', fx: s.fx, keys: [mine] }; // (into the sink)
  if (held.length) return { do: 'put', fx: putSpot(C, x, K, m, null, held), keys: held };
  if (dirtyAt(C, x, s.fx)) return { do: 'go', fx: s.fx, slot: 0 };
  // the nearest dirty one nobody has in their hands
  for (const [id, v] of Object.entries(C.vessels)) {
    if (v.held != null || !needsWash(C, x, id)) continue;
    const L = locate(C, K, `v:${id}`);
    if (L.fx && L.fx !== s.fx) return { do: 'take', key: `v:${id}`, fx: L.fx, store: !!L.stored };
  }
  return null;
}

// where a step would be done: a free spot, preferably where its things already are
function targetPlace(C, x, K, s, m) {
  const places = stepPlaces(C, x, K, s, m);
  if (!places.length) return null;
  const ok = places.filter((p) => !placeBusy(C, x, K, s, p, m));
  const pool = ok.length ? ok : places;
  const need = needsOf(C, s);
  let best = pool[0], most = -1;
  for (const p of pool) {
    const n = need.filter((k) => { const L = locate(C, K, k); return !L.stored && L.held == null && L.fx === p.fx; }).length;
    if (n > most) { best = p; most = n; }
  }
  return best;
}

// where to put down what you're holding: at the place you're heading for if it
// takes them, otherwise the counter nearest to it that's free
function putSpot(C, x, K, m, place, keys = null) {
  const held = keys || heldBy(C, m);
  const f = place && fixtureById(K, place.fx);
  if (f && !putBlocked(C, x, K, held, f)) return f.id;
  const near = (g) => (f ? Math.hypot(g.x - f.x, g.y - f.y) : 0);
  const spots = K.fixtures.filter((g) => (g.caps.includes('board') || g.caps.includes('plate')) && !putBlocked(C, x, K, held, g));
  spots.sort((a, b) => near(a) - near(b));
  return spots.length ? spots[0].id : null;
}

// Are the steps the recipe puts before this one done? (A timer that has run
// out counts, for what follows it.)
export function inOrder(C, s) {
  return s.after.every((a) => C.steps[a] && (C.steps[a].s === 'done' || (C.steps[a].s === 'ready' && s.do !== 'wait')));
}

// Steps are open from the start: cook them in any order you like – the
// recipe's order is its advice, and a step done early costs a little in the
// stars. Only a timer waits for what it times (it starts by itself: waiting is
// the only thing that isn't a gesture), and serving for everything else.
export function refresh(C, x) {
  let changed = false;
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s !== 'locked') continue;
    if (s.do === 'wait' && !inOrder(C, s)) continue;
    // (serving: once everything else is done – and the kitchen is clean)
    if (s.do === 'serve' && (!x.steps.every((o) => o.id === s.id || ['done', 'ready'].includes(C.steps[o.id].s)) || cleanup(C, x).length)) continue;
    // a step after a timer opens when the timer is ready
    st.s = s.do === 'wait' ? 'running' : 'open';
    st.t = 0;
    changed = true;
  }
  return changed;
}

export function isFinished(C) { return C.finished > 0; }

// ------------------------------------------------------------------ where a step can be done

// Fixtures a step may be done at, and which slot (burner / oven shelf). A
// step that happens in a pot or bowl happens where that pot is – or, if it's
// in cook m's hands, on any counter they put it down on; while it's still on
// the shelf (or someone else has it) there's nowhere yet.
export function stepPlaces(C, x, K, s, m) {
  const a = ACTIONS[s.do];
  if (!a || a.cap === null) return [];
  if (s.chore) return fixtureById(K, s.fx) ? [{ fx: s.fx, slot: 0 }] : [];
  const st = C.steps[s.id];
  if (st.fx && (st.ph > 0 || st.k > 0)) return [{ fx: st.fx, slot: st.slot }]; // started here: finish here
  const vid = stepVessel(s);
  const v = vid && C.vessels[vid];
  if (a.cap === 'vessel' && v && !v.at && v.held !== m) return [];
  const cap = stepCap(s, C);
  if (cap && typeof cap === 'object') return [{ fx: cap.at.fx, slot: cap.at.slot }];
  // already standing where it goes (a pot put on a burner, a tray at the oven)
  if (a.moves && v && v.at) {
    const f = fixtureById(K, v.at.fx);
    if (f && f.caps.includes(cap) && (cap !== 'hob' || v.onHob || f.type === 'stove' || f.type === 'paellaBurner')) return [{ fx: f.id, slot: v.at.slot }];
  }
  const out = [];
  for (const f of K.fixtures) {
    if (!f.caps.includes(cap)) continue;
    if (cap === 'bake') {
      const allowed = s.ovens || ['electric', 'dome'];
      if (!allowed.includes(bakeKind(f))) continue;
    }
    if (cap === 'hob' || cap === 'bake') {
      // a free burner / oven place
      for (let slot = 0; slot < f.slots; slot++) {
        if (slotTaken(C, x, f.id, slot, s.id, vid)) continue;
        out.push({ fx: f.id, slot });
        break;
      }
    } else out.push({ fx: f.id, slot: 0 });
  }
  return out;
}

function slotTaken(C, x, fx, slot, exceptSid, exceptVid) {
  for (const [id, v] of Object.entries(C.vessels)) if (id !== exceptVid && v.at && v.at.fx === fx && v.at.slot === slot) return true;
  for (const s of allDefs(C, x)) {
    const st = C.steps[s.id];
    if (s.id !== exceptSid && st && st.s === 'active' && st.fx === fx && st.slot === slot) return true;
  }
  return false;
}

// Is a fixture free for this step? Boards, sinks and plating spots take one
// cook at a time; at a stove or oven it's one cook per pot.
export function placeBusy(C, x, K, s, place, memberId) {
  const f = fixtureById(K, place.fx);
  if (!f) return 'No such place';
  const vid = s.chore ? null : stepVessel(s);
  for (const o of allDefs(C, x)) {
    const st = C.steps[o.id];
    if (!st || o.id === s.id || st.s !== 'active' || st.by === memberId) continue;
    if (st.fx !== place.fx) continue;
    if (f.caps.includes('store')) continue; // room for everyone at the fridge
    const shared = f.caps.includes('hob') || f.caps.includes('bake') || f.caps.includes('chill') || f.caps.includes('tandoor');
    if (!shared) return 'Someone is working there';
    if (st.slot === place.slot || (vid && stepVessel(o) === vid)) return 'Someone is working on that';
  }
  return '';
}

// ------------------------------------------------------------------ cooks' actions

export function openStep(C, x, K, sid, place, memberId) {
  const s = stepDef(x, sid);
  if (s && s.chore) {
    const why = choreBlocked(C, x, K, s, memberId);
    if (why) return why;
    if (!C.steps[sid] || C.steps[sid].s === 'done') C.steps[sid] = { s: 'open', ph: 0, k: 0, v: 0, by: null, fx: null, slot: 0, t: 0, over: 0, q: 1, claim: [], extra: [], who: [] };
  }
  const st = C.steps[sid];
  if (!s || !st) return 'No such step';
  if (s.chore && s.do === 'scrub' && !(st.s === 'active' || st.ph > 0 || st.k > 0)) st.vid = dirtyAt(C, x, s.fx);
  if (C.finished && !s.chore) return 'The dish is finished';
  if (!s.chore && carrying(C, memberId)) return 'Your hands are full – take the scraps to a bin first 🗑️';
  if (st.s === 'active' && st.by !== memberId) return 'Someone is already on it';
  if (st.s !== 'open' && st.s !== 'active') return st.s === 'locked' ? 'Not yet – earlier steps first' : 'Nothing to do there';
  if (s.do === 'wait') return 'That one just needs time';
  const places = stepPlaces(C, x, K, s, memberId);
  const pl = places.find((p) => p.fx === place.fx) || null;
  if (!pl) {
    const vid = stepVessel(s);
    if (!places.length && vid && ACTIONS[s.do].cap === 'vessel') return bringMsg(C, x, K, [`v:${vid}`]);
    return places.length ? 'Not here – try another spot' : 'No free place for that right now';
  }
  const busy = placeBusy(C, x, K, s, pl, memberId);
  if (busy) return busy;
  if (!s.chore) {
    // what it needs has to be here – or in your hands
    const need = needsOf(C, s);
    const miss = need.filter((k) => !atPlace(C, K, k, pl.fx, memberId));
    if (miss.length) return bringMsg(C, x, K, miss);
    // what you hold for something else stays in one hand if this needs only
    // the other – else you set it down here first, as anyone would
    const extra = heldBy(C, memberId).filter((k) => !need.includes(k) && !holdsNeeded(C, k, need));
    if (extra.length && (stepHands(s) === 2 || extra.reduce((n, k) => n + handsFor(C, k), 0) >= HANDS)) {
      const f = fixtureById(K, pl.fx);
      if (putBlocked(C, x, K, extra, f)) return `Put the ${thingName(C, x, extra[0])} down first – you need ${stepHands(s) === 2 ? 'both hands' : 'a free hand'} for this`;
      for (const k of extra) putDown(C, x, K, memberId, pl.fx, k);
    }
    // started before the steps the recipe puts first: your call (it shows a little)
    if (st.ph === 0 && st.k === 0 && st.s === 'open' && !inOrder(C, s)) st.early = 1;
  }
  // one step at a time per cook
  for (const o of allDefs(C, x)) if (o.id !== sid && C.steps[o.id] && C.steps[o.id].s === 'active' && C.steps[o.id].by === memberId) closeStep(C, x, o.id, memberId);
  st.s = 'active';
  st.by = memberId;
  st.fx = pl.fx;
  st.slot = pl.slot;
  { const f0 = fixtureById(K, pl.fx); const ph0 = phasesOf(s, bakeKind(f0))[st.ph]; if (ph0 && ph0.g === 'door' && st.k === 0) st.v = fxState(C, pl.fx).door ? 1 : 0; }
  if (!s.chore) {
    // what you brought goes down here (a pot you'll put on the burner / in the
    // oven yourself stays in your hands until you do)
    const own = ACTIONS[s.do].moves && stepVessel(s) ? `v:${stepVessel(s)}` : null;
    const need = needsOf(C, s);
    for (const k of heldBy(C, memberId)) {
      if (k === own || (!need.includes(k) && !holdsNeeded(C, k, need))) continue; // still in your other hand
      const t = thingOf(C, k);
      t.held = null;
      if (k[0] === 'i') t.at = pl.fx;
      else { t.at = { fx: pl.fx, slot: pl.slot }; t.onHob = 0; }
    }
  }
  if (!C.started && !s.chore) C.started = 1;
  // the timer before this step stops counting "over" now
  for (const a of s.after) {
    const pa = C.steps[a];
    if (pa && pa.s === 'ready') finishWait(C, x, a);
  }
  return '';
}

export function closeStep(C, x, sid, memberId) {
  const st = C.steps[sid];
  if (!st || st.s !== 'active' || st.by !== memberId) return false;
  st.s = 'open';
  st.by = null;
  if (st.ph === 0 && st.k === 0) st.fx = null;
  return true;
}

export function phaseTarget(ph) {
  if (ph.g === 'circle') return ph.n < 1 ? 1 : Math.round(ph.n);
  return Math.max(1, Math.round(ph.n || 1));
}
export const VALUE_GESTURES = new Set(['pour', 'fill', 'knob', 'paint', 'door']);

// A gesture report from the cook working a step: {ph, k} for counted
// gestures, {ph, v, done} for value gestures, {ph, v, live} while pouring,
// {ph, k, x, y} for placed pieces. Returns events for sounds/effects.
export function actStep(C, x, K, sid, memberId, a) {
  const s = stepDef(x, sid);
  const st = C.steps[sid];
  if (!s || !st || st.s !== 'active' || st.by !== memberId) return null;
  const f = fixtureById(K, st.fx);
  const phases = phasesOf(s, bakeKind(f));
  const ph = phases[st.ph];
  if (!ph || a.ph !== st.ph) return null;
  const ev = [];
  // the first touch puts the things being worked on at this place
  if (st.ph === 0 && st.k === 0 && !st.v) pinThings(C, s, st);
  if (VALUE_GESTURES.has(ph.g)) {
    const v = Math.max(0, Math.min(1.2, Number(a.v) || 0));
    if (a.live) { st.v = v; return ev; }
    if (!a.done) return ev;
    if (ph.g === 'knob' && Math.round(v * 3) !== ph.to) return ev;
    if ((ph.g === 'pour' || ph.g === 'fill') && v < ph.band[0]) { st.v = v; return ev; }
    if (ph.g === 'paint' && v < ph.cover) return ev;
    if (ph.g === 'door' && (ph.to ? v < 0.8 : v > 0.2)) { st.v = v; return ev; }
    if (ph.g === 'pour' || ph.g === 'fill') st.q = Math.min(st.q, v <= ph.band[1] ? 1 : 0.75);
    completePhase(C, x, K, s, st, ph, v, f, ev);
  } else {
    const k = Math.floor(Number(a.k) || 0);
    if (k <= st.k) return ev;
    const target = phaseTarget(ph);
    if (ph.g === 'place') {
      const px = Math.max(-1, Math.min(1, Number(a.x) || 0)), py = Math.max(-1, Math.min(1, Number(a.y) || 0));
      st.extra.push({ kind: ph.piece, x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100 });
    }
    st.k = Math.min(k, target);
    ev.push({ k: 'g', g: ph.g, sid, fx: st.fx });
    credit(C, memberId, 'moves');
    if (st.k >= target) completePhase(C, x, K, s, st, ph, st.k, f, ev);
  }
  return ev;
}

function pinThings(C, s, st) {
  const a = ACTIONS[s.do];
  if (s.item && C.items[s.item] && a.cap === 'board') {
    // the food comes out of whatever bowl it was in, onto the board
    const it = C.items[s.item];
    const v = it.in && C.vessels[it.in];
    if (v) v.contents = v.contents.filter((c) => c.kind !== it.kind);
    it.in = null;
    it.at = st.fx;
  }
}

function fxState(C, id) { return (C.fx[id] = C.fx[id] || { tap: 0, door: 0 }); }

function completePhase(C, x, K, s, st, ph, v, f, ev) {
  if (ph.eff) ph.eff(C, s, v, fxState(C, st.fx), ph, st.extra);
  const a = ACTIONS[s.do];
  // a pot dragged onto a burner / under the tap is there from now on
  if (a.moves && ph.g === 'drag') moveVessel(C, s, st);
  // lifted off the burner / out of the oven or fridge: it's in your hands now
  if (ph.g === 'drag' && ph.obj === 'vessel' && ph.to === 'aside') {
    const v = C.vessels[stepVessel(s)];
    if (v) { v.at = null; v.onHob = 0; v.held = st.by; }
  }

  st.ph++;
  st.k = 0;
  st.v = 0;
  st.extra = [];
  const phases = phasesOf(s, bakeKind(f));
  // a door to swing next starts from where the door is
  if (phases[st.ph] && phases[st.ph].g === 'door') st.v = fxState(C, st.fx).door ? 1 : 0;
  ev.push({ k: 'phase', sid: s.id });
  if (st.ph < phases.length) return;
  if (s.chore) {
    choreDone(C, x, K, s, st);
    st.s = 'done';
    credit(C, st.by, 'chores');
    st.by = null;
    ev.push({ k: 'chore', sid: s.id, what: s.do });
    refresh(C, x); // (the kitchen may be clean now: serving opens)
    return;
  }
  // step complete
  const sc = scrapsOf(s, C.items);
  if (sc) addScraps(C, st.fx, sc);
  // what it used is dirty now: its pots and pans, the board
  for (const id of [s.vessel, s.into, s.from]) if (id && C.vessels[id]) C.vessels[id].dirty = 1;
  if (a.cap === 'board' && f && f.caps.includes('board')) fxState(C, st.fx).dirty = 1;
  if (a.moves) moveVessel(C, s, st);
  if (s.makes && C.items[s.makes]) {
    const it = C.items[s.makes];
    it.hidden = 0;
    it.at = st.fx;
    const v = C.vessels[s.vessel];
    if (v && !s.keep) { v.contents = []; v.water = 0; v.liquid = null; v.emptied = 1; } // the empty bowl stays where it is
  }
  if (s.places) {
    // things laid on a tray / dish / plate: [{item, x, y}] (x, y in -1..1)
    const v = C.vessels[stepVessel(s)];
    if (v) for (const p of s.places) { const it = C.items[p.item]; if (it) { v.items.push({ id: p.item, x: p.x, y: p.y }); it.used = 1; it.at = null; it.held = null; } }
  }
  if (s.makes2) for (const id of s.makes2) if (C.items[id]) { C.items[id].hidden = 0; C.items[id].at = st.fx; }
  applySets(C, s);
  st.s = 'done';
  if (st.early) st.q = Math.min(st.q, EARLY_Q);
  if (!st.who.includes(st.by)) st.who.push(st.by);
  credit(C, st.by, 'steps');
  st.by = null;
  ev.push({ k: 'step', sid: s.id });
  leftOut(C, x);
  // (a timer whose steps after it are all done stops here)
  for (const o of x.steps) {
    const ot = C.steps[o.id];
    if (ot.s === 'ready' && x.steps.filter((q) => q.after.includes(o.id)).every((q) => q.do === 'wait' || C.steps[q.id].s === 'done')) finishWait(C, x, o.id);
  }
  if (s.do === 'serve' || x.steps.every((o) => C.steps[o.id].s === 'done')) finish(C, x, ev);
  refresh(C, x);
}

// Steps that can't be done any more – what they work with has gone into
// something else for good (laid on the tray, …) – are left out.
function leftOut(C, x) {
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s !== 'open' && st.s !== 'locked') continue;
    const gone = needsOf(C, s).some((k) => { const it = k[0] === 'i' && C.items[k.slice(2)]; return it && it.used && !it.in && !it.at && it.held == null; });
    if (gone) { st.s = 'done'; st.q = MISSED_Q; st.missed = 1; }
  }
}

function moveVessel(C, s, st) {
  const vid = stepVessel(s);
  if (vid && C.vessels[vid]) { C.vessels[vid].at = { fx: st.fx, slot: st.slot }; C.vessels[vid].held = null; }
  const lit = C.fx[st.fx] && C.fx[st.fx].lit;
  if (lit && lit[st.slot]) { if (vid && C.vessels[vid]) C.vessels[vid].heat = lit[st.slot]; delete lit[st.slot]; }
}

// `sets: {egg: {boiled: 1}}` changes items, `vsets: {pot: {lid: 1}}` vessels –
// when a step is done (or a timer runs out).
function applySets(C, s) {
  for (const [id, o] of Object.entries(s.sets || {})) if (C.items[id]) Object.assign(C.items[id], o);
  for (const [id, o] of Object.entries(s.vsets || {})) if (C.vessels[id]) Object.assign(C.vessels[id], o);
}

function credit(C, id, what) {
  if (id == null) return;
  const c = (C.credits[id] = C.credits[id] || { steps: 0, moves: 0, chores: 0 });
  c[what] = (c[what] || 0) + 1;
}

function finish(C, x, ev) {
  for (const s of x.steps) { const st = C.steps[s.id]; if (st.s !== 'done') { st.s = 'done'; if (s.do !== 'wait' && s.do !== 'serve') { st.q = Math.min(st.q, MISSED_Q); st.missed = 1; } } }
  const qs = x.steps.map((s) => C.steps[s.id].q);
  const q = qs.reduce((a, b) => a + b, 0) / Math.max(1, qs.length);
  C.stars = q >= 0.95 ? 5 : q >= 0.85 ? 4 : q >= 0.7 ? 3 : q >= 0.5 ? 2 : 1;
  C.finished = 1;
  ev.push({ k: 'finish', stars: C.stars });
}

export function toggleClaim(C, sid, memberId) {
  const st = C.steps[sid];
  if (!st || st.s === 'done') return false;
  const i = st.claim.indexOf(memberId);
  if (i >= 0) st.claim.splice(i, 1);
  else st.claim.push(memberId);
  return true;
}

export function dropMember(C, x, memberId, K, pos) {
  for (const s of allDefs(C, x)) {
    const st = C.steps[s.id];
    if (!st) continue;
    if (st.s === 'active' && st.by === memberId) closeStep(C, x, s.id, memberId);
    const i = st.claim.indexOf(memberId);
    if (i >= 0) st.claim.splice(i, 1);
  }
  // scraps in their hands go back on the nearest… floor. Gone.
  if (C.carry && C.carry[memberId]) C.carry[memberId] = null;
  // a door they were swinging stays where it is
  for (const s of Object.values(C.fx)) if (s.by === memberId) { s.door = (s.swing || 0) >= 0.5 ? 1 : 0; s.swing = null; s.by = null; }
  // what they held is left on the counter nearest to where they stood
  const held = heldBy(C, memberId);
  if (held.length && K) {
    const d = (f) => (pos ? Math.hypot(f.x + 0.5 - pos.x, f.y + 0.5 - pos.y) : 0);
    const spot = K.fixtures.filter((f) => (f.caps.includes('board') || f.caps.includes('plate')) && !putBlocked(C, x, K, held, f)).sort((a, b) => d(a) - d(b))[0];
    if (spot) putDown(C, x, K, memberId, spot.id);
  }
  for (const k of heldBy(C, memberId)) { const t = thingOf(C, k); t.held = null; if (k[0] === 'i') t.at = storeFx(K || { fixtures: [] }, storeOf(t.kind) || 'shelf'); }
}

// ------------------------------------------------------------------ timers

function waitDur(C, x, K, s) {
  if (typeof s.dur === 'number') return s.dur;
  // a duration per oven kind: {electric: 600, dome: 90}
  const v = C.vessels[s.vessel];
  const f = v && v.at ? fixtureById(K, v.at.fx) : null;
  const bk = bakeKind(f) || 'electric';
  return (s.dur && (s.dur[bk] ?? s.dur.electric ?? Object.values(s.dur)[0])) || 60;
}
export function stepDuration(C, x, K, s) { return waitDur(C, x, K, s); }

function finishWait(C, x, sid) {
  const s = stepDef(x, sid);
  const st = C.steps[sid];
  st.s = 'done';
  const over = Math.max(0, st.over - OVER_GRACE);
  if (s.strict) st.q = Math.max(0.4, 1 - over / 240);
  refresh(C, x);
}

// Advance the kitchen by dt real seconds. Returns events ('ding' when a timer
// runs out). Pots on the heat with water in them come to the boil by themselves.
export function tickCook(C, x, K, dt) {
  const ev = [];
  if (!C.started || C.finished) return ev;
  C.elapsed += dt;
  const sp = C.speed;
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s === 'running') {
      st.t += dt * sp;
      const dur = waitDur(C, x, K, s);
      if (st.t >= dur) {
        st.t = dur;
        st.s = 'ready';
        st.over = 0;
        ev.push({ k: 'ding', sid: s.id });
        applySets(C, s);
        // nothing a cook has to do follows: done at once
        const next = x.steps.filter((o) => o.after.includes(s.id));
        if (!next.length || next.every((o) => o.do === 'wait' || ['done', 'active'].includes(C.steps[o.id].s))) finishWait(C, x, s.id);
        else refresh(C, x);
      }
    } else if (st.s === 'ready') {
      st.over += dt;
      // nobody needs to stop a lenient timer: it just stays ready
    }
  }
  // dishwashers running
  for (const [fx, dw] of Object.entries(C.dw || {})) {
    if (!dw.run) continue;
    dw.t += dt * sp;
    if (dw.t >= DW_DUR) { dwFinish(C, fx, ev); refresh(C, x); }
  }
  // the pots: boiling follows the heat (sped up with the kitchen while timers run)
  const running = x.steps.some((s) => C.steps[s.id].s === 'running');
  const k = dt * (running ? sp : 1);
  for (const v of Object.values(C.vessels)) {
    const want = v.heat > 0 && v.water > 0.05 && !v.lid ? Math.min(1, v.heat / 3 + 0.1) : v.heat > 0 && v.water > 0.05 ? 0.5 : 0;
    if (v.heat > 0 && v.at) v.hot = 1; else if (v.heat === 0) v.hot = 0;
    const rate = v.heat > 0 ? 1 / 60 : 1 / 20;
    if (v.boil < want) v.boil = Math.min(want, v.boil + rate * k);
    else if (v.boil > want) v.boil = Math.max(want, v.boil - rate * k * 2);
    v.boil = Math.round(v.boil * 1000) / 1000;
  }
  return ev;
}

export function setSpeed(C, s) {
  if (SPEEDS.includes(s)) C.speed = s;
}

// Skip a running timer straight to the end.
export function skipWait(C, x, K, sid) {
  const s = stepDef(x, sid);
  const st = C.steps[sid];
  if (!s || !st || st.s !== 'running') return false;
  st.t = waitDur(C, x, K, s) - 0.001;
  // pots that were coming to the boil get there too
  const v = C.vessels[s.vessel];
  if (v && v.heat > 0 && v.water > 0.05) v.boil = Math.max(v.boil, Math.min(1, v.heat / 3 + 0.1));
  return true;
}

// ------------------------------------------------------------------ display

// A copy of items/vessels with the work in progress applied (half-sliced
// tomatoes, water rising while someone fills a pot…).
export function displayState(C, x, K) {
  const D = { items: structuredClone(C.items), vessels: structuredClone(C.vessels) };
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s !== 'active' && !(st.s === 'open' && (st.k > 0 || st.v > 0))) continue;
    const f = fixtureById(K, st.fx);
    const ph = phasesOf(s, bakeKind(f))[st.ph];
    if (ph && ph.prog) ph.prog(D, s, st.k, st.v, ph, st.extra);
  }
  return D;
}

export function stepIcon(s) { const a = ACTIONS[s.do]; return a ? a.icon : '•'; }

// for tests and the recipe book
export function validateRecipe(r) {
  const errs = [];
  const ids = new Set();
  let x;
  try { x = expandRecipe(r, 1); } catch (e) { return [`expand failed: ${e.message}`]; }
  for (const s of r.steps) {
    if (ids.has(s.id)) errs.push(`duplicate step ${s.id}`);
    ids.add(s.id);
  }
  for (const s of r.steps) {
    if (!ACTIONS[s.do]) errs.push(`${s.id}: unknown action ${s.do}`);
    for (const a of s.after || []) if (!ids.has(a)) errs.push(`${s.id}: after unknown ${a}`);
    for (const key of ['item', 'with', 'target']) if (s[key] && !x.ing[s[key]]) errs.push(`${s.id}: unknown ingredient ${s[key]}`);
    for (const id of s.items || []) if (!x.ing[id]) errs.push(`${s.id}: unknown ingredient ${id}`);
    for (const key of ['vessel', 'into', 'from']) if (s[key] && !x.ves[s[key]]) errs.push(`${s.id}: unknown vessel ${s[key]}`);
    if (s.makes && !x.ing[s.makes]) errs.push(`${s.id}: makes unknown ${s.makes}`);
    if (s.do === 'wait' && !s.dur) errs.push(`${s.id}: wait without dur`);
    if (['add', 'pour', 'crack', 'season', 'squeeze'].includes(s.do) && !s.into && !s.target) errs.push(`${s.id}: ${s.do} without into`);
    if (['heat', 'adjust', 'off', 'remove', 'stir', 'whisk', 'saute', 'flip', 'blend', 'mash', 'cover', 'uncover', 'bakeIn', 'bakeOut', 'turn', 'chillIn', 'chillOut', 'fill', 'drain'].includes(s.do) && !s.vessel) errs.push(`${s.id}: ${s.do} without vessel`);
    if (['wash', 'rinse', 'peel', 'skin', 'shell', 'slice', 'dice', 'mince', 'chop', 'slit', 'grate', 'tear', 'crush', 'core', 'separate', 'knead', 'roll', 'stretch', 'shape', 'spread', 'brush', 'top', 'wrap', 'dip', 'stuff'].includes(s.do) && !s.item) errs.push(`${s.id}: ${s.do} without item`);
    if (s.split && !s.n) errs.push(`${s.id}: split without n`);
  }
  for (const [id, i] of Object.entries(x.ing)) if (!INGREDIENTS[i.kind]) errs.push(`ingredient ${id}: unknown kind ${i.kind}`);
  for (const [id, v] of Object.entries(x.ves)) if (!VESSELS[v.kind]) errs.push(`vessel ${id}: unknown kind ${v.kind}`);
  // no cycles
  const state = {};
  const visit = (id) => {
    if (state[id] === 1) { errs.push(`cycle at ${id}`); return; }
    if (state[id] === 2) return;
    state[id] = 1;
    for (const a of (r.steps.find((s) => s.id === id) || {}).after || []) visit(a);
    state[id] = 2;
  };
  for (const s of r.steps) visit(s.id);
  if (!r.steps.some((s) => s.do === 'serve')) errs.push('no serve step');
  return errs;
}

export { FIXTURES };
