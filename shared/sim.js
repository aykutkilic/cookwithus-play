// The kitchen, simulated – for a recipe marked `sim` (Menemen first). Nothing is
// ticked off because a step's gestures were made: the kitchen is as the recipe
// says, or it isn't yet. A pan on a lit burner warms to the burner's heat; what's
// in it melts, cooks – and catches, left unstirred too long on a good heat; the
// seasoning is however much went in. The host runs it (shared/cook.js tickCook),
// in the kitchen's time – sped up with it.
//
// A recipe's timings stay its own: "cook the tomatoes down (5 min)" is done when
// the tomatoes have cooked as much as five minutes at a medium heat cook them –
// sooner on a high heat (where they'd catch, unstirred), later on a low one.

// where a pan's heat settles at each of the burner's levels (0 cold … 1 smoking hot), and how long it takes to get
// there (seconds) – warming, cooling off the heat
export const TEMP = [0, 0.42, 0.66, 0.9];
const WARM_S = 18, COOL_S = 50;
const COOK_FROM = 0.3; // (cooler than this, nothing cooks)
// how long a thing takes to cook through at a medium heat (seconds) – its cook level goes 0 → 1 in that time (past 1:
// overdone); what melts, how long that takes
export const COOK_S = { greenPepper: 240, redPepper: 240, onion: 240, tomato: 420, egg: 140, default: 300 };
const MELT_S = { butter: 25 };
const KEEPS = new Set(['salt', 'pulBiber', 'pepper', 'water', 'oil']); // (in the pan as it is: seasoning, liquid)
// left unstirred this long on a high heat, what's in a dry pan starts to catch (on a medium heat: four times as long,
// and not what gives up its juice – tomatoes, eggs)
export const CATCH_AFTER = 50;
const JUICY = new Set(['tomato', 'egg']);

const r3 = (n) => Math.round(n * 1000) / 1000, r5 = (n) => Math.round(n * 1e5) / 1e5; // (what builds up a little each second: finer)

// A second (dt) of the kitchen's time.
export function simTick(C, dt) {
  C.simT = r5((C.simT || 0) + dt);
  for (const v of Object.values(C.vessels)) {
    const on = v.at && v.onHob && v.heat > 0;
    const want = on ? TEMP[Math.max(0, Math.min(3, v.heat))] : 0, t0 = v.temp || 0;
    v.temp = r5(t0 + (want - t0) * Math.min(1, dt / (want > t0 ? WARM_S : COOL_S)));
    if (!v.contents || !v.contents.length || v.temp < COOK_FROM) continue;
    const k = (v.temp - COOK_FROM) / (TEMP[2] - COOK_FROM); // (1 at a medium heat)
    // (wet: water in it – or what gives up its juice, the tomatoes, the eggs: what's in with them stews, doesn't catch)
    const dry = !((v.water || 0) > 0.05) && !v.contents.some((c) => JUICY.has(c.kind));
    const idle = C.simT - (v.stirT ?? C.simT);
    let sum = 0, n = 0;
    for (const c of v.contents) {
      if (MELT_S[c.kind]) { c.melt = r5(Math.min(1, (c.melt || 0) + (dt * k) / MELT_S[c.kind])); continue; }
      if (KEEPS.has(c.kind)) continue;
      c.cook = r5((c.cook || 0) + (dt * k) / (COOK_S[c.kind] || COOK_S.default));
      if (dry) c.fried = r5((c.fried || 0) + (dt * k) / (COOK_S[c.kind] || COOK_S.default)); // (in a dry pan – not boiled)
      const catching = dry && (k > 1.2 ? idle > CATCH_AFTER : k > 0.95 && !JUICY.has(c.kind) && idle > CATCH_AFTER * 4);
      if (catching) c.burn = r5(Math.min(1, (c.burn || 0) + (dt * k) / 120));
      sum += Math.min(1, c.cook); n++;
    }
    // (the pan's look – how cooked what's in it is – follows it)
    if (n) v.cook = r3(Math.max(v.cook || 0, sum / n));
  }
}

// a stir (a turn of the spoon, a stroke of the spatula) in the pan: nothing catches for a while, what's in it is turned
export function simStir(C, v) {
  v.stirT = C.simT || 0;
  for (const c of v.contents || []) c.stirs = (c.stirs || 0) + 1;
}

// so much of a seasoning (a shake, a pinch – the recipe's n is how much it wants) into a pan
export function simSeason(v, kind, amount) {
  v.season = v.season || {};
  v.season[kind] = r3((v.season[kind] || 0) + amount);
  if (!(v.contents || []).some((c) => c.kind === kind)) v.contents.push({ kind, cut: null });
}

