// A kitchen room: the cooks in it, the kitchen, and the dish being cooked.
// Runs in the browser of the cook who opened the kitchen (serverless, like
// the football game's rooms) or in a Node server; it only talks to `client`
// objects with sendText(string).
//
// Authority: the room owns the recipe progress (shared/cook.js) – every
// gesture a cook makes is checked and applied here, then the changes go out
// to everyone as small 'up' messages (only the steps/items/pots that changed).
// Movement is the cooks' own: each client walks its cook and reports where it
// is (and what its hands are doing) ~10× a second; the room relays that.

import { buildKitchen, SIZES, CUISINES, fixtureById } from './kitchens.js';
import {
  recipeById, canCook, newCook, expanded, openStep, closeStep, actStep, tickCook, toggleClaim, dropMember,
  setSpeed, skipWait, SPEEDS,
} from './cook.js';
import { sanitizeProfile, QUICK_CHAT, COOK_COLORS } from './names.js';

export const PROTOCOL = 1;
const FLUSH_MS = 50;
const POS_MS = 100;
const CLOCK_MS = 250;

export class Room {
  constructor(code, { name = 'Kitchen', size = 'small', cuisine = 'turkish', recipe = null } = {}) {
    this.code = code;
    this.name = String(name).replace(/[<>]/g, '').slice(0, 28);
    this.members = new Map();   // client id -> member
    this.hostId = null;         // the cook who opened the kitchen – picks recipe & kitchen
    this.kitchen = buildKitchen(size, cuisine);
    this.cook = null;
    this.x = null;
    this.sent = freshSent();
    this.ev = [];
    this.now = 0;
    this.lastFlush = 0; this.lastPos = 0; this.lastClock = 0;
    this.colorNext = 0;
    if (recipe) this.startRecipe(recipe, true);
  }

  // ------------------------------------------------------------ membership

  join(client) {
    if (this.members.size >= this.kitchen.cap) {
      client.sendText(JSON.stringify({ t: 'error', text: `This ${SIZES[this.kitchen.size].name} kitchen is full (${this.kitchen.cap} cook${this.kitchen.cap > 1 ? 's' : ''})`, full: true }));
      return false;
    }
    const sp = this.kitchen.spawns[this.members.size % this.kitchen.spawns.length];
    const used = new Set([...this.members.values()].map((m) => m.color));
    let color = COOK_COLORS[this.colorNext++ % COOK_COLORS.length];
    for (const c of COOK_COLORS) if (!used.has(c)) { color = c; break; }
    const m = {
      id: client.id, client, name: client.profile.name, avatar: client.profile.avatar, color,
      x: sp.x + 0.5, y: sp.y + 0.5, d: 1, w: 0, p: null, lastChat: 0,
    };
    this.members.set(client.id, m);
    client.room = this;
    if (this.hostId === null) this.hostId = client.id;
    this.system(`${m.name} came into the kitchen`);
    this.broadcastRoom();
    client.sendText(JSON.stringify(this.cookMsg()));
    return true;
  }

