// cookwithus – the page: your kitchen, the cooks in it, the recipe sheet,
// timers, chat, invites and dialogs. You land in your own cozy kitchen at once
// (it runs in this tab); friends join it with the code / link, or you join theirs.
import { HostSession, PeerNet } from './p2p.js';
import { Scene3D, LITE } from './scene3d.js';
import { Controls, isTouchDevice, lockZoom } from './controls.js';
import { newTrack, follow } from './interp.js';
import { applyUiTheme } from './theme.js';
import { Station } from './station.js';
import { Sfx } from './audio.js';
import { lookOf, drawPortrait, drawCook } from './figure.js';
import { drawDish } from './art.js';
import { initPwa } from './pwa.js';
import { newMirror, applyMsg } from '../shared/mirror.js';
import { SIZES, SIZE_ORDER, CUISINES, CUISINE_ORDER, FIXTURES, buildKitchen, kitchenCaps, fixtureById, bakeKind, isStore, splitPlace } from '../shared/kitchens.js';
import { RECIPES } from '../shared/recipes.js';
import {
  expanded, stepDef, stepPlaces, placeBusy, canCook, recipeById, displayState, stepIcon, SPEEDS,
  choreId, carrying, binHolds, stepDuration, planStep, needsOf, heldBy, locate, thingName, thingEmoji,
  handsFree, canPut, HANDS, handsUsed, inOrder, cleanup, needsWash, dwRunning, dwLoad, dishwasherSafe, DW_DUR, glovesOn,
} from '../shared/cook.js';
import { phasesOf, ACTIONS, BOARD_TOOLS, stepTool } from '../shared/actions.js';
import { simProgress } from '../shared/sim.js';
import { ingName, TOOLS, stocked } from '../shared/ingredients.js';
import { foodWidth } from './food3d.js';
import {
  randomProfile, sanitizeProfile, isProfane, cleanName, QUICK_CHAT, SKINS, HAIR_COLORS, HAIR_STYLES, HATS, HAT_COLORS,
  APRONS, SHIRTS, FACIAL, EXTRAS,
} from '../shared/names.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`cookwithus.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`cookwithus.${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
const SPEED = 2.5;   // tiles per second
const TURN = 2.6;    // first person: radians per second turning with the keys / stick
const TURN_UP = 9, TURN_DOWN = 12; // (how quickly a turn gets going, and settles)
const CROUCH = -0.3, TIPTOE = 0.1;  // first person: eye lower crouching (about 60 cm), higher on your toes (20 cm)
const BEND = -0.22; // (and bending down to look into a low cupboard)
const ACCEL = 12, BRAKE = 15; // how quickly the cook gets up to speed / stops
const RADIUS = 0.26; // how wide a cook is
const FIX_R = 0.15;  // how close a cook comes to a counter, a stove …: up to it, a hand's breadth or so off (15–20 cm)

// ------------------------------------------------------------------ state

const S = {
  profile: sanitizeProfile(store.get('profile', null) || randomProfile()),
  mainHand: store.get('mainHand', 1) === 0 ? 0 : 1, // the hand I do most with (E, the left button): 1 the right, 0 the left
  firstVisit: !store.get('profile', null),
  net: null, host: null, M: newMirror(), myId: -1,
  K: null, x: null,
  me: { x: 2.5, y: 2.5, yaw: 0, walk: -1, v: { x: 0, y: 0 }, placed: false },
  fp: false, pitch: -0.18, // first person: on, and looking up / down
  target: null,      // the fixture in front of me
  menuSel: 0,
  pending: null,     // {sid, fx}: walking there to do it
  working: null,     // {sid, fx}: at the station
  sel: null,         // the step picked on the sheet (its places glow)
  pose: null,
  others: new Map(), // id -> rendered {x, y, d, walk}
  bubbles: new Map(),
  lastPos: 0, lastPosKey: '',
  sheetDirty: true, lastSheet: 0,
  lastClockUi: 0,
  inviteState: 'opening', code: null,
  finishedShown: null,
};
store.set('profile', S.profile);

const scene = new Scene3D($('world'));
scene.mainHand = S.mainHand;
const sfx = new Sfx();
const station = new Station($('stCanvas'), {
  act: (m) => { send(m); pickedAtWork(m); },
  // (a board's tool – the knife, the peeler, the grater – in one of my hands)
  holdsTool: (t) => myHeld().some((k) => boardKind(k) === t),
  sfx: (n, v) => sfx.play(n, v),
  pose: (p) => { S.pose = p; },
  progress: (info) => stationProgress(info),
  store: (m) => send(m),
  close: () => closeStation(true),
});

function send(obj) { if (S.net) S.net.send(obj); }
const KNOB_NAMES = ['off', 'low', 'medium', 'high'];
// T: tipping into the pot / pan I aim at – what one of my hands holds (the main one first: food, all of it, once T's
// held a moment – eggs cracked in one at a time), or, empty-handed, the staple the recipe wants in it (salt, pepper
// flakes …: a shake each half second – as much as I hold it for)
function pourTarget() {
  const C = S.M.cook;
  if (!S.fp || S.working || !C) return null;
  const c = scene.viewCenter();
  // (loose ones in a hand – tomatoes taken out one by one – at a bunch of the same: back in with them)
  const lk = [scene.fpSlots[S.mainHand], scene.fpSlots[1 - S.mainHand]].find((q) => q && q[0] === 'i' && C.items[q.slice(2)] && C.items[q.slice(2)].loose);
  const at = lk && fpPointedAt(c);
  if (at && (at.kind === 'piece' || at.kind === 'thing') && at.key[0] === 'i' && at.key !== lk) {
    const lo = C.items[lk.slice(2)], b = C.items[at.key.slice(2)];
    if (b && b.kind === lo.kind && !b.loose && !!b.washed === !!lo.washed && (b.cut || null) === (lo.cut || null)) return { merge: true, what: lk, into: at.key, w: at.w, every: 0.25, label: `${thingEmoji(C, lk)} Put the ${thingName(C, S.x, lk)} back in with the ${thingName(C, S.x, at.key)}` };
  }
  const v = scene.vesselPick(c.x, c.y, S.me);
  if (lk) {
    // (… into an empty container: the one I aim at, lying about – not on its stack – or, aiming at no pan, the one in my
    // other hand)
    const isBox = (q) => q && q[0] === 'u' && C.tools[q.slice(2)] && C.tools[q.slice(2)].kind === 'box';
    const bt = at && at.kind === 'thing' && isBox(at.key) && !String(C.tools[at.key.slice(2)].at || '').endsWith('/nest') ? at.key : null;
    const ob = scene.fpSlots.find(isBox);
    const bx = bt || (!v && ob);
    if (bx) return { boxInto: true, what: lk, into: bx, w: bt ? at.w : null, every: 0.25, label: `${thingEmoji(C, lk)} Put the ${thingName(C, S.x, lk)} in the ${bt ? 'container' : 'container in your other hand'}` };
  }
  if (!v) return null;
  const into = thingName(C, S.x, `v:${v.id}`), sl = scene.fpSlots, M = S.mainHand;
  const k = [sl[M], sl[1 - M]].find((q) => q && q[0] === 'i');
  if (k) { const it = C.items[k.slice(2)]; return { what: k, into: v.id, w: v.w, hand: sl.indexOf(k), every: it && it.kind === 'egg' ? 0.6 : 0.7, label: `${thingEmoji(C, k)} ${it && it.kind === 'egg' ? 'Crack the eggs' : `Tip the ${thingName(C, S.x, k)}`} into the ${into}` }; }
  const s = S.x && S.x.steps.find((q) => q.do === 'season' && q.into === v.id && C.steps[q.id].s !== 'done');
  if (s) return { what: `staple:${s.itemKind}`, into: v.id, w: v.w, every: 0.5, label: `🧂 Season it – ${ingName(s.itemKind, 1).toLowerCase()} (a shake each moment)` };
  return null;
}
// Free work at fixture f – the recipe asking for it or not: with a board's knife in hand, slicing, dicing, mincing,
// chopping what's uncut lying here; the peeler, peeling; the grater, grating; at the sink, washing what I hold.
const FREE_BY_TOOL = { knife: ['slice', 'dice', 'mince', 'chop'], peeler: ['peel'], grater: ['grate'] };
const FREE_ICON = { slice: '🔪', dice: '🔪', mince: '🔪', chop: '🔪', peel: '🥕', grate: '🧀', wash: '💧' };
function freeJobs(f, only = null) {
  const C = S.M.cook, out = [];
  if (!C || !S.x || C.finished) return out;
  const held = myHeld(), tools = held.map(boardKind).filter(Boolean);
  // (not what the recipe itself does with it – that's its own step, already in the list)
  const own = (a, id) => S.x.steps.some((q) => q.do === a && q.item === id && C.steps[q.id] && C.steps[q.id].s !== 'done');
  const job = (a, id, it) => ({ sid: `#do.${a}.${id}.${it.kind}.${it.qty || 1}${it.loose ? 'l' : ''}@${f.id}`, label: `${FREE_ICON[a]} ${ACTIONS[a].verb} the ${thingName(C, S.x, `i:${id}`)}`, chore: true, free: true, key: `i:${id}` });
  for (const [id, it] of Object.entries(C.items)) {
    if ((only && only !== `i:${id}`) || !stocked(it.kind)) continue; // (produce: peppers, tomatoes, onions … – not an egg sliced)
    if (f.caps.includes('board') && it.at === f.id && !it.in && !it.used && !it.stored && it.held == null && !it.cut) {
      for (const t of tools) for (const a of FREE_BY_TOOL[t] || []) if ((a !== 'peel' || !it.peeled) && !own(a, id)) out.push(job(a, id, it));
    }
    if (f.caps.includes('sink') && held.includes(`i:${id}`) && !it.washed && !own('wash', id)) out.push(job('wash', id, it));
  }
  return out;
}

// R: using what my main hand holds on what I aim at – the recipe's work that does that, its close-up and my strokes
// (the knife on the tomatoes: dicing them; the peppers at the sink: washing them); at a pan, its sauté / stir – or, if
// none's open, a stir there and then
function workTarget() {
  const C = S.M.cook;
  if (!S.fp || S.working || !C || !S.x) return null;
  const c = scene.viewCenter(), k = scene.fpSlots[S.mainHand], t = boardKind(k);
  const open = (s) => s && C.steps[s.id] && !['done', 'active'].includes(C.steps[s.id].s) && (C.steps[s.id].s !== 'active' || C.steps[s.id].by === S.myId);
  const res = fpPointedAt(c);
  if (t && res && res.kind === 'thing' && res.key[0] === 'i') {
    const f = fixtureById(S.K, splitPlace(res.fx)[0]);
    const job = f && jobsAt(f).find((j) => j.sid && !j.off && (() => { const s = S.x.steps.find((q) => q.id === j.sid); return s && `i:${s.item}` === res.key && stepTool(s, bakeKind(f)) === t; })());
    if (job) return { sid: job.sid, fx: f.id, w: res.w, label: job.label };
    // (nothing the recipe does with it here: what it's free to do – the first of them; Tab for the rest)
    const fj = f && freeJobs(f, res.key)[0];
    if (fj) return { sid: fj.sid, fx: f.id, w: res.w, label: `${fj.label} (Tab: more)` };
  }
  const v = scene.vesselPick(c.x, c.y, S.me);
  if (v) {
    // (its sauté once what it's for is in the pan)
    const s = S.x.steps.find((q) => (q.do === 'saute' || q.do === 'stir') && q.vessel === v.id && open(q) && (q.do !== 'saute' || !S.x.sim || simProgress(C, S.x, q) != null));
    const vv = C.vessels[v.id];
    if (s && vv && vv.at) return { sid: s.id, fx: vv.at.fx, w: v.w, label: `${stepIcon(s)} ${s.name}` };
    if (vv && (vv.contents || []).length) return { stir: v.id, w: v.w, label: '🥄 Stir it' };
  }
  const f = S.target, held = myHeld();
  const job = f && held.length && jobsAt(f).find((j) => j.sid && !j.off && j.uses);
  if (job) return { sid: job.sid, fx: f.id, w: null, label: job.label };
  return null;
}
function workNow() {
  const t = workTarget();
  if (!t) return;
  if (t.sid) { startJob(t.sid, t.fx); return; }
  if (t.stir) { send({ t: 'stir', into: t.stir }); const i = scene.fpSlots[S.mainHand] == null ? S.mainHand : 1 - S.mainHand; if (t.w && scene.fpSlots[i] == null) scene.fpArms.reach(i, { key: null, take: false, hold: 'hand', world: t.w }); sfx.play('whoosh', 0.3); }
}
function pourFrame(dt) {
  const P = S.pour, t = P && pourTarget();
  if (!t) return;
  // (one press, one thing: the peppers tipped in, it doesn't go on into the salt)
  if (P.what && P.what !== t.what) return;
  P.what = t.what;
  if (!P.reached && t.hand >= 0) { P.reached = true; scene.fpArms.reach(t.hand, { key: null, take: false, hold: 'palm', world: t.w.clone().setY(t.w.y + 0.08) }); }
  P.t += dt;
  if (P.t >= t.every) {
    P.t = 0;
    if (t.merge) { send({ t: 'merge', what: t.what, into: t.into }); sfx.play('clunk', 0.35); return; }
    if (t.boxInto) {
      const h = scene.fpSlots.indexOf(t.into);
      if (h >= 0) scene.fpMove = { k: t.what, box: t.into, to: h }; // (in that hand, in it)
      const g = h < 0 && scene.tools.get(t.into.slice(2)), p = g && g.g.position;
      send({ t: 'boxInto', what: t.what, into: t.into, ...(p ? { lay: { x: p.x, y: p.y, z: p.z } } : {}) }); sfx.play('clunk', 0.35);
      return;
    }
    send({ t: 'pour', what: t.what, into: t.into, n: 1 }); sfx.play(t.what.startsWith('staple:') ? 'click' : 'pop', 0.45);
  }
}
// which of the board's tools a thing is – 'knife', 'peeler', 'grater' – or null
function boardKind(k) { const t = k && k[0] === 'u' && S.M.cook && (S.M.cook.tools || {})[k.slice(2)]; return (t && TOOLS[t.kind] && TOOLS[t.kind].board) || null; }
// At work, the board's tool picked up off the board (its tap): really in my hand now – the hand that works with it,
// the main one if it's free – and mine to put down when I choose.
function pickedAtWork(m) {
  const ph = m && m.t === 'act' && station.c && station.c.phases[m.ph];
  if (!ph || ph.hot !== 'pick' || !S.working || myHeld().some((k) => boardKind(k) === ph.takes)) return;
  const C = S.M.cook, fx = S.working.fx;
  const hit = Object.entries(C.tools || {}).find(([, t]) => t.held == null && (t.at === `${fx}/board` || t.at === fx) && TOOLS[t.kind] && TOOLS[t.kind].board === ph.takes);
  if (!hit) return;
  const key = `u:${hit[0]}`;
  wantHand(key, freeHandSlot(S.mainHand));
  send({ t: 'take', what: key, fx: hit[1].at });
}
function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), ms);
}

// ------------------------------------------------------------------ kitchens & connections

const params = new URLSearchParams(location.search);

function kitchenPrefs() {
  const p = store.get('kitchen', null);
  if (p && SIZES[p.size] && CUISINES[p.cuisine]) return p;
  const cuisine = CUISINE_ORDER[(Math.random() * CUISINE_ORDER.length) | 0];
  const k = { size: 'small', cuisine };
  store.set('kitchen', k);
  return k;
}

// Open your own kitchen: it starts right away in this tab; the invite code
// arrives a moment later from the broker.
function startOwnKitchen(opts = {}) {
  const pref = { ...kitchenPrefs(), ...opts };
  store.set('kitchen', { size: pref.size, cuisine: pref.cuisine });
  let recipe = pref.recipe || store.get('recipe', 'boiled-eggs');
  const r = recipeById(recipe);
  if (!r || !canCook(r, buildKitchen(pref.size, pref.cuisine)).ok) recipe = 'boiled-eggs';
  // (Şakir comes by now and then – not in automated test runs: ?nosakir)
  const host = new HostSession({ name: `${S.profile.name}'s kitchen`, size: pref.size, cuisine: pref.cuisine, recipe, incidents: !params.has('nosakir') }, (state, code) => {
    if (S.host !== host) return;
    S.inviteState = state; S.code = code;
    refreshTop();
    if ($('modal').dataset.kind === 'invite') openInvite();
  });
  connect(host.local, {
    onReady: () => {
      const old = S.host;
      S.host = host;
      if (old && old !== host) old.destroy();
      host.openInvites();
    },
    onFail: () => toast('Could not open a kitchen'),
    onLost: () => {},
  });
  return host;
}

function joinKitchen(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) { toast('A kitchen code has 4 letters'); return; }
  if (S.host && S.host.code === code) { toast('That’s your own kitchen!'); return; }
  toast(`Knocking on kitchen ${code}…`, 8000);
  const t = new PeerNet(code);
  connect(t, {
    onReady: () => {
      toast(`You’re in! Wash your hands 🧼`);
      // leave your own kitchen behind
      if (S.host) { S.host.destroy(); S.host = null; }
      history.replaceState(null, '', `${location.pathname}?k=${code}`);
    },
    onFail: () => { if (!S.net) startOwnKitchen(); },
    onLost: () => {
      toast('The kitchen closed – back to your own 🏠', 4000);
      history.replaceState(null, '', location.pathname);
      startOwnKitchen();
    },
  });
}

// Wire a transport to a fresh copy of the room; it becomes the active one
// once the kitchen has said hello.
function connect(t, { onReady, onFail, onLost }) {
  const M = newMirror();
  let ready = false, myId = -1;
  t.on('open', () => t.send({ t: 'hello', profile: S.profile }));
  t.on('msg', (msg) => {
    if (msg.t === 'welcome') { myId = msg.id; return; }
    if (msg.t === 'error') {
      toast(msg.text, 4000);
      if (!ready) { try { t.close(); } catch { /* ignore */ } }
      return;
    }
    const ev = applyMsg(M, msg, performance.now());
    if (!ready && M.room) {
      ready = true;
      const prev = S.net;
      S.net = t; S.M = M; S.myId = myId;
      if (prev && prev !== t && prev.kind !== 'local') { try { prev.close(); } catch { /* ignore */ } }
      onReady();
      enterKitchen();
    }
    if (S.net === t) onMessage(msg, ev);
  });
  t.on('close', () => {
    if (!ready) { onFail(); return; }
    if (S.net === t) { S.net = null; closeStation(true); onLost(); }
  });
  t.connect();
}

// A (new) kitchen: place my cook, reset the view.
function enterKitchen() {
  const M = S.M;
  S.K = scene.setKitchen(M.kitchen.size, M.kitchen.cuisine);
  sfx.setCuisine(M.kitchen.cuisine);
  applyUiTheme(M.kitchen.cuisine);
  S.x = M.cook ? expanded(M.cook, S.K.cap) : null;
  S.me.placed = false;
  S.others.clear();
  S.pending = null;
  closeStation(true);
  placeMe();
  S.sheetDirty = true;
  refreshTop();
  layout();
}

