// Cooking actions. A recipe step names an action (`do`) and its parameters;
// the action expands into PHASES – the hand gestures the cook performs, one
// after the other – and says where it happens and what each phase changes.
// Nothing cooks itself: every slice, stir, pour and knob turn is a gesture.
//
// Gesture kinds (`g`), recognised in client/station.js:
//   tap     – tap a hotspot (the tap lever, the bell, the bin pedal)  {hot}
//   door    – take the handle and swing the door open / shut          {hot: 'fridge'|'pantry'|'oven', to: 1|0}
//   drag    – drag a thing onto a target                              {obj, to}
//   strokes – back-and-forth strokes (scrub, knead, roll, grate…)     {n, axis: 'h'|'v'}
//   circle  – circular motions (stir, whisk, swirl)                   {n}
//   chop    – knife down through the food and back up, per cut       {n, cut, mode: 'slice'|'mince'}
//   peel    – press at the top of the item, pull down along it        {n}
//   knob    – turn a dial to a setting                                {to}
//   pour    – hold to pour, let go inside the marked band            {band}
//   fill    – hold the tap lever, let go inside the marked band      {band}
//   paint   – brush/ladle over the surface until it's covered        {cover}
//   place   – tap spots to put pieces down                            {n}
//   flick   – a quick upward flick of the pan                         {n}
//   crack   – knock the egg on the rim, pull the shell apart          {n}
//   wrap    – spoon filling onto a leaf, fold the sides, roll it up   {n}
//   scoop   – ladle from the pot onto each plate / into each item     {n}
//   dip     – dunk into the pot, hold, lift out                       {n}
// Value gestures (pour, fill, knob, paint, door) send their value v; counters send k.
//
// Location (`cap`): board | sink | hob | bake | tandoor | plate | chill, or
// 'vessel' (wherever the step's vessel currently is). `moves` puts the step's
// vessel at the fixture where the step is done.

import { INGREDIENTS, boxable } from './ingredients.js';

const LIQUID_TINT = {
  water: null, broth: '#e3b860', milk: '#fbf7ee', cream: '#fbf3e0', passata: '#c8321e', redWine: '#7a1a2e',
  whiteWine: '#f2e6a0', oliveOil: '#d8d24a', oil: '#f6d84a', espresso: '#3a1e12', vinegar: '#c06a3a',
};
export function tintOf(kind) {
  if (kind in LIQUID_TINT) return LIQUID_TINT[kind];
  const i = INGREDIENTS[kind];
  return i ? i.art.c1 : null;
}

// --------------------------------------------------------------- helpers for effects
const item = (S, step) => S.items[step.item];
const ves = (S, id) => S.vessels[id];
function addContent(v, kind, cut) {
  if (!v) return;
  if (!v.contents.some((c) => c.kind === kind)) v.contents.push({ kind, cut: cut || null });
}
function useItem(S, id, into) {
  const it = S.items[id];
  if (!it) return;
  const prev = it.in && S.vessels[it.in];
  if (prev && prev !== S.vessels[into]) prev.contents = prev.contents.filter((c) => c.kind !== it.kind);
  it.in = into; it.at = null; it.held = null; it.used = 1;
  const v = S.vessels[into];
  if (v) addContent(v, it.kind, it.cut);
}

// A step's vessel ids: the one it acts on and the one things go into.
export function stepVessel(step) { return step.vessel || step.into || null; }

// Work that takes both hands (a knife and the hand steadying the food, dough,
// cracking an egg …); anything else you can do with one hand while the other
// holds something.
const BOTH_HANDS = new Set(['crack', 'stuff', 'squeeze']);
export function stepHands(step) {
  const a = ACTIONS[step.do];
  return a && (a.cap === 'board' || BOTH_HANDS.has(step.do)) ? 2 : 1;
}

// Loose food lives in its food container (boxable): a board job on it starts by
// taking it out onto the board and ends by putting it back – cut up, gathered up
// in both hands – where it stands beside the board. The board's own tools – its
// knife, peeler and grater – lie on it: the one a job needs is picked up off the
// board before the work with it and put back down on it after (held meanwhile –
// `held` – while the other hand does something in between).
export const BOARD_TOOLS = ['knife', 'peeler', 'grater'];
const takeOut = () => ({ g: 'drag', obj: 'fromBox', to: 'board', tool: 'hand', hint: 'Take it out of its container, onto the board',
  prog: (D, st) => { const it = item(D, st); if (it && it.out == null) it.out = 0; }, eff: (S, st) => { const it = item(S, st); if (it) it.out = 1; } });
// (still with the rest of its bunch: into an empty container from the stack by the board – the
// bunch's own container, with what's left, stays there to go back in the fridge / pantry)
const boxUp = (cut, pile = false) => ({ g: 'drag', obj: 'pieces', to: 'box', tool: 'hand', pile, hint: cut ? 'Gather it up in your hands and put it in its container' : 'Put them back in their container',
  eff: (S, st) => { const it = item(S, st); if (it) { splitRest(S, st.item); delete it.out; delete it.aside; delete it.pile; } } });
const pickTool = (t) => ({ g: 'tap', hot: 'pick', takes: t, tool: 'hand', hint: `Pick up the ${t}` });
const putTool = (t) => ({ g: 'tap', hot: 'rest', takes: t, tool: t, hint: `Put the ${t} down on the board` });
// Several of a thing are worked one at a time: one taken out onto the board, worked
// (its share of the cuts, strokes …), and moved to the side of the board – pushed
// there with the knife – where a pile builds up; then the next. it.out: how many
// have been taken out, it.aside: how many are on the pile (it.pile: as what).
const takeOne = (u, q) => ({ g: 'drag', obj: 'fromBox', to: 'board', tool: 'hand', unit: u, hint: `Take one out of its container, onto the board (${u + 1} of ${q})`,
  prog: (D, st) => { const it = item(D, st); if (it && it.out == null) it.out = u; }, // (the first: from its start, one at a time)
  eff: (S, st) => { const it = item(S, st); if (it) it.out = u + 1; } });
