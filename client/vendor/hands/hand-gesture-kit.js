// hand-gesture-kit from https://github.com/abouchedidxcode/open-source-hands (src/kit, commit dd79fb7, MIT – see LICENSE),
// bundled to one ES module with esbuild (@mediapipe/tasks-vision left external: the import map points it at the CDN).
// One change: TrackerOptions.wasmUrl / modelUrl, so the wasm and the model can come from their own URLs.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// oneEuro.ts
var CURSOR_FILTER = { minCutoff: 1.1, beta: 5.5, dCutoff: 1.2 };
function smoothingAlpha(cutoffHz, dt) {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}
var MAX_DT = 0.1;
var MIN_DT = 1 / 1e3;
var OneEuroFilter = class {
  constructor(params = CURSOR_FILTER) {
    this.params = params;
    __publicField(this, "x", 0);
    __publicField(this, "dx", 0);
    __publicField(this, "lastT", -1);
    __publicField(this, "initialised", false);
  }
  /** Filter value `v` sampled at time `t` (seconds). */
  filter(v, t) {
    if (!this.initialised) {
      this.x = v;
      this.dx = 0;
      this.lastT = t;
      this.initialised = true;
      return v;
    }
    let dt = t - this.lastT;
    this.lastT = t;
    if (!(dt > MIN_DT)) dt = MIN_DT;
    if (dt > MAX_DT) dt = MAX_DT;
    const { minCutoff, beta, dCutoff } = this.params;
    const rawDx = (v - this.x) / dt;
    this.dx += smoothingAlpha(dCutoff, dt) * (rawDx - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += smoothingAlpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
  /** Current filtered value (last output). */
  get value() {
    return this.x;
  }
  /** Current filtered derivative (value units / s). */
  get derivative() {
    return this.dx;
  }
  get ready() {
    return this.initialised;
  }
  /** Forget history; the next sample passes through unfiltered. */
  reset() {
    this.initialised = false;
    this.dx = 0;
  }
  /** Jump to a value without history (e.g. hand re-acquired). */
  snap(v, t) {
    this.x = v;
    this.dx = 0;
    this.lastT = t;
    this.initialised = true;
  }
};
var OneEuroFilter2D = class {
  constructor(params = CURSOR_FILTER) {
    this.params = params;
    __publicField(this, "x", 0);
    __publicField(this, "y", 0);
    __publicField(this, "dx", 0);
    __publicField(this, "dy", 0);
    __publicField(this, "lastT", -1);
    __publicField(this, "initialised", false);
  }
  filter(vx, vy, t) {
    if (!this.initialised) {
      this.snap(vx, vy, t);
      return { x: vx, y: vy };
    }
    let dt = t - this.lastT;
    this.lastT = t;
    if (!(dt > MIN_DT)) dt = MIN_DT;
    if (dt > MAX_DT) dt = MAX_DT;
    const { minCutoff, beta, dCutoff } = this.params;
    const ad = smoothingAlpha(dCutoff, dt);
    this.dx += ad * ((vx - this.x) / dt - this.dx);
    this.dy += ad * ((vy - this.y) / dt - this.dy);
    const speed = Math.hypot(this.dx, this.dy);
    const a = smoothingAlpha(minCutoff + beta * speed, dt);
    this.x += a * (vx - this.x);
    this.y += a * (vy - this.y);
    return { x: this.x, y: this.y };
  }
  get value() {
    return { x: this.x, y: this.y };
  }
  get ready() {
    return this.initialised;
  }
  reset() {
    this.initialised = false;
    this.dx = 0;
    this.dy = 0;
  }
  snap(x, y, t) {
    this.x = x;
    this.y = y;
    this.dx = 0;
    this.dy = 0;
    this.lastT = t;
    this.initialised = true;
  }
};

// features.ts
var L = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20
};
var CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20]
];
var FINGER_BEND = { straight: 0.45, curled: 3.1 };
var THUMB_BEND = { straight: 0.35, curled: 1.5 };
var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
var smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
var dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
var len = (a) => Math.sqrt(dot(a, a));
var cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
var dist = (a, b) => len(sub(a, b));
function bend(a, b, c) {
  const u = sub(b, a), v = sub(c, b);
  const lu = len(u), lv = len(v);
  if (lu < 1e-9 || lv < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv))));
}
var unit2 = (x, y) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
var angle2 = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
function shapePoints(h) {
  if (h.world && h.world.length === 21) return h.world;
  const a = h.aspect ?? 16 / 9;
  return h.landmarks.map((p) => ({ x: p.x * a, y: p.y, z: p.z * a * 0.6 }));
}
function computeFeatures(h) {
  const P = shapePoints(h);
  const S = h.landmarks;
  const aspect = h.aspect ?? 16 / 9;
  const palmLen = Math.max(dist(P[0], P[9]), 1e-6);
  const curl = [0, 0, 0, 0, 0];
  for (let f = 0; f < 5; f++) {
    const c = CHAINS[f];
    if (f === 0) {
      const b = bend(P[c[1]], P[c[2]], P[c[3]]) + bend(P[c[2]], P[c[3]], P[c[4]]);
      curl[0] = clamp01((b - THUMB_BEND.straight) / (THUMB_BEND.curled - THUMB_BEND.straight));
    } else {
      const b = 0.5 * bend(P[c[0]], P[c[1]], P[c[2]]) + bend(P[c[1]], P[c[2]], P[c[3]]) + bend(P[c[2]], P[c[3]], P[c[4]]);
      curl[f] = clamp01((b - FINGER_BEND.straight) / (FINGER_BEND.curled - FINGER_BEND.straight));
    }
  }
  const tOut = Math.min(dist(P[4], P[5]), dist(P[4], P[9]) * 1.15) / palmLen;
  const thumbOut = smooth(0.32, 0.62, tOut) * (1 - 0.5 * smooth(0.6, 1, curl[0]));
  const tipGap = [8, 12, 16, 20].map((t) => dist(P[4], P[t]) / palmLen);
  const dir = (m, t) => unit2((S[t].x - S[m].x) * aspect, S[t].y - S[m].y);
  const dI = dir(5, 8), dM = dir(9, 12), dR = dir(13, 16), dP = dir(17, 20);
  const spread = [angle2(dI, dM), angle2(dM, dR), angle2(dR, dP)];
  const n = cross(sub(P[5], P[0]), sub(P[17], P[0]));
  const nl = len(n) || 1;
  const facing = (h.handedness === "Right" ? 1 : -1) * (n.z / nl);
  const up = unit2((S[9].x - S[0].x) * aspect, S[9].y - S[0].y);
  const roll = Math.atan2(up.x, -up.y);
  const pointDir = dI;
  const thumbDir = unit2((S[4].x - S[2].x) * aspect, S[4].y - S[2].y);
  const center = {
    x: (S[0].x + S[5].x + S[9].x + S[13].x + S[17].x) / 5,
    y: (S[0].y + S[5].y + S[9].y + S[13].y + S[17].y) / 5
  };
  const size = Math.hypot((S[9].x - S[0].x) * aspect, S[9].y - S[0].y);
  const openness = 1 - (curl[1] + curl[2] + curl[3] + curl[4]) / 4;
  return { curl, thumbOut, tipGap, spread, facing, roll, pointDir, thumbDir, center, size, openness };
}