function placeMe() {
  if (!S.K || !S.M.room) return;
  const idx = Math.max(0, S.M.room.members.findIndex((m) => m.id === S.myId));
  const sp = S.K.spawns[idx % S.K.spawns.length];
  Object.assign(S.me, { x: sp.x + 0.5, y: sp.y + 0.5, yaw: Math.PI * 1.25, walk: -1, v: { x: 0, y: 0 }, placed: true });
}

// ------------------------------------------------------------------ messages

function onMessage(msg, ev) {
  switch (msg.t) {
    case 'room': {
      const K = S.K;
      if (!K || K.size !== msg.kitchen.size || K.cuisine !== msg.kitchen.cuisine) {
        S.K = scene.setKitchen(msg.kitchen.size, msg.kitchen.cuisine);
        sfx.setCuisine(msg.kitchen.cuisine);
        applyUiTheme(msg.kitchen.cuisine);
        if (S.M.cook) S.x = expanded(S.M.cook, S.K.cap);
        closeStation(true);
        placeMe();
      }
      const before = refreshTop.members || 0;
      if (msg.members.length > before && before) sfx.play('join');
      if (msg.members.length < before) sfx.play('leave');
      refreshTop.members = msg.members.length;
      refreshTop();
      S.sheetDirty = true;
      break;
    }
    case 'cook':
      S.K = scene.setKitchen(msg.kitchen.size, msg.kitchen.cuisine);
      applyUiTheme(msg.kitchen.cuisine);
      S.x = msg.cook ? expanded(msg.cook, S.K.cap) : null;
      closeStation(true);
      S.pending = null; S.sel = null;
      S.finishedShown = null;
      if (msg.cook) store.set('recipe', msg.cook.recipe);
      if ($('modal').dataset.kind === 'results') closeModal();
      S.sheetDirty = true;
      refreshTop();
      break;
    case 'up':
      for (const e of ev) onEvent(e);
      S.sheetDirty = true;
      if (S.working) station.update(S.M.cook, S.K);
      if (S.working && S.M.cook.steps[S.working.sid] && S.M.cook.steps[S.working.sid].s === 'done') {
        const sid = S.working.sid;
        setTimeout(() => { if (S.working && S.working.sid === sid) closeStation(true); }, 900);
      }
      if (S.M.cook && S.M.cook.finished && S.finishedShown !== S.M.cook.recipe) {
        S.finishedShown = S.M.cook.recipe;
        setTimeout(openResults, 1200);
      }
      break;
    case 'handled':
      if (msg.err) toast(msg.err);
      break;
    case 'opened':
      if (msg.err) {
        toast(msg.err);
        if (S.pending && S.pending.sid === msg.sid) S.pending = null;
      } else openStation(msg.sid, msg.fx);
      break;
    case 'chat': addChat(msg); break;
    default: break;
  }
}

function onEvent(e) {
  const mine = e.by === S.myId;
  switch (e.k) {
    case 'ding': sfx.play('timer'); { const s = S.x && stepDef(S.x, e.sid); if (s) toast(`⏰ ${s.name} – done!`); } break;
    case 'step': if (!mine) sfx.play('pop', 0.4); break;
    case 'chore': if (mine) sfx.play(e.what === 'bag' ? 'bag' : 'pop'); break;
    case 'g':
      // other cooks' gestures, quietly
      if (!mine) sfx.play({ chop: 'chop', strokes: 'scrub', circle: 'stir', peel: 'peel', crack: 'crack', place: 'plop', flick: 'whoosh', drag: 'clunk', tap: 'tap' }[e.g] || 'pop', 0.25);
      break;
    case 'finish': sfx.play('fanfare'); break;
    // Şakir
    case 'sakirComes': sfx.play('whoosh', 0.5); toast('👻 Uh-oh… Şakir is floating about the kitchen', 3500); break;
    case 'sakir': { sfx.play('clunk'); const it = S.M.cook && S.M.cook.items[e.id]; toast(`👻 Şakir bumped the ${it ? thingName(S.M.cook, S.x, `i:${e.id}`) : 'food'} off the counter! Fresh ones are back – do them again (and sweep up the bits)`, 5200); break; }
    case 'sakirMiss': toast('👻 Şakir floated by… and missed. Phew!', 2600); break;
    default: break;
  }
}

// ------------------------------------------------------------------ top bar

function isHead() { return S.M.room && S.M.room.hostId === S.myId; }

function refreshTop() {
  const M = S.M;
  if (!M.room) return;
  const k = M.room.kitchen;
  $('kFlag').textContent = CUISINES[k.cuisine].flag;
  $('kName').textContent = `${SIZES[k.size].name} ${CUISINES[k.cuisine].name}`;
  const code = M.room.code && M.room.code !== '----' ? M.room.code : (S.host ? (S.inviteState === 'offline' ? 'offline' : '····') : '');
  $('kCode').textContent = code;
  $('kCode').title = `${M.room.members.length}/${SIZES[k.size].cap} cooks`;
  $('meName').textContent = S.profile.name;
  drawFace();
}

function drawFace() {
  const c = $('meFace');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 80, 80);
  // just the head and hat: the feet are far below the canvas
  drawCook(ctx, 40, 132, 1.3, lookOf(S.profile.avatar), { d: 0, walk: -1 }, 0);
}

// ------------------------------------------------------------------ the recipe sheet

function memberById(id) { return S.M.room ? S.M.room.members.find((m) => m.id === id) : null; }

function renderSheet() {
  S.sheetDirty = false;
  S.lastSheet = performance.now();
  const C = S.M.cook, x = S.x;
  const head = S.M.room && memberById(S.M.room.hostId);
  $('headNote').textContent = head ? (isHead() ? 'You’re the head chef 👑' : `Head chef: ${head.name}`) : '';
  $('bookBtn').textContent = isHead() ? '📖 Change recipe' : '📖 Recipe book';
  if (!C || !x) {
    $('rName').textContent = 'No recipe yet';
    $('rMeta').textContent = isHead() ? 'Pick one from the recipe book!' : 'Waiting for the head chef…';
    $('steps').innerHTML = '';
    $('rProg').style.width = '0%';
    $('rProgTxt').textContent = '';
    return;
  }
  const r = recipeById(C.recipe);
  $('rName').textContent = r.name;
  $('rMeta').textContent = `${'★'.repeat(r.level)}${'☆'.repeat(5 - r.level)} · serves ${r.serves} · ${CUISINES[r.cuisine] ? CUISINES[r.cuisine].flag + ' ' + CUISINES[r.cuisine].name : 'Anywhere'}`;
  const done = x.steps.filter((s) => C.steps[s.id].s === 'done').length;
  $('rProg').style.width = `${Math.round(done / x.steps.length * 100)}%`;
  $('rProgTxt').textContent = C.finished ? 'Served! 🎉' : `${done} / ${x.steps.length}`;
  drawDishMini(r);
  // the recipe in its own order: what's done is ticked where it stands
  const list = x.steps.map((s, i) => ({ s, st: C.steps[s.id], i }));
  const nowDone = new Set(list.filter((q) => q.st.s === 'done').map((q) => q.s.id));
  const fresh = S.doneSeen ? [...nowDone].filter((id) => !S.doneSeen.has(id)) : [];
  S.doneSeen = nowDone;
  const html = [];
  // what's still to clean before it can be served
  const todo = cleanup(C, x);
  for (const { s, st } of list) {
    if (s.do === 'serve' && todo.length && st.s !== 'done') html.push(cleanupRow(C, x, todo));
    const cls = [st.s];
    // (open, but the recipe puts other steps first: yours to do whenever – it just says what usually comes first)
    const later = st.s === 'open' && st.ph === 0 && st.k === 0 && !inOrder(C, s);
    if (later) cls.push('later');
    if (fresh.includes(s.id)) cls.push('just');
    if (st.claim.includes(S.myId) || st.by === S.myId) cls.push('mine');
    if (S.sel === s.id) cls.push('mine');
    const who = [];
    const people = new Set([...(st.by != null ? [st.by] : []), ...st.claim, ...(st.s === 'done' ? st.who : [])]);
    for (const id of people) {
      const m = memberById(id);
      if (m) who.push(`<i style="background:${m.color}" title="${esc(m.name)}${st.by === id ? ' – cooking it' : st.s === 'done' ? ' – did it' : ' – will do it'}">${esc(m.name[0].toUpperCase())}</i>`);
    }
    let sub = '';
    if (st.s === 'active') { const m = memberById(st.by); sub = m ? `${esc(m.name)} is on it…` : ''; }
    else if (st.s === 'open' && (st.ph > 0 || st.k > 0)) sub = 'half done – pick it up!';
    else if (later) { const need = s.after.filter((a) => C.steps[a] && C.steps[a].s !== 'done').map((a) => stepDef(x, a)).filter(Boolean); sub = need.length ? `usually after: ${esc(need[0].name)}${need.length > 1 ? ` +${need.length - 1}` : ''}` : ''; }
    else if (st.s === 'open') sub = esc(planNote(planStep(C, x, S.K, s.id, S.myId)));
    else if (st.s === 'running') sub = `⏳ ${fmtTime(Math.max(0, stepDuration(C, x, S.K, s) - st.t))} left${C.speed > 1 ? ` · ${C.speed}×` : ''}`;
    else if (st.s === 'ready') sub = '⏰ ready!';
    else if (st.s === 'locked') { const need = (s.do === 'serve' ? x.steps.filter((o) => o.id !== s.id) : s.after.map((a) => stepDef(x, a))).filter((o) => o && C.steps[o.id] && !['done', 'ready'].includes(C.steps[o.id].s)); sub = need.length ? `after: ${esc(need[0].name)}${need.length > 1 ? ` +${need.length - 1}` : ''}` : s.do === 'serve' && todo.length ? 'after: cleaning up 🧽' : ''; }
    const canAct = st.s === 'open' || (st.s === 'active' && st.by === S.myId);
    const acts = [];
    if (st.s !== 'done' && s.do !== 'wait') acts.push(`<button data-claim="${s.id}" class="${st.claim.includes(S.myId) ? 'on' : ''}" title="I’ll do this">✋</button>`);
    if (canAct) acts.push(`<button data-go="${s.id}" class="go ${S.sel === s.id ? 'on' : ''}" title="Where do I do this?">📍</button>`);
    let bar = '';
    if (st.s === 'running') bar = `<div class="bar"><i style="width:${Math.min(100, st.t / stepDuration(C, x, S.K, s) * 100)}%"></i></div>`;
    html.push(`<li class="${cls.join(' ')}" data-sid="${s.id}"><span class="ic">${st.s === 'done' ? '✅' : st.s === 'locked' ? '🔒' : stepIcon(s)}</span><span class="nm">${esc(s.name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="who">${who.join('')}</span><span class="acts">${acts.join('')}</span>${bar}</li>`);
  }
  $('steps').innerHTML = html.join('');
  // keep the next thing to do in sight
  const next = $('steps').querySelector('li.active, li.open, li.ready, li.running');
  if (next && (fresh.length || !S.sheetScrolled)) { S.sheetScrolled = true; next.scrollIntoView({ block: 'nearest', behavior: fresh.length ? 'smooth' : 'auto' }); }
}

function drawDishMini(r) {
  const c = $('dishMini');
  if (c.dataset.r === r.id) return;
  c.dataset.r = r.id;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  try { drawDish(ctx, r.dish, c.width / 2, c.height - 8, 0.45, 0); } catch { /* art not ready */ }
}

$('steps').addEventListener('click', (e) => {
  // (⏭ on the dishwasher, on the clean-up line)
  const sk = e.target.closest('[data-skipdw]');
  if (sk) { sfx.unlock(); send({ t: 'skipdw', fx: sk.dataset.skipdw }); sfx.play('whoosh'); return; }
  const b = e.target.closest('button');
  const li = e.target.closest('li');
  sfx.unlock();
  if (b && b.dataset.claim) { send({ t: 'claim', sid: b.dataset.claim }); sfx.play('ui'); return; }
  if (b && b.dataset.go) { pointTo(b.dataset.go); return; }
  if (li) { S.sel = S.sel === li.dataset.sid ? null : li.dataset.sid; S.sheetDirty = true; }
});

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ doing things

// 📍 on the sheet: point out where a step can be done (golden arrows); the
// cook walks there with the keys / stick and presses Use.
function pointTo(sid) {
  const C = S.M.cook, x = S.x, K = S.K;
  if (!C || !x) return;
  const s = stepDef(x, sid);
  if (!s) return;
  if (S.sel === sid) { S.sel = null; S.sheetDirty = true; return; }
  S.sel = sid;
  S.sheetDirty = true;
  sfx.play('ui');
  if (carrying(C, S.myId)) { toast('Your hands are full of scraps – take them to a bin first 🗑️'); return; }
  const p = planStep(C, x, K, sid, S.myId);
  if (!p) return;
  if (p.do === 'wait') { toast(p.why); return; }
  toast(`📍 ${planText(p)} – walk to the glowing spot and press ${touchUI ? 'Use' : 'E'}`, 3200);
}

// what the plan says, for people
function planText(p) {
  const C = S.M.cook, x = S.x;
  const f = p.fx && fixtureById(S.K, splitPlace(p.fx)[0]), B = p.fx && S.K.bays && S.K.bays[p.fx];
  const where = f ? FIXTURES[f.type].name.toLowerCase() : 'counter';
  switch (p.do) {
    case 'take': return p.store ? `Get the ${thingName(C, x, p.key)} ${B ? `out of the ${B.name}` : f && f.type === 'fridge' ? 'from the fridge' : 'off the pantry shelf'}` : `Pick up the ${thingName(C, x, p.key)} from the ${where}`;
    case 'put': return `Put down what you’re holding${f ? ` on the ${where}` : ''}`;
    case 'go': return `Everything’s ready at the ${where}`;
    case 'room': return `Make room on the ${where}: stand its board up at the back`;
    case 'lay': return `Lay the board down on the ${where}`;
    case 'bin': return 'Take your scraps to a bin first';
    default: return p.why || '';
  }
}
// short, for the recipe sheet: where its things are
function planNote(p) {
  if (!p || p.do === 'go') return '';
  const C = S.M.cook, x = S.x;
  if (p.do === 'take') {
    const f = fixtureById(S.K, splitPlace(p.fx)[0]), B = S.K.bays && S.K.bays[p.fx];
    return `${thingEmoji(C, p.key)} ${thingName(C, x, p.key)}: ${p.store ? (B ? `in the ${B.name}` : f && f.type === 'fridge' ? 'in the fridge' : 'on the shelf') : `on the ${f ? FIXTURES[f.type].name.toLowerCase() : 'counter'}`}`;
  }
  if (p.do === 'put') return '🤲 hands full – put down first';
  return p.why || '';
}

// Pick up / put down (instant: you're standing there)
function doAct(act, what, fx, hand = -1) {
  const f = fixtureById(S.K, fx);
  if (!f) return;
  closeMenu();
  if (!S.fp) S.me.yaw = yawTo(f); // (first person: where I look is mine)
  // first person, one hand: it takes, or puts down what it holds
  if (S.fp && hand >= 0 && act === 'put' && !what && scene.fpSlots[hand]) what = scene.fpSlots[hand];
  if (S.fp && act === 'take') wantHand(what, hand);
  for (const w of Array.isArray(what) ? what : [what]) send({ t: act, what: w, fx });
  sfx.play(act === 'take' ? 'pop' : 'clunk', 0.7);
}

// Start a job at a fixture (the cook is standing at it).
function startJob(sid, fx) {
  const f = fixtureById(S.K, fx);
  if (!f) return;
  closeMenu();
  if (S.working) closeStation();
  S.me.yaw = yawTo(f);
  S.pending = { sid, fx };
  send({ t: 'open', sid, fx });
  sfx.play('ui');
}

// for the test robot: step up to a fixture and start a job there
function goDo(sid, fx) {
  const f = fixtureById(S.K, fx);
  if (!f) return;
  Object.assign(S.me, { x: f.stand.x + 0.5, y: f.stand.y + 0.5, walk: -1, v: { x: 0, y: 0 } });
  startJob(sid, fx);
}

function yawTo(f) {
  const cx = Math.max(f.x, Math.min(f.x + f.w, S.me.x)), cz = Math.max(f.y, Math.min(f.y + f.h, S.me.y));
  const dx = cx - S.me.x, dz = cz - S.me.y;
  if (Math.hypot(dx, dz) < 1e-3) return f.face === 'e' ? -Math.PI / 2 : Math.PI;
  return Math.atan2(dx, dz);
}

// A cook is a circle; fixtures fill whole squares.
function blocked(K, x, y) {
  if (x < FIX_R || y < FIX_R || x > K.w - FIX_R || y > K.h - FIX_R) return true;
  for (let ty = Math.floor(y - FIX_R); ty <= Math.floor(y + FIX_R); ty++) {
    for (let tx = Math.floor(x - FIX_R); tx <= Math.floor(x + FIX_R); tx++) {
      if (tx < 0 || ty < 0 || tx >= K.w || ty >= K.h || !K.solid[ty][tx]) continue;
      const cx = Math.max(tx, Math.min(tx + 1, x)), cy = Math.max(ty, Math.min(ty + 1, y));
      if ((x - cx) ** 2 + (y - cy) ** 2 < FIX_R * FIX_R) return true;
    }
  }
  return false;
}

