// Hands by camera: the webcam watches your real hands (MediaPipe, through the vendored
// hand-gesture-kit) and they become your two hands in the kitchen – the same two
// hands E / Q and the touch fingers are. Where a hand is on the camera is where it
// points on the screen; closing it takes hold (a thing, a door's handle, a knob, the
// work at the bench), keeping it closed carries, opening it lets go – put down just
// there, over a worktop or a shelf. A hand at the camera's left / right edge turns the
// view, at the top / bottom tilts it; the keys (or the stick) still walk.
//
// The pure parts (grip, the hand's switch, the edge turn, which hand is which) are
// exported for the Node tests; CamHands is the browser part (camera, model, preview).

// How closed a hand is, 0 open … 1 a fist / a pinch: the fingers curled, or thumb and
// index together (a pinch holds a lemon as surely as a fist holds a pan).
export function gripOf(h) {
  const f = h.features;
  let g = Math.max(h.pinch || 0, 1 - (f ? f.openness : 1));
  if (h.pose === 'fist' || h.pose === 'pinch' || h.pose === 'ok') g = Math.max(g, 0.9);
  if (h.pose === 'open' || h.pose === 'four') g = Math.min(g, 0.2);
  return Math.max(0, Math.min(1, g));
}
// (hysteresis: it closes past CLOSE and opens again below OPEN – no flicker in between)
export const GRIP = { close: 0.66, open: 0.42 };
// a hand out of sight this long is gone (what it holds stays held; a door it had lets go)
export const LOST_MS = 450;

// The camera image's middle part that fills the screen, so your hands needn't go right
// to the camera's edges (they would leave the picture first).
export const REGION = { x0: 0.1, x1: 0.9, y0: 0.08, y1: 0.8 };
export function toScreen(p, r = REGION) {
  const c = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return { x: c((p.x - r.x0) / (r.x1 - r.x0)), y: c((p.y - r.y0) / (r.y1 - r.y0)) };
}

// Where a hand points: the middle of its palm – it stays put as the hand closes (a fist reads as a
// pinch too, so the fingertips would make the aim jump just as it takes hold).
export function pointOf(h) {
  return (h.features && h.features.center) || (h.landmarks && h.landmarks[9]) || { x: 0.5, y: 0.5 };
}

// Turning the view with a hand at the edge: radians a second for yaw (+ left) and
// pitch (+ up), from where it is on the screen (0..1). Within EDGE of the side it
// turns, the deeper the faster.
export const EDGE = 0.13;
export const TURN_RATE = { yaw: 1.7, pitch: 0.9 };
export function edgeTurn(p) {
  const d = (v) => Math.max(0, Math.min(1, v / EDGE));
  const x = d(EDGE - p.x) - d(p.x - (1 - EDGE)), y = d(EDGE - p.y) - d(p.y - (1 - EDGE));
  const ease = (v) => Math.sign(v) * v * v;
  return { yaw: ease(x) * TURN_RATE.yaw, pitch: ease(y) * TURN_RATE.pitch };
}

// Which of the frame's hands is my left (0) and right (1): by handedness, and if the
// model calls both the same, by where they are (the one further right is the right).
export function sides(hands) {
  const out = [null, null];
  const L = hands.filter((h) => h.handedness === 'Left'), R = hands.filter((h) => h.handedness === 'Right');
  if (L.length <= 1 && R.length <= 1) { out[0] = L[0] || null; out[1] = R[0] || null; return out; }
  const byX = [...hands].sort((a, b) => a.features.center.x - b.features.center.x);
  out[0] = byX[0] || null; out[1] = byX[byX.length - 1] || null;
  if (out[0] === out[1]) out[0] = null;
  return out;
}

// One real hand's state, frame by frame: where it is, whether it's closed, and what's
// just happened – 'show' (it came into sight), 'close', 'open', 'lost' (out of sight).
export class HandSwitch {
  constructor() { this.present = false; this.closed = false; this.seen = -1e9; this.at = { x: 0.5, y: 0.5 }; this.grip = 0; this.roll = 0; this.vel = { x: 0, y: 0 }; }
  update(h, t) {
    const ev = [];
    if (!h) {
      if (this.present && t - this.seen > LOST_MS) { this.present = false; this.closed = false; ev.push('lost'); }
      return ev;
    }
    this.seen = t;
    if (!this.present) { this.present = true; this.closed = false; ev.push('show'); }
    this.grip = gripOf(h);
    this.roll = h.features ? h.features.roll : 0;
    this.vel = h.velocity || { x: 0, y: 0 };
    this.at = toScreen(pointOf(h));
    if (!this.closed && this.grip >= GRIP.close) { this.closed = true; ev.push('close'); } else if (this.closed && this.grip <= GRIP.open) { this.closed = false; ev.push('open'); }
    return ev;
  }
}

