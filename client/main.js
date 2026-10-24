// cookwithus – the page: your kitchen, the cooks in it, the recipe sheet,
// timers, chat, invites and dialogs. You land in your own cozy kitchen at once
// (it runs in this tab); friends join it with the code / link, or you join theirs.
import { HostSession, PeerNet } from './p2p.js';
import { Scene3D, LITE } from './scene3d.js';
import { Controls, isTouchDevice, lockZoom } from './controls.js';
import { applyUiTheme } from './theme.js';
import { Station } from './station.js';
import { Sfx } from './audio.js';
import { lookOf, drawPortrait, drawCook } from './figure.js';
import { drawDish } from './art.js';
import { initPwa } from './pwa.js';
import { newMirror, applyMsg } from '../shared/mirror.js';
import { SIZES, SIZE_ORDER, CUISINES, CUISINE_ORDER, FIXTURES, buildKitchen, kitchenCaps, fixtureById, bakeKind } from '../shared/kitchens.js';
import { RECIPES } from '../shared/recipes.js';
import {
  expanded, stepDef, stepPlaces, placeBusy, canCook, recipeById, displayState, stepIcon, SPEEDS,
  choreId, carrying, binHolds, SCRAP_LIMIT, stepDuration,
} from '../shared/cook.js';
import { phasesOf, ACTIONS } from '../shared/actions.js';
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
const SPEED = 2.8;   // tiles per second
const RADIUS = 0.26; // how wide a cook is

// ------------------------------------------------------------------ state