  leave(client) {
    const m = this.members.get(client.id);
    if (!m) return;
    this.members.delete(client.id);
    client.room = null;
    if (this.cook) dropMember(this.cook, this.x, client.id);
    if (this.hostId === client.id) this.hostId = this.members.size ? this.members.keys().next().value : null;
    if (!this.members.size) return;
    this.system(`${m.name} left the kitchen`);
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ the dish

  startRecipe(id, quiet = false) {
    const r = recipeById(id);
    if (!r) return 'No such recipe';
    const ok = canCook(r, this.kitchen);
    if (!ok.ok) return `${r.name}: ${ok.why.toLowerCase()} – try a bigger kitchen`;
    this.cook = newCook(r, this.kitchen);
    this.x = expanded(this.cook, this.kitchen.cap);
    this.sent = freshSent();
    if (!quiet) {
      this.system(`Today's dish: ${r.name}!`);
      this.broadcastAll(this.cookMsg());
    }
    this.snapshotSent();
    return '';
  }

  setKitchen(size, cuisine) {
    if (!SIZES[size] || !CUISINES[cuisine]) return 'Unknown kitchen';
    if (SIZES[size].cap < this.members.size) return `Too many cooks for a ${SIZES[size].name} kitchen`;
    this.kitchen = buildKitchen(size, cuisine);
    const recipe = this.cook ? this.cook.recipe : null;
    this.cook = null; this.x = null;
    if (recipe) {
      const err = this.startRecipe(recipe, true);
      if (err) { this.cook = null; this.x = null; }
    }
    this.system(`Welcome to the ${SIZES[size].name} ${CUISINES[cuisine].name} kitchen ${CUISINES[cuisine].flag}`);
    this.broadcastRoom();
    this.broadcastAll(this.cookMsg());
    return '';
  }

  // ------------------------------------------------------------ messages from cooks

  handleText(client, msg) {
    const m = this.members.get(client.id);
    if (!m) return;
    const isHost = m.id === this.hostId;
    const C = this.cook, x = this.x, K = this.kitchen;
    switch (msg.t) {
      case 'hello':
      case 'profile':
        client.profile = sanitizeProfile(msg.profile);
        m.name = client.profile.name; m.avatar = client.profile.avatar;
        this.broadcastRoom();
        break;
      case 'pos': {
        const px = Number(msg.x), py = Number(msg.y);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          m.x = Math.max(0, Math.min(K.w, px)); m.y = Math.max(0, Math.min(K.h, py));
        }
        m.d = Math.round((Number(msg.d) || 0) * 100) / 100; m.w = msg.w ? 1 : 0; // facing (radians)
        m.ts = Number.isFinite(+msg.ts) ? Math.round(+msg.ts) : 0; // the sender's clock, for smooth playback
        m.p = msg.p && typeof msg.p === 'object' ? { s: String(msg.p.s || '').slice(0, 40), tool: String(msg.p.tool || '').slice(0, 16), mode: String(msg.p.mode || '').slice(0, 10), a: +msg.p.a || 0, b: +msg.p.b || 0, fx: String(msg.p.fx || '').slice(0, 20) } : null;
        break;
      }
      case 'recipe': {
        if (!isHost) return this.whisper(m, 'Only the head chef picks the recipe');
        const err = this.startRecipe(String(msg.id));
        if (err) this.whisper(m, err);
        break;
      }
      case 'kitchen': {
        if (!isHost) return this.whisper(m, 'Only the head chef can change the kitchen');
        const err = this.setKitchen(String(msg.size), String(msg.cuisine));
        if (err) this.whisper(m, err);
        break;
      }
      case 'restart':
        if (!isHost) return;
        if (C) this.startRecipe(C.recipe);
        break;
      case 'claim':
        if (C && toggleClaim(C, String(msg.sid), m.id)) this.flushSoon();
        break;
      case 'open': {
        if (!C) return;
        const sid = String(msg.sid);
        const err = openStep(C, x, K, sid, { fx: String(msg.fx) }, m.id);
        client.sendText(JSON.stringify({ t: 'opened', sid, err, fx: err ? null : C.steps[sid].fx }));
        if (!err) this.flush(true);
        break;
      }
      case 'act': {
        if (!C) return;
        const ev = actStep(C, x, K, String(msg.sid), m.id, msg);
        if (ev) { for (const e of ev) { e.by = m.id; this.ev.push(e); } if (!msg.live || this.now - this.lastFlush > 150) this.flush(true); }
        break;
      }
      case 'close':
        if (C && closeStep(C, x, String(msg.sid), m.id)) this.flush(true);
        break;
      case 'speed': {
        const s = Number(msg.x);
        if (C && SPEEDS.includes(s) && s !== C.speed) {
          setSpeed(C, s);
          this.system(`${m.name} set the timers to ${s}×`);
          this.sendClock();
        }
        break;
      }
      case 'skip':
        if (C && skipWait(C, x, K, String(msg.sid))) {
          const s = x.steps.find((q) => q.id === String(msg.sid));
          this.system(`${m.name} skipped ahead: ${s ? s.name : 'timer'}`);
          this.sendClock();
          this.flush(true);
        }
        break;
      case 'chat': {
        const i = Number(msg.id);
        const now = Date.now();
        if (!Number.isInteger(i) || i < 0 || i >= QUICK_CHAT.length || now - m.lastChat < 1200) break;
        m.lastChat = now;
        this.broadcastAll({ t: 'chat', from: m.name, text: QUICK_CHAT[i], id: m.id, color: m.color, at: now });
        break;
      }
    }
  }

  // ------------------------------------------------------------ time

  // Called ~20× a second with the real time in ms.
  tick(nowMs) {
    const dt = this.now ? Math.min(1, (nowMs - this.now) / 1000) : 0;
    this.now = nowMs;
    if (this.cook && dt > 0) {
      const ev = tickCook(this.cook, this.x, this.kitchen, dt);
      if (ev.length) { this.ev.push(...ev); this.flush(true); }
    }
    if (nowMs - this.lastFlush >= FLUSH_MS) this.flush();
    if (nowMs - this.lastPos >= POS_MS) this.sendPositions();
    if (nowMs - this.lastClock >= CLOCK_MS) this.sendClock();
  }

  flushSoon() { this.lastFlush = 0; }

  // ------------------------------------------------------------ outgoing