// The cook speeds up and slows down rather than starting and stopping dead,
// and faces where you steer at once (the figure turns into it smoothly).
function moveMe(dt) {
  const me = S.me;
  const v = me.v;
  let wx = 0, wy = 0;
  const still = S.working || !$('modal').hidden || !$('menu').hidden;
  const d = still ? { mag: 0 } : controls.dir();
  // (first person: turning gets up to speed and settles rather than starting and stopping dead)
  let turn = still ? 0 : -controls.turnDir() * TURN;
  if (d.mag && S.fp) {
    // first person: up / down walk forward / back; the keys' left / right
    // (A / D) step sideways, the stick's turn – but facing a counter (the
    // stove, the sink …) close up, the stick steps sideways along it, squared up to it
    // (slower crouching or up on your toes)
    const slow = S.eyeOff < -0.1 ? 0.5 : S.eyeOff > 0.05 ? 0.7 : 1;
    const fwd = -d.y * d.mag * slow;
    wx = Math.sin(me.yaw) * fwd * SPEED; wy = Math.cos(me.yaw) * fwd * SPEED;
    if (!d.stick) {
      const side = d.x * d.mag * SPEED * 0.85 * slow;
      wx += -Math.cos(me.yaw) * side; wy += Math.sin(me.yaw) * side;
    } else if (benchAhead()) {
      const side = d.x * d.mag * SPEED * 0.8;
      wx += -Math.cos(me.yaw) * side; wy += Math.sin(me.yaw) * side;
      if (Math.abs(d.x) > 0.3) {
        const square = Math.round(me.yaw / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(square - me.yaw) < 0.6) me.yaw += (square - me.yaw) * (1 - Math.exp(-dt * 5));
      }
    } else turn = -d.x * TURN * Math.min(1, d.mag + 0.2);
  } else if (d.mag) {
    // the stick / keys are in screen space: turn them into kitchen directions
    const ax = scene.screenAxes();
    const det = ax.x[0] * ax.z[1] - ax.x[1] * ax.z[0];
    if (Math.abs(det) > 1e-6) {
      let u = (d.x * ax.z[1] - d.y * ax.z[0]) / det, w = (ax.x[0] * d.y - ax.x[1] * d.x) / det;
      const n = Math.hypot(u, w) || 1; u /= n; w /= n;
      wx = u * SPEED * d.mag; wy = w * SPEED * d.mag;
      me.yaw = Math.atan2(u, w);
    }
  }
  // first person, starting work: I step up to the counter
  if (S.workGo && S.working) {
    const k2 = 1 - Math.exp(-dt * 7);
    me.x += (S.workGo.x - me.x) * k2; me.y += (S.workGo.y - me.y) * k2;
    if (Math.hypot(S.workGo.x - me.x, S.workGo.y - me.y) < 0.005) S.workGo = null;
  } else S.workGo = null;
  // first person: how high I stand – crouching (Ctrl / C), up on my toes (Space) – eases there
  const stance = controls.stance();
  // (looking down into a low cupboard I've opened, standing still: I bend down to see in)
  const lowBays = S.target && S.M.cook && S.M.cook.fx[S.target.id] && S.M.cook.fx[S.target.id].bays;
  const bend = S.fp && !S.working && S.pitch < -0.5 && lowBays && (lowBays.c0 || lowBays.c1) && !(v.x || v.y) ? BEND : 0;
  const wantOff = stance < 0 ? CROUCH : stance > 0 ? TIPTOE : bend;
  S.eyeOff = (S.eyeOff || 0) + (wantOff - (S.eyeOff || 0)) * (1 - Math.exp(-dt * 9));
  me.turn = (me.turn || 0) + (turn - (me.turn || 0)) * (1 - Math.exp(-dt * (turn ? TURN_UP : TURN_DOWN)));
  if (!S.fp || (!turn && Math.abs(me.turn) < 0.01)) me.turn = 0;
  me.yaw += me.turn * dt;
  const k = 1 - Math.exp(-dt * (wx || wy ? ACCEL : BRAKE));
  v.x += (wx - v.x) * k; v.y += (wy - v.y) * k;
  if (!(wx || wy) && Math.hypot(v.x, v.y) < 0.05) v.x = v.y = 0;
  const K = S.K;
  // (blocked: as far as it goes – up to the counter, not a whole step short of it)
  const upTo = (dx, dy) => { let k = 1; for (let i = 0; i < 6 && blocked(K, me.x + dx * k, me.y + dy * k); i++) k /= 2; return blocked(K, me.x + dx * k, me.y + dy * k) ? 0 : k; };
  if (v.x) { const k = upTo(v.x * dt, 0); me.x += v.x * dt * k; if (k < 1) v.x = 0; }
  if (v.y) { const k = upTo(0, v.y * dt); me.y += v.y * dt * k; if (k < 1) v.y = 0; }
  me.walk = v.x || v.y ? 0 : -1;
}

// Is a counter (any fixture) just in front of me, where I face?
function benchAhead() {
  const me = S.me, K = S.K;
  for (const r of [0.3, 0.45, 0.6, 0.72]) {
    const x = me.x + Math.sin(me.yaw) * r, y = me.y + Math.cos(me.yaw) * r;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx >= 0 && ty >= 0 && tx < K.w && ty < K.h && K.solid[ty][tx]) return true;
  }
  return false;
}

// The fixture right in front of me (close, and roughly where I face).
function findTarget() {
  const me = S.me, K = S.K;
  let best = null, bestScore = 0.7;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
  for (const f of K.fixtures) {
    if (!f.caps.length) continue;
    const cx = Math.max(f.x, Math.min(f.x + f.w, me.x)), cz = Math.max(f.y, Math.min(f.y + f.h, me.y));
    const dx = cx - me.x, dz = cz - me.y;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.72) continue;
    // which way it is: towards its middle (a corner fridge is "that way", not just its nearest edge)
    const mx = f.x + f.w / 2 - me.x, mz = f.y + f.h / 2 - me.y, md = Math.hypot(mx, mz);
    const facing = md > 1e-3 ? (mx * fx + mz * fz) / md : 1;
    if (facing < -0.1) continue;
    const score = dist - facing * 0.8;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

// E / Space / the Use button (first person: E my main hand, Q the other)
function useNow(hand = -1) {
  sfx.unlock();
  if (!$('menu').hidden) { const bs = [...$('menu').querySelectorAll('button:not([disabled])')]; const b = bs[S.menuSel] || bs[0]; if (b) b.click(); return; }
  if (S.working || !$('modal').hidden) return;
  // (first person: what I'm pointing at – a drawer, a cupboard, a thing in one, a tool lying about, a worktop to
  // put down on)
  const pt = fpPointed(hand >= 0 ? hand : S.mainHand);
  if (pt) { fpPointAct(pt, hand); return; }
  const f = S.target;
  const pick = f && bestJob(f);
  if (pick) { runJob(pick, f, hand); return; }
  // nothing comes of it: (first person) the hand just reaches out and touches what's there
  if (S.fp) touchThere(f, hand);
}
function touchThere(f, hand) {
  const sl = scene.fpSlots;
  const i = hand >= 0 && sl[hand] == null ? hand : sl[S.mainHand] == null ? S.mainHand : sl[1 - S.mainHand] == null ? 1 - S.mainHand : -1;
  const w = i >= 0 && scene.touchPoint(f && f.id);
  if (w) scene.fpArms.reach(i, { key: null, take: false, hold: 'hand', world: w });
}

// Q / ⋯: every option where I stand
function moreNow() {
  sfx.unlock();
  if (!$('menu').hidden) { closeMenu(); return; }
  if (S.working || !$('modal').hidden) return;
  const f = S.target;
  if (f && jobsAt(f).length) openMenu(f);
}

// What E does here, without asking (Q – ⋯ on a touch screen – lists every
// option): the fridge / pantry opens; scraps in my hands go in the bin; the
// next move for the step I pointed at (📍) if it's here; else the first step of
// the recipe I can do here with what I hold / what's here; else I put down
// what I hold, or pick up what's lying here.
function bestJob(f, all = jobsAt(f)) {
  const C = S.M.cook, x = S.x;
  const jobs = all.filter((j) => !j.off);
  const store = jobs.find((j) => j.store);
  if (store) return store;
  if (C && carrying(C, S.myId)) return jobs.find((j) => j.sid && j.sid.startsWith('#toss')) || jobs.find((j) => j.sid && j.sid.startsWith('#bag')) || null;
  if (S.sel && C && x) {
    const p = planStep(C, x, S.K, S.sel, S.myId);
    if (p && p.fx === f.id) {
      const j = p.do === 'go' ? jobs.find((q) => q.sid === S.sel)
        : p.do === 'room' || p.do === 'lay' ? jobs.find((q) => q.sid === choreId(p.do, f.id))
        : p.do === 'put' ? jobs.find((q) => q.act === 'put')
          : p.do === 'take' ? jobs.find((q) => q.what === p.key || (p.store && q.store)) : null;
      if (j) return j;
    }
  }
  const held = C ? heldBy(C, S.myId) : [];
  // (a step ahead of the recipe's order only if I've brought what it's for – never by surprise)
  const steps = jobs.filter((j) => j.sid && j.sid[0] !== '#' && (!j.early || j.uses)).sort((a, b) => a.early - b.early || a.idx - b.idx);
  const using = steps.filter((j) => j.uses);
  if (held.length && using.length) return using[0];
  // a burner left on: off it goes (with the free hand – the pan can stay in the other)
  const knob = jobs.find((j) => j.sid && j.sid.startsWith('#knob'));
  if (knob) return knob;
  const dwRun = !held.length && jobs.find((j) => j.sid && j.sid.startsWith('#dw@'));
  if (dwRun) return dwRun;
  if (held.length) { const put = jobs.find((j) => j.act === 'put'); if (put) return put; }
  if (steps.length) return steps[0];
  // pick up what's lying here – all of it that fits in my hands
  const takes = jobs.filter((j) => j.act === 'take');
  if (takes.length) {
    const items = takes.filter((j) => j.what[0] === 'i');
    const free = HANDS - handsUsed(C, S.myId);
    if (items.length > 1 && free > 1) {
      const keys = items.slice(0, free).map((j) => j.what);
      return { act: 'take', what: keys, label: `${keys.map((k) => thingEmoji(C, k)).join('')} Pick up the ${keys.map((k) => thingName(C, x, k)).join(', ')}` };
    }
    return takes[0];
  }
  return jobs.find((j) => j.sid && j.sid[0] === '#') || jobs[0] || null;
}
function runJob(j, f, hand = -1) {
  if (j.store) openStore(f.id, hand);
  else if (j.act) doAct(j.act, j.what, f.id, hand);
  else startJob(j.sid, f.id);
}

function sendPos(now) {
  const me = S.me;
  const p = S.working && S.pose ? { ...S.pose, fx: S.working.fx } : null;
  const key = `${me.x.toFixed(2)},${me.y.toFixed(2)},${me.yaw.toFixed(2)},${me.walk >= 0},${p ? `${p.tool}${p.a.toFixed(2)}${(p.b || 0).toFixed(2)}${p.mode}` : ''}`;
  const changed = key !== S.lastPosKey;
  if ((changed && now - S.lastPos > 90) || now - S.lastPos > 2000) {
    S.lastPos = now; S.lastPosKey = key;
    send({ t: 'pos', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, d: Math.round(me.yaw * 100) / 100, w: me.walk >= 0 ? 1 : 0, p, ts: Math.round(now) });
  }
}

// ------------------------------------------------------------------ the station

// the close-up zooms in from where the fixture is in the kitchen
function zoomFrom(f) {
  const el = $('station');
  const at = scene.project(f.x + f.w / 2, 0.5, f.y + f.h / 2);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--ox', `${at.x - r.left}px`);
  el.style.setProperty('--oy', `${at.y - r.top}px`);
  el.classList.remove('zoom'); void el.offsetWidth; el.classList.add('zoom');
}

// ------------------------------------------------------------------ first person: hands on things
// In first person there's no close-up for the fridge or the pantry: you do it
// right there in the kitchen. Take the handle and swing the door (or E, the
// door you look at); click / tap a thing on a shelf – or look at it and press
// E – and your hand takes it; drag a thing from your hand onto a shelf, or
// look at the shelf and press E, to put it there; drag things about on the
// shelves to arrange them.
function myHeld() { return S.M.cook ? heldBy(S.M.cook, S.myId) : []; }
// a free hand (the one asked for – 1 right, 0 left – if it is free; -1: none)
function freeHandSlot(want = -1) { const sl = scene.fpSlots, M = S.mainHand; return want >= 0 && sl[want] == null ? want : sl[M] == null ? M : sl[1 - M] == null ? 1 - M : -1; }
// what's taken goes into the hand that took it (E my main hand, Q the other)
function wantHand(keys, hand) {
  if (hand < 0) return;
  [keys].flat().forEach((k, n) => scene.fpWant.set(k, n ? 1 - hand : hand));
}
function fpGrab(e, hand = -1) {
  const pick = scene.fpPick(e.clientX, e.clientY, S.me, myHeld());
  if (!pick) return;
  if (pick.kind === 'bay' || pick.kind === 'bayIn') { touches.delete(e.pointerId); fpPointAct(pick, hand); return; }
  if (pick.kind === 'door' && freeHandSlot() < 0) { toast('Both your hands are full – put something down first, then come back for the door'); return; }
  S.fpDrag = { ...pick, pid: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, sent: 0, hand: pick.kind === 'door' ? freeHandSlot(hand) : hand };
  touches.delete(e.pointerId); // (not looking round)
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } // (let go over anything)
  canvas.style.cursor = 'grabbing';
  if (pick.kind === 'door') { S.fpDrag.v = scene.doorOpenness(pick.fx); sfx.play('door', 0.5); } else sfx.play('grab', 0.5);
}
function fpDragTo(cx, cy) {
  const d = S.fpDrag;
  if (Math.hypot(cx - d.x0, cy - d.y0) > 12) d.moved = true;
  if (d.kind === 'door') {
    d.v = scene.doorAt(d.fx, cx, cy);
    const now = performance.now();
    if (now - d.sent > 100) { d.sent = now; send({ t: 'door', fx: d.fx, v: d.v }); }
  } else {
    // carrying it over the shelves: where it would go
    const fxs = d.fx ? [d.fx] : storesNear();
    d.spot = null;
    for (const fx of fxs) { const sp = scene.shelfSpotAt(fx, cx, cy); if (sp) { d.spot = { ...sp, fx }; break; } }
    d.cx = cx; d.cy = cy;
  }
}
function fpLetGo(cx, cy, cancel) {
  const d = S.fpDrag;
  S.fpDrag = null;
  canvas.style.cursor = '';
  if (cancel) return;
  if (d.kind === 'door') {
    const v = d.v >= 0.5 ? 1 : 0;
    send({ t: 'door', fx: d.fx, v, done: true });
    sfx.play(v ? 'door' : 'clunk', 0.6);
  } else if (d.kind === 'thing') {
    if (d.moved && d.spot && d.spot.fx === d.fx) send({ t: 'arrange', what: d.key, fx: d.fx, r: d.spot.r, x: d.spot.x });
    else { wantHand(d.key, d.hand); send({ t: 'take', what: d.key, fx: d.fx }); }
  } else if (d.kind === 'held') {
    if (d.spot) { send({ t: 'put', what: d.key, fx: d.spot.fx, r: d.spot.r, x: d.spot.x }); sfx.play('clunk', 0.5); }
  } else if (d.kind === 'shelf') { /* (pressed on a bare shelf: nothing to do) */ }
}
function storesNear() { return S.K.fixtures.filter((f) => isStore(f) && Math.hypot(Math.max(f.x, Math.min(f.x + f.w, S.me.x)) - S.me.x, Math.max(f.y, Math.min(f.y + f.h, S.me.y)) - S.me.y) < 1.3).map((f) => f.id); }
// first person: the fridge / pantry I'm looking into (its handle, a shelf, a thing on one)
function fpLookTarget() {
  const cross = $('cross');
  cross.hidden = !S.fp || !!S.working;
  if (!S.fp) return null;
  const c = scene.viewCenter();
  cross.style.left = `${c.x}px`; cross.style.top = `${c.y}px`;
  const pick = scene.fpPick(c.x, c.y, S.me, []);
  cross.classList.toggle('on', !!pick && pick.kind !== 'shelf');
  return pick && pick.fx ? fixtureById(S.K, splitPlace(pick.fx)[0]) : null;
}
// First person: what's pointed at among the cupboards, drawers and the things kept in them or lying
// about (scene3d.bayPick) – with what E would do there – or null.
// (hand: whose – a hand holding something, aimed at a worktop, puts it down just there)
function fpPointed(hand = S.mainHand) {
  if (!S.fp || S.working || !S.M.cook) return null;
  const c = scene.viewCenter();
  const res = fpPointedAt(c);
  const k = hand >= 0 ? scene.fpSlots[hand] : null;
  // (into the oven, its door open)
  const oi = k && k[0] === 'v' && scene.ovenPick(c.x, c.y, S.me, true);
  if (oi && oi.kind === 'surface') return { ...oi, key: k };
  // (on a worktop – not into an open drawer, a cupboard, the crock: the board's own places for its knife … are on it)
  // (the stack of containers beside a board too – unless it's an empty one I hold: that goes on the stack)
  const boxIn = k && k[0] === 'u' && S.M.cook.tools[k.slice(2)] && S.M.cook.tools[k.slice(2)].kind === 'box';
  const onTop = !res || ((res.kind === 'thing' || res.kind === 'bay' || res.kind === 'bayIn') && (!res.fx.includes('/') || res.fx.endsWith('/board') || (res.fx.endsWith('/nest') && !boxIn)));
  // (not at the fridge, the pantry – its door, its shelves, what's on them: that's taking from it, putting in it)
  const raw = k && onTop ? scene.fpPick(c.x, c.y, S.me, myHeld(), { withHeld: false }) : null;
  const atStore = raw && (raw.kind === 'door' || raw.kind === 'shelf' || raw.kind === 'store' || (raw.kind === 'thing' && raw.fx && isStore(fixtureById(S.K, splitPlace(raw.fx)[0]))));
  if (k && onTop && !atStore) {
    const sp = scene.surfacePick(c.x, c.y, S.me);
    // (food goes on a worktop, a table, in the sink – not on a bare burner)
    if (sp && !(k[0] === 'i' && sp.slot != null)) return { ...sp, key: k };
  }
  return res;
}
function fpPointedAt(c) {
  // (a stove's knob, an oven's dial: to turn; an oven's door handle)
  const kn = scene.knobPick(c.x, c.y, S.me);
  if (kn) return kn;
  const od = scene.ovenPick(c.x, c.y, S.me, false);
  if (od) return od;
  // (one of a bunch in its container: a lemon of the lemons – the container itself further out)
  const pc = scene.piecePick(c.x, c.y, S.me);
  if (pc) return pc;
  // (the oven gloves on: at where they lie beside the oven – to hang them back)
  if (glovesOn(S.M.cook, S.myId)) { const g = scene.glovesSpotAt(c.x, c.y); if (g) return { kind: 'hangGloves', fx: g.fx, w: g.w }; }
  const pick = scene.fpPick(c.x, c.y, S.me, myHeld(), { withHeld: false }); // (past what's in my hands)
  if (!pick) return null;
  if (pick.kind === 'bay' || pick.kind === 'bayIn') return pick;
  // (no hand free, at something in a drawer or a cupboard: what I hold goes in there instead)
  if (pick.kind === 'thing' && pick.fx.includes('/') && handsUsed(S.M.cook, S.myId) >= HANDS) return { kind: 'bayIn', fx: pick.fx, spot: null, w: pick.w };
  // (a thing in a drawer, a cupboard, the crock … or a tool lying on a worktop – not the fridge's: that's fpStoreLook)
  if (pick.kind === 'thing' && (pick.fx.includes('/') || pick.key[0] === 'u' || !isStore(fixtureById(S.K, pick.fx)))) return pick;
  return null;
}
function placeName(id) { const B = S.K.bays && S.K.bays[id]; return B ? B.name : 'cupboard'; }
// the oven gloves: put on (not held) – not taken in a hand
const isGloves = (key) => { const t = key && key[0] === 'u' && S.M.cook && (S.M.cook.tools || {})[key.slice(2)]; return !!(t && TOOLS[t.kind] && TOOLS[t.kind].worn); };
function fpPointLabel(pt) {
  const C = S.M.cook;
  if (pt.kind === 'work') return pt.label;
  if (pt.kind === 'piece') { const it = C.items[pt.key.slice(2)]; return `${thingEmoji(C, pt.key)} Take ${it && it.kind ? `a${/^[aeiou]/i.test(ingName(it.kind, 1)) ? 'n' : ''} ${ingName(it.kind, 1).toLowerCase()}` : 'one'}`; }
  if (pt.kind === 'merge') return `${thingEmoji(C, pt.what)} Put the ${thingName(C, S.x, pt.what)} in with the ${thingName(C, S.x, pt.into)}`;
  if (pt.kind === 'knob') return `🔥 Turn the ${fixtureById(S.K, pt.fx) && fixtureById(S.K, pt.fx).type === 'oven' ? 'oven' : 'knob'} – ${KNOB_NAMES[pt.level]} (hold and move the mouse)`;
  if (pt.kind === 'ovenDoor') return `${pt.open ? 'Shut' : 'Open'} the oven`;
  if (pt.kind === 'surface') return `${thingEmoji(C, pt.key)} Put the ${thingName(C, S.x, pt.key)} ${pt.inside ? 'in the oven' : pt.sink ? 'in the sink' : pt.slot != null ? 'on this burner' : 'here'}`;
  if (pt.kind === 'hangGloves') return '🧤 Hang up the oven gloves';
  if (pt.kind === 'thing' && isGloves(pt.key)) return '🧤 Put on the oven gloves';
  if (pt.kind === 'bay') return `${pt.open ? 'Shut' : 'Open'} the ${placeName(pt.fx)}`;
  if (pt.kind === 'bayIn') { const k = fpPutWhat(-1); return k ? `${thingEmoji(C, k)} Put the ${thingName(C, S.x, k)} ${pt.fx.endsWith('/nest') ? 'back on the stack' : `in the ${placeName(pt.fx)}`}` : ''; }
  return `${thingEmoji(C, pt.key)} Take the ${thingName(C, S.x, pt.key)}`;
}
// what goes in when I put something away (the hand asked for – 1 right, 0 left – if it holds something)
function fpPutWhat(hand) {
  const sl = scene.fpSlots, held = myHeld(), M = S.mainHand;
  return (hand >= 0 && (sl[hand] || sl[1 - hand])) || sl[M] || sl[1 - M] || held[0] || null;
}
// do it: open / shut it (a free hand on its handle), put what I hold in it, take the thing
function fpPointAct(pt, hand = -1) {
  // (the gloves on / off: both hands to them – free of anything else first)
  if (pt.kind === 'hangGloves' || (pt.kind === 'thing' && isGloves(pt.key))) {
    const on = pt.kind === 'thing';
    if (handsUsed(S.M.cook, S.myId) > 0) { toast(on ? 'Put down what you hold first – both hands go in the gloves' : 'Put down what you hold first, then hang the gloves up'); return; }
    const w = pt.w || (on && scene.thingWorld && scene.thingWorld(pt.key));
    if (w) for (const i of [0, 1]) scene.fpArms.reach(i, { key: null, take: false, hold: 'palm', world: w });
    send({ t: 'wear', on, fx: splitPlace(pt.fx)[0] });
    sfx.play('grab', 0.4);
    return;
  }
  if (pt.kind === 'bay') {
    const i = freeHandSlot(hand);
    if (i < 0) { toast(`Both your hands are full – put something down first, then open the ${placeName(pt.fx)}`); return; }
    if (pt.w) scene.fpArms.reach(i, { key: null, take: false, hold: 'grab', world: pt.w });
    send({ t: 'bay', id: pt.fx, v: pt.open ? 0 : 1 });
    sfx.play(pt.open ? 'clunk' : 'door', 0.5);
    return;
  }
  if (pt.kind === 'bayIn') {
    const k = fpPutWhat(hand);
    if (!k) return;
    send({ t: 'put', what: k, fx: pt.fx, ...(pt.spot ? { r: pt.spot.r, x: pt.spot.x } : {}) });
    sfx.play('clunk', 0.4);
    return;
  }
  if (pt.kind === 'work') { startJob(pt.sid, pt.fx); return; }
  if (pt.kind === 'piece') {
    // (that hand takes one out – or one more, with the same in it already)
    const i = hand >= 0 ? hand : freeHandSlot(S.mainHand);
    scene.fpWantNext = i;
    if (i >= 0 && pt.w) scene.fpArms.reach(i, { key: null, take: false, hold: 'pinch', world: pt.w });
    send({ t: 'piece', what: pt.key, fx: pt.fx });
    sfx.play('grab', 0.4);
    return;
  }
  if (pt.kind === 'merge') { send({ t: 'merge', what: pt.what, into: pt.into }); sfx.play('clunk', 0.35); return; }
  if (pt.kind === 'surface') {
    // (just there – on the board, a burner, a spot on the worktop; in the sink, into it)
    // (and facing as it was in my hand – not turned round as it lands)
    const yaw = scene.heldYaw(pt.key);
    send({ t: 'put', what: pt.key, fx: pt.fx, ...(pt.sink || pt.inside ? {} : { lay: { x: pt.w.x, y: pt.w.y, z: pt.w.z, ...(yaw != null ? { yaw } : {}) } }), ...(pt.slot != null ? { slot: pt.slot } : {}) });
    sfx.play('clunk', 0.45);
    return;
  }
  if (pt.kind === 'thing') { wantHand(pt.key, hand); send({ t: 'take', what: pt.key, fx: pt.fx }); sfx.play('grab', 0.5); }
}
// E at a store in first person: what's in the middle of the view (done
// with hand: 1 the right – E, 0 the left – Q)
function fpStoreLook(f, hand = -1) {
  const c = scene.viewCenter();
  const pick = scene.fpPick(c.x, c.y, S.me, myHeld());
  const C = S.M.cook, fridge = f.type === 'fridge', name = fridge ? 'fridge' : 'pantry';
  const open = C && C.fx[f.id] && C.fx[f.id].door;
  if (pick && pick.kind === 'thing') return { label: `${thingEmoji(C, pick.key)} Take the ${thingName(C, S.x, pick.key)}`, run: () => { wantHand(pick.key, hand); send({ t: 'take', what: pick.key, fx: pick.fx }); } };
  const held = myHeld();
  if (pick && pick.kind === 'shelf' && held.length) {
    const k = fpPutWhat(hand) || held[0];
    return { label: `${thingEmoji(C, k)} Put the ${thingName(C, S.x, k)} here`, run: () => { send({ t: 'put', what: k, fx: pick.fx, r: pick.r, x: pick.x }); sfx.play('clunk', 0.5); } };
  }
  return {
    label: `${fridge ? '🧊' : '🫙'} ${open ? 'Shut' : 'Open'} the ${name}`,
    run: () => {
      const i = freeHandSlot(hand);
      if (i < 0) { toast('Both your hands are full – put something down first, then come back for the door'); return; }
      const w = scene.handleWorld(f.id);
      if (w) scene.fpArms.reach(i, { key: null, take: false, hold: 'grab', world: w });
      send({ t: 'door', fx: f.id, v: open ? 0 : 1, done: true });
      sfx.play(open ? 'clunk' : 'door', 0.6);
    },
  };
}

