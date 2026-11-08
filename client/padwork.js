// Work by buttons, as in the football game: at the bench one button – R on
// the keyboard, □ / X on a gamepad – plays the gesture the work needs right
// now, the way a pass or a shot is one button there. A press is one beat (a
// cut, a stroke of the grater, a scoop, an egg knocked on the rim and pulled
// open); held, the beat goes on at a cook's pace (stirring round, rubbing the
// butter over, pouring – let go when it's enough). A direction does what has
// a direction: ↑ / ↓ turn a knob a setting up or down.
//
// It does the gesture with the station's own pointer – the same recognizers
// the mouse, a finger or a hand in front of the camera go through – so the
// hands in the kitchen move just as they would, and nothing is counted that
// a real stroke wouldn't count. Points are in the close-up's scene space.
import { MAIN, SIDE, LEVER } from './station.js';
import { phaseTarget } from '../shared/cook.js';
import { PAD_STYLE } from './padstyle.js';

export { PAD_STYLE };

const PID = 'pad';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }));
// (a cook's pace for each beat, ms between pointer samples)
const PACE = 16;

export class PadWork {
  constructor(station, { hint = () => {} } = {}) {
    this.st = station;
    this.hint = hint;
    this.held = false;
    this.busy = false;     // a beat is being played
    this.queued = 0;       // presses waiting for the beat before them
    this.active = false;   // the pad has the work's pointer (the mouse hand leaves it alone)
    this.beats = [];       // when the last beats were pressed (the rhythm)
    this.slow = 1;         // (filming: every beat this many times slower)
  }

  // the gesture now, and how a press plays it
  kind() { const g = this.st.on && !this.st.done && this.st.mode !== 'store' && this.st.g; return g ? g.kind : null; }
  style() { return PAD_STYLE[this.kind()] || null; }
  // does a direction mean something to this work (else it steps away from it)?
  wantsDir(d) { return this.style() === 'dir' && d && d[1] !== 0; }

