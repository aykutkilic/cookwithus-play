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
// The pusher: half its width along the blade, half its height, half its thickness (m); how fast it can go (m/s)
// (and on to the pile afterwards, gently: at PUSH_V the rings – lying on their sides like logs – were knocked rolling 10 cm)
const PUSH = { w: 0.06, h: 0.018, t: 0.005 }, PUSH_V = 0.8, PUSH_V_END = 0.25;

export class SlicePhysics {
  // key: what's being sliced (the item, the step's phase); parent: where the slices are drawn (world space)
  constructor(key, parent) {
    this.key = key;
    this.parent = parent;
    this.world = new R.World({ x: 0, y: -9.81 * SC, z: 0 });
    this.slices = [];
    this.floor = null; this.rest = null; this.restSig = '';
    this.knife = null;
    // (several of a thing cut one after another – Menemen's two peppers: each one's slices added after the last one's,
    // which stay where they were pushed. base: where this one's start; unit: its phase; units: how many begun)
    this.base = 0; this.unit = null; this.units = 0;
    this.pusher = null;
  }
  // The next one of several, cut where the last was: its slices counted from here (what's left of the last one gone)
  beginUnit(u) {
    if (this.unit === u) return;
    if (this.unit !== null) {
      this.base = this.slices.length;
      if (this.rest) { this.world.removeRigidBody(this.rest); this.rest = null; }
      this.restSig = ''; this.last = null;
    }
    this.unit = u; this.units++;
  }
  // (this one's slices only, down to k – a cut taken back)
  trimUnit(k) {
    while (this.slices.length > this.base + k) {
      const s = this.slices.pop();
      if (s) { this.world.removeRigidBody(s.body); this.parent.remove(s.g); }
    }
  }
  get unitCount() { return this.slices.length - this.base; }
  // Each frame. F: the thing as it lies – pos (on the board), yaw, its cut face and left end along it (cutLine's x),
  // its height (top) and half depth; st: its state (k cut so far of n, cuts); knife: its own frame as drawn (K0, xA, yA)
  // and how far below that line its edge is (edge); on: whether it's solid now – only coming down, before the slice is
  // there (the knife's leant: a blade solid as the slice appears beside it overlaps it a few millimetres, and the solver
  // threw the slice off into the air)
  update(dt, F, kind, st, knife) {
    const W = this.world, rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), F.yaw);
    this.food = { pos: F.pos.clone(), yaw: F.yaw }; // (where it was cut: what's left of it stays there)
    this.last = { F, kind, st };
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
    while (this.slices.length - this.base < k && this.slices.length < 64) {
      const j = this.slices.length - this.base, M = sliceModel(kind, st, j);
      if (!M) { this.slices.push(null); continue; }
      // (leant over its foot's far edge, away from the knife – about UP × ax, its top toward +ax: its middle, from that edge,
      // half its thickness back and its radius up, turned with it)
      // (a melon's half-moon slice – base: its origin the middle of its flat edge, on the board – topples about its middle of
      // mass, hc high; a round one about its middle)
      const hc = M.base ? M.hc : M.r, tip = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ax), a0 = Math.min(1.3, Math.atan2(M.t / 2, hc) + TIP0);
      const lean = new THREE.Quaternion().setFromAxisAngle(tip, a0);
      const up0 = M.base ? 0 : M.r, base = M.base ? M.y : M.y - M.r; // (the origin's height over its foot, unleant)
      const c = local(M.x + 0.003 + M.t / 2 - (M.t / 2) * Math.cos(a0) + up0 * Math.sin(a0), base + (M.t / 2) * Math.sin(a0) + up0 * Math.cos(a0) + 0.0005, 0);
      const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.x * SC, c.y * SC, c.z * SC).setRotation(q(lean.multiply(rot)))
        .setLinvel(ax.x * 0.04 * SC, 0, ax.z * 0.04 * SC).setAngvel({ x: tip.x * 3, y: 0, z: tip.z * 3 }).setCcdEnabled(true).setLinearDamping(0.4).setAngularDamping(1.5));
      const hull = (M.hull ? R.ColliderDesc.convexHull(new Float32Array(M.hull.flat().map((x) => x * SC))) : sliceHull(M.r, M.rz, M.t)) || R.ColliderDesc.cuboid((M.t / 2) * SC, M.r * SC, M.rz * SC);
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
    this.unpush();
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
    if (st && this.last && (st.k | 0) > this.unitCount) { this.update(dt, this.last.F, this.last.kind, st, null); return; }
    if (this.blade) this.blade.setEnabled(false);
    if (this.rest) { this.world.removeRigidBody(this.rest); this.rest = null; this.restSig = 'gone'; } // (its end gone to the scraps)
    this.pushLive = false;
    this.step(dt, this.pushOn(dt, true)); // (the push over, they're at the pile: the rest of its way there)
  }
  // (the pushing over: the pusher gone – they stay where it left them)
  unpush() { if (this.wall && this.wall.isEnabled()) this.wall.setEnabled(false); this.pushTo = null; this.pushEnd = null; }
  // This one's slices pushed along the board to the pile at its side – by the knife's blade, on its edge behind them, or
  // my hand's edge: P its face – at (on the board, its middle), along it, dir the way it pushes – or null while it isn't
  // pushing; P.end: how much further along dir it stops, once they're on the pile. A solid wall the game moves, a
  // centimetre thick, never faster than PUSH_V; set down clear of the slices. Let go of, it goes on to where it was let go
  // (push without P) – or, the pile reached, on to the pile (settle). The last cut ended the cutting, so its slice is
  // added first.
  push(dt, P) {
    const L = this.last && this.last.st;
    if (L && (L.n | 0) > this.unitCount) { this.update(dt, this.last.F, this.last.kind, { ...L, k: L.n }, null); return; }
    if (this.blade) this.blade.setEnabled(false);
    if (this.rest) { this.world.removeRigidBody(this.rest); this.rest = null; this.restSig = 'gone'; } // (its end gone to the scraps)
    const W = this.world;
    if (!this.pusher) {
      this.pusher = W.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
      this.wall = W.createCollider(R.ColliderDesc.cuboid(PUSH.w * SC, PUSH.h * SC, PUSH.t * SC).setFriction(0.4), this.pusher);
      this.wall.setEnabled(false);
    }
    let kin = null;
    if (P) {
      const dir = P.dir.clone().setY(0).normalize(), along = P.along.clone().setY(0).normalize();
      const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0))));
      const at = (back) => P.at.clone().addScaledVector(dir, -PUSH.t - back).setY(this.food.pos.y + PUSH.h + 0.001);
      if (!this.wall.isEnabled()) {
        // (put down where it's clear of them – back along the way it pushes as far as it has to)
        let back = 0;
        for (; back < 0.08; back += 0.005) if (!this.overlaps(at(back), q0)) break;
        const p = at(back);
        this.pusher.setTranslation(v(p), true); this.pusher.setRotation(q(q0), true);
        this.pushAt = p; this.wall.setEnabled(true);
      }
      this.pushTo = { p: at(0), q: q0 };
      this.pushEnd = { p: at(0).addScaledVector(dir, Math.max(0, P.end || 0)), q: q0 };
    } else this.pushEnd = null;
    this.pushLive = !!P;
    this.step(dt, this.pushOn(dt));
  }
  // (the pusher's way this frame, toward where it's wanted – null once it's there and no longer pushed: then it's gone)
  // (end: the push over, the pile reached – on to the pile)
  pushOn(dt, end = false) {
    const T = end && this.pushEnd ? this.pushEnd : this.pushTo;
    if (!this.wall || !this.wall.isEnabled() || !T) return null;
    const from = this.pushAt.clone(), d = T.p.clone().sub(from), max = (end ? PUSH_V_END : PUSH_V) * Math.min(0.1, dt);
    if (d.length() < 1e-4) { if (!this.pushLive || end) this.unpush(); return null; } // (there, and still pushed: it waits)
    if (d.length() > max) d.setLength(max);
    this.pushAt = from.clone().add(d);
    return { from, to: this.pushAt.clone(), q: this.pushTo.q };
  }
  // the middle of this one's slices (or null)
  unitCenter() {
    const ps = this.slices.slice(this.base).filter(Boolean).map((s) => s.g.position);
    return ps.length ? ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length) : null;
  }
  // (whether a pusher at p, turned q, would be in any slice)
  overlaps(p, rot) {
    let hit = false;
    const shape = new R.Cuboid(PUSH.w * SC, PUSH.h * SC, PUSH.t * SC);
    this.world.intersectionsWithShape(v(p), q(rot), shape, (c) => { if (c !== this.wall && c.parent() && c.parent().isDynamic()) { hit = true; return false; } return true; });
    return hit;
  }
  // Set up somewhere else, each – the melon's slices stood on their rinds for the next cuts: from where they lie, over to
  // the targets ([{pos, q}] in the world, a slice's own frame), in a little arc, over s seconds; true once there
  arrange(dt, targets, s = 0.5) {
    if (!this.moving) this.moving = { t: 0, from: this.slices.map((x) => x && { pos: x.g.position.clone(), q: x.g.quaternion.clone() }) };
    const M = this.moving;
    M.t += dt;
    const u = Math.min(1, M.t / s), e = u * u * (3 - 2 * u);
    this.slices.forEach((x, i) => {
      const T = targets[i], F = M.from[i];
      if (!x || !T || !F) return;
      x.g.position.copy(F.pos).lerp(T.pos, e).add(new THREE.Vector3(0, 0.04 * Math.sin(Math.PI * e), 0));
      x.g.quaternion.copy(F.q).slerp(T.q, e);
    });
    return u >= 1;
  }
  // where they lie, all together: the middle of the pile (on the board – y where the thing lay) – or null
  pileCenter() {
    const ps = this.slices.filter(Boolean).map((s) => s.g.position);
    if (!ps.length || !this.food) return null;
    const c = ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length);
    return c.setY(this.food.pos.y);
  }
  // kin: the pusher's way this frame (from, to, q) – moved along it a substep at a time
  step(dt, kin = null) {
    const W = this.world;
    // (in steps no longer than 1/60 s – the frame's time, up to a tenth of a second)
    const all = Math.min(0.1, dt);
    let left = all;
    while (left > 1e-4) {
      const h = Math.min(1 / 60, left);
      left -= h;
      if (kin) { this.pusher.setNextKinematicTranslation(v(kin.from.clone().lerp(kin.to, 1 - left / all))); this.pusher.setNextKinematicRotation(q(kin.q)); }
      W.timestep = h; W.step();
    }
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