// The fridge / the pantry, close up: open it by the handle, take what you
// need, put things back, swing it shut.
function openStore(fx, hand = -1) {
  const C = S.M.cook, x = S.x, K = S.K;
  const f = fixtureById(K, fx);
  if (!f || !C || !x) return;
  if (S.fp) { fpStoreLook(f, hand).run(); return; } // (first person: right there in the kitchen)
  closeMenu();
  if (S.working) closeStation(true);
  S.me.yaw = yawTo(f);
  S.working = { store: true, fx: f.id, sid: null };
  zoomFrom(f);
  const fridge = f.type === 'fridge';
  // what I came for (the 📍 step's next move, if it's here)
  const p = S.sel ? planStep(C, x, K, S.sel, S.myId) : null;
  const want = p && p.do === 'take' && p.fx === f.id ? p.key : null;
  $('stIcon').textContent = fridge ? '🧊' : '🫙';
  $('stName').textContent = fridge ? 'The fridge' : 'The pantry';
  station.openStore({ f, C, x, K, me: S.myId, look: lookOf(S.profile.avatar), pal: K.palette, title: fridge ? 'The fridge' : 'The pantry', want });
  sfx.play('whoosh', 0.5);
}

function openStation(sid, fx) {
  const C = S.M.cook, x = S.x, K = S.K;
  if (S.fp) { openWork(sid, fx); return; }
  const s = stepDef(x, sid);
  // a chore's state only exists once the host has opened it
  const st = C.steps[sid] || { s: 'active', ph: 0, k: 0, v: 0, by: S.myId, fx, slot: 0, claim: [], extra: [], who: [] };
  if (!C.steps[sid]) C.steps[sid] = st;
  if (!s) return;
  const f = fixtureById(K, fx || st.fx);
  if (!f) return;
  S.pending = null;
  S.working = { sid, fx: f.id };
  const phases = phasesOf(s, bakeKind(f));
  zoomFrom(f);
  $('stIcon').textContent = (ACTIONS[s.do] && ACTIONS[s.do].icon) || '🍳';
  $('stName').textContent = s.name;
  station.open({ sid, def: s, st, phases, f, bk: bakeKind(f), pal: K.palette, C, x, K, me: S.myId, look: lookOf(S.profile.avatar) });
  sfx.play('whoosh', 0.5);
}

// First person: the step is done right there in the kitchen – the close-up's
// gestures run without drawing, your pointer on the real counter / stove /
// sink (the scene maps it), your arms and the tools in 3D; a little bar says
// what to do.
function openWork(sid, fx) {
  const C = S.M.cook, x = S.x, K = S.K;
  const s = stepDef(x, sid);
  const st = C.steps[sid] || { s: 'active', ph: 0, k: 0, v: 0, by: S.myId, fx, slot: 0, claim: [], extra: [], who: [] };
  if (!C.steps[sid]) C.steps[sid] = st;
  if (!s) return;
  const f = fixtureById(K, fx || st.fx);
  if (!f) return;
  S.pending = null;
  S.working = { sid, fx: f.id, fp: true };
  station.headless = true;
  // things put under the tap / in the colander go where the water falls in the basin
  station.targetHook = (to, vid) => {
    // (cleaning freehand: the pointer on the board's top / the pot's floor – and where that surface is, as the pointer has it)
    if (to === 'cleanUV' || to === 'cleanRect') {
      const w = workFrame(), def = station.c && station.c.def, v = station.c && station.c.st && station.c.st.vid;
      if (!w || !def) return null;
      return to === 'cleanUV' ? scene.cleanUV(w, vid, def, v) : scene.cleanRect(w, def, v);
    }
    // (the board's own knife, peeler, grater, where it lies)
    // (as the pointer has it, over it on the screen – the grater stands up at the back of the board)
    if (to.startsWith('tool:')) {
      const w = workFrame(), k = w && scene.toolSpot(w, to.slice(5));
      if (!k) return null;
      const s = scene.screenOf(k), p = scene.workAt(w, s.x, s.y);
      return p ? { x: p.x, y: p.y, r: Math.max(50, 0.04 / w.S) } : null;
    }
    // (the stack of empty containers beside the board; portioning: the bunch's container, the new one)
    if (to === 'stack' || to === 'portion' || to === 'portionFrom') {
      const w = workFrame();
      if (!w) return null;
      const P = to === 'stack' ? scene.nestSpot(w) : to === 'portion' ? scene.portionSpot(w, 1) : scene.portionSpot(w, -1);
      const s = scene.screenOf(P), p = scene.workAt(w, s.x, s.y);
      return p ? { x: p.x, y: p.y, r: Math.max(60, 0.07 / w.S) } : null;
    }
    // (several worked one at a time: the pile of those done, at the board's back right – as the pointer has it)
    if (to === 'pile') {
      const w = workFrame();
      if (!w) return null;
      const s = scene.screenOf(scene.pileSpot(w)), p = scene.workAt(w, s.x, s.y);
      return p ? { x: p.x, y: p.y, r: Math.max(60, 0.06 / w.S) } : null;
    }
    // (the food's container, standing beside the board)
    if (to === 'box') {
      const w = workFrame();
      if (!w) return null;
      const p = scene.workPoint(w, scene.boxSpot(w));
      return { x: p.x, y: p.y, r: Math.max(60, 0.075 / w.S) };
    }
    // (scooping: from the real pot – into the real plates / cups / the pockets of what's in the dish, side by side –
    // the close-up's point for each being where the pointer is when it's over it on the screen)
    if (to === 'scoopFrom' || to === 'scoopTo') {
      const w = workFrame(), def = station.c && station.c.def;
      const sw = w && def && scene.scoopWorld(w, def, vid || 2, myHeld().includes(`v:${def.from}`));
      if (!sw) return null;
      const cp = (P) => { const s = scene.screenOf(P); return scene.workAt(w, s.x, s.y) || scene.workPoint(w, P); };
      if (to === 'scoopFrom') { const p = cp(sw.from); return { x: p.x, y: p.y, r: 60 }; }
      return sw.to.map((P) => { const p = cp(P); return { x: p.x, y: p.y }; });
    }
    // (the board's knife, peeler, grater, the stack of containers: where each lies now – and where it goes, at the
    // back or back on the board – as the pointer has it over it on the screen)
    const pm = /^(at|aside|back):(knife|peeler|grater|nest)$/.exec(to);
    if (pm) {
      const w = workFrame();
      const P = w && (pm[1] === 'at' ? scene.partWorld(w.fx, pm[2]) : scene.partHome(w.fx, pm[2], pm[1] === 'aside'));
      if (!P) return null;
      const sc = scene.screenOf(P), p = scene.workAt(w, sc.x, sc.y) || scene.workPoint(w, P);
      return { x: p.x, y: p.y, r: pm[2] === 'nest' ? 90 : 60 };
    }
    // (a tray set down on the oven's worktop while the gloves went on)
    if (to === 'ovenRest') {
      const w = workFrame();
      if (!w || !scene.k3.fx[w.fx] || !scene.k3.fx[w.fx].parts.drop) return null;
      const p = scene.workPoint(w, scene.ovenRest(w));
      return { x: p.x, y: p.y, r: 80 };
    }
    // (a lid: its knob on the pot, or where it lies beside it)
    if (to === 'lidKnob' || to === 'lidAt') {
      const w = workFrame(), P = w && (to === 'lidKnob' ? scene.lidKnobWorld(vid) : scene.lidRestWorld(vid, w));
      if (!P) return null;
      const p = scene.workPoint(w, P);
      return { x: p.x, y: p.y, r: 50 };
    }
    // (into the oven, onto the fridge's shelf …: the real spot inside it – and out of it, toward me: over the open door)
    if (['ovenRack', 'shelf', 'ovenMouth', 'tandoorWall'].includes(to)) {
      const w = workFrame();
      if (!w) return null;
      const p = scene.workPoint(w, w.O);
      return { x: p.x, y: p.y, r: Math.max(80, 0.11 / w.S) };
    }
    if (to === 'aside' && ['oven', 'dome', 'tandoor', 'chill'].includes(station.sceneKind())) {
      const w = workFrame();
      if (!w) return null;
      // (out of the fridge: off to its handle's side, clear of the door as it swings shut)
      const fridge = station.sceneKind() === 'chill';
      return { x: 500 + (fridge ? 0.42 : 0) / w.S, y: 500 + (fridge ? 0.55 : 0.45) / w.S, r: Math.max(80, 0.12 / w.S) };
    }
    if (to !== 'underTap' && to !== 'colander') return null;
    const w = workFrame();
    const F = w && scene.k3.fx[w.fx];
    if (!F || !F.anchors.basin) return null;
    // (under the tap: right under the spout)
    const p = scene.workPoint(w, (to === 'underTap' && F.anchors.spout ? F.anchors.spout : F.anchors.basin).clone().setY(w.O.y));
    return { x: p.x, y: p.y, r: 110 };
  };
  $('cross').hidden = true;
  for (const h of hands) { h.ox = h.oy = 0; } // (the hand starts over the middle of the work)
  $('fwIcon').textContent = (ACTIONS[s.do] && ACTIONS[s.do].icon) || '🍳';
  $('fwName').textContent = s.name;
  $('fpWork').hidden = false;
  $('fwKeys').hidden = touchUI;
  document.body.classList.add('fpwork');
  station.open({ sid, def: s, st, phases: phasesOf(s, bakeKind(f)), f, bk: bakeKind(f), pal: K.palette, C, x, K, me: S.myId, look: lookOf(S.profile.avatar) });
  // step right up to it (a counter is a square deep: from the middle of the
  // square in front you couldn't reach the board) and look at the work
  const w = workFrame();
  if (w) {
    let gx = S.me.x, gy = S.me.y;
    if (Math.abs(w.N.z) > 0.5) { gy = f.y + (w.N.z > 0 ? f.h + FIX_R + 0.03 : -FIX_R - 0.03); gx = Math.max(f.x + 0.25, Math.min(f.x + f.w - 0.25, w.O.x)); } else { gx = f.x + (w.N.x > 0 ? f.w + FIX_R + 0.03 : -FIX_R - 0.03); gy = Math.max(f.y + 0.25, Math.min(f.y + f.h - 0.25, w.O.z)); }
    if (!blocked(K, gx, gy) && Math.hypot(gx - S.me.x, gy - S.me.y) < 1.2) S.workGo = { x: gx, y: gy };
    S.me.yaw = Math.atan2(w.O.x - gx, w.O.z - gy);
    const ex = gx - Math.sin(S.me.yaw) * (0.04 - 0.18), ez = gy - Math.cos(S.me.yaw) * (0.04 - 0.18);
    S.pitch = Math.max(-1.1, Math.atan2(w.O.y + 0.06 - 0.84, Math.hypot(w.O.x - ex, w.O.z - ez)));
  }
  sfx.play('whoosh', 0.4);
}
// the plane the work is done on, now (the slot: which burner)
// (working on a food, the close-up's picture of it is fitted to the real
// thing: its width in the close-up is its width in 3D)
function workFrame() {
  if (!S.working || !S.working.fp || !station.on || station.mode !== 'step') return null;
  const st = S.M.cook && S.M.cook.steps[S.working.sid];
  let scale = 0.001;
  const g = station.g, it = g && g.subject && g.subject.type === 'item' && station.subjectItem();
  if (it && !['drag', 'dip'].includes(g.kind)) {
    const { cut, k, n, ...whole } = it; void cut; void k; void n;
    scale = Math.max(0.00025, Math.min(0.0012, foodWidth(it.kind, whole) / Math.max(40, station.subjectBox().w)));
    S.workScale = { sid: S.working.sid, scale };
  } else if (S.workScale && S.workScale.sid === S.working.sid) scale = S.workScale.scale; // (the same all through the step: gathering it up, between phases)
  return scene.workFrame(S.working.fx, station.sceneKind(), st ? st.slot || 0 : 0, scale);
}

function closeStation(silent = false) {
  S.workPh = null;
  $('fpWork').hidden = true;
  document.body.classList.remove('fpwork');
  station.headless = false;
  station.targetHook = null;
  if (!S.working) { $('station').hidden = true; return; }
  const sid = S.working.sid;
  const st = sid && S.M.cook && S.M.cook.steps[sid];
  if (st && st.s === 'active' && st.by === S.myId) send({ t: 'close', sid });
  S.working = null;
  S.pose = null;
  station.close();
  $('station').hidden = true;
  if (!silent) sfx.play('ui');
}
$('stClose').onclick = () => closeStation();
$('fwClose').onclick = () => closeStation();

function stationProgress(info) {
  const dots = [];
  for (let i = 0; i < info.phases; i++) dots.push(`<i class="ph ${i < info.ph ? 'on' : ''}"></i>`);
  if (info.n > 1 && !info.done) {
    dots.push('<span style="width:8px"></span>');
    for (let i = 0; i < Math.min(info.n, 16); i++) dots.push(`<i class="${i < info.k ? 'on' : ''}"></i>`);
  }
  $('stDots').innerHTML = dots.join('');
  let hint = info.done ? '✅ Done! Nicely done, chef.' : info.hint;
  if (!info.done && info.n > 1) hint += `  (${info.k}/${info.n})`;
  $('stHint').textContent = hint;
  $('fwDots').innerHTML = dots.join('');
  $('fwHint').textContent = hint;
}

// ------------------------------------------------------------------ the kitchen view

