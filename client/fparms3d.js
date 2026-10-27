// Your own arms in first person, after Cloak of Death's (FirstPersonArms.cs):
// drawn in front of the camera in your shirt sleeves, jointed – the shoulder
// out of view, the elbow bending down and out (a two-bone solve), the wrist
// bending only so far before the forearm follows the hand round. The hands
// have fingers that close round what they hold: a pan by its handle, a pot by
// its two side handles (both hands), a plate or food on the open palm. They
// reach out to take a thing from where it lies and to put it down where it
// goes; with nothing to hold they rest flat on the worktop in front of me, as
// you lean on a counter (walking, they drop out of view).
//
// Camera space (three.js): x right, y up, looking down -z. A hand is modelled
// in metres – a right hand: wrist at the origin, fingers along -z, thumb +y,
// palm facing -x; the left hand is its mirror – and drawn at HS of that (the
// kitchen's scale: a counter is about half a unit high).
import * as THREE from 'three';
import { mat } from './parts3d.js';
import { toolMesh } from './cook3d.js';
import { mittPieces } from './props3d.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';

// ------------------------------------------------------------------ the hand itself
// A rigged hand – Godot XR Tools' (CC0: client/models/hand/License.md) – one smooth skin with knuckles, nails, the
// thumb's web, posed bone by bone from how closed the hand is. Its axes are this file's (fingers −z, the thumb +y,
// the palm −x); its wrist joint is 2.72 cm along z (moved to the origin) and it's a little long (×0.875 – the hand
// as long as before). Till it's loaded (or if it can't be), the old jointed one.
const RIG = { scene: null, wait: [] };
export function whenRig(f) { if (RIG.scene) f(); else RIG.wait.push(f); }
new GLTFLoader().load(new URL('./models/hand/Hand_Nails_R.gltf', import.meta.url).href, (g) => { RIG.scene = g.scene; for (const f of RIG.wait.splice(0)) f(); }, undefined, () => { RIG.wait.length = 0; });
const FINGER_BONES = ['Index', 'Middle', 'Ring', 'Little'].map((f) => ['Proximal', 'Intermediate', 'Distal'].map((b) => `${f}_${b}_R`));
const THUMB_BONES = ['Thumb_Metacarpal_R', 'Thumb_Proximal_R', 'Thumb_Distal_R'];
export const RIG_BEND = [1.45, 1.7, 1.15]; // a fist: how far each finger knuckle bends (rad)
export const RIG_SIGN = 1; // (which way round the bones' z is a bend toward the palm)
// The thumb's poses: each of its bones turned about its own x, z (rad) – found in test/hands.html (?search: by its
// tip's distance to where it should be; by eye, beside photos of real grips). open: as modelled; fist: wrapped over
// the fingers; pinch: its pad on the index's (with the index at 0.45 – a pinch of salt, a basil leaf); knife: its
// pad on the blade's side, the curled index on the other (the chef's grip); flat: along the index, the hand flat;
// along: lying along the top of a pan's handle
export const RIG_THUMB = {
  open: [[0, 0], [0, 0], [0, 0]], fist: [[-0.5, -0.2], [-0.42, 0.45], [0, 0.65]], pinch: [[-0.6, -0.4], [0, 0.8], [0, 0.4]],
  knife: [[-0.6, -0.6], [0, 0.6], [0, 1]], flat: [[-0.25, -0.6], [0, 0.2], [0, 0.2]], along: [[-0.3, -0.3], [0, 0], [0, 0]],
};
const thumbAt = (a, b, t) => RIG_THUMB[a].map((p, j) => [p[0] + (RIG_THUMB[b][j][0] - p[0]) * t, p[1] + (RIG_THUMB[b][j][1] - p[1]) * t]);
// (the pinch's point, between the thumb's and the index's tips – hand space, as the rigged hand is drawn)
const PINCH = new THREE.Vector3(-0.0383, 0.0247, -0.106).multiplyScalar(0.875);
// How each hold shapes the hand (c: how closed the scene asks it to be, 0 … 1): a curl for each finger – index to
// little – or each joint's bend (rad), and the thumb's pose.
const SHAPES = {
  handle: (c) => ({ fingers: [c, c, c * 1.02, c * 1.05], thumb: thumbAt('open', 'along', Math.min(1, c * 1.2)) }),
  tool: (c) => ({ thumb: thumbAt('open', 'fist', c) }),
  grab: (c) => ({ thumb: thumbAt('open', 'fist', c) }),
  knife: () => ({ fingers: [0.72, 1, 1, 1], thumb: RIG_THUMB.knife }),
  knifeFlat: () => ({ fingers: [0.45, 0.8, 0.85, 0.9], thumb: RIG_THUMB.flat }),
  pinch: (c) => ({ fingers: [0.45, 0.6, 0.8, 0.9].map((f) => f * (0.6 + 0.4 * Math.min(1, c / 0.6))), thumb: thumbAt('flat', 'pinch', Math.min(1, c / 0.6)) }),
  // (fingertips tucked under the knuckles, the thumb behind them: what the knife's blade runs along)
  claw: () => ({ joints: [[0.45, 1.5, 0.9], [0.4, 1.55, 0.9], [0.4, 1.5, 0.85], [0.45, 1.4, 0.8]], thumb: thumbAt('flat', 'fist', 0.55) }),
  // (open and relaxed – flat – closing toward a grasp: the thumb in along the index first, then over)
  hand: (c) => ({ thumb: c < 0.5 ? thumbAt('open', 'flat', c * 2) : thumbAt('flat', 'fist', (c - 0.5) * 2) }),
  rest: () => ({ fingers: [0.05, 0.05, 0.06, 0.07], thumb: RIG_THUMB.flat }),
  palm: () => ({ fingers: [0.15, 0.15, 0.17, 0.2], thumb: thumbAt('open', 'flat', 0.6) }),
  tub: () => ({ fingers: [0.3, 0.3, 0.32, 0.35], thumb: thumbAt('open', 'flat', 0.5) }),
  side: (c) => ({ fingers: [c * 0.75, c * 0.75, c * 0.78, c * 0.8], thumb: thumbAt('open', 'along', 0.5) }),
  away: () => ({ fingers: [0.25, 0.3, 0.33, 0.36], thumb: thumbAt('open', 'flat', 0.7) }),
};
export function shapeOf(hold, c) { const f = SHAPES[hold]; return f ? f(c) : {}; }
const qe = new THREE.Euler(), qq = new THREE.Quaternion();
// a hand of its own, skinned in this skin
export function makeRig(skin) {
  if (!RIG.scene) return null;
  const root = cloneRig(RIG.scene), inner = new THREE.Group();
  root.position.z = -0.0272;
  inner.add(root);
  inner.scale.setScalar(0.875);
  const bones = {};
  root.traverse((o) => {
    if (o.isBone) { bones[o.name] = o; o.userData.rest = o.quaternion.clone(); }
    if (o.isSkinnedMesh) { o.material = skin; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
  });
  return { root: inner, bones, fingers: FINGER_BONES.map((f) => f.map((n) => bones[n])), thumb: THUMB_BONES.map((n) => bones[n]) };
}
// posed: curl 0 open … 1 a fist (the little finger a little ahead); fingers: a curl each (else curl); joints: each
// joint's bend (rad) instead; thumb: its bones' turns – else from open to the fist as curl says
export function poseRig(R, curl, { fingers = null, joints = null, thumb = null } = {}) {
  R.fingers.forEach((f, i) => {
    const c = Math.max(0, Math.min(1.1, fingers ? fingers[i] : curl * (1 + 0.06 * i)));
    f.forEach((b, j) => { if (b) b.quaternion.copy(b.userData.rest).multiply(qq.setFromEuler(qe.set(0, 0, RIG_SIGN * (joints ? joints[i][j] : 0.06 + c * RIG_BEND[j])))); });
  });
  const T = thumb || thumbAt('open', 'fist', Math.max(0, Math.min(1, curl)));
  R.thumb.forEach((b, j) => { if (b) b.quaternion.copy(b.userData.rest).multiply(qq.setFromEuler(qe.set(T[j][0], 0, T[j][1]))); });
}

const HS = 0.5;
const UPPER = 0.17, FORE = 0.155, SLIDE = 0.3; // arm bones; how far the (unseen) shoulder may come forward
const REACH = (UPPER + FORE) * 0.985 + SLIDE;  // further than that, the hand stops (and the thing comes to it)
const LEAN = 0.16; // how far you lean in toward something out of reach
export const APART = 0.9; // how far apart my arms are (1: as they were first made – a little wide)
// (the right one, from my eyes: high enough that a forearm comes down onto the worktop – the elbow hanging at my
// side, not out level with the work)
export const SHOULDER = new THREE.Vector3(0.12 * APART, -0.18, 0.05);
const POLE = new THREE.Vector3(0.55, -0.8, 0.25).normalize(); // (a hold turned toward where the elbow hangs: down, out, back)
// How a person holds their arm (for the elbow's choice, and how far a wrist will bend before the hand gives):
// - the elbow hangs down by the side, a little out and back – not lifted out sideways ("chicken wing") nor up
//   toward the shoulder (RULA, McAtamney & Corlett 1993: an abducted or raised upper arm scores worse)
// - the wrist: comfortable within about ±15–20°; daily tasks need at most 54° flexion, 60° extension, 17° radial
//   and 40° ulnar deviation (Ryu et al. 1991) – past about 70° / 60° / 20° / 30° it can't go
// - the forearm turns about 80–90° either way from thumb-up; comfortable in the middle of that
const WRIST_EASY = { flex: 0.35, ext: 0.44, rad: 0.17, uln: 0.26 };  // (rad)
const WRIST_MOST = { flex: 1.2, ext: 1.0, rad: 0.35, uln: 0.52 };
const TWIST_EASY = 1.0, TWIST_MOST = 1.6;
const SWIVEL_EASY = 0.6; // (how far the elbow is swung round from hanging down before it's an effort)
// a reach: out to the thing and back – taking, the hand closes on it; putting
// down, it comes in from a little above, lowers it, rests a moment and lets go
export const BRISK = 1.5; // how quick my movements are (1: as they were first made – a little slow)
const OUT_TAKE = 0.42 / BRISK, OUT_PUT = 0.55 / BRISK, SETTLE = 0.14 / BRISK, BACK = 0.4 / BRISK, LIFT = 0.06;
const outOf = (r) => (r.take ? OUT_TAKE : OUT_PUT);
const spanOf = (r) => outOf(r) + (r.take ? 0 : SETTLE) + BACK;
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const Z = v(0, 0, 1); // (hand space) toward the elbow

// hand space, metres
export const FIST = v(-0.01, 0, -0.08);  // the axis a closed fist holds (inside the rigged hand's fist)
export const PALM = v(-0.026, 0, -0.058); // the middle of the palm's face
const ON_PALM = v(-0.034, 0, -0.06);     // where something sits on it
const UNDER_PALM = v(-0.03, 0.004, -0.06); // (lying flat: where the palm meets the worktop)
export const IN_FIST = v(0, 0.87, -0.5); // a handle through the fist (a hammer grip: tilted toward the fingers)
// (a chef's grip: the handle diagonal across the palm, from its heel to the index's knuckle – the blade going on
// forward from the forearm's line, not across it)
const KNIFE_IN = v(-0.1, 0.3, -0.95).normalize();
const ALONG_FIST = new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), IN_FIST.clone().normalize()); // (a tool's handle up the fist)
// fingers, index (by the thumb) to little: height on the hand, then the three bones
const FINGERS = [[0.029, 0.044, 0.026, 0.02], [0.01, 0.048, 0.028, 0.022], [-0.009, 0.045, 0.026, 0.02], [-0.028, 0.036, 0.02, 0.016]];
const BEND = [0.6, 1.66, 1.22]; // a fist: how far each knuckle bends
const THUMB = { base: v(-0.006, 0.036, -0.012), open: [v(-0.02, 0.058, -0.05), v(-0.024, 0.066, -0.086)], fist: [v(-0.04, 0.05, -0.058), v(-0.06, 0.05, -0.1)] };