const toSide = (u, tool) => ({ g: 'drag', obj: 'unit', to: 'pile', tool, unit: u, hint: tool === 'knife' ? 'Push it to the side of the board with the knife' : 'Move it to the side of the board',
  eff: (S, st) => { const it = item(S, st); if (it) { it.aside = u + 1; it.pile = it.cut || null; } } });
// a gesture's share for one of q (its count split among them; what it does to the thing told as of all of them)
function shareOf(p, u, q) {
  if (!p.n || (p.g === 'circle' && p.n < 1)) return { ...p };
  const b = (j) => Math.round((j * p.n) / q), before = b(u), mine = Math.max(1, b(u + 1) - before), all = { n: p.n };
  return {
    ...p, n: mine,
    prog: p.prog && ((D, st, k, v, ph) => p.prog(D, st, before + k, v, { ...ph, ...all })),
    eff: p.eff && ((S, st, v, fx, ph, extra) => {
      p.eff(S, st, v, fx, { ...ph, ...all }, extra);
      const it = item(S, st);
      if (it && before + mine < p.n) { if (it.k === p.n) it.k = before + mine; if (it.peeled === 1) it.peeled = (before + mine) / p.n; }
    }),
  };
}
function onBoard(s, phases, cut = false) {
  const boxed = !(s.itemKind && !boxable(s.itemKind));
  const q = boxed ? Math.max(1, Math.min(8, s.itemQty || 1)) : 1;
  const t = BOARD_TOOLS.find((x) => phases.some((p) => p.tool === x));
  let out;
  if (q === 1) out = [...(boxed ? [takeOut()] : []), ...phases];
  else {
    out = [];
    for (let u = 0; u < q; u++) out.push(takeOne(u, q), ...phases.map((p) => shareOf(p, u, q)), toSide(u, t === 'knife' ? 'knife' : 'hand'));
  }
  // the board's tool: picked up for its first use, put down after its last, held in between
  if (t) {
    const k0 = out.findIndex((p) => p.tool === t);
    let k1 = out.length - 1;
    while (out[k1].tool !== t) k1--;
    out = [...out.slice(0, k0), pickTool(t), ...out.slice(k0, k1 + 1).map((p) => (p.tool === t ? p : { ...p, held: t })), putTool(t), ...out.slice(k1 + 1)];
  }
  return boxed ? [...out, boxUp(cut, q > 1)] : out;
}
// A bunch has more than the recipe takes (it.extra, in the same container): once what's
// needed has its own container, what's left stays in the bunch's one – a leftover of its
// own (`${id}~rest`) where it is, which goes back in the fridge / pantry.
export function splitRest(S, id) {
  const it = S.items[id];
  if (!it || !(it.extra > 0)) return null;
  const rid = `${id}~rest`, r = S.items[rid];
  // (cap: what the container was filled with – it's the same container, as big as before)
  if (r) { r.qty += it.extra; r.cap = Math.max(r.cap || 0, it.qty + it.extra); }
  else S.items[rid] = { kind: it.kind, qty: it.extra, cap: it.qty + it.extra, rest: id, washed: it.washed || 0, peeled: 0, cut: null, k: 0, n: 0, cook: 0, at: it.at, in: null, held: null, used: 0 };
  it.extra = 0;
  return rid;
}
// Where the parts of a thing worked several at a time are just now (null: it isn't): the
// one being worked on (its own state – its share of the cuts), what's on the pile at the
// side of the board, how many are still in the container.
export function boardUnits(it) {
  const q = Math.max(1, (it && it.qty) || 1), extra = (it && it.extra) || 0;
  if (!it || (q < 2 && !extra) || it.out == null) return null;
  const out = it.out, aside = Math.min(it.aside || 0, out);
  const one = { ...it, qty: 1, extra: 0 };
  delete one.out; delete one.aside; delete one.pile;
  let cur = null;
  if (out > aside) {
    cur = { ...one };
    const n = it.n || 0, b = (j) => Math.round((j * n) / q);
    if (it.cut && n) { cur.n = Math.max(1, b(aside + 1) - b(aside)); cur.k = Math.max(0, Math.min(cur.n, (it.k || 0) - b(aside))); }
    if (it.peeled) cur.peeled = Math.max(0, Math.min(1, it.peeled * q - aside));
  }
  const cutAs = it.pile || it.cut;
  const pile = aside < 1 ? null : cutAs ? { ...one, cut: cutAs, k: it.n || 1, n: it.n || 1, bits: aside / q, spread: 0.03 } : { ...one, qty: aside, cut: null, peeled: it.peeled ? 1 : 0 };
  return { cur, pile, left: q + extra - out, aside, q };
}

// a door, by its handle: v is how far open it is (0 shut … 1 wide open)
const doorPh = (hot, to, hint) => ({ g: 'door', hot, to, hint, eff: (S, st, v, fx) => { fx.door = to; } });

// --------------------------------------------------------------- the actions
// Each: { cap, moves?, verb, tool, icon, phases(step, bk) → [phase] }
// Phase: { g, …params, hint, eff?(S, step, v, fx), prog?(D, step, k, v) }
//   eff(S, step, v, fx, phase, extra)  – applied by the host when the phase completes
//                                         (v = the gesture's value, fx = the fixture's state,
//                                          extra = positions of placed pieces)
//   prog(D, step, k, v, phase, extra)   – applied to a display copy while the phase is
//                                         in progress (k = count so far)