const canvas = $('world');
// two fingers pinch-zoom the kitchen; the mouse wheel too
const touches = new Map();
let pinch = 0;
// first person at work: the pointer is my hand on the work (the close-up's gestures, in 3D)
const workPtr = (type, e) => {
  const w = workFrame();
  // (a door: you take its real handle – how far open it is, from where the pointer is along its swing)
  const g = station.g, door = w && g && g.kind === 'door' && scene.doorHandleAt(w.fx, g.v || 0);
  if (door) {
    const now = scene.screenOf(door), hit = scene.doorVAt(w.fx, e.clientX, e.clientY);
    const near = Math.hypot(now.x - e.clientX, now.y - e.clientY) < 70;
    const p = g.drag ? station.doorGrab(g.geo, hit.v) : near ? station.doorGrab(g.geo, g.v || 0) : { x: -999, y: -999 };
    station.pointer(type, p, e.pointerId, e.pointerType);
    return;
  }
  // (the knob / the tap's lever: the real one is what you take hold of)
  const off = w ? scene.workOffset(w, station) : { x: 0, y: 0 };
  const p = w && scene.workAt(w, e.clientX + off.x, e.clientY + off.y);
  if (p) station.pointer(type, p, e.pointerId, e.pointerType);
  else if (type === 'up') station.pointer('up', { x: station.ptr.x, y: station.ptr.y }, e.pointerId, e.pointerType);
};
canvas.addEventListener('pointerdown', (e) => {
  if (locked()) return; // (the mouse is captured: its buttons are hands – below)
  sfx.unlock(); closeMenu();
  // first person with a mouse: a click captures it, to look round with
  if (S.fp && !touchUI && e.pointerType === 'mouse' && e.isTrusted && lockFails < 2) { e.preventDefault(); lockMouse(); return; }
  if (S.working && S.working.fp) { e.preventDefault(); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } workPtr('down', e); return; }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // first person: a hand takes hold of what's under the pointer (else you look round)
  if (S.fp && touches.size === 1 && !S.working) fpGrab(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (locked()) { mouseMoved(e.movementX || 0, e.movementY || 0); return; }
  if (S.working && S.working.fp) { workPtr('move', e); return; }
  if (S.fpDrag && S.fpDrag.pid === e.pointerId) { fpDragTo(e.clientX, e.clientY); return; }
  if (!touches.has(e.pointerId)) {
    // (the mouse over something a hand could take)
    if (S.fp && e.pointerType === 'mouse' && !S.working) canvas.style.cursor = scene.fpPick(e.clientX, e.clientY, S.me, myHeld()) ? 'grab' : '';
    return;
  }
  const was = touches.get(e.pointerId);
  if (S.fp && touches.size === 1) {
    // first person: drag to look round and up / down
    S.me.yaw -= (e.clientX - was.x) * 0.006;
    S.pitch = Math.max(-1.1, Math.min(0.6, S.pitch - (e.clientY - was.y) * 0.005));
  }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) scene.zoomBy(d / pinch);
    pinch = d;
  }
});
const lift = (e) => {
  if (locked()) return;
  if (S.working && S.working.fp) workPtr('up', e);
  touches.delete(e.pointerId); if (touches.size < 2) pinch = 0;
  if (S.fpDrag && S.fpDrag.pid === e.pointerId) fpLetGo(e.clientX, e.clientY, e.type === 'pointercancel');
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); scene.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

// First person with a mouse, as in a shooter: click the kitchen and the mouse
// is captured – it looks round, and the dot in the middle is what you aim
// at. E (or the left button) is your main hand – the right, unless you've said you're left-handed –, Q (or
// the right button) the other: press one on a thing and that hand takes hold of it (the door's
// handle, a thing on a shelf, the food on the board …) and while you hold
// the key the mouse moves that hand instead of the view; let go and it lets
// go. Esc frees the mouse.
const locked = () => document.pointerLockElement === canvas;
const LOOK = 0.004; // (radians a pixel of mouse)
const HAND_ID = ['kq', 'ke']; // (the left, the right hand: their pointer ids)
const hands = [{ down: false, ox: 0, oy: 0, act: null }, { down: false, ox: 0, oy: 0, act: null }];
let moving = -1; // the hand the mouse moves (-1: the view)
let hover = S.mainHand; // the hand last used (it hovers where I look)
let lockFails = 0;
function lockMouse() {
  if (!canvas.requestPointerLock) { lockFails = 2; return; }
  // (the mouse moves as the desktop's pointer does: its speed and acceleration)
  let r;
  try { r = canvas.requestPointerLock(); } catch { lockFails++; return; }
  if (r && r.then) r.then(() => { lockFails = 0; }, () => { lockFails++; });
}
let unlockT = 0;
document.addEventListener('pointerlockchange', () => {
  if (locked()) { canvas.style.cursor = 'none'; return; }
  unlockT = performance.now();
  canvas.style.cursor = '';
  for (const i of [0, 1]) handUp(i);
  if (S.fp && !touchUI && !S.unlocking) toast('🖱 Click the kitchen to look round with the mouse again', 2200);
  S.unlocking = false;
});
function unlockMouse() { if (locked()) { S.unlocking = true; document.exitPointerLock(); } }
// where hand i is on the screen: the dot, or as far as the mouse has moved it
function handAt(i) {
  const c = scene.viewCenter();
  return { clientX: c.x + hands[i].ox, clientY: c.y + hands[i].oy, pointerId: HAND_ID[i], pointerType: 'mouse' };
}
function mouseMoved(mx, my) {
  if (Math.abs(mx) > 600 || Math.abs(my) > 600) return; // (a browser's stray jump)
  // a hand holds on – or, at work (the camera looking down on it), the hand over it: the mouse moves it
  const atWork = !!(S.working && S.working.fp);
  const i = moving >= 0 && hands[moving].down ? moving : atWork ? hover : -1;
  const h = i >= 0 && hands[i];
  if (h) {
    const c = scene.viewCenter(), r = canvas.getBoundingClientRect();
    h.ox = Math.max(r.left + 4, Math.min(r.right - 4, c.x + h.ox + mx)) - c.x;
    h.oy = Math.max(r.top + 4, Math.min(r.bottom - 4, c.y + h.oy + my)) - c.y;
    const p = handAt(i);
    if (atWork) workPtr('move', p);
    else if (h.act === 'grab' && S.fpDrag && S.fpDrag.pid === p.pointerId) fpDragTo(p.clientX, p.clientY);
    else if (h.act === 'knob' && S.knobDrag) {
      // (turned clockwise – the mouse to the right – up, a setting each 70 px or so)
      const K = S.knobDrag;
      K.acc += mx;
      const lv = Math.max(0, Math.min(3, K.level0 + Math.round(K.acc / 70)));
      if (lv !== K.level) { K.level = lv; send({ t: 'knob', fx: K.fx, slot: K.slot, level: lv }); sfx.play(lv ? 'click' : 'clunk', 0.4); }
    }
    return;
  }
  // else it looks round
  const dy = -mx * LOOK, p0 = S.pitch;
  S.me.yaw += dy;
  S.pitch = Math.max(-1.1, Math.min(0.6, S.pitch - my * LOOK));
  scene.lookBy(dy, S.pitch - p0);
}
// E / Q (the left / right button) pressed: hand 1 the right, 0 the left
function handDown(i) {
  const h = hands[i];
  if (h.down || !S.fp) return;
  sfx.unlock();
  if (!$('modal').hidden) return;
  if (S.working && S.working.fp) {
    // at work: the hand goes down on the work where the mouse has it
    const at = hands[hover];
    Object.assign(h, { down: true, ox: at.ox, oy: at.oy, act: 'work' });
    moving = i; hover = i;
    workPtr('down', handAt(i));
    return;
  }
  if (S.working) return;
  // the fridge / the pantry: a hand takes hold of the door's handle, a thing on a shelf
  const c = scene.viewCenter();
  const pick = scene.fpPick(c.x, c.y, S.me, myHeld());
  const pt = fpPointed(i);
  if (pt && pt.kind === 'ovenDoor') {
    // (a free hand on its handle: down it comes, or up it goes)
    if (scene.fpSlots[i] != null && scene.fpSlots[1 - i] != null) { toast('Both your hands are full – put something down first'); return; }
    scene.fpArms.reach(scene.fpSlots[i] == null ? i : 1 - i, { key: null, take: false, hold: 'grab', world: pt.w });
    send({ t: 'door', fx: pt.fx, v: pt.open ? 0 : 1, done: true });
    sfx.play(pt.open ? 'clunk' : 'door', 0.6);
    return;
  }
  if (pt && pt.kind === 'knob') {
    // (a hand on the stove's knob: moving the mouse turns it, a setting at a time – the burner follows)
    if (scene.fpSlots[i] != null) { toast('That hand’s full – turn the knob with the other one'); return; }
    S.knobDrag = { fx: pt.fx, slot: pt.slot, level0: pt.level, level: pt.level, acc: 0 };
    Object.assign(h, { down: true, ox: 0, oy: 0, act: 'knob' }); moving = i; hover = i;
    scene.fpArms.reach(i, { key: null, take: false, hold: 'grab', world: pt.w });
    sfx.play('click', 0.4);
    return;
  }
  if (pt && (pt.kind === 'bay' || pt.kind === 'bayIn' || pt.kind === 'surface' || pt.kind === 'work' || pt.kind === 'piece' || pt.kind === 'merge')) { hover = i; fpPointAct(pt, i); return; }
  if (pick && (pick.kind === 'door' || pick.kind === 'thing') && !S.fpDrag) {
    fpGrab({ clientX: c.x, clientY: c.y, pointerId: HAND_ID[i] }, i);
    if (S.fpDrag) { Object.assign(h, { down: true, ox: 0, oy: 0, act: 'grab' }); moving = i; hover = i; return; }
  }
  // else what E does here, with this hand
  hover = i;
  useNow(i);
}
function handUp(i) {
  const h = hands[i];
  if (!h.down) return;
  h.down = false;
  const o = hands[1 - i];
  if (moving === i) moving = o.down ? 1 - i : -1;
  const p = handAt(i);
  if (h.act === 'work') { if (S.working && S.working.fp) workPtr('up', p); }
  else if (h.act === 'grab' && S.fpDrag && S.fpDrag.pid === p.pointerId) {
    const d = S.fpDrag;
    // (the handle pressed and let go without swinging the door: it opens / shuts)
    if (d.kind === 'door' && !d.moved) {
      S.fpDrag = null;
      const f = fixtureById(S.K, d.fx);
      if (f) fpStoreLook(f, i).run();
    } else fpLetGo(p.clientX, p.clientY);
  }
  if (h.act === 'knob') S.knobDrag = null;
  h.act = null;
}
// each frame: a hand let go drifts back to the dot (at work it stays where the mouse left it, and hovers there)
function handsFrame(dt) {
  if (!locked()) return;
  const atWork = !!(S.working && S.working.fp);
  for (const [i, h] of hands.entries()) {
    if (h.down && ((h.act === 'work' && !(S.working && S.working.fp)) || (h.act === 'grab' && !(S.fpDrag && S.fpDrag.pid === HAND_ID[i])))) { h.down = false; h.act = null; if (moving === i) moving = hands[1 - i].down ? 1 - i : -1; }
    if (h.down || (!h.ox && !h.oy) || atWork) continue;
    const k = Math.exp(-dt * 12);
    h.ox *= k; h.oy *= k;
    if (Math.hypot(h.ox, h.oy) < 0.5) h.ox = h.oy = 0;
  }
  if (S.working && S.working.fp && !hands[0].down && !hands[1].down) workPtr('move', handAt(hover));
  if (!$('modal').hidden) unlockMouse(); // (a window to click in)
}
canvas.addEventListener('mousedown', (e) => {
  if (!locked()) return;
  e.preventDefault();
  if (e.button === 0) handDown(S.mainHand); else if (e.button === 2) handDown(1 - S.mainHand);
});
canvas.addEventListener('mouseup', (e) => {
  if (!locked()) return;
  if (e.button === 0) handUp(S.mainHand); else if (e.button === 2) handUp(1 - S.mainHand);
});
canvas.addEventListener('contextmenu', (e) => { if (S.fp) e.preventDefault(); });

const controls = new Controls({
  onUse: () => useNow(),
  onMore: () => moreNow(),
  // (E my main hand, Q the other)
  onHand: (i, down) => { const h = i ? S.mainHand : 1 - S.mainHand; return down ? handDown(h) : handUp(h); },
  // first person at work: walking off steps away from it
  onStep: () => { if (S.working && S.working.fp && $('modal').hidden) closeStation(); },
  onView: () => toggleView(),
  onPour: (down) => { S.pour = down ? { t: 0 } : null; },
  onWork: () => workNow(),
  onFirst: () => sfx.unlock(),
  onMenuMove: (d) => {
    const bs = [...$('menu').querySelectorAll('button:not([disabled])')];
    if (!bs.length) return;
    S.menuSel = (S.menuSel + d + bs.length) % bs.length;
    bs.forEach((b, i) => b.classList.toggle('sel', i === S.menuSel));
    sfx.play('click', 0.6);
  },
});
const touchUI = isTouchDevice() || params.has('touch');

// F2 / 👁: through my own eyes, or the whole room
function toggleView() {
  if (S.working) closeStation(true); // (the close-up and the 3D work are each their view's)
  S.fp = !S.fp;
  scene.setFirstPerson(S.fp);
  controls.setFirstPerson(S.fp);
  $('viewBtn').classList.toggle('on', S.fp);
  $('viewBtn').textContent = S.fp ? '🏠' : '👁';
  if (!touchUI) { if (S.fp) lockMouse(); else unlockMouse(); }
  toast(S.fp ? `👁 First person – ${touchUI ? 'the stick walks and turns (steps sideways along a counter), drag to look, ⬇ ⬆ crouch / up on your toes' : 'W A S D walk, the mouse looks round (click to capture it, Esc frees it), E or left click your main hand, Q or right click the other (hold to hold on), R use what you hold, T tip it in, Tab every option, Ctrl crouch, Space up on your toes, F full screen'} · ${touchUI ? '🏠' : 'F2'} for the room` : '🏠 The whole room', touchUI ? 3200 : 5200);
  sfx.play('whoosh', 0.4);
}
$('viewBtn').onclick = () => { sfx.unlock(); toggleView(); };
controls.setTouch(touchUI);
if (touchUI) lockZoom();

function jobsAt(f) {
  // (worked out again only when the kitchen, my pick or what I hold changed)
  const key = `${f.id}|${S.M.ver}|${S.sel}|${S.myId}`;
  if (S.jobsCache && S.jobsCache.key === key) return S.jobsCache.out;
  const out = jobsAtNow(f);
  S.jobsCache = { key, out };
  return out;
}
function jobsAtNow(f) {
  const C = S.M.cook, x = S.x, K = S.K;
  const out = [];
  if (C && x) {
    const me = S.myId;
    const held = heldBy(C, me);
    const hands = carrying(C, me);
    const here = (k) => { const L = locate(C, K, k); return L.staple || L.held === me || (!L.stored && L.held == null && L.fx === f.id); };
    for (const s of x.steps) {
      const st = C.steps[s.id];
      if (!(st.s === 'open' || (st.s === 'active' && st.by === me))) continue;
      if (!stepPlaces(C, x, K, s, me).some((p) => p.fx === f.id)) continue;
      const mine = st.claim.includes(me);
      const others = st.claim.filter((id) => id !== me).map(memberById).filter(Boolean);
      const busy = placeBusy(C, x, K, s, { fx: f.id, slot: 0 }, me);
      const need = needsOf(C, s);
      const miss = st.s === 'active' ? [] : need.filter((k) => !here(k));
      const why = hands ? ' (hands full)' : busy ? ' (busy)'
        : miss.length ? ` (${miss.map((k) => `${thingEmoji(C, k)} ${thingName(C, x, k)}`).slice(0, 2).join(', ')} not here)` : '';
      const uses = need.some((k) => held.includes(k));
      // (before the steps the recipe puts first: you may – it shows a little in the stars)
      const early = st.s === 'open' && st.ph === 0 && st.k === 0 && !inOrder(C, s);
      out.push({ sid: s.id, label: `${stepIcon(s)} ${s.name}${early && !why ? ' (early)' : ''}${why}`, mine, others, off: !!why, sel: S.sel === s.id, uses, early, idx: x.steps.indexOf(s) });
    }
    out.sort((a, b) => (b.sel - a.sel) || (a.off - b.off) || (b.uses - a.uses) || (a.early - b.early) || (b.mine - a.mine) || (a.others.length - b.others.length));
    // the fridge / pantry: open it up and look (take things, put things back, inside)
    if (isStore(f)) {
      const fridge = f.type === 'fridge';
      const open = C.fx[f.id] && C.fx[f.id].door;
      out.unshift({ store: true, label: `${fridge ? '🧊' : '🫙'} ${open ? 'Look in' : 'Open'} the ${fridge ? 'fridge' : 'pantry'}` });
      return out;
    }
    // what's lying here: pick it up
    const wanted = new Set(x.steps.filter((s) => C.steps[s.id].s !== 'done').flatMap((s) => needsOf(C, s)));
    const things = [];
    for (const [id, it] of Object.entries(C.items)) if (!it.in && !it.staple && !it.hidden && it.held == null && it.at === f.id) things.push(`i:${id}`);
    for (const [id, v] of Object.entries(C.vessels)) if (v.held == null && v.at && v.at.fx === f.id) things.push(`v:${id}`);
    for (const [id, t] of Object.entries(C.tools || {})) if (t.held == null && t.at === f.id) things.push(`u:${id}`); // (a fork, a ladle … put down here)
    things.sort((a, b) => wanted.has(b) - wanted.has(a));
    for (const k of things) {
      const why = handsFree(C, x, me, k);
      out.push({ act: 'take', what: k, label: `${thingEmoji(C, k)} Pick up the ${thingName(C, x, k)}${why ? ' (hands full)' : ''}`, off: !!why });
    }
    // what I'm holding: put it down here
    if (held.length) {
      const why = canPut(C, x, K, me, f.id);
      const what = held.length === 1 ? thingName(C, x, held[0]) : `${held.length} things`;
      const put = { act: 'put', what: '', label: `⬇️ Put down the ${what}${why ? ` (${why.toLowerCase()})` : ''}`, off: !!why };
      const firstReady = out.findIndex((j) => !j.off);
      // a step that uses what I hold comes first; otherwise putting it down does
      if (firstReady >= 0 && out[firstReady].uses) out.splice(firstReady + 1, 0, put); else out.unshift(put);
    }
    // the board: stood up at the back for something big – or laid back down
    if (S.K.bays && S.K.bays[`${f.id}/board`]) {
      const up = C.fx[f.id] && C.fx[f.id].boardUp, full = held.length > 0;
      out.push({ sid: choreId(up ? 'lay' : 'room', f.id), label: `${up ? '🔪 Lay the board down' : '↕️ Stand the board up – room for something big'}${full ? ' (hands full)' : ''}`, chore: true, off: full });
    }
    // a burner left on with nothing on it
    const lit = C.fx[f.id] && C.fx[f.id].lit;
    if (lit && Object.keys(lit).length) out.push({ sid: choreId('knob', f.id), label: '🔥 Turn off the empty burner', chore: true });
    // the trash
    const sc = C.scraps[f.id];
    if (sc && sc.n > 0) out.unshift({ sid: choreId('clear', f.id), label: `🧹 Clear the scraps (${sc.n})`, chore: true });
    if (f.caps.includes('bin')) {
      const fill = (C.bins[f.id] || { fill: 0 }).fill, holds = binHolds(f);
      if (carrying(C, S.myId)) out.unshift({ sid: choreId('toss', f.id), label: fill >= holds ? '🗑️ Full! Change the bag first' : `🗑️ Throw away the scraps`, chore: true, off: fill >= holds });
      if (fill >= holds * 0.5) out.push({ sid: choreId('bag', f.id), label: `🛍️ Change the bag (${fill}/${holds})`, chore: true });
    }
    // washing up: something dirty in the sink (by hand – soap on the sponge, scrub, rinse)
    if (f.caps.includes('sink')) {
      const dirty = Object.entries(C.vessels).find(([id, v]) => v.held == null && v.at && v.at.fx === f.id && needsWash(C, x, id));
      const full = held.length > 0; // (both hands for washing up)
      if (dirty) out.push({ sid: choreId('scrub', f.id), label: `🧽 Wash up the ${thingName(C, x, `v:${dirty[0]}`)}${full ? ' (hands full)' : ''}`, chore: true, off: full });
    }
    // the dishwasher: what's dirty in my hands goes in; loaded, it can be started; done, things come out
    if (f.caps.includes('dishwasher')) {
      const put = out.find((j) => j.act === 'put');
      const intoDw = held.filter((k) => k[0] === 'v' && dishwasherSafe(C.vessels[k.slice(2)].kind) && needsWash(C, x, k.slice(2)));
      if (put && intoDw.length && !dwRunning(C, f.id)) put.label = `🫧 Into the dishwasher: the ${intoDw.map((k) => thingName(C, x, k)).join(', ')}`;
      const load = dwLoad(C, f.id);
      if (dwRunning(C, f.id)) {
        for (const j of out) if (j.act === 'take' && load.includes(j.what.slice(2))) { j.off = true; j.label = `🫧 ${thingName(C, x, j.what)} (washing)`; }
      } else {
        for (const j of out) if (j.act === 'take' && load.includes(j.what.slice(2)) && !C.vessels[j.what.slice(2)].dirty) j.label = `✨ Take the ${thingName(C, x, j.what)} out of the dishwasher`;
        if (load.some((id) => C.vessels[id].dirty)) out.push({ sid: choreId('dw', f.id), label: `🫧 Run the dishwasher (${load.length})`, chore: true });
      }
    }
    // a dirty board (wooden: by hand, with the sponge)
    if (f.caps.includes('board') && C.fx[f.id] && C.fx[f.id].dirty) out.push({ sid: choreId('wipe', f.id), label: '🧽 Clean the board', chore: true });
    // a bunch with more than the recipe takes, lying here: just what's needed into a container of its own
    out.push(...freeJobs(f));
    if (f.caps.includes('board')) for (const [id, it] of Object.entries(C.items)) {
      if (!(it.extra > 0) || it.at !== f.id || it.in || it.held != null) continue;
      out.push({ sid: `#portion.${id}.${it.qty || 1}@${f.id}`, label: `🫙 Take ${it.qty > 1 ? `${it.qty} of the ${thingName(C, x, `i:${id}`)}` : `one ${ingName(it.kind, 1).toLowerCase()}`} into a container of their own`, chore: true });
    }
  }
  return out;
}