// motions.ts
var DEFAULT_MOTION = {
  swipeDist: 0.2,
  swipeMs: 380,
  swipeAxis: 1.8,
  pushRatio: 1.28,
  pushMs: 450,
  pushDrift: 0.09,
  circleTurns: 0.85,
  circleRadius: 0.035,
  circleMs: 1500,
  waveReversals: 3,
  waveAmp: 0.035,
  waveMs: 1300,
  twistDeg: 55,
  twistMs: 600,
  tapMs: 350,
  doubleTapMs: 550,
  throwSpeed: 1.1,
  holdMs: 800,
  clapSpeed: 0.9,
  clapDist: 0.2,
  zoomIn: 1.45,
  zoomOut: 0.7,
  steerDeg: 35,
  cooldownMs: 650
};
function back(h, now, ms) {
  for (let i = h.length - 1; i >= 0; i--) if (now - h[i].t >= ms) return h[i];
  return h[0];
}
var within = (h, now, ms) => h.filter((s) => now - s.t <= ms);
var MOTIONS = [
  // throw first: a throw is also a fast sideways move, and must win over the swipe it contains
  {
    id: "throw",
    names: ["throw"],
    detect: ({ h, now, cfg }) => {
      if (h.length < 3) return null;
      const cur = h[h.length - 1];
      if (cur.open < 0.6) return null;
      const recent = within(h, now, 300);
      if (!recent.some((s) => s.pose === "fist" || s.pose === "claw")) return null;
      const old = back(h, now, 120);
      const dt = (cur.t - old.t) / 1e3;
      if (dt <= 0) return null;
      const vx = (cur.x - old.x) / dt, vy = (cur.y - old.y) / dt;
      const sp = Math.hypot(vx, vy);
      if (sp < cfg.throwSpeed) return null;
      return { name: "throw", reset: true, data: { vx: +vx.toFixed(2), vy: +vy.toFixed(2) } };
    }
  },
  {
    id: "swipe",
    names: ["swipe-left", "swipe-right", "swipe-up", "swipe-down"],
    detect: ({ h, now, cfg, busy }) => {
      const cur = h[h.length - 1], old = back(h, now, cfg.swipeMs);
      if (now - old.t < cfg.swipeMs * 0.4) return null;
      if (busy) return null;
      if (cur.pose === "fist") return null;
      const dx = cur.x - old.x, dy = cur.y - old.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < cfg.swipeDist) return null;
      if (ax > ay * cfg.swipeAxis) return { name: dx < 0 ? "swipe-left" : "swipe-right", reset: true, data: { dist: ax } };
      if (ay > ax * cfg.swipeAxis) return { name: dy < 0 ? "swipe-up" : "swipe-down", reset: true, data: { dist: ay } };
      return null;
    }
  },
  {
    id: "push",
    names: ["push", "pull"],
    detect: ({ h, now, cfg }) => {
      const cur = h[h.length - 1], old = back(h, now, cfg.pushMs);
      if (now - old.t < cfg.pushMs * 0.4 || old.size <= 0) return null;
      if (Math.hypot(cur.x - old.x, cur.y - old.y) > cfg.pushDrift) return null;
      const r = cur.size / old.size;
      if (r > cfg.pushRatio) return { name: "push", reset: true, data: { ratio: r } };
      if (r < 1 / cfg.pushRatio) return { name: "pull", reset: true, data: { ratio: r } };
      return null;
    }
  },
  {
    id: "circle",
    names: ["circle-cw", "circle-ccw"],
    detect: ({ h, now, cfg }) => {
      const w = within(h, now, cfg.circleMs);
      if (w.length < 10) return null;
      let cx = 0, cy = 0;
      for (const s of w) {
        cx += s.x;
        cy += s.y;
      }
      cx /= w.length;
      cy /= w.length;
      let r = 0;
      for (const s of w) r += Math.hypot(s.x - cx, s.y - cy);
      r /= w.length;
      if (r < cfg.circleRadius) return null;
      let turn = 0;
      for (let i = 1; i < w.length; i++) {
        let d = Math.atan2(w[i].y - cy, w[i].x - cx) - Math.atan2(w[i - 1].y - cy, w[i - 1].x - cx);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        turn += d;
      }
      if (Math.abs(turn) < cfg.circleTurns * 2 * Math.PI) return null;
      return { name: turn > 0 ? "circle-cw" : "circle-ccw", reset: true, data: { radius: r } };
    }
  },
  {
    id: "wave",
    names: ["wave", "shake"],
    detect: ({ h, now, cfg }) => {
      const w = within(h, now, cfg.waveMs);
      if (w.length < 8) return null;
      const reversals = (get) => {
        let n = 0, dir = 0, hi = get(w[0]), lo = hi;
        for (const s of w) {
          const v = get(s);
          if (v > hi) hi = v;
          if (v < lo) lo = v;
          if (dir !== -1 && hi - v > cfg.waveAmp) {
            if (dir === 1) n++;
            dir = -1;
            hi = lo = v;
          } else if (dir !== 1 && v - lo > cfg.waveAmp) {
            if (dir === -1) n++;
            dir = 1;
            hi = lo = v;
          }
        }
        return n;
      };
      const rx = reversals((s) => s.x), ry = reversals((s) => s.y);
      if (rx >= cfg.waveReversals && rx > ry) return { name: "wave", reset: true, data: { reversals: rx } };
      if (ry >= cfg.waveReversals && ry > rx) return { name: "shake", reset: true, data: { reversals: ry } };
      return null;
    }
  },
  {
    id: "twist",
    names: ["twist-cw", "twist-ccw"],
    detect: ({ h, now, cfg }) => {
      const cur = h[h.length - 1], old = back(h, now, cfg.twistMs);
      if (now - old.t < cfg.twistMs * 0.4) return null;
      let d = cur.roll - old.roll;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) < cfg.twistDeg * Math.PI / 180) return null;
      if (Math.hypot(cur.x - old.x, cur.y - old.y) > 0.12) return null;
      return { name: d > 0 ? "twist-cw" : "twist-ccw", reset: true, data: { degrees: Math.round(d * 180 / Math.PI) } };
    }
  },
  {
    id: "tap",
    names: ["tap", "double-tap"],
    cooldownMs: 0,
    detect: ({ h, now, cfg, mem }) => {
      const cur = h[h.length - 1];
      const closed = mem.closed === 1;
      if (!closed && cur.pinch > 0.75) {
        mem.closed = 1;
        mem.closedAt = now;
        return null;
      }
      if (closed && cur.pinch < 0.4) {
        mem.closed = 0;
        if (now - mem.closedAt > cfg.tapMs) return null;
        const dbl = now - (mem.lastTap ?? -1e9) < cfg.doubleTapMs;
        mem.lastTap = dbl ? -1e9 : now;
        return { name: dbl ? "double-tap" : "tap" };
      }
      return null;
    }
  }
];
var MOTION_INFO = {
  "swipe-left": { name: "Swipe left", emoji: "\u2B05\uFE0F", hint: "Sweep your hand quickly to the left" },
  "swipe-right": { name: "Swipe right", emoji: "\u27A1\uFE0F", hint: "Sweep your hand quickly to the right" },
  "swipe-up": { name: "Swipe up", emoji: "\u2B06\uFE0F", hint: "Sweep your hand quickly upward" },
  "swipe-down": { name: "Swipe down", emoji: "\u2B07\uFE0F", hint: "Sweep your hand quickly downward" },
  push: { name: "Push", emoji: "\u{1FAF7}", hint: "Push your open palm toward the camera" },
  pull: { name: "Pull", emoji: "\u{1FAF3}", hint: "Pull your hand back away from the camera" },
  "circle-cw": { name: "Circle clockwise", emoji: "\u{1F503}", hint: "Draw a circle in the air, clockwise" },
  "circle-ccw": { name: "Circle anticlockwise", emoji: "\u{1F504}", hint: "Draw a circle in the air, anticlockwise" },
  wave: { name: "Wave", emoji: "\u{1F44B}", hint: "Wave side to side a few times" },
  shake: { name: "Shake", emoji: "\u{1FAE8}", hint: "Shake your hand up and down a few times" },
  "twist-cw": { name: "Twist clockwise", emoji: "\u{1F529}", hint: "Turn your hand like a doorknob, clockwise" },
  "twist-ccw": { name: "Twist anticlockwise", emoji: "\u{1F5DD}\uFE0F", hint: "Turn your hand like a doorknob, anticlockwise" },
  tap: { name: "Pinch tap", emoji: "\u{1F446}", hint: "Quickly pinch thumb and index, then release" },
  "double-tap": { name: "Double pinch tap", emoji: "\u270C\uFE0F", hint: "Two quick pinch taps" },
  throw: { name: "Throw", emoji: "\u{1F93E}", hint: "Make a fist, then fling it open while moving fast" },
  hold: { name: "Hold a pose", emoji: "\u23F3", hint: "Keep any pose still for a moment" },
  clap: { name: "Clap", emoji: "\u{1F44F}", hint: "Clap both open hands together", hands: 2 },
  "zoom-in": { name: "Spread (zoom in)", emoji: "\u2194\uFE0F", hint: "Pinch with both hands, then pull them apart", hands: 2 },
  "zoom-out": { name: "Squeeze (zoom out)", emoji: "\u{1F932}", hint: "Pinch with both hands apart, then bring them together", hands: 2 },
  "steer-left": { name: "Steer left", emoji: "\u{1F6DE}", hint: "Both fists on a wheel, turn it left", hands: 2 },
  "steer-right": { name: "Steer right", emoji: "\u{1F3CE}\uFE0F", hint: "Both fists on a wheel, turn it right", hands: 2 }
};

