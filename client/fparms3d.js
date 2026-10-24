// Your own arms in first person, after Cloak of Death's (FirstPersonArms.cs):
// drawn in front of the camera in your shirt sleeves, jointed – the shoulder
// out of view, the elbow bending down and out (a two-bone solve), the wrist
// bending only so far before the forearm follows the hand round. The hands
// have fingers that close round what they hold: a pan by its handle, a pot by
// its two side handles (both hands), a plate or food on the open palm. They
// reach out to take a thing from where it lies and to put it down where it
// goes; with nothing to hold they drop out of view.
//
// Camera space (three.js): x right, y up, looking down -z. A hand is modelled
// in metres – a right hand: wrist at the origin, fingers along -z, thumb +y,
// palm facing -x; the left hand is its mirror – and drawn at HS of that (the
// kitchen's scale: a counter is about half a unit high).
import * as THREE from 'three';
import { mat } from './parts3d.js';

const HS = 0.5;
const UPPER = 0.17, FORE = 0.155, SLIDE = 0.22; // arm bones; how far the (unseen) shoulder may come forward
const REACH = (UPPER + FORE) * 0.985 + SLIDE;  // further than that, the hand stops (and the thing comes to it)
const LEAN = 0.16; // how far you lean in toward something out of reach
const SHOULDER = new THREE.Vector3(0.12, -0.24, 0.05);
const POLE = new THREE.Vector3(0.55, -0.8, 0.25).normalize(); // the right elbow points down, out and back
const WRIST = 1.1; // how far a hand bends from its forearm (rad) before the forearm follows it round
const OUT = 0.26, BACK = 0.32; // a reach: out to the thing, and back
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const Z = v(0, 0, 1); // (hand space) toward the elbow

// hand space, metres
const FIST = v(-0.03, 0, -0.1);          // the axis a closed fist holds
const PALM = v(-0.026, 0, -0.058);       // the middle of the palm's face
const ON_PALM = v(-0.034, 0, -0.06);     // where something sits on it
const IN_FIST = v(0, 0.87, -0.5);        // a handle through the fist (a hammer grip: tilted toward the fingers)
// fingers, index (by the thumb) to little: height on the hand, then the three bones
const FINGERS = [[0.029, 0.044, 0.026, 0.02], [0.01, 0.048, 0.028, 0.022], [-0.009, 0.045, 0.026, 0.02], [-0.028, 0.036, 0.02, 0.016]];
const BEND = [0.6, 1.66, 1.22]; // a fist: how far each knuckle bends
const THUMB = { base: v(-0.006, 0.036, -0.012), open: [v(-0.02, 0.058, -0.05), v(-0.024, 0.066, -0.086)], fist: [v(-0.04, 0.05, -0.058), v(-0.06, 0.05, -0.1)] };

// How a right hand holds things, in camera space: the grip point there, hand
// direction a turned to b, and twisted so the forearm (or the palm) goes the
// way of pref; how far the fingers close. The left hand is the mirror image.
const HOLDS = {
  handle: { at: v(0.12, -0.15, -0.3), grip: FIST, a: IN_FIST, b: v(-0.42, 0.1, -1), c: Z, pref: v(0.3, -0.7, 0.8), curl: 1 },
  palm: { at: v(0.1, -0.13, -0.26), grip: PALM, a: v(-1, 0, 0), b: v(-0.15, 1, 0.1), c: Z, pref: v(0.2, -0.5, 1), curl: 0.3 },
  side: { at: v(0.16, -0.17, -0.34), grip: PALM, a: v(-1, 0, 0), b: v(-1, 0.35, 0), c: Z, pref: v(0.35, -0.6, 0.8), curl: 0.55 },
  away: { at: v(0.13, -0.42, 0.02), grip: PALM, a: v(0, 0, -1), b: v(0, 0.4, -1), c: v(-1, 0, 0), pref: v(-0.3, -1, 0), curl: 0.35 },
};