function openMenu(f) {
  const jobs = jobsAt(f);
  const m = $('menu');
  const extra = f.caps.includes('bin') && S.M.cook ? ` <span class="muted">· ${(S.M.cook.bins[f.id] || { fill: 0 }).fill}/${binHolds(f)} full</span>` : '';
  m.innerHTML = `<h4>${esc(FIXTURES[f.type].name)}${extra}</h4>`
    + (jobs.length ? jobs.map((j, i) => `<button data-i="${i}" class="${j.chore || j.act ? 'chore' : ''}" ${j.off ? 'disabled' : ''}>${esc(j.label)}${j.mine ? ' ✋' : ''}${j.others && j.others.length ? ` <span class="muted">(${esc(j.others[0].name)}’s)</span>` : ''}</button>`).join('')
      : `<div class="none">Nothing to do here right now.</div>`)
    + `<div class="keys muted">${touchUI ? 'Tap one' : '↑ ↓ to choose · E to start · Esc to close'}</div>`;
  m.hidden = false;
  controls.menuOpen = true;
  S.menuSel = 0;
  const first = m.querySelector('button:not([disabled])');
  if (first) first.classList.add('sel');
  const at = scene.project(f.x + f.w / 2, 0.9, f.y + f.h / 2);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, at.x - r.width / 2))}px`;
  m.style.top = `${Math.min(innerHeight - r.height - 8, Math.max(70, at.y - r.height - 10))}px`;
  m.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    runJob(jobs[Number(b.dataset.i)], f);
  };
}
function closeMenu() { $('menu').hidden = true; controls.menuOpen = false; }

// ------------------------------------------------------------------ timers

// The timers: little analog kitchen timers in a row – a red wedge for the time
// left, the hand sweeping it down; a finished one rings. Tap one for its name
// and ⏭ Skip; the chip next to them sets the speed (1× … 16×).
function renderTimers() {
  const C = S.M.cook, x = S.x;
  const el = $('timers');
  if (!C || !x || C.finished) { el.hidden = true; return; }
  const dials = [];
  let popOk = false;
  for (const s of x.steps) {
    const st = C.steps[s.id];
    // (a simulated recipe: what's cooking in a pan, as far as it's got)
    const sp = x.sim && st.s !== 'done' ? simProgress(C, x, s) : null;
    if (sp != null) {
      if (S.timerPop === s.id) popOk = true;
      dials.push(`<button class="dial ${S.timerPop === s.id ? 'on' : ''}" data-tsid="${s.id}" title="${esc(s.name)} – ${Math.round(sp * 100)}%">${dialSvg(1 - sp)}<small>${Math.round(sp * 100)}%</small></button>`);
      continue;
    }
    // (a simulated wait counting its time – a boil, a bake, a chill, a rise – while the kitchen's as it needs)
    if (x.sim && s.do === 'wait' && st.s !== 'done' && st.t > 0) {
      const dur = stepDuration(C, x, S.K, s), left = Math.max(0, dur - st.t);
      if (S.timerPop === s.id) popOk = true;
      dials.push(`<button class="dial ${S.timerPop === s.id ? 'on' : ''}" data-tsid="${s.id}" title="${esc(s.name)} – ${fmtTime(left)} left">${dialSvg(Math.min(1, left / Math.max(1, dur)))}<small>${fmtTime(left)}</small></button>`);
      continue;
    }
    if (st.s !== 'running' && st.s !== 'ready') continue;
    const dur = stepDuration(C, x, S.K, s);
    const left = Math.max(0, dur - st.t);
    const ready = st.s === 'ready';
    const frac = ready ? 0 : Math.min(1, left / Math.max(1, dur));
    if (S.timerPop === s.id) popOk = true;
    dials.push(`<button class="dial ${ready ? 'ready' : ''} ${S.timerPop === s.id ? 'on' : ''}" data-tsid="${s.id}" title="${esc(s.name)} – ${ready ? 'ready!' : `${fmtTime(left)} left`}">${dialSvg(frac)}<small>${ready ? '⏰' : fmtTime(left)}</small></button>`);
  }
  if (!dials.length) { el.hidden = true; S.timerPop = null; return; }
  el.hidden = false;
  const html = dials.join('');
  if ($('timerList').dataset.h !== html) { $('timerList').innerHTML = html; $('timerList').dataset.h = html; }
  $('speedChip').textContent = `⏩ ${C.speed}×`;
  $('speedChip').classList.toggle('on', C.speed > 1);
  // the little card for the dial I tapped
  const pop = $('timerPop');
  if (!popOk) S.timerPop = null;
  if (S.timerPop && x.sim && C.steps[S.timerPop] && C.steps[S.timerPop].s === 'open' && simProgress(C, x, stepDef(x, S.timerPop)) == null) {
    const s = stepDef(x, S.timerPop), left = Math.max(0, stepDuration(C, x, S.K, s) - C.steps[S.timerPop].t);
    const card = `<b>${esc(s.name)}</b><span>${fmtTime(left)} left</span><button class="btn small" data-skip="${s.id}">⏭ Skip</button>`;
    if (pop.dataset.h !== card) { pop.innerHTML = card; pop.dataset.h = card; }
    pop.hidden = false;
  } else if (S.timerPop && x.sim && simProgress(C, x, stepDef(x, S.timerPop)) != null) {
    const s = stepDef(x, S.timerPop), card = `<b>${esc(s.name)}</b><span>${Math.round(simProgress(C, x, s) * 100)}%</span><button class="btn small" data-skip="${s.id}">⏭ Skip</button>`;
    if (pop.dataset.h !== card) { pop.innerHTML = card; pop.dataset.h = card; }
    pop.hidden = false;
  } else if (S.timerPop) {
    const s = stepDef(x, S.timerPop), st = C.steps[S.timerPop];
    const left = Math.max(0, stepDuration(C, x, S.K, s) - st.t);
    const card = `<b>${esc(s.name)}</b><span>${st.s === 'ready' ? 'ready!' : `${fmtTime(left)} left`}</span>${st.s === 'running' ? `<button class="btn small" data-skip="${s.id}">⏭ Skip</button>` : ''}`;
    if (pop.dataset.h !== card) { pop.innerHTML = card; pop.dataset.h = card; }
    pop.hidden = false;
  } else pop.hidden = true;
}

// an analog kitchen timer face: the red wedge is the time left (frac 0…1)
function dialSvg(frac) {
  const a = frac * Math.PI * 2, cx = 20, cy = 21, r = 15;
  const ex = cx + Math.sin(a) * r, ey = cy - Math.cos(a) * r;
  const wedge = frac >= 0.999 ? `<circle cx="${cx}" cy="${cy}" r="${r}" class="w"/>`
    : frac > 0.001 ? `<path class="w" d="M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}Z"/>` : '';
  let ticks = '';
  for (let i = 0; i < 12; i++) { const t = i / 12 * Math.PI * 2; ticks += `<line x1="${(cx + Math.sin(t) * 16.5).toFixed(1)}" y1="${(cy - Math.cos(t) * 16.5).toFixed(1)}" x2="${(cx + Math.sin(t) * (i % 3 ? 15 : 13.5)).toFixed(1)}" y2="${(cy - Math.cos(t) * (i % 3 ? 15 : 13.5)).toFixed(1)}"/>`; }
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><rect class="k" x="16" y="0.5" width="8" height="4" rx="1.5"/><circle class="f" cx="${cx}" cy="${cy}" r="18"/>${wedge}<g class="t">${ticks}</g><line class="h" x1="${cx}" y1="${cy}" x2="${ex.toFixed(2)}" y2="${ey.toFixed(2)}"/><circle class="c" cx="${cx}" cy="${cy}" r="2.4"/></svg>`;
}

$('timers').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  sfx.unlock();
  if (b.dataset.skip) { send({ t: 'skip', sid: b.dataset.skip }); sfx.play('whoosh'); S.timerPop = null; }
  else if (b.dataset.tsid) { S.timerPop = S.timerPop === b.dataset.tsid ? null : b.dataset.tsid; sfx.play('click', 0.6); }
  else if (b.id === 'speedChip') {
    const C = S.M.cook;
    if (!C) return;
    const next = SPEEDS[(SPEEDS.indexOf(C.speed) + 1) % SPEEDS.length];
    send({ t: 'speed', x: next });
    sfx.play('ui');
  }
  renderTimers();
});

// local timer ticking between clock messages
function tickTimers(dt) {
  const C = S.M.cook, x = S.x;
  if (!C || !x || !C.started || C.finished) return;
  for (const s of x.steps) { const st = C.steps[s.id]; if (st.s === 'running') st.t = Math.min(stepDuration(C, x, S.K, s), st.t + dt * C.speed); }
}

// ------------------------------------------------------------------ nudges

function renderNudge() {
  const C = S.M.cook;
  const el = $('nudge');
  const c = C && carrying(C, S.myId);
  const held = C && S.x ? heldBy(C, S.myId) : [];
  if (c && !S.working) {
    if (el.dataset.k !== `c${c.n}`) {
      el.dataset.k = `c${c.n}`;
      el.innerHTML = `🤲 Your hands are full of scraps (${c.n}) <button class="btn small sun" id="toBin">🗑️ To the bin</button>`;
      $('toBin').onclick = () => toBin();
    }
    el.hidden = false;
  } else if (held.length && !S.working) {
    const sid = S.sel || stepForHeld();
    const p = sid ? planStep(C, S.x, S.K, sid, S.myId) : null;
    const f = p && p.do === 'go' && fixtureById(S.K, p.fx);
    const next = f ? `next: ${stepDef(S.x, sid).name} at the ${FIXTURES[f.type].name.toLowerCase()}`
      : p && p.do !== 'wait' ? planText(p) : `${touchUI ? 'Use' : 'E'} at a counter puts ${held.length > 1 ? 'them' : 'it'} down`;
    const html = `${held.map((k) => thingEmoji(C, k)).join('')} You’re holding the ${held.map((k) => thingName(C, S.x, k)).join(', ')} <span class="muted">· ${esc(next)}</span>`;
    if (el.dataset.k !== html) { el.dataset.k = html; el.innerHTML = html; }
    el.hidden = false;
  } else el.hidden = true;
}

// a step that's ready to go with what I'm holding (for the hint and the arrows)
// the sheet's clean-up line: what's dirty, where the scraps are
function cleanupRow(C, x, todo) {
  const K = S.K;
  const fxName = (id) => { const f = fixtureById(K, id); return f ? FIXTURES[f.type].name.toLowerCase() : id; };
  const parts = [];
  const ves = todo.filter((t) => t.kind === 'vessel').map((t) => thingName(C, x, t.key));
  if (ves.length) parts.push(`wash up the ${ves.join(', ')}`);
  const boards = todo.filter((t) => t.kind === 'board');
  if (boards.length) parts.push(boards.length > 1 ? `clean ${boards.length} boards` : 'clean the board');
  const sc = todo.filter((t) => t.kind === 'scraps').map((t) => fxName(t.fx));
  if (sc.length) parts.push(`clear the scraps off the ${sc.join(', ')}`);
  if (todo.some((t) => t.kind === 'carry')) parts.push('bin the scraps in hand');
  // what's left of the bunches, back in the fridge / pantry
  const rest = todo.filter((t) => t.kind === 'rest').map((t) => thingName(C, x, t.key));
  if (rest.length) parts.push(`put the ${rest.join(', ')} back`);
  // the dishwasher: to start, or running (⏭ skips it)
  const dws = [...new Set(todo.filter((t) => t.kind === 'dw').map((t) => t.fx))];
  let acts = '';
  for (const fx of dws) {
    const dw = C.dw && C.dw[fx];
    if (dw && dw.run) { parts.push(`🫧 the dishwasher's on – ${fmtTime(Math.max(0, DW_DUR - dw.t) / Math.max(1, C.speed))} left`); acts += `<button data-skipdw="${fx}" title="Skip ahead">⏭</button>`; } else parts.push('start the dishwasher');
  }
  return `<li class="open cleanup"><span class="ic">🧽</span><span class="nm">Clean up before serving<small>${esc(parts.join(' · '))}</small></span><span class="who"></span><span class="acts">${acts}</span></li>`;
}

// What glows a little, to help: for the step I picked (📍), else the one
// what I hold is for, else the recipe's next step I can get going (one I said
// I'd do ✋ first) – the fridge / shelf and the thing to fetch from it, where
// to put things down, or where to do it; the bins for scraps in my hands.
// (Fixture ids and thing keys; worked out again only when the kitchen changes.)
function guideNow() {
  const C = S.M.cook, x = S.x, K = S.K;
  if (!C || !x || C.finished) return new Set();
  if (S.sel && (!C.steps[S.sel] || C.steps[S.sel].s === 'done')) S.sel = null;
  const key = `${S.M.ver}|${S.sel}|${S.working ? 1 : 0}|${S.myId}`;
  if (S.guideCache && S.guideCache.key === key) return S.guideCache.out;
  const out = new Set();
  if (carrying(C, S.myId)) {
    const bins = K.fixtures.filter((f) => f.caps.includes('bin'));
    const free = bins.filter((f) => (C.bins[f.id] || { fill: 0 }).fill < binHolds(f));
    for (const f of free.length ? free : bins) out.add(f.id);
  } else if (!S.working) {
    const go = (sid) => { const p = planStep(C, x, K, sid, S.myId); return p && p.fx && p.do !== 'wait' && p.do !== 'bin' ? p : null; };
    let p = S.sel && ['open', 'active'].includes(C.steps[S.sel].s) ? go(S.sel) : null;
    if (!p && !S.sel) { const sid = stepForHeld(); p = sid && go(sid); }
    if (!p && !S.sel) {
      const next = x.steps.filter((s) => C.steps[s.id].s === 'open' && inOrder(C, s));
      next.sort((a, b) => C.steps[b.id].claim.includes(S.myId) - C.steps[a.id].claim.includes(S.myId));
      for (const s of next) if ((p = go(s.id))) break;
    }
    // (the fridge / pantry glows till its door is open – then just the thing in it)
    if (p) {
      // (a drawer or a cupboard: its counter glows till it's open)
      const [pf, pb] = splitPlace(p.fx), open = pb ? C.fx[pf] && C.fx[pf].bays && C.fx[pf].bays[pb] : C.fx[p.fx] && C.fx[p.fx].door;
      if (!(p.do === 'take' && p.store && open)) out.add(pf);
      if (p.do === 'take' && p.key) out.add(p.key);
    }
    // nothing of the recipe to do: what needs cleaning (the dirty things and the sink, dirty boards, scraps)
    if (!p && !S.sel) {
      const todo = cleanup(C, x);
      for (const t of todo) if (t.kind === 'scraps' || t.kind === 'board') out.add(t.fx); else if (t.kind === 'vessel') out.add(t.key);
      if (todo.some((t) => t.kind === 'vessel')) { const sink = K.fixtures.find((f) => f.caps.includes('sink')); if (sink) out.add(sink.id); }
      const dwf = K.fixtures.find((f) => f.caps.includes('dishwasher'));
      if (dwf && todo.some((t) => (t.kind === 'dw' && !t.run) || (t.kind === 'vessel' && dishwasherSafe(C.vessels[t.key.slice(2)].kind)))) out.add(dwf.id);
    }
  }
  S.guideCache = { key, out };
  return out;
}
function stepForHeld() {
  const C = S.M.cook, x = S.x;
  if (!C || !x) return null;
  const held = heldBy(C, S.myId);
  if (!held.length) return null;
  // (the recipe's order first: a step ahead of it only if nothing else is)
  for (const s of [...x.steps].sort((a, b) => inOrder(C, b) - inOrder(C, a))) {
    if (C.steps[s.id].s !== 'open' || !needsOf(C, s).some((k) => held.includes(k))) continue;
    const p = planStep(C, x, S.K, s.id, S.myId);
    if (p && p.do === 'go') return s.id;
  }
  return null;
}

function toBin() {
  S.sel = null;
  S.toBin = true;
  toast(`🗑️ The bins are marked – walk to one and press ${touchUI ? 'Use' : 'E'}`);
}