// How a right hand holds things, in camera space: the grip point there, hand
// direction a turned to b, and twisted so the forearm (or the palm) goes the
// way of pref; how far the fingers close. The left hand is the mirror image.
// (toBody: turned round what it holds – dir – so the forearm runs back toward the shoulder, the wrist
// hardly bent)
export const HOLDS = {
  handle: { at: v(0.12, -0.16, -0.25), grip: FIST, a: IN_FIST, b: v(-0.42, 0.1, -1), c: Z, pref: v(0.3, -0.7, 0.8), curl: 1, toBody: true },
  palm: { at: v(0.1, -0.13, -0.26), grip: PALM, a: v(-1, 0, 0), b: v(-0.15, 1, 0.1), c: Z, pref: v(0.2, -0.5, 1), curl: 0.3 },
  // a food container on the palm, carried out in front at the waist
  tub: { at: v(0.06, -0.25, -0.4), grip: PALM, a: v(-1, 0, 0), b: v(-0.1, 1, 0.05), c: Z, pref: v(0.2, -0.5, 1), curl: 0.35 },
  side: { at: v(0.16, -0.17, -0.34), grip: PALM, a: v(-1, 0, 0), b: v(-1, 0.35, 0), c: Z, pref: v(0.35, -0.6, 0.8), curl: 0.55 },
  grab: { at: v(0.12, -0.12, -0.35), grip: FIST, a: IN_FIST, b: v(0, 1, 0.15), c: Z, pref: v(0.3, -0.6, 0.8), curl: 0.85, toBody: true }, // a door's handle
  // at work (first person): a tool upright in the fist, or the open hand palm down
  tool: { at: v(0.1, -0.1, -0.4), grip: FIST, a: IN_FIST, b: v(0, 1, 0.25), c: Z, pref: v(0.35, -0.5, 0.8), curl: 0.95 },
  // (the handle in the fist, the blade forward, its edge down: the knuckles along the top of
  // the handle, the back of the hand to the outside and a little up, the palm in – back: c → that)
  knife: { at: v(0.1, -0.1, -0.4), grip: FIST, a: KNIFE_IN, b: v(-0.45, -0.12, -1), c: v(1, 0, 0), pref: v(1, 0.35, 0), curl: 1, back: true },
  // (the same, turned palm down – the knife on its side, its edge away: crushing)
  knifeFlat: { at: v(0.1, -0.1, -0.4), grip: FIST, a: KNIFE_IN, b: v(-1, -0.1, -0.4), c: v(1, 0, 0), pref: v(0, 1, 0), curl: 1, top: true },
  // (a pinch: between the thumb's and the index's tips – a basil leaf, a pinch of salt, a garlic clove)
  pinch: { at: v(0.1, -0.1, -0.4), grip: PINCH, a: v(0, 0, -1), b: v(0, -0.8, -1), c: v(-1, 0, 0), pref: v(0, -1, 0), curl: 0.6 },
  hand: { at: v(0.1, -0.1, -0.4), grip: PALM, a: v(0, 0, -1), b: v(0, -0.45, -1), c: v(-1, 0, 0), pref: v(0, -1, 0), curl: 0.25 },
  claw: { at: v(-0.1, -0.1, -0.4), grip: PALM, a: v(0, 0, -1), b: v(0.2, -0.6, -1), c: v(-1, 0, 0), pref: v(0, -1, 0), curl: 0.55 },
  // resting on the worktop near its edge: the palm flat on it, the fingers straight on from the forearm
  // coming down to it (flat: palm down whatever the view)
  rest: { at: v(0.14, -0.3, -0.25), grip: UNDER_PALM, a: v(0, 0, -1), b: v(-0.3, -0.2, -1), c: v(-1, 0, 0), pref: v(0, -1, 0), curl: 0.1, flat: true },
  away: { at: v(0.13, -0.42, 0.02), grip: PALM, a: v(0, 0, -1), b: v(0, 0.4, -1), c: v(-1, 0, 0), pref: v(-0.3, -1, 0), curl: 0.35 },
};
for (const H of Object.values(HOLDS)) H.at.x *= APART; // (as close together as my shoulders)