export const ACTIONS = {
  // ------------------------------------------------------------- sink
  // (in its container, in the basin: the tap fills it, you scrub it in the water, and tip the water out)
  wash: {
    cap: 'sink', verb: 'Wash', tool: 'hand', icon: '💧',
    phases: (s) => [
      { g: 'tap', hot: 'faucet', hint: 'Turn on the tap – fill its container', eff: (S, st, v, fx) => { fx.tap = 1; } },
      { g: 'strokes', axis: 'h', n: s.n || 5, tool: 'hand', hint: 'Scrub it in the water', prog: (D, st, k) => { if (k > 0) item(D, st).washed = 1; }, eff: (S, st) => { item(S, st).washed = 1; } },
      { g: 'tap', hot: 'faucet', hint: 'Turn off the tap', eff: (S, st, v, fx) => { fx.tap = 0; } },
      { g: 'pour', band: [0.9, 1.01], drain: true, box: true, hint: 'Hold to tip the water out of the container' },
    ],
  },
  rinse: {
    cap: 'sink', verb: 'Rinse', tool: 'hand', icon: '💧',
    phases: (s) => [
      { g: 'tap', hot: 'faucet', hint: 'Turn on the tap', eff: (S, st, v, fx) => { fx.tap = 1; } },
      { g: 'circle', n: s.n || 3, tool: 'hand', hint: 'Swirl the grains in the sieve', prog: (D, st, k) => { if (k > 0) item(D, st).washed = 1; }, eff: (S, st) => { item(S, st).washed = 1; } },
      { g: 'tap', hot: 'faucet', hint: 'Turn off the tap', eff: (S, st, v, fx) => { fx.tap = 0; } },
    ],
  },
  fill: {
    cap: 'sink', moves: true, verb: 'Fill', tool: 'hand', icon: '🚰',
    phases: (s) => [
      { g: 'drag', obj: 'vessel', to: 'underTap', hint: 'Put it under the tap' },
      { g: 'fill', band: s.band || [0.55, 0.8], hint: 'Hold the tap lever – let go at the line',
        prog: (D, st, k, v) => { ves(D, st.vessel).water = v || 0; },
        eff: (S, st, v) => { const p = ves(S, st.vessel); p.water = v; if (!p.liquid) p.liquid = null; addContent(p, 'water'); } },
    ],
  },
  drain: {
    cap: 'sink', moves: true, verb: 'Drain', tool: 'grab', icon: '🫗',
    phases: () => [
      { g: 'drag', obj: 'vessel', to: 'colander', hint: 'Bring it over the colander' },
      { g: 'pour', band: [0.9, 1.01], drain: true, hint: 'Hold to tip it out – drain it all',
        prog: (D, st, k, v) => { const p = ves(D, st.vessel); p.water = Math.max(0, (p.water || 0) * (1 - (v || 0))); },
        eff: (S, st) => { const p = ves(S, st.vessel); p.water = 0; p.heat = 0; p.boil = 0; p.contents = p.contents.filter((c) => c.kind !== 'water'); } },
    ],
  },

  // ------------------------------------------------------------- board: knife work
  peel: {
    cap: 'board', verb: 'Peel', tool: 'peeler', icon: '🥔',
    phases: (s) => onBoard(s, [
      // (in stripes – an eggplant for imam bayıldı: a strip of skin left between each strip taken off)
      { g: 'peel', n: s.n || 6, tool: 'peeler', hint: 'Pull the peeler down along it',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { peeled: k / ph.n }, s.stripes ? { peelStripes: 1 } : {}); },
        eff: (S, st) => { Object.assign(item(S, st), { peeled: 1 }, s.stripes ? { peelStripes: 1 } : {}); } },
    ]),
  },
  skin: {
    cap: 'board', verb: 'Peel', tool: 'hand', icon: '🧅',
    phases: (s) => onBoard(s, [
      { g: 'peel', n: s.n || 3, tool: 'hand', hint: 'Pull the papery skin off',
        prog: (D, st, k, v, ph) => { item(D, st).peeled = k / ph.n; }, eff: (S, st) => { item(S, st).peeled = 1; } },
    ]),
  },
  shell: {
    cap: 'board', verb: 'Shell', tool: 'hand', icon: '🥚',
    phases: (s) => onBoard(s, [
      { g: 'peel', n: s.n || 4, tool: 'hand', hint: 'Crack and pull the shell off',
        prog: (D, st, k, v, ph) => { item(D, st).peeled = k / ph.n; }, eff: (S, st) => { item(S, st).peeled = 1; } },
    ]),
  },
  slice: {
    cap: 'board', verb: 'Slice', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'chop', mode: 'slice', n: s.n || 6, cut: s.cut || 'slices', tool: 'knife', hint: 'Knife down through it, then back up – one per slice',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: ph.cut, k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: ph.cut, k: ph.n, n: ph.n }); } },
    ], true),
  },
  dice: {
    cap: 'board', verb: 'Dice', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'chop', mode: 'slice', n: s.n || 4, cut: 'strips', tool: 'knife', hint: 'Cut it into strips – down and up for each cut',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'strips', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'strips', k: ph.n, n: ph.n }); } },
      { g: 'circle', n: 0.25, tool: 'hand', turn: true, hint: 'Turn the strips a quarter round' },
      { g: 'chop', mode: 'slice', n: s.n || 4, cut: 'dice', tool: 'knife', hint: 'Now cut across into little cubes',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: k > 0 ? 'dice' : 'strips', k: k > 0 ? k : ph.n, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'dice', k: ph.n, n: ph.n }); } },
    ], true),
  },
  mince: {
    cap: 'board', verb: 'Mince', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'chop', mode: 'mince', n: s.n || 10, cut: 'mince', tool: 'knife', hint: 'Quick little chops all over it',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'mince', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'mince', k: ph.n, n: ph.n }); } },
    ], true),
  },
  chop: {
    cap: 'board', verb: 'Chop', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'chop', mode: 'slice', n: s.n || 5, cut: s.cut || 'chunks', tool: 'knife', hint: 'Knife down and up – one per cut',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: ph.cut, k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: ph.cut, k: ph.n, n: ph.n }); } },
    ], true),
  },
  slit: {
    cap: 'board', verb: 'Slit', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'strokes', axis: 'h', n: s.n || 2, tool: 'knife', once: true, hint: 'Draw the knife along it to open a pocket',
        prog: (D, st, k) => { if (k > 0) Object.assign(item(D, st), { cut: 'slit' }); },
        eff: (S, st) => { Object.assign(item(S, st), { cut: 'slit' }); } },
    ]),
  },
  grate: {
    cap: 'board', verb: 'Grate', tool: 'grater', icon: '🧀',
    phases: (s) => onBoard(s, [
      { g: 'strokes', axis: 'v', n: s.n || 8, tool: 'grater', hint: 'Rub it up and down the grater',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'grated', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'grated', k: ph.n, n: ph.n }); } },
    ], true),
  },
  tear: {
    cap: 'board', verb: 'Tear', tool: 'hand', icon: '🤌',
    phases: (s) => onBoard(s, [
      { g: 'strokes', axis: 'h', n: s.n || 4, tool: 'grab', hint: 'Pull it apart into pieces',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'torn', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'torn', k: ph.n, n: ph.n }); } },
    ], true),
  },
  crush: {
    cap: 'board', verb: 'Crush', tool: 'hand', icon: '👊',
    phases: (s) => onBoard(s, [
      { g: 'chop', mode: 'mince', n: s.n || 3, cut: 'crushed', tool: 'knife', flat: true, hint: 'Press down hard with the flat of the knife',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'crushed', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'crushed', k: ph.n, n: ph.n }); } },
    ], true),
  },
  core: {
    cap: 'board', verb: 'Core', tool: 'knife', icon: '🔪',
    phases: (s) => onBoard(s, [
      { g: 'circle', n: 1, tool: 'knife', hint: 'Cut round the core with the knife tip', eff: (S, st) => { item(S, st).cored = 1; } },
    ]),
  },
  separate: {
    cap: 'board', verb: 'Separate', tool: 'hand', icon: '🥬',
    phases: (s) => onBoard(s, [
      { g: 'peel', n: s.n || 6, tool: 'hand', hint: 'Peel the leaves off one by one',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { cut: 'leaves', k, n: ph.n }); },
        eff: (S, st, v, fx, ph) => { Object.assign(item(S, st), { cut: 'leaves', k: ph.n, n: ph.n }); } },
    ], true),
  },

  // ------------------------------------------------------------- board: dough & hands
  knead: {
    cap: 'board', verb: 'Knead', tool: 'hand', icon: '👐',
    phases: (s) => [
      { g: 'strokes', axis: 'v', n: s.n || 10, tool: 'hand', hint: 'Push it away, fold it back – keep going',
        prog: (D, st, k, v, ph) => { if (k > ph.n / 2) item(D, st).shape = 'ball'; }, eff: (S, st) => { item(S, st).shape = 'ball'; } },
    ],
  },
  roll: {
    cap: 'board', verb: 'Roll out', tool: 'rollingPin', icon: '🫓',
    phases: (s) => [
      { g: 'strokes', axis: 'v', n: s.n || 6, tool: 'rollingPin', hint: 'Roll it back and forth',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { shape: 'flat', size: 0.3 + 0.7 * k / ph.n }); },
        eff: (S, st) => { Object.assign(item(S, st), { shape: 'flat', size: 1 }); } },
    ],
  },
  stretch: {
    cap: 'board', verb: 'Stretch', tool: 'hand', icon: '🫓',
    phases: (s) => [
      { g: 'strokes', axis: 'h', n: s.n || 6, tool: 'hand', hint: 'Press and stretch it out from the middle',
        prog: (D, st, k, v, ph) => { Object.assign(item(D, st), { shape: 'flat', size: 0.3 + 0.7 * k / ph.n }); },
        eff: (S, st) => { Object.assign(item(S, st), { shape: 'flat', size: 1 }); } },
    ],
  },
  shape: {
    cap: 'board', verb: 'Shape', tool: 'hand', icon: '🤲',
    phases: (s) => [
      { g: 'circle', n: s.n || 4, tool: 'hand', hint: 'Roll each one round between your palms',
        prog: (D, st, k) => { item(D, st).balls = Math.floor(k); }, eff: (S, st, v, fx, ph) => { item(S, st).balls = (item(S, st).balls || 0) + Math.round(ph.n); item(S, st).shape = 'ball'; } },
    ],
  },
  spread: {
    cap: 'board', verb: 'Spread', tool: 'spoon', icon: '🥄',
    phases: (s) => [
      { g: 'paint', cover: s.cover || 0.8, tool: s.tool || 'spoon', color: tintOf(s.with), hint: 'Spread it all over in circles',
        prog: (D, st, k, v) => { Object.assign(item(D, st), { sauce: tintOf(st.with), coverage: v || 0 }); },
        eff: (S, st, v) => { Object.assign(item(S, st), { sauce: tintOf(st.with), coverage: 1 }); useItem(S, st.with, null); } },
    ],
  },
  brush: {
    cap: 'board', verb: 'Brush', tool: 'brush', icon: '🖌️',
    phases: (s) => [
      { g: 'paint', cover: s.cover || 0.7, tool: s.tool || 'brush', color: tintOf(s.with), alpha: 0.45, hint: s.tool === 'grab' ? 'Rub it all over' : 'Brush it all over',
        eff: (S, st) => { item(S, st).brushed = 1; } },
    ],
  },
  top: {
    cap: 'board', verb: 'Top', tool: 'hand', icon: '🍕',
    phases: (s) => [
      { g: 'place', n: s.n || 6, piece: s.with, tool: 'grab', hint: 'Tap to put the pieces on',
        prog: (D, st, k, v, ph, extra) => { const it = item(D, st); it.toppings = [...(it.toppings || []), ...(extra || [])]; },
        eff: (S, st, v, fx, ph, extra) => { const it = item(S, st); it.toppings = [...(it.toppings || []), ...(extra || [])]; useItem(S, st.with, null); } },
    ],
  },
  wrap: {
    cap: 'board', verb: 'Roll', tool: 'hand', icon: '🌯',
    phases: (s) => [
      { g: 'wrap', n: s.n || 6, tool: 'hand', hint: 'Spoon the filling on, fold in the sides, roll it up',
        prog: (D, st, k) => { const it = item(D, st); it.rolls = (it.rolls || 0) + k; },
        eff: (S, st, v, fx, ph) => { const it = item(S, st); it.rolls = (it.rolls || 0) + ph.n; it.cut = 'rolls'; } },
    ],
  },
  crack: {
    cap: 'vessel', verb: 'Crack', tool: 'hand', icon: '🥚',
    phases: (s) => [
      { g: 'crack', n: s.n || 2, tool: 'hand', hint: 'Knock the egg on the rim, then pull the shell apart',
        prog: (D, st, k) => { if (k > 0) addContent(ves(D, st.into), 'egg', 'cracked'); },
        eff: (S, st) => { const it = S.items[st.item]; if (it) it.cracked = 1; useItem(S, st.item, st.into); } },
    ],
  },
  stuff: {
    cap: 'vessel', verb: 'Stuff', tool: 'spoon', icon: '🥄',
    phases: (s) => [
      { g: 'scoop', n: s.n || 4, tool: 'spoon', target: 'item', hint: 'Spoon the filling into each one',
        prog: (D, st, k) => { item(D, st).stuffed = k; }, eff: (S, st, v, fx, ph) => { item(S, st).stuffed = ph.n; const f = S.vessels[st.from]; if (f) f.emptied = 1; } },
    ],
  },
  squeeze: {
    cap: 'vessel', verb: 'Squeeze', tool: 'grab', icon: '🍋',
    phases: (s) => [
      { g: 'strokes', axis: 'v', n: s.n || 4, tool: 'grab', hint: 'Squeeze it hard over the pot',
        eff: (S, st) => { useItem(S, st.item, st.into); } },
    ],
  },

  // ------------------------------------------------------------- bowls, pots & pans
  // Food out of a food container is brought over the pot in it and tipped in – it's
  // tipped further the longer you hold, and slides out – and the empty container is set
  // down by the stove (fx.empties: they stand there nested in each other); what comes
  // in its own pack is just dropped in.
  add: {
    cap: 'vessel', verb: 'Add', tool: 'grab', icon: '🫳',
    phases: (s) => (s.items || [s.item]).flatMap((id) => {
      const kind = (s.itemKinds && s.itemKinds[id]) || (id === s.item ? s.itemKind : null);
      const into = (S, st) => useItem(S, id, st.into || st.vessel);
      if (kind && !boxable(kind)) return [{ g: 'drag', obj: `item:${id}`, to: 'vessel', hint: 'Drag it into the {into}', eff: into }];
      return [
        { g: 'drag', obj: `item:${id}`, to: 'overVessel', tip: id, hint: 'Bring its container over the {into}' },
        { g: 'pour', tip: id, band: [0.85, 1.21], hint: 'Hold to tip it into the {into}',
          prog: (D, st, k, v) => { if (v > 0.55) useItem(D, id, st.into || st.vessel); },
          eff: (S, st, v, fx) => { into(S, st); fx.empties = [...(fx.empties || []), id]; } },
      ];
    }),
  },
  pour: {
    cap: 'vessel', verb: 'Pour', tool: 'grab', icon: '🫗',
    // item: a liquid ingredient, or from: another vessel; adds = how much the
    // pot's level rises for a full pour (0 for a splash of oil)
    phases: (s) => [
      { g: 'pour', band: s.band || [0.45, 0.75], src: s.item, from: s.from, hint: 'Hold to pour – stop inside the band',
        prog: (D, st, k, v) => { const p = ves(D, st.into); const a = st.adds ?? 0.6; if (a) p.water = Math.min(1, (p.water || 0) + (v || 0) * a); },
        eff: (S, st, v) => {
          const p = ves(S, st.into);
          const a = st.adds ?? 0.6;
          if (a) p.water = Math.min(1, (p.water || 0) + v * a);
          if (st.item) { const t = tintOf(st.item); if (t && st.tint !== false) p.liquid = t; useItem(S, st.item, st.into); }
          if (st.from) {
            const f = S.vessels[st.from];
            if (f) {
              for (const c of f.contents) addContent(p, c.kind, c.cut);
              if (f.liquid) p.liquid = f.liquid;
              for (const it of Object.values(S.items)) if (it.in === st.from && !st.keep) it.in = st.into;
              if (!st.keep) { f.water = 0; f.contents = []; f.emptied = 1; } // the empty pot stays where it is
            }
          }
        } },
    ],
  },
  season: {
    cap: 'vessel', verb: 'Season with', tool: 'shaker', icon: '🧂',
    phases: (s) => [
      { g: 'strokes', axis: 'v', n: s.n || 3, tool: 'shaker', shaker: s.item, hint: 'Shake it over',
        eff: (S, st) => { const v = S.vessels[st.into]; if (v) addContent(v, st.item); else if (S.items[st.target]) S.items[st.target].seasoned = 1; const it = S.items[st.item]; if (it && it.staple) it.used = 1; } },
    ],
  },
  stir: {
    cap: 'vessel', verb: 'Stir', tool: 'spoon', icon: '🥄',
    phases: (s) => [
      { g: 'circle', n: s.n || 4, tool: s.tool || 'spoon', hint: 'Stir round and round',
        eff: (S, st) => { const v = ves(S, st.vessel); v.stirred = (v.stirred || 0) + 1; if (v.heat > 0) v.cook = Math.min(1, (v.cook || 0) + 0.3); } },
    ],
  },
  whisk: {
    cap: 'vessel', verb: 'Whisk', tool: 'whisk', icon: '🥣',
    phases: (s) => [
      { g: 'circle', n: s.n || 6, tool: 'whisk', fast: true, hint: 'Whisk fast in circles', eff: (S, st) => { ves(S, st.vessel).mixed = 1; } },
    ],
  },
  saute: {
    cap: 'vessel', verb: 'Sauté', tool: 'spatula', icon: '🍳',
    phases: (s) => [
      { g: 'circle', n: s.n || 5, tool: 'spatula', hint: 'Keep it moving round the pan',
        prog: (D, st, k, v, ph) => { const p = ves(D, st.vessel); p.cook = Math.max(p.cook || 0, Math.min(1, (st.to || 0.6) * k / ph.n)); },
        eff: (S, st) => { const p = ves(S, st.vessel); p.cook = Math.max(p.cook || 0, st.to || 0.6); } },
    ],
  },
  flip: {
    cap: 'vessel', verb: 'Flip', tool: 'grab', icon: '🍳',
    phases: (s) => [
      { g: 'flick', n: s.n || 1, hint: 'Flick the pan up to flip it', eff: (S, st) => { const p = ves(S, st.vessel); p.flipped = (p.flipped || 0) + 1; } },
    ],
  },
  blend: {
    cap: 'vessel', verb: 'Blend', tool: 'blenderStick', icon: '🌀',
    phases: (s) => [
      { g: 'circle', n: s.n || 5, tool: 'blenderStick', fast: true, hint: 'Blend it smooth in circles', eff: (S, st) => { ves(S, st.vessel).smooth = 1; } },
    ],
  },
  mash: {
    cap: 'vessel', verb: 'Mash', tool: 'masher', icon: '🥔',
    phases: (s) => [
      { g: 'strokes', axis: 'v', n: s.n || 8, tool: 'masher', hint: 'Press down, lift, press again', eff: (S, st) => { ves(S, st.vessel).smooth = 1; } },
    ],
  },
  dip: {
    cap: 'vessel', verb: 'Blanch', tool: 'tongs', icon: '🫕',
    phases: (s) => [
      { g: 'dip', n: s.n || 4, tool: 'tongs', hold: s.hold || 1.6, hint: 'Dunk it in, hold it there, lift it out',
        prog: (D, st, k) => { const it = item(D, st); it.soft = k; }, eff: (S, st) => { const it = item(S, st); it.soft = 1; it.cook = 0.3; } },
    ],
  },
  cover: {
    cap: 'vessel', verb: 'Cover', tool: 'grab', icon: '🫕',
    phases: (s) => [
      { g: 'drag', obj: s.towel ? 'towelLid' : 'lid', to: 'vessel', hint: s.towel ? 'Lay the towel over and put the lid on' : 'Put the lid on',
        eff: (S, st) => { const v = ves(S, st.vessel); v.lid = 1; if (st.towel) v.towel = 1; } },
    ],
  },
  uncover: {
    cap: 'vessel', verb: 'Uncover', tool: 'grab', icon: '🫕',
    phases: () => [
      { g: 'drag', obj: 'lidOff', to: 'aside', hint: 'Lift the lid off', eff: (S, st) => { const v = ves(S, st.vessel); v.lid = 0; v.towel = 0; } },
    ],
  },

  // ------------------------------------------------------------- heat
  heat: {
    cap: 'hob', moves: true, verb: 'Heat', tool: 'hand', icon: '🔥',
    phases: (s) => [
      { g: 'drag', obj: 'vessel', to: 'burner', hint: 'Put it on the burner', eff: (S, st) => { ves(S, st.vessel).onHob = 1; } },
      { g: 'knob', to: s.level ?? 3, hint: `Turn the knob to ${HEAT_NAMES[s.level ?? 3]}`, eff: (S, st) => { ves(S, st.vessel).heat = st.level ?? 3; } },
    ],
  },
  adjust: {
    cap: 'vessel', verb: 'Turn the heat', tool: 'hand', icon: '🔥',
    phases: (s) => [{ g: 'knob', to: s.level ?? 1, hint: `Turn the knob to ${HEAT_NAMES[s.level ?? 1]}`, eff: (S, st) => { ves(S, st.vessel).heat = st.level ?? 1; } }],
  },
  off: {
    cap: 'vessel', verb: 'Turn off', tool: 'hand', icon: '⭕',
    phases: () => [{ g: 'knob', to: 0, hint: 'Turn the knob to off', eff: (S, st) => { const v = ves(S, st.vessel); v.heat = 0; } }],
  },
  remove: {
    cap: 'vessel', verb: 'Take off the heat', tool: 'grab', icon: '🧤',
    phases: () => [
      { g: 'knob', to: 0, hint: 'Turn the knob to off', eff: (S, st) => { ves(S, st.vessel).heat = 0; } },
      { g: 'drag', obj: 'vessel', to: 'aside', hint: 'Lift it off the burner', eff: (S, st) => { const p = ves(S, st.vessel); p.at = null; p.onHob = 0; p.heat = 0; } },
    ],
  },

  // ------------------------------------------------------------- ovens
  bakeIn: {
    cap: 'bake', moves: true, verb: 'Put in the oven', tool: 'grab', icon: '♨️',
    phases: (s, bk) => {
      if (bk === 'dome') return [{ g: 'drag', obj: 'vessel', to: 'ovenMouth', tool: 'pizzaPeel', hint: 'Slide it into the fire', eff: (S, st) => { ves(S, st.vessel).heat = 3; } }];
      if (bk === 'tandoor') return [{ g: 'drag', obj: 'vessel', to: 'tandoorWall', hint: 'Slap it onto the hot clay wall', eff: (S, st) => { ves(S, st.vessel).heat = 3; } }];
      return [
        doorPh('oven', 1, 'Take the handle and pull the oven door down'),
        { g: 'drag', obj: 'vessel', to: 'ovenRack', hint: 'Slide it onto the rack' },
        doorPh('oven', 0, 'Lift the door shut by its handle'),
        { g: 'knob', to: s.level ?? 3, hint: 'Set the temperature', eff: (S, st) => { ves(S, st.vessel).heat = st.level ?? 3; } },
      ];
    },
  },
  bakeOut: {
    cap: 'vessel', verb: 'Take out of the oven', tool: 'grab', icon: '🧤',
    phases: (s, bk) => {
      const out = (S, st) => {
        const p = ves(S, st.vessel); p.at = null; p.heat = 0; p.cook = 1;
        for (const i of p.items || []) if (S.items[i.id]) S.items[i.id].cook = 1;
        for (const it of Object.values(S.items)) if (it.in === st.vessel) it.cook = 1;
      };
      if (bk === 'dome') return [{ g: 'drag', obj: 'vessel', to: 'aside', tool: 'pizzaPeel', hint: 'Pull it out with the peel', eff: out }];
      if (bk === 'tandoor') return [{ g: 'drag', obj: 'vessel', to: 'aside', tool: 'tongs', hint: 'Peel it off the wall with the tongs', eff: out }];
      return [
        { g: 'knob', to: 0, hint: 'Turn the oven off', eff: (S, st) => { ves(S, st.vessel).heat = 0; } },
        doorPh('oven', 1, 'Pull the oven door down by its handle'),
        { g: 'drag', obj: 'vessel', to: 'aside', hint: 'Take it out (careful, hot!)', eff: (S, st) => out(S, st) },
        doorPh('oven', 0, 'Lift the door shut'),
      ];
    },
  },
  turn: {
    cap: 'vessel', verb: 'Turn', tool: 'pizzaPeel', icon: '🔄',
    phases: () => [{ g: 'circle', n: 0.5, tool: 'pizzaPeel', turn: true, hint: 'Turn it round so it bakes evenly' }],
  },
  chillIn: {
    cap: 'chill', moves: true, verb: 'Chill', tool: 'grab', icon: '🧊',
    phases: () => [
      doorPh('fridge', 1, 'Take the handle and swing the fridge open'),
      { g: 'drag', obj: 'vessel', to: 'shelf', hint: 'Put it on a shelf' },
      doorPh('fridge', 0, 'Swing the door shut'),
    ],
  },
  chillOut: {
    cap: 'vessel', verb: 'Take out of the fridge', tool: 'grab', icon: '🧊',
    phases: () => [
      doorPh('fridge', 1, 'Take the handle and swing the fridge open'),
      { g: 'drag', obj: 'vessel', to: 'aside', hint: 'Take it out', eff: (S, st) => { ves(S, st.vessel).at = null; ves(S, st.vessel).chilled = 1; } },
      doorPh('fridge', 0, 'Swing the door shut'),
    ],
  },

  // ------------------------------------------------------------- serving
  plate: {
    cap: 'plate', verb: 'Plate up', tool: 'ladle', icon: '🍽️',
    phases: (s) => [
      { g: 'scoop', n: s.n || 2, tool: s.tool || 'ladle', target: 'plates', hint: 'Scoop from the pot onto each plate',
        prog: (D, st, k) => { ves(D, st.into || 'plates').served = k; },
        eff: (S, st, v, fx, ph) => { const p = S.vessels[st.into || 'plates']; if (p) p.served = ph.n; } },
    ],
  },
  garnish: {
    cap: 'plate', verb: 'Garnish with', tool: 'grab', icon: '🌿',
    phases: (s) => [
      { g: 'place', n: s.n || 3, piece: s.with, tool: 'grab', hint: 'Tap to sprinkle it on', eff: (S, st) => { const it = S.items[st.with]; if (it && it.staple) it.used = 1; } },
    ],
  },
  serve: {
    cap: 'plate', verb: 'Serve', tool: 'hand', icon: '🛎️',
    phases: () => [{ g: 'tap', hot: 'bell', hint: 'Ring the bell – dinner is served!' }],
  },

  // ------------------------------------------------------------- waiting (no hands)
  wait: { cap: null, verb: 'Wait', icon: '⏳', phases: () => [] },

  // ------------------------------------------------------------- chores: the trash
  // (not recipe steps – any cook does them whenever a counter gets messy)
  clear: {
    cap: 'scraps', verb: 'Clear the scraps', tool: 'hand', icon: '🧹', chore: true,
    phases: () => [
      { g: 'strokes', axis: 'h', n: 3, tool: 'hand', sweep: true, hint: 'Sweep the scraps into a pile with your hand' },
      { g: 'drag', obj: 'scraps', to: 'hands', hint: 'Scoop the pile up into your hands' },
    ],
  },
  toss: {
    cap: 'bin', verb: 'Throw away', tool: 'grab', icon: '🗑️', chore: true,
    phases: () => [
      { g: 'tap', hot: 'pedal', hint: 'Step on the pedal to lift the lid' },
      { g: 'drag', obj: 'scraps', to: 'bin', hint: 'Drop the scraps in the bin' },
    ],
  },
  // a burner left on after its pan was lifted off: it burns until someone turns it off
  knob: {
    cap: 'hob', verb: 'Turn off the burner', tool: 'hand', icon: '🔥', chore: true,
    phases: () => [{ g: 'knob', to: 0, hint: 'Turn the empty burner off', eff: (S, st, v, fx) => { const k = Object.keys(fx.lit || {})[0]; if (k != null) delete fx.lit[k]; } }],
  },
  // ------------------------------------------------------------- chores: washing up
  // (a dirty pot / pan / bowl in the sink, washed by hand: soap on the sponge, scrub, rinse)
  scrub: {
    cap: 'sink', verb: 'Wash up', tool: 'sponge', icon: '🧽', chore: true,
    phases: () => [
      { g: 'tap', hot: 'soap', hint: 'Squeeze some dish soap onto the sponge' },
      { g: 'strokes', axis: 'h', n: 6, tool: 'sponge', hint: 'Scrub it all over with the sponge' },
      { g: 'tap', hot: 'faucet', hint: 'Turn on the tap', eff: (S, st, v, fx) => { fx.tap = 1; } },
      { g: 'circle', n: 2, tool: 'hand', hint: 'Rinse the suds off under the water' },
      { g: 'tap', hot: 'faucet', hint: 'Turn off the tap', eff: (S, st, v, fx) => { fx.tap = 0; } },
    ],
  },
  // (a cutting board after knife work: wooden – by hand, with the sponge, never in the dishwasher)
  wipe: {
    cap: 'board', verb: 'Clean the board', tool: 'sponge', icon: '🧽', chore: true,
    phases: () => [
      { g: 'tap', hot: 'soap', hint: 'A squeeze of dish soap on the sponge' },
      { g: 'strokes', axis: 'h', n: 5, tool: 'sponge', hint: 'Scrub the board with the sponge' },
      { g: 'strokes', axis: 'v', n: 3, tool: 'sponge', hint: 'Wipe it down clean' },
    ],
  },
  // a bunch with more than the recipe takes: just what's needed into an empty container of its
  // own, one at a time (what's left stays in the bunch's container, to go back) – '#portion.<item>.<n>@<fx>'
  portion: {
    cap: 'board', verb: 'Portion', tool: 'hand', icon: '🫙', chore: true,
    phases: (s) => [
      { g: 'drag', obj: 'newBox', to: 'portion', hint: 'Take an empty container from the stack' },
      { g: 'drag', obj: 'oneOver', to: 'portion', n: s.n || 1, hint: s.n > 1 ? `Move ${s.n} into it, one at a time` : 'Move one into it' },
    ],
  },
  // the dishwasher, loaded with dirty things: shut it and start it (it runs by itself)
  dw: {
    cap: 'dishwasher', verb: 'Run the dishwasher', tool: 'hand', icon: '🫧', chore: true,
    phases: () => [{ g: 'tap', hot: 'dwStart', hint: 'Shut the dishwasher and press start' }],
  },
  bag: {
    cap: 'bin', verb: 'Change the bag', tool: 'grab', icon: '🛍️', chore: true,
    phases: () => [
      { g: 'circle', n: 1, tool: 'grab', hint: 'Twist the full bag closed and knot it' },
      { g: 'drag', obj: 'bag', to: 'door', hint: 'Lift the bag out and set it by the back door' },
      { g: 'drag', obj: 'newBag', to: 'bin', hint: 'Pop a fresh bag into the can' },
      { g: 'strokes', axis: 'h', n: 2, tool: 'grab', hint: 'Shake it open round the rim' },
    ],
  },
};