// ------------------------------------------------------------------ chat

function renderQuick() {
  $('quick').innerHTML = QUICK_CHAT.map((t, i) => `<button data-q="${i}"><kbd>${i < 9 ? i + 1 : i === 9 ? 0 : i === 10 ? '-' : '='}</kbd>${esc(t)}</button>`).join('');
}
renderQuick();
$('chatBtn').onclick = () => { sfx.unlock(); $('quick').hidden = !$('quick').hidden; };
$('quick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  send({ t: 'chat', id: Number(b.dataset.q) });
  $('quick').hidden = true;
});

function addChat(msg) {
  const log = $('chatLog');
  const d = document.createElement('div');
  if (msg.from) {
    d.innerHTML = `<b style="color:${msg.color || 'inherit'}">${esc(msg.from)}:</b> ${esc(msg.text)}`;
    S.bubbles.set(msg.id, { text: msg.text, until: performance.now() + 3500 });
    sfx.play('chat');
  } else { d.className = 'sys'; d.textContent = msg.text; }
  log.appendChild(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => d.classList.add('fade'), 9000);
  setTimeout(() => d.remove(), 10500);
}

// ------------------------------------------------------------------ dialogs

function showModal(kind, html) {
  const m = $('modal');
  m.dataset.kind = kind;
  $('modalCard').innerHTML = html;
  m.hidden = false;
  sfx.play('ui');
}
function closeModal() { $('modal').hidden = true; $('modal').dataset.kind = ''; clearInterval(closeModal.anim); }
$('modal').addEventListener('pointerdown', (e) => { if (e.target === $('modal')) closeModal(); });
$('modalCard').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });

// --- welcome
function openWelcome() {
  const cu = CUISINES[S.M.kitchen ? S.M.kitchen.cuisine : 'turkish'];
  showModal('welcome', `
    <h2>${cu.hello} Welcome to <span style="color:var(--tomato)">cookwithus</span> 🍳</h2>
    <div class="muted">Your cozy ${cu.name.toLowerCase()} kitchen is ready. Cook real recipes with your own hands – every slice, stir and pour – alone or with friends.</div>
    <div class="row" style="margin-top:10px"><span class="lab">Your name</span> <input type="text" id="wName" maxlength="16" value="${esc(S.profile.name)}"> <button class="btn small" id="wLook">🎨 Style your cook</button></div>
    <div class="err" id="wErr"></div>
    <div class="welcome">
      <button class="opt" id="wCook"><big>🥚</big><b>Start cooking</b><small>Boiled eggs are on. Walk with ${touchUI ? 'the stick (left thumb)' : 'WASD / the arrow keys'}, step up to the sink and press ${touchUI ? 'Use' : 'E'}. 📍 on a step shows where.</small></button>
      <button class="opt" id="wBook"><big>📖</big><b>Pick a recipe</b><small>From çay to paella and lahana dolması.</small></button>
      <button class="opt" id="wFriends"><big>👋</big><b>Cook with friends</b><small>Invite with a code or WhatsApp – or join theirs.</small></button>
    </div>`);
  const saveName = () => {
    const n = cleanName($('wName').value);
    if (!n) return true;
    if (isProfane(n)) { $('wErr').textContent = 'Let’s keep the kitchen friendly – pick another name 🙂'; return false; }
    setProfile({ ...S.profile, name: n });
    return true;
  };
  $('wName').oninput = () => { $('wErr').textContent = isProfane($('wName').value) ? 'Let’s keep the kitchen friendly – pick another name 🙂' : ''; };
  $('wLook').onclick = () => { if (saveName()) openProfile(); };
  $('wCook').onclick = () => { if (saveName()) closeModal(); };
  $('wBook').onclick = () => { if (saveName()) openBook(); };
  $('wFriends').onclick = () => { if (saveName()) openInvite(true); };
}

// --- profile editor
function setProfile(p) {
  S.profile = sanitizeProfile(p);
  store.set('profile', S.profile);
  send({ t: 'profile', profile: S.profile });
  refreshTop();
}

function openProfile() {
  const draft = JSON.parse(JSON.stringify(S.profile));
  let hand = S.mainHand; // (kept on this device: which of my hands E and the left button are)
  const sw = (key, cols) => `<div class="pick">${cols.map((c, i) => `<button class="sw ${draft.avatar[key] === i ? 'on' : ''}" data-k="${key}" data-v="${i}" style="background:${c}"></button>`).join('')}</div>`;
  const tx = (key, names) => `<div class="pick">${names.map((n, i) => `<button class="${draft.avatar[key] === i ? 'on' : ''}" data-k="${key}" data-v="${i}">${esc(n)}</button>`).join('')}</div>`;
  const render = () => {
    showModal('profile', `
      <button class="btn small close" data-close>✕</button>
      <h2>Your cook</h2>
      <div class="editor">
        <div><canvas id="pvw" width="440" height="600"></canvas><div style="text-align:center;margin-top:8px"><button class="btn small" id="pRand">🎲 Surprise me</button></div></div>
        <div>
          <div class="lab">Name</div>
          <div class="row"><input type="text" id="pName" maxlength="16" value="${esc(draft.name)}"></div>
          <div class="err" id="pErr"></div>
          <div class="lab">Skin</div>${sw('skin', SKINS)}
          <div class="lab">Hair</div>${tx('hair', HAIR_STYLES)}${sw('hairColor', HAIR_COLORS)}
          <div class="lab">Hat</div>${tx('hat', HATS)}${sw('hatColor', HAT_COLORS)}
          <div class="lab">Apron</div>${sw('apron', APRONS)}
          <div class="lab">Shirt</div>${sw('shirt', SHIRTS)}
          <div class="lab">Face</div>${tx('facial', FACIAL)}${tx('extra', EXTRAS)}
          <div class="lab">Main hand <span class="hint">(E · left click)</span></div><div class="pick">${['Left', 'Right'].map((n, i) => `<button class="${hand === i ? 'on' : ''}" data-hand="${i}">${n}</button>`).join('')}</div>
        </div>
      </div>
      <div class="end"><button class="btn" data-close>Cancel</button><button class="btn sun" id="pSave">Save</button></div>`);
    const cv = $('pvw');
    let t = 0;
    clearInterval(closeModal.anim);
    closeModal.anim = setInterval(() => { t += 0.05; drawPortrait(cv.getContext('2d'), cv.width, cv.height, lookOf(draft.avatar), t); }, 50);
    $('pName').oninput = () => {
      draft.name = $('pName').value;
      $('pErr').textContent = isProfane(draft.name) ? 'Let’s keep the kitchen friendly – pick another name 🙂' : '';
      $('pName').classList.toggle('bad', isProfane(draft.name));
    };
    $('modalCard').querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { draft.avatar[b.dataset.k] = Number(b.dataset.v); render(); }; });
    $('modalCard').querySelectorAll('[data-hand]').forEach((b) => { b.onclick = () => { hand = Number(b.dataset.hand); render(); }; });
    $('pRand').onclick = () => { const r = randomProfile(); draft.avatar = r.avatar; render(); };
    $('pSave').onclick = () => {
      const n = cleanName(draft.name);
      if (!n) { $('pErr').textContent = 'Your cook needs a name!'; return; }
      if (isProfane(n)) { $('pErr').textContent = 'Let’s keep the kitchen friendly – pick another name 🙂'; return; }
      setProfile({ ...draft, name: n });
      if (hand !== S.mainHand) { S.mainHand = scene.mainHand = hand; store.set('mainHand', hand); }
      closeModal();
      toast('Looking sharp, chef! 👩‍🍳');
    };
  };
  render();
}
$('meBtn').onclick = () => { sfx.unlock(); openProfile(); };

// --- recipe book
function openBook(filter = 'all') {
  const K = S.K;
  const head = isHead();
  const list = RECIPES.filter((r) => filter === 'all' || r.cuisine === filter || (filter === 'any' && r.cuisine === 'any'))
    .slice().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const cur = S.M.cook && S.M.cook.recipe;
  const tabs = ['all', ...CUISINE_ORDER].map((c) => `<button data-f="${c}" class="${filter === c ? 'on' : ''}">${c === 'all' ? '🌍 All' : `${CUISINES[c].flag} ${CUISINES[c].name}`}</button>`).join('');
  showModal('book', `
    <button class="btn small close" data-close>✕</button>
    <h2>📖 Recipe book</h2>
    <div class="muted">${head ? 'Pick what the kitchen cooks next.' : 'Only the head chef picks the recipe – but have a look!'} Recipes need the right kit: no pizza without an oven.</div>
    <div class="tabs">${tabs}</div>
    <div class="grid">${list.map((r) => {
      const ok = canCook(r, K);
      const x = expandedFor(r);
      const waits = x.steps.filter((s) => s.do === 'wait').reduce((a, s) => a + (typeof s.dur === 'number' ? s.dur : s.dur.electric || 0), 0);
      return `<button class="rc ${ok.ok ? '' : 'no'} ${cur === r.id ? 'sel' : ''}" data-r="${r.id}" ${!head || !ok.ok ? 'data-locked="1"' : ''}>
        <span class="fl">${CUISINES[r.cuisine] ? CUISINES[r.cuisine].flag : '🌍'}</span>
        <canvas width="380" height="220" data-dish="${r.id}"></canvas>
        <b>${esc(r.name)}</b><span class="lv">${'★'.repeat(r.level)}${'☆'.repeat(5 - r.level)}</span>
        <small>${x.steps.length} steps · ${fmtTime(waits)} of waiting · serves ${r.serves}</small>
        <small>${esc(r.blurb || '')}</small>
        ${ok.ok ? '' : `<span class="why">${esc(ok.why)} – try a bigger kitchen</span>`}
      </button>`;
    }).join('')}</div>`);
  $('modalCard').querySelectorAll('canvas[data-dish]').forEach((c) => {
    const r = recipeById(c.dataset.dish);
    try { drawDish(c.getContext('2d'), r.dish, c.width / 2, c.height - 16, 1.15, 0); } catch { /* ignore */ }
  });
  $('modalCard').querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) openBook(b.dataset.f); };
  $('modalCard').querySelector('.grid').onclick = (e) => {
    const b = e.target.closest('.rc');
    if (!b) return;
    if (!head) { toast('Ask the head chef to pick it 👑'); return; }
    const r = recipeById(b.dataset.r);
    const ok = canCook(r, K);
    if (!ok.ok) { toast(`${ok.why} – open a bigger kitchen 🏠`); return; }
    const C = S.M.cook;
    const inProgress = C && C.started && !C.finished;
    if (inProgress && !confirmTwice(b, 'Switch? Tap again – the current dish will be lost')) return;
    send({ t: 'recipe', id: r.id });
    closeModal();
  };
}
const xFor = new Map();
function expandedFor(r) { if (!xFor.has(r.id)) xFor.set(r.id, { steps: r.steps }); return xFor.get(r.id); }
function confirmTwice(el, text) {
  if (el.dataset.sure) return true;
  el.dataset.sure = '1';
  toast(text, 3000);
  setTimeout(() => { delete el.dataset.sure; }, 3000);
  return false;
}
$('bookBtn').onclick = () => { sfx.unlock(); openBook(); };

// --- kitchen picker
function openKitchen() {
  const cur = S.M.kitchen || kitchenPrefs();
  const sel = { size: cur.size, cuisine: cur.cuisine };
  const n = S.M.room ? S.M.room.members.length : 1;
  const amHost = !!S.host;
  const render = () => {
    const K = buildKitchen(sel.size, sel.cuisine);
    const caps = kitchenCaps(K);
    const specials = K.fixtures.filter((f) => FIXTURES[f.type].big).map((f) => FIXTURES[f.type].name);
    const fits = RECIPES.filter((r) => canCook(r, K).ok).length;
    showModal('kitchen', `
      <button class="btn small close" data-close>✕</button>
      <h2>🏠 Kitchens</h2>
      <div class="muted">${amHost ? (isHead() ? 'Change this kitchen, or open a different one.' : '') : 'You’re cooking in a friend’s kitchen. Open your own to host.'}</div>
      <h3>Size</h3>
      <div class="row">${SIZE_ORDER.map((s) => `<button class="opt ${sel.size === s ? 'on' : ''} ${SIZES[s].cap < n && amHost ? 'no' : ''}" data-size="${s}"><big>${['🍵', '🫖', '🍳', '🥘', '🍽️', '🏭'][SIZE_ORDER.indexOf(s)]}</big><b>${SIZES[s].name}</b><small>${SIZES[s].cap} cook${SIZES[s].cap > 1 ? 's' : ''}</small></button>`).join('')}</div>
      <h3>Cuisine</h3>
      <div class="row">${CUISINE_ORDER.map((c) => `<button class="opt ${sel.cuisine === c ? 'on' : ''}" data-cu="${c}"><big>${CUISINES[c].flag}</big><b>${CUISINES[c].name}</b></button>`).join('')}</div>
      <p class="muted">${esc(SIZES[sel.size].blurb)} · ${caps.hob} burners · ${caps.bake ? `${caps.bake} oven${caps.bake > 1 ? 's' : ''}` : 'no oven'} · ${caps.board} counters · ${K.fixtures.filter((f) => f.caps.includes('bin')).length} trash can${K.fixtures.filter((f) => f.caps.includes('bin')).length > 1 ? 's' : ''}${specials.length ? ` · ${specials.join(', ')}` : ''} · <b>${fits}</b> recipes fit</p>
      <div class="end">
        ${amHost && isHead() ? `<button class="btn sun" id="kSwitch">Switch this kitchen</button>` : ''}
        <button class="btn ${amHost && isHead() ? '' : 'sun'}" id="kNew">${amHost ? 'Open a new kitchen' : 'Open my own kitchen'}</button>
      </div>`);
    $('modalCard').querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => { sel.size = b.dataset.size; render(); }; });
    $('modalCard').querySelectorAll('[data-cu]').forEach((b) => { b.onclick = () => { sel.cuisine = b.dataset.cu; render(); }; });
    if ($('kSwitch')) $('kSwitch').onclick = () => {
      if (SIZES[sel.size].cap < n) { toast(`${n} cooks won’t fit in a ${SIZES[sel.size].name} kitchen`); return; }
      const C = S.M.cook;
      if (C && C.started && !C.finished && !confirmTwice($('kSwitch'), 'Tap again – the dish in progress starts over')) return;
      store.set('kitchen', sel);
      send({ t: 'kitchen', size: sel.size, cuisine: sel.cuisine });
      closeModal();
    };
    $('kNew').onclick = () => {
      if (S.M.room && S.M.room.members.length > 1 && amHost && !confirmTwice($('kNew'), 'Tap again – your friends will be sent home')) return;
      store.set('kitchen', sel);
      closeModal();
      history.replaceState(null, '', location.pathname);
      if (S.net && S.net.kind !== 'local') { const t = S.net; S.net = null; t.close(); }
      startOwnKitchen(sel);
      toast(`${CUISINES[sel.cuisine].hello} Your new kitchen is ready`);
    };
  };
  render();
}
$('kitchenBtn').onclick = () => { sfx.unlock(); openKitchen(); };

// --- invite & join
function inviteUrl(code) { return `${location.origin}${location.pathname}?k=${code}`; }

function openInvite(withJoin = false) {
  const room = S.M.room;
  const code = room && room.code !== '----' ? room.code : null;
  const cap = S.K ? S.K.cap : 2;
  const n = room ? room.members.length : 1;
  const msg = code ? `Come cook with me in my ${CUISINES[room.kitchen.cuisine].name.toLowerCase()} kitchen on cookwithus! 🍳 Code ${code}: ${inviteUrl(code)}` : '';
  showModal('invite', `
    <button class="btn small close" data-close>✕</button>
    <h2>👋 Cook with friends</h2>
    ${code ? `
      <div class="muted">Share the code or the link – friends land right in this kitchen. (${n}/${cap} cooks${n >= cap ? ' – full! Pick a bigger kitchen' : ''})</div>
      <div class="row" style="margin:12px 0"><span class="bigcode">${code}</span></div>
      <div class="row">
        <button class="btn sun" id="iCopy">🔗 Copy link</button>
        <a class="btn leaf" id="iWa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">🟢 WhatsApp</a>
        <a class="btn" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(inviteUrl(code))}&text=${encodeURIComponent('Come cook with me on cookwithus! 🍳')}">✈️ Telegram</a>
        ${navigator.share ? '<button class="btn" id="iShare">📤 Share…</button>' : ''}
        ${n >= cap && S.host ? '<button class="btn" id="iBigger">🏠 Bigger kitchen</button>' : ''}
      </div>`
    : S.host ? `<div class="muted" style="margin:12px 0">${S.inviteState === 'offline' ? '📡 Can’t reach the matchmaking service right now (offline?). You can keep cooking – the code will appear when we’re back online.' : '⏳ Getting your kitchen code…'}</div>` : ''}
    <h3>🔑 Join a friend’s kitchen</h3>
    <div class="row"><input type="text" id="jCode" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;width:130px;font-family:ui-monospace,monospace;letter-spacing:4px"><button class="btn sun" id="jGo">Join</button></div>
    <div class="muted" style="margin-top:8px;font-size:13px">Kitchens are peer-to-peer: the head chef’s browser is the kitchen, so keep that tab open while you cook together.</div>`);
  if ($('iCopy')) $('iCopy').onclick = async () => { try { await navigator.clipboard.writeText(inviteUrl(code)); toast('Link copied! 📋'); } catch { toast(inviteUrl(code), 6000); } };
  if ($('iShare')) $('iShare').onclick = () => navigator.share({ title: 'cookwithus', text: 'Come cook with me! 🍳', url: inviteUrl(code) }).catch(() => {});
  if ($('iBigger')) $('iBigger').onclick = openKitchen;
  $('jGo').onclick = () => { const c = $('jCode').value; closeModal(); joinKitchen(c); };
  $('jCode').onkeydown = (e) => { if (e.key === 'Enter') $('jGo').click(); };
  if (withJoin && !code) $('jCode').focus();
}
$('inviteBtn').onclick = () => { sfx.unlock(); openInvite(); };
$('kitchenChip').onclick = () => { sfx.unlock(); openInvite(); };
$('joinBtn').onclick = () => { sfx.unlock(); openInvite(true); setTimeout(() => $('jCode') && $('jCode').focus(), 50); };