const S = {
  profile: sanitizeProfile(store.get('profile', null) || randomProfile()),
  firstVisit: !store.get('profile', null),
  net: null, host: null, M: newMirror(), myId: -1,
  K: null, x: null,
  me: { x: 2.5, y: 2.5, yaw: 0, walk: -1, placed: false },
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
const sfx = new Sfx();
const station = new Station($('stCanvas'), {
  act: (m) => send(m),
  sfx: (n, v) => sfx.play(n, v),
  pose: (p) => { S.pose = p; },
  progress: (info) => stationProgress(info),
});

function send(obj) { if (S.net) S.net.send(obj); }
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
  const host = new HostSession({ name: `${S.profile.name}'s kitchen`, size: pref.size, cuisine: pref.cuisine, recipe }, (state, code) => {
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
  Object.assign(S.me, { x: sp.x + 0.5, y: sp.y + 0.5, yaw: Math.PI * 1.25, walk: -1, placed: true });
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
  // open & active first, then running, then locked, then done
  const order = { active: 0, open: 1, ready: 2, running: 3, locked: 4, done: 5 };
  const list = x.steps.map((s, i) => ({ s, st: C.steps[s.id], i }))
    .sort((a, b) => (order[a.st.s] - order[b.st.s]) || (a.i - b.i));
  const html = [];
  for (const { s, st } of list) {
    const cls = [st.s];
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
    else if (st.s === 'running') sub = `⏳ ${fmtTime(Math.max(0, stepDuration(C, x, S.K, s) - st.t))} left${C.speed > 1 ? ` · ${C.speed}×` : ''}`;
    else if (st.s === 'ready') sub = '⏰ ready!';
    else if (st.s === 'locked') { const need = s.after.filter((a) => C.steps[a] && C.steps[a].s !== 'done').map((a) => stepDef(x, a)).filter(Boolean); sub = need.length ? `after: ${esc(need[0].name)}${need.length > 1 ? ` +${need.length - 1}` : ''}` : ''; }
    const canAct = st.s === 'open' || (st.s === 'active' && st.by === S.myId);
    const acts = [];
    if (st.s !== 'done' && s.do !== 'wait') acts.push(`<button data-claim="${s.id}" class="${st.claim.includes(S.myId) ? 'on' : ''}" title="I’ll do this">✋</button>`);
    if (canAct) acts.push(`<button data-go="${s.id}" class="go ${S.sel === s.id ? 'on' : ''}" title="Where do I do this?">📍</button>`);
    let bar = '';
    if (st.s === 'running') bar = `<div class="bar"><i style="width:${Math.min(100, st.t / stepDuration(C, x, S.K, s) * 100)}%"></i></div>`;
    html.push(`<li class="${cls.join(' ')}" data-sid="${s.id}"><span class="ic">${st.s === 'done' ? '✅' : st.s === 'locked' ? '🔒' : stepIcon(s)}</span><span class="nm">${esc(s.name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="who">${who.join('')}</span><span class="acts">${acts.join('')}</span>${bar}</li>`);
  }
  $('steps').innerHTML = html.join('');
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
  const places = stepPlaces(C, x, K, s).filter((p) => !placeBusy(C, x, K, s, p, S.myId));
  if (!places.length) { toast('No free place for that right now – someone is working there'); return; }
  toast(`📍 Walk to the glowing spot and press ${controls.root.hidden ? 'E' : 'Use'}`);
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
  Object.assign(S.me, { x: f.stand.x + 0.5, y: f.stand.y + 0.5, walk: -1 });
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
  if (x < RADIUS || y < RADIUS || x > K.w - RADIUS || y > K.h - RADIUS) return true;
  for (let ty = Math.floor(y - RADIUS); ty <= Math.floor(y + RADIUS); ty++) {
    for (let tx = Math.floor(x - RADIUS); tx <= Math.floor(x + RADIUS); tx++) {
      if (tx < 0 || ty < 0 || tx >= K.w || ty >= K.h || !K.solid[ty][tx]) continue;
      const cx = Math.max(tx, Math.min(tx + 1, x)), cy = Math.max(ty, Math.min(ty + 1, y));
      if ((x - cx) ** 2 + (y - cy) ** 2 < RADIUS * RADIUS) return true;
    }
  }
  return false;
}

function moveMe(dt) {
  const me = S.me;
  if (S.working || !$('modal').hidden || !$('menu').hidden) { me.walk = -1; return; }
  const d = controls.dir();
  if (!d.mag) { me.walk = -1; return; }
  // the stick / keys are in screen space: turn them into kitchen directions
  const ax = scene.screenAxes();
  const det = ax.x[0] * ax.z[1] - ax.x[1] * ax.z[0];
  if (Math.abs(det) < 1e-6) return;
  let u = (d.x * ax.z[1] - d.y * ax.z[0]) / det, w = (ax.x[0] * d.y - ax.x[1] * d.x) / det;
  const n = Math.hypot(u, w) || 1; u /= n; w /= n;
  const step = SPEED * d.mag * dt;
  const K = S.K;
  if (!blocked(K, me.x + u * step, me.y)) me.x += u * step;
  if (!blocked(K, me.x, me.y + w * step)) me.y += w * step;
  me.yaw = Math.atan2(u, w);
  me.walk = ((me.walk < 0 ? 0 : me.walk) + dt * 2.3 * Math.max(0.5, d.mag)) % 1;
}

// The fixture right in front of me (close, and roughly where I face).
function findTarget() {
  const me = S.me, K = S.K;
  let best = null, bestScore = 0.85;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
  for (const f of K.fixtures) {
    if (!f.caps.length) continue;
    const cx = Math.max(f.x, Math.min(f.x + f.w, me.x)), cz = Math.max(f.y, Math.min(f.y + f.h, me.y));
    const dx = cx - me.x, dz = cz - me.y;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.72) continue;
    const facing = dist > 1e-3 ? (dx * fx + dz * fz) / dist : 1;
    if (facing < -0.1) continue;
    const score = dist - facing * 0.4;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

// E / Space / the Use button
function useNow() {
  sfx.unlock();
  if (!$('menu').hidden) { const bs = [...$('menu').querySelectorAll('button:not([disabled])')]; const b = bs[S.menuSel] || bs[0]; if (b) b.click(); return; }
  if (S.working || !$('modal').hidden) return;
  const f = S.target;
  if (!f) { toast('Walk up to a counter, the sink, the stove … and use it'); return; }
  const jobs = jobsAt(f).filter((j) => !j.off);
  const pick = (S.sel && jobs.find((j) => j.sid === S.sel)) || (jobs.length === 1 ? jobs[0] : null);
  if (pick) { startJob(pick.sid, f.id); return; }
  if (!jobsAt(f).length) { toast(`Nothing to do at the ${FIXTURES[f.type].name.toLowerCase()} right now`); return; }
  openMenu(f);
}

function sendPos(now) {
  const me = S.me;
  const p = S.working && S.pose ? { ...S.pose, fx: S.working.fx } : null;
  const key = `${me.x.toFixed(2)},${me.y.toFixed(2)},${me.yaw.toFixed(2)},${me.walk >= 0},${p ? `${p.tool}${p.a.toFixed(2)}${(p.b || 0).toFixed(2)}${p.mode}` : ''}`;
  const changed = key !== S.lastPosKey;
  if ((changed && now - S.lastPos > 90) || now - S.lastPos > 2000) {
    S.lastPos = now; S.lastPosKey = key;
    send({ t: 'pos', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, d: Math.round(me.yaw * 100) / 100, w: me.walk >= 0 ? 1 : 0, p });
  }
}

// ------------------------------------------------------------------ the station

function openStation(sid, fx) {
  const C = S.M.cook, x = S.x, K = S.K;
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
  // zoom in from where the fixture is in the kitchen
  const el = $('station');
  const at = scene.project(f.x + f.w / 2, 0.5, f.y + f.h / 2);
  const cx = at.x, cy = at.y;
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--ox', `${cx - r.left}px`);
  el.style.setProperty('--oy', `${cy - r.top}px`);
  el.classList.remove('zoom'); void el.offsetWidth; el.classList.add('zoom');
  $('stIcon').textContent = (ACTIONS[s.do] && ACTIONS[s.do].icon) || '🍳';
  $('stName').textContent = s.name;
  station.open({ sid, def: s, st, phases, f, bk: bakeKind(f), pal: K.palette, C, x, K, me: S.myId, look: lookOf(S.profile.avatar) });
  sfx.play('whoosh', 0.5);
}

function closeStation(silent = false) {
  if (!S.working) { $('station').hidden = true; return; }
  const sid = S.working.sid;
  const st = S.M.cook && S.M.cook.steps[sid];
  if (st && st.s === 'active' && st.by === S.myId) send({ t: 'close', sid });
  S.working = null;
  S.pose = null;
  station.close();
  $('station').hidden = true;
  if (!silent) sfx.play('ui');
}
$('stClose').onclick = () => closeStation();

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
}

// ------------------------------------------------------------------ the kitchen view

const canvas = $('world');
// two fingers pinch-zoom the kitchen; the mouse wheel too
const touches = new Map();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { sfx.unlock(); closeMenu(); touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) scene.zoomBy(d / pinch);
    pinch = d;
  }
});
const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; };
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); scene.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