  press() {
    const k = this.kind();
    if (!k) return false;
    this.held = true;
    if (PAD_STYLE[k] === 'dir') { this.hint('↑ / ↓ turn the knob a setting up or down'); return true; }
    const now = performance.now();
    this.beats = [...this.beats.filter((t) => now - t < 4000), now];
    if (this.busy) { this.queued = Math.min(1, this.queued + 1); return true; }
    this.play();
    return true;
  }
  release() { this.held = false; }
  // ↑ ↓ (dy -1 up, 1 down): a knob a setting at a time
  dir(d) {
    if (this.kind() !== 'knob' || this.busy) return false;
    this.run(() => this.knob(-Math.sign(d[1])));
    return true;
  }
  // how even the presses come (1 steady as a metronome, 0 all over the place)
  rhythm() {
    const b = this.beats;
    if (b.length < 3) return null;
    const gaps = b.slice(1).map((t, i) => t - b[i]);
    const m = gaps.reduce((a, x) => a + x, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, x) => a + (x - m) ** 2, 0) / gaps.length);
    return Math.max(0, 1 - sd / m);
  }

  async play() {
    const k = this.kind();
    await this.run(async () => {
      do {
        this.queued = Math.max(0, this.queued - 1);
        const g = this.st.g;
        await this.beat(k);
        if (this.st.g !== g || this.kind() !== k) break; // (that phase is done: the next one wants its own press)
      } while ((this.held && PAD_STYLE[k] === 'beat') || this.queued > 0);
    });
  }
  async run(fn) {
    this.busy = true; this.active = true;
    try { await fn(); } finally {
      this.busy = false;
      this.up();
      this.active = false;
    }
  }

  // the pointer, as a hand
  ev(type, p) { this.cur = p; this.st.pointer(type, p, PID, 'pad'); }
  down(p) { this.ev('move', p); this.ev('down', p); this.pressed = true; }
  up(p = this.cur) { if (this.pressed && p) { this.pressed = false; this.ev('up', p); } }
  async path(pts, ms = PACE) { for (const p of pts) { if (!this.st.on) return; this.ev('move', p); await sleep(ms * this.slow); } }
  async stroke(pts, ms = PACE) { this.down(pts[0]); await this.path(pts.slice(1), ms); this.up(pts[pts.length - 1]); await sleep(60 * this.slow); }

  async beat(kind) {
    const st = this.st, g = st.g, ph = g.ph;
    switch (kind) {
      case 'tap': { const h = st.hotspot(); if (h) await this.stroke([h, h]); break; }
      case 'drag': {
        // taken where a hand would take it (a pan by its handle) and carried over
        const a = st.grabPoint(), t = g.target;
        if (!t) break;
        // (cut pieces: cupped together in both hands a moment first, then carried over at a cook's pace)
        if (g.ph.obj === 'pieces') { this.down(a); await sleep(300 * this.slow); await this.path(line(a, t, 24).slice(1), 24); this.up(t); await sleep(60 * this.slow); break; }
        await this.stroke(line(a, { x: t.x + a.x - g.pos.x, y: t.y + a.y - g.pos.y }, 16));
        break;
      }
      case 'door': {
        const pts = [];
        for (let i = 0; i <= 14; i++) pts.push(st.doorGrab(g.geo, (g.v || 0) + (ph.to - (g.v || 0)) * i / 14));
        await this.stroke(pts);
        break;
      }
      case 'strokes': {
        // one stroke there and back (a stroke counts each way it goes far enough)
        const b = st.subjectBox();
        const amp = ph.tool === 'shaker' ? 45 : ph.once ? 170 : 90;
        const h = ph.axis === 'h';
        const at = (s) => ({ x: b.cx + (h ? s * amp : 0), y: b.cy + (h ? 0 : s * amp) });
        if (!this.pressed) this.down(at(-1));
        await this.path(line(at(-1), at(1), 10), 20);
        await this.path(line(at(1), at(-1), 10), 20);
        break;
      }
      case 'circle': {
        // round and round while it's held (a press alone: one turn)
        const c = st.circleCenter();
        const at = (a) => ({ x: c.x + Math.cos(a) * 90, y: c.y + Math.sin(a) * 60 });
        let a = 0;
        this.down(at(a));
        do {
          for (let i = 0; i < 24 && st.g === g; i++) { a += Math.PI * 2 / 24; this.ev('move', at(a)); await sleep(40 * this.slow); } // (a turn a second)
        } while (this.held && st.g === g && st.on);
        this.up();
        break;
      }
      case 'chop': {
        // a cut: the knife lifted over the food, down through it to the board, up again – about two and a half
        // a second, as a home cook slices; the next cut further along
        const b = st.subjectBox(), n = Math.max(1, phaseTarget(ph));
        const x = b.x0 + b.w * (0.8 - 0.5 * Math.min(1, st.k / n));
        const top = { x, y: b.y0 - 70 }, edge = { x, y: b.y0 - 30 }, board = { x, y: b.y1 + 4 };
        await this.stroke([...line(top, edge, 3), ...line(edge, board, 8).slice(1), ...line(board, { x, y: b.y0 - 60 }, 6).slice(1)], 22);
        break;
      }
      case 'peel': {
        const b = st.subjectBox(), o = (st.k % 3 - 1) * 20;
        if (ph.tool === 'hand') await this.stroke(line({ x: b.cx, y: b.cy }, { x: b.cx + 160, y: b.cy - 30 }, 14), 22);
        else await this.stroke(line({ x: b.cx + o, y: b.y0 + 8 }, { x: b.cx + o, y: b.y1 + 2 }, 14), 22);
        break;
      }
      case 'pour': case 'fill': {
        // tipped while it's held: let go in time
        const p = g.kind === 'fill' ? LEVER : { x: SIDE.x, y: SIDE.y - 40 };
        this.down(p);
        while (this.held && st.g === g && st.on) await sleep(30);
        this.up(p);
        break;
      }
      case 'paint': {
        // rubbed over, row by row, while it's held
        const R = st.surfaceRect();
        const rows = [];
        for (let j = 0; j < 9; j++) { const y = R.y + R.h * (0.12 + 0.76 * j / 8); rows.push(j % 2 ? [{ x: R.x + R.w * 0.92, y }, { x: R.x + R.w * 0.08, y }] : [{ x: R.x + R.w * 0.08, y }, { x: R.x + R.w * 0.92, y }]); }
        this.down(rows[0][0]);
        let j = 0;
        do {
          const [a, b] = rows[j % rows.length];
          await this.path(line(this.cur, a, 3), 6);
          await this.path(line(a, b, 12), 8);
          j++;
        } while ((this.held || j < 2) && st.g === g && st.on);
        this.up();
        break;
      }
      case 'place': {
        const R = st.placeArea(), a = st.k * 2.4;
        const p = { x: R.cx + Math.cos(a) * R.rx * 0.5, y: R.cy + Math.sin(a) * R.ry * 0.5 };
        await this.stroke([p]);
        break;
      }
      case 'flick': await this.stroke(line({ x: MAIN.x + 200, y: MAIN.y }, { x: MAIN.x + 200, y: MAIN.y - 160 }, 5), 15); await sleep(150); break;
      case 'crack': {
        // brought over, knocked on the rim (a knock is quick), pulled open
        const rim = st.rimPoint();
        this.down(g.egg);
        await this.path(line(g.egg, { x: rim.x, y: rim.y - 10 }, 6).slice(1), PACE);
        this.ev('move', { x: rim.x, y: rim.y - 30 }); await sleep(8);
        this.ev('move', { x: rim.x, y: rim.y + 5 }); await sleep(8);
        this.up({ x: rim.x, y: rim.y + 5 });
        await sleep(180 * this.slow);
        await this.stroke(line({ x: rim.x, y: rim.y - 30 }, { x: rim.x + 110, y: rim.y - 30 }, 8));
        break;
      }
      case 'wrap': {
        // the filling on, folded over, rolled up: a press each
        if (g.stage === 0) await this.stroke(line({ x: SIDE.x, y: SIDE.y - 20 }, { x: MAIN.x, y: MAIN.y - 40 }, 10));
        else if (g.stage === 1) await this.stroke(line({ x: MAIN.x - 60, y: MAIN.y - 40 }, { x: MAIN.x + 60, y: MAIN.y - 40 }, 8));
        else await this.stroke(line({ x: MAIN.x, y: MAIN.y + 20 }, { x: MAIN.x, y: MAIN.y - 110 }, 8));
        break;
      }
      case 'scoop': {
        const src = st.scoopSource(), t = st.scoopTargets()[st.k];
        if (t) await this.stroke(line(src, t, 10));
        break;
      }
      case 'dip': {
        // in while it's held; out when let go (long enough in, and it counts)
        const pot = { x: MAIN.x, y: MAIN.y - 80 }, side = { x: SIDE.x, y: SIDE.y - 20 };
        this.down(side);
        await this.path(line(side, pot, 10).slice(1));
        while (this.held && st.g === g && st.on) await sleep(30);
        await this.path(line(pot, side, 10).slice(1));
        this.up(side);
        break;
      }
      default: break;
    }
    if (kind === 'strokes' && !(this.held || this.queued)) this.up();
  }

  // a knob a setting up (1) or down (-1): taken, turned, let go
  async knob(d) {
    const st = this.st, g = st.g;
    const K = st.knobPos();
    const lv = Math.max(0, Math.min(3, g.level + d));
    if (lv === g.level) return;
    const target = -2.4 + lv / 3 * 4.8;
    const dy = (target - g.ang) / 0.03;
    await this.stroke(line(K, { x: K.x, y: K.y - dy }, 8), PACE);
  }
}
