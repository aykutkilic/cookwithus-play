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

import { ACTIONS, phasesOf, stepCap, stepTitle, stepVessel, scrapsOf } from './actions.js';
import { INGREDIENTS, VESSELS, ingName } from './ingredients.js';
import { FIXTURES, SIZES, SIZE_ORDER, kitchenCaps, fixtureById, bakeKind } from './kitchens.js';
import { RECIPES } from './recipes.js';

export const SPEEDS = [1, 2, 4, 8, 16];
export const SCRAP_LIMIT = 3; // scraps on a counter before it's too messy to start another job there
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
    items[id] = { kind: i.kind, qty: i.qty, washed: 0, peeled: 0, cut: null, k: 0, n: 0, cook: 0, at: null, in: null, used: 0 };
    if (i.kind === 'dough') items[id].shape = 'rough';
    if (i.form) items[id].form = i.form; // naan is a teardrop, pide a boat
    if (i.boiled) items[id].boiled = 1;
    if (made.has(id)) items[id].hidden = 1;
  }
  const vessels = {};
  for (const [id, v] of Object.entries(x.ves)) {
    vessels[id] = { kind: v.kind, water: 0, liquid: null, contents: [], heat: 0, boil: 0, lid: 0, cook: 0, at: null, items: [] };
  }
  const steps = {};
  for (const s of x.steps) steps[s.id] = { s: 'locked', ph: 0, k: 0, v: 0, by: null, fx: null, slot: 0, t: 0, over: 0, q: 1, claim: [], extra: [], who: [] };
  const C = {
    recipe: r.id, steps, items, vessels, fx: {}, speed: 1,
    started: 0, elapsed: 0, finished: 0, stars: 0, credits: {},
    scraps: {},  // fixture -> {n, kinds}: peel, shells, stems lying on a counter
    bins: {},    // bin fixture -> {fill, bags}
    carry: {},   // cook -> {n, kinds}: scraps in their hands (null when empty)
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

export function choreId(kind, fx) { return `#${kind}@${fx}`; }
export function choreDef(sid) {
  const m = /^#(clear|toss|bag)@([a-zA-Z]+\d+)$/.exec(sid);
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
function choreBlocked(C, K, d, memberId) {
  const f = fixtureById(K, d.fx);
  if (!f) return 'No such place';
  const sc = C.scraps[d.fx];
  const bin = C.bins[d.fx] || { fill: 0 };
  switch (d.do) {
    case 'clear': return sc && sc.n > 0 ? '' : 'Nothing to clear here';
    case 'toss':
      if (!f.caps.includes('bin')) return 'That isn’t a bin';
      if (!carrying(C, memberId)) return 'Your hands are empty';
      return bin.fill >= binHolds(f) ? 'This bin is full – change the bag first' : '';
    case 'bag':
      if (!f.caps.includes('bin')) return 'That isn’t a bin';
      return bin.fill >= binHolds(f) * 0.5 ? '' : 'The bag isn’t full yet';
  }
  return 'Nothing to do';
}

function choreDone(C, K, d, st) {
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
  }
}

// Unlock steps whose prerequisites are done; timers start by themselves (the
// heat was turned on by a cook – waiting is the only thing that isn't a gesture).
export function refresh(C, x) {
  let changed = false;
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s !== 'locked') continue;
    if (!s.after.every((a) => C.steps[a] && C.steps[a].s === 'done' || (C.steps[a] && C.steps[a].s === 'ready' && s.do !== 'wait'))) continue;
    // a step after a timer opens when the timer is ready
    st.s = s.do === 'wait' ? 'running' : 'open';
    st.t = 0;
    changed = true;
  }
  return changed;
}

export function isFinished(C) { return C.finished > 0; }

// ------------------------------------------------------------------ where a step can be done

// Fixtures a step may be done at, and which slot (burner / oven shelf).
export function stepPlaces(C, x, K, s) {
  const a = ACTIONS[s.do];
  if (!a || a.cap === null) return [];
  if (s.chore) return fixtureById(K, s.fx) ? [{ fx: s.fx, slot: 0 }] : [];
  const st = C.steps[s.id];
  if (st.fx && (st.ph > 0 || st.k > 0)) return [{ fx: st.fx, slot: st.slot }]; // started here: finish here
  const cap = stepCap(s, C);
  if (cap && typeof cap === 'object') return [{ fx: cap.at.fx, slot: cap.at.slot }];
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
        if (slotTaken(C, x, f.id, slot, s.id)) continue;
        out.push({ fx: f.id, slot });
        break;
      }
    } else out.push({ fx: f.id, slot: 0 });
  }
  return out;
}