// Scraps a step leaves on the counter: peel, papery skins, egg shells, cores,
// and the stems / ends trimmed off vegetables and herbs.
const STEMMED = new Set(['tomato', 'greenPepper', 'redPepper', 'chili', 'eggplant', 'zucchini', 'cucumber', 'carrot', 'mushroom',
  'lemon', 'cabbage', 'parsley', 'basil', 'mint', 'chives', 'thyme', 'rosemary', 'greenBeans', 'ginger', 'garlic']);
export function scrapsOf(step, items) {
  const it = step.item && items && items[step.item];
  const kind = it ? it.kind : null;
  switch (step.do) {
    case 'peel': case 'skin': case 'shell': case 'core': return { n: 1, kind: step.do === 'shell' ? 'egg' : kind };
    case 'separate': return { n: 1, kind };
    case 'crack': return { n: Math.max(1, step.n || 1), kind: 'egg' };
    case 'slice': case 'dice': case 'chop': case 'mince': case 'tear': return kind && STEMMED.has(kind) ? { n: 1, kind } : null;
    default: return null;
  }
}

export const HEAT_NAMES = ['off', 'low', 'medium', 'high'];
const PLATING = new Set(['plate', 'glass', 'cup']);

// Where a step happens: 'vessel' means wherever its vessel is now.
export function stepCap(step, S) {
  const a = ACTIONS[step.do];
  if (!a || a.cap === null) return null;
  if (a.cap !== 'vessel') return a.cap;
  const vid = step.into || step.vessel;
  const v = vid && S && S.vessels[vid];
  if (v && v.at) return { at: v.at };
  // a vessel that isn't anywhere yet: plates & glasses go to the pass, the rest (a bowl) on a counter
  if (v && PLATING.has(v.kind)) return 'plate';
  return 'board';
}