// poses.ts
var deg = (d) => d * Math.PI / 180;
var pinchOf = (f, i = 0) => 1 - smooth(0.2, 0.42, f.tipGap[i]);
var together = (f, idx) => Math.min(...idx.map((i) => 1 - smooth(deg(12), deg(26), f.spread[i])));
var lShape = (f) => smooth(deg(22), deg(42), Math.acos(Math.max(-1, Math.min(1, f.thumbDir.x * f.pointDir.x + f.thumbDir.y * f.pointDir.y))));
var POSES = [
  {
    id: "open",
    name: "Open palm",
    emoji: "\u270B",
    hint: "All five fingers out, palm to the camera",
    fingers: ["ext", "ext", "ext", "ext", "ext"],
    extra: (f) => 1 - 0.5 * smooth(0.1, -0.35, f.facing)
  },
  {
    id: "back",
    name: "Back of hand",
    emoji: "\u{1F91A}",
    hint: "Open hand, turn the back of it to the camera",
    fingers: ["any", "ext", "ext", "ext", "ext"],
    extra: (f) => smooth(0.1, -0.35, f.facing),
    experimental: true
  },
  {
    id: "chop",
    name: "Karate chop",
    emoji: "\u{1F52A}",
    hint: "Flat hand, fingers together, turned edge-on like a blade",
    fingers: ["any", "ext", "ext", "ext", "ext"],
    extra: (f) => (1 - smooth(0.2, 0.5, Math.abs(f.facing))) * together(f, [0, 1, 2]),
    experimental: true
  },
  {
    id: "fist",
    name: "Fist",
    emoji: "\u270A",
    hint: "Close all fingers tight",
    fingers: ["any", "curl", "curl", "curl", "curl"],
    extra: (f) => 1 - 0.6 * smooth(0.55, 0.9, f.thumbOut)
  },
  {
    id: "claw",
    name: "Claw",
    emoji: "\u{1F985}",
    hint: "Fingers half bent like grabbing a ball",
    fingers: ["any", "half", "half", "half", "half"],
    extra: (f) => smooth(0.28, 0.45, f.tipGap[0])
  },
  {
    id: "point",
    name: "Point",
    emoji: "\u261D\uFE0F",
    hint: "Index finger out, the rest curled",
    fingers: ["any", "ext", "curl", "curl", "curl"],
    extra: (f) => 1 - 0.45 * f.thumbOut * lShape(f)
  },
  {
    id: "middle",
    name: "Middle finger",
    emoji: "\u{1F595}",
    hint: "Only the middle finger up",
    fingers: ["any", "curl", "ext", "curl", "curl"]
  },
  {
    id: "victory",
    name: "Peace / V",
    emoji: "\u270C\uFE0F",
    hint: "Index and middle up in a V",
    fingers: ["any", "ext", "ext", "curl", "curl"],
    extra: (f) => smooth(deg(9), deg(17), f.spread[0])
  },
  {
    id: "two",
    name: "Two together",
    emoji: "\u{1FAF8}",
    hint: "Index and middle up, pressed together",
    fingers: ["any", "ext", "ext", "curl", "curl"],
    extra: (f) => 1 - smooth(deg(7), deg(14), f.spread[0]),
    experimental: true
  },
  {
    id: "three",
    name: "Three",
    emoji: "3\uFE0F\u20E3",
    hint: "Index, middle and ring up, thumb holds the pinky",
    fingers: ["notext", "ext", "ext", "ext", "curl"]
  },
  {
    id: "four",
    name: "Four",
    emoji: "4\uFE0F\u20E3",
    hint: "Four fingers up, thumb tucked into the palm",
    fingers: ["curl", "ext", "ext", "ext", "ext"]
  },
  {
    id: "thumbs-up",
    name: "Thumbs up",
    emoji: "\u{1F44D}",
    hint: "Fist with the thumb pointing up",
    fingers: ["ext", "curl", "curl", "curl", "curl"],
    extra: (f) => smooth(0.35, 0.75, -f.thumbDir.y)
  },
  {
    id: "thumbs-down",
    name: "Thumbs down",
    emoji: "\u{1F44E}",
    hint: "Fist with the thumb pointing down",
    fingers: ["ext", "curl", "curl", "curl", "curl"],
    extra: (f) => smooth(0.35, 0.75, f.thumbDir.y)
  },
  {
    id: "rock",
    name: "Rock on",
    emoji: "\u{1F918}",
    hint: "Index and pinky up, middle and ring down",
    fingers: ["any", "ext", "curl", "curl", "ext"]
  },
  {
    id: "shaka",
    name: "Call me / shaka",
    emoji: "\u{1F919}",
    hint: "Thumb and pinky out, the rest curled",
    fingers: ["ext", "curl", "curl", "curl", "ext"]
  },
  {
    id: "gun",
    name: "Finger gun / L",
    emoji: "\u{1F449}",
    hint: "Thumb up and index out in an L",
    fingers: ["ext", "ext", "curl", "curl", "curl"],
    extra: lShape
  },
  {
    id: "pinch",
    name: "Pinch",
    emoji: "\u{1F90F}",
    hint: "Touch thumb and index tips",
    fingers: ["any", "notcurl", "any", "any", "any"],
    extra: (f) => pinchOf(f, 0)
  },
  {
    id: "ok",
    name: "OK sign",
    emoji: "\u{1F44C}",
    hint: "Thumb and index make a ring, other fingers up",
    fingers: ["any", "any", "ext", "ext", "ext"],
    extra: (f) => pinchOf(f, 0)
  },
  {
    id: "pinch-middle",
    name: "Middle pinch",
    emoji: "\u{1FAF0}",
    hint: "Touch thumb and middle tips (snap-ready)",
    fingers: ["any", "any", "notcurl", "any", "any"],
    extra: (f) => pinchOf(f, 1) * smooth(0.25, 0.5, f.tipGap[0])
  },
  {
    id: "spock",
    name: "Vulcan salute",
    emoji: "\u{1F596}",
    hint: "Four fingers up, split between middle and ring",
    fingers: ["any", "ext", "ext", "ext", "ext"],
    extra: (f) => smooth(deg(14), deg(24), f.spread[1]) * together(f, [0, 2]),
    experimental: true
  }
];
function ruleScore(rule, curl, thumbOut, thumb) {
  if (rule === "any") return 1;
  const ext = thumb ? thumbOut : 1 - smooth(0.3, 0.62, curl);
  const cur = thumb ? 1 - thumbOut : smooth(0.5, 0.74, curl);
  switch (rule) {
    case "ext":
      return ext;
    case "curl":
      return cur;
    case "notcurl":
      return 1 - cur;
    case "notext":
      return 1 - ext;
    case "half":
      return thumb ? 1 : smooth(0.15, 0.32, curl) * (1 - smooth(0.62, 0.8, curl));
  }
}
function scorePose(def, f) {
  let logSum = 0, n = 0, worst = 1;
  const add = (v) => {
    const c = Math.max(1e-4, v);
    logSum += Math.log(c);
    n++;
    if (c < worst) worst = c;
  };
  for (let i = 0; i < 5; i++) {
    const r = def.fingers[i];
    if (r !== "any") add(ruleScore(r, f.curl[i], f.thumbOut, i === 0));
  }
  if (def.extra) add(def.extra(f));
  const g = n ? Math.sqrt(Math.exp(logSum / n) * worst) : 0;
  return Math.min(1, g * (0.93 + 0.01 * n));
}

