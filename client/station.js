// The close-up work station: a big cozy scene of the counter / sink / stove /
// oven where a cook does a step with their own hands. Every phase of a step
// is a gesture recognised here – nothing happens by itself:
//   knife down through the food and back up for every slice, scrub strokes
//   under running water, peeler strokes, circles to stir, turning the knob,
//   holding the jug to pour and letting go at the line, painting sauce,
//   tapping toppings on, flicking the pan …
// Progress is shown at once (optimistic) and reported to the kitchen's host,
// which checks it and shares it with everyone.
import { drawIngredient, drawPieces, drawVessel, drawTool, itemSize, liquidColor, vesselGrip, OUTLINE, shade } from './art.js';
import { phaseTarget, displayState } from '../shared/cook.js';
import { HEAT_NAMES, boardUnits } from '../shared/actions.js';
import { INGREDIENTS, VESSELS, TOOLS, twoHanded } from '../shared/ingredients.js';
import { heldBy, thingName, needsOf } from '../shared/cook.js';
import { themeOf, splashTexture, topTexture } from './theme.js';

export const SW = 1000, SH = 620;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// anchors in the scene (logical px)
const MAIN = { x: 500, y: 500 };
const SIDE = { x: 170, y: 540 };
const KNOB = { x: 795, y: 540, r: 52 };
const OVEN_KNOB = { x: 680, y: 145, r: 36 };
const LEVER = { x: 580, y: 200, r: 44 };
const BELL = { x: 795, y: 470, r: 52 };
const DW_BTN = { x: 640, y: 214, r: 40 }; // the dishwasher's start button, on its control strip
// the board's own tools where they lie when they aren't in your hand – the knife and the
// peeler at its front left, the grater standing at its back left; the food's container beside it
const TOOL_AT = { knife: { x: 236, y: 548, r: 70, ang: -1.15, s: 0.9 }, peeler: { x: 335, y: 582, r: 60, ang: -1.45, s: 0.85 }, grater: { x: 248, y: 372, r: 75, ang: 0, s: 0.7 } };
const BOARD_TOOLS = Object.keys(TOOL_AT);
const BOX_AT = { x: 770, y: 500, r: 110 };
const PILE_AT = { x: 675, y: 335, r: 110 };
const STACK_AT = { x: 910, y: 420, r: 95 }; // (the stack of empty food containers on the worktop beside the board)
const PORTION_FROM = { x: 360, y: 470 }, PORTION_TO = { x: 640, y: 470, r: 115 }; // (portioning: the bunch's container, the new one) // (several worked one at a time: the done ones' pile, at the board's back right)
const TIP_AT = { x: MAIN.x + 80, y: MAIN.y - 165 }; // (a food's container held over the pot's rim, to be tipped in)
const SOAP = { x: 770, y: 300, r: 60 }; // the dish soap bottle by the sink (by the board too, washing it)
const ASIDE = { x: 820, y: 520 };
const HANDS = { x: 880, y: 470, r: 105 };   // (pull a thing out to here – anywhere out of the cupboard – and it's in your hand)
const EYE = { x: 500, y: 330, f: 1400 };    // where you look from (for doors swinging towards you)
const KNOB_TURN = 0.03;                     // knob radians per pixel dragged up

export { MAIN, SIDE, KNOB, OVEN_KNOB, LEVER, BELL, HANDS };

// On a tall phone screen the scene zooms in on the middle 820 of its 1000
// (x 90 … 910: every knob, handle and door stays inside) so the food stays big.
function sceneScale(w, h) {
  const portrait = h > w * 0.9;
  return Math.min(w / (portrait ? 820 : SW), h / SH);
}

