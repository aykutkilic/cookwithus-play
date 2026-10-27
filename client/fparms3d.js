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
// arm bones (a body whose eyes are at 165 cm – the kitchen's 0.84 – by Drillis & Contini's proportions: upper arm
// 0.186 of the height, forearm 0.146, shoulder 0.818 – here 1 is about 1.96 m); how far the (unseen) shoulder may
// come forward, leaning in
const UPPER = 0.167, FORE = 0.135, SLIDE = 0.3;
const REACH = (UPPER + FORE) * 0.985 + SLIDE;  // further than that, the hand stops (and the thing comes to it)
const LEAN = 0.16; // how far you lean in toward something out of reach
export const APART = 0.9; // how far apart my arms are (1: as they were first made – a little wide)
// (the right one, from my eyes: high enough that a forearm comes down onto the worktop – the elbow hanging at my
// side, not out level with the work)
export const SHOULDER = new THREE.Vector3(0.12 * APART, -0.11, 0.035);
const POLE = new THREE.Vector3(0.55, -0.8, 0.25).normalize(); // (a hold turned toward where the elbow hangs: down, out, back)
// THE ARM AS A BODY HOLDS IT. Each joint, measured on my body (not my eyes' turn), with how far it can go and
// where it's at ease – from the clinical ranges of motion (AAOS), the wrist's from Ryu et al. 1991 (daily tasks:
// at most 54° flexion, 60° extension, 17° radial, 40° ulnar deviation; comfortable within about ±15–20°), what
// ergonomics scores as strain (RULA, McAtamney & Corlett 1993: an upper arm raised or swung out), and how people
// choose a posture for a hand's place (Soechting et al. 1995: the one nearest the last). Angles in radians.
// - shoulder: the upper arm's direction – raised (elevation, 0 hanging) in a plane (0 forward, + out to the side,
//   − across my chest, ±π behind) – and its turn about its own length (+ inward: the forearm toward my belly)
// - elbow: a hinge, 0 straight … 150°
// - forearm: turned from thumb-up (the palm toward the elbow's hinge): + pronation (palm down), − supination
// - wrist: bent toward the palm (flexion) or the back (extension), toward the thumb (radial) or the little finger
//   (ulnar) – all of it within an ellipse
const ARM = {
  elev: 2.97, across: -0.7, acrossLow: 0.35, behind: 2.1, behindElev: 0.9,
  rotIn: 1.48, rotOut: 1.22, elbow: 2.62, pro: 1.55, sup: 1.5,
  wrist: { flex: 1.2, ext: 1.05, rad: 0.35, uln: 0.52 },
};
const EASE = { elev: 0.35, plane: 0.35, rot: 0.3, elbow: 1.4, pro: 0.4, wrist: { flex: 0.35, ext: 0.44, rad: 0.17, uln: 0.26 } };
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
// The chef's knife in a pinch grip (hand space): the thumb's pad and the index's side pinch the blade just in front of
// the bolster, the other three fingers wrap the handle, which runs back diagonally under the palm to its heel – the
// blade going on from the forearm's line. at: the bolster (the knife's origin, chefKnifeMesh's); axis: toward the tip;
// up: the spine's way (its flat against the palm's side).
export const KNIFE = { at: v(-0.012, 0.018, -0.11), axis: v(0, 0.45, -0.89).normalize(), up: v(0, 0.89, 0.45).normalize() };
// (where the hand holds the knife, as the scene has it – knifeAt's fist: 1.3 cm behind the bolster, 0.6 cm under the
// spine, the kitchen's units – in hand space)
const KNIFE_GRIP = KNIFE.at.clone().addScaledVector(KNIFE.axis, -0.013 / 0.5).addScaledVector(KNIFE.up, -0.006 / 0.5);
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
  handle: { at: v(0.12, -0.19, -0.24), grip: FIST, a: IN_FIST, b: v(-0.42, 0.1, -1), c: Z, pref: v(0.3, -0.7, 0.8), curl: 1, toBody: true },
  palm: { at: v(0.1, -0.17, -0.25), grip: PALM, a: v(-1, 0, 0), b: v(-0.15, 1, 0.1), c: Z, pref: v(0.2, -0.5, 1), curl: 0.3 },
  // a food container on the palm, carried out in front at the waist
  tub: { at: v(0.06, -0.25, -0.34), grip: PALM, a: v(-1, 0, 0), b: v(-0.1, 1, 0.05), c: Z, pref: v(0.2, -0.5, 1), curl: 0.35 },
  side: { at: v(0.16, -0.17, -0.34), grip: PALM, a: v(-1, 0, 0), b: v(-1, 0.35, 0), c: Z, pref: v(0.35, -0.6, 0.8), curl: 0.55 },
  grab: { at: v(0.12, -0.12, -0.35), grip: FIST, a: IN_FIST, b: v(0, 1, 0.15), c: Z, pref: v(0.3, -0.6, 0.8), curl: 0.85, toBody: true }, // a door's handle
  // at work (first person): a tool upright in the fist, or the open hand palm down
  tool: { at: v(0.1, -0.1, -0.4), grip: FIST, a: IN_FIST, b: v(0, 1, 0.25), c: Z, pref: v(0.35, -0.5, 0.8), curl: 0.95 },
  // (the handle in the fist, the blade forward, its edge down: the knuckles along the top of
  // the handle, the back of the hand to the outside and a little up, the palm in – back: c → that)
  // (frame: given the knife's spine as well – up – the hand turned onto it exactly, as KNIFE holds it)
  knife: { at: v(0.1, -0.1, -0.4), grip: KNIFE_GRIP, a: KNIFE_IN, b: v(-0.45, -0.12, -1), c: v(1, 0, 0), pref: v(1, 0.35, 0), curl: 1, back: true, frame: KNIFE },
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
    // (the rigged hand's skin: a soft warm sheen at its edges, as skin has)
    const skinRig = new THREE.MeshPhysicalMaterial({ color: look.skin, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#ff9a8a'), sheenRoughness: 0.5 });
    const tube = new THREE.CylinderGeometry(0.85, 1, 1, 18, 1, true);
    const ball = new THREE.SphereGeometry(1, 24, 16);
    for (const h of this.hands) {
      const root = new THREE.Group();
      const upper = new THREE.Mesh(tube, shirt), fore = new THREE.Mesh(tube, shirt), elbow = new THREE.Mesh(ball, shirt);
      upper.userData.noAO = true; // (running on up past the camera's edge: kept out of the ambient occlusion)
      // (the cuff closing in a little round the wrist – not a wide ring with its dark inside showing)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1, 1, 18, 1, true), cuffIn);
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
  pose(s, kind, at = null, dir = null, sh = SHOULDER, up = null) {
    const H = HOLDS[kind] || HOLDS.away;
    let base = this.poseCache.get(kind);
    if (!base) { base = aim(H.a, H.b, H.c, H.pref); this.poseCache.set(kind, base); }
    const grip = at ? at.clone() : H.at.clone(); // (in the right hand's space)
    // (the thing held given whole – its length and its up – and the hold knowing how it's held: turned exactly onto it)
    if (H.frame && dir && up) {
      const fa = H.frame.axis.clone().normalize(), fu = H.frame.up.clone().addScaledVector(fa, -H.frame.up.dot(fa)).normalize();
      const wa = dir.clone().normalize(), wu = up.clone().addScaledVector(wa, -up.dot(wa)).normalize();
      const Mh = new THREE.Matrix4().makeBasis(fa, fu, new THREE.Vector3().crossVectors(fa, fu)), Mw = new THREE.Matrix4().makeBasis(wa, wu, new THREE.Vector3().crossVectors(wa, wu));
      const q = new THREE.Quaternion().setFromRotationMatrix(Mw.multiply(Mh.transpose()));
      const wrist = grip.clone().sub(H.grip.clone().multiplyScalar(HS).applyQuaternion(q));
      return { wrist: mirrorV(wrist, s), q: s < 0 ? mirrorQ(q) : q, curl: H.curl, grip: H.grip };
    }
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
  // a hand with nothing to do hanging at my side – by my thigh, the palm in, the fingers down – wherever I look
  hanging(s) {
    const F = this.frame, sh = this.shoulderOn();
    const wrist = sh.clone().addScaledVector(F.up, -(UPPER + FORE) * 0.95).addScaledVector(F.out, 0.012).addScaledVector(F.back, -0.015);
    const q = aim(v(0, 0, -1), F.up.clone().negate().addScaledVector(F.back, -0.1), v(-1, 0, 0), F.out.clone().negate());
    return { wrist: mirrorV(wrist, s), q: s < 0 ? mirrorQ(q) : q, curl: HOLDS.away.curl, grip: HOLDS.away.grip };
  }
  // where my right shoulder is on my body, in my eyes' space (SHOULDER: out, up, back from my eyes, upright)
  shoulderOn() {
    const F = this.frame;
    if (!F) return SHOULDER.clone();
    return F.out.clone().multiplyScalar(SHOULDER.x).addScaledVector(F.up, SHOULDER.y).addScaledVector(F.back, SHOULDER.z);
  }
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
  // (view: the camera that's looking – not my eyes, at work – that my sleeves run on out of the sight of)
  update(dt, holds, { visible = true, walk = 0, t = 0, hideAway = false, view = null } = {}) {
    this.group.visible = visible;
    this.group.updateWorldMatrix(true, false);
    this.toView = view ? new THREE.Matrix4().multiplyMatrices(view.matrixWorldInverse, this.group.matrixWorld) : null;
    this.viewCam = view;
    // (the world's up, my back and my right in my eyes' space – which way an elbow hangs)
    const up = this.upLocal(), back = v(0, 0, 1).addScaledVector(up, -up.z);
    this.frame = { up, back: back.lengthSq() > 1e-6 ? back.normalize() : v(0, 0, 1), out: v(1, 0, 0).addScaledVector(up, -up.x).normalize() };
    const k = 1 - Math.exp(-dt * 12 * BRISK);
    for (let i = 0; i < 2; i++) {
      const h = this.hands[i];
      const hold = holds[i];
      const kind = hold ? hold.kind : 'away';
      // (my shoulder where my body has it – not turned up and down with my eyes)
      h.sh.lerp(hold && hold.sh || this.shoulderOn(), k);
      // (resting: the fingers straight on from the forearm as it comes down to the worktop – seen from
      // above, no bend at the wrist)
      let dir = hold && hold.dir;
      if (kind === 'rest' && h.fore) {
        const up = this.upLocal(), f = h.fore.clone().addScaledVector(up, -h.fore.dot(up));
        if (f.lengthSq() > 1e-6) dir = mirrorV(f.normalize(), h.s);
      }
      const want = kind === 'away' && !(hold && hold.at) && this.frame ? this.hanging(h.s) : this.pose(h.s, kind, hold && hold.at, dir, h.sh, hold && hold.up);
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
      if (visible && h.limb) this.draw(h);
      if (h.limb) this.drawTool(h, visible);
    }
    this.camera.updateMatrixWorld(true);
  }

  // Where a point of the hand (hand space, metres) is in the world.
  handPoint(i, local) {
    const h = this.hands[i];
    const p = v(h.s * local.x * HS, local.y * HS, local.z * HS).applyQuaternion(h.drawQ || h.q).add(h.drawW || h.wrist);
    return p.applyMatrix4(this.camera.matrixWorld);
  }
  // a direction of the hand in the world
  handDir(i, local) {
    const h = this.hands[i];
    const d = v(h.s * local.x, local.y, local.z).applyQuaternion(h.drawQ || h.q);
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
    L.tool.position.copy(v(h.s * FIST.x * HS, FIST.y * HS, FIST.z * HS).applyQuaternion(h.drawQ || h.q).add(h.drawW || h.wrist));
    L.tool.quaternion.copy(h.drawQ || h.q).multiply(ALONG_FIST);
  }

  // the arm and hand, posed
  draw(h) {
    const L = h.limb;
    const s = h.s;
    const sh0 = mirrorV(h.sh, s);
    // (the hand where it's asked to be – drawn where the body can have it: drawW, drawQ; the ask itself untouched)
    const w = h.wrist.clone();
    h.drawQ = h.q.clone();
    // The elbow is somewhere on a circle round the line from my shoulder to my wrist; my shoulder where my body has it –
    // leaning in toward the work (or straightening up from it), the shoulder that far toward my hand and a little lower.
    // Of all these, the posture a body would take (ARM, EASE): within every joint's reach, at ease, leaning no more
    // than it needs, and nearest the last one – a hand asked to be turned past what a forearm and a wrist can do gives
    // way, round what it's holding.
    const F = this.frame || { up: v(0, 1, 0), back: v(0, 0, 1), out: v(1, 0, 0) };
    const toB = (p) => v(p.dot(F.out) * s, p.dot(F.up), -p.dot(F.back)); // (my body's space, this side: x out, y up, z forward)
    const reach = (UPPER + FORE) * 0.985;
    const toward = w.clone().sub(sh0);
    toward.addScaledVector(F.up, -toward.dot(F.up));
    const across = toward.length(); // (never leaning past my hand)
    if (toward.lengthSq() < 1e-8) toward.copy(F.back).negate();
    toward.normalize();
    const hang = F.up.clone().multiplyScalar(-0.85).addScaledVector(F.out, 0.3 * s).addScaledVector(F.back, 0.3);
    // (the circle the elbow can be on, my shoulder leant by lean: and how far short of the wrist the arm falls)
    const ringAt = (lean) => {
      let sh = sh0.clone().addScaledVector(toward, lean).addScaledVector(F.up, -0.3 * Math.max(0, lean));
      let d = w.distanceTo(sh), short = 0;
      if (d > reach) { sh = sh.clone().add(w.clone().sub(sh).normalize().multiplyScalar(Math.min(d - reach, SLIDE))); d = w.distanceTo(sh); short = Math.max(0, d - reach); }
      d = Math.max(Math.min(d, reach), Math.abs(UPPER - FORE) + 0.02);
      const u = w.clone().sub(sh).normalize();
      const cosA = Math.max(-1, Math.min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)));
      const C0 = sh.clone().addScaledVector(u, UPPER * cosA), rr = UPPER * Math.sqrt(1 - cosA * cosA);
      const b1 = hang.clone().addScaledVector(u, -hang.dot(u));
      if (b1.lengthSq() < 1e-6) b1.copy(F.out).multiplyScalar(s);
      b1.normalize();
      const b2 = new THREE.Vector3().crossVectors(u, b1);
      return { sh, d, short, lean, elbowAt: (a) => C0.clone().addScaledVector(b1, rr * Math.cos(a)).addScaledVector(b2, rr * Math.sin(a)) };
    };
    const axes = (q) => ({ z: Z.clone().applyQuaternion(q), palm: v(-s, 0, 0).applyQuaternion(q), thumb: v(0, 1, 0).applyQuaternion(q) });
    const sAng = (a0, b0, ax) => { const a = a0.clone().addScaledVector(ax, -a0.dot(ax)), b = b0.clone().addScaledVector(ax, -b0.dot(ax)); return a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8 ? 0 : Math.atan2(new THREE.Vector3().crossVectors(a, b).dot(ax), a.dot(b)); };
    const swing = new THREE.Quaternion();
    // every joint's angle, the shoulder at sh and the elbow at e (ANATOMY's terms)
    const anglesAt = (sh, e, A) => {
      const hu = toB(e.clone().sub(sh).normalize()), g = toB(w.clone().sub(e).normalize());
      const elev = Math.acos(Math.max(-1, Math.min(1, -hu.y))), plane = Math.atan2(hu.x, hu.z);
      const n0 = v(0, 0, 1).applyQuaternion(swing.setFromUnitVectors(v(0, -1, 0), hu)); // (the forearm's way with the arm at no turn)
      const rot = sAng(n0, g, hu), elbow = hu.angleTo(g);
      const bendTo = g.clone().addScaledVector(hu, -g.dot(hu)).lengthSq() > 1e-5 ? g.clone().addScaledVector(hu, -g.dot(hu)) : n0.clone().applyAxisAngle(hu, rot);
      const hinge = new THREE.Vector3().crossVectors(hu, bendTo).normalize();
      const pro = sAng(hinge, toB(A.palm), g);
      const fUp = e.clone().sub(w).normalize(), fz = fUp.dot(A.z);
      return { elev, plane, rot, elbow, pro, flex: Math.atan2(fUp.dot(A.palm), fz), dev: Math.atan2(fUp.dot(A.thumb), fz), ex: hu.x * UPPER, ez: hu.z * UPPER };
    };
    // how far past a joint's reach (0: within it), and how far from at ease
    const past = (J) => {
      const W = ARM.wrist, wf = J.flex / (J.flex >= 0 ? W.flex : W.ext), wd = J.dev / (J.dev >= 0 ? W.rad : W.uln);
      return [Math.max(0, J.elev - ARM.elev), J.elev > ARM.acrossLow ? Math.max(0, ARM.across - J.plane) : 0, J.elev > ARM.behindElev ? Math.max(0, Math.abs(J.plane) - ARM.behind) : 0,
        Math.max(0, J.rot - ARM.rotIn, -J.rot - ARM.rotOut), Math.max(0, J.elbow - ARM.elbow),
        J.ex < -0.03 && J.ez < 0.05 ? -0.03 - J.ex : 0, // (the elbow into my side)
        Math.max(0, J.pro - ARM.pro, -J.pro - ARM.sup), Math.max(0, Math.sqrt(wf * wf + wd * wd) - 1)];
    };
    const ease = (J) => {
      const E = EASE, Ew = E.wrist, fl = J.flex / (J.flex >= 0 ? Ew.flex : Ew.ext), dv = J.dev / (J.dev >= 0 ? Ew.rad : Ew.uln);
      // (the upper arm raised – RULA: past 45° a strain – or swung in across my chest is more of an effort than out to my side)
      return Math.max(0, (J.elev - E.elev) / 0.4) ** 2 + 3 * Math.max(0, (J.elev - 0.79) / 0.25) ** 2 + ((J.plane - E.plane) / (J.plane < E.plane ? 0.45 : 0.8)) ** 2 * Math.sin(J.elev) ** 2
        + ((J.rot - E.rot) / 0.7) ** 2 + 0.3 * ((J.elbow - E.elbow) / 1) ** 2 + ((J.pro - E.pro) / 0.9) ** 2 + fl * fl + dv * dv;
    };
    let A = axes(h.drawQ);
    const cost = (R, a) => {
      const J = anglesAt(R.sh, R.elbowAt(a), A), P = past(J);
      if (this.debugAll) (this.debugAll[s] ||= []).push({ lean: R.lean, a: +a.toFixed(2), short: +R.short.toFixed(3), J: Object.fromEntries(Object.entries(J).map(([k, x]) => [k, Math.round(x * 57.3)])), P: P.map((x) => Math.round(x * 57.3)), ease: +ease(J).toFixed(2) });
      // (the body's own reach – shoulder, elbow – costs more than any discomfort: never past it, if there's a way within.
      // How the hand's asked to be turned is a wish: past what the forearm turns, the wrist bends, the hand gives – that
      // costs, but no more than an awkward posture would. Leaning in a little is cheap, straightening up from the work
      // less so; falling short of the wrist, dear.)
      const body = P.slice(0, 6).reduce((t, x) => t + (x > 0 ? 200 + 300 * x + 3000 * x * x : 0), 0), give = 3 * ((P[6] + P[7]) / 0.5) ** 2;
      return body + give + ease(J) + 1000 * R.short
        + (R.lean > 0 ? 0.6 * (R.lean / 0.1) ** 2 : (R.lean / 0.04) ** 2)
        + (h.swivel != null ? 0.3 * ((a - h.swivel) / 0.5) ** 2 + 0.3 * ((R.lean - (h.lean || 0)) / 0.05) ** 2 : 0);
    };
    // (all the way round, every way of leaning, now and then – in between, just near where it is: it's a body, it
    // doesn't leap)
    // (the whole circle, every way of leaning, now and then – and what it found is where the arm goes: in between,
    // only near that, so it's not drawn back to where it was by the way there)
    let best = { a: 0, lean: 0 }, bc = Infinity;
    h.solveN = (h.solveN || 0) + 1;
    const wide = h.swivel == null || h.goal == null || h.solveN % 6 === 0;
    const ga = h.goal ?? h.swivel ?? 0, gl = h.goalLean ?? h.lean ?? 0;
    const leans = wide ? [-0.04, 0, 0.04, 0.08, 0.12] : [Math.max(-0.04, gl - 0.03), gl, Math.min(0.12, gl + 0.03)];
    for (const lean of leans) {
      if (lean > 0.5 * across && lean > 0) continue;
      const R = ringAt(lean);
      if (wide) { for (let a = -Math.PI; a < Math.PI; a += 0.2) { const c = cost(R, a); if (c < bc) { bc = c; best = { a, lean }; } } }
      else for (let a = ga - 0.4; a <= ga + 0.4; a += 0.1) { const c = cost(R, a); if (c < bc) { bc = c; best = { a, lean }; } }
    }
    { const R = ringAt(best.lean); for (let a = best.a - 0.14; a <= best.a + 0.14; a += 0.035) { const c = cost(R, a); if (c < bc) { bc = c; best = { a, lean: best.lean }; } } }
    h.goal = best.a; h.goalLean = best.lean;
    if (h.swivel == null) { h.swivel = best.a; h.lean = best.lean; } else {
      let da = best.a - h.swivel;
      da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      h.swivel += da * 0.35;
      h.lean += (best.lean - h.lean) * 0.25;
    }
    const RF = ringAt(h.lean), sh = RF.sh;
    if (RF.short > 0) w.copy(sh).addScaledVector(w.clone().sub(sh).normalize(), reach); // (never a stretched arm)
    const e = RF.elbowAt(h.swivel);
    if (this.debug) (this.debug[s] ||= []).push([+best.lean.toFixed(2), +best.a.toFixed(2), +bc.toFixed(2)]);
    let f = e.clone().sub(w).normalize();
    // (the hand asked past what the forearm can turn, the wrist bend: it gives – turned round what it's holding)
    const H = HOLDS[h.hold] || HOLDS.palm, gripW = () => v(s * H.grip.x * HS, H.grip.y * HS, H.grip.z * HS).applyQuaternion(h.drawQ).add(w);
    const turnHand = (R) => { const g = gripW(); w.copy(g).sub(g.clone().sub(w).applyQuaternion(R)); h.drawQ.premultiply(R); A = axes(h.drawQ); };
    // (the wrist first – the hand turned toward the forearm, round what it holds; then the forearm's turn, about its
    // own length through the wrist)
    let J = anglesAt(sh, e, A);
    const W = ARM.wrist, wf = J.flex / (J.flex >= 0 ? W.flex : W.ext), wd = J.dev / (J.dev >= 0 ? W.rad : W.uln), wr = Math.sqrt(wf * wf + wd * wd);
    if (wr > 1) {
      const want = A.z.clone().addScaledVector(A.palm, Math.tan(J.flex / wr)).addScaledVector(A.thumb, Math.tan(J.dev / wr)).normalize();
      turnHand(new THREE.Quaternion().setFromUnitVectors(want, f));
      f = e.clone().sub(w).normalize();
      J = anglesAt(sh, e, A);
    }
    const proLim = J.pro > ARM.pro ? ARM.pro : J.pro < -ARM.sup ? -ARM.sup : null;
    if (proLim != null) {
      const ax = w.clone().sub(e).normalize(), d0 = J.pro - proLim, q0 = h.drawQ.clone();
      h.drawQ.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, d0));
      A = axes(h.drawQ);
      if (Math.abs(anglesAt(sh, e, A).pro - proLim) > 0.05) { h.drawQ.copy(q0).premultiply(new THREE.Quaternion().setFromAxisAngle(ax, -d0)); A = axes(h.drawQ); }
    }
    h.fore = w.clone().sub(e);
    if (this.debug) { const D = anglesAt(sh, e, A), dg = (x) => Math.round(x * 57.3); h.bend = `lean ${Math.round(h.lean * 100)} sh ${dg(D.elev)}/${dg(D.plane)} rot ${dg(D.rot)} el ${dg(D.elbow)} pro ${dg(D.pro)} wr ${dg(D.flex)}/${dg(D.dev)}${past(D).some((x) => x > 0.01) ? ' PAST ' + past(D).map((x) => dg(x)).join(',') : ''}`; }
    const up = sh.clone().sub(e).normalize();
    // (the sleeve runs on past the shoulder – out of sight – as far as the shoulder came forward)
    // (a shirt sleeve over the forearm, its cuff loose round the wrist, open: the rigged hand – life size – comes out
    // of it at the wrist, whichever way it's bent)
    const top = this.sleeveTop(e, sh) || e.clone().add(up.clone().multiplyScalar(UPPER + 0.04 + sh.distanceTo(sh0)));
    if (L.rig) {
      tube(L.upper, top, e, 0.0235);
      tube(L.fore, e, w.clone().addScaledVector(f, 0.016), 0.021);
      L.elbow.position.copy(e);
      L.elbow.scale.setScalar(0.0226); // (round over both sleeves' ends)
      tube(L.band, w.clone().addScaledVector(f, 0.02), w.clone().addScaledVector(f, -0.003), 0.0188);
    } else {
      tube(L.upper, top, e, 0.024);
      tube(L.fore, e, w.clone().add(f.clone().multiplyScalar(0.014)), 0.021);
      L.elbow.position.copy(e);
      L.elbow.scale.setScalar(0.0232);
      tube(L.band, w.clone().add(f.clone().multiplyScalar(0.022)), w.clone().add(f.clone().multiplyScalar(0.008)), 0.019);
    }
    h.drawW = w;
    L.hand.position.copy(w);
    L.hand.quaternion.copy(h.drawQ);
    // (the old jointed hand's wrist: halfway between the hand's line and the forearm's)
    const back = Z.clone().applyQuaternion(h.drawQ), wdir = back.clone().add(f).normalize();
    L.wrist.position.copy(w).addScaledVector(wdir, 0.02 * HS);
    L.wrist.quaternion.setFromUnitVectors(v(0, 1, 0), wdir);
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

// The upper sleeve's far end. A camera at work stands back from me and sees
// where my shoulders are: an arm mustn't stop there, a cut-off tube in the
// middle of the picture. It comes on in from out of sight, as my arms come into
// my eyes' sight: from the elbow to my shoulder taken on back, behind me, as
// far as it takes to be out of the picture – from over me that's in at its
// bottom edge, from behind me past the camera on that arm's side. (null: up
// through my shoulder as it is – out of sight already, or no camera to go by)
FpArms.prototype.sleeveTop = function (e, sh) {
  const M = this.toView, cam = this.viewCam, F = this.frame;
  if (!M || !cam || !F) return null;
  const P = v(0, 0, 0);
  const out = (p) => {
    P.copy(p).applyMatrix4(M);
    if (P.z > -cam.near * 2) return true;
    P.applyMatrix4(cam.projectionMatrix);
    return Math.abs(P.x) > 1.1 || Math.abs(P.y) > 1.1;
  };
  if (out(e.clone().lerp(sh, 1.25))) return null;
  for (let k = 0.05; k <= 1.5; k += 0.05) {
    const p = sh.clone().addScaledVector(F.back, k);
    if (out(p)) return p.addScaledVector(F.back, 0.05);
  }
  return sh.clone().addScaledVector(F.back, 1.5);
};

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