// engine.ts
var DEFAULT_POSE = { enter: 0.62, exit: 0.42, margin: 0.08, debounceMs: 70, experimental: true };
var DEFAULT_CONFIG = {
  pose: DEFAULT_POSE,
  motion: DEFAULT_MOTION,
  smoothing: { minCutoff: 2.2, beta: 8 }
};
var HISTORY_MS = 1600;
var LOST_MS = 250;
var GestureEngine = class {
  constructor(config = {}) {
    __publicField(this, "config");
    /** The latest frame (already updated when event listeners run). */
    __publicField(this, "frame", { t: 0, hands: [], twoHand: { present: false, distance: 0, angle: 0, zoom: 1 }, events: [] });
    __publicField(this, "poses");
    __publicField(this, "motions");
    __publicField(this, "tracks", []);
    __publicField(this, "nextId", 0);
    __publicField(this, "listeners", /* @__PURE__ */ new Map());
    __publicField(this, "two", { prevD: -1, clapSpeed: 0, clapCool: 0, grip: "", d0: 0, a0: 0, zoomFired: "", steerFired: "", lastT: 0, busyUntil: 0 });
    this.config = {
      pose: { ...DEFAULT_POSE, ...config.pose },
      motion: { ...DEFAULT_MOTION, ...config.motion },
      smoothing: { ...DEFAULT_CONFIG.smoothing, ...config.smoothing }
    };
    this.poses = [...POSES];
    this.motions = [...MOTIONS];
  }
  /** Add or replace a pose. */
  registerPose(def) {
    this.poses = [...this.poses.filter((p) => p.id !== def.id), def];
  }
  /** Add or replace a motion detector. */
  registerMotion(d) {
    this.motions = [...this.motions.filter((m) => m.id !== d.id), d];
  }
  /**
   * Listen to events. `name` is an event name ('fist', 'swipe-left', 'clap', …), a kind
   * ('pose' | 'motion' | 'two-hand') or '*' for everything. Returns an unsubscribe function.
   */
  on(name, fn) {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, set = /* @__PURE__ */ new Set());
    set.add(fn);
    return () => set.delete(fn);
  }
  /** Every gesture name the engine can emit (poses + motions + two-hand), for UIs. */
  get catalog() {
    return {
      poses: this.activePoses().map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, hint: p.hint, experimental: !!p.experimental })),
      motions: this.motions.flatMap((m) => m.names),
      twoHand: ["clap", "zoom-in", "zoom-out", "steer-left", "steer-right"]
    };
  }
  reset() {
    this.tracks = [];
    this.two.prevD = -1;
    this.two.grip = "";
  }
  activePoses() {
    return this.config.pose.experimental ? this.poses : this.poses.filter((p) => !p.experimental);
  }
  update(inputs, t) {
    const events = [];
    const emit = (e) => events.push(e);
    const live = this.assign(inputs, t);
    for (const tr of this.tracks) {
      if (t - tr.lastSeen > LOST_MS) {
        if (tr.pose) emit({ kind: "pose", name: tr.pose, phase: "end", hand: tr.id, t });
        tr.pose = null;
      }
    }
    this.tracks = this.tracks.filter((tr) => t - tr.lastSeen <= LOST_MS);
    const movers = live.map(([tr]) => tr).filter((tr) => Math.hypot(tr.vel.x, tr.vel.y) > 0.5);
    if (movers.length >= 2 && movers[0].vel.x * movers[1].vel.x + movers[0].vel.y * movers[1].vel.y < 0) this.two.busyUntil = t + 300;
    const busy = t < this.two.busyUntil;
    const hands = [];
    for (const [tr, input] of live) hands.push(this.updateHand(tr, input, t, emit, busy));
    hands.sort((a, b) => a.id - b.id);
    const twoHand = this.updateTwo(hands, t, emit);
    this.frame = { t, hands, twoHand, events };
    for (const e of events) this.dispatch(e);
    return this.frame;
  }
  // ---------------------------------------------------------------- hand identity
  assign(inputs, t) {
    const out = [];
    const free = new Set(this.tracks);
    const centre = (h) => {
      const L2 = h.landmarks;
      return { x: (L2[0].x + L2[9].x) / 2, y: (L2[0].y + L2[9].y) / 2 };
    };
    for (const h of inputs) {
      if (h.landmarks.length !== 21 || h.id === void 0) continue;
      let tr = this.tracks.find((x) => x.id === h.id);
      if (!tr) {
        tr = this.newTrack(h, h.id);
        this.tracks.push(tr);
      }
      free.delete(tr);
      out.push([tr, h]);
    }
    for (const h of inputs) {
      if (h.landmarks.length !== 21 || h.id !== void 0) continue;
      const c = centre(h);
      let best = null, bd = 0.35;
      for (const tr of free) {
        const r = tr.result;
        if (!r) continue;
        const d = Math.hypot(r.features.center.x - c.x, r.features.center.y - c.y) + (tr.handedness === h.handedness ? 0 : 0.1);
        if (d < bd) {
          bd = d;
          best = tr;
        }
      }
      if (!best) {
        best = this.newTrack(h);
        this.tracks.push(best);
      }
      free.delete(best);
      out.push([best, h]);
    }
    for (const [tr] of out) tr.lastSeen = t;
    return out;
  }
  newTrack(h, id) {
    const s = this.config.smoothing;
    const mk = () => Array.from({ length: 63 }, () => new OneEuroFilter({ minCutoff: s.minCutoff, beta: s.beta, dCutoff: 1 }));
    return {
      id: id ?? this.nextId++,
      handedness: h.handedness,
      lastSeen: 0,
      filters: mk(),
      wfilters: mk(),
      pose: null,
      poseSince: 0,
      cand: null,
      candSince: 0,
      held: false,
      hist: [],
      mem: {},
      cooldown: {},
      vel: { x: 0, y: 0 },
      result: null
    };
  }
  // ---------------------------------------------------------------- one hand
  updateHand(tr, input, t, emit, busy = false) {
    var _a, _b;
    const sec = t / 1e3;
    const filt = (pts, f2, scale) => pts.map((p, i) => ({
      x: f2[i * 3].filter(p.x * scale, sec) / scale,
      y: f2[i * 3 + 1].filter(p.y * scale, sec) / scale,
      z: f2[i * 3 + 2].filter(p.z * scale, sec) / scale
    }));
    const hand = {
      ...input,
      landmarks: filt(input.landmarks, tr.filters, 1),
      world: input.world && input.world.length === 21 ? filt(input.world, tr.wfilters, 10) : void 0
    };
    tr.handedness = input.handedness;
    const f = computeFeatures(hand);
    const scores = {};
    let best = null, bestS = 0;
    for (const p of this.activePoses()) {
      const s = scorePose(p, f);
      scores[p.id] = s;
      if (s > bestS) {
        bestS = s;
        best = p.id;
      }
    }
    const cfg = this.config.pose;
    const cur = tr.pose;
    const curS = cur ? scores[cur] ?? 0 : 0;
    let want = cur;
    if (cur && curS < cfg.exit) want = null;
    if (best && bestS >= cfg.enter && best !== cur && (!cur || bestS > curS + cfg.margin)) want = best;
    if (want !== cur) {
      if (tr.cand !== want) {
        tr.cand = want;
        tr.candSince = t;
      }
      const need = want === null ? cfg.debounceMs * 1.6 : cfg.debounceMs;
      if (t - tr.candSince >= need) {
        if (cur) emit({ kind: "pose", name: cur, phase: "end", hand: tr.id, t, data: { heldMs: Math.round(t - tr.poseSince) } });
        tr.pose = want;
        tr.poseSince = t;
        tr.held = false;
        if (want) emit({ kind: "pose", name: want, phase: "start", hand: tr.id, t, data: { score: +bestS.toFixed(2) } });
      }
    } else tr.cand = cur;
    if (tr.pose && !tr.held && t - tr.poseSince >= this.config.motion.holdMs) {
      tr.held = true;
      emit({ kind: "motion", name: "hold", hand: tr.id, t, data: { pose: tr.pose } });
    }
    const pinch = 1 - smooth(0.2, 0.42, f.tipGap[0]);
    const prev = tr.hist[tr.hist.length - 1];
    const sample = { t, x: f.center.x, y: f.center.y, size: f.size, roll: f.roll, pose: tr.pose, pinch, open: f.openness };
    if (prev && t > prev.t) {
      const dt = (t - prev.t) / 1e3, k = 1 - Math.exp(-dt / 0.06);
      tr.vel.x += k * ((sample.x - prev.x) / dt - tr.vel.x);
      tr.vel.y += k * ((sample.y - prev.y) / dt - tr.vel.y);
    }
    tr.hist.push(sample);
    while (tr.hist.length && t - tr.hist[0].t > HISTORY_MS) tr.hist.shift();
    for (const d of this.motions) {
      const mem = (_a = tr.mem)[_b = d.id] ?? (_a[_b] = {});
      const hit = d.detect({ h: tr.hist, now: t, cfg: this.config.motion, mem, busy });
      if (!hit) continue;
      const cd = d.cooldownMs ?? this.config.motion.cooldownMs;
      if (t < (tr.cooldown[d.id] ?? 0)) continue;
      tr.cooldown[d.id] = t + cd;
      emit({ kind: "motion", name: hit.name, hand: tr.id, t, data: hit.data });
      if (hit.reset) tr.hist = [sample];
    }
    const res = {
      id: tr.id,
      handedness: tr.handedness,
      features: f,
      pose: tr.pose,
      confidence: tr.pose ? scores[tr.pose] ?? 0 : 0,
      scores,
      heldMs: tr.pose ? t - tr.poseSince : 0,
      velocity: { ...tr.vel },
      pinch,
      landmarks: hand.landmarks
    };
    tr.result = res;
    return res;
  }
  // ---------------------------------------------------------------- two hands
  updateTwo(hands, t, emit) {
    const st = this.two, cfg = this.config.motion;
    const dt = st.lastT ? Math.min(0.1, (t - st.lastT) / 1e3) : 0;
    st.lastT = t;
    st.clapCool = Math.max(0, st.clapCool - dt);
    if (hands.length < 2) {
      st.prevD = -1;
      st.clapSpeed = 0;
      st.grip = "";
      return { present: false, distance: 0, angle: 0, zoom: 1 };
    }
    const [a, b] = [...hands].sort((p, q) => p.features.center.x - q.features.center.x);
    const ca = a.features.center, cb = b.features.center;
    const d = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const ang = Math.atan2(cb.y - ca.y, cb.x - ca.x);
    if (st.prevD >= 0 && dt > 0) st.clapSpeed = Math.max((st.prevD - d) / dt, st.clapSpeed - dt * 6);
    st.prevD = d;
    const opens = (h) => h.features.openness > 0.55;
    if (st.clapCool <= 0 && opens(a) && opens(b) && d < cfg.clapDist && st.clapSpeed > cfg.clapSpeed) {
      st.clapCool = 1;
      st.clapSpeed = 0;
      emit({ kind: "two-hand", name: "clap", t });
    }
    const gripOf = (h) => h.pinch > 0.7 ? "pinch" : h.pose === "fist" ? "fist" : "";
    const g = gripOf(a) && gripOf(a) === gripOf(b) ? gripOf(a) : "";
    if (g !== st.grip) {
      st.grip = g;
      st.d0 = d;
      st.a0 = ang;
      st.zoomFired = "";
      st.steerFired = "";
    }
    let zoom = 1;
    if (g) {
      zoom = st.d0 > 1e-3 ? d / st.d0 : 1;
      if (zoom > cfg.zoomIn && st.zoomFired !== "in") {
        st.zoomFired = "in";
        emit({ kind: "two-hand", name: "zoom-in", t, data: { zoom: +zoom.toFixed(2) } });
      }
      if (zoom < cfg.zoomOut && st.zoomFired !== "out") {
        st.zoomFired = "out";
        emit({ kind: "two-hand", name: "zoom-out", t, data: { zoom: +zoom.toFixed(2) } });
      }
      let da = ang - st.a0;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      const lim = cfg.steerDeg * Math.PI / 180;
      if (da > lim && st.steerFired !== "r") {
        st.steerFired = "r";
        emit({ kind: "two-hand", name: "steer-right", t, data: { degrees: Math.round(da * 180 / Math.PI) } });
      }
      if (da < -lim && st.steerFired !== "l") {
        st.steerFired = "l";
        emit({ kind: "two-hand", name: "steer-left", t, data: { degrees: Math.round(da * 180 / Math.PI) } });
      }
      if (Math.abs(da) < lim * 0.4) st.steerFired = "";
    }
    return { present: true, distance: d, angle: ang, zoom };
  }
  dispatch(e) {
    for (const key of [e.name, e.kind, "*"]) this.listeners.get(key)?.forEach((fn) => fn(e));
  }
};