  snapshotSent() {
    const C = this.cook;
    if (!C) return;
    for (const [id, st] of Object.entries(C.steps)) this.sent.steps[id] = stepKey(st);
    for (const [id, it] of Object.entries(C.items)) this.sent.items[id] = JSON.stringify(it);
    for (const [id, v] of Object.entries(C.vessels)) this.sent.vessels[id] = vesselKey(v);
    for (const key of ['fx', 'scraps', 'bins', 'carry']) for (const [id, f] of Object.entries(C[key])) this.sent[key][id] = JSON.stringify(f);
    this.sent.meta = metaKey(C);
  }

  // Send what changed since the last flush (steps, items, pots, fixtures).
  flush(force = false) {
    if (!force && this.now - this.lastFlush < FLUSH_MS) return;
    this.lastFlush = this.now;
    const C = this.cook;
    if (!C) { this.ev = []; return; }
    const up = { t: 'up', recipe: C.recipe };
    let any = false;
    const diff = (key, src, keyFn) => {
      let out = null;
      for (const [id, v] of Object.entries(src)) {
        const k = keyFn(v);
        if (this.sent[key][id] !== k) { this.sent[key][id] = k; (out = out || {})[id] = v; }
      }
      if (out) { up[key] = out; any = true; }
    };
    diff('steps', C.steps, stepKey);
    diff('items', C.items, (v) => JSON.stringify(v));
    diff('vessels', C.vessels, vesselKey);
    diff('fx', C.fx, (v) => JSON.stringify(v));
    diff('scraps', C.scraps, (v) => JSON.stringify(v));
    diff('bins', C.bins, (v) => JSON.stringify(v));
    diff('carry', C.carry, (v) => JSON.stringify(v));
    const mk = metaKey(C);
    if (mk !== this.sent.meta) { this.sent.meta = mk; Object.assign(up, metaOf(C)); any = true; }
    if (this.ev.length) { up.ev = this.ev; this.ev = []; any = true; }
    if (any) this.broadcastAll(up);
  }

  sendPositions() {
    this.lastPos = this.now;
    if (this.members.size < 2) return;
    const list = [...this.members.values()].map((m) => [m.id, r2(m.x), r2(m.y), m.d, m.w, m.p, m.ts || 0]);
    const s = JSON.stringify({ t: 'pos', m: list });
    for (const m of this.members.values()) m.client.sendText(s);
  }

  sendClock() {
    this.lastClock = this.now;
    const C = this.cook;
    if (!C || !this.x) return;
    const w = {};
    for (const s of this.x.steps) {
      const st = C.steps[s.id];
      if (st.s === 'running' || st.s === 'ready') w[s.id] = [Math.round(st.t * 10) / 10, Math.round(st.over)];
    }
    const boil = {};
    for (const [id, v] of Object.entries(C.vessels)) if (v.boil > 0 || v.heat > 0) boil[id] = v.boil;
    this.broadcastAll({ t: 'clock', speed: C.speed, el: Math.round(C.elapsed), w, boil });
  }

  cookMsg() {
    return { t: 'cook', kitchen: { size: this.kitchen.size, cuisine: this.kitchen.cuisine }, cook: this.cook };
  }

  roomState() {
    return {
      t: 'room', code: this.code, name: this.name, hostId: this.hostId,
      kitchen: { size: this.kitchen.size, cuisine: this.kitchen.cuisine },
      recipe: this.cook ? this.cook.recipe : null,
      members: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, avatar: m.avatar, color: m.color })),
    };
  }

  setCode(code) {
    this.code = code;
    this.broadcastRoom();
  }

  broadcastRoom() { this.broadcastAll(this.roomState()); }

  broadcastAll(obj) {
    const s = JSON.stringify(obj);
    for (const m of this.members.values()) m.client.sendText(s);
  }

  system(text) { this.broadcastAll({ t: 'chat', from: null, text, at: Date.now() }); }

  whisper(m, text) { m.client.sendText(JSON.stringify({ t: 'chat', from: null, text, at: Date.now(), whisper: true })); }

  summary() {
    return { code: this.code, name: this.name, cooks: this.members.size, cap: this.kitchen.cap, size: this.kitchen.size, cuisine: this.kitchen.cuisine, recipe: this.cook ? this.cook.recipe : null };
  }
}

const r2 = (v) => Math.round(v * 100) / 100;
// timers tick constantly: their t/over go out with the clock, not as step changes
function stepKey(st) { return JSON.stringify(st, (k, v) => (k === 't' || k === 'over' ? undefined : v)); }
function vesselKey(v) { return JSON.stringify(v, (k, val) => (k === 'boil' || k === 'hot' ? undefined : val)); }
function metaOf(C) { return { speed: C.speed, started: C.started, finished: C.finished, stars: C.stars, credits: C.credits, bagsOut: C.bagsOut }; }
function freshSent() { return { steps: {}, items: {}, vessels: {}, fx: {}, scraps: {}, bins: {}, carry: {}, meta: '' }; }
function metaKey(C) { return JSON.stringify(metaOf(C)); }

export { fixtureById };