export class Station {
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks; // {act(msg), sfx(name, vol), pose(p), progress(info)}
    this.on = false;
    this.t = 0;
    this.fx = [];      // transient effects
    this.ptr = { x: SIDE.x + 300, y: 300, down: false, seen: false };
    this.ptr2 = null;     // a second finger on a touch screen: your other hand
    this.headless = false; // first person: the work goes on in the 3D kitchen (nothing drawn here)
    this.touchy = false;  // fingers, not a mouse (work for two hands then takes two fingers)
    this.paint = document.createElement('canvas');
    this.paint.width = 320; this.paint.height = 320;
    this.bindPointer();
  }

  // ctx: {sid, def, st, phases, f (fixture), bk, pal, C, x (expanded), K, me}
  open(ctx) {
    this.on = true;
    this.mode = 'step';
    this.c = ctx;
    this.sid = ctx.sid;
    this.ph = ctx.st.ph;
    this.k = ctx.st.k;
    this.v = 0;
    this.fx = [];
    this.lastSent = 0;
    this.setupPhase();
  }

  close() {
    // a door let go of mid-swing stays where it is
    if (this.mode === 'store' && this.store && this.store.door) this.hooks.store({ t: 'door', fx: this.c.f.id, v: this.store.v, done: true });
    this.on = false; this.c = null; this.g = null; this.mode = null; this.store = null;
  }

  // scene (logical) → page coordinates, for the test robot
  toClient(x, y) {
    const r = this.canvas.getBoundingClientRect();
    const sc = sceneScale(r.width, r.height);
    return { x: r.left + (r.width - SW * sc) / 2 + x * sc, y: r.top + (r.height - SH * sc) / 2 + y * sc };
  }

  // fresh state from the host
  update(C, K) {
    if (!this.on) return;
    this.c.C = C;
    this.c.K = K;
    if (this.mode === 'store') { this.storeSync(); return; }
    const st = C.steps[this.sid];
    if (!st) return;
    this.c.st = st;
    if (st.s === 'done') { this.ph = this.c.phases.length; return; }
    if (st.ph > this.ph) { this.ph = st.ph; this.k = st.k; this.v = 0; this.setupPhase(); }
    else if (st.ph === this.ph && st.k > this.k) this.k = st.k;
  }

  get phase() { return this.c && this.c.phases[this.ph]; }
  get done() { return this.mode === 'store' ? false : !this.c || this.ph >= this.c.phases.length; }

  // ------------------------------------------------------------------ phase setup

  setupPhase() {
    const ph = this.phase;
    this.g = null;
    if (!ph) return;
    const s = this.c.def;
    const g = { kind: ph.g, ph, stage: 0, acc: 0, armed: false, legs: 0, dir: 0, last: null, drag: null, hold: 0 };
    // where the subject (the thing worked on) and the source (the thing brought in) are
    const vId = s.vessel || s.into || null;
    g.subject = null; g.source = null; g.target = null;
    const isItemStep = ['wash', 'rinse', 'peel', 'skin', 'shell', 'slice', 'dice', 'mince', 'chop', 'slit', 'grate', 'tear', 'crush', 'core', 'separate', 'knead', 'roll', 'stretch', 'shape', 'spread', 'brush', 'top', 'wrap'].includes(s.do);
    if (isItemStep && s.item) g.subject = { type: 'item', id: s.item };
    else if (vId) g.subject = { type: 'vessel', id: vId };
    else if (s.target) g.subject = { type: 'item', id: s.target };
    // washing up: the pot / pan / bowl in the sink
    if (s.do === 'scrub' && this.c.st && this.c.st.vid) g.subject = { type: 'vessel', id: this.c.st.vid };
    switch (ph.g) {
      case 'drag': {
        const obj = ph.obj;
        if (obj.startsWith('item:')) { g.source = { type: 'item', id: obj.slice(5) }; g.subject = vId ? { type: 'vessel', id: vId } : null; }
        else if (obj === 'vessel') { g.source = { type: 'vessel', id: s.vessel || s.into || vId }; g.subject = null; }
        else if (obj === 'lid' || obj === 'towelLid') { g.source = { type: 'lid', towel: obj === 'towelLid' }; g.subject = { type: 'vessel', id: vId }; }
        else if (obj === 'lidOff') { g.source = { type: 'lid', on: true }; g.subject = { type: 'vessel', id: vId }; }
        else if (obj === 'scraps' || obj === 'bag' || obj === 'newBag') { g.source = { type: obj }; g.subject = null; }
        else if (obj === 'thing') { g.source = { type: s.thing[0] === 'v' ? 'vessel' : 'item', id: s.thing.slice(2) }; g.subject = null; }
        else if (obj === 'pieces') { g.source = { type: 'item', id: s.item, pieces: true }; g.subject = null; } // (off the board into its container)
        else if (obj === 'fromBox') { g.source = { type: 'item', id: s.item, fromBox: true }; g.subject = null; } // (out of its container onto the board)
        else if (obj === 'unit') { g.source = { type: 'item', id: s.item, unit: true }; g.subject = null; } // (the one just done, to the pile at the side)
        else if (obj === 'newBox') { g.source = { type: 'newBox' }; g.subject = null; } // (an empty container off the stack)
        else if (obj === 'oneOver') { g.source = { type: 'item', id: s.item, oneOver: true }; g.subject = null; } // (portioning: one from the bunch to the new container)
        else if (obj.startsWith('part:')) { g.source = { type: 'part', name: obj.slice(5) }; g.subject = null; } // (the board's knife … off it / back on it)
        const toMain = ph.to !== 'aside';
        const start = toMain ? { ...SIDE } : { ...MAIN };
        if (obj === 'lidOff') { start.x = MAIN.x; start.y = MAIN.y - 150; }
        // (first person: the lid's real knob on its pot – or where it lies beside it)
        if (obj === 'lidOff' || obj === 'lid' || obj === 'towelLid') { const lk = this.targetHook && this.targetHook(obj === 'lidOff' ? 'lidKnob' : 'lidAt', vId); if (lk) { start.x = lk.x; start.y = lk.y; } }
        if (obj === 'scraps' && ph.to === 'hands') { start.x = MAIN.x; start.y = MAIN.y - 40; }
        if (obj === 'scraps' && ph.to === 'bin') { start.x = 500; start.y = 540; }
        if (obj === 'bag') { start.x = 500; start.y = 280; }
        if (obj === 'thing') { const at = this.storeLayout().get(s.thing); if (at) { start.x = at.x; start.y = at.y; } }
        if (obj === 'pieces' || obj === 'unit') { start.x = MAIN.x; start.y = MAIN.y - 30; }
        if (obj === 'pieces' && ph.pile) { const pa = this.targetFor('pile'); start.x = pa.x; start.y = pa.y; }
        if (obj === 'newBox') { const sa = this.targetFor('stack'); start.x = sa.x; start.y = sa.y; }
        if (obj === 'oneOver') { const pf = this.targetFor('portionFrom'); start.x = pf.x; start.y = pf.y; }
        // (into the oven: from where it was set down on its worktop while the gloves went on)
        if (obj === 'vessel' && ph.to === 'ovenRack') { const r = this.targetHook && this.targetHook('ovenRest'); if (r) { start.x = r.x; start.y = r.y; } }
        // (first person: where it really lies now)
        if (obj.startsWith('part:')) { const a = this.targetHook && this.targetHook(`at:${obj.slice(5)}`); start.x = a ? a.x : 330; start.y = a ? a.y : 560; }
        if (obj === 'fromBox') { const bx = this.targetFor('box'); start.x = bx.x; start.y = bx.y - 10; } // (first person: the real container)
        g.from = start; g.pos = { ...start };
        g.target = this.targetFor(ph.to);
        // (cut from a bunch with more in it than the recipe takes: into an empty container from the stack)
        const bunch = obj === 'pieces' && this.c.C.items[s.item] && this.c.C.items[s.item].extra > 0;
        if (bunch) g.target = this.targetFor('stack');
        // a pan, a saucepan, a cezve, a kettle: you take it by the handle
        const sv = g.source && g.source.type === 'vessel' && this.c.C.vessels[g.source.id];
        const gr = sv && ph.tool !== 'pizzaPeel' && vesselGrip(sv.kind);
        if (gr) { const sc = this.dragScale(sv.kind); g.grip = { x: gr.x * sc, y: gr.y * sc }; }
        // (a part of the board that isn't there – in someone's hand – or already where it goes: nothing to move)
        if (obj.startsWith('part:') && this.partDone(ph)) setTimeout(() => { if (this.g === g && !this.done) this.count(); }, 200);
        // it's already standing there (put on the burner earlier): nothing to carry over
        if (obj === 'vessel' && ph.to !== 'aside' && sv && sv.at && sv.at.fx === this.c.f.id && sv.held == null) setTimeout(() => { if (this.g === g && !this.done) this.count(); }, 200);
        break;
      }
      case 'door': {
        g.geo = this.doorGeo(ph.hot);
        const st = this.c.C.steps[this.sid];
        const fxs = this.c.C.fx[this.c.f.id] || {};
        g.v = st && st.ph === this.ph && st.v != null ? st.v : (ph.hot === 'board' ? fxs.boardUp : fxs.door) ? 1 : 0;
        // already the way it should be (someone left it open): nothing to swing
        if (ph.to ? g.v >= 0.8 : g.v <= 0.2) setTimeout(() => { if (this.g === g && !this.done) this.value(ph.to, true); }, 200);
        break;
      }
      case 'pour': {
        g.source = s.from ? { type: 'vessel', id: s.from } : s.item ? { type: 'item', id: s.item } : null;
        if (ph.drain && ph.box) { g.source = null; g.subject = { type: 'item', id: s.item }; } // (washing water out of the food's container)
        else if (ph.drain) { g.source = { type: 'vessel', id: s.vessel }; g.subject = { type: 'colander' }; }
        else g.subject = { type: 'vessel', id: s.into };
        if (ph.tip) g.source = { type: 'item', id: ph.tip }; // (tipped out of its container)
        g.v = 0;
        break;
      }
      case 'fill': g.subject = { type: 'vessel', id: s.vessel }; g.v = 0; break;
      case 'knob': g.level = this.currentLevel(); g.ang = levelAngle(g.level); break;
      case 'crack': g.subject = { type: 'vessel', id: s.into }; g.egg = { ...SIDE, y: SIDE.y - 40 }; break;
      case 'wrap': g.subject = { type: 'item', id: s.item }; g.source = s.from ? { type: 'vessel', id: s.from } : null; break;
      case 'scoop': g.source = { type: 'vessel', id: s.from }; g.subject = s.into ? { type: 'vessel', id: s.into } : null; g.n = phaseTarget(ph); break;
      case 'dip': g.subject = { type: 'vessel', id: s.into }; g.source = { type: 'item', id: s.item }; g.pos = { ...SIDE }; break;
      case 'place': if (s.do === 'garnish') g.subject = { type: 'vessel', id: s.into }; break;
      case 'strokes':
        if (s.do === 'season' || s.do === 'squeeze') { g.subject = s.into ? { type: 'vessel', id: s.into } : { type: 'item', id: s.target }; }
        if (s.do === 'mash') g.subject = { type: 'vessel', id: s.vessel };
        break;
      default: break;
    }
    if (ph.g === 'paint') this.resetPaint();
    if (ph.g === 'circle' && ph.turn) g.rot = 0;
    this.g = g;
    this.idle = 0;
    this.report();
  }

  // the stove's knob sits bottom right; the oven's on its control panel
  knobPos() { return this.sceneKind() === 'oven' ? OVEN_KNOB : KNOB; }

  currentLevel() {
    const s = this.c.def;
    if (s.do === 'knob') return this.litLevel();
    const v = this.c.C.vessels[s.vessel || s.into];
    return v ? v.heat || 0 : 0;
  }
  // an empty burner left burning here
  litLevel() {
    const lit = (this.c.C.fx[this.c.f.id] || {}).lit || {};
    const k = Object.keys(lit)[0];
    return k != null ? lit[k] : 0;
  }

  targetFor(to) {
    // (first person: where it really is in the kitchen – the basin under the tap …)
    if (this.targetHook) { const t = this.targetHook(to); if (t) return t; }
    switch (to) {
      case 'underTap': return { x: 445, y: 570, r: 120 };
      case 'burner': return { x: MAIN.x, y: MAIN.y, r: 140 };
      case 'colander': return { x: 500, y: 540, r: 130 };
      case 'ovenRack': return { x: 500, y: 410, r: 150 };
      case 'ovenMouth': return { x: 520, y: 420, r: 110 };
      case 'tandoorWall': return { x: 500, y: 330, r: 110 };
      case 'shelf': return { x: 500, y: 330, r: 160 };
      case 'box': return { ...BOX_AT }; // (the food's container, beside the board)
      case 'overVessel': return { ...TIP_AT, r: 130 }; // (held over the pot's rim, to tip it in)
      case 'board': return { x: MAIN.x, y: MAIN.y - 40, r: 140 };
      case 'pile': return (this.targetHook && this.targetHook('pile')) || { ...PILE_AT };
      case 'stack': return (this.targetHook && this.targetHook('stack')) || { ...STACK_AT };
      case 'portion': return (this.targetHook && this.targetHook('portion')) || { ...PORTION_TO };
      case 'portionFrom': return (this.targetHook && this.targetHook('portionFrom')) || { ...PORTION_FROM, r: 100 };
      case 'aside': return { x: ASIDE.x, y: ASIDE.y, r: 150 };
      case 'hands': return { x: 500, y: 600, r: 120 };
      case 'bin': return { x: 500, y: 260, r: 130 };
      case 'door': return { x: 840, y: 330, r: 150 };
      case 'vessel': default: return { x: MAIN.x, y: MAIN.y - 90, r: 130 };
    }
  }

  // ------------------------------------------------------------------ reporting

  report() {
    if (!this.hooks.progress || !this.c) return;
    const ph = this.phase;
    const names = this.c.x.names || {};
    const into = names[this.c.def.into || this.c.def.vessel] || 'pot';
    this.hooks.progress({
      title: this.c.def.name, hint: this.tip && performance.now() < this.tip.until ? this.tip.msg : ph ? ph.hint.replace('{into}', into).replace('{from}', names[this.c.def.from] || 'pot') : 'Done!', ph: this.ph, phases: this.c.phases.length,
      k: this.k, n: ph ? phaseTarget(ph) : 0, value: ph && ['pour', 'fill', 'paint'].includes(ph.g) ? this.g && this.g.v : null,
      band: ph && ph.band, cover: ph && ph.cover, done: this.done,
    });
  }

  count(extra = {}) {
    const ph = this.phase;
    if (!ph) return;
    this.k++;
    this.hooks.act({ t: 'act', sid: this.sid, ph: this.ph, k: this.k, ...extra });
    if (this.k >= phaseTarget(ph)) this.advance();
    else this.report();
  }

  value(v, done) {
    const ph = this.phase;
    if (!ph) return;
    const now = performance.now();
    if (done) {
      this.hooks.act({ t: 'act', sid: this.sid, ph: this.ph, v, done: true });
      const ok = ph.g === 'knob' ? Math.round(v * 3) === ph.to : ph.g === 'paint' ? v >= ph.cover : ph.g === 'door' ? (ph.to ? v >= 0.8 : v <= 0.2) : v >= ph.band[0];
      if (ok) this.advance();
      else this.report();
    } else if (now - this.lastSent > 120) {
      this.lastSent = now;
      this.hooks.act({ t: 'act', sid: this.sid, ph: this.ph, v, live: true });
    }
  }

  advance() {
    // (finished mid-motion – the last cut, stroke or turn – with the button still held: the next
    // gesture waits for a fresh press, so the rest of that motion isn't taken for it)
    if (this.ptr.down && this.g && ['chop', 'strokes', 'circle', 'peel', 'flick'].includes(this.g.kind)) this.freshPress = true;
    this.ph++;
    this.k = 0;
    this.v = 0;
    this.hooks.sfx('pop');
    this.burst(MAIN.x, MAIN.y - 160, '#ffd34d', 10);
    this.setupPhase();
    if (this.done) { this.hooks.sfx('ding'); this.report(); }
  }

  // ------------------------------------------------------------------ input

  bindPointer() {
    const el = this.canvas;
    const toLocal = (e) => {
      const r = el.getBoundingClientRect();
      const sc = sceneScale(r.width, r.height);
      const ox = (r.width - SW * sc) / 2, oy = (r.height - SH * sc) / 2;
      return { x: (e.clientX - r.left - ox) / sc, y: (e.clientY - r.top - oy) / sc };
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.on) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.pointer('down', toLocal(e), e.pointerId, e.pointerType);
    });
    el.addEventListener('pointermove', (e) => { if (this.on) this.pointer('move', toLocal(e), e.pointerId, e.pointerType); });
    const up = (e) => { if (this.on) this.pointer('up', toLocal(e), e.pointerId, e.pointerType); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.ptr.seen = false; });
  }

  // A pointer (the mouse, a finger) at scene point p – from this canvas, or,
  // in first person, from the 3D kitchen (the hand on the real counter).
  // Each finger is a hand: the first does the work, a second one is your
  // other hand (holding the food steady, the other half of an egg, the door).
  pointer(type, p, id, pointerType) {
    if (!this.on) return;
    if (type === 'down') {
      if (pointerType === 'touch') this.touchy = true;
      this.idle = 0;
      if (this.ptr.down && id !== this.ptr.id) {
        if (this.ptr2) return; // (two hands is all you have)
        this.ptr2 = { ...p, id, down: true };
        this.onDown2(p);
        return;
      }
      Object.assign(this.ptr, p, { id, down: true, seen: true, vx: 0, vy: 0, t: performance.now() });
      this.freshPress = false;
      this.onDown(p);
    } else if (type === 'move') {
      if (this.ptr2 && id === this.ptr2.id) { Object.assign(this.ptr2, p); this.idle = 0; this.onMove2(p); return; }
      if (this.ptr.down && this.ptr.id !== undefined && id !== this.ptr.id) return;
      const now = performance.now();
      const dt = Math.max(1, now - (this.ptr.t || now));
      this.ptr.vx = (p.x - this.ptr.x) / dt * 1000;
      this.ptr.vy = (p.y - this.ptr.y) / dt * 1000;
      const prev = { x: this.ptr.x, y: this.ptr.y };
      Object.assign(this.ptr, p, { seen: true, t: now });
      if (this.ptr.down && !this.freshPress) { this.idle = 0; this.onMove(p, prev); }
    } else {
      if (this.ptr2 && id === this.ptr2.id) { this.ptr2 = null; this.onUp2(p, id); return; }
      if (!this.ptr.down || (this.ptr.id !== undefined && id !== this.ptr.id)) return;
      this.ptr.down = false;
      if (this.freshPress) { this.freshPress = false; return; } // (that press belonged to the last gesture)
      this.onUp(p);
    }
  }

  // (tests) where a point of the scene is on the screen
  screenPoint(p) {
    const r = this.canvas.getBoundingClientRect();
    const sc = sceneScale(r.width, r.height);
    return { x: r.left + (r.width - SW * sc) / 2 + p.x * sc, y: r.top + (r.height - SH * sc) / 2 + p.y * sc };
  }

  // the second finger: your other hand
  onDown2(p) {
    if (this.mode === 'store') { this.storeDown(p, this.ptr2.id); return; }
    const g = this.g;
    if (!g || this.done) return;
    // the finger on the food is the hand holding it; the other one works
    if (this.steadies() && this.onFood(this.ptr) && !this.onFood(p)) {
      const a = { x: this.ptr.x, y: this.ptr.y, id: this.ptr.id };
      Object.assign(this.ptr, { x: p.x, y: p.y, id: this.ptr2.id, vx: 0, vy: 0, t: performance.now() });
      Object.assign(this.ptr2, a);
      this.onDown(this.ptr);
      return;
    }
    // an egg knocked open: a thumb in each side of the crack
    if (g.kind === 'crack' && g.stage === 1) { g.two = { d0: dist(this.ptr, p) }; g.start = null; }
  }
  onMove2(p) {
    if (this.mode === 'store') { this.storeMove(p, this.ptr2.id); return; }
    const g = this.g;
    if (g && !this.done && g.kind === 'crack' && g.two) this.crackSpread();
  }
  onUp2(p, id) {
    if (this.mode === 'store') { this.storeUp(p, id); return; }
    const g = this.g;
    if (g && g.kind === 'crack' && g.two) { g.two = null; g.spread = 0; }
  }

  // pulling the shell apart with two thumbs
  crackSpread() {
    const g = this.g;
    if (!this.ptr2) return;
    g.spread = Math.max(0, dist(this.ptr, this.ptr2) - g.two.d0);
    if (g.spread > 70) this.cracked();
  }
  cracked() {
    const g = this.g;
    g.stage = 0; g.start = null; g.two = null; g.spread = 0; g.egg = { ...SIDE, y: SIDE.y - 40 };
    this.hooks.sfx('plop'); this.splash(MAIN.x, MAIN.y - 80, '#ffd34d');
    this.count();
  }

  // Board work takes both hands: one holds the food steady while the other
  // cuts, peels or grates. With a mouse that's taken care of; on a touch
  // screen the other hand is a second finger on the food.
  steadies() {
    const g = this.g;
    if (!g || !g.ph || !this.subjectItem()) return false;
    return ['chop', 'peel'].includes(g.kind) || (g.kind === 'strokes' && ['knife', 'grater'].includes(g.ph.tool));
  }
  onFood(p) {
    const b = this.subjectBox();
    return !!p && p.x > b.x0 - 40 && p.x < b.x1 + 40 && p.y > b.y0 - 50 && p.y < b.y1 + 30;
  }
  // where the steadying hand is (null: nothing holds the food)
  steadyAt() {
    const b = this.subjectBox(), ph = this.g.ph;
    if (!this.touchy) return { x: ph.tool === 'grater' ? b.cx - 30 : b.x0 + Math.min(70, b.w * 0.18), y: b.cy + 6 };
    const q = this.ptr2;
    if (!q || !this.onFood(q)) return null;
    return { x: clamp(q.x, b.x0 + 20, b.x1 - 20), y: clamp(q.y, b.y0 + 10, b.y1 - 6) };
  }
  // may this stroke of the knife (peeler, grater) count? Not with the food loose.
  held() {
    if (!this.steadies() || this.steadyAt()) return true;
    this.twoHint('Hold it steady with your other hand – a second finger on the food');
    return false;
  }
  twoHint(msg) {
    this.tip = { msg, until: performance.now() + 2400 };
    this.report();
    clearTimeout(this.tipT);
    this.tipT = setTimeout(() => { if (this.on && this.mode !== 'store') this.report(); }, 2500);
  }

  onDown(p) {
    if (this.mode === 'store') { this.storeDown(p, this.ptr.id); return; }
    const g = this.g;
    if (!g || this.done) return;
    switch (g.kind) {
      case 'tap': {
        const h = this.hotspot();
        if (h && Math.hypot(p.x - h.x, p.y - h.y) < h.r + 24) {
          this.hooks.sfx(g.ph.hot === 'bell' ? 'bell' : g.ph.hot === 'faucet' ? 'tap' : g.ph.hot === 'pedal' ? 'pedal' : 'door');
          if (g.ph.hot === 'bell') this.burst(BELL.x, BELL.y - 60, '#ffd34d', 24);
          this.count();
        }
        break;
      }
      case 'drag': case 'dip': {
        const at = this.grabPoint();
        // (first person: anywhere on it – my hand takes it by its handle, wherever that is in the kitchen)
        if (dist(p, at) < (g.grip ? 75 : 130) || (this.headless && g.source && g.source.type === 'vessel' && dist(p, g.pos) < 130)) { g.drag = { dx: g.pos.x - p.x, dy: g.pos.y - p.y }; this.hooks.sfx('grab'); }
        break;
      }
      case 'door':
        if (dist(p, this.doorGrab(g.geo, g.v)) < 90) { g.drag = true; this.hooks.sfx('door'); }
        break;
      case 'chop': g.last = p; this.chopMove(p); break; // pressing above the food arms the knife
      case 'strokes': g.last = p; g.dir = 0; g.run = 0; break;
      case 'peel': g.start = p; break;
      case 'circle': g.lastAng = this.angleAt(p); break;
      case 'knob': { const K = this.knobPos(); if (Math.hypot(p.x - K.x, p.y - K.y) < K.r + 40) { g.turning = true; g.y0 = p.y; g.ang0 = g.ang; } break; }
      case 'pour': case 'fill': g.pouring = true; this.hooks.sfx(g.kind === 'fill' ? 'tap' : 'pour'); break;
      case 'paint': this.paintAt(p); break;
      case 'place': this.placeAt(p); break;
      case 'flick': g.start = { ...p, t: performance.now() }; break;
      case 'crack':
        if (g.stage === 0 && dist(p, g.egg) < 90) g.drag = { dx: g.egg.x - p.x, dy: g.egg.y - p.y, vy: 0 };
        else if (g.stage === 1) g.start = p;
        break;
      case 'wrap': g.start = p; if (g.stage === 0 && dist(p, SIDE) < 140) g.drag = true; break;
      case 'scoop': if (dist(p, this.scoopSource()) < 130) { g.drag = true; g.pos = { ...p }; this.hooks.sfx('scoop'); } break;
      default: break;
    }
  }

  onMove(p, prev) {
    if (this.mode === 'store') { this.storeMove(p, this.ptr.id); return; }
    const g = this.g;
    if (!g || this.done) return;
    switch (g.kind) {
      case 'door':
        if (g.drag) { g.v = this.doorOpenAt(g.geo, p); this.value(g.v, false); }
        break;
      case 'drag':
        if (g.drag) { g.pos = { x: p.x + g.drag.dx, y: p.y + g.drag.dy }; }
        break;
      case 'dip':
        if (g.drag) {
          g.pos = { x: p.x + g.drag.dx, y: p.y + g.drag.dy };
          const inPot = dist(g.pos, { x: MAIN.x, y: MAIN.y - 80 }) < 140;
          if (inPot && !g.inside) { g.inside = true; g.hold = 0; this.hooks.sfx('splash'); this.splash(MAIN.x, MAIN.y - 90); }
          if (!inPot && g.inside) {
            g.inside = false;
            if (g.hold >= (g.ph.hold || 1.6)) { this.count(); g.pos = { ...SIDE }; g.drag = null; this.hooks.sfx('pop'); }
          }
        }
        break;
      case 'chop': this.chopMove(p); break;
      case 'strokes': this.strokeMove(p); break;
      case 'circle': this.circleMove(p); break;
      case 'knob':
        if (g.turning) {
          // drag up to turn it up, down to turn it down: the wrist does the turning
          g.ang = clamp(g.ang0 + (g.y0 - p.y) * KNOB_TURN, -2.4, 2.4);
          const lvl = Math.round((g.ang + 2.4) / 4.8 * 3);
          if (lvl !== g.level) { g.level = lvl; this.hooks.sfx('click'); }
        }
        break;
      case 'paint': this.paintAt(p, prev); break;
      case 'crack':
        if (g.drag && g.stage === 0) {
          const ny = p.y + g.drag.dy;
          g.drag.vy = (ny - g.egg.y);
          g.egg = { x: p.x + g.drag.dx, y: ny };
          const rim = this.rimPoint();
          if (g.egg.y > rim.y - 30 && Math.abs(g.egg.x - rim.x) < 170 && this.ptr.vy > 500) {
            g.stage = 1; g.drag = null; g.egg = { x: rim.x, y: rim.y - 34 };
            this.hooks.sfx('crack'); this.burst(rim.x, rim.y - 30, '#fff8e8', 8);
          }
        } else if (g.stage === 1 && g.two) this.crackSpread();
        else if (g.stage === 1 && g.start) {
          if (this.touchy) { if (Math.abs(p.x - g.start.x) > 50) this.twoHint('Both thumbs on the egg – and pull them apart'); break; }
          g.spread = Math.abs(p.x - g.start.x);
          if (g.spread > 70) this.cracked();
        }
        break;
      case 'wrap': this.wrapMove(p); break;
      case 'scoop': if (g.drag) g.pos = { ...p }; break;
      default: break;
    }
  }

  onUp(p) {
    if (this.mode === 'store') { this.storeUp(p, this.ptr.id); return; }
    const g = this.g;
    if (!g || this.done) return;
    switch (g.kind) {
      case 'door':
        if (g.drag) {
          g.drag = false;
          if (g.ph.to ? g.v >= 0.8 : g.v <= 0.2) { g.v = g.ph.to; this.hooks.sfx(g.ph.to ? 'door' : 'clunk'); this.value(g.v, true); }
          else this.value(g.v, false);
        }
        break;
      case 'drag':
        if (g.drag) {
          g.drag = null;
          const tg = g.target;
          if (tg && dist(g.pos, tg) < tg.r) {
            g.pos = { x: tg.x, y: tg.y };
            this.hooks.sfx(g.ph.to === 'vessel' ? 'plop' : 'clunk');
            if (g.ph.to === 'vessel') this.splash(tg.x, tg.y);
            this.count();
            if (this.g === g && !this.done) g.pos = { ...g.from }; // (several, one at a time: the next one's still where they came from)
          } else g.pos = { ...g.from };
        }
        break;
      case 'dip': if (g.drag && !g.inside) { g.drag = null; g.pos = { ...SIDE }; } else if (g.drag) g.drag = null; break;
      case 'peel': {
        if (!g.start) break;
        const box = this.subjectBox();
        const hand = g.ph.tool === 'hand';
        const ok = hand
          ? dist(p, g.start) > 90 && dist(g.start, { x: box.cx, y: box.cy }) < Math.max(box.w, box.h) * 0.7
          : g.start.y < box.cy && p.y - g.start.y > box.h * 0.55 && Math.abs(g.start.x - box.cx) < box.w * 0.7;
        if (ok && this.held()) {
          this.hooks.sfx(hand ? 'peel' : 'peeler');
          this.fx.push({ kind: 'strip', x: p.x, y: p.y, vx: (p.x - g.start.x) * 0.6 + 60, vy: -120, life: 0, max: 1.1, col: this.subjectColor() });
          this.count();
        }
        g.start = null;
        break;
      }
      case 'knob':
        if (g.turning) {
          g.turning = false;
          const v = g.level / 3;
          this.hooks.act({ t: 'act', sid: this.sid, ph: this.ph, v, live: true });
          if (g.level === g.ph.to) { this.hooks.sfx('whoosh'); this.value(v, true); }
        }
        break;
      case 'pour': case 'fill':
        if (g.pouring) {
          g.pouring = false;
          this.hooks.sfx('stop');
          const band = g.ph.band;
          if (g.v >= band[0]) this.value(g.v, true);
          else this.value(g.v, false);
        }
        break;
      case 'flick': {
        if (!g.start) break;
        const dy = g.start.y - p.y, dt = performance.now() - g.start.t;
        if (dy > 70 && dt < 450) {
          g.toss = 1; this.hooks.sfx('whoosh');
          this.count();
        }
        g.start = null;
        break;
      }
      case 'crack': if (g.drag) { g.drag = null; g.egg = { ...SIDE, y: SIDE.y - 40 }; } if (g.two) { g.two = null; g.spread = 0; } break;
      case 'wrap': this.wrapUp(p); break;
      case 'scoop': {
        if (!g.drag) break;
        g.drag = false;
        const tgs = this.scoopTargets();
        const i = tgs.findIndex((t, idx) => idx >= this.k && dist(p, t) < 110);
        if (i >= 0) { this.hooks.sfx('plop'); this.splash(tgs[i].x, tgs[i].y - 20, this.scoopColor()); this.count(); }
        g.pos = null;
        break;
      }
      case 'paint': if (g.v >= g.ph.cover) this.value(g.v, true); break;
      default: break;
    }
  }

  // knife: arm above the food, come down to the board = one cut, go back up to re-arm
  chopMove(p) {
    const g = this.g, ph = g.ph;
    const box = this.subjectBox();
    const top = box.y0 - (ph.mode === 'mince' ? 10 : 18);
    const board = box.y1 - 8;
    const over = p.x > box.x0 - 40 && p.x < box.x1 + 60;
    if (p.y < top) g.armed = true;
    if (g.armed && p.y > board && over) {
      g.armed = false;
      if (!this.held()) return;
      this.hooks.sfx(ph.flat ? 'thud' : 'chop');
      this.fx.push({ kind: 'thunk', x: p.x, y: board, life: 0, max: 0.25 });
      if (Math.random() < 0.7) this.burst(p.x, board - 10, this.subjectFlesh(), 4);
      this.count();
    }
  }

  // back-and-forth strokes: a leg counts once it has travelled far enough
  strokeMove(p) {
    const g = this.g, ph = g.ph;
    if (!g.last) { g.last = p; g.dir = 0; g.run = 0; return; } // a stroke carried over from the last phase
    const axis = ph.axis === 'h' ? 'x' : 'y';
    const d = p[axis] - g.last[axis];
    const minLeg = ph.tool === 'shaker' ? 40 : ph.once ? 160 : 70;
    if (Math.abs(d) < 2) return;
    const dir = Math.sign(d);
    if (dir !== g.dir) { g.dir = dir; g.run = 0; g.counted = false; }
    g.run += Math.abs(d);
    g.last = p;
    if (!g.counted && g.run >= minLeg) {
      g.counted = true;
      if (!this.held()) return;
      const tool = ph.tool;
      this.hooks.sfx(tool === 'shaker' ? 'shake' : tool === 'grater' ? 'grate' : tool === 'rollingPin' ? 'roll' : tool === 'knife' ? 'slit' : tool === 'masher' ? 'thud' : ph.axis === 'h' && this.c.def.do === 'wash' ? 'scrub' : 'squish');
      if (tool === 'shaker') this.powder(p.x, p.y + 30, this.c.def.item);
      if (this.c.def.do === 'wash') this.bubbles(p.x, p.y);
      if (tool === 'grater') this.fx.push({ kind: 'shreds', x: MAIN.x + 140, y: MAIN.y - 10, life: 0, max: 0.8, col: this.subjectFlesh() });
      this.count();
    }
  }

  angleAt(p) {
    const c = this.circleCenter();
    return Math.atan2(p.y - c.y, p.x - c.x);
  }

  circleCenter() {
    const g = this.g;
    if (g && g.subject && g.subject.type === 'vessel' && this.geo) return { x: this.geo.mouthX, y: this.geo.mouthY };
    const b = this.subjectBox();
    return { x: b.cx, y: b.cy };
  }

  circleMove(p) {
    const g = this.g, ph = g.ph;
    const c = this.circleCenter();
    if (Math.hypot(p.x - c.x, p.y - c.y) < 18) return;
    const a = this.angleAt(p);
    if (g.lastAng === undefined) { g.lastAng = a; return; }
    const da = normAng(a - g.lastAng);
    g.lastAng = a;
    g.acc += da;
    if (ph.turn) g.rot = g.acc;
    const unit = ph.n < 1 ? ph.n * TAU : TAU;
    if (Math.abs(g.acc) >= unit * (this.k + 1)) {
      this.hooks.sfx(ph.tool === 'whisk' ? 'whisk' : ph.tool === 'blenderStick' ? 'blend' : 'stir');
      this.count();
    }
  }

  wrapMove(p) {
    const g = this.g;
    if (g.stage === 0 && g.drag) g.pos = { ...p };
    if (g.stage === 1 && g.start && Math.abs(p.x - g.start.x) > 80) { g.stage = 2; g.start = null; this.hooks.sfx('squish'); }
    if (g.stage === 2 && g.start && g.start.y - p.y > 90) {
      g.stage = 0; g.start = null; this.hooks.sfx('pop');
      this.count();
    }
  }

  wrapUp(p) {
    const g = this.g;
    if (g.stage === 0 && g.drag) {
      g.drag = false; g.pos = null;
      if (Math.hypot(p.x - MAIN.x, p.y - (MAIN.y - 40)) < 150) { g.stage = 1; this.hooks.sfx('plop'); }
    }
  }

  // ------------------------------------------------------------------ paint & place

  resetPaint() {
    const p = this.paint.getContext('2d');
    p.clearRect(0, 0, 320, 320);
    this.cells = new Uint8Array(24 * 24);
    this.cellsIn = 0;
    // which cells are on the surface (a disc for dough, a rect for toast)
    const round = this.surfaceRound();
    for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) {
      const u = (i + 0.5) / 24 * 2 - 1, v = (j + 0.5) / 24 * 2 - 1;
      if (round ? u * u + v * v <= 0.86 : Math.abs(u) < 0.92 && Math.abs(v) < 0.8) this.cellsIn++;
    }
  }

  surfaceRound() { const it = this.subjectItem(); return !it || it.kind === 'dough'; }

  surfaceRect() {
    const b = this.subjectBox();
    const r = Math.max(b.w, b.h * 1.3) / 2;
    return { x: b.cx - r, y: b.cy - r * 0.62, w: 2 * r, h: 2 * r * 0.62 };
  }

  paintAt(p, prev) {
    const g = this.g;
    const R = this.surfaceRect();
    const round = this.surfaceRound();
    const toUV = (q) => ({ u: (q.x - R.x) / R.w * 2 - 1, v: (q.y - R.y) / R.h * 2 - 1 });
    const pc = this.paint.getContext('2d');
    const from = prev || p;
    const steps = Math.max(1, Math.ceil(dist(from, p) / 8));
    for (let i = 1; i <= steps; i++) {
      const q = { x: from.x + (p.x - from.x) * i / steps, y: from.y + (p.y - from.y) * i / steps };
      const { u, v } = toUV(q);
      pc.fillStyle = g.ph.color || '#c8321e';
      pc.globalAlpha = g.ph.alpha || 0.9;
      pc.beginPath(); pc.arc((u + 1) / 2 * 320, (v + 1) / 2 * 320, 34, 0, TAU); pc.fill();
      for (let j = 0; j < 24; j++) for (let k = 0; k < 24; k++) {
        const cu = (k + 0.5) / 24 * 2 - 1, cv = (j + 0.5) / 24 * 2 - 1;
        const inside = round ? cu * cu + cv * cv <= 0.86 : Math.abs(cu) < 0.92 && Math.abs(cv) < 0.8;
        if (inside && (cu - u) ** 2 + (cv - v) ** 2 < 0.045) this.cells[j * 24 + k] = 1;
      }
    }
    pc.globalAlpha = 1;
    let n = 0;
    for (const c of this.cells) n += c;
    g.v = Math.min(1, n / this.cellsIn);
    if (Math.random() < 0.25) this.hooks.sfx('smear', 0.5);
    this.value(g.v, false);
    this.report();
    if (g.v >= g.ph.cover && !g.doneSent) { g.doneSent = true; this.value(g.v, true); }
  }

  placeAt(p) {
    const g = this.g;
    const R = this.placeArea();
    const u = (p.x - R.cx) / R.rx, v = (p.y - R.cy) / R.ry;
    if (u * u + v * v > 1.05) return;
    this.hooks.sfx('plop');
    this.count({ x: clamp(u, -1, 1), y: clamp(v, -1, 1) });
    this.burst(p.x, p.y, '#ffffff', 5);
  }

  placeArea() {
    const g = this.g;
    if (g.subject && g.subject.type === 'vessel' && this.geo) return { cx: this.geo.mouthX, cy: this.geo.mouthY, rx: this.geo.mouthRx * 0.85, ry: this.geo.mouthRy * 0.85 };
    const b = this.subjectBox();
    return { cx: b.cx, cy: b.cy, rx: b.w / 2 * 0.85, ry: b.h / 2 * 0.85 };
  }

  // ------------------------------------------------------------------ geometry of the subject

  subjectItem() {
    const g = this.g;
    if (!g || !g.subject || g.subject.type !== 'item' || !this.D) return null;
    const it = this.D.items[g.subject.id];
    return it ? { ...it, id: g.subject.id } : null;
  }

  itemScale(kind) {
    const sz = itemSize(kind) || { w: 110, h: 100 };
    return clamp(Math.min(380 / sz.w, 300 / sz.h), 0.6, 2.1);
  }

  subjectBox() {
    const it = this.subjectItem();
    const kind = it ? it.kind : 'tomato';
    const s = this.itemScale(kind);
    const sz = itemSize(kind) || { w: 110, h: 100 };
    let w = sz.w * s, h = sz.h * s;
    if (it && it.kind === 'dough' && it.shape === 'flat') { w = 320 * (0.4 + 0.6 * (it.size ?? 1)); h = w * 0.62; }
    const x0 = MAIN.x - w / 2, y1 = MAIN.y;
    return { x0, x1: x0 + w, y0: y1 - h, y1, w, h, cx: MAIN.x, cy: y1 - h / 2 };
  }

  subjectColor() { const it = this.subjectItem(); return it && INGREDIENTS[it.kind] ? INGREDIENTS[it.kind].art.c1 : '#c98a3c'; }
  subjectFlesh() { const it = this.subjectItem(); return it && INGREDIENTS[it.kind] ? INGREDIENTS[it.kind].art.c2 : '#f6ecd6'; }

  rimPoint() { return this.geo ? { x: this.geo.mouthX, y: this.geo.mouthY - this.geo.mouthRy } : { x: MAIN.x, y: MAIN.y - 140 }; }

  // (first person: the real pot it's scooped from, the real plates / cups / pockets it goes into)
  scoopSource() { return (this.targetHook && this.targetHook('scoopFrom')) || { x: 200, y: 400 }; }
  scoopTargets() {
    const n = this.g.n || 2;
    const real = this.targetHook && this.targetHook('scoopTo', n);
    if (real) return real;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: 420 + (n === 1 ? 160 : i * Math.min(220, 440 / Math.max(1, n - 1))), y: 470 });
    return out;
  }
  scoopColor() {
    const v = this.c.C.vessels[this.c.def.from];
    if (!v) return '#e0a050';
    if (v.liquid) return v.liquid;
    const c = v.contents.find((q) => q.kind !== 'water');
    return c && INGREDIENTS[c.kind] ? INGREDIENTS[c.kind].art.c1 : '#e0a050';
  }

  // where you take hold of what you drag (a pan by its handle)
  grabPoint() {
    const g = this.g;
    if (!g || !g.pos) return { x: 0, y: 0 };
    return g.grip ? { x: g.pos.x + g.grip.x, y: g.pos.y + g.grip.y } : g.pos;
  }
  dragScale(kind) { return this.vesselScale(kind) * 0.85; }

  // ------------------------------------------------------------------ doors
  // The fridge and the pantry swing open on their left hinge, the oven door
  // drops down towards you. You take the handle and drag: the door follows
  // your hand, in perspective.
  // the board's knife / peeler / grater (or the stack beside it): not lying there (taken away), or already moved
  partDone(ph) {
    const q = ph.part, fx = this.c.f.id, aside = ((this.c.C.fx[fx] || {}).aside || {})[q] ? 1 : 0;
    if (aside === (ph.to.startsWith('aside') ? 1 : 0)) return true;
    if (q === 'nest') return false;
    return !Object.values(this.c.C.tools || {}).some((t) => t.at === `${fx}/board` && t.held == null && TOOLS[t.kind] && TOOLS[t.kind].board === q);
  }
  doorGeo(hot) {
    if (!hot) hot = this.c.f.type === 'fridge' ? 'fridge' : this.c.f.type === 'shelf' ? 'pantry' : 'oven';
    if (hot === 'oven') return { kind: 'drop', hy: 570, x0: 250, x1: 750, h: 360 };
    if (hot === 'board') return { kind: 'drop', hy: 600, x0: 290, x1: 710, h: 260 }; // (a counter's board, stood up at the back)
    if (hot === 'pantry') return { kind: 'swing', hx: 240, y0: 40, y1: 600, w: 520, glass: true, max: 1.5 };
    return { kind: 'swing', hx: 300, y0: 40, y1: 610, w: 420, max: 1.75 };
  }
  doorGrab(geo, o) {
    o = clamp(o, 0, 1);
    if (geo.kind === 'drop') {
      const a = o * Math.PI / 2;
      const top = geo.hy - geo.h * Math.cos(a) + 45 * Math.sin(a);
      return { x: (geo.x0 + geo.x1) / 2, y: geo.hy + (top - geo.hy) * 0.93 };
    }
    return this.doorPoint(geo, o, 0.88, (geo.y0 + geo.y1) / 2);
  }
  // a point on a swinging door (u: 0 at the hinge … 1 at the free edge), seen from the eye
  doorPoint(geo, o, u, y) {
    const a = clamp(o, 0, 1) * geo.max;
    const x = geo.hx + u * geo.w * Math.cos(a), z = u * geo.w * Math.sin(a);
    const k = EYE.f / (EYE.f - z);
    return { x: EYE.x + (x - EYE.x) * k, y: EYE.y + (y - EYE.y) * k };
  }
  // do I see the door's outside (with the handle) or its inside?
  doorOutside(geo, o) {
    const a = clamp(o, 0, 1) * geo.max;
    return (EYE.x - geo.hx) * -Math.sin(a) + EYE.f * Math.cos(a) > 0;
  }
  doorOpenAt(geo, p) {
    if (geo.kind === 'drop') {
      let best = 0, bd = Infinity;
      for (let o = 0; o <= 1.0001; o += 0.01) { const d = Math.abs(this.doorGrab(geo, o).y - p.y); if (d < bd) { bd = d; best = o; } }
      return best;
    }
    // wherever the handle comes closest to your hand
    let best = 0, bd = Infinity;
    for (let o = 0; o <= 1.0001; o += 0.01) { const q = this.doorGrab(geo, o); const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = o; } }
    return best;
  }
  // how far the door here is open, as I see it now
  doorOpen() {
    const g = this.g;
    if (g && g.kind === 'door') return g.v;
    const ph = this.c.phases;
    for (let i = Math.min(this.ph, ph.length) - 1; i >= 0; i--) if (ph[i].g === 'door') return ph[i].to;
    const fxs = this.c.C.fx[this.c.f.id] || {};
    return fxs.door ? 1 : 0;
  }
  drawDoor(ctx, geo, o, look = {}) {
    o = clamp(o, 0, 1);
    ctx.save();
    ctx.strokeStyle = OUTLINE; ctx.lineJoin = 'round';
    if (geo.kind === 'drop') {
      const a = o * Math.PI / 2, sn = Math.sin(a);
      const top = geo.hy - geo.h * Math.cos(a) + 45 * sn, spread = 50 * sn;
      const quad = [[geo.x0, geo.hy], [geo.x1, geo.hy], [geo.x1 + spread, top], [geo.x0 - spread, top]];
      ctx.fillStyle = shade('#3a3a42', -sn * 0.2); ctx.lineWidth = 4;
      ctx.beginPath(); quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (o < 0.85) {
        // the window (you can see in), squashed as it tips towards you
        const wy0 = geo.hy - (geo.hy - top) * 0.8, wy1 = geo.hy - (geo.hy - top) * 0.2;
        ctx.fillStyle = look.glow ? `rgba(255,${150 + Math.sin(this.t * 4) * 20},60,0.55)` : 'rgba(20,20,26,0.55)';
        ctx.beginPath(); ctx.roundRect(300 - spread * 0.6, Math.min(wy0, wy1), 400 + spread * 1.2, Math.abs(wy1 - wy0), 12); ctx.fill();
      }
      const h = this.doorGrab(geo, o);
      ctx.fillStyle = '#c9ccd2'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(h.x - 200 - spread * 0.8, h.y - 11, 400 + spread * 1.6, 22, 11); ctx.fill(); ctx.stroke();
    } else {
      const sn = Math.sin(o * geo.max);
      const P = (u, y) => this.doorPoint(geo, o, u, y);
      const cy = (geo.y0 + geo.y1) / 2;
      const quad = [P(0, geo.y0), P(1, geo.y0), P(1, geo.y1), P(0, geo.y1)];
      const path = (pts) => { ctx.moveTo(pts[0].x, pts[0].y); for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y); ctx.closePath(); };
      const outside = this.doorOutside(geo, o);
      const shadeBy = outside ? -sn * 0.22 : -0.08;
      if (geo.glass) {
        // a wooden frame round a glass pane: what's inside shows through it
        const pane = [P(0.1, geo.y0 + 40), P(0.9, geo.y0 + 40), P(0.9, geo.y1 - 40), P(0.1, geo.y1 - 40)];
        ctx.fillStyle = shade(look.wood || '#b5613d', shadeBy);
        ctx.beginPath(); path(quad); path([...pane].reverse()); ctx.fill('evenodd');
        ctx.fillStyle = 'rgba(215,236,248,0.22)'; ctx.beginPath(); path(pane); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
        const g0 = P(0.25, geo.y0 + 90), g1 = P(0.42, geo.y0 + 260); ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.stroke();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3; ctx.beginPath(); path(pane); ctx.stroke();
        ctx.lineWidth = 4; ctx.beginPath(); path(quad); ctx.stroke();
      } else {
        ctx.fillStyle = outside ? shade(look.color || '#f4f1ea', shadeBy) : '#e6e2d8';
        ctx.beginPath(); path(quad); ctx.fill(); ctx.lineWidth = 5; ctx.stroke();
        if (outside && o < 0.05) {
          // magnets and a note on the closed door
          for (const [x, y, col] of [[380, 300, '#e8573a'], [450, 360, '#f2b21a'], [400, 430, '#3faa5a'], [520, 290, '#2f8fd0']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 14, 0, TAU); ctx.fill(); }
          ctx.fillStyle = '#fffbe0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(500, 380, 90, 110, 4); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = 'rgba(40,30,20,0.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(geo.hx, 230); ctx.lineTo(geo.hx + geo.w, 230); ctx.stroke();
        }
        if (!outside) {
          // the racks on the inside of the door
          ctx.strokeStyle = '#c9d8e2'; ctx.lineWidth = 6;
          for (const y of [180, 330, 480]) { const a0 = P(0.06, y), a1 = P(0.94, y); ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke(); }
        }
      }
      // the handle (or, seen from inside, the grip on that edge): always there to take
      const h0 = P(0.88, cy - 70), h1 = P(0.88, cy + 70), hm = P(0.88, cy);
      const hw = Math.max(9, 22 * Math.abs(Math.cos(o * geo.max)) + 6);
      ctx.fillStyle = geo.glass ? '#c9a24a' : outside ? '#9aa0aa' : '#b8bec8'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
      if (geo.glass) { ctx.beginPath(); ctx.ellipse(hm.x, hm.y, hw * 0.7, 16 * (h1.y - h0.y) / 140, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
      else { ctx.beginPath(); ctx.roundRect(hm.x - hw / 2, h0.y, hw, h1.y - h0.y, hw / 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }

  hotspot() {
    const g = this.g;
    if (!g) return null;
    switch (g.ph.hot) {
      case 'faucet': return LEVER;
      case 'door': return { x: 500, y: 250, r: 70 };
      case 'fridge': return { x: 640, y: 330, r: 90 };
      case 'bell': return BELL;
      case 'pedal': return { x: 500, y: 590, r: 60 };
      case 'soap': return SOAP;
      case 'gloves': return { x: 280, y: 300, r: 70 }; // (the oven gloves, beside it – first person: the real ones)
      case 'dwStart': return DW_BTN;
      // (the board's own knife, peeler or grater – first person: where it really lies)
      case 'pick': case 'rest': return (this.targetHook && this.targetHook(`tool:${g.ph.takes}`)) || TOOL_AT[g.ph.takes];
      default: return { x: 500, y: 300, r: 80 };
    }
  }

  // ------------------------------------------------------------------ effects

  burst(x, y, col, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 80 + Math.random() * 160;
      this.fx.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0, max: 0.6 + Math.random() * 0.3, col });
    }
  }
  splash(x, y, col = 'rgba(160,210,250,0.9)') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 120 + Math.random() * 160;
      this.fx.push({ kind: 'drop', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.7, col });
    }
    this.fx.push({ kind: 'ring', x, y, life: 0, max: 0.6 });
  }
  bubbles(x, y) { for (let i = 0; i < 4; i++) this.fx.push({ kind: 'bubble', x: x + (Math.random() - 0.5) * 80, y: y + (Math.random() - 0.5) * 50, vx: 0, vy: -30, life: 0, max: 1 + Math.random(), r: 5 + Math.random() * 8 }); }
  powder(x, y, kind) {
    const col = INGREDIENTS[kind] ? INGREDIENTS[kind].art.c1 : '#ffffff';
    for (let i = 0; i < 14; i++) this.fx.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 50, vy: 160 + Math.random() * 120, life: 0, max: 0.9, col });
  }

  // ------------------------------------------------------------------ frame

  frame(dt) {
    if (!this.on) return;
    if (this.mode === 'store') {
      this.t += dt;
      this.idle = (this.idle || 0) + dt;
      this.storeTick(dt);
      if (this.on && !this.headless) this.draw(dt); // (shutting the door may have ended the visit)
      return;
    }
    this.t += dt;
    this.idle = (this.idle || 0) + dt;
    const g = this.g;
    // continuous gestures
    if (g && !this.done) {
      if ((g.kind === 'pour' || g.kind === 'fill') && g.pouring) {
        const rate = g.kind === 'fill' ? 0.32 : g.ph.drain ? 0.45 : g.ph.tip ? 0.55 : 0.38;
        g.v = Math.min(1.2, g.v + rate * dt);
        this.value(g.v, false);
        this.report();
        if (Math.random() < 0.5) this.hooks.sfx(g.kind === 'fill' ? 'water' : 'pourTick', 0.4);
      }
      if (g.kind === 'dip' && g.inside) { g.hold += dt; if (Math.random() < 0.2) this.bubbles(MAIN.x, MAIN.y - 100); }
    }
    // the cook's hands, for everyone else to see
    this.sendPose();
    if (!this.headless) this.draw(dt);
    else {
      // first person: the 3D kitchen shows it (and sets where the pan's mouth is, this.geo)
      this.prepare();
      if (g && g.kind === 'flick' && g.toss) { g.toss = Math.max(0, g.toss - dt * 2.4); if (g.toss < 0.02) g.toss = 0; }
    }
  }

  // the dish as I see it, with my own moves applied at once (worked out again
  // only when something changed)
  prepare() {
    const C = this.c.C;
    const g = this.g;
    const key = this.mode === 'store' ? 'store' : `${this.ph}|${this.k}|${g ? g.v || 0 : 0}|${this.done}`;
    if (this.preparedFor === C && this.preparedKey === key && this.D) return;
    this.preparedFor = C; this.preparedKey = key;
    if (this.mode === 'store') { this.D = displayState(C, this.c.x, this.c.K); return; }
    const st = C.steps[this.sid];
    const patched = { ...C, steps: { ...C.steps, [this.sid]: { ...st, s: this.done ? 'done' : 'active', ph: Math.min(this.ph, this.c.phases.length - 1), k: this.k, v: g ? g.v || 0 : 0 } } };
    if (this.done) patched.steps[this.sid] = st;
    this.D = displayState(patched, this.c.x, this.c.K);
  }

  sendPose() {
    const g = this.g;
    if (!g || !this.hooks.pose) return;
    const tool = (g.ph && g.ph.tool) || toolFor(g.kind);
    const p = this.ptr;
    let mode = 'hold', a = 0.4, b = 0;
    if (g.kind === 'chop') { mode = 'chop'; const box = this.subjectBox(); a = clamp((box.y1 - p.y) / 200, 0, 1); }
    else if (g.kind === 'circle') { mode = 'circle'; b = g.lastAng || 0; }
    else if (g.kind === 'strokes' && this.c.def.do === 'wash') { mode = 'scrub'; b = clamp((p.x - 500) / 200, -1, 1); }
    else if (g.kind === 'strokes' || g.kind === 'peel') { mode = 'stroke'; a = clamp((MAIN.y - p.y) / 300, 0, 1); b = clamp((p.x - 500) / 200, -1, 1); }
    else if (g.kind === 'pour' || g.kind === 'fill') { mode = 'pour'; a = g.pouring ? 1 : 0; }
    else if (g.kind === 'door') { mode = 'door'; a = g.v || 0; }
    this.hooks.pose({ s: this.sid, tool: tool || '', a, b, mode });
  }

  draw(dt) {
    const ctx = this.ctx, el = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = el.clientWidth, ch = el.clientHeight;
    if (el.width !== Math.round(cw * dpr) || el.height !== Math.round(ch * dpr)) { el.width = Math.round(cw * dpr); el.height = Math.round(ch * dpr); }
    const sc = sceneScale(cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate((cw - SW * sc) / 2, (ch - SH * sc) / 2);
    ctx.scale(sc, sc);
    ctx.beginPath(); ctx.roundRect(0, 0, SW, SH, 26); ctx.clip();

    // the display state with my own (optimistic) progress in it
    this.prepare();

    const cap = this.sceneKind();
    this.drawBackdrop(ctx, cap);
    this.geo = null;
    switch (cap) {
      case 'sink': this.sceneSink(ctx); break;
      case 'hob': this.sceneHob(ctx); break;
      case 'oven': this.sceneOven(ctx); break;
      case 'dome': this.sceneDome(ctx); break;
      case 'tandoor': this.sceneTandoor(ctx); break;
      case 'chill': this.sceneFridge(ctx); break;
      case 'plate': this.scenePlate(ctx); break;
      case 'scraps': this.sceneScraps(ctx); break;
      case 'bin': this.sceneBin(ctx); break;
      case 'dishwasher': this.sceneDishwasher(ctx); break;
      case 'store': this.sceneStore(ctx); break;
      default: this.sceneBoard(ctx); break;
    }
    if (this.mode === 'store') { this.drawFx(ctx, dt); this.storeCursor(ctx); ctx.restore(); return; }
    // what I hold for something else stays in my other hand while this one works
    this.drawHeld(ctx, this.heldExtras());
    this.drawGestureOverlay(ctx);
    this.drawFx(ctx, dt);
    this.drawCursor(ctx);
    if (this.done) this.drawDone(ctx);
    ctx.restore();
  }

  sceneKind() {
    const f = this.c.f;
    const t = f.type;
    if (this.mode === 'store') return 'store';
    if (this.c.def.chore) return { clear: 'scraps', knob: 'hob', scrub: 'sink', wipe: 'board', dw: 'dishwasher', portion: 'board' }[this.c.def.do] || 'bin';
    if (t === 'sink') return 'sink';
    if (t === 'fridge') return 'chill';
    if (t === 'pizzaOven' || t === 'stoneOven') return 'dome';
    if (t === 'tandoor') return 'tandoor';
    if (t === 'oven') return 'oven';
    if (t === 'aga' || t === 'piano') {
      const s = this.c.def;
      if (s.do === 'bakeIn' || s.do === 'bakeOut') return 'oven';
      const v = this.c.C.vessels[s.vessel || s.into];
      if (v && v.at && !v.onHob && s.do !== 'heat') return 'oven';
      return 'hob';
    }
    if (t === 'stove' || t === 'paellaBurner') return 'hob';
    if (this.c.def.do === 'serve' || (this.phase && this.phase.g === 'scoop')) return 'plate';
    if (t === 'table') return 'plate';
    return 'board';
  }

  // ------------------------------------------------------------------ scenes

  // First person: you look down at the worktop. A strip of wall and the
  // bottoms of the (tidy) upper cupboards at the top, the counter running
  // towards you, your own arms coming in from the bottom.
  drawBackdrop(ctx, cap) {
    const pal = this.c.pal;
    const T = themeOf(this.c.K.cuisine);
    ctx.fillStyle = T.wallA; ctx.fillRect(0, 0, SW, SH);
    // upper cupboards seen from below, in the room's own colours
    ctx.fillStyle = T.cabinet2; ctx.fillRect(0, 0, SW, 42);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
    for (let x = 0; x < SW; x += 125) {
      ctx.fillStyle = T.cabinet; ctx.beginPath(); ctx.roundRect(x + 8, -10, 109, 46, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = T.handle === 'iron' ? '#3a3a42' : '#c9a24a'; ctx.beginPath(); ctx.roundRect(x + 52, 26, 22, 6, 3); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,240,190,0.9)'; ctx.fillRect(0, 42, SW, 5);
    // the splashback: the same tiles as the room (İznik, azulejos, brick, metro …)
    ctx.fillStyle = this.pattern(`splash:${T.splash}`, splashTexture(T).image, 0.72);
    ctx.save(); ctx.translate(-((this.c.f.x * 37) % 184), 47); ctx.fillRect(0, 0, SW + 190, 93); ctx.restore();
    const lg = ctx.createLinearGradient(0, 47, 0, 140);
    lg.addColorStop(0, 'rgba(255,236,170,0.5)'); lg.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 47, SW, 93);
    // the worktop running towards you: marble, butcher block, tiles or granite
    ctx.fillStyle = shade(T.trim, -0.1); ctx.fillRect(0, 136, SW, 10);
    if (cap === 'hob') ctx.fillStyle = '#34343c';
    else if (cap === 'plate') ctx.fillStyle = '#c8925a';
    else ctx.fillStyle = this.pattern(`top:${T.top}:${T.topA}`, topTexture(T).image, 1.6);
    ctx.fillRect(0, 146, SW, SH - 146);
    const grd = ctx.createLinearGradient(0, 146, 0, SH);
    grd.addColorStop(0, 'rgba(0,0,0,0.12)'); grd.addColorStop(0.5, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = grd; ctx.fillRect(0, 146, SW, SH - 146);
    // perspective: joints converge to a point far behind the wall
    const vx = SW / 2, vy = -900;
    ctx.strokeStyle = cap === 'hob' ? 'rgba(255,255,255,0.05)' : cap === 'plate' ? 'rgba(90,50,20,0.22)' : 'rgba(80,60,40,0.08)';
    ctx.lineWidth = cap === 'plate' ? 3 : 2;
    for (let i = -6; i <= 6; i++) {
      const bx = SW / 2 + i * 190;
      const t0 = (146 - vy) / (SH - vy);
      ctx.beginPath(); ctx.moveTo(vx + (bx - vx) * t0, 146); ctx.lineTo(bx, SH); ctx.stroke();
    }
    const edge = cap === 'hob' ? '#34343c' : cap === 'plate' ? '#c8925a' : T.topA;
    ctx.fillStyle = shade(edge, -0.18); ctx.fillRect(0, SH - 14, SW, 14);
    // a soft vignette keeps your eyes on the work
    const vg = ctx.createRadialGradient(SW / 2, SH * 0.62, 180, SW / 2, SH * 0.6, 640);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,30,10,0.22)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, SW, SH);
    void pal;
  }

  // a canvas pattern from a theme texture, scaled
  pattern(key, img, scale) {
    this.patterns = this.patterns || new Map();
    let p = this.patterns.get(key);
    if (!p) {
      p = this.ctx.createPattern(img, 'repeat');
      if (p && p.setTransform) p.setTransform(new DOMMatrix().scale(scale));
      this.patterns.set(key, p);
    }
    return p || '#e8e0d0';
  }

  sceneBoard(ctx) {
    const s = this.c.def;
    // the cutting board, in perspective (narrower at the far end)
    const board = (inset) => {
      ctx.beginPath();
      ctx.moveTo(250 + inset, 250 + inset); ctx.lineTo(750 - inset, 250 + inset);
      ctx.quadraticCurveTo(790, 252, 800 - inset, 300);
      ctx.lineTo(845 - inset, 560 - inset); ctx.quadraticCurveTo(848, 596, 805, 598 - inset);
      ctx.lineTo(195 + inset, 598 - inset); ctx.quadraticCurveTo(152, 596, 155 + inset, 560 - inset);
      ctx.lineTo(200 + inset, 300); ctx.quadraticCurveTo(210, 252, 250 + inset, 250 + inset);
      ctx.closePath();
    };
    ctx.fillStyle = '#b8854a'; ctx.save(); ctx.translate(0, 12); board(0); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#d8a868'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    board(0); ctx.fill(); ctx.stroke();
    ctx.save(); board(6); ctx.clip();
    ctx.strokeStyle = 'rgba(120,70,30,0.2)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const y = 270 + i * 38; ctx.beginPath(); ctx.moveTo(150, y); ctx.bezierCurveTo(400, y - 10, 600, y + 12, 850, y - 2); ctx.stroke(); }
    // old knife marks
    ctx.strokeStyle = 'rgba(120,70,30,0.18)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) { const x = 260 + ((i * 97) % 480), y = 300 + ((i * 53) % 260); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 18, y + 6); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#b8854a'; ctx.beginPath(); ctx.arc(760, 284, 10, 0, TAU); ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3; ctx.stroke();
    const g = this.g;
    const D = this.D;
    // a bowl / vessel being worked on here
    const vId = s.vessel || s.into;
    const subjectIsVessel = g && g.subject && g.subject.type === 'vessel';
    if (subjectIsVessel && vId && D.vessels[vId]) {
      this.drawMainVessel(ctx, vId, MAIN.x, MAIN.y + 20, 1.45);
    }
    // the item (worked several at a time: just the one being worked on – the pile and the container below)
    const U = boardUnits(D.items[s.item]);
    const it0 = this.subjectItem(), it = it0 && U ? (U.cur ? { ...U.cur, id: it0.id } : null) : it0;
    if (it && !it.in && !it.hidden && !(g && g.kind === 'wrap')) {
      const rot = g && g.kind === 'circle' && g.ph.turn ? g.rot || 0 : 0;
      ctx.save();
      if (rot) { ctx.translate(MAIN.x, MAIN.y - 60); ctx.rotate(rot); ctx.translate(-MAIN.x, -(MAIN.y - 60)); }
      if (it.kind === 'dough' && it.shape === 'flat') this.drawDoughWithPaint(ctx, it);
      else drawIngredient(ctx, it.kind, it, MAIN.x, MAIN.y, this.itemScale(it.kind), this.t);
      ctx.restore();
    }
    // the grater stands beside the food while grating
    if (g && g.ph.tool === 'grater') drawTool(ctx, 'grater', MAIN.x + 150, MAIN.y, 1.1, 0, false);
    // the pile of those done, at the side (not while it's being gathered up)
    const gathering = g && g.kind === 'drag' && g.source && g.source.pieces;
    if (U && U.pile && !gathering) { const pa = PILE_AT; if (U.pile.cut) drawPieces(ctx, U.pile.kind, U.pile.cut, Math.max(2, Math.round(8 * U.aside / U.q)), pa.x, pa.y, 0.75, 3); else drawIngredient(ctx, U.pile.kind, U.pile, pa.x, pa.y, this.itemScale(U.pile.kind) * 0.6, this.t); }
    // taking it out / putting it back: its container stands beside the board (with it in, once it's in;
    // worked several at a time: with those still to do in it)
    if (U || (g && g.kind === 'drag' && g.source && (g.source.pieces || g.source.fromBox))) {
      const it2 = D.items[s.item];
      const inBox = U ? U.left - (g && g.kind === 'drag' && g.source && g.source.fromBox ? 1 : 0) : 0;
      ctx.save(); ctx.translate(BOX_AT.x, BOX_AT.y + 50); ctx.scale(0.75, 0.75); this.drawTub(ctx, 230, 120, 0, 'back');
      if (it2 && inBox > 0) drawIngredient(ctx, it2.kind, { ...it2, qty: inBox, extra: 0, slots: (it2.qty || 1) + (it2.extra || 0), cut: null, k: 0, n: 0 }, 0, -10, Math.min(1.1, this.itemScale(it2.kind) * 0.7), this.t);
      if (g && g.source && g.source.pieces && this.k > 0 && it2) {
        if (it2.cut && (it2.k || 0) >= (it2.n || 0)) drawPieces(ctx, it2.kind, it2.cut, 7, 0, -12, 0.8, 3);
        else drawIngredient(ctx, it2.kind, it2, 0, -10, Math.min(1.1, this.itemScale(it2.kind) * 0.7), this.t);
      }
      this.drawTub(ctx, 230, 120, 0, 'front'); ctx.restore();
    }
    // the stack of empty food containers on the worktop beside the board
    ctx.save(); ctx.translate(STACK_AT.x, STACK_AT.y + 40); ctx.scale(0.5, 0.5);
    for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(0, -i * 14); ctx.scale(1 - i * 0.08, 1 - i * 0.08); this.drawTub(ctx, 230, 120, 0, 'back'); this.drawTub(ctx, 230, 120, 0, 'front'); ctx.restore(); }
    ctx.restore();
    // portioning: the bunch's container, and the new one with those moved over so far
    if (s.do === 'portion' && D.items[s.item]) {
      const it3 = D.items[s.item], rest = D.items[`${s.item}~rest`], split = !(it3.extra > 0) && rest;
      // (once it's split: what's needed in the new container, what's left in the bunch's)
      const moved = split ? it3.qty || 1 : g && g.kind === 'drag' && g.source && g.source.oneOver ? this.k : 0, carrying = !split && g && g.kind === 'drag' && g.source && g.source.oneOver ? 1 : 0;
      const left = split ? rest.qty : (it3.qty || 1) + (it3.extra || 0) - moved - carrying;
      const tub = (p, n, slots) => { ctx.save(); ctx.translate(p.x, p.y + 50); ctx.scale(0.75, 0.75); this.drawTub(ctx, 230, 120, 0, 'back'); if (n > 0) drawIngredient(ctx, it3.kind, { ...it3, qty: n, extra: 0, slots, cut: null, k: 0, n: 0 }, 0, -10, Math.min(1.1, this.itemScale(it3.kind) * 0.7), this.t); this.drawTub(ctx, 230, 120, 0, 'front'); ctx.restore(); };
      // (the bunch's container keeps its places as it empties; the new one is filled with just what's needed)
      tub(PORTION_FROM, left, split ? rest.cap || (it3.qty || 1) + rest.qty : (it3.qty || 1) + (it3.extra || 0));
      if (this.ph > 0 || split) tub(PORTION_TO, moved, it3.qty || 1);
    }
    // the board's own tools, lying there – unless they're in my hand
    const ph = g && g.ph;
    for (const t of BOARD_TOOLS) if (!(ph && (ph.tool === t || ph.held === t))) { const a = TOOL_AT[t]; drawTool(ctx, t, a.x, a.y, a.s, a.ang, false); }
    // cleaning the board: its stains and crumbs, the suds, the dish soap
    if (s.do === 'wipe') {
      const { dirt, suds } = this.washLook();
      this.drawDirt(ctx, MAIN.x, MAIN.y - 10, 230, 110, dirt, suds);
      this.drawSoap(ctx, g && g.kind === 'tap' && g.ph.hot === 'soap' && this.ptr.down);
    }
    this.drawScrapsHere(ctx);
    this.drawSource(ctx);
  }

  // peel, shells and stems already lying at this counter (tidy up later!)
  drawScrapsHere(ctx) {
    const sc = this.c.C.scraps && this.c.C.scraps[this.c.f.id];
    if (!sc || !sc.n || this.c.def.chore) return;
    for (let i = 0; i < Math.min(9, sc.n * 2); i++) {
      const kind = sc.kinds[i % Math.max(1, sc.kinds.length)] || 'onion';
      const x = 215 + ((i * 47) % 70), y = 560 - ((i * 31) % 60);
      this.drawScrap(ctx, kind, x, y, i);
    }
  }

  drawScrap(ctx, kind, x, y, i, s = 1.7) {
    const art = INGREDIENTS[kind] ? INGREDIENTS[kind].art : { c1: '#c98a3c', c2: '#f6ecd6' };
    ctx.save(); ctx.translate(x, y); ctx.rotate(i * 1.7); ctx.scale(s, s);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.2;
    if (kind === 'egg') {
      ctx.fillStyle = art.c1;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.quadraticCurveTo(-12, -16, 0, -16); ctx.quadraticCurveTo(12, -16, 14, 0); ctx.lineTo(8, -4); ctx.lineTo(3, 2); ctx.lineTo(-3, -5); ctx.lineTo(-8, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (INGREDIENTS[kind] && INGREDIENTS[kind].art.type === 'herb') {
      ctx.strokeStyle = art.c3 || '#3f7a2a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-14, 6); ctx.quadraticCurveTo(0, -4, 14, -8); ctx.stroke();
    } else {
      ctx.fillStyle = art.c1;
      ctx.beginPath(); ctx.moveTo(-18, 4); ctx.quadraticCurveTo(-4, -12, 16, -6); ctx.quadraticCurveTo(4, 2, -18, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = art.c2; ctx.beginPath(); ctx.ellipse(-2, -3, 6, 2, -0.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ the trash, close up

  sceneScraps(ctx) {
    this.sceneBoard(ctx);
    const sc = (this.c.C.scraps && this.c.C.scraps[this.c.f.id]) || { n: 0, kinds: [] };
    const g = this.g;
    if (!g) return;
    const swept = g.kind === 'strokes' ? this.k / phaseTarget(g.ph) : 1;
    if (g.kind === 'drag' && this.k === 0 && g.drag) return; // in your hands now
    if (g.kind === 'drag' && this.k > 0) return;
    const n = Math.max(4, Math.min(16, sc.n * 3));
    const cx = g.kind === 'drag' ? g.pos.x : MAIN.x, cy = g.kind === 'drag' ? g.pos.y : MAIN.y - 40;
    for (let i = 0; i < n; i++) {
      const kind = sc.kinds[i % Math.max(1, sc.kinds.length)] || 'onion';
      const a = i * 2.4, r = 260 * (1 - swept) + 30 + (i % 4) * 8;
      const x = cx + Math.cos(a) * r * (g.kind === 'drag' ? 0.2 : 1), y = cy + Math.sin(a) * r * 0.45 * (g.kind === 'drag' ? 0.3 : 1);
      this.drawScrap(ctx, kind, x, y, i);
    }
  }

  // ================================================================== the fridge / pantry
  // Not a recipe step: open it by the handle, look in, take what you need
  // (drag it down to your hands, on the right), put things back (drag them
  // from your hands onto a shelf), swing it shut – in any order, as often as
  // you like. Each move goes to the kitchen at once (door, take, put).

  openStore(ctx) {
    this.on = true;
    this.mode = 'store';
    this.c = { ...ctx, def: { do: 'store', name: ctx.title }, phases: [], st: { s: 'active', ph: 0, k: 0 } };
    this.sid = null; this.ph = 0; this.k = 0; this.v = 0; this.fx = []; this.g = null;
    const fxs = ctx.C.fx[ctx.f.id] || {};
    this.store = { v: fxs.door ? 1 : 0, door: false, drag: null, pend: new Map(), sent: 0, shut: 0 };
    this.reportStore();
  }

  get storeGeo() { return this.doorGeo(this.c.f.type === 'fridge' ? 'fridge' : 'pantry'); }

  // the host's word: the door (unless I'm swinging it), what's really taken / put back
  storeSync() {
    const S = this.store, C = this.c.C, fx = this.c.f.id;
    const now = performance.now();
    for (const [k, p] of S.pend) {
      const t = k[0] === 'v' ? C.vessels[k.slice(2)] : C.items[k.slice(2)];
      const kept = t && t.held == null && (k[0] === 'v' ? !t.at && t.home === fx : t.at === fx);
      const placed = !p.spot || (t && t.spot && t.spot.r === p.spot.r && Math.abs(t.spot.x - p.spot.x) < 0.011);
      const got = p.to === 'held' ? t && t.held === this.c.me : kept && placed;
      if (got || now - p.t > 2500) S.pend.delete(k);
    }
    this.reportStore();
  }
  storeTick(dt) {
    const S = this.store, fxs = this.c.C.fx[this.c.f.id] || {};
    if (!S.door) {
      // someone else swinging it, or settling to open / shut
      const want = fxs.swing != null && fxs.by !== this.c.me ? fxs.swing : fxs.door ? 1 : 0;
      S.v += (want - S.v) * Math.min(1, dt * 10);
    }
    if (S.shut && performance.now() > S.shut) { S.shut = 0; this.hooks.close(); }
    this.hooks.pose({ s: null, tool: '', a: S.door ? S.v : 0.4, b: 0, mode: S.door ? 'door' : 'hold' });
  }
  reportStore() {
    if (!this.hooks.progress || !this.store) return;
    const S = this.store;
    const name = this.c.want ? thingName(this.c.C, this.c.x, this.c.want) : '';
    const { keys, two } = this.heldNow();
    const hint = S.msg && performance.now() < S.msgUntil ? S.msg
      : S.v < 0.5 ? (two ? 'Both your hands are full – put something down first' : 'Take the handle and swing the door open')
        : two ? 'Both hands full: put something back, or carry it off – the door stays open till you come back'
          : keys.length ? 'Swing the door shut with your free hand – or put things back where you like'
            : `Pull out what you need${name ? ` (the ${name})` : ''} · move things about as you like`;
    this.hooks.progress({ title: this.c.def.name, hint, ph: 0, phases: 0, k: 0, n: 0, done: false });
  }

  // (steps) what I'm holding that this step doesn't use
  heldExtras() {
    const C = this.c.C, s = this.c.def;
    if (s.chore) return [];
    const need = needsOf(C, s);
    return heldBy(C, this.c.me).filter((k) => !need.includes(k) && !(k[0] === 'v' && need.some((n) => n[0] === 'i' && C.items[n.slice(2)] && C.items[n.slice(2)].in === k.slice(2))));
  }

  // what I'm holding, and whether it takes both hands
  heldNow() {
    const keys = this.heldHere();
    return { keys, two: this.handsFull(keys) };
  }
  storeSay(msg) { this.store.msg = msg; this.store.msgUntil = performance.now() + 2600; this.reportStore(); }

  // what I'm holding, as I see it (with my own moves applied at once)
  heldHere() {
    const keys = heldBy(this.c.C, this.c.me).filter((k) => !(this.store.pend.get(k) && this.store.pend.get(k).to === 'stored'));
    for (const [k, p] of this.store.pend) if (p.to === 'held' && !keys.includes(k)) keys.push(k);
    return keys;
  }

  // Everything kept here, each in its own place, sized and spaced. What a
  // cook put somewhere particular stands there (its spot: shelf r, x along
  // it); the rest keeps the usual order around it – pots and pans on the
  // bottom shelf, bowls and plates above, food at the top (in the fridge, food
  // on every shelf). key -> {x, y (where it stands), s, w, h, v, fixed}
  storeRows() {
    return this.c.f.type === 'fridge'
      ? [{ y: 175, x0: 335, x1: 685 }, { y: 300, x0: 335, x1: 685 }, { y: 425, x0: 335, x1: 685 }, { y: 550, x0: 335, x1: 685 }]
      : [{ y: 150, x0: 258, x1: 742 }, { y: 280, x0: 258, x1: 742 }, { y: 410, x0: 258, x1: 742 }, { y: 540, x0: 258, x1: 742 }];
  }
  storeLayout() {
    const f = this.c.f, C = this.c.C;
    const fridge = f.type === 'fridge';
    const keys = [];
    const fixed = new Set();
    // (the close-up shows what the dish has here – not everything else a kitchen keeps: that's first person's)
    for (const [id, v] of Object.entries(C.vessels)) {
      if (v.spare) continue;
      if (!v.at && v.held == null && v.home === f.id) keys.push(`v:${id}`);
      else if (fridge && v.at && v.at.fx === f.id) { keys.push(`v:${id}`); fixed.add(`v:${id}`); } // chilling: it comes out with its step
    }
    for (const [id, it] of Object.entries(C.items)) if (it.at === f.id && it.held == null && !it.in && !it.hidden && !it.spare) keys.push(`i:${id}`);
    const pend = this.store ? this.store.pend : new Map();
    for (const [k, p] of pend) { const i = keys.indexOf(k); if (p.to === 'held' && i >= 0) keys.splice(i, 1); if (p.to === 'stored' && i < 0) keys.push(k); }
    const thing = (k) => (k[0] === 'v' ? C.vessels[k.slice(2)] : C.items[k.slice(2)]);
    const kindOf = (k) => thing(k).kind;
    const spotOf = (k) => { const p = pend.get(k); return p && p.spot ? p.spot : thing(k).spot || null; };
    const cat = (k) => (k[0] === 'i' ? 'food' : VESSELS[kindOf(k)] && VESSELS[kindOf(k)].hob ? 'pans' : 'dishes');
    const rows = this.storeRows();
    const prefer = fridge ? { food: [0, 1, 2, 3], pans: [3, 2, 1, 0], dishes: [3, 2, 1, 0] } : { pans: [3, 2, 1, 0], dishes: [2, 1, 3, 0], food: [1, 0, 2, 3] };
    const base = (k) => (k[0] === 'v' ? Math.min(0.62, this.vesselScale(kindOf(k)) * 0.5) : Math.min(0.62, this.itemScale(kindOf(k)) * 0.44));
    const size = (k) => { const z = itemSize(kindOf(k)); return { w: z.w * base(k), h: z.h * base(k) }; };
    const occ = rows.map(() => []); // [from, to] taken along each shelf
    const out = new Map();
    const place = (k, r, cx) => {
      const R = rows[r], { w, h } = size(k);
      cx = clamp(cx, R.x0 + w / 2, R.x1 - w / 2);
      out.set(k, { x: cx, y: R.y, s: base(k), w, h, v: k[0] === 'v', fixed: fixed.has(k), r });
      occ[r].push([cx - w / 2 - 7, cx + w / 2 + 7]);
    };
    // where cooks put things
    const loose = [];
    for (const k of keys) {
      const sp = spotOf(k);
      if (sp && sp.r < rows.length) place(k, sp.r, rows[sp.r].x0 + sp.x * (rows[sp.r].x1 - rows[sp.r].x0));
      else loose.push(k);
    }
    // the rest in order, in the first gap that fits
    loose.sort((a, b) => ['pans', 'dishes', 'food'].indexOf(cat(a)) - ['pans', 'dishes', 'food'].indexOf(cat(b)) || a.localeCompare(b));
    const gap = (r, w) => {
      const R = rows[r];
      let x = R.x0 + 7;
      for (const [a, b] of [...occ[r]].sort((p, q) => p[0] - q[0])) { if (a - x >= w + 7) break; x = Math.max(x, b); }
      return x + w <= R.x1 - 7 ? x : null;
    };
    for (const k of loose) {
      const { w } = size(k);
      let r = prefer[cat(k)].find((i) => gap(i, w) != null);
      const x = r === undefined ? null : gap(r, w);
      if (r === undefined) r = prefer[cat(k)][0];
      place(k, r, x == null ? rows[r].x1 - w / 2 : x + w / 2);
    }
    return out;
  }

  // a spot on the shelves for a point (where a thing would stand if let go there)
  spotAt(p) {
    const rows = this.storeRows();
    let r = 0, bd = Infinity;
    rows.forEach((R, i) => { const d = Math.abs(p.y - R.y) + (p.y > R.y + 30 ? 200 : 0); if (d < bd) { bd = d; r = i; } });
    const R = rows[r];
    return { r, x: Math.round(clamp((p.x - R.x0) / (R.x1 - R.x0), 0, 1) * 100) / 100 };
  }
  insideStore(p) {
    const fridge = this.c.f.type === 'fridge';
    return p.x > (fridge ? 320 : 250) && p.x < (fridge ? 700 : 750) && p.y > 50 && p.y < 600;
  }

  drawThing(ctx, k, x, y, s) {
    const D = this.D, id = k.slice(2);
    if (k[0] === 'v') { const v = D.vessels[id]; if (v) drawVessel(ctx, v.kind, this.vesselView(v), x, y, s, this.t); }
    else { const it = D.items[id]; if (it) drawIngredient(ctx, it.kind, it, x, y, s, this.t); }
  }

  sceneStore(ctx) {
    const f = this.c.f;
    const fridge = f.type === 'fridge';
    const S = this.store;
    const geo = this.storeGeo;
    const wood = this.c.K.palette.trim || '#b5613d';
    if (fridge) {
      ctx.fillStyle = '#f4f1ea'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.roundRect(300, 40, 420, 570, 30); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8f4fb'; ctx.beginPath(); ctx.roundRect(320, 60, 380, 530, 20); ctx.fill();
      const lg = ctx.createRadialGradient(510, 90, 10, 510, 120, 260);
      lg.addColorStop(0, `rgba(255,255,240,${0.9 * Math.min(1, S.v * 3)})`); lg.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = lg; ctx.fillRect(320, 60, 380, 300);
      ctx.strokeStyle = '#c9d8e2'; ctx.lineWidth = 6;
      for (const y of [180, 305, 430]) { ctx.beginPath(); ctx.moveTo(330, y); ctx.lineTo(690, y); ctx.stroke(); }
    } else {
      ctx.fillStyle = shade(wood, -0.35); ctx.beginPath(); ctx.roundRect(230, 30, 540, 580, 14); ctx.fill();
      ctx.fillStyle = shade(wood, -0.15); ctx.fillRect(250, 45, 500, 555);
      ctx.fillStyle = wood; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
      for (const y of [150, 280, 410, 540]) { ctx.beginPath(); ctx.roundRect(240, y, 520, 16, 4); ctx.fill(); ctx.stroke(); }
      ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(230, 30, 540, 580, 14); ctx.stroke();
    }
    // what's kept here, in its place
    const L = this.storeLayout();
    const drag = S.drag;
    for (const [k, at] of L) {
      if (drag && drag.key === k) continue;
      if (k === this.c.want && S.v > 0.5) {
        ctx.fillStyle = `rgba(255,200,60,${0.32 + Math.sin(this.t * 5) * 0.12})`;
        ctx.beginPath(); ctx.ellipse(at.x, at.y - 3, at.w * 0.6 + 8, 14, 0, 0, TAU); ctx.fill();
      }
      this.drawThing(ctx, k, at.x, at.y, at.s);
    }
    // the door, as far open as it is
    this.drawDoor(ctx, geo, S.v, { wood });
    if (!S.door && S.v < 0.5) { const h = this.doorGrab(geo, S.v); this.ghostRing(ctx, h.x, h.y, 42 + Math.sin(this.t * 6) * 5); }
    // what I'm holding, in my own hands
    this.drawHeld(ctx, this.heldShown());
    // what I'm carrying across
    if (drag) {
      const { two } = this.heldNow();
      const x = drag.pos.x + drag.dx, y = drag.pos.y + drag.dy;
      this.drawThing(ctx, drag.key, x, y, drag.s);
      if (drag.from === 'hands' && two) this.drawBothHands(ctx, drag.key, x, y, drag.s);
    }
  }

  // Held things, at the bottom of the view: a heavy pot or a stack of plates
  // in both hands; otherwise one thing in each – the first in the left hand,
  // the next in the right (food on the palm, a saucepan by its handle).
  // While one hand is free, it's the one you work with. key -> where drawn.
  handSpots(keys) {
    const C = this.c.C;
    const t = (k) => (k[0] === 'v' ? C.vessels[k.slice(2)] : C.items[k.slice(2)]);
    const heavy = keys.find((k) => k[0] === 'v' && twoHanded(t(k).kind));
    if (heavy) return [{ k: heavy, x: 500, y: 548, s: Math.min(0.75, this.vesselScale(t(heavy).kind) * 0.6), two: true }];
    const first = this.holdSide(); // the first thing goes in the hand away from the work
    return keys.slice(0, 2).map((k, i) => {
      const side = i === 0 ? first : -first;
      if (k[0] === 'v' && vesselGrip(t(k).kind)) {
        // a saucepan, a pan, a cezve: by its handle
        const kind = t(k).kind;
        const s = Math.min(0.62, this.vesselScale(kind) * 0.5);
        const gr = vesselGrip(kind);
        const hand = { x: 500 + side * 170, y: 470 };
        return { k, x: hand.x - gr.x * s, y: hand.y - gr.y * s, s, hand, side };
      }
      if (k[0] === 'v') {
        // a plate, a bowl, a cup: resting on the palm
        const s = Math.min(0.55, this.vesselScale(t(k).kind) * 0.42);
        return { k, x: 500 + side * 280, y: 520, s, palm: { x: 500 + side * 280, y: 548 }, side };
      }
      return { k, x: 500 + side * 300, y: 500, s: Math.min(0.58, this.itemScale(t(k).kind) * 0.42), palm: { x: 500 + side * 300, y: 530 }, side };
    });
  }
  drawHeld(ctx, keys) {
    if (!keys.length) return;
    const look = this.c.look || { skin: '#eab88a', shirt: '#3a5a9a' };
    for (const sp of this.handSpots(keys)) {
      if (sp.two) { this.drawThing(ctx, sp.k, sp.x, sp.y, sp.s); this.drawBothHands(ctx, sp.k, sp.x, sp.y, sp.s); continue; }
      const from = { x: 500 + sp.side * 360, y: SH + 90 };
      if (sp.hand) {
        this.drawThing(ctx, sp.k, sp.x, sp.y, sp.s);
        this.drawArm(ctx, look, from, { x: sp.hand.x + sp.side * 10, y: sp.hand.y + 30 });
        this.drawHand(ctx, look, sp.hand.x, sp.hand.y, 'fist', 0, sp.side < 0);
      } else {
        this.drawArm(ctx, look, from, { x: sp.palm.x, y: sp.palm.y + 15 });
        this.drawHand(ctx, look, sp.palm.x, sp.palm.y, 'open', 0, sp.side < 0);
        this.drawThing(ctx, sp.k, sp.x, sp.y, sp.s);
      }
    }
  }
  // Which hand holds things (-1 left, 1 right): the other one does the work.
  // At the fridge / pantry that's the hand on the door handle's side – the
  // handle is on the right while the door is shut, on the left once it's open
  // (hands swap over between swings, not during one).
  holdSide() {
    if (this.mode !== 'store' || !this.store) return -1;
    const S = this.store;
    if (!S.door || S.side == null) S.side = this.doorGrab(this.storeGeo, S.v).x < 500 ? 1 : -1;
    return S.side;
  }

  // (store) what's in my hands, less what I'm moving across right now
  heldShown() {
    const drag = this.store && this.store.drag;
    return this.heldHere().filter((k) => !(drag && drag.key === k));
  }
  // both hands busy (a heavy pot, or something in each)
  handsFull(keys) {
    const C = this.c.C;
    return keys.length >= 2 || keys.some((k) => k[0] === 'v' && C.vessels[k.slice(2)] && twoHanded(C.vessels[k.slice(2)].kind));
  }
  drawBothHands(ctx, k, x, y, s) {
    const look = this.c.look || { skin: '#eab88a', shirt: '#3a5a9a' };
    const kind = this.c.C.vessels[k.slice(2)].kind;
    const w = itemSize(kind).w * s;
    for (const side of [-1, 1]) {
      const hx = x + side * (w / 2 - 6), hy = y - 30;
      this.drawArm(ctx, look, { x: 500 + side * 330, y: SH + 90 }, { x: hx + side * 10, y: hy + 30 });
      this.drawHand(ctx, look, hx, hy, 'fist', side * 0.3, side < 0);
    }
  }

  // Hands free for the door or for taking something: two, less what they
  // hold, the one on the door and the one(s) pulling something out.
  freeHands() {
    const S = this.store, { keys, two } = this.heldNow();
    const busy = (S.door ? 1 : 0) + (S.drag && S.drag.from === 'shelf' ? (S.drag.two ? 2 : 1) : 0) + (S.lift ? 1 : 0);
    return 2 - (two ? 2 : Math.min(2, keys.length)) - busy;
  }
  heavyKey(k) { return k[0] === 'v' && this.c.C.vessels[k.slice(2)] && twoHanded(this.c.C.vessels[k.slice(2)].kind); }

  // Each finger is a hand (pid): one can hold the door while the other takes
  // things; a heavy pot comes off the shelf with two fingers on it.
  storeDown(p, pid) {
    const S = this.store, geo = this.storeGeo;
    if (!S.door && dist(p, this.doorGrab(geo, S.v)) < 85) {
      if (this.freeHands() < 1) { this.storeSay(this.heldNow().two ? 'Both your hands are full – no hand free for the door' : 'No hand free for the door'); this.hooks.sfx('clunk', 0.4); return; }
      S.door = { pid }; this.hooks.sfx('door'); return;
    }
    if (S.v < 0.55) { this.reportStore(); return; }
    // the second hand on a heavy pot: up it comes
    if (S.lift && S.lift.pid !== pid && dist(p, S.lift.at) < 150) {
      const L = S.lift, a = this.ptrOf(L.pid) || L.p;
      const mid = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 };
      S.drag = { key: L.key, from: L.from, pos: mid, dx: L.at.x - mid.x, dy: L.at.y - mid.y, s: L.s, two: true, pids: [L.pid, pid] };
      S.lift = null;
      this.hooks.sfx('grab');
      this.reportStore();
      return;
    }
    if (S.drag || S.lift) return;
    // something on a shelf
    for (const [k, at] of this.storeLayout()) {
      if (at.fixed) continue;
      if (p.x > at.x - at.w / 2 - 10 && p.x < at.x + at.w / 2 + 10 && p.y > at.y - at.h - 10 && p.y < at.y + 12) {
        const heavy = this.heavyKey(k);
        if (this.freeHands() < (heavy ? 2 : 1)) {
          this.storeSay(heavy ? 'That takes both hands – put down what you hold, or let go of the door (it stays open)' : 'No hand free – let go of the door (it stays open)');
          this.hooks.sfx('clunk', 0.4);
          return;
        }
        if (heavy && this.touchy) {
          S.lift = { key: k, from: 'shelf', pid, at: { x: at.x, y: at.y - at.h / 2 }, p: { ...p }, s: at.s };
          this.storeSay('It\'s heavy – a second finger on it, to lift it with both hands');
          this.hooks.sfx('grab', 0.4);
          return;
        }
        S.drag = { key: k, from: 'shelf', pos: { ...p }, dx: at.x - p.x, dy: at.y - p.y, s: at.s, pid, two: heavy };
        this.hooks.sfx('grab');
        return;
      }
    }
    // something in my hands (to put back)
    for (const h of this.handSpots(this.heldHere())) {
      if (dist(p, { x: h.x, y: h.y - 30 }) < (h.two ? 110 : 65)) { S.drag = { key: h.k, from: 'hands', pos: { ...p }, dx: h.x - p.x, dy: h.y - p.y, s: h.s, pid }; this.hooks.sfx('grab'); return; }
    }
  }
  ptrOf(pid) { return this.ptr.id === pid ? this.ptr : this.ptr2 && this.ptr2.id === pid ? this.ptr2 : null; }
  storeMove(p, pid) {
    const S = this.store;
    if (S.door && S.door.pid === pid) {
      S.v = this.doorOpenAt(this.storeGeo, p);
      const now = performance.now();
      if (now - S.sent > 100) { S.sent = now; this.hooks.store({ t: 'door', fx: this.c.f.id, v: S.v }); }
    } else if (S.drag && S.drag.pids && S.drag.pids.includes(pid)) {
      // both hands on it: it goes where they go
      const a = this.ptrOf(S.drag.pids[0]), b = this.ptrOf(S.drag.pids[1]);
      if (a && b) S.drag.pos = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (S.drag && S.drag.pid === pid) S.drag.pos = { ...p };
  }
  storeUp(p, pid) {
    const S = this.store, fx = this.c.f.id;
    if (S.lift && S.lift.pid === pid) { S.lift = null; this.reportStore(); return; }
    if (S.door && S.door.pid === pid) {
      S.door = false;
      S.v = S.v >= 0.5 ? 1 : 0;
      this.hooks.store({ t: 'door', fx, v: S.v, done: true });
      this.hooks.sfx(S.v ? 'door' : 'clunk');
      if (!S.v) S.shut = performance.now() + 500; // shut: done here
      this.reportStore();
      return;
    }
    const d = S.drag;
    if (!d || !(d.pid === pid || (d.pids && d.pids.includes(pid)))) return;
    S.drag = null;
    const base = { x: d.pos.x + d.dx, y: d.pos.y + d.dy }; // where it would stand
    if (d.from === 'shelf' && !this.insideStore(base)) {
      // pulled out: it's in my hand
      this.hooks.store({ t: 'take', what: d.key, fx });
      S.pend.set(d.key, { to: 'held', t: performance.now() });
      this.hooks.sfx('pop');
    } else if (this.insideStore(base)) {
      // onto a shelf, just where I let go: put back, or moved about
      const spot = this.spotAt(base);
      this.hooks.store({ t: d.from === 'hands' ? 'put' : 'arrange', what: d.key, fx, r: spot.r, x: spot.x });
      S.pend.set(d.key, { to: 'stored', spot, t: performance.now() });
      this.hooks.sfx('clunk');
    }
    this.reportStore();
  }
  // my free hand(s): on the door, at each finger, round what they pull out
  storeCursor(ctx) {
    const S = this.store;
    const look = this.c.look || { skin: '#eab88a', shirt: '#3a5a9a' };
    const pts = [];
    if (S.door) pts.push({ x: this.doorGrab(this.storeGeo, S.v).x, y: this.doorGrab(this.storeGeo, S.v).y, grip: true });
    for (const q of [this.ptr, this.ptr2]) {
      if (!q || !(q === this.ptr ? q.seen : q.down)) continue;
      if (S.door && S.door.pid === q.id) continue;
      if (q === this.ptr && !q.down && this.touchy) continue; // (a lifted finger isn't a hand in view)
      pts.push({ x: q.x, y: q.y, grip: !!(S.drag || S.lift || q.down) });
    }
    const free = this.heldNow().two ? 0 : this.heldShown().length ? 1 : 2;
    const draggingHeld = S.drag && S.drag.from === 'hands';
    if (!free && !draggingHeld) return; // no hand free: both are round the pot
    pts.sort((a, b) => a.x - b.x);
    const shown = pts.slice(0, Math.max(1, free));
    shown.forEach((q, i) => {
      const side = shown.length === 2 ? (i === 0 ? -1 : 1) : this.heldShown().length ? -this.holdSide() : 1;
      this.drawArm(ctx, look, { x: 500 + side * 300, y: SH + 90 }, { x: q.x - side * 14, y: q.y + 40 });
      this.drawHand(ctx, look, q.x, q.y, q.grip ? 'fist' : 'open', 0, side < 0);
    });
  }

  sceneBin(ctx) {
    const f = this.c.f;
    const holds = { binS: 8, binM: 14, binL: 24 }[f.type] || 10;
    const bin = (this.c.C.bins && this.c.C.bins[f.id]) || { fill: 0 };
    const g = this.g;
    const def = this.c.def;
    // floor tiles: we look down at the bin standing on the floor
    ctx.fillStyle = this.c.pal.floorA; ctx.fillRect(0, 146, SW, SH - 146);
    ctx.fillStyle = this.c.pal.floorB;
    for (let y = 146; y < SH; y += 90) for (let x = ((y / 90) % 2) * 90; x < SW; x += 180) ctx.fillRect(x, y, 90, 90);
    const col = { binS: '#c9ccd2', binM: '#3f8a4a', binL: '#2f6fae' }[f.type] || '#c9ccd2';
    const W = f.type === 'binL' ? 330 : f.type === 'binM' ? 280 : 240;
    const cx = 500, top = 250, bot = 590;
    // body
    ctx.fillStyle = col; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(cx - W / 2, top); ctx.lineTo(cx - W / 2 + 26, bot); ctx.quadraticCurveTo(cx, bot + 24, cx + W / 2 - 26, bot); ctx.lineTo(cx + W / 2, top); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.roundRect(cx - W / 2 + 26, top + 30, 26, bot - top - 70, 13); ctx.fill();
    // pedal
    ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.roundRect(cx - 50, bot - 8, 100, 26, 10); ctx.fill(); ctx.stroke();
    // the opening with the bag & trash inside
    const lidOpen = (def.do === 'toss' && this.ph >= 1) || def.do === 'bag';
    const fillF = Math.min(1, (bin.fill + (def.do === 'toss' && this.done ? 0 : 0)) / holds);
    ctx.fillStyle = '#2a2a32'; ctx.beginPath(); ctx.ellipse(cx, top, W / 2, 44, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const bagGone = def.do === 'bag' && this.ph >= 2;
    const newBag = def.do === 'bag' && this.ph >= 3;
    if (!bagGone || newBag) {
      // the bag lining folded over the rim
      ctx.strokeStyle = newBag ? '#9ad08a' : '#5a5a66'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(cx, top, W / 2 - 4, 40, 0, 0, TAU); ctx.stroke();
    }
    if (!bagGone) {
      // the rubbish, piling up to the top as it fills
      const lvl = fillF;
      ctx.save(); ctx.beginPath(); ctx.ellipse(cx, top, W / 2 - 10, 36, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = '#1a1a20'; ctx.fillRect(cx - W / 2, top - 40, W, 80);
      for (let i = 0; i < Math.round(lvl * 30); i++) {
        const kinds = ['onion', 'egg', 'potato', 'carrot', 'tomato', 'parsley'];
        this.drawScrap(ctx, kinds[i % kinds.length], cx - W / 2 + 30 + ((i * 53) % (W - 60)), top + 30 - lvl * 50 + ((i * 29) % 40) - 20, i);
      }
      ctx.restore();
      if (def.do === 'bag' && this.ph >= 1) {
        // knotted bag top
        ctx.fillStyle = '#5a5a66'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(cx - 60, top + 10); ctx.quadraticCurveTo(cx, top - 120, cx + 60, top + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx - 18, top - 96, 22, 12, -0.6, 0, TAU); ctx.ellipse(cx + 18, top - 96, 22, 12, 0.6, 0, TAU); ctx.fill(); ctx.stroke();
      } else if (def.do === 'bag' && g && g.kind === 'circle') {
        const tw = Math.abs(g.acc || 0);
        ctx.strokeStyle = '#7a7a86'; ctx.lineWidth = 5;
        for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + tw; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (W / 2 - 20), top + Math.sin(a) * 30); ctx.quadraticCurveTo(cx, top - 30, cx + Math.cos(a + 1) * 10, top - 60 - tw * 8); ctx.stroke(); }
      }
    }
    if (fillF >= 1 && def.do !== 'bag') {
      // flies & stink: it's full!
      ctx.strokeStyle = 'rgba(120,150,60,0.6)'; ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) { const x = cx - 60 + i * 60; ctx.beginPath(); ctx.moveTo(x, top - 50); ctx.bezierCurveTo(x + 15, top - 80, x - 15, top - 100, x, top - 130 - Math.sin(this.t * 3 + i) * 6); ctx.stroke(); }
    }
    // the lid: hinged at the back, up when the pedal is down
    ctx.fillStyle = shade(col, 0.1); ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    if (lidOpen) {
      ctx.beginPath(); ctx.ellipse(cx, top - 70, W / 2, 26, 0, Math.PI, TAU); ctx.lineTo(cx + W / 2, top - 30); ctx.lineTo(cx - W / 2, top - 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(cx, top - 4, W / 2 + 6, 48, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(cx - 40, top - 18, 60, 12, -0.1, 0, TAU); ctx.fill();
    }
    // fill gauge
    ctx.fillStyle = 'rgba(255,248,236,0.92)'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(cx + W / 2 + 40, 300, 34, 220, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = fillF >= 1 ? '#e8573a' : fillF > 0.7 ? '#e8a51a' : '#3faa5a';
    const gh = 212 * fillF; ctx.beginPath(); ctx.roundRect(cx + W / 2 + 44, 516 - gh, 26, gh, 10); ctx.fill();
    ctx.fillStyle = OUTLINE; ctx.font = '700 18px Fredoka, system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${bin.fill}/${holds}`, cx + W / 2 + 57, 290); ctx.textAlign = 'start';
    // the back door, where full bags go
    if (def.do === 'bag') {
      ctx.fillStyle = '#a8784a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(830, 150, 150, 260, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(850, 290, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e6f4fb'; ctx.beginPath(); ctx.roundRect(855, 175, 100, 70, 8); ctx.fill(); ctx.stroke();
      for (let i = 0; i < Math.min(3, this.c.C.bagsOut || 0); i++) this.drawBag(ctx, 860 + i * 40, 400, 0.6);
      if (this.ph < 2) { /* new bag roll waits on the side */ }
      if (this.ph <= 2 && !(g && g.kind === 'drag' && g.source && g.source.type === 'newBag' && g.drag)) this.drawBagRoll(ctx, SIDE.x, SIDE.y);
    }
    this.drawSource(ctx);
  }

  drawBag(ctx, x, y, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#4a4a56'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-60, 0); ctx.quadraticCurveTo(-80, -100, -20, -130); ctx.lineTo(20, -130); ctx.quadraticCurveTo(80, -100, 60, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-14, -146, 18, 10, -0.6, 0, TAU); ctx.ellipse(14, -146, 18, 10, 0.6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-30, -70, 10, 34, 0.2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawBagRoll(ctx, x, y) {
    ctx.fillStyle = '#9ad08a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(x - 70, y - 60, 140, 60, 28); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,80,30,0.4)'; ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 22, y - 56); ctx.lineTo(x + i * 22, y - 4); ctx.stroke(); }
    ctx.fillStyle = OUTLINE; ctx.font = '700 15px Fredoka, system-ui'; ctx.textAlign = 'center'; ctx.fillText('bags', x, y + 22); ctx.textAlign = 'start';
  }

  drawDoughWithPaint(ctx, it) {
    const g = this.g;
    drawIngredient(ctx, it.kind, { ...it, sauce: g && g.kind === 'paint' ? null : it.sauce, coverage: g && g.kind === 'paint' ? 0 : it.coverage }, MAIN.x, MAIN.y, 1.6, this.t);
    if (g && g.kind === 'paint') {
      const R = this.surfaceRect();
      ctx.save();
      ctx.beginPath();
      if (this.surfaceRound()) ctx.ellipse(R.x + R.w / 2, R.y + R.h / 2, R.w / 2 * 0.93, R.h / 2 * 0.93, 0, 0, TAU);
      else ctx.rect(R.x + R.w * 0.04, R.y + R.h * 0.1, R.w * 0.92, R.h * 0.8);
      ctx.clip();
      ctx.drawImage(this.paint, R.x, R.y, R.w, R.h);
      ctx.restore();
    }
  }

  sceneSink(ctx) {
    const s = this.c.def;
    const fxs = (this.c.C.fx[this.c.f.id]) || {};
    const g = this.g;
    // basin
    ctx.fillStyle = '#c9d2d8'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(240, 350, 520, 250, 30); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9aa8b2'; ctx.beginPath(); ctx.roundRect(268, 372, 464, 214, 22); ctx.fill();
    ctx.fillStyle = '#7a8892'; ctx.beginPath(); ctx.ellipse(500, 560, 18, 8, 0, 0, TAU); ctx.fill();
    // tap
    let tapOn = !!fxs.tap;
    if (g && g.kind === 'tap' && g.ph.hot === 'faucet') tapOn = !!fxs.tap;
    if (g && g.kind === 'fill') tapOn = !!g.pouring;
    if (g && g.kind === 'strokes' && s.do === 'wash') tapOn = true;
    if (g && g.kind === 'circle' && (s.do === 'rinse' || s.do === 'scrub')) tapOn = true;
    ctx.fillStyle = '#c9ccd2'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(478, 200, 44, 60, 10); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 22; ctx.strokeStyle = OUTLINE; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(500, 215); ctx.quadraticCurveTo(500, 150, 440, 160); ctx.lineTo(440, 200); ctx.stroke();
    ctx.lineWidth = 15; ctx.strokeStyle = '#c9ccd2';
    ctx.beginPath(); ctx.moveTo(500, 215); ctx.quadraticCurveTo(500, 150, 440, 160); ctx.lineTo(440, 200); ctx.stroke();
    ctx.lineCap = 'butt';
    // lever (turns when on)
    ctx.save(); ctx.translate(512, 212); ctx.rotate(tapOn ? -0.55 : 0);
    ctx.fillStyle = '#e8573a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(-6, -11, 110, 22, 11); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9ccd2'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
    // water
    if (tapOn) {
      ctx.fillStyle = 'rgba(150,205,245,0.75)';
      const wob = Math.sin(this.t * 30) * 2;
      ctx.beginPath(); ctx.roundRect(430 + wob, 200, 20, 360, 10); ctx.fill();
      if (Math.random() < 0.6) this.fx.push({ kind: 'drop', x: 440 + (Math.random() - 0.5) * 60, y: 540, vx: (Math.random() - 0.5) * 200, vy: -150 - Math.random() * 100, life: 0, max: 0.5, col: 'rgba(160,210,250,0.9)' });
      if (Math.random() < 0.25) this.hooks.sfx('water', 0.35);
    }
    // colander for draining
    if (s.do === 'drain') {
      ctx.fillStyle = '#e0e4ea'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(500, 520, 130, 40, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(370, 520); ctx.quadraticCurveTo(380, 590, 500, 595); ctx.quadraticCurveTo(620, 590, 630, 520); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9aa0aa';
      for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.arc(400 + (i % 6) * 40, 545 + Math.floor(i / 6) * 16, 3, 0, TAU); ctx.fill(); }
    }
    // washing up: the dirty pot / pan in the basin – grimy, then sudsy, then clean – and the dish soap
    if (s.do === 'scrub') {
      const vid = g && g.subject && g.subject.type === 'vessel' ? g.subject.id : this.c.st && this.c.st.vid;
      if (vid && this.D.vessels[vid]) this.drawMainVessel(ctx, vid, 470, 575, 1.0);
      const { dirt, suds } = this.washLook();
      this.drawDirt(ctx, 470, 520, 120, 40, dirt, suds);
      this.drawSoap(ctx, g && g.kind === 'tap' && g.ph.hot === 'soap' && this.ptr.down);
    }
    // the thing under the tap
    const it = this.subjectItem();
    if (g && g.subject && g.subject.type === 'item' && it) {
      const s2 = this.itemScale(it.kind) * 0.85;
      const shake = g.kind === 'strokes' && this.ptr.down ? (this.ptr.x - 500) * 0.15 : 0;
      // washing: in its container in the basin – the tap fills it, and it's tipped out at the end
      const tub = s.do === 'wash';
      const tilt = tub && g.kind === 'pour' ? (g.pouring ? 0.9 : 0.15) : 0;
      const water = !tub || this.ph === 0 ? 0 : g.kind === 'pour' ? 0.7 * (1 - Math.min(1, g.v || 0)) : 0.7;
      if (tub) { ctx.save(); ctx.translate(440, 575); ctx.rotate(-tilt); this.drawTub(ctx, 230, 120, water, 'back'); ctx.translate(0, -55); }
      drawIngredient(ctx, it.kind, it, (tub ? 0 : 440) + shake, tub ? 0 : 520, s2, this.t);
      if (tub) {
        ctx.translate(0, 55); this.drawTub(ctx, 230, 120, water, 'front'); ctx.restore();
        if (g.kind === 'pour' && g.pouring && water > 0.03) {
          const lx = 440 - Math.cos(tilt) * 115 - Math.sin(tilt) * 120, ly = 575 + Math.sin(tilt) * 115 - Math.cos(tilt) * 120;
          ctx.strokeStyle = 'rgba(150,205,245,0.85)'; ctx.lineWidth = 12 + Math.sin(this.t * 20) * 2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(lx, ly); ctx.quadraticCurveTo(lx - 30, ly + 40, 330, 585); ctx.stroke(); ctx.lineCap = 'butt';
        }
      }
      if (tapOn && it.washed) this.fx.length < 120 && Math.random() < 0.2 && this.bubbles(440, 450);
    }
    if (s.do === 'fill' || s.do === 'drain') this.drawSource(ctx);
    if (s.do === 'fill' && this.ph >= 1) {
      this.drawMainVessel(ctx, s.vessel, 440, 590, 1.2);
      this.drawBandOnVessel(ctx);
    }
    if (s.do === 'drain' && this.ph >= 1) this.drawPourer(ctx, true);
  }

  sceneHob(ctx) {
    const s = this.c.def;
    const g = this.g;
    // the burner
    ctx.fillStyle = '#22222a'; ctx.strokeStyle = '#55555e'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(MAIN.x, MAIN.y + 10, 210, 62, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(MAIN.x, MAIN.y + 10, 140, 40, 0, 0, TAU); ctx.stroke();
    const vId = s.vessel || s.into;
    const v = this.D.vessels[vId];
    let heat = v ? v.heat || 0 : s.do === 'knob' && !this.done ? this.litLevel() : 0;
    if (g && g.kind === 'knob') heat = g.level;
    const onBurner = v && (v.at && v.at.fx === this.c.f.id) || (g && g.kind === 'drag' && g.ph.to === 'burner' && !g.drag && this.k > 0);
    if (heat > 0) this.drawFlames(ctx, MAIN.x, MAIN.y + 10, heat);
    // the knob
    this.drawKnob(ctx, g && g.kind === 'knob' ? g.ang : levelAngle(heat), g && g.kind === 'knob');
    // the pot (unless it's being dragged on from the side)
    const dragging = g && g.kind === 'drag' && g.source && g.source.type === 'vessel';
    if (v && !dragging && (onBurner || s.do !== 'heat')) {
      const flickY = g && g.kind === 'flick' && g.toss ? -Math.sin(Math.min(1, g.toss) * Math.PI) * 60 : 0;
      this.drawMainVessel(ctx, vId, MAIN.x, MAIN.y + 4 + flickY * 0.3, this.vesselScale(v.kind) * 1.3, flickY);
    }
    if (g && g.kind === 'flick' && g.toss) { g.toss = Math.max(0, g.toss - 0.04); if (g.toss < 0.02) g.toss = 0; }
    this.drawSource(ctx);
    if (g && g.kind === 'pour') this.drawPourer(ctx, false);
  }

  sceneOven(ctx) {
    const s = this.c.def;
    const g = this.g;
    const v = this.D.vessels[s.vessel];
    const on = v && v.at && v.at.fx === this.c.f.id && v.heat > 0 || (g && g.kind === 'knob' && g.level > 0);
    // oven body
    ctx.fillStyle = this.c.f.type === 'aga' ? '#efe6d2' : '#e9edf2'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(210, 90, 580, 520, 24); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.roundRect(240, 110, 520, 70, 14); ctx.fill();
    // a little clock display
    ctx.fillStyle = '#7af0a0'; ctx.font = '700 28px monospace'; ctx.fillText(on ? '220°' : '-- °', 280, 156);
    // the cavity (glowing when it's on), the rack, what's in there – and the door over it
    ctx.fillStyle = '#1a1416'; ctx.beginPath(); ctx.roundRect(250, 210, 500, 360, 20); ctx.fill();
    ctx.fillStyle = `rgba(255,140,60,${on ? 0.45 : 0.15})`; ctx.fillRect(270, 230, 460, 320);
    ctx.strokeStyle = '#9aa0aa'; ctx.lineWidth = 6;
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(290 + i * 52, 430); ctx.lineTo(290 + i * 52, 470); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(270, 450); ctx.lineTo(730, 450); ctx.stroke();
    if (v && v.at && v.at.fx === this.c.f.id && !(g && g.kind === 'drag' && g.drag)) this.drawVesselAt(ctx, s.vessel, 500, 455, 1.05);
    this.drawDoor(ctx, this.doorGeo('oven'), this.doorOpen(), { glow: on });
    this.drawKnob(ctx, g && g.kind === 'knob' ? g.ang : levelAngle(v && v.at && v.at.fx === this.c.f.id ? v.heat : 0), g && g.kind === 'knob', OVEN_KNOB);
    this.drawSource(ctx);
  }

  sceneDome(ctx) {
    const s = this.c.def;
    const stone = this.c.f.type === 'stoneOven';
    ctx.fillStyle = stone ? '#e9e2d6' : '#d8845a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(520, 470, 380, 360, 0, Math.PI, TAU); ctx.lineTo(900, 600); ctx.lineTo(140, 600); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = stone ? 'rgba(47,111,174,0.5)' : 'rgba(90,40,20,0.3)'; ctx.lineWidth = 3;
    for (let r = 1; r < 5; r++) { ctx.beginPath(); ctx.ellipse(520, 470, 380 - r * 60, 360 - r * 60, 0, Math.PI, TAU); ctx.stroke(); }
    // mouth
    ctx.fillStyle = '#1a0e0a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(520, 480, 190, 170, 0, Math.PI, TAU); ctx.lineTo(710, 540); ctx.lineTo(330, 540); ctx.closePath(); ctx.fill(); ctx.stroke();
    // the fire at the back
    for (let i = 0; i < 9; i++) {
      const x = 400 + i * 30, h = 70 + Math.sin(this.t * 9 + i * 1.3) * 25 + (i % 3) * 15;
      ctx.fillStyle = i % 2 ? '#ffb627' : '#ff6a1a';
      ctx.beginPath(); ctx.ellipse(x, 470 - h / 2, 16, h / 2, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,150,50,0.18)'; ctx.fillRect(330, 300, 380, 240);
    // the floor of the oven
    ctx.fillStyle = '#5a3a2a'; ctx.fillRect(330, 510, 380, 30);
    const v = this.D.vessels[s.vessel];
    const g = this.g;
    // in a wood-fired oven the pizza sits right on the hot floor
    if (v && v.at && v.at.fx === this.c.f.id && !(g && g.kind === 'drag' && g.drag)) for (const it of this.vesselView(v).items) drawIngredient(ctx, it.kind, it.st, 520, 528, 0.75, this.t);
    this.drawSource(ctx);
  }

  // the wooden peel with whatever's on the tray laid on it
  drawOnPeel(ctx, vid, x, y, s) {
    drawTool(ctx, 'pizzaPeel', x, y, s, 0, false);
    const v = this.D.vessels[vid];
    if (!v) return;
    for (const it of this.vesselView(v).items) drawIngredient(ctx, it.kind, it.st, x, y + 18 * s, 0.62 * s, this.t);
  }

  sceneTandoor(ctx) {
    const s = this.c.def;
    ctx.fillStyle = '#c8784a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(500, 360, 300, 230, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a1a10'; ctx.beginPath(); ctx.ellipse(500, 360, 220, 165, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const glow = ctx.createRadialGradient(500, 380, 10, 500, 380, 160);
    glow.addColorStop(0, `rgba(255,${140 + Math.sin(this.t * 5) * 30},40,0.95)`); glow.addColorStop(1, 'rgba(120,30,10,0.0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(500, 380, 160, 115, 0, 0, TAU); ctx.fill();
    for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 2 ? '#ff7a1a' : '#ffb627'; ctx.beginPath(); ctx.arc(420 + (i * 37) % 170, 380 + Math.sin(i * 2.3) * 40, 8 + (i % 3) * 3, 0, TAU); ctx.fill(); }
    const v = this.D.vessels[s.vessel];
    const g = this.g;
    if (v && v.at && v.at.fx === this.c.f.id && !(g && g.kind === 'drag' && g.drag)) this.drawVesselAt(ctx, s.vessel, 500, 300, 0.7);
    this.drawSource(ctx);
  }

  sceneFridge(ctx) {
    const s = this.c.def;
    const g = this.g;
    ctx.fillStyle = '#f4f1ea'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(300, 40, 420, 570, 30); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8f4fb'; ctx.beginPath(); ctx.roundRect(320, 60, 380, 530, 20); ctx.fill();
    ctx.strokeStyle = '#c9d8e2'; ctx.lineWidth = 6;
    for (const y of [200, 330, 460]) { ctx.beginPath(); ctx.moveTo(330, y); ctx.lineTo(690, y); ctx.stroke(); }
    const v = this.D.vessels[s.vessel];
    if (v && v.at && v.at.fx === this.c.f.id && !(g && g.kind === 'drag' && g.drag)) this.drawVesselAt(ctx, s.vessel, 500, 320, 0.8);
    this.drawDoor(ctx, this.doorGeo('fridge'), this.doorOpen());
    this.drawSource(ctx);
  }


  scenePlate(ctx) {
    const s = this.c.def;
    const g = this.g;
    // wooden table
    ctx.fillStyle = '#c8925a'; ctx.fillRect(0, 306, SW, SH - 306);
    ctx.strokeStyle = 'rgba(90,50,20,0.25)'; ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, 340 + i * 60); ctx.lineTo(SW, 340 + i * 60); ctx.stroke(); }
    const into = s.into || 'plates';
    const pv = this.D.vessels[into];
    if (g && g.kind === 'scoop') {
      // the source on the left, the plates in a row
      const src = this.D.vessels[s.from];
      if (src) drawVessel(ctx, src.kind, this.vesselView(src), 200, 470, 0.95, this.t);
      const tgs = this.scoopTargets();
      tgs.forEach((t, i) => {
        if (s.do === 'stuff') return;
        const filled = i < this.k;
        drawVessel(ctx, pv ? pv.kind : 'plate', { ...(pv ? this.vesselView(pv) : {}), water: filled ? 0.5 : 0, liquid: filled ? this.scoopColor() : null, contents: filled ? (src ? src.contents : []) : [] }, t.x, t.y + 40, 0.7, this.t);
        if (!filled && i === this.k) this.ghostRing(ctx, t.x, t.y, 70);
      });
      if (s.do === 'stuff') {
        const it = this.D.items[s.item];
        if (it) drawIngredient(ctx, it.kind, { ...it, stuffed: this.k }, 560, 520, 1.3, this.t);
        tgs.forEach((t, i) => { if (i === this.k) this.ghostRing(ctx, t.x, t.y, 70); });
      }
    } else if (pv) {
      this.drawMainVessel(ctx, into, MAIN.x, MAIN.y + 20, this.vesselScale(pv.kind) * 1.1);
    }
    if (s.do === 'serve') {
      // the dish, and the bell
      ctx.fillStyle = '#c9a24a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(BELL.x, BELL.y + 30, 60, 14, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8c45a';
      ctx.beginPath(); ctx.moveTo(BELL.x - 50, BELL.y + 26); ctx.quadraticCurveTo(BELL.x - 50, BELL.y - 50, BELL.x, BELL.y - 50); ctx.quadraticCurveTo(BELL.x + 50, BELL.y - 50, BELL.x + 50, BELL.y + 26); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.ellipse(BELL.x - 18, BELL.y - 20, 8, 14, -0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(BELL.x, BELL.y - 56, 9, 0, TAU); ctx.fill(); ctx.stroke();
    }
    this.drawSource(ctx);
  }

  // ------------------------------------------------------------------ scene parts

  vesselScale(kind) {
    return { pot: 1.25, bigPot: 1.1, copperPot: 1.25, cocotte: 1.1, saucepan: 1.3, pan: 1.35, paellaPan: 1.05, bowl: 1.4, tray: 1.1, bakingDish: 1.15, peel: 1.1, caydanlik: 1.2, cezve: 1.6, kettle: 1.3, plate: 1.4, glass: 1.5, cup: 1.5, blender: 1.2, skewer: 1.2, colander: 1.2 }[kind] || 1.2;
  }

  vesselView(v) {
    const D = this.D;
    const items = (v.items || []).map((i) => ({ kind: D.items[i.id] ? D.items[i.id].kind : 'dough', st: D.items[i.id] || {}, x: i.x, y: i.y }));
    return { ...v, items, foam: v.kind === 'cezve' ? v.boil : 0 };
  }

  drawMainVessel(ctx, id, x, y, s, lift = 0) {
    const v = this.D.vessels[id];
    if (!v) return;
    const vs = this.vesselView(v);
    // items placed by "top"/"garnish" on plates show their pieces
    const g = this.g;
    this.geo = drawVessel(ctx, v.kind, vs, x, y + lift, s, this.t) || { mouthX: x, mouthY: y - 100 * s, mouthRx: 90 * s, mouthRy: 30 * s, bottomY: y, top: y - 160 * s };
    if (g && g.kind === 'place' && this.c.def.do === 'garnish') {
      const st = this.c.C.steps[this.sid];
      for (const p of st.extra || []) this.drawPiece(ctx, g.ph.piece, this.geo.mouthX + p.x * this.geo.mouthRx * 0.85, this.geo.mouthY + p.y * this.geo.mouthRy * 0.85);
    }
  }

  drawVesselAt(ctx, id, x, y, s) {
    const v = this.D.vessels[id];
    if (!v) return;
    drawVessel(ctx, v.kind, this.vesselView(v), x, y, s, this.t);
  }

  drawPiece(ctx, kind, x, y) {
    if (!kind) return;
    drawPieces(ctx, kind, INGREDIENTS[kind] && INGREDIENTS[kind].art.type === 'herb' ? 'torn' : 'slices', 1, x, y + 8, 0.45, (x * 7 + y) | 0);
  }

  // the thing being brought in (ingredient / pot / lid / jug), at the side or in hand
  drawSource(ctx) {
    const g = this.g;
    if (!g || this.done) return;
    const D = this.D;
    if (g.kind === 'drag' || g.kind === 'dip') {
      const p = g.pos;
      if (!p) return;
      const src = g.source;
      if (!src) return;
      if (g.kind === 'drag' && this.k > 0) return;
      if (src.type === 'newBox') {
        ctx.save(); ctx.translate(p.x, p.y + 50); ctx.scale(0.75, 0.75); this.drawTub(ctx, 230, 120, 0, 'back'); this.drawTub(ctx, 230, 120, 0, 'front'); ctx.restore();
      } else if (src.type === 'item' && src.oneOver) {
        const it = D.items[src.id];
        if (it) drawIngredient(ctx, it.kind, { ...it, qty: 1, extra: 0 }, p.x, p.y, Math.min(1.1, this.itemScale(it.kind) * 0.7), this.t);
      } else if (src.type === 'item' && src.unit) {
        // (the one just done, pushed along the board to the pile)
        const U = boardUnits(D.items[src.id]), c = U && U.cur;
        if (c && c.cut && (c.k || 0) >= (c.n || 0)) drawPieces(ctx, c.kind, c.cut, Math.max(2, Math.round(8 / U.q)), p.x, p.y, 0.8, 3);
        else if (c) drawIngredient(ctx, c.kind, c, p.x, p.y, this.itemScale(c.kind), this.t);
      } else if (src.type === 'item' && g.ph.tip) {
        // (in its container)
        const it = D.items[src.id];
        ctx.save(); ctx.translate(p.x, p.y + 50); ctx.scale(0.6, 0.6); this.drawTub(ctx, 230, 120, 0, 'back');
        if (it) this.drawFoodIn(ctx, it, 0, -14, 1.1);
        this.drawTub(ctx, 230, 120, 0, 'front'); ctx.restore();
      } else if (src.type === 'item') {
        const it = D.items[src.id];
        if (it) {
          const cut = it.cut && (it.k || 0) >= (it.n || 0);
          if (cut) drawPieces(ctx, it.kind, it.cut, 8, p.x, p.y, 0.9, 3);
          else drawIngredient(ctx, it.kind, src.fromBox ? { ...it, qty: 1, extra: 0 } : it, p.x, p.y, Math.min(1.1, this.itemScale(it.kind) * 0.7), this.t); // (out of its container: one at a time)
          if (g.kind === 'dip') drawTool(ctx, 'tongs', p.x + 30, p.y - 60, 0.7, -0.4, !!g.drag);
          if (g.kind === 'dip' && g.inside) this.holdRing(ctx, p.x, p.y - 140, g.hold / (g.ph.hold || 1.6));
        }
      } else if (src.type === 'vessel') {
        const v = D.vessels[src.id];
        if (g.ph.tool === 'pizzaPeel') this.drawOnPeel(ctx, src.id, p.x, p.y, 1);
        else if (v && this.sceneKind() === 'tandoor') for (const it of this.vesselView(v).items) drawIngredient(ctx, it.kind, it.st, p.x, p.y, 0.7, this.t); // slapped on by hand
        else if (v) drawVessel(ctx, v.kind, this.vesselView(v), p.x, p.y, this.dragScale(v.kind), this.t);
      } else if (src.type === 'lid') {
        this.drawLid(ctx, p.x, p.y, src.towel);
      } else if (src.type === 'scraps') {
        const sc = (this.c.C.carry && this.c.C.carry[this.c.me]) || (this.c.C.scraps && this.c.C.scraps[this.c.f.id]) || { kinds: [] };
        for (let i = 0; i < 8; i++) this.drawScrap(ctx, sc.kinds[i % Math.max(1, sc.kinds.length)] || 'onion', p.x + Math.cos(i * 2.4) * 34, p.y - 20 + Math.sin(i * 2.4) * 14, i);
      } else if (src.type === 'bag') {
        this.drawBag(ctx, p.x, p.y + 120, 1);
      } else if (src.type === 'newBag') {
        this.drawBagRoll(ctx, p.x, p.y);
      }
      return;
    }
    if (g.kind === 'pour' && g.ph.tip) { if (this.sceneKind() !== 'hob') this.drawPourer(ctx, false); } // (the hob draws it itself)
    else if (g.kind === 'pour' && !this.ptr.down) {
      this.drawContainer(ctx, SIDE.x, SIDE.y, 0);
    }
    if (g.kind === 'crack') {
      if (g.stage === 0) drawIngredient(ctx, 'egg', { qty: 1 }, g.egg.x, g.egg.y + 40, 0.9, this.t);
      else {
        const sp = (g.spread || 0) * 0.5;
        ctx.save(); ctx.translate(g.egg.x - sp, g.egg.y); ctx.rotate(-0.4 - sp * 0.004);
        drawIngredient(ctx, 'egg', { qty: 1 }, 0, 40, 0.9, this.t); ctx.restore();
        ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(g.egg.x - 30, g.egg.y); ctx.lineTo(g.egg.x - 10, g.egg.y + 10); ctx.lineTo(g.egg.x + 5, g.egg.y - 4); ctx.lineTo(g.egg.x + 30, g.egg.y + 6); ctx.stroke();
      }
    }
    if (g.kind === 'wrap') {
      const src = g.source && D.vessels[g.source.id];
      if (src) drawVessel(ctx, src.kind, this.vesselView(src), SIDE.x, SIDE.y, 0.8, this.t);
      if (g.stage === 0 && g.drag && g.pos) { drawTool(ctx, 'spoon', g.pos.x, g.pos.y, 0.8, 0, true); ctx.fillStyle = '#b8603a'; ctx.beginPath(); ctx.arc(g.pos.x, g.pos.y - 4, 16, 0, TAU); ctx.fill(); }
      // the leaf and its filling / folds
      ctx.save();
      ctx.translate(MAIN.x, MAIN.y - 40);
      ctx.fillStyle = '#b9dc8a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
      const fold = g.stage >= 2 ? 0.55 : 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 160 * fold, 110, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8f5d0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 100); ctx.lineTo(0, -90); for (let i = -2; i <= 2; i++) { ctx.moveTo(0, i * 30); ctx.lineTo(90 * fold * Math.sign(i || 1), i * 30 - 30); } ctx.stroke();
      if (g.stage >= 1) { ctx.fillStyle = '#b8603a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 50, 70 * fold, 22, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      // finished rolls lined up on the right
      const done = this.k;
      for (let i = 0; i < Math.min(done, 8); i++) {
        ctx.fillStyle = '#9cc96b'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(790 + (i % 2) * 70, 360 + Math.floor(i / 2) * 50, 60, 34, 17); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#e3f1c4'; ctx.beginPath(); ctx.moveTo(800 + (i % 2) * 70, 370 + Math.floor(i / 2) * 50); ctx.lineTo(840 + (i % 2) * 70, 386 + Math.floor(i / 2) * 50); ctx.stroke();
      }
    }
    if (g.kind === 'scoop' && g.drag && g.pos) {
      drawTool(ctx, g.ph.tool || 'ladle', g.pos.x, g.pos.y, 0.8, 0, true);
      ctx.fillStyle = this.scoopColor(); ctx.beginPath(); ctx.ellipse(g.pos.x, g.pos.y - 6, 22, 9, 0, 0, TAU); ctx.fill();
    }
  }

  drawLid(ctx, x, y, towel) {
    if (towel) {
      ctx.fillStyle = '#f2efe6'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 140, y + 10); ctx.quadraticCurveTo(x, y - 30, x + 140, y + 10); ctx.lineTo(x + 120, y + 60); ctx.lineTo(x - 120, y + 60); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#c0412d'; ctx.lineWidth = 4;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * 40, y - 6); ctx.lineTo(x + i * 36, y + 58); ctx.stroke(); }
    }
    ctx.fillStyle = '#c9ccd2'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(x, y, 125, 30, 0, Math.PI, TAU); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.roundRect(x - 20, y - 50, 40, 20, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(x - 50, y - 14, 30, 6, -0.1, 0, TAU); ctx.fill();
  }

  drawContainer(ctx, x, y, tilt) {
    const s = this.c.def;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    const tip = this.g && this.g.ph.tip;
    if (tip) {
      // a food's container, tipped – empty once it's slid out
      const it = this.D.items[tip];
      ctx.translate(0, 50); ctx.scale(0.6, 0.6); this.drawTub(ctx, 230, 120, 0, 'back');
      if (it && !((this.g.v || 0) > 0.55)) this.drawFoodIn(ctx, it, 0, -14, 1.1);
      this.drawTub(ctx, 230, 120, 0, 'front');
    } else if (s.from) {
      const v = this.D.vessels[s.from];
      if (v) drawVessel(ctx, v.kind, this.vesselView(v), 0, 0, this.vesselScale(v.kind) * 0.75, this.t);
    } else if (s.item) {
      const it = this.D.items[s.item];
      if (it) drawIngredient(ctx, it.kind, it, 0, 0, 1.1, this.t);
    }
    ctx.restore();
  }

  // the jug / pot tipping over the target while the button is held
  drawPourer(ctx, drain) {
    const g = this.g;
    if (!g || g.kind !== 'pour') return;
    const pouring = g.pouring;
    const tgt = drain ? { x: 500, y: 470 } : this.geo ? { x: this.geo.mouthX, y: this.geo.mouthY } : { x: MAIN.x, y: MAIN.y - 100 };
    if (g.ph.tip) {
      // a food's container, held over the rim where it was brought, tipped further the longer it's held –
      // the food sliding out and dropping in
      const T = TIP_AT, v = Math.min(1, g.v || 0);
      this.drawContainer(ctx, T.x, T.y - 50, (pouring || v > 0 ? -1.6 * v : 0) - 0.1);
      if (pouring && v > 0.15 && v < 0.85 && Math.random() < 0.5) {
        const it = this.D.items[g.ph.tip], col = it && INGREDIENTS[it.kind] ? INGREDIENTS[it.kind].art.c1 : '#e0a050';
        this.fx.push({ kind: 'drop', x: T.x - 70 + (Math.random() - 0.5) * 30, y: T.y - 10, vx: -40 + (Math.random() - 0.5) * 60, vy: 60, life: 0, max: 0.45, col });
      }
      return;
    }
    if (!pouring && !drain) return;
    const hx = tgt.x - (drain ? 60 : 150), hy = tgt.y - (drain ? 120 : 190);
    const tilt = pouring ? (drain ? 1.1 : 1.3) : drain ? 0.3 : 0;
    if (drain) {
      const v = this.D.vessels[this.c.def.vessel];
      if (v) { ctx.save(); ctx.translate(hx, hy + 90); ctx.rotate(tilt); drawVessel(ctx, v.kind, this.vesselView(v), 0, 0, 0.9, this.t); ctx.restore(); }
    } else this.drawContainer(ctx, hx, hy, tilt);
    if (pouring) {
      const col = drain ? 'rgba(150,205,245,0.85)' : this.pourColor();
      ctx.strokeStyle = col; ctx.lineWidth = 12 + Math.sin(this.t * 20) * 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx + 60, hy + 10); ctx.quadraticCurveTo(tgt.x - 10, hy + 20, tgt.x, tgt.y); ctx.stroke();
      ctx.lineCap = 'butt';
      if (Math.random() < 0.4) this.fx.push({ kind: 'drop', x: tgt.x + (Math.random() - 0.5) * 40, y: tgt.y, vx: (Math.random() - 0.5) * 120, vy: -80, life: 0, max: 0.4, col });
    }
  }

  // a food in its container (cut up: its pieces)
  drawFoodIn(ctx, it, x, y, s) {
    if (it.cut && (it.k || 0) >= (it.n || 0)) drawPieces(ctx, it.kind, it.cut, 7, x, y, 0.8 * s, 3);
    else drawIngredient(ctx, it.kind, it, x, y, Math.min(1.1, this.itemScale(it.kind) * 0.7) * s, this.t);
  }

  // A see-through food container, its bottom middle at (0, 0): 'back' (the inside),
  // 'front' (the water in it, the near wall and its outline)
  drawTub(ctx, w, h, water, part) {
    const wb = w * 0.86;
    const shape = (top, wt) => { ctx.beginPath(); ctx.moveTo(-wt / 2, top); ctx.lineTo(wt / 2, top); ctx.lineTo(wb / 2, 0); ctx.lineTo(-wb / 2, 0); ctx.closePath(); };
    if (part === 'back') { shape(-h, w); ctx.fillStyle = 'rgba(214,236,242,0.4)'; ctx.fill(); return; }
    if (water > 0.02) { shape(-h * water, wb + (w - wb) * water); ctx.fillStyle = 'rgba(150,205,245,0.5)'; ctx.fill(); }
    shape(-h, w);
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-w / 2 + 14, -h + 10); ctx.lineTo(-wb / 2 + 12, -10); ctx.stroke();
  }

  // The dishwasher, from the front: its door (shut – it's loaded), the control strip and start
  sceneDishwasher(ctx) {
    const g = this.g;
    const on = !!(g && g.kind === 'tap' && this.k > 0);
    ctx.fillStyle = '#d8a868'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(160, 150, 680, 30, 8); ctx.fill(); ctx.stroke(); // the worktop over it
    ctx.fillStyle = '#c9ccd2'; ctx.beginPath(); ctx.roundRect(200, 180, 600, 420, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e4e7ec'; ctx.beginPath(); ctx.roundRect(214, 192, 572, 48, 10); ctx.fill();
    ctx.fillStyle = '#9aa0aa'; ctx.beginPath(); ctx.roundRect(300, 262, 400, 16, 8); ctx.fill(); ctx.stroke(); // the handle
    // lights and the start button
    for (let i = 0; i < 4; i++) { ctx.fillStyle = on && i === 0 ? '#5ad86a' : '#7a808a'; ctx.beginPath(); ctx.arc(260 + i * 34, 216, 7, 0, TAU); ctx.fill(); }
    ctx.fillStyle = on ? '#5ad86a' : '#3a7ac0'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(DW_BTN.x, DW_BTN.y, 18, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(DW_BTN.x - 5, DW_BTN.y - 8); ctx.lineTo(DW_BTN.x + 8, DW_BTN.y); ctx.lineTo(DW_BTN.x - 5, DW_BTN.y + 8); ctx.closePath(); ctx.fill();
    // what's in it, behind the door's window
    ctx.fillStyle = 'rgba(40,60,80,0.75)'; ctx.beginPath(); ctx.roundRect(300, 320, 400, 220, 18); ctx.fill();
    const load = Object.entries(this.c.C.vessels).filter(([, v]) => v.inDw && v.at && v.at.fx === this.c.f.id);
    load.slice(0, 4).forEach(([id], i) => this.drawMainVessel(ctx, id, 380 + i * 90, 500, 0.45));
    if (on) for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(200,230,255,0.5)'; ctx.beginPath(); ctx.arc(320 + ((i * 53 + this.t * 120) % 360), 340 + ((i * 37) % 180), 4 + (i % 3) * 2, 0, TAU); ctx.fill(); }
  }

  // washing up: how grimy it still is, how sudsy (0..1) – by how far along the scrubbing and rinsing are
  washLook() {
    const P = this.c.phases || [];
    const n = (i) => (P[i] ? phaseTarget(P[i]) : 1);
    const f = (i) => (this.ph > i ? 1 : this.ph === i ? Math.min(1, this.k / n(i)) : 0);
    if (this.c.def.do === 'wipe') return { dirt: 1 - f(1) * 0.75 - f(2) * 0.25, suds: Math.max(0, f(1) - f(2)) };
    return { dirt: 1 - f(1), suds: Math.max(0, f(1) - f(3)) };
  }
  // grime and suds on what's being washed, over an ellipse (cx, cy, rx, ry)
  drawDirt(ctx, cx, cy, rx, ry, dirt, suds) {
    const rnd = (i, k) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
    for (let i = 0; i < 14; i++) {
      const x = cx + (rnd(i, 1) - 0.5) * 2 * rx * 0.8, y = cy + (rnd(i, 2) - 0.5) * 2 * ry * 0.8;
      if (dirt > 0.02) { ctx.fillStyle = `rgba(${i % 3 ? '120,70,30' : '190,60,40'},${(0.45 * dirt).toFixed(3)})`; ctx.beginPath(); ctx.ellipse(x, y, 6 + rnd(i, 3) * 12, 4 + rnd(i, 4) * 6, rnd(i, 5) * 3, 0, TAU); ctx.fill(); }
      if (suds > 0.02) { ctx.fillStyle = `rgba(255,255,255,${(0.85 * suds).toFixed(3)})`; ctx.strokeStyle = `rgba(160,200,230,${(0.6 * suds).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + 8, y - 4, 6 + rnd(i, 6) * 9, 0, TAU); ctx.fill(); ctx.stroke(); }
    }
  }
  // the dish soap bottle (pressed: a squeeze)
  drawSoap(ctx, pressed) {
    const { x, y } = SOAP;
    ctx.save(); ctx.translate(x, y); if (pressed) ctx.scale(1.06, 0.92);
    ctx.fillStyle = '#5cc86a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(-26, -40, 52, 86, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8f6ea'; ctx.beginPath(); ctx.roundRect(-18, -12, 36, 30, 6); ctx.fill();
    ctx.fillStyle = '#3a8a46'; ctx.font = '700 13px Fredoka, system-ui'; ctx.textAlign = 'center'; ctx.fillText('SOAP', 0, 8); ctx.textAlign = 'start';
    ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.roundRect(-8, -58, 16, 20, 4); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (pressed) { ctx.fillStyle = 'rgba(110,210,120,0.85)'; ctx.beginPath(); ctx.arc(x, y - 66, 7, 0, TAU); ctx.fill(); }
  }

  pourColor() {
    const s = this.c.def;
    if (s.from) { const v = this.D.vessels[s.from]; return (v && v.liquid) || '#f2d48a'; }
    return liquidColor(s.item) || '#9fd6f2';
  }

  drawBandOnVessel(ctx) {
    const g = this.g;
    if (!g || g.kind !== 'fill' || !this.geo) return;
    const [a, b] = g.ph.band;
    const top = this.geo.mouthY, bot = this.geo.bottomY - 14;
    const y = (f) => bot - (bot - top) * f;
    ctx.fillStyle = 'rgba(80,200,120,0.25)';
    ctx.fillRect(this.geo.mouthX + this.geo.mouthRx + 14, y(Math.min(1, b)), 22, y(a) - y(Math.min(1, b)));
    ctx.strokeStyle = '#3faa5a'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
    for (const f of [a, Math.min(1, b)]) { ctx.beginPath(); ctx.moveTo(this.geo.mouthX - this.geo.mouthRx, y(f)); ctx.lineTo(this.geo.mouthX + this.geo.mouthRx + 36, y(f)); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  drawFlames(ctx, x, y, heat) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const fx = x + Math.cos(a) * 140, fy = y + Math.sin(a) * 40;
      const h = 20 + heat * 16 + Math.sin(this.t * 16 + i * 2.1) * 6;
      ctx.fillStyle = 'rgba(80,140,255,0.9)';
      ctx.beginPath(); ctx.ellipse(fx, fy - h / 2, 8, h / 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,120,0.85)';
      ctx.beginPath(); ctx.ellipse(fx, fy - h * 0.7, 3.5, h * 0.22, 0, 0, TAU); ctx.fill();
    }
  }

  drawKnob(ctx, ang, active, at = KNOB) {
    ctx.save();
    ctx.translate(at.x, at.y);
    // level labels
    ctx.font = '700 17px Fredoka, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let l = 0; l <= 3; l++) {
      const a = levelAngle(l) - Math.PI / 2;
      const r = at.r + 26;
      ctx.fillStyle = l === 0 ? '#5a4a40' : ['', '#e8a51a', '#e8732a', '#d8402a'][l];
      ctx.fillText(['off', 'low', 'med', 'high'][l], Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.rotate(ang);
    ctx.fillStyle = active ? '#fff6e6' : '#f2efe6'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, at.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d9d2c4'; ctx.beginPath(); ctx.roundRect(-11, -at.r + 6, 22, at.r * 2 - 12, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8573a'; ctx.beginPath(); ctx.arc(0, -at.r + 16, 6, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  ghostRing(ctx, x, y, r) {
    ctx.strokeStyle = `rgba(255,190,40,${0.5 + 0.4 * Math.sin(this.t * 6)})`; ctx.lineWidth = 5; ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }

  holdRing(ctx, x, y, f) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(x, y, 26, 0, TAU); ctx.stroke();
    ctx.strokeStyle = f >= 1 ? '#3faa5a' : '#ffbe28';
    ctx.beginPath(); ctx.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.min(1, f) * TAU); ctx.stroke();
  }

  // ------------------------------------------------------------------ guidance

  // A ghost of the gesture to make, shown when the cook hesitates.
  drawGestureOverlay(ctx) {
    const g = this.g;
    if (!g || this.done) return;
    const show = this.idle > 1.2 && !this.ptr.down;
    const t = (this.t % 1.6) / 1.6;
    ctx.save();
    switch (g.kind) {
      case 'tap': {
        const h = this.hotspot();
        // (the oven gloves, lying there to be put on)
        if (g.ph.hot === 'gloves' && !this.headless) { ctx.font = '96px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🧤', h.x, h.y); }
        this.ghostRing(ctx, h.x, h.y, h.r + 10 + Math.sin(this.t * 6) * 4);
        if (show) this.ghostHand(ctx, h.x + 10, h.y + 10, 1 - t);
        break;
      }
      case 'drag': case 'dip': {
        const tg = g.kind === 'dip' ? { x: MAIN.x, y: MAIN.y - 90, r: 120 } : g.target;
        if (tg && this.k === 0) this.ghostRing(ctx, tg.x, tg.y, Math.min(tg.r, 130));
        const at = this.grabPoint();
        if (g.grip && !g.drag && this.k === 0) this.ghostRing(ctx, at.x, at.y, 34 + Math.sin(this.t * 6) * 4); // the handle
        if (show && g.pos && tg) { const to = { x: tg.x + at.x - g.pos.x, y: tg.y + at.y - g.pos.y }; const p = lerpP(at, to, easeIO(t)); this.ghostHand(ctx, p.x, p.y, 1); this.arrow(ctx, at, to); }
        break;
      }
      case 'door': {
        const a = this.doorGrab(g.geo, g.v), b = this.doorGrab(g.geo, g.ph.to);
        if (!g.drag) this.ghostRing(ctx, a.x, a.y, 40 + Math.sin(this.t * 6) * 5);
        if (show) { const p = this.doorGrab(g.geo, g.v + (g.ph.to - g.v) * easeIO(t)); this.ghostHand(ctx, p.x, p.y, 1); this.arrow(ctx, a, b); }
        break;
      }
      case 'chop': {
        const b = this.subjectBox();
        const n = phaseTarget(g.ph);
        const frac = 1 - this.k / n;
        const gx = g.ph.mode === 'mince' ? b.cx : b.x0 + b.w * frac - b.w / n / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(gx, b.y0 - 60); ctx.lineTo(gx, b.y1); ctx.stroke(); ctx.setLineDash([]);
        if (show) { this.arrowV(ctx, gx + 70, b.y0 - 40, b.y1 - 10, t); }
        break;
      }
      case 'strokes': {
        if (!show) break;
        const b = this.subjectBox();
        const ax = g.ph.axis === 'h';
        const k = Math.sin(t * TAU);
        if (ax) this.ghostHand(ctx, b.cx + k * 110, b.cy, 1); else this.ghostHand(ctx, b.cx + (g.ph.tool === 'grater' ? 150 : 0), b.cy + k * 90, 1);
        break;
      }
      case 'peel': {
        if (!show) break;
        const b = this.subjectBox();
        if (g.ph.tool === 'hand') { this.ghostHand(ctx, b.cx + t * 160, b.cy - t * 40, 1); }
        else this.arrowV(ctx, b.cx, b.y0 + 10, b.y1 - 10, t);
        break;
      }
      case 'circle': {
        const c = this.circleCenter();
        const r = g.subject && g.subject.type === 'vessel' && this.geo ? Math.min(110, this.geo.mouthRx * 0.6) : 110;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 4; ctx.setLineDash([12, 10]); ctx.lineDashOffset = -this.t * 40;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, r, r * (g.subject && g.subject.type === 'vessel' ? 0.4 : 0.8), 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (show) { const a = t * TAU; this.ghostHand(ctx, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.5, 1); }
        // progress ring for partial turns
        const unit = g.ph.n < 1 ? g.ph.n * TAU : TAU;
        const f = (Math.abs(g.acc) % unit) / unit;
        this.holdRing(ctx, c.x, c.y - 10, this.k >= phaseTarget(g.ph) ? 1 : f);
        break;
      }
      case 'knob': {
        const at = this.knobPos();
        const a = levelAngle(g.ph.to) - Math.PI / 2;
        ctx.fillStyle = 'rgba(255,190,40,0.9)';
        ctx.beginPath(); ctx.arc(at.x + Math.cos(a) * (at.r + 26), at.y + Math.sin(a) * (at.r + 26), 22, 0, TAU); ctx.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 6); ctx.fill(); ctx.globalAlpha = 1;
        if (show && !g.turning) {
          // take the knob and drag up (or down)
          const up = g.ph.to > g.level;
          this.arrowV(ctx, at.x - at.r - 34, up ? at.y + 40 : at.y - 40, up ? at.y - 60 : at.y + 60, t, up);
        }
        break;
      }
      case 'pour': case 'fill': this.drawGauge(ctx); if (show) this.ghostHand(ctx, g.kind === 'fill' ? LEVER.x : SIDE.x + 20, g.kind === 'fill' ? LEVER.y : SIDE.y - 60, 1 - t); break;
      case 'paint': this.drawCoverage(ctx); if (show) { const b = this.subjectBox(); const a = t * TAU; this.ghostHand(ctx, b.cx + Math.cos(a) * 90, b.cy + Math.sin(a) * 50, 1); } break;
      case 'place': {
        const R = this.placeArea();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
        ctx.beginPath(); ctx.ellipse(R.cx, R.cy, R.rx, R.ry, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        if (show) this.ghostHand(ctx, R.cx + Math.cos(this.t) * R.rx * 0.5, R.cy + Math.sin(this.t * 1.3) * R.ry * 0.5, 1 - t);
        // the piece in hand
        if (this.ptr.seen && g.ph.piece) this.drawPiece(ctx, g.ph.piece, this.ptr.x, this.ptr.y - 10);
        break;
      }
      case 'flick': if (show) this.arrowV(ctx, MAIN.x + 220, MAIN.y - 20, MAIN.y - 220, t, true); break;
      case 'crack': {
        const rim = this.rimPoint();
        if (g.stage === 0) { this.ghostRing(ctx, rim.x, rim.y, 50); if (show) this.arrow(ctx, g.egg, rim); }
        else if (show) { this.ghostHand(ctx, g.egg.x - 60 * t, g.egg.y, 1); this.ghostHand(ctx, g.egg.x + 60 * t, g.egg.y, 1); }
        break;
      }
      case 'wrap': {
        if (!show) break;
        if (g.stage === 0) this.arrow(ctx, SIDE, { x: MAIN.x, y: MAIN.y - 40 });
        else if (g.stage === 1) this.ghostHand(ctx, MAIN.x - 120 + 240 * t, MAIN.y - 40, 1);
        else this.arrowV(ctx, MAIN.x, MAIN.y + 40, MAIN.y - 140, t, true);
        break;
      }
      case 'scoop': {
        const src = this.scoopSource();
        const tgs = this.scoopTargets();
        const tg = tgs[Math.min(this.k, tgs.length - 1)];
        if (show && tg) { this.arrow(ctx, src, tg); this.ghostHand(ctx, ...Object.values(lerpP(src, tg, easeIO(t))), 1); }
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  drawGauge(ctx) {
    const g = this.g;
    if (g.kind === 'fill') return; // the band is drawn on the pot itself
    const x = 840, y0 = 140, h = 360;
    const [a, b] = g.ph.band;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(x - 26, y0, 52, h, 22); ctx.fill(); ctx.stroke();
    const y = (f) => y0 + h - h * Math.min(1.2, f) / 1.2;
    ctx.fillStyle = 'rgba(63,170,90,0.35)'; ctx.fillRect(x - 22, y(Math.min(1.2, b)), 44, y(a) - y(Math.min(1.2, b)));
    ctx.fillStyle = g.ph.drain ? '#9fd6f2' : this.pourColor();
    const fy = y(g.v || 0);
    ctx.beginPath(); ctx.roundRect(x - 18, fy, 36, y0 + h - fy - 4, 14); ctx.fill();
    ctx.strokeStyle = '#3faa5a'; ctx.lineWidth = 3;
    for (const f of [a, Math.min(1.2, b)]) { ctx.beginPath(); ctx.moveTo(x - 34, y(f)); ctx.lineTo(x + 34, y(f)); ctx.stroke(); }
    ctx.fillStyle = OUTLINE; ctx.font = '700 18px Fredoka, system-ui'; ctx.textAlign = 'center';
    ctx.fillText(g.ph.drain ? 'drain' : 'pour', x, y0 - 14);
    ctx.textAlign = 'start';
  }

  drawCoverage(ctx) {
    const g = this.g;
    const v = g.v || 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(330, 40, 340, 30, 15); ctx.fill(); ctx.stroke();
    ctx.fillStyle = v >= g.ph.cover ? '#3faa5a' : '#e8a51a';
    ctx.beginPath(); ctx.roundRect(334, 44, 332 * Math.min(1, v), 22, 11); ctx.fill();
    ctx.strokeStyle = '#3faa5a'; ctx.beginPath(); ctx.moveTo(334 + 332 * g.ph.cover, 36); ctx.lineTo(334 + 332 * g.ph.cover, 74); ctx.stroke();
  }

  ghostHand(ctx, x, y, alpha) {
    ctx.save();
    ctx.globalAlpha = 0.55 * alpha;
    drawTool(ctx, 'hand', x, y, 0.7, 0, false);
    ctx.restore();
  }

  arrow(ctx, a, b) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 6; ctx.setLineDash([16, 12]); ctx.lineDashOffset = -this.t * 50;
    const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 80;
    ctx.beginPath(); ctx.moveTo(a.x, a.y - 40); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
  }

  arrowV(ctx, x, y0, y1, t, up = false) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
    const ty = up ? y1 : y1, dir = y1 > y0 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(x - 16, ty - dir * 18); ctx.lineTo(x, ty); ctx.lineTo(x + 16, ty - dir * 18); ctx.stroke();
    ctx.lineCap = 'butt';
    this.ghostHand(ctx, x, y0 + (y1 - y0) * easeIO(t), 1);
  }

  // ------------------------------------------------------------------ cursor & effects

  // Your hands: the tool follows the pointer, held by your own arm (your
  // shirt sleeve, your skin) reaching in from the bottom of the view; the
  // other hand steadies the food while you cut, peel or grate.
  drawCursor(ctx) {
    const g = this.g;
    if (!g || this.done) return;
    const p = this.ptr;
    const ph = g.ph;
    let tool = ph.tool || toolFor(g.kind);
    if (g.kind === 'drag' || g.kind === 'scoop' || g.kind === 'dip' || g.kind === 'crack' || (g.kind === 'wrap' && g.stage === 0)) tool = p.down ? 'grab' : 'hand';
    if (g.kind === 'knob' || g.kind === 'tap' || g.kind === 'pour' || g.kind === 'fill' || g.kind === 'place') tool = p.down ? 'grab' : 'hand';
    if (g.kind === 'flick') tool = 'grab';
    if ((g.kind === 'tap' || g.kind === 'drag') && BOARD_TOOLS.includes(ph.tool)) tool = ph.tool; // (putting the knife, peeler, grater down; pushing with the knife)
    if (g.kind === 'dip' && g.drag) tool = null; // the tongs are drawn with the food
    const look = this.c.look || { skin: '#eab88a', shirt: '#3a5a9a' };
    // the steadying hand
    const holds = ['chop', 'peel'].includes(g.kind) || (g.kind === 'strokes' && ['knife', 'grater'].includes(ph.tool));
    if (holds && this.subjectItem()) {
      const at = this.steadyAt();
      if (at) {
        this.drawArm(ctx, look, { x: 170, y: SH + 90 }, { x: at.x - 20, y: at.y + 30 });
        this.drawHand(ctx, look, at.x, at.y, 'claw', -0.3, true);
      } else {
        // (a touch screen, nothing on the food yet) where your other hand goes
        const b = this.subjectBox();
        this.ghostHand(ctx, b.x0 + Math.min(70, b.w * 0.18), b.cy + 6, 0.6 + 0.4 * Math.sin(this.t * 5));
      }
    }
    // the egg pulled apart: your other hand on its other half
    if (g.kind === 'crack' && g.two && this.ptr2) {
      this.drawArm(ctx, look, { x: 170, y: SH + 90 }, { x: this.ptr2.x - 14, y: this.ptr2.y + 40 });
      this.drawHand(ctx, look, this.ptr2.x, this.ptr2.y, 'fist', 0, true);
    }
    if (!p.seen) { if (tool && !holds) { /* resting hand */ } return; }
    if (!tool) return;
    const sc = 0.85;
    if (tool === 'shaker') {
      const it = this.D.items[this.c.def.item];
      this.drawArm(ctx, look, { x: 820, y: SH + 90 }, { x: p.x + 10, y: p.y - 40 });
      if (it) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI); drawIngredient(ctx, it.kind, it, 0, 0, 0.8, this.t); ctx.restore(); }
      this.drawHand(ctx, look, p.x + 10, p.y - 40, 'fist', 0.2);
      return;
    }
    if (g.kind === 'pour' && p.down) return; // the container itself is drawn tipping
    if (g.kind === 'knob' && g.turning) {
      // fingers round the knob, the wrist turning it
      const K = this.knobPos();
      this.drawArm(ctx, look, { x: 820, y: SH + 90 }, { x: K.x + 18, y: K.y + 46 });
      this.drawHand(ctx, look, K.x, K.y + 6, 'fist', g.ang * 0.85);
      return;
    }
    if (tool === 'hand' || tool === 'grab') {
      const mode = tool === 'grab' || p.down ? 'fist' : 'open';
      this.drawArm(ctx, look, { x: 800, y: SH + 90 }, { x: p.x + 14, y: p.y + 40 });
      this.drawHand(ctx, look, p.x, p.y, mode, 0);
      return;
    }
    let ang = 0;
    if (tool === 'knife' && g.kind === 'circle') ang = 0.6;
    if (tool === 'grater') return; // it stands on the board; your hand holds the food
    const grip = GRIP[tool] || [0, -100];
    const grips = tool === 'rollingPin' ? [[-104, 0], [104, 0]] : [grip];
    const pts = grips.map(([gx, gy]) => ({ x: p.x + (gx * Math.cos(ang) - gy * Math.sin(ang)) * sc, y: p.y + (gx * Math.sin(ang) + gy * Math.cos(ang)) * sc }));
    pts.forEach((q, i) => this.drawArm(ctx, look, { x: grips.length > 1 && i === 0 ? 180 : 820, y: SH + 90 }, { x: q.x, y: q.y + 18 }));
    drawTool(ctx, tool, p.x, p.y, sc, ang, p.down);
    pts.forEach((q) => this.drawHand(ctx, look, q.x, q.y, 'fist', tool === 'knife' ? -0.2 : 0));
  }

  drawArm(ctx, look, from, to) {
    // a sleeve tapering from the shoulder (off-screen) to the wrist, with a cuff
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const w0 = 62, w1 = 34;
    const cuff = { x: to.x - dx / L * 26, y: to.y - dy / L * 26 };
    ctx.fillStyle = look.shirt; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x + nx * w0, from.y + ny * w0);
    ctx.quadraticCurveTo((from.x + cuff.x) / 2 + nx * (w0 + w1) / 2 + dx * 0.02, (from.y + cuff.y) / 2 + ny * (w0 + w1) / 2, cuff.x + nx * w1, cuff.y + ny * w1);
    ctx.lineTo(cuff.x - nx * w1, cuff.y - ny * w1);
    ctx.quadraticCurveTo((from.x + cuff.x) / 2 - nx * (w0 + w1) / 2, (from.y + cuff.y) / 2 - ny * (w0 + w1) / 2, from.x - nx * w0, from.y - ny * w0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // sleeve shading and a folded cuff
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.beginPath(); ctx.moveTo(from.x - nx * w0 * 0.2, from.y - ny * w0 * 0.2); ctx.lineTo(cuff.x - nx * w1 * 0.1, cuff.y - ny * w1 * 0.1); ctx.lineTo(cuff.x - nx * w1, cuff.y - ny * w1); ctx.lineTo(from.x - nx * w0, from.y - ny * w0); ctx.fill();
    ctx.fillStyle = shade(look.shirt, 0.12);
    ctx.beginPath(); ctx.moveTo(cuff.x + nx * (w1 + 3), cuff.y + ny * (w1 + 3)); ctx.lineTo(cuff.x - nx * (w1 + 3), cuff.y - ny * (w1 + 3));
    ctx.lineTo(cuff.x - nx * (w1 + 1) + dx / L * 16, cuff.y - ny * (w1 + 1) + dy / L * 16); ctx.lineTo(cuff.x + nx * (w1 + 1) + dx / L * 16, cuff.y + ny * (w1 + 1) + dy / L * 16);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // the wrist
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.moveTo(cuff.x + nx * 24 + dx / L * 14, cuff.y + ny * 24 + dy / L * 14); ctx.lineTo(to.x + nx * 22, to.y + ny * 22);
    ctx.lineTo(to.x - nx * 22, to.y - ny * 22); ctx.lineTo(cuff.x - nx * 24 + dx / L * 14, cuff.y - ny * 24 + dy / L * 14); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // A cartoon hand in your skin tone: open, a fist round a handle, or a
  // "claw" (fingertips tucked) holding food steady for the knife.
  drawHand(ctx, look, x, y, mode, ang = 0, left = false) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); if (left) ctx.scale(-1, 1);
    ctx.fillStyle = look.skin; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    if (mode === 'open') {
      // palm + four fingers + thumb, fingers up
      for (let i = 0; i < 4; i++) {
        const fx = -21 + i * 14, len = [30, 36, 34, 26][i];
        ctx.beginPath(); ctx.roundRect(fx - 7, -14 - len, 14, len + 14, 7); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); ctx.roundRect(-30, -18, 58, 46, 18); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-30, 2, 9, 18, -0.7, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(240,110,110,0.25)'; ctx.beginPath(); ctx.ellipse(0, 8, 16, 10, 0, 0, TAU); ctx.fill();
    } else {
      // fist / claw: a rounded block with knuckle bumps
      ctx.beginPath(); ctx.roundRect(-30, -24, 60, 50, 20); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-21 + i * 14, mode === 'claw' ? -22 : -20, 8, Math.PI, TAU); ctx.fill(); ctx.stroke(); }
      ctx.strokeStyle = shade(look.skin, -0.3); ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-14 + i * 14, -20); ctx.lineTo(-14 + i * 14, -6); ctx.stroke(); }
      ctx.fillStyle = look.skin; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(-24, 6, 10, 16, 0.5, 0, TAU); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  drawFx(ctx, dt) {
    const keep = [];
    for (const e of this.fx) {
      e.life += dt;
      if (e.life > e.max) continue;
      keep.push(e);
      const k = e.life / e.max;
      switch (e.kind) {
        case 'spark': case 'drop': case 'dust':
          e.vy += (e.kind === 'dust' ? 200 : 600) * dt; e.x += e.vx * dt; e.y += e.vy * dt;
          ctx.fillStyle = e.col; ctx.globalAlpha = 1 - k;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.kind === 'spark' ? 6 * (1 - k) + 2 : e.kind === 'dust' ? 3 : 5, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'ring':
          ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, 30 + k * 90, 10 + k * 30, 0, 0, TAU); ctx.stroke();
          break;
        case 'bubble':
          e.y += e.vy * dt; e.x += Math.sin(e.life * 6) * 0.8;
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; ctx.lineWidth = 2;
          ctx.fillStyle = `rgba(220,240,255,${0.35 * (1 - k)})`;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); ctx.stroke();
          break;
        case 'thunk':
          ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 4;
          for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(e.x + s * 14, e.y - 6); ctx.lineTo(e.x + s * (30 + k * 20), e.y - 18 - k * 10); ctx.stroke(); }
          break;
        case 'strip':
          e.vy += 500 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
          ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.life * 6);
          ctx.fillStyle = e.col; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.globalAlpha = 1 - k * 0.5;
          ctx.beginPath(); ctx.ellipse(0, 0, 26, 7, 0, 0, TAU); ctx.fill(); ctx.stroke();
          ctx.restore(); ctx.globalAlpha = 1;
          break;
        case 'shreds':
          for (let i = 0; i < 6; i++) { ctx.fillStyle = e.col; ctx.globalAlpha = 1 - k; ctx.fillRect(e.x + Math.sin(i * 2.1) * 30, e.y - 40 + k * 60 + i * 6, 3, 12); }
          ctx.globalAlpha = 1;
          break;
      }
    }
    this.fx = keep;
  }

  drawDone(ctx) {
    ctx.fillStyle = 'rgba(255,248,232,0.55)'; ctx.fillRect(0, 0, SW, SH);
    ctx.save();
    ctx.translate(SW / 2, SH / 2 - 20);
    const s = 1 + Math.sin(this.t * 4) * 0.04;
    ctx.scale(s, s);
    ctx.fillStyle = '#3faa5a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-30, 2); ctx.lineTo(-8, 26); ctx.lineTo(34, -22); ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ helpers

function normAng(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
export function levelAngle(l) { return -2.4 + (l / 3) * 4.8; }
function lerpP(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function easeIO(t) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
// where your hand holds each tool, relative to its working point (art.js geometry)
const GRIP = {
  knife: [72, -30], peeler: [0, -88], whisk: [0, -125], spoon: [0, -128], ladle: [20, -125], brush: [0, -112], masher: [0, -135],
  tongs: [0, -150], spatula: [0, -125], blenderStick: [0, -165], pizzaPeel: [150, 42], sponge: [0, -18],
};
function toolFor(kind) {
  return { chop: 'knife', peel: 'peeler', circle: 'spoon', strokes: 'hand', paint: 'spoon', flick: 'grab' }[kind] || 'hand';
}

export { HEAT_NAMES };
