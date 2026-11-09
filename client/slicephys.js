// Slices that fall aside and stack, under physics: the user, 2026-11-09 – "slices should fall aside and stack. we should
// use a lightweight physics engine for this". Rapier (@dimforge/rapier3d-compat 0.14.0, Apache-2.0, its WebAssembly inside
// the one module – client/vendor/rapier/), loaded only when a thing is first cut in slices; without it the slices are
// drawn where they'd lie, as before (food3d.js cutSlices).
//
// While a thing is being sliced: the board is the floor; what's left of the thing, up to its cut face, a block the slices
// can't fall back into; the knife's blade moves with the knife (a body moved by the game, which pushes what it meets).
// Each slice as it comes off is a body of its own – a disc as thick as it was cut – standing where it was, given a
// little tip away from the knife; it falls over onto the board or onto the slices before it, and stays where it lands.
// The world is simulated 10 times bigger (and gravity with it): slices a few millimetres thick are too thin for the
// solver's tolerances at their own size.
import * as THREE from 'three';
import { sliceModel } from './food3d.js';

const SC = 10;
let R = null, loading = null, failed = false;
// the engine, once: loaded in the background the first time it's wanted (null till then, or if it isn't there)
export function rapier() {
  if (R || failed) return R;
  if (!loading) {
    loading = import('./vendor/rapier/rapier.es.js')
      .then(async (m) => { const r = m.default || m; await r.init(); R = r; })
      .catch((e) => { failed = true; console.info('no slice physics (client/vendor/rapier)', e && e.message); });
  }
  return null;
}

const v = (p) => ({ x: p.x * SC, y: p.y * SC, z: p.z * SC });
const q = (o) => ({ x: o.x, y: o.y, z: o.z, w: o.w });
// A slice's body: a 12-sided disc (its thickness along x) – not a round one: stood on its edge, a round one rolled away
// across the board like a wheel, faster and faster
function sliceHull(r, rz, t) {
  const pts = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + Math.PI / 12; for (const x of [-t / 2, t / 2]) pts.push(x * SC, Math.cos(a) * r * SC, Math.sin(a) * rz * SC); }
  return R.ColliderDesc.convexHull(new Float32Array(pts));
}
// (a new slice starts leant away from the knife this far past where it would stand – atan(half its thickness / its
// radius): it always falls that way, onto the board or the others. Leant less, it stood back up on its edge.)
const TIP0 = 0.12;