// What the hands look like as they're seen: [left, right] for each frame, with events.
export class HandPair {
  constructor() { this.sw = [new HandSwitch(), new HandSwitch()]; }
  update(frame) {
    const [l, r] = sides(frame.hands || []);
    return [l, r].map((h, i) => ({ i, h, sw: this.sw[i], ev: this.sw[i].update(h, frame.t) }));
  }
}

// ------------------------------------------------------------------ the browser part

const KIT = './vendor/hands/hand-gesture-kit.js';
// (MediaPipe's own files – the JS is in the import map – from the CDN, at the version the kit pins; the model is
// Google's release)
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class CamHands {
  // on(i, kind, sw): 'close' / 'open' / 'lost' / 'show' for hand i (0 my left, 1 my right); move(i, sw) each frame it's seen
  constructor({ on, move } = {}) {
    this.on = on || (() => {});
    this.move = move || (() => {});
    this.pair = new HandPair();
    this.active = false;
    this.kit = null;
    this.hands = null;
    this.el = null;
  }
  get sw() { return this.pair.sw; }
  // the hand's point on the screen (client px, over rect) – null if it isn't seen
  screen(i, rect) {
    const s = this.pair.sw[i];
    if (!this.active || !s.present) return null;
    return { x: rect.left + s.at.x * rect.width, y: rect.top + s.at.y * rect.height };
  }
  async load() {
    if (!this.kit) this.kit = await import(new URL(KIT, import.meta.url).href);
    return this.kit;
  }
  preview() {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.id = 'camHands';
    el.innerHTML = '<video muted playsinline></video><canvas width="320" height="180"></canvas><small></small>';
    document.body.appendChild(el);
    this.el = el;
    return el;
  }
  // camera: true – the webcam (call from a click); false – no camera, hands come from inject() (tests)
  async start({ camera = true } = {}) {
    const K = await this.load();
    const el = this.preview();
    el.hidden = false;
    if (!this.hands) {
      this.hands = K.createHands({
        video: el.querySelector('video'),
        numHands: 2,
        wasmUrl: WASM,
        modelUrl: MODEL,
        config: { pose: { experimental: false } },
        onFrame: (frame) => this.frame(frame),
      });
    }
    if (camera) await this.hands.startCamera();
    this.active = true;
    el.classList.toggle('synthetic', !camera);
  }
  stop() {
    this.active = false;
    if (this.hands) { this.hands.stop(); this.hands = null; }
    for (const [i, s] of this.pair.sw.entries()) if (s.present) { s.present = false; s.closed = false; this.on(i, 'lost', s); }
    if (this.el) this.el.hidden = true;
  }
  // (tests) these hands every frame instead of the camera – kit.syntheticHand(...) – null: none seen
  inject(hs) { if (this.hands) this.hands.inject(hs || []); }
  frame(frame) {
    if (!this.active) return;
    for (const { i, sw, ev } of this.pair.update(frame)) {
      for (const e of ev) this.on(i, e, sw);
      if (sw.present) this.move(i, sw);
    }
    this.draw(frame);
  }
  draw(frame) {
    const cv = this.el && this.el.querySelector('canvas');
    if (!cv || !this.kit) return;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    // (the part of the picture that is the screen)
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    g.strokeRect(REGION.x0 * cv.width, REGION.y0 * cv.height, (REGION.x1 - REGION.x0) * cv.width, (REGION.y1 - REGION.y0) * cv.height);
    const [l, r] = sides(frame.hands || []);
    for (const [i, h] of [l, r].entries()) {
      if (!h) continue;
      const closed = this.pair.sw[i].closed;
      this.kit.drawHand(g, h.landmarks, cv.width, cv.height, { color: closed ? '#ffb347' : i ? '#7fd1ff' : '#b4f08a', lineWidth: 2, jointRadius: 2.5 });
    }
    const n = (frame.hands || []).length, t = this.hands && this.hands.tracker;
    this.el.querySelector('small').textContent = `${n ? `${n} hand${n > 1 ? 's' : ''}` : 'show your hands'}${t && t.fps ? ` · ${Math.round(t.fps)} fps` : ''}`;
  }
}