// What a cut step leaves a thing as ('rings', 'dice' …).
function cutOf(s) { return { slice: s.cut || 'slices', dice: 'dice', mince: 'mince', chop: s.cut || 'chunks' }[s.do] || null; }
// what a pan step is about: the thing put into its pan last before it (following its afters back)
function subjectOf(x, s) {
  const by = new Map(x.steps.map((q) => [q.id, q]));
  const seen = new Set(), todo = [...s.after];
  while (todo.length) {
    const q = by.get(todo.shift());
    if (!q || seen.has(q.id)) continue;
    seen.add(q.id);
    if ((q.do === 'add' || q.do === 'crack') && q.into === s.vessel && q.itemKind) return q.itemKind;
    todo.push(...q.after);
  }
  return null;
}
const contentOf = (v, kind) => v && (v.contents || []).find((c) => c.kind === kind);

// Is step s as the kitchen is now? (null: it isn't something the kitchen shows – serving: its own gesture)
export function simDone(C, x, s) {
  const it = s.item && C.items[s.item], v = s.vessel && C.vessels[s.vessel], into = s.into && C.vessels[s.into];
  switch (s.do) {
    case 'wash': return !!(it && it.washed);
    case 'slice': case 'dice': case 'mince': case 'chop': return !!(it && it.cut === cutOf(s) && it.n && it.k >= it.n);
    case 'heat': return !!(v && v.at && v.onHob && v.heat === (s.level ?? 3));
    case 'add': case 'crack': return !!(it && it.in === s.into);
    case 'wait': {
      // (what's frying in a pan on the hob shows how far it's got; a boil, a bake, a chill, a rise – its time does,
      // counted while the kitchen's as it needs to be: null, see shared/cook.js waitRate)
      const kind = subjectOf(x, s), c = contentOf(v, kind);
      if (!kind || !v || (v.water || 0) > 0.05 || !x.steps.some((q) => q.do === 'heat' && q.vessel === s.vessel) || (!c && !v.onHob)) return null;
      if (!c) return false;
      return MELT_S[kind] ? (c.melt || 0) >= 1 : (c.cook || 0) >= (s.dur || 60) / (COOK_S[kind] || COOK_S.default);
    }
    case 'saute': { const c = contentOf(v, subjectOf(x, s)); return !!(c && (c.cook || 0) >= (s.to ?? 0.6)); }
    case 'stir': { const c = contentOf(v, subjectOf(x, s)); return !!(c && (c.stirs || 0) >= (s.n || 1)); }
    case 'season': return !!(into && into.season && (into.season[s.itemKind] || 0) >= (s.n || 1));
    case 'remove': return !!(v && !(v.onHob && v.heat > 0));
    default: return null;
  }
}
// How far a cooking step (a wait, a sauté) has got, 0..1 – null if it hasn't begun (nothing in its pan yet).
export function simProgress(C, x, s) {
  const v = s.vessel && C.vessels[s.vessel];
  if (s.do !== 'wait' && s.do !== 'saute') return null;
  const kind = subjectOf(x, s), c = contentOf(v, kind);
  if (!c) return null;
  const want = s.do === 'saute' ? s.to ?? 0.6 : MELT_S[kind] ? 1 : (s.dur || 60) / (COOK_S[kind] || COOK_S.default);
  return Math.min(1, (MELT_S[kind] ? c.melt || 0 : c.cook || 0) / want);
}

// (steps the kitchen can show long before they're done – a pan off the heat at the start: not done till what comes
// before them is)
export const IN_ORDER = new Set(['remove']);

// How it came out – what the cook did shows on the plate: [{what, note, q}] (q: 0..1, how far it costs the stars)
export function simVerdict(C, x) {
  const out = [];
  for (const v of Object.values(C.vessels)) for (const c of v.contents || []) {
    if ((c.burn || 0) > 0.25) out.push({ what: c.kind, note: (c.burn || 0) > 0.6 ? 'burnt' : 'catching on the pan', q: 1 - Math.min(0.7, c.burn) });
    else if (c.kind === 'egg' && (c.fried || 0) > 1.15) out.push({ what: c.kind, note: 'set hard – rubbery', q: 0.75 });
  }
  for (const s of x.steps) {
    if (s.do !== 'season') continue;
    const into = C.vessels[s.into], got = (into && into.season && into.season[s.itemKind]) || 0, want = s.n || 1;
    if (got > want * 1.8) out.push({ what: s.itemKind, note: got > want * 3 ? 'far too much' : 'a little much', q: got > want * 3 ? 0.5 : 0.8 });
  }
  return out;
}