export class SlicePhysics {
  // key: what's being sliced (the item, the step's phase); parent: where the slices are drawn (world space)
  constructor(key, parent) {
    this.key = key;
    this.parent = parent;
    this.world = new R.World({ x: 0, y: -9.81 * SC, z: 0 });
    this.slices = [];
    this.floor = null; this.rest = null; this.restSig = '';
    this.knife = null;
  }
  // Each frame. F: the thing as it lies – pos (on the board), yaw, its cut face and left end along it (cutLine's x),
  // its height (top) and half depth; st: its state (k cut so far of n, cuts); knife: its own frame as drawn (K0, xA, yA)
  // and how far below that line its edge is (edge); on: whether it's solid now – only coming down, before the slice is
  // there (the knife's leant: a blade solid as the slice appears beside it overlaps it a few millimetres, and the solver
  // threw the slice off into the air)
  update(dt, F, kind, st, knife) {
    const W = this.world, rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), F.yaw);
    this.food = { pos: F.pos.clone(), yaw: F.yaw }; // (where it was cut: what's left of it stays there)
    this.last = { F, kind };
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(rot), local = (x, y, z) => F.pos.clone().addScaledVector(ax, x).add(new THREE.Vector3(0, y, 0)).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(rot), z);
    if (!this.floor) {
      this.floor = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(F.pos.x * SC, (F.pos.y - 0.01) * SC, F.pos.z * SC));
      W.createCollider(R.ColliderDesc.cuboid(0.5 * SC, 0.01 * SC, 0.5 * SC).setFriction(0.9), this.floor);
    }
    // what's left of it: a block up to its cut face (made again as the face moves)
    const sig = `${F.face.toFixed(4)}`;
    if (sig !== this.restSig) {
      if (this.rest) W.removeRigidBody(this.rest);
      const hx = Math.max(0.002, (F.face - F.xL) / 2), c = local(F.xL + hx - 0.001, F.top / 2, 0);
      this.rest = W.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(c.x * SC, c.y * SC, c.z * SC).setRotation(q(rot)));
      W.createCollider(R.ColliderDesc.cuboid(hx * SC, (F.top / 2) * SC, F.rz * SC).setFriction(0.6), this.rest);
      this.restSig = sig;
    }
    // a slice for each cut made: standing where it was, a little tip and nudge away from the knife
    const k = Math.min(st.k | 0, 24);
    while (this.slices.length < k) {
      const j = this.slices.length, M = sliceModel(kind, st, j);
      if (!M) { this.slices.push(null); continue; }
      // (leant over its foot's far edge, away from the knife – about UP × ax, its top toward +ax: its middle, from that edge,
      // half its thickness back and its radius up, turned with it)
      const tip = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ax), a0 = Math.min(1.3, Math.atan2(M.t / 2, M.r) + TIP0);
      const lean = new THREE.Quaternion().setFromAxisAngle(tip, a0);
      const c = local(M.x + 0.003 + M.t / 2 - (M.t / 2) * Math.cos(a0) + M.r * Math.sin(a0), (M.y - M.r) + (M.t / 2) * Math.sin(a0) + M.r * Math.cos(a0) + 0.0005, 0);
      const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.x * SC, c.y * SC, c.z * SC).setRotation(q(lean.multiply(rot)))
        .setLinvel(ax.x * 0.04 * SC, 0, ax.z * 0.04 * SC).setAngvel({ x: tip.x * 3, y: 0, z: tip.z * 3 }).setCcdEnabled(true).setLinearDamping(0.4).setAngularDamping(1.5));
      const hull = sliceHull(M.r, M.rz, M.t) || R.ColliderDesc.cuboid((M.t / 2) * SC, M.r * SC, M.rz * SC);
      W.createCollider(hull.setDensity(1).setFriction(0.8).setRestitution(0.02), body);
      M.g.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
      this.parent.add(M.g);
      this.slices.push({ body, g: M.g });
    }
    // the knife's blade where the knife is (its frame: x along the blade from its bolster, y its spine)
    if (knife && !this.knife) {
      // (its blade: from the bolster 12 cm along, from its edge up to its spine, a millimetre thin)
      this.knife = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(knife.K0.x * SC, knife.K0.y * SC, knife.K0.z * SC));
      this.blade = W.createCollider(R.ColliderDesc.cuboid(0.06 * SC, (knife.edge / 2) * SC, 0.0006 * SC).setTranslation(0.065 * SC, (-knife.edge / 2) * SC, 0).setFriction(0.3), this.knife);
    }
    if (this.blade) this.blade.setEnabled(!!(knife && knife.on));
    if (knife) {
      const m = new THREE.Matrix4().makeBasis(knife.xA, knife.yA, new THREE.Vector3().crossVectors(knife.xA, knife.yA)), kq = new THREE.Quaternion().setFromRotationMatrix(m);
      this.knife.setNextKinematicTranslation(v(knife.K0));
      this.knife.setNextKinematicRotation(q(kq));
    }
    this.step(dt);
  }
  // The cutting over, waiting for my hands to take them: they lie where they fell (still settling), the knife not there
  // (st: the thing as it is now, all cut – the last cut ended the cutting, so its slice is added here)
  settle(dt, st = null) {
    if (st && this.last && (st.k | 0) > this.slices.length) { this.update(dt, this.last.F, this.last.kind, st, null); return; }
    if (this.blade) this.blade.setEnabled(false);
    if (this.rest) { this.world.removeRigidBody(this.rest); this.rest = null; this.restSig = 'gone'; } // (its end gone to the scraps)
    this.step(dt);
  }
  // where they lie, all together: the middle of the pile (on the board – y where the thing lay) – or null
  pileCenter() {
    const ps = this.slices.filter(Boolean).map((s) => s.g.position);
    if (!ps.length || !this.food) return null;
    const c = ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length);
    return c.setY(this.food.pos.y);
  }
  step(dt) {
    const W = this.world;
    // (in steps no longer than 1/60 s – the frame's time, up to a tenth of a second)
    let left = Math.min(0.1, dt);
    while (left > 1e-4) { const h = Math.min(1 / 60, left); W.timestep = h; W.step(); left -= h; }
    for (const s of this.slices) {
      if (!s) continue;
      const p = s.body.translation(), r = s.body.rotation();
      s.g.position.set(p.x / SC, p.y / SC, p.z / SC);
      s.g.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
  // (how many slices it has – a cut taken back, say, starts it again)
  get count() { return this.slices.length; }
  dispose() {
    for (const s of this.slices) if (s) this.parent.remove(s.g);
    this.slices = [];
    this.world.free();
  }
}

export const physicsReady = () => !!R;