// The rotation turning hand direction a to b, twisted round b so that hand
// direction c comes nearest pref (exactly: both seen end-on down b, the angle
// between them – so it turns smoothly as they move).
function aim(a, b, c, pref) {
  const bn = b.clone().normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), bn);
  const c1 = c.clone().applyQuaternion(q1);
  c1.addScaledVector(bn, -c1.dot(bn));
  const pp = pref.clone().addScaledVector(bn, -pref.dot(bn));
  if (c1.lengthSq() < 1e-8 || pp.lengthSq() < 1e-8) return q1;
  const ang = Math.atan2(new THREE.Vector3().crossVectors(c1, pp).dot(bn), c1.dot(pp));
  return new THREE.Quaternion().setFromAxisAngle(bn, ang).multiply(q1);
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
    // (the rigged hand loaded: the arms made again with it, next time they're drawn)
    whenRig(() => { this.lookKey = null; });
    // [left, right]: where each wrist is, how the hand is turned, how closed
    this.hands = [-1, 1].map((s) => {
      const p = this.pose(s, 'away');
      return { s, wrist: p.wrist.clone(), q: p.q.clone(), curl: p.curl, hold: 'away', reach: null, limb: null, sh: SHOULDER.clone(), fore: null };
    });
  }

  // dressed as my cook: shirt sleeves, a white cuff, my skin
  setLook(look) {
    const key = `${look.shirt}|${look.skin}`;
    if (this.lookKey === key) return;
    this.lookKey = key;
    for (const h of this.hands) if (h.limb) this.group.remove(h.limb.root);
    const shirt = mat(look.shirt, { rough: 0.75 }), skin = mat(look.skin, { rough: 0.55 }), cuff = mat('#f6f2ea', { rough: 0.8 });
    const cuffIn = cuff.clone(); cuffIn.side = THREE.DoubleSide; // (open: its inside seen round the wrist)
    const sleeve = fading(shirt);
    // (the rigged hand's skin: a soft warm sheen at its edges, as skin has)
    const skinRig = new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#ff9a8a'), sheenRoughness: 0.5 });
    const tube = new THREE.CylinderGeometry(0.85, 1, 1, 18, 1, true);
    const ball = new THREE.SphereGeometry(1, 24, 16);
    for (const h of this.hands) {
      const root = new THREE.Group();
      const upper = new THREE.Mesh(tube, sleeve), fore = new THREE.Mesh(tube, shirt), elbow = new THREE.Mesh(ball, shirt);
      upper.userData.noAO = true; // (see-through toward the shoulder: kept out of the ambient occlusion)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), cuffIn);
      const hand = new THREE.Group();
      hand.scale.set(h.s * HS, HS, HS);
      const palm = new THREE.Mesh(ball, skin);
      palm.scale.set(0.017, 0.045, 0.05);
      palm.position.set(-0.002, 0.001, -0.046);
      // (the wrist bends: it's laid between the hand and the forearm each frame)
      const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * HS, 0.026 * HS, 0.06 * HS, 14), skin);
      hand.add(palm);
      const bones = FINGERS.map(([, ...ls], i) => ls.map((l, j) => {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092 - i * 0.0005 - j * 0.0008, l, 3, 8), skin);
        hand.add(m);
        return m;
      }));
      const thumb = [0.0105, 0.0095].map((r, j) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, j ? 0.036 : 0.04, 3, 8), skin); hand.add(m); return m; });
      // the oven glove on it (shown while I wear them): the padded palm, the fingers' pocket hinged at the
      // knuckles, the thumb's, the cuff over my wrist
      const M = mittPieces(), mitt = new THREE.Group(), mFingers = new THREE.Group(), mThumb = new THREE.Group();
      mitt.add(new THREE.Mesh(M.palm, M.mat), new THREE.Mesh(M.cuff, M.mat), mFingers, mThumb);
      mFingers.position.set(-0.006, -0.003, -0.094);
      mFingers.add(new THREE.Mesh(M.fingers, M.mat));
      mThumb.position.copy(THUMB.base);
      mThumb.add(new THREE.Mesh(M.thumb, M.mat));
      mitt.visible = false;
      hand.add(mitt);
      // the rigged hand, when it's loaded (the jointed one stays, hidden – the way back if it isn't)
      const rig = makeRig(skinRig);
      if (rig) { hand.add(rig.root); for (const m of [palm, ...bones.flat(), ...thumb, wrist]) m.visible = false; }
      root.add(upper, fore, elbow, band, hand, wrist);
      root.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; } });
      this.group.add(root);
      h.limb = { root, upper, fore, elbow, band, hand, wrist, bones, thumb, palm, mitt, mFingers, mThumb, rig };
    }
    this.gloved = null; // (put on again as they're drawn)
  }

  // the oven gloves on my hands (or off)
  setGloves(on) {
    if (this.gloved === on) return;
    this.gloved = on;
    for (const h of this.hands) {
      const L = h.limb;
      if (!L) continue;
      L.mitt.visible = on;
      L.wrist.visible = !on && !L.rig;
      if (L.rig) L.rig.root.visible = !on;
      else for (const m of [L.palm, ...L.bones.flat(), ...L.thumb]) m.visible = !on;
    }
  }

  // A hold's pose for the hand on side s: {wrist, q, curl} (camera space);
  // dir (the right hand's camera space) turns the hold's own direction that way
  // (a fist along the handle it holds); sh: where its shoulder is (the right's).
  pose(s, kind, at = null, dir = null, sh = SHOULDER) {
    const H = HOLDS[kind] || HOLDS.away;
    let base = this.poseCache.get(kind);
    if (!base) { base = aim(H.a, H.b, H.c, H.pref); this.poseCache.set(kind, base); }
    const grip = at ? at.clone() : H.at.clone(); // (in the right hand's space)
    // (a knife: the back of the hand to the outside of the blade, a little up)
    if (dir) {
      const up = this.upLocal();
      if (s < 0) up.x = -up.x; // (in the right hand's space)
      const body = H.toBody && sh.clone().sub(grip).normalize().multiplyScalar(0.6).addScaledVector(POLE, 0.4); // (toward where the elbow hangs)
      base = aim(H.a, dir, H.c, H.back ? new THREE.Vector3().crossVectors(dir, up).normalize().addScaledVector(up, 0.35) : H.flat ? up.negate() : H.top ? up : body || H.pref);
    }
    // (no further than an arm reaches)
    const toG = grip.clone().sub(sh), gl = H.grip.clone().multiplyScalar(HS).length();
    if (toG.length() > REACH - gl) grip.copy(sh).add(toG.setLength(REACH - gl));
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
  // the world's up, in my camera's space (where the arms are)
  upLocal() { return new THREE.Vector3(0, 1, 0).transformDirection(this.camera.matrixWorldInverse); }
  cancel() { for (const h of this.hands) h.reach = null; }
  // how far I'm leaning in now
  lean() { return Math.max(...this.hands.map((h) => (h.reach ? h.reach.lean * Math.sin(Math.PI * Math.min(1, h.reach.t / spanOf(h.reach))) : 0))); }

  farPose(h, r) {
    const tc = this.camera.worldToLocal(r.world.clone());
    const right = mirrorV(tc, h.s);
    // out of reach: the hand stops at arm's length, toward it
    const sh = SHOULDER.clone(), toT = right.clone().sub(sh);
    const grip0 = (HOLDS[r.hold] || HOLDS.palm).grip.clone().multiplyScalar(HS).length();
    if (toT.length() > REACH - grip0) right.copy(sh).add(toT.setLength(REACH - grip0));
    let q;
    if (r.hold === 'palm' || r.hold === 'tub') {
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

  // Each frame: holds[i] = {kind: 'handle' | 'palm' | 'side', at?} or null. (A hand
  // resting on a worktop gives sh too: its shoulder where my body is – not turned
  // down with my eyes as I look at it, which would pull the hand off it.)
  // (hideAway: a camera that isn't my eyes – at work – would see a hand hanging at my side: once it's got there, it's not drawn)
  update(dt, holds, { visible = true, walk = 0, t = 0, hideAway = false } = {}) {
    this.group.visible = visible;
    // (the world's up, my back and my right in my eyes' space – which way an elbow hangs)
    const up = this.upLocal(), back = v(0, 0, 1).addScaledVector(up, -up.z);
    this.frame = { up, back: back.lengthSq() > 1e-6 ? back.normalize() : v(0, 0, 1), out: v(1, 0, 0).addScaledVector(up, -up.x).normalize() };
    const k = 1 - Math.exp(-dt * 12 * BRISK);
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const hold = holds[i];
      const kind = hold ? hold.kind : 'away';
      h.sh.lerp(hold && hold.sh || SHOULDER, k);
      // (resting: the fingers straight on from the forearm as it comes down to the worktop – seen from
      // above, no bend at the wrist)
      let dir = hold && hold.dir;
      if (kind === 'rest' && h.fore) {
        const up = this.upLocal(), f = h.fore.clone().addScaledVector(up, -h.fore.dot(up));
        if (f.lengthSq() > 1e-6) dir = mirrorV(f.normalize(), h.s);
      }
      const want = this.pose(h.s, kind, hold && hold.at, dir, h.sh);
      if (hold && hold.curl != null) want.curl = hold.curl;
      h.toolKind = hold && hold.tool || null;
      // a little sway as you walk
      if (walk > 0 && kind !== 'away' && kind !== 'rest') want.wrist.add(v(Math.sin(t * 9 + i) * 0.004, Math.abs(Math.sin(t * 9)) * 0.006, 0).multiplyScalar(Math.min(1, walk)));
      const r = h.reach;
      if (r) {
        r.t += dt;
        if (!r.from) r.from = { wrist: h.wrist.clone(), q: h.q.clone(), curl: h.curl };
        const far = this.farPose(h, r);
        const out = outOf(r), hold = out + (r.take ? 0 : SETTLE);
        if (r.t < out) {
          const e = ease(r.t / out);
          h.wrist.lerpVectors(r.from.wrist, far.wrist, e);
          // (putting down: over the spot first, then lowered onto it)
          if (!r.take) h.wrist.addScaledVector(this.upLocal(), LIFT * ease(Math.min(1, r.t / out / 0.3)) * (1 - ease(Math.max(0, (r.t / out - 0.5) / 0.5))));
          h.q.slerpQuaternions(r.from.q, far.q, e);
          h.curl += (far.curl - h.curl) * Math.min(1, dt * 18 * BRISK);
          r.p = e;
        } else if (r.t < hold) {
          // (set down: a moment's rest before the hand lets go)
          h.wrist.copy(far.wrist);
          h.q.copy(far.q);
          r.p = 1;
        } else {
          if (!r.at) { r.at = true; if (r.take) r.grabbed = true; else r.released = true; }
          const u = ease((r.t - hold) / BACK);
          h.wrist.lerpVectors(far.wrist, want.wrist, u);
          h.q.slerpQuaternions(far.q, want.q, u);
          h.curl += ((r.take ? want.curl : 0.3) - h.curl) * Math.min(1, dt * 16 * BRISK);
          r.p = 1 - u;
          if (u >= 1) h.reach = null;
        }
      } else {
        h.wrist.lerp(want.wrist, k);
        h.q.slerp(want.q, k);
        h.curl += (want.curl - h.curl) * k;
      }
      h.hold = kind;
      if (h.limb) h.limb.root.visible = !(hideAway && kind === 'away' && !h.reach && h.wrist.distanceTo(want.wrist) < 0.12);
      if (h.limb) this.drawTool(h, visible);
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
  // a thing held in the fist (a fork, a ladle, a bottle …): its turn in the world – its handle (+y)
  // up through the fist, its faces (±z) to the palm and the back of the hand
  toolQuat(i) {
    const y = this.handDir(i, IN_FIST).normalize(), side = this.handDir(i, v(1, 0, 0));
    const z = side.sub(y.clone().multiplyScalar(side.dot(y))).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
  }

  // a tool in the fist (the cooks' own: a knife, a whisk …), hanging from it
  drawTool(h, visible) {
    const L = h.limb;
    if (L.toolKind !== h.toolKind) {
      if (L.tool) L.root.remove(L.tool);
      L.tool = h.toolKind ? toolMesh(h.toolKind) : null;
      L.toolKind = h.toolKind;
      if (L.tool) { L.tool.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; } }); L.root.add(L.tool); }
    }
    if (!L.tool) return;
    L.tool.visible = visible;
    L.tool.position.copy(v(h.s * FIST.x * HS, FIST.y * HS, FIST.z * HS).applyQuaternion(h.q).add(h.wrist));
    L.tool.quaternion.copy(h.q).multiply(ALONG_FIST);
  }

  // the arm and hand, posed
  draw(h) {
    const L = h.limb;
    const s = h.s;
    const sh0 = mirrorV(h.sh, s);
    const w = h.wrist;
    // the shoulder comes forward (out of view) for a long reach
    let sh = sh0, d = w.distanceTo(sh0);
    const reach = (UPPER + FORE) * 0.985;
    if (d > reach) {
      sh = sh0.clone().add(w.clone().sub(sh0).normalize().multiplyScalar(Math.min(d - reach, SLIDE)));
      d = w.distanceTo(sh);
      if (d > reach) { const dir = w.clone().sub(sh).normalize(); w.copy(sh).addScaledVector(dir, reach); d = reach; } // (never a stretched arm)
    }
    d = Math.max(d, Math.abs(UPPER - FORE) + 0.02);
    const u = w.clone().sub(sh).normalize();
    const cosA = Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)));
    // The elbow is somewhere on a circle round the line from the shoulder to the wrist: where a person would
    // have it – hanging down, a little out and back – unless swinging it round spares the wrist a hard bend or
    // the forearm a hard twist (see WRIST_EASY …); never up toward the shoulder's height.
    const F = this.frame || { up: v(0, 1, 0), back: v(0, 0, 1), out: v(1, 0, 0) };
    const C0 = sh.clone().addScaledVector(u, UPPER * cosA), rr = UPPER * Math.sqrt(1 - cosA * cosA);
    const hang = F.up.clone().multiplyScalar(-0.85).addScaledVector(F.out, 0.3 * s).addScaledVector(F.back, 0.3);
    const b1 = hang.clone().addScaledVector(u, -hang.dot(u));
    if (b1.lengthSq() < 1e-6) b1.copy(F.out).multiplyScalar(s);
    b1.normalize();
    const b2 = new THREE.Vector3().crossVectors(u, b1);
    const elbowAt = (a) => C0.clone().addScaledVector(b1, rr * Math.cos(a)).addScaledVector(b2, rr * Math.sin(a));
    const axes = (q) => ({ z: Z.clone().applyQuaternion(q), palm: v(-s, 0, 0).applyQuaternion(q), thumb: v(0, 1, 0).applyQuaternion(q) });
    // (the wrist's bend for a forearm f – flexion toward the palm, deviation toward the thumb – and the forearm's twist)
    const bendOf = (A, f) => { const fz = f.dot(A.z); return { flex: Math.atan2(f.dot(A.palm), fz), dev: Math.atan2(f.dot(A.thumb), fz) }; };
    const twistOf = (A, f, e) => {
      const n = sh.clone().sub(e), t = A.thumb.clone();
      n.addScaledVector(f, -n.dot(f)); t.addScaledVector(f, -t.dot(f));
      if (n.lengthSq() < 1e-8 || t.lengthSq() < 1e-8) return 0;
      return Math.atan2(new THREE.Vector3().crossVectors(n, t).dot(f), n.dot(t));
    };
    const over = (x, most) => (x > most ? (x - most) * (x - most) * 40 : 0);
    let A = axes(h.q);
    const cost = (a) => {
      const e = elbowAt(a), f = e.clone().sub(w).normalize(), B = bendOf(A, f), tw = twistOf(A, f, e);
      const fl = B.flex >= 0 ? B.flex / WRIST_EASY.flex : -B.flex / WRIST_EASY.ext, dv = B.dev >= 0 ? B.dev / WRIST_EASY.rad : -B.dev / WRIST_EASY.uln;
      const lift = e.clone().sub(sh).dot(F.up) + 0.04; // (the elbow up toward the shoulder's height)
      const parts = [fl * fl + dv * dv + over(B.flex, WRIST_MOST.flex) + over(-B.flex, WRIST_MOST.ext) + over(B.dev, WRIST_MOST.rad) + over(-B.dev, WRIST_MOST.uln),
        0.6 * (tw / TWIST_EASY) ** 2 + over(Math.abs(tw), TWIST_MOST), (a / SWIVEL_EASY) ** 2 + (lift > 0 ? (lift / 0.03) ** 2 * 4 : 0),
        h.swivel != null ? 0.3 * ((a - h.swivel) / 0.5) ** 2 : 0];
      if (this.debug) (this.debug[s] ||= []).push([+a.toFixed(2), ...parts.map((x) => +x.toFixed(2)), +B.flex.toFixed(2), +B.dev.toFixed(2), +tw.toFixed(2)]);
      return parts[0] + parts[1] + parts[2] + parts[3];
    };
    let best = 0, bc = Infinity;
    for (let a = -1.75; a <= 1.75; a += 0.175) { const c = cost(a); if (c < bc) { bc = c; best = a; } }
    for (let a = best - 0.15; a <= best + 0.15; a += 0.05) { const c = cost(a); if (c < bc) { bc = c; best = a; } }
    h.swivel = h.swivel == null ? best : h.swivel + (best - h.swivel) * 0.35;
    const e = elbowAt(h.swivel);
    let f = e.clone().sub(w).normalize();
    // (still bent past what a wrist can do: the hand gives – turned toward the forearm, round what it's holding)
    const B = bendOf(A, f);
    const cf = Math.max(-WRIST_MOST.ext, Math.min(WRIST_MOST.flex, B.flex)), cd = Math.max(-WRIST_MOST.uln, Math.min(WRIST_MOST.rad, B.dev));
    if (cf !== B.flex || cd !== B.dev) {
      const want = A.z.clone().addScaledVector(A.palm, Math.tan(cf)).addScaledVector(A.thumb, Math.tan(cd)).normalize();
      const R = new THREE.Quaternion().setFromUnitVectors(want, f);
      const H = HOLDS[h.hold] || HOLDS.palm, g = v(s * H.grip.x * HS, H.grip.y * HS, H.grip.z * HS).applyQuaternion(h.q).add(w);
      w.copy(g).sub(g.clone().sub(w).applyQuaternion(R));
      h.q.premultiply(R);
      A = axes(h.q);
      f = e.clone().sub(w).normalize();
    }
    h.fore = w.clone().sub(e);
    if (this.debug) { const B2 = bendOf(A, f); h.bend = `flex ${Math.round(B2.flex * 57)} dev ${Math.round(B2.dev * 57)} tw ${Math.round(twistOf(A, f, e) * 57)} elbow ${Math.round(180 - sh.clone().sub(e).angleTo(w.clone().sub(e)) * 57)}`; }
    const up = sh.clone().sub(e).normalize();
    // (the sleeve runs on past the shoulder – out of sight – as far as the shoulder came forward)
    // (a shirt sleeve over the forearm, its cuff loose round the wrist, open: the rigged hand – life size – comes out
    // of it at the wrist, whichever way it's bent)
    if (L.rig) {
      tube(L.upper, e.clone().add(up.clone().multiplyScalar(UPPER + 0.04 + sh.distanceTo(sh0))), e, 0.0235);
      tube(L.fore, e, w.clone().addScaledVector(f, 0.016), 0.021);
      L.elbow.position.copy(e);
      L.elbow.scale.setScalar(0.0226); // (round over both sleeves' ends)
      tube(L.band, w.clone().addScaledVector(f, 0.02), w.clone().addScaledVector(f, -0.003), 0.0188);
    } else {
      tube(L.upper, e.clone().add(up.clone().multiplyScalar(UPPER + 0.04 + sh.distanceTo(sh0))), e, 0.024);
      tube(L.fore, e, w.clone().add(f.clone().multiplyScalar(0.014)), 0.021);
      L.elbow.position.copy(e);
      L.elbow.scale.setScalar(0.0232);
      tube(L.band, w.clone().add(f.clone().multiplyScalar(0.022)), w.clone().add(f.clone().multiplyScalar(0.008)), 0.019);
    }
    L.hand.position.copy(w);
    L.hand.quaternion.copy(h.q);
    // (the old jointed hand's wrist: halfway between the hand's line and the forearm's)
    const back = Z.clone().applyQuaternion(h.q), wd = back.clone().add(f).normalize();
    L.wrist.position.copy(w).addScaledVector(wd, 0.02 * HS);
    L.wrist.quaternion.setFromUnitVectors(v(0, 1, 0), wd);
    // the fingers close as far as curl says
    const c = h.curl;
    if (L.rig) poseRig(L.rig, c, shapeOf(h.reach ? h.reach.hold || h.hold : h.hold, c));
    if (!L.rig) FINGERS.forEach(([y, ...ls], i) => {
      let p = v(0.002, y, -0.084), A = 0;
      ls.forEach((l, j) => {
        A += 0.06 + c * BEND[j];
        const dir = v(-Math.sin(A), 0, -Math.cos(A));
        bone(L.bones[i][j], p, dir, l);
        p = p.clone().add(dir.multiplyScalar(l));
      });
    });
    const t1 = THUMB.open[0].clone().lerp(THUMB.fist[0], c), t2 = THUMB.open[1].clone().lerp(THUMB.fist[1], c);
    if (!L.rig) {
      bone(L.thumb[0], THUMB.base, t1.clone().sub(THUMB.base).normalize(), 0.04);
      bone(L.thumb[1], t1, t2.clone().sub(t1).normalize(), 0.036);
    }
    // (in an oven glove: its fingers' pocket closes as one, the thumb's goes where my thumb does)
    if (L.mitt.visible) {
      L.mFingers.rotation.set(0, 0.06 + c * 1.55, 0);
      L.mThumb.quaternion.setFromUnitVectors(v(0, 0, -1), t2.clone().sub(THUMB.base).normalize());
    }
  }
}

// The upper sleeve: solid at the elbow, fading out toward the shoulder – the
// camera at work, standing back from me, sees my arms from behind, and they
// mustn't end there in a hard cut-off tube. (By the distance from its elbow
// end, its local top: the sleeve's scaled to its length along y.)
const FADE_FROM = 0.02, FADE_TO = 0.16;
function fading(m) {
  const f = m.clone();
  f.transparent = true;
  f.depthWrite = false;
  f.alphaTest = 0.01;
  f.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFromElbow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFromElbow = (0.5 - position.y) * length(modelMatrix[1].xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFromElbow;')
      .replace('#include <alphatest_fragment>', `diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM.toFixed(3)}, ${FADE_TO.toFixed(3)}, vFromElbow);\n#include <alphatest_fragment>`);
  };
  f.customProgramCacheKey = () => 'sleeveFade';
  return f;
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