// --- results
function openResults() {
  const C = S.M.cook;
  if (!C || !C.finished) return;
  const r = recipeById(C.recipe);
  const cooks = Object.entries(C.credits).map(([id, c]) => ({ m: memberById(Number(id)), c })).filter((q) => q.m);
  showModal('results', `
    <button class="btn small close" data-close>✕</button>
    <h2>🎉 Bon appétit!</h2>
    <div class="row" style="align-items:flex-start;gap:20px">
      <canvas id="resDish" width="440" height="300" style="width:260px;height:178px"></canvas>
      <div>
        <h3 style="margin-top:0">${esc(r.name)}</h3>
        <div class="stars">${'⭐'.repeat(C.stars)}<span style="opacity:.25">${'⭐'.repeat(5 - C.stars)}</span></div>
        ${C.verdict ? `<div class="verdict">${C.verdict.length ? C.verdict.map((v) => `<div>${v.note.includes('burnt') || v.note.includes('catching') ? '🔥' : v.what === 'egg' ? '🍳' : '🧂'} ${esc(ingName(v.what, 2))}: ${esc(v.note)}</div>`).join('') : '<div>✨ Cooked just right</div>'}</div>` : ''}
        <div class="muted">Cooked in ${fmtTime(C.elapsed)} · ${S.x.steps.length} steps${C.bagsOut ? ` · ${C.bagsOut} bag${C.bagsOut > 1 ? 's' : ''} of trash out` : ''}</div>
        <ul class="credits">${cooks.map(({ m, c }) => `<li><i style="background:${m.color}"></i><b>${esc(m.name)}</b> <span class="muted">${c.steps} step${c.steps === 1 ? '' : 's'}${c.chores ? ` · ${c.chores} trash run${c.chores === 1 ? '' : 's'}` : ''}</span></li>`).join('')}</ul>
      </div>
    </div>
    <div class="end">
      ${isHead() ? '<button class="btn" id="resAgain">🔁 Cook it again</button><button class="btn sun" id="resNew">📖 Next recipe</button>' : '<span class="muted">The head chef picks what’s next.</span>'}
      <button class="btn" data-close>Admire the kitchen</button>
    </div>`);
  let t = 0;
  const cv = $('resDish');
  clearInterval(closeModal.anim);
  closeModal.anim = setInterval(() => {
    t += 0.05;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    try { drawDish(ctx, r.dish, cv.width / 2, cv.height - 20, 1.5, t); } catch { /* ignore */ }
  }, 50);
  if ($('resAgain')) $('resAgain').onclick = () => { send({ t: 'restart' }); closeModal(); };
  if ($('resNew')) $('resNew').onclick = () => openBook();
}

// --- sound
function refreshSoundBtn() { $('soundBtn').textContent = sfx.muted ? '🔇' : '🔊'; }
$('soundBtn').onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); refreshSoundBtn(); };
// full screen (F / ⛶): the game filling the whole screen – where the browser lets a page do that (not Safari on an
// iPhone: there it's the app added to the home screen that opens full screen)
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const fsOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullscreen() {
  if (!fsOK) return;
  if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  const el = document.documentElement, r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
  if (r && r.catch) r.catch(() => {});
}
const refreshFsBtn = () => $('fsBtn').classList.toggle('on', !!fsEl());
$('fsBtn').hidden = !fsOK;
$('fsBtn').onclick = () => { sfx.unlock(); toggleFullscreen(); };
document.addEventListener('fullscreenchange', refreshFsBtn);
document.addEventListener('webkitfullscreenchange', refreshFsBtn);
refreshSoundBtn();

// --- the sheet folds away (handy on phones)
$('sheetMin').onclick = () => { $('sheet').hidden = true; $('sheetPill').hidden = false; document.body.classList.add('sheetMin'); layout(); };
$('sheetPill').onclick = () => { $('sheet').hidden = false; $('sheetPill').hidden = true; document.body.classList.remove('sheetMin'); layout(); };

// ------------------------------------------------------------------ keyboard

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') {
    // (with the mouse captured, Esc only frees it)
    if (locked() || performance.now() - unlockT < 400) return;
    if (!$('modal').hidden) closeModal();
    else if (!$('menu').hidden) closeMenu();
    else if (S.working) closeStation();
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleFullscreen(); return; }
  const map = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0: 9, '-': 10, '=': 11 };
  if (e.key in map && !e.ctrlKey && !e.metaKey) { send({ t: 'chat', id: map[e.key] }); return; }
});
addEventListener('pointerdown', () => sfx.unlock(), { once: true });
// a clicked button shouldn't keep the focus (Space would press it again)
addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b) b.blur(); });

// ------------------------------------------------------------------ layout & loop

function layout() {
  scene.resize();
  // keep the kitchen centred in the part of the screen the panels leave free
  const sheet = $('sheet');
  const narrow = innerWidth <= 760;
  let left = 0, bottom = 0;
  if (!sheet.hidden) { if (narrow) bottom = sheet.offsetHeight + 10; else left = sheet.offsetWidth + 20; }
  scene.setInsets(left, bottom);
}
addEventListener('resize', layout);

// ?lite / ?fps=N cap the frame rate (slow machines, headless tests); ?stats shows it
const FRAME_MS = params.has('fps') ? 1000 / Math.max(1, Number(params.get('fps'))) : LITE ? 90 : 0;
const STATS = params.has('stats') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'stats' })) : null;
let lastT = performance.now(), statsAt = 0, jsMs = 0;
function frame(now) {
  if (FRAME_MS && now - lastT < FRAME_MS) { requestAnimationFrame(frame); return; }
  const gap = now - lastT;
  const dt = Math.min(FRAME_MS ? 0.12 : 0.05, gap / 1000);
  lastT = now;
  if (S.K && S.M.room) {
    const t0 = performance.now();
    moveMe(dt);
    handsFrame(dt);
    pourFrame(dt);
    S.target = S.working ? null : fpLookTarget() || findTarget();
    tickTimers(dt);
    sendPos(now);
    const view = buildView(now, dt);
    scene.frame(dt, view);
    scene.govern(gap);
    drawTags(view);
    if (S.working) station.frame(dt);
    if (S.sheetDirty && now - S.lastSheet > 200) renderSheet();
    if (now - S.lastClockUi > 250) { S.lastClockUi = now; renderTimers(); renderNudge(); if (S.M.cook && S.M.cook.steps && (Object.values(S.M.cook.steps).some((st) => st.s === 'running') || Object.values(S.M.cook.dw || {}).some((d) => d.run))) S.sheetDirty = true; }
    // the sound of the kitchen
    if (view.D) {
      let sizzle = 0, boil = 0;
      for (const v of Object.values(view.D.vessels)) {
        if (!v.at) continue;
        if (v.heat > 0 && (v.kind === 'pan' || v.kind === 'paellaPan') && v.contents.length) sizzle += v.heat;
        if (v.boil > 0.3) boil += v.boil;
      }
      sfx.ambience(sizzle, boil);
    }
    jsMs += (performance.now() - t0 - jsMs) * 0.05;
    if (STATS && now - statsAt > 500) { statsAt = now; STATS.textContent = `${scene.fps || '…'} fps · ${jsMs.toFixed(1)} ms script · ${scene.quality}`; }
  }
  requestAnimationFrame(frame);
}

function buildView(now, dt) {
  const C = S.M.cook, x = S.x, K = S.K;
  // the display copy of the dish is only rebuilt when something in the kitchen changed
  let D = null;
  if (C && x) {
    if (S.dCache && S.dCache.ver === S.M.ver && S.dCache.C === C) D = S.dCache.D;
    else {
      try { D = displayState(C, x, K); } catch (e) { console.warn(e); }
      S.dCache = { ver: S.M.ver, C, D };
    }
  }
  const cooks = [];
  const room = S.M.room;
  for (const m of room.members) {
    let c;
    if (m.id === S.myId) {
      const me = S.me;
      c = { id: m.id, name: m.name, color: m.color, avatar: m.avatar, x: me.x, y: me.y, yaw: me.yaw, walk: me.walk, me: true };
      if (S.working && S.pose) c.work = S.pose;
    } else {
      const p = S.M.pos.get(m.id);
      if (!p) continue;
      let o = S.others.get(m.id);
      if (!o) { o = newTrack(p); S.others.set(m.id, o); }
      follow(o, p, now, dt);
      c = { id: m.id, name: m.name, color: m.color, avatar: m.avatar, x: o.x, y: o.y, yaw: o.d };
      if (p.p && p.p.tool !== undefined) c.work = p.p;
    }
    // what they're doing (under the name)
    if (C && x) {
      for (const [sid, st] of Object.entries(C.steps)) {
        if (st.s === 'active' && st.by === m.id) { const d = stepDef(x, sid); if (d) c.doing = `${(ACTIONS[d.do] && ACTIONS[d.do].icon) || ''} ${d.name}`; break; }
      }
      const carry = C.carry && C.carry[m.id];
      if (carry && carry.n > 0) { c.carry = carry; if (!c.doing) c.doing = '🤲 carrying scraps'; }
      const held = heldBy(C, m.id);
      if (held.length) { c.holding = held; if (!c.doing) c.doing = `${held.map((k) => thingEmoji(C, k)).join('')} carrying the ${thingName(C, x, held[0])}${held.length > 1 ? ` +${held.length - 1}` : ''}`; }
    }
    const b = S.bubbles.get(m.id);
    if (b && b.until > now) c.bubble = b.text; else if (b) S.bubbles.delete(m.id);
    cooks.push(c);
  }
  // what glows: the equipment and the things for what's next
  const guide = guideNow();
  const busy = new Map();
  const activeAt = new Map(), activeItems = new Map(), activeVessels = new Map(); // (fx → the vessel a step there works in)
  const inHand = new Map(); // a board's own tools in someone's hand just now: fx → Set of 'knife', 'peeler', 'grater'
  if (C && x) {
    for (const [sid, st] of Object.entries(C.steps)) {
      if (st.s !== 'active' || !st.fx) continue;
      const m = memberById(st.by);
      if (m) busy.set(st.fx, m.color);
      const d = stepDef(x, sid);
      if (d && d.item) { activeAt.set(st.fx, d.item); activeItems.set(d.item, st.fx); }
      if (d && (d.into || d.vessel)) activeVessels.set(st.fx, d.into || d.vessel);
      // (mine: as far as I've got with it)
      const phi = S.working && S.working.sid === sid && station.on && station.mode === 'step' ? station.ph : st.ph;
      const ph = d && ACTIONS[d.do] && phasesOf(d, bakeKind(fixtureById(K, st.fx)))[phi];
      const t = ph && (ph.held || (BOARD_TOOLS.includes(ph.tool) && !(ph.g === 'tap' && ph.hot === 'pick') ? ph.tool : null));
      if (t) (inHand.get(st.fx) || inHand.set(st.fx, new Set()).get(st.fx)).add(t);
      // (a board being cleaned: what stood on it is moved aside)
      if (sid.startsWith('#wipe@')) activeAt.set(st.fx, sid);
    }
  }
  // doors being swung right now (mine straight from my hand)
  const doors = new Map();
  if (C && x) {
    for (const [sid, st] of Object.entries(C.steps)) {
      if (st.s !== 'active' || !st.fx) continue;
      const d = stepDef(x, sid);
      const ph = d && phasesOf(d, bakeKind(fixtureById(K, st.fx)))[st.ph];
      if (ph && ph.g === 'door' && st.v != null) doors.set(st.fx, st.v);
    }
  }
  if (C) for (const [id, f] of Object.entries(C.fx)) if (f.swing != null) doors.set(id, f.swing);
  if (S.working && station.g && station.g.kind === 'door') doors.set(S.working.fx, station.g.v);
  if (S.working && S.working.store && station.store) doors.set(S.working.fx, station.store.v);
  // first person: my hand on a door's handle, or carrying something over a shelf
  let fpGrab = null;
  const fd = S.fpDrag;
  if (fd && fd.kind === 'door') { doors.set(fd.fx, fd.v); fpGrab = { w: scene.handleWorld(fd.fx), hand: fd.hand }; }
  if (fd && fd.kind === 'held' && fd.cx != null) fpGrab = { key: fd.key, w: fd.spot ? fd.spot.w.clone().setY(fd.spot.w.y + 0.06) : scene.rayPoint(fd.cx, fd.cy, 0.42) };
  if (fpGrab && !fpGrab.w) fpGrab = null;
  // first person at work: the close-up's state, on its plane in the kitchen (and the pan's real mouth for it)
  let work = null;
  const wf = workFrame();
  if (wf) {
    work = { st: station, frame: wf };
    // a new phase: look at what it's done with (the knob on the stove's front, the tap's lever – and the work)
    const phKey = `${station.ph}|${station.g && station.g.kind}`;
    if (S.workPh !== phKey) {
      S.workPh = phKey;
      // (from where my eyes will be: stepped up to it, leaning in – the dot in the middle of the view on it)
      const real = scene.workReal(wf, station);
      const look = real ? real.w.clone() : wf.O.clone().setY(wf.O.y + 0.06);
      const at = S.workGo || S.me;
      S.me.yaw = Math.atan2(look.x - at.x, look.z - at.y);
      const e = scene.eyeAt(at.x, at.y, S.me.yaw, S.eyeOff || 0, scene.workLeanAt(wf.O, at.x, at.y, !!real));
      S.pitch = Math.max(-1.1, Math.min(0.3, Math.atan2(look.y - e.y, Math.hypot(look.x - e.x, look.z - e.z))));
    }
    const g = station.g, subj = g && (g.subject && g.subject.type === 'vessel' ? g.subject.id : null);
    station.geo = scene.workGeo(wf, subj);
  }
  return { C, D, x, cooks, guide, busy, activeAt, activeItems, activeVessels, inHand, doors, pitch: S.pitch, eyeOff: S.eyeOff || 0, working: !!S.working, target: S.target ? S.target.id : null, fpGrab, work };
}

// Name tags, what each cook is doing, chat bubbles, and the "E · …" prompt:
// HTML laid over the 3D view.
function drawTags(view) {
  const root = $('tags');
  const seen = new Set();
  for (const c of view.cooks) {
    seen.add(String(c.id));
    let el = root.querySelector(`[data-id="${c.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tag';
      el.dataset.id = c.id;
      el.innerHTML = '<div class="bub" hidden></div><b></b><i hidden></i>';
      root.appendChild(el);
    }
    const p = scene.project(c.x, 1.05, c.y);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.hidden = !p.on || (c.me && S.fp);
    const b = el.querySelector('b');
    const label = c.me ? `${c.name} (you)` : c.name;
    if (b.textContent !== label) b.textContent = label;
    b.style.background = c.color;
    const i = el.querySelector('i');
    i.hidden = !c.doing; if (c.doing && i.textContent !== c.doing) i.textContent = c.doing;
    i.style.borderColor = c.color;
    const bub = el.querySelector('.bub');
    bub.hidden = !c.bubble; if (c.bubble && bub.textContent !== c.bubble) bub.textContent = c.bubble;
  }
  for (const el of [...root.children]) if (el.classList.contains('tag') && !seen.has(el.dataset.id)) el.remove();
  // the prompt over what I'm facing
  const pr = $('prompt');
  const f = S.target;
  const all = f && !S.working && $('menu').hidden && $('modal').hidden ? jobsAt(f) : [];
  // (first person: what I'm pointing at, among the cupboards and drawers and what's in them)
  const pt = $('menu').hidden && $('modal').hidden ? fpPointed() : null;
  const ptLabel = pt && fpPointLabel(pt);
  const pour = $('menu').hidden && $('modal').hidden && !touchUI ? pourTarget() : null;
  const work = $('menu').hidden && $('modal').hidden && !touchUI ? workTarget() : null;
  const pourHtml = (work ? `<span class="more"><kbd>R</kbd> ${esc(work.label)}</span>` : '') + (pour ? `<span class="more"><kbd>T</kbd> ${esc(pour.label)}</span>` : '');
  if (!ptLabel && (pour || work)) {
    const p = scene.screenOf((pour || work).w || scene.rayPoint(scene.viewCenter().x, scene.viewCenter().y, 0.6));
    pr.hidden = false;
    pr.style.transform = `translate(${p.x}px, ${p.y - 40}px)`;
    if (pr.dataset.h !== pourHtml) { pr.innerHTML = pourHtml; pr.dataset.h = pourHtml; }
    pr.classList.toggle('dim', false);
  } else if (ptLabel) {
    const p = scene.screenOf(pt.w || scene.rayPoint(scene.viewCenter().x, scene.viewCenter().y, 0.6));
    pr.hidden = false;
    pr.style.transform = `translate(${p.x}px, ${p.y - 40}px)`;
    const html = `${touchUI ? '' : '<kbd>E</kbd> '}${esc(ptLabel)}${pourHtml}`;
    if (pr.dataset.h !== html) { pr.innerHTML = html; pr.dataset.h = html; }
    pr.classList.toggle('dim', false);
    controls.setUseLabel(ptLabel.split(' ')[0] === 'Open' || ptLabel.split(' ')[0] === 'Shut' ? ptLabel.split(' ')[0] : '✋ Do it', true);
  } else if (all.some((j) => !j.off)) {
    const jobs = all.filter((j) => !j.off);
    const look = S.fp && isStore(f) ? fpStoreLook(f) : null;
    const pick = bestJob(f, all);
    const what = look ? look.label : pick ? pick.label : jobs.length ? `${FIXTURES[f.type].name} · ${jobs.length} things to do` : FIXTURES[f.type].name;
    const p = scene.project(f.x + f.w / 2, 0.95, f.y + f.h / 2);
    pr.hidden = false;
    pr.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const more = jobs.length > 1 && !touchUI ? `<span class="more"><kbd>${S.fp ? 'Tab' : 'Q'}</kbd> more</span>` : '';
    const html = `${touchUI ? '' : '<kbd>E</kbd> '}${esc(what)}${more}`;
    if (pr.dataset.h !== html) { pr.innerHTML = html; pr.dataset.h = html; }
    pr.classList.toggle('dim', !jobs.length);
    controls.setUseLabel(pick ? pick.label.split(' ')[0] + ' Do it' : jobs.length ? 'Use' : 'Use', jobs.length > 0);
  } else {
    pr.hidden = true;
    controls.setUseLabel('Use', false);
  }
}

// ------------------------------------------------------------------ start

const pwa = initPwa({
  busy: () => !!(S.M.room && S.M.room.members.length > 1),
  onUpdateReady: () => toast('A fresh version is ready – it loads when you’re cooking alone'),
  onInstallable: () => {},
});
void pwa;

// on a phone the recipe sheet starts folded away, so the kitchen has room
if (innerWidth <= 760) { $('sheet').hidden = true; $('sheetPill').hidden = false; document.body.classList.add('sheetMin'); }
layout();
const wantJoin = params.get('k');
startOwnKitchen();
if (wantJoin) setTimeout(() => joinKitchen(wantJoin), 300);
else if (S.firstVisit) setTimeout(openWelcome, 600);
requestAnimationFrame(frame);

// for debugging in the console
// (tests) stand at a fixture and pick up / put down there
function goAct(act, what, fx) {
  const f = fixtureById(S.K, fx);
  if (!f) return;
  Object.assign(S.me, { x: f.stand.x + 0.5, y: f.stand.y + 0.5, walk: -1, v: { x: 0, y: 0 } });
  doAct(act, what, fx);
}
function goStore(fx) {
  const f = fixtureById(S.K, fx);
  if (!f) return;
  Object.assign(S.me, { x: f.stand.x + 0.5, y: f.stand.y + 0.5, walk: -1, v: { x: 0, y: 0 } });
  openStore(fx);
}
// (tests) a point of the close-up, on the screen – in first person, where it is on the work plane in the kitchen
function workScreen(x, y) {
  const w = workFrame();
  if (!w) return station.toClient(x, y);
  // (a door: its real handle, as far open as the close-up point would have it)
  const g = station.g;
  if (g && g.kind === 'door' && scene.doorHandleAt(w.fx, 0)) return scene.screenOf(scene.doorHandleAt(w.fx, station.doorOpenAt(g.geo, { x, y })));
  const s = scene.screenOf(scene.workWorld(w, x, y)), off = scene.workOffset(w, station);
  return { x: s.x - off.x, y: s.y - off.y };
}
window.cookwithus = { S, scene, station, sfx, goDo, goAct, goStore, closeStation, send, useNow, workScreen, toggleView };