// The rotation turning hand direction a to b, twisted round b so that hand
// direction c comes nearest pref.
function aim(a, b, c, pref) {
  const bn = b.clone().normalize(), pn = pref.clone().normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), bn);
  const q = new THREE.Quaternion(), tw = new THREE.Quaternion(), cv = new THREE.Vector3();
  let best = null, score = -Infinity;
  for (let i = 0; i < 36; i++) {
    tw.setFromAxisAngle(bn, (i * Math.PI) / 18);
    q.multiplyQuaternions(tw, q1);
    const s = cv.copy(c).applyQuaternion(q).dot(pn);
    if (s > score) { score = s; best = q.clone(); }
  }
  return best;
}
// a right hand's pose seen in a mirror (x → -x): the left hand's
const mirrorQ = (q) => new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
const mirrorV = (p, s) => (s < 0 ? v(-p.x, p.y, p.z) : p.clone());
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class FpArms {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.visible = false;
    camera.add(this.group);
    this.poseCache = new Map();
    // [left, right]: where each wrist is, how the hand is turned, how closed
    this.hands = [-1, 1].map((s) => {
      const p = this.pose(s, 'away');
      return { s, wrist: p.wrist.clone(), q: p.q.clone(), curl: p.curl, hold: 'away', reach: null, limb: null };
    });
  }

  // dressed as my cook: shirt sleeves, a white cuff, my skin
  setLook(look) {
    const key = `${look.shirt}|${look.skin}`;
    if (this.lookKey === key) return;
    this.lookKey = key;
    for (const h of this.hands) if (h.limb) this.group.remove(h.limb.root);
    const shirt = mat(look.shirt, { rough: 0.75 }), skin = mat(look.skin, { rough: 0.55 }), cuff = mat('#f6f2ea', { rough: 0.8 });
    const tube = new THREE.CylinderGeometry(0.85, 1, 1, 12, 1, true);
    const ball = new THREE.SphereGeometry(1, 12, 8);
    for (const h of this.hands) {
      const root = new THREE.Group();
      const upper = new THREE.Mesh(tube, shirt), fore = new THREE.Mesh(tube, shirt), elbow = new THREE.Mesh(ball, shirt);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), cuff);
      const hand = new THREE.Group();
      hand.scale.set(h.s * HS, HS, HS);
      const palm = new THREE.Mesh(ball, skin);
      palm.scale.set(0.017, 0.045, 0.05);
      palm.position.set(-0.002, 0.001, -0.046);
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.06, 12), skin);
      wrist.rotation.x = Math.PI / 2;
      wrist.position.z = 0.02;
      hand.add(palm, wrist);
      const bones = FINGERS.map(([, ...ls], i) => ls.map((l, j) => {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092 - i * 0.0005 - j * 0.0008, l, 3, 8), skin);
        hand.add(m);
        return m;
      }));
      const thumb = [0.0105, 0.0095].map((r, j) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, j ? 0.036 : 0.04, 3, 8), skin); hand.add(m); return m; });
      root.add(upper, fore, elbow, band, hand);
      root.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
      this.group.add(root);
      h.limb = { root, upper, fore, elbow, band, hand, bones, thumb };
    }
  }

  // A hold's pose for the hand on side s: {wrist, q, curl} (camera space).
  pose(s, kind, at = null) {
    const H = HOLDS[kind] || HOLDS.away;
    let base = this.poseCache.get(kind);
    if (!base) { base = aim(H.a, H.b, H.c, H.pref); this.poseCache.set(kind, base); }
    const grip = at ? at.clone() : H.at; // (in the right hand's space)
    const wrist = grip.clone().sub(H.grip.clone().multiplyScalar(HS).applyQuaternion(base));
    return { wrist: mirrorV(wrist, s), q: s < 0 ? mirrorQ(base) : base.clone(), curl: H.curl, grip: H.grip };
  }

  // Reaching out to a thing (a world point, its grip point): to take it (the
  // fingers open, close on it, and it comes back in the hand) or to put down
  // what the hand holds there. aimAt (world direction) turns a pan's handle
  // the way the pan lies.
  reach(i, r) {
    const h = this.hands[i];
    // something further off: lean in toward it (as far as LEAN)
    const tc = this.camera.worldToLocal(r.world.clone());
    const lean = Math.max(0, Math.min(LEAN, tc.distanceTo(mirrorV(SHOULDER, h.s)) - REACH + 0.06));
    h.reach = { t: 0, p: 0, from: null, lean, ...r };
  }
  reaching(i) { return this.hands[i].reach; }
  cancel() { for (const h of this.hands) h.reach = null; }
  // how far I'm leaning in now
  lean() { return Math.max(...this.hands.map((h) => (h.reach ? h.reach.lean * Math.sin(Math.PI * Math.min(1, h.reach.t / (OUT + BACK))) : 0))); }

  farPose(h, r) {
    const tc = this.camera.worldToLocal(r.world.clone());
    const right = mirrorV(tc, h.s);
    // out of reach: the hand stops at arm's length, toward it
    const sh = SHOULDER.clone(), toT = right.clone().sub(sh);
    const grip0 = (HOLDS[r.hold] || HOLDS.palm).grip.clone().multiplyScalar(HS).length();
    if (toT.length() > REACH - grip0) right.copy(sh).add(toT.setLength(REACH - grip0));
    let q;
    if (r.hold === 'palm') {
      // food, a plate: from above, the fingers toward it, palm down
      const from = SHOULDER.clone();
      q = aim(v(0, 0, -1), right.clone().sub(from), v(-1, 0, 0), v(0, -1, -0.2));
    } else if (r.aimAt) {
      const d = this.camera.worldToLocal(r.world.clone().add(r.aimAt)).sub(tc);
      q = aim(IN_FIST, mirrorV(d, h.s), Z, HOLDS.handle.pref);
    } else q = aim(HOLDS[r.hold].a, HOLDS[r.hold].b, HOLDS[r.hold].c, HOLDS[r.hold].pref);
    const grip = (HOLDS[r.hold] || HOLDS.palm).grip;
    const wrist = right.clone().sub(grip.clone().multiplyScalar(HS).applyQuaternion(q));
    return { wrist: mirrorV(wrist, h.s), q: h.s < 0 ? mirrorQ(q) : q, curl: r.take ? 0.08 : HOLDS[r.hold].curl };
  }

  // Each frame: holds[i] = {kind: 'handle' | 'palm' | 'side', at?} or null.
  update(dt, holds, { visible = true, walk = 0, t = 0 } = {}) {
    this.group.visible = visible;
    const k = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const hold = holds[i];
      const kind = hold ? hold.kind : 'away';
      const want = this.pose(h.s, kind, hold && hold.at);
      // a little sway as you walk
      if (walk > 0 && kind !== 'away') want.wrist.add(v(Math.sin(t * 9 + i) * 0.004, Math.abs(Math.sin(t * 9)) * 0.006, 0).multiplyScalar(Math.min(1, walk)));
      const r = h.reach;
      if (r) {
        r.t += dt;
        if (!r.from) r.from = { wrist: h.wrist.clone(), q: h.q.clone(), curl: h.curl };
        const far = this.farPose(h, r);
        if (r.t < OUT) {
          const e = ease(r.t / OUT);
          h.wrist.lerpVectors(r.from.wrist, far.wrist, e);
          h.q.slerpQuaternions(r.from.q, far.q, e);
          h.curl += (far.curl - h.curl) * Math.min(1, dt * 18);
          r.p = e;
        } else {
          if (!r.at) { r.at = true; if (r.take) r.grabbed = true; else r.released = true; }
          const u = ease((r.t - OUT) / BACK);
          h.wrist.lerpVectors(far.wrist, want.wrist, u);
          h.q.slerpQuaternions(far.q, want.q, u);
          h.curl += ((r.take ? want.curl : 0.3) - h.curl) * Math.min(1, dt * 16);
          r.p = 1 - u;
          if (u >= 1) h.reach = null;
        }
      } else {
        h.wrist.lerp(want.wrist, k);
        h.q.slerp(want.q, k);
        h.curl += (want.curl - h.curl) * k;
      }
      h.hold = kind;
      if (visible && h.limb) this.draw(h);
    }
    this.camera.updateMatrixWorld(true);
  }

  // Where a point of the hand (hand space, metres) is in the world.
  handPoint(i, local) {
    const h = this.hands[i];
    const p = v(h.s * local.x * HS, local.y * HS, local.z * HS).applyQuaternion(h.q).add(h.wrist);
    return p.applyMatrix4(this.camera.matrixWorld);
  }
  // a direction of the hand in the world
  handDir(i, local) {
    const h = this.hands[i];
    const d = v(h.s * local.x, local.y, local.z).applyQuaternion(h.q);
    return d.transformDirection(this.camera.matrixWorld);
  }
  fist(i) { return this.handPoint(i, FIST); }
  onPalm(i) { return this.handPoint(i, ON_PALM); }
  palm(i) { return this.handPoint(i, PALM); }
  handleDir(i) { return this.handDir(i, IN_FIST); }

  // the arm and hand, posed
  draw(h) {
    const L = h.limb;
    const s = h.s;
    const sh0 = mirrorV(SHOULDER, s);
    const w = h.wrist;
    // the shoulder comes forward (out of view) for a long reach
    let sh = sh0, d = w.distanceTo(sh0);
    const reach = (UPPER + FORE) * 0.985;
    if (d > reach) {
      sh = sh0.clone().add(w.clone().sub(sh0).normalize().multiplyScalar(Math.min(d - reach, SLIDE)));
      d = w.distanceTo(sh);
      if (d > reach) { w.copy(sh).add(w.clone().sub(sh).setLength(reach)); d = reach; } // (never a stretched arm)
    }
    d = Math.max(d, Math.abs(UPPER - FORE) + 0.02);
    const u = w.clone().sub(sh).normalize();
    const pole = mirrorV(POLE, s);
    pole.sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
    const cosA = Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)));
    let e = sh.clone().add(u.clone().multiplyScalar(UPPER * cosA)).add(pole.multiplyScalar(UPPER * Math.sqrt(1 - cosA * cosA)));
    // the wrist bends only so far: past that the forearm turns with the hand
    const back = Z.clone().applyQuaternion(h.q);
    let f = e.clone().sub(w).normalize();
    const ang = f.angleTo(back);
    if (ang > WRIST) {
      const q = new THREE.Quaternion().setFromUnitVectors(back, f);
      f = back.clone().applyQuaternion(new THREE.Quaternion().slerp(q, WRIST / ang));
      e = w.clone().add(f.clone().multiplyScalar(FORE));
    }
    const up = sh.clone().sub(e).normalize();
    tube(L.upper, e.clone().add(up.clone().multiplyScalar(UPPER + 0.25)), e, 0.024);
    tube(L.fore, e, w.clone().add(f.clone().multiplyScalar(0.014)), 0.021);
    L.elbow.position.copy(e);
    L.elbow.scale.setScalar(0.021);
    tube(L.band, w.clone().add(f.clone().multiplyScalar(0.022)), w.clone().add(f.clone().multiplyScalar(0.008)), 0.019);
    L.hand.position.copy(w);
    L.hand.quaternion.copy(h.q);
    // the fingers close as far as curl says
    const c = h.curl;
    FINGERS.forEach(([y, ...ls], i) => {
      let p = v(0.002, y, -0.084), A = 0;
      ls.forEach((l, j) => {
        A += 0.06 + c * BEND[j];
        const dir = v(-Math.sin(A), 0, -Math.cos(A));
        bone(L.bones[i][j], p, dir, l);
        p = p.clone().add(dir.multiplyScalar(l));
      });
    });
    const t1 = THUMB.open[0].clone().lerp(THUMB.fist[0], c), t2 = THUMB.open[1].clone().lerp(THUMB.fist[1], c);
    bone(L.thumb[0], THUMB.base, t1.clone().sub(THUMB.base).normalize(), 0.04);
    bone(L.thumb[1], t1, t2.clone().sub(t1).normalize(), 0.036);
  }
}

// a sleeve (the open cylinder, narrower at its top) from a to b, this thick
function tube(m, a, b, r) {
  const along = b.clone().sub(a);
  const len = along.length();
  if (len < 1e-4) return;
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v(0, 1, 0), along.divideScalar(len));
  m.scale.set(r, len, r);
}
// a finger bone (a capsule along y, its own length) from p along dir
function bone(m, p, dir, len) {
  m.position.copy(p).add(dir.clone().multiplyScalar(len / 2));
  m.quaternion.setFromUnitVectors(v(0, 1, 0), dir.clone().normalize());
}