// The gestures of a step; bk = the kind of oven it's baked in ('electric' |
// 'dome' | 'tandoor'), which changes how things go in and out.
export function phasesOf(step, bk) {
  const a = ACTIONS[step.do];
  return a ? a.phases(step, bk) : [];
}

// "Slice the tomatoes", "Add the rice", … unless the recipe gives a title.
export function stepTitle(step, names) {
  const t = rawTitle(step, names);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function rawTitle(step, names) {
  if (step.title) return step.title;
  const a = ACTIONS[step.do];
  const n = (id) => (names[id] || id);
  const what = step.item ? n(step.item) : step.vessel ? n(step.vessel) : '';
  switch (step.do) {
    case 'add': return `Add ${(step.items || [step.item]).map(n).join(' & ')}`;
    case 'pour': return step.from ? `Pour the ${n(step.from)} into the ${n(step.into)}` : `Pour in the ${n(step.item)}`;
    case 'season': return `Season with ${n(step.item)}`;
    case 'heat': return `Put the ${n(step.vessel)} on ${HEAT_NAMES[step.level ?? 3] === 'medium' ? 'a medium' : HEAT_NAMES[step.level ?? 3]} heat`;
    case 'adjust': return `Turn the heat to ${HEAT_NAMES[step.level ?? 1]}`;
    case 'wait': return step.label || 'Wait';
    case 'top': return `Top with ${n(step.with)}`;
    case 'spread': return `Spread the ${n(step.with)}`;
    case 'garnish': return `Garnish with ${n(step.with)}`;
    case 'plate': return 'Plate up';
    case 'serve': return 'Serve!';
    case 'crack': return `Crack the ${n(step.item)}`;
    default: return `${a ? a.verb : step.do} the ${what}`.replace(/ the $/, '');
  }
}