function slotTaken(C, x, fx, slot, exceptSid) {
  for (const v of Object.values(C.vessels)) if (v.at && v.at.fx === fx && v.at.slot === slot) return true;
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
    const why = choreBlocked(C, K, s, memberId);
    if (why) return why;
    if (!C.steps[sid] || C.steps[sid].s === 'done') C.steps[sid] = { s: 'open', ph: 0, k: 0, v: 0, by: null, fx: null, slot: 0, t: 0, over: 0, q: 1, claim: [], extra: [], who: [] };
  }
  const st = C.steps[sid];
  if (!s || !st) return 'No such step';
  if (C.finished && !s.chore) return 'The dish is finished';
  if (!s.chore && carrying(C, memberId)) return 'Your hands are full – take the scraps to a bin first 🗑️';
  if (st.s === 'active' && st.by !== memberId) return 'Someone is already on it';
  if (st.s !== 'open' && st.s !== 'active') return st.s === 'locked' ? 'Not yet – earlier steps first' : 'Nothing to do there';
  if (s.do === 'wait') return 'That one just needs time';
  const places = stepPlaces(C, x, K, s);
  const pl = places.find((p) => p.fx === place.fx) || null;
  if (!pl) return places.length ? 'Not here – try another spot' : 'No free place for that right now';
  const busy = placeBusy(C, x, K, s, pl, memberId);
  if (busy) return busy;
  if (!s.chore && st.ph === 0 && st.k === 0 && C.scraps[pl.fx] && C.scraps[pl.fx].n >= SCRAP_LIMIT) return 'Too messy here – clear the scraps off first 🧹';
  // one step at a time per cook
  for (const o of allDefs(C, x)) if (o.id !== sid && C.steps[o.id] && C.steps[o.id].s === 'active' && C.steps[o.id].by === memberId) closeStep(C, x, o.id, memberId);
  st.s = 'active';
  st.by = memberId;
  st.fx = pl.fx;
  st.slot = pl.slot;
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
export const VALUE_GESTURES = new Set(['pour', 'fill', 'knob', 'paint']);

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
  const vid = stepVessel(s);
  if (vid && C.vessels[vid] && !C.vessels[vid].at && (a.cap === 'board' || a.cap === 'vessel')) C.vessels[vid].at = { fx: st.fx, slot: st.slot };
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
  st.ph++;
  st.k = 0;
  st.v = 0;
  st.extra = [];
  const phases = phasesOf(s, bakeKind(f));
  ev.push({ k: 'phase', sid: s.id });
  if (st.ph < phases.length) return;
  if (s.chore) {
    choreDone(C, K, s, st);
    st.s = 'done';
    credit(C, st.by, 'chores');
    st.by = null;
    ev.push({ k: 'chore', sid: s.id, what: s.do });
    return;
  }
  // step complete
  const sc = scrapsOf(s, C.items);
  if (sc) addScraps(C, st.fx, sc);
  if (a.moves) moveVessel(C, s, st);
  if (s.makes && C.items[s.makes]) {
    const it = C.items[s.makes];
    it.hidden = 0;
    it.at = st.fx;
    const v = C.vessels[s.vessel];
    if (v && !s.keep) { v.contents = []; v.water = 0; v.liquid = null; v.at = null; v.emptied = 1; }
  }
  if (s.places) {
    // things laid on a tray / dish / plate: [{item, x, y}] (x, y in -1..1)
    const v = C.vessels[stepVessel(s)];
    if (v) for (const p of s.places) { const it = C.items[p.item]; if (it) { v.items.push({ id: p.item, x: p.x, y: p.y }); it.used = 1; it.at = null; } }
  }
  if (s.makes2) for (const id of s.makes2) if (C.items[id]) { C.items[id].hidden = 0; C.items[id].at = st.fx; }
  applySets(C, s);
  st.s = 'done';
  if (!st.who.includes(st.by)) st.who.push(st.by);
  credit(C, st.by, 'steps');
  st.by = null;
  ev.push({ k: 'step', sid: s.id });
  if (s.do === 'serve' || x.steps.every((o) => C.steps[o.id].s === 'done')) finish(C, x, ev);
  refresh(C, x);
}

function moveVessel(C, s, st) {
  const vid = stepVessel(s);
  if (vid && C.vessels[vid]) C.vessels[vid].at = { fx: st.fx, slot: st.slot };
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
  for (const s of x.steps) { const st = C.steps[s.id]; if (st.s !== 'done') { st.s = 'done'; } }
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

export function dropMember(C, x, memberId) {
  for (const s of allDefs(C, x)) {
    const st = C.steps[s.id];
    if (!st) continue;
    if (st.s === 'active' && st.by === memberId) closeStep(C, x, s.id, memberId);
    const i = st.claim.indexOf(memberId);
    if (i >= 0) st.claim.splice(i, 1);
  }
  // whatever they were carrying goes back on the nearest… floor. Gone.
  if (C.carry && C.carry[memberId]) C.carry[memberId] = null;
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
        if (!next.length || next.every((o) => o.do === 'wait')) finishWait(C, x, s.id);
        else refresh(C, x);
      }
    } else if (st.s === 'ready') {
      st.over += dt;
      // nobody needs to stop a lenient timer: it just stays ready
    }
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