// mediapipe.ts
function fromMediaPipe(hands, aspect, opts = {}) {
  const mirror = opts.mirror ?? true;
  const flip = opts.flipLabel ?? true;
  return hands.map((h) => ({
    landmarks: h.landmarks.map((p) => ({ x: mirror ? 1 - p.x : p.x, y: p.y, z: p.z })),
    world: h.world?.map((p) => ({ x: mirror ? -p.x : p.x, y: p.y, z: p.z })),
    handedness: flip ? h.label === "Left" ? "Right" : "Left" : h.label,
    aspect
  }));
}

// tracker.ts
var CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 60 }
  }
};
var LANDMARKER_OPTIONS = {
  runningMode: "VIDEO",
  numHands: 2,
  minHandDetectionConfidence: 0.6,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5
};
var GPU_FAILURES_BEFORE_FALLBACK = 3;
function assetUrl(path, assetBase) {
  const page = typeof document !== "undefined" ? document.baseURI : globalThis.location?.href ?? "/";
  const base = assetBase ? new URL(assetBase.endsWith("/") ? assetBase : assetBase + "/", page).href : page;
  return new URL(path, base).href.replace(/\/$/, "");
}
var HandTracker = class {
  constructor(video, options = {}) {
    this.video = video;
    this.options = options;
    __publicField(this, "delegate", null);
    /** Detections per second (measured over ~0.5 s windows). */
    __publicField(this, "fps", 0);
    /** Called if the camera track ends (unplugged, permission revoked…). */
    __publicField(this, "onEnded", null);
    __publicField(this, "landmarker", null);
    __publicField(this, "fileset", null);
    __publicField(this, "stream", null);
    __publicField(this, "lastVideoTime", -1);
    __publicField(this, "lastTs", 0);
    __publicField(this, "lastFrameTime", 0);
    __publicField(this, "failures", 0);
    __publicField(this, "rebuilding", false);
    __publicField(this, "fpsCount", 0);
    __publicField(this, "fpsWindowStart", 0);
    __publicField(this, "rvfcHandle", 0);
    __publicField(this, "rvfcTime", NaN);
    __publicField(this, "lastRvfcUsed", NaN);
    __publicField(this, "lastDetectNow", 0);
    __publicField(this, "stopped", false);
  }
  /** Opens the camera and loads the model in parallel. Throws on failure. */
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("Camera API unavailable (insecure context or unsupported browser)"), { name: "NotSupportedError" });
    }
    this.stopped = false;
    const camera = this.openCamera();
    const model = this.createLandmarker();
    const [camRes, modelRes] = await Promise.allSettled([camera, model]);
    if (camRes.status === "rejected" || modelRes.status === "rejected") {
      this.stop();
      if (modelRes.status === "fulfilled") modelRes.value.close();
      throw camRes.status === "rejected" ? camRes.reason : modelRes.reason;
    }
    this.landmarker = modelRes.value;
    this.watchFrames();
  }
  async openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia(this.options.camera ?? CAMERA_CONSTRAINTS);
    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (!this.stopped) this.onEnded?.();
      });
    }
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.srcObject = stream;
    if (v.readyState < 2) {
      await new Promise((resolve, reject) => {
        const ok = () => {
          cleanup();
          resolve();
        };
        const bad = () => {
          cleanup();
          reject(new Error("Video element failed to load the camera stream"));
        };
        const cleanup = () => {
          v.removeEventListener("loadeddata", ok);
          v.removeEventListener("error", bad);
        };
        v.addEventListener("loadeddata", ok);
        v.addEventListener("error", bad);
      });
    }
    await v.play().catch(() => {
    });
  }
  async createLandmarker(cpuOnly = false) {
    const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
    if (!this.fileset) this.fileset = await FilesetResolver.forVisionTasks(this.options.wasmUrl ?? assetUrl("wasm", this.options.assetBase));
    const fileset = this.fileset;
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      ...LANDMARKER_OPTIONS,
      numHands: this.options.numHands ?? LANDMARKER_OPTIONS.numHands,
      baseOptions: { modelAssetPath: this.options.modelUrl ?? assetUrl("models/hand_landmarker.task", this.options.assetBase), delegate }
    });
    if (!cpuOnly) {
      try {
        const lm2 = await make("GPU");
        this.delegate = "GPU";
        return lm2;
      } catch (err) {
        console.warn("[hand-gesture-kit] GPU delegate unavailable, falling back to CPU:", err);
      }
    }
    const lm = await make("CPU");
    this.delegate = "CPU";
    return lm;
  }
  /** Records the capture time of each presented frame (more accurate than rAF time). */
  watchFrames() {
    const v = this.video;
    if (!v.requestVideoFrameCallback) return;
    const cb = (now, meta) => {
      if (this.stopped) return;
      const t = meta.captureTime ?? meta.expectedDisplayTime ?? now;
      this.rvfcTime = Number.isFinite(t) ? t : now;
      this.rvfcHandle = v.requestVideoFrameCallback(cb);
    };
    this.rvfcHandle = v.requestVideoFrameCallback(cb);
  }
  get running() {
    return !!this.landmarker && !this.stopped;
  }
  /** Runs the model if a new video frame is available; null otherwise. */
  detect(now) {
    const v = this.video, lm = this.landmarker;
    if (!lm || this.rebuilding || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
    const ct = v.currentTime;
    if (ct === this.lastVideoTime) return null;
    this.lastVideoTime = ct;
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;
    let res;
    try {
      res = lm.detectForVideo(v, ts);
      this.failures = 0;
    } catch (err) {
      this.onDetectError(err);
      return null;
    }
    this.fpsCount++;
    if (!this.fpsWindowStart) this.fpsWindowStart = now;
    const span = now - this.fpsWindowStart;
    if (span >= 500) {
      const inst = this.fpsCount * 1e3 / span;
      this.fps = this.fps ? this.fps * 0.5 + inst * 0.5 : inst;
      this.fpsCount = 0;
      this.fpsWindowStart = now;
    }
    const hands = [];
    for (let i = 0; i < res.landmarks.length; i++) {
      const lms = res.landmarks[i];
      if (!lms || lms.length < 21) continue;
      const cat = res.handedness[i]?.[0];
      hands.push({
        landmarks: lms.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        world: res.worldLandmarks?.[i]?.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        label: cat?.categoryName === "Left" ? "Left" : "Right",
        score: cat?.score ?? 0.5
      });
    }
    let frameTime;
    if (Number.isFinite(this.rvfcTime) && this.rvfcTime !== this.lastRvfcUsed) {
      frameTime = this.rvfcTime;
      this.lastRvfcUsed = this.rvfcTime;
    } else {
      frameTime = this.lastFrameTime ? this.lastFrameTime + (now - this.lastDetectNow) : now;
    }
    if (frameTime <= this.lastFrameTime) frameTime = this.lastFrameTime + 1;
    this.lastFrameTime = frameTime;
    this.lastDetectNow = now;
    return { hands, frameTime, aspect: v.videoWidth / v.videoHeight };
  }
  onDetectError(err) {
    this.failures++;
    if (this.failures === 1) console.warn("[hand-gesture-kit] hand detection failed:", err);
    if (this.delegate === "GPU" && this.failures >= GPU_FAILURES_BEFORE_FALLBACK && !this.rebuilding) {
      this.rebuilding = true;
      const old = this.landmarker;
      this.createLandmarker(true).then((lm) => {
        if (this.stopped) lm.close();
        else {
          this.landmarker = lm;
          old?.close();
        }
      }).catch((e) => console.error("[hand-gesture-kit] CPU fallback failed:", e)).finally(() => {
        this.rebuilding = false;
        this.failures = 0;
      });
    }
  }
  stop() {
    this.stopped = true;
    const v = this.video;
    if (this.rvfcHandle && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.rvfcHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
};

// hands.ts
function createHands(opts = {}) {
  const video = opts.video ?? Object.assign(document.createElement("video"), { muted: true, playsInline: true });
  const engine = opts.engine ?? new GestureEngine(opts.config);
  const tracker = new HandTracker(video, opts);
  let injected = null;
  let camera = false;
  let offset = 0;
  let lastT = -Infinity;
  let raf = 0;
  const step = (hands, t) => {
    t = Math.max(t + offset, lastT + 0.5);
    lastT = t;
    const frame = engine.update(hands, t);
    opts.onFrame?.(frame);
    return frame;
  };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (injected) {
      step(injected, now);
      return;
    }
    if (!camera) return;
    const det = tracker.detect(now);
    if (det) step(fromMediaPipe(det.hands, det.aspect), det.frameTime);
  };
  raf = requestAnimationFrame(loop);
  return {
    engine,
    tracker,
    video,
    get frame() {
      return engine.frame;
    },
    get source() {
      return injected ? "synthetic" : camera ? "camera" : "none";
    },
    async startCamera() {
      await tracker.start();
      camera = true;
    },
    inject(h) {
      injected = h;
    },
    feed(clip, dtMs = 1e3 / 30) {
      return clip.map((hands) => {
        offset += dtMs;
        return step(hands, performance.now());
      });
    },
    stop() {
      cancelAnimationFrame(raf);
      tracker.stop();
      camera = false;
    }
  };
}
var DEFAULT_REGION = { x0: 0.12, x1: 0.88, y0: 0.08, y1: 0.78 };
function toScreen(p, r = DEFAULT_REGION) {
  const c = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  return { x: c((p.x - r.x0) / (r.x1 - r.x0)), y: c((p.y - r.y0) / (r.y1 - r.y0)) };
}
function fromScreen(p, r = DEFAULT_REGION) {
  return { x: r.x0 + p.x * (r.x1 - r.x0), y: r.y0 + p.y * (r.y1 - r.y0) };
}

// draw.ts
var HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17]
];
function drawHand(ctx, landmarks, w, h, o = {}) {
  if (landmarks.length < 21) return;
  const map = o.map ?? ((p) => p);
  const pts = landmarks.map((p) => {
    const q = map(p);
    return { x: q.x * w, y: q.y * h };
  });
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = o.color ?? "#7cf";
  ctx.lineWidth = o.lineWidth ?? 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();
  const r = o.jointRadius ?? 4;
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// synthetic.ts
var SYNTHETIC_POSES = {
  open: { curl: [0, 0, 0, 0, 0], pinch: 0 },
  relaxed: { curl: [0.2, 0.25, 0.3, 0.35, 0.4], pinch: 0 },
  fist: { curl: [1, 1, 1, 1, 1], pinch: 0 },
  point: { curl: [1, 0, 1, 1, 1], pinch: 0 },
  middle: { curl: [1, 1, 0, 1, 1], pinch: 0 },
  victory: { curl: [1, 0, 0, 1, 1], pinch: 0, spread: 3 },
  three: { curl: [1, 0, 0, 0, 1], pinch: 0 },
  four: { curl: [1, 0, 0, 0, 0], pinch: 0 },
  rock: { curl: [1, 0, 1, 1, 0], pinch: 0 },
  shaka: { curl: [0, 1, 1, 1, 0], pinch: 0 },
  gun: { curl: [0, 0, 1, 1, 1], pinch: 0 },
  "thumbs-up": { curl: [0, 1, 1, 1, 1], pinch: 0, roll: -Math.PI / 2 },
  "thumbs-down": { curl: [0, 1, 1, 1, 1], pinch: 0, roll: Math.PI / 2 },
  pinch: { curl: [0, 0.5, 0.35, 0.4, 0.45], pinch: 1 },
  ok: { curl: [0, 0.5, 0, 0, 0], pinch: 1 },
  claw: { curl: [0.4, 0.45, 0.45, 0.45, 0.45], pinch: 0 }
};
var FINGERS = [
  { mcp: [-0.24, 0.96, 0], dir: 97, seg: [0.48, 0.28, 0.22] },
  // index
  { mcp: [0, 1, 0], dir: 90, seg: [0.52, 0.32, 0.24] },
  // middle
  { mcp: [0.19, 0.95, 0], dir: 84, seg: [0.48, 0.3, 0.22] },
  // ring
  { mcp: [0.36, 0.84, 0], dir: 76, seg: [0.38, 0.22, 0.2] }
  // pinky
];
var FLEX = [75, 100, 70];
var THUMB_OPEN = [[-0.22, 0.18, 0], [-0.48, 0.36, -0.02], [-0.71, 0.52, -0.03], [-0.91, 0.66, -0.04]];
var THUMB_TUCK = [[-0.2, 0.18, -0.02], [-0.38, 0.45, -0.12], [-0.3, 0.72, -0.3], [-0.08, 0.86, -0.42]];
var lerp = (a, b, t) => a + (b - a) * t;
var lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function handShape(pose) {
  const out = new Array(21);
  out[L.WRIST] = [0, 0, 0];
  for (let f = 0; f < 4; f++) {
    const { mcp, seg } = FINGERS[f];
    const dir = 90 + (FINGERS[f].dir - 90) * (pose.spread ?? 1);
    let c = pose.curl[f + 1];
    if (f === 0) c = Math.max(c, 0.5 * pose.pinch);
    const base = L.INDEX_MCP + f * 4;
    out[base] = mcp;
    const dx = Math.cos(dir * Math.PI / 180), dy = Math.sin(dir * Math.PI / 180);
    let p = mcp, phi = 0;
    for (let s = 0; s < 3; s++) {
      phi += FLEX[s] * c * Math.PI / 180;
      const cs = Math.cos(phi), sn = Math.sin(phi);
      p = [p[0] + seg[s] * dx * cs, p[1] + seg[s] * dy * cs, p[2] - seg[s] * sn];
      out[base + 1 + s] = p;
    }
  }
  const tc = pose.curl[0];
  for (let i = 0; i < 4; i++) out[L.THUMB_CMC + i] = lerp3(THUMB_OPEN[i], THUMB_TUCK[i], tc);
  if (pose.pinch > 0) {
    const it = out[L.INDEX_TIP];
    const target = [it[0] - 0.07, it[1] - 0.06, it[2] + 0.02];
    const tip = out[L.THUMB_TIP];
    const delta = [target[0] - tip[0], target[1] - tip[1], target[2] - tip[2]];
    const w = [0.15, 0.4, 0.7, 1];
    for (let i = 0; i < 4; i++) {
      const k = w[i] * pose.pinch;
      const q = out[L.THUMB_CMC + i];
      out[L.THUMB_CMC + i] = [q[0] + delta[0] * k, q[1] + delta[1] * k, q[2] + delta[2] * k];
    }
  }
  if (pose.roll) {
    const c = Math.cos(pose.roll), s = Math.sin(pose.roll);
    for (let i = 0; i < 21; i++) {
      const [x, y, z] = out[i];
      out[i] = [x * c - y * s, x * s + y * c, z];
    }
  }
  return out;
}
var tipMid = (s) => [(s[L.THUMB_TIP][0] + s[L.INDEX_TIP][0]) / 2, (s[L.THUMB_TIP][1] + s[L.INDEX_TIP][1]) / 2];
function screenHandLandmarks(x, y, pose, o = {}) {
  const scale = o.scale ?? 0.14, aspect = o.aspect ?? 16 / 9;
  const sx = o.handedness === "Left" ? -1 : 1;
  const s = handShape(pose);
  const [mx, my] = tipMid(s);
  return s.map(([lx, ly, lz]) => ({
    x: x + sx * (lx - mx) * scale / aspect,
    y: y - (ly - my) * scale,
    z: lz * scale
  }));
}
function syntheticHand(x, y, pose, o = {}) {
  const opts = { handedness: o.handedness ?? "Right", scale: o.scale ?? 0.2, aspect: o.aspect ?? 16 / 9 };
  const lm = screenHandLandmarks(x, y, pose, opts);
  const palm = [L.WRIST, L.INDEX_MCP, L.MIDDLE_MCP, L.RING_MCP, L.PINKY_MCP];
  const cx = palm.reduce((a, i) => a + lm[i].x, 0) / palm.length, cy = palm.reduce((a, i) => a + lm[i].y, 0) / palm.length;
  const landmarks = lm.map((p) => ({ x: p.x + x - cx, y: p.y + y - cy, z: p.z }));
  return { landmarks, handedness: opts.handedness, aspect: opts.aspect };
}
export {
  CAMERA_CONSTRAINTS,
  DEFAULT_CONFIG,
  DEFAULT_MOTION,
  DEFAULT_POSE,
  DEFAULT_REGION,
  GestureEngine,
  HAND_CONNECTIONS,
  HandTracker,
  L as LANDMARK,
  MOTIONS,
  MOTION_INFO,
  OneEuroFilter,
  OneEuroFilter2D,
  POSES,
  SYNTHETIC_POSES,
  clamp01,
  computeFeatures,
  createHands,
  drawHand,
  fromMediaPipe,
  fromScreen,
  handShape,
  ruleScore,
  scorePose,
  screenHandLandmarks,
  smooth,
  syntheticHand,
  toScreen
};