const controls = new Controls({
  onUse: () => useNow(),
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
controls.setTouch(touchUI);
if (touchUI) lockZoom();

function jobsAt(f) {
  const C = S.M.cook, x = S.x, K = S.K;
  const out = [];
  if (C && x) {
    for (const s of x.steps) {
      const st = C.steps[s.id];
      if (!(st.s === 'open' || (st.s === 'active' && st.by === S.myId))) continue;
      if (!stepPlaces(C, x, K, s).some((p) => p.fx === f.id)) continue;
      const mine = st.claim.includes(S.myId);
      const others = st.claim.filter((id) => id !== S.myId).map(memberById).filter(Boolean);
      const messy = st.ph === 0 && st.k === 0 && C.scraps[f.id] && C.scraps[f.id].n >= SCRAP_LIMIT;
      const busy = placeBusy(C, x, K, s, { fx: f.id, slot: 0 }, S.myId);
      const hands = carrying(C, S.myId);
      const why = hands ? ' (hands full)' : messy ? ' (clear the scraps first)' : busy ? ' (busy)' : '';
      out.push({ sid: s.id, label: `${stepIcon(s)} ${s.name}${why}`, mine, others, off: !!why, sel: S.sel === s.id });
    }
    out.sort((a, b) => (b.sel - a.sel) || (a.off - b.off) || (b.mine - a.mine) || (a.others.length - b.others.length));
    // the trash
    const sc = C.scraps[f.id];
    if (sc && sc.n > 0) out.unshift({ sid: choreId('clear', f.id), label: `🧹 Clear the scraps (${sc.n})`, chore: true });
    if (f.caps.includes('bin')) {
      const fill = (C.bins[f.id] || { fill: 0 }).fill, holds = binHolds(f);
      if (carrying(C, S.myId)) out.unshift({ sid: choreId('toss', f.id), label: fill >= holds ? '🗑️ Full! Change the bag first' : `🗑️ Throw away the scraps`, chore: true, off: fill >= holds });
      if (fill >= holds * 0.5) out.push({ sid: choreId('bag', f.id), label: `🛍️ Change the bag (${fill}/${holds})`, chore: true });
    }
  }
  return out;
}

function openMenu(f) {
  const jobs = jobsAt(f);
  const m = $('menu');
  const extra = f.caps.includes('bin') && S.M.cook ? ` <span class="muted">· ${(S.M.cook.bins[f.id] || { fill: 0 }).fill}/${binHolds(f)} full</span>` : '';
  m.innerHTML = `<h4>${esc(FIXTURES[f.type].name)}${extra}</h4>`
    + (jobs.length ? jobs.map((j) => `<button data-sid="${esc(j.sid)}" class="${j.chore ? 'chore' : ''}" ${j.off ? 'disabled' : ''}>${esc(j.label)}${j.mine ? ' ✋' : ''}${j.others && j.others.length ? ` <span class="muted">(${esc(j.others[0].name)}’s)</span>` : ''}</button>`).join('')
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
    startJob(b.dataset.sid, f.id);
  };
}
function closeMenu() { $('menu').hidden = true; controls.menuOpen = false; }

// ------------------------------------------------------------------ timers

function renderTimers() {
  const C = S.M.cook, x = S.x;
  const el = $('timers');
  if (!C || !x || C.finished) { el.hidden = true; return; }
  const rows = [];
  for (const s of x.steps) {
    const st = C.steps[s.id];
    if (st.s !== 'running' && st.s !== 'ready') continue;
    const dur = stepDuration(C, x, S.K, s);
    const left = Math.max(0, dur - st.t);
    rows.push(`<div class="timer ${st.s}"><span>${st.s === 'ready' ? '⏰' : '⏳'} ${esc(s.name)}</span><span class="tb"><i style="width:${Math.min(100, st.t / dur * 100)}%"></i></span><span class="tt">${st.s === 'ready' ? 'ready!' : fmtTime(left)}</span>${st.s === 'running' ? `<button class="btn small" data-skip="${s.id}" title="Skip to the end">⏭ Skip</button>` : ''}</div>`);
  }
  if (!rows.length) { el.hidden = true; return; }
  el.hidden = false;
  $('timerList').innerHTML = rows.join('');
  const sp = SPEEDS.map((v) => `<button data-speed="${v}" class="${C.speed === v ? 'on' : ''}">${v}×</button>`).join('');
  if ($('speeds').dataset.k !== String(C.speed)) { $('speeds').innerHTML = `<span class="muted">Speed</span> ${sp}`; $('speeds').dataset.k = String(C.speed); }
}
$('timers').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.skip) { send({ t: 'skip', sid: b.dataset.skip }); sfx.play('whoosh'); }
  if (b.dataset.speed) { send({ t: 'speed', x: Number(b.dataset.speed) }); sfx.play('ui'); }
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
  if (c && !S.working) {
    if (el.dataset.k !== `c${c.n}`) {
      el.dataset.k = `c${c.n}`;
      el.innerHTML = `🤲 Your hands are full of scraps (${c.n}) <button class="btn small sun" id="toBin">🗑️ To the bin</button>`;
      $('toBin').onclick = () => toBin();
    }
    el.hidden = false;
  } else el.hidden = true;
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
    $('pRand').onclick = () => { const r = randomProfile(); draft.avatar = r.avatar; render(); };
    $('pSave').onclick = () => {
      const n = cleanName(draft.name);
      if (!n) { $('pErr').textContent = 'Your cook needs a name!'; return; }
      if (isProfane(n)) { $('pErr').textContent = 'Let’s keep the kitchen friendly – pick another name 🙂'; return; }
      setProfile({ ...draft, name: n });
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
refreshSoundBtn();

// --- the sheet folds away (handy on phones)
$('sheetMin').onclick = () => { $('sheet').hidden = true; $('sheetPill').hidden = false; document.body.classList.add('sheetMin'); layout(); };
$('sheetPill').onclick = () => { $('sheet').hidden = false; $('sheetPill').hidden = true; document.body.classList.remove('sheetMin'); layout(); };

// ------------------------------------------------------------------ keyboard

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') {
    if (!$('modal').hidden) closeModal();
    else if (!$('menu').hidden) closeMenu();
    else if (S.working) closeStation();
    return;
  }
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

// ?lite / ?fps=N cap the frame rate (slow machines, headless tests)
const FRAME_MS = params.has('fps') ? 1000 / Math.max(1, Number(params.get('fps'))) : LITE ? 90 : 0;
let lastT = performance.now();
function frame(now) {
  if (FRAME_MS && now - lastT < FRAME_MS) { requestAnimationFrame(frame); return; }
  const dt = Math.min(FRAME_MS ? 0.12 : 0.05, (now - lastT) / 1000);
  lastT = now;
  if (S.K && S.M.room) {
    moveMe(dt);
    S.target = S.working ? null : findTarget();
    tickTimers(dt);
    sendPos(now);
    const view = buildView(now, dt);
    scene.frame(dt, view);
    drawTags(view);
    if (S.working) station.frame(dt);
    if (S.sheetDirty && now - S.lastSheet > 200) renderSheet();
    if (now - S.lastClockUi > 250) { S.lastClockUi = now; renderTimers(); renderNudge(); if (S.M.cook && S.M.cook.steps && Object.values(S.M.cook.steps).some((st) => st.s === 'running')) S.sheetDirty = true; }
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
  }
  requestAnimationFrame(frame);
}

function buildView(now, dt) {
  const C = S.M.cook, x = S.x, K = S.K;
  let D = null;
  if (C && x) {
    try { D = displayState(C, x, K); } catch (e) { console.warn(e); }
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
      if (!o) { o = { x: p.x, y: p.y, walk: -1 }; S.others.set(m.id, o); }
      const k = 1 - Math.exp(-dt * 10);
      o.x += (p.x - o.x) * k; o.y += (p.y - o.y) * k;
      if (Math.hypot(p.x - o.x, p.y - o.y) > 3) { o.x = p.x; o.y = p.y; }
      o.walk = p.w ? ((o.walk < 0 ? 0 : o.walk) + dt * 2.3) % 1 : -1;
      c = { id: m.id, name: m.name, color: m.color, avatar: m.avatar, x: o.x, y: o.y, yaw: p.d || 0, walk: o.walk };
      if (p.p && p.p.tool !== undefined) c.work = p.p;
    }
    // what they're doing (under the name)
    if (C && x) {
      for (const [sid, st] of Object.entries(C.steps)) {
        if (st.s === 'active' && st.by === m.id) { const d = stepDef(x, sid); if (d) c.doing = `${(ACTIONS[d.do] && ACTIONS[d.do].icon) || ''} ${d.name}`; break; }
      }
      const carry = C.carry && C.carry[m.id];
      if (carry && carry.n > 0) { c.carry = carry; if (!c.doing) c.doing = '🤲 carrying scraps'; }
    }
    const b = S.bubbles.get(m.id);
    if (b && b.until > now) c.bubble = b.text; else if (b) S.bubbles.delete(m.id);
    cooks.push(c);
  }
  // golden arrows: where the step I picked can be done, or the bins for my scraps
  const guide = new Set();
  const busy = new Map();
  const activeAt = new Map(), activeItems = new Map();
  if (C && x) {
    if (carrying(C, S.myId)) {
      const bins = K.fixtures.filter((f) => f.caps.includes('bin'));
      const free = bins.filter((f) => (C.bins[f.id] || { fill: 0 }).fill < binHolds(f));
      for (const f of free.length ? free : bins) guide.add(f.id);
    } else if (S.sel && C.steps[S.sel] && ['open', 'active'].includes(C.steps[S.sel].s)) {
      const s = stepDef(x, S.sel);
      if (s) for (const p of stepPlaces(C, x, K, s)) if (!placeBusy(C, x, K, s, p, S.myId)) guide.add(p.fx);
    } else if (S.sel && C.steps[S.sel] && C.steps[S.sel].s === 'done') S.sel = null;
    for (const [sid, st] of Object.entries(C.steps)) {
      if (st.s !== 'active' || !st.fx) continue;
      const m = memberById(st.by);
      if (m) busy.set(st.fx, m.color);
      const d = stepDef(x, sid);
      if (d && d.item) { activeAt.set(st.fx, d.item); activeItems.set(d.item, st.fx); }
    }
  }
  return { C, D, x, cooks, guide, busy, activeAt, activeItems, target: S.target ? S.target.id : null };
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
    el.hidden = !p.on;
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
  if (f && !S.working && $('menu').hidden && $('modal').hidden) {
    const jobs = jobsAt(f).filter((j) => !j.off);
    const pick = (S.sel && jobs.find((j) => j.sid === S.sel)) || (jobs.length === 1 ? jobs[0] : null);
    const what = pick ? pick.label : jobs.length ? `${FIXTURES[f.type].name} · ${jobs.length} things to do` : FIXTURES[f.type].name;
    const p = scene.project(f.x + f.w / 2, 0.95, f.y + f.h / 2);
    pr.hidden = false;
    pr.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const html = `${touchUI ? '' : '<kbd>E</kbd> '}${esc(what)}`;
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
window.cookwithus = { S, scene, station, sfx, goDo, closeStation, send, useNow };
