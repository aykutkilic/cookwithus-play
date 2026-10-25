// The kitchen view: a Three.js diorama lit like Detective Achille's rooms – a
// faint room reflection, sky light, a soft-shadowed key light, and the warm
// point lights of the kitchen itself (its lamps, the wood fire, burners and
// ovens when they're on), ACES tone mapping and ambient occlusion on desktop.
// Every frame it shows the live state: pots on the burners with their
// liquid, bubbles and steam, flames and knobs, glowing ovens, running taps,
// bins filling up, food on the boards (the same drawings as the close-ups),
// and the cooks walking and working.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildKitchen, FIXTURES, walkable } from '../shared/kitchens.js';
import { VESSELS, twoHanded } from '../shared/ingredients.js';
import { buildKitchen3D, COUNTER_H } from './kitchen3d.js';
import { buildCook, poseCook, fadeCook, toolMesh } from './cook3d.js';
import { FpArms } from './fparms3d.js';
import { MAIN, SIDE } from './station.js';
import { buildFood, foodKey } from './food3d.js';
import { lookOf } from './figure.js';
import { mat, M, ball, cyl, lathe, ring, box, rod, v3 } from './parts3d.js';
import { drawIngredient, drawPieces, liquidColor } from './art.js';
import { themeOf } from './theme.js';

const LIGHTS = 6;
const GLIDE_S = 0.45;  // a thing taken / put down travels this long, in a little arc
const REACH_S = 0.55;  // and the cook reaches out for it
const EYE_H = 0.84;    // first person: eye height (a counter is 0.46 – about 90 cm – so about 165 cm)
const UP = new THREE.Vector3(0, 1, 0);
const WORK_S = 0.001;  // first person at work: kitchen units per close-up px
// how far below the fist a tool's working end is (the knife's edge, the whisk's loops …)
const TOOL_LEN = { knife: 0.19, peeler: 0.07, spoon: 0.18, ladle: 0.18, whisk: 0.19, masher: 0.18, brush: 0.17, spatula: 0.2, tongs: 0.2, blenderStick: 0.12, shaker: 0.07, grater: 0, rollingPin: 0.02, pizzaPeel: 0.05 };
// where a hand holds a pan by its handle (model coordinates, see buildVessel)
const GRIP3D = { saucepan: new THREE.Vector3(0.254, 0.093, 0.032), pan: new THREE.Vector3(0.294, 0.037, 0.032), cezve: new THREE.Vector3(0.194, 0.084, 0.032) };
const mobile = matchMedia('(pointer: coarse)').matches;
// ?lite: no shadows or ambient occlusion and a low frame rate (slow machines, headless tests)
export const LITE = new URLSearchParams(location.search).has('lite');

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.dpr = LITE ? 1 : Math.min(devicePixelRatio, mobile ? 1.5 : 2);
    r.setPixelRatio(this.dpr);
    r.shadowMap.enabled = !LITE;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.25;
    this.hemi = new THREE.HemisphereLight('#fff1dc', '#5a3a2a', 0.7);
    this.key = new THREE.DirectionalLight('#ffe6c4', 1.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.fill = new THREE.DirectionalLight('#bcd0ff', 0.3);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill, this.fill.target);
    this.lamps = Array.from({ length: LIGHTS }, (_, i) => {
      const l = new THREE.PointLight('#ffb067', 0, 3, 2);
      this.scene.add(l);
      void i;
      return l;
    });
    this.composer = null;
    if (!mobile && !LITE) {
      try {
        const composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
        composer.addPass(new RenderPass(this.scene, this.camera));
        const ao = new GTAOPass(this.scene, this.camera, 1, 1);
        ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 2, thickness: 1, scale: 1, samples: 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
        ao.blendIntensity = 0.8;
        // the food standees (sprites) are flat cut-outs: keep them out of the occlusion
        // (it would see each as a solid card and darken a box round it)
        const hide = ao._overrideVisibility.bind(ao);
        ao._overrideVisibility = function () {
          hide();
          this.scene.traverse((o) => { if (o.isSprite && o.visible) { this._visibilityCache.push(o); o.visible = false; } });
        };
        composer.addPass(ao);
        composer.addPass(new OutputPass());
        this.composer = composer;
      } catch (e) { console.warn('no ambient occlusion', e); }
    }
    this.q = { steps: this.qualitySteps(), level: 0, n: 0, sum: 0, skip: 120 };
    this.fps = 0;
    this.K = null; this.k3 = null;
    this.vessels = new Map();  // vessel id -> {kind, group, liquid, lid, bits}
    this.cooks = new Map();    // member id -> {fig, key}
    this.sprites = new Map();  // slot key -> sprite
    this.spriteTex = new Map();
    this.particles = [];
    this.glides = new Map(); // thing -> where it's drawn while it travels
    this.foods = new Map();  // first person: the food in 3D (slot -> {key, g})
    this.lookKeys = new WeakMap();
    this.t = 0;
    this.dt = 0;
    this.zoom = 1;
    this.firstPerson = false;
    this.scene.add(this.camera); // (its children – my arms in first person – are drawn too)
    this.fpArms = new FpArms(this.camera);
    this.fpSlots = [null, null]; // what my left and right hands hold (first person)
    this.fpWant = new Map();     // (a thing being taken → the hand taking it)
    this.fpHold = new Map();     // thing -> how it's held ('handle', 'palm', 'side')
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.camInit = false;
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.marker = this.buildMarker();
    this.scene.add(this.marker);
    this.guides = new THREE.Group();
    this.scene.add(this.guides);
    this.steam = this.buildSteam();
    this.scene.add(this.steam.points);
  }

  // ------------------------------------------------------------------ kitchen

  setKitchen(size, cuisine) {
    if (this.K && this.K.size === size && this.K.cuisine === cuisine) return this.K;
    if (this.k3) { this.scene.remove(this.k3.root); disposeTree(this.k3.root); }
    // (the old kitchen's glowing copies)
    for (const g of (this.ghosts || new Map()).values()) if (g) { this.guides.remove(g); g.geometry.dispose(); }
    this.ghosts = new Map();
    this.glowing = null;
    for (const v of this.vessels.values()) this.dynamic.remove(v.group);
    this.vessels.clear();
    for (const s of this.sprites.values()) this.dynamic.remove(s);
    this.sprites.clear();
    this.K = buildKitchen(size, cuisine);
    this.k3 = buildKitchen3D(this.K);
    this.glides.clear();
    this.scene.add(this.k3.root);
    const T = this.k3.theme;
    this.hemi.color.set(T.light.sky); this.hemi.groundColor.set(T.light.ground); this.hemi.intensity = T.light.hemi;
    this.key.color.set(T.light.key); this.key.intensity = T.light.keyI;
    this.renderer.toneMappingExposure = T.light.exposure;
    // the key light from above the open front corner, its shadow box round the room
    const W = this.K.w, H = this.K.h;
    const c = new THREE.Vector3(W / 2, 0, H / 2);
    this.key.position.set(c.x + W * 0.6, Math.max(W, H) * 1.5, c.z + H * 1.1);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera;
    const R = Math.hypot(W, H) * 0.62;
    sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 0.5; sc.far = Math.max(W, H) * 5; sc.updateProjectionMatrix();
    this.fill.position.set(c.x - W, H * 0.8, c.z + H * 0.2); this.fill.target.position.copy(c);
    // static light sources: positions to world
    this.staticGlows = this.k3.glows.map((g) => {
      const p = g.pos.clone();
      if (g.local && g.group) { g.group.updateMatrixWorld(true); p.applyMatrix4(g.group.matrixWorld); }
      return { ...g, pos: p };
    });
    this.camInit = false;
    this.q.skip = Math.max(this.q.skip, 60); // new shaders compile: don't count those frames
    return this.K;
  }

  // ------------------------------------------------------------------ keeping it smooth

  // What can be given up, most expensive first, when frames come too slowly.
  qualitySteps() {
    const steps = [];
    if (this.composer) steps.push(['no ambient occlusion', () => { this.composer.dispose(); this.composer = null; }]);
    if (this.dpr > 1.5) steps.push(['resolution 1.5×', () => this.setDpr(1.5)]);
    if (this.dpr > 1) steps.push(['resolution 1×', () => this.setDpr(1)]);
    if (this.renderer.shadowMap.enabled) {
      steps.push(['no shadows', () => {
        this.renderer.shadowMap.enabled = false;
        this.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
      }]);
    }
    return steps;
  }

  setDpr(r) {
    this.renderer.setPixelRatio(r);
    if (this.composer) this.composer.setPixelRatio(r);
    this.resize();
  }

  get quality() { return `${this.q.steps.slice(0, this.q.level).map((s) => s[0]).join(', ') || 'full'}${this.hz ? ` · display ${this.hz} Hz` : ''}`; }

  // Called every frame with the time since the last one. It learns how fast
  // the display refreshes (60, 120 Hz …) from the quickest frames, and when the
  // frames come clearly slower than that for a while (averaged over ~1 s), it
  // drops the next extra and looks again.
  govern(ms) {
    const q = this.q;
    if (ms > 250) return; // a hidden tab, a dialog: not the renderer's fault
    if (ms > 2) { q.fast = q.fast ? Math.min(q.fast * 1.002, ms) : ms; } // ~ the refresh interval (slowly forgiving)
    if (q.skip > 0) { q.skip--; return; }
    q.n++; q.sum += ms;
    if (q.n < 90) return;
    const avg = q.sum / q.n;
    q.n = 0; q.sum = 0;
    this.fps = Math.round(1000 / avg);
    const refresh = Math.max(4, Math.min(17, q.fast || 16.7));
    this.hz = Math.round(1000 / refresh);
    if (avg > refresh * 1.18 && q.level < q.steps.length) {
      const [name, apply] = q.steps[q.level++];
      apply();
      console.info(`cookwithus: ${this.fps} fps, now ${name}`);
      q.skip = 45;
    }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.insets) this.setInsets(this.insets.left, this.insets.bottom);
  }

  zoomBy(f) { if (!this.firstPerson) this.zoom = Math.max(0.45, Math.min(1.6, this.zoom / f)); }
  // first person: my eyes, standing at (x, y) facing yaw, leaning in by lean
  // (a little above the chibi head and a step back)
  eyeAt(x, y, yaw, eyeOff = 0, lean = 0) {
    return new THREE.Vector3(x - Math.sin(yaw) * (0.14 - lean), EYE_H + eyeOff - lean * 0.35, y - Math.cos(yaw) * (0.14 - lean));
  }
  // how far I lean in over work at O (further for the back burner, the middle of the sink;
  // hardly at all for the knob on the stove's front, the tap's lever – real: the pan stays in view too)
  workLeanAt(O, x, y, real = false) { return real ? 0 : Math.max(0.18, Math.min(0.42, Math.hypot(O.x - x, O.z - y) - 0.42)); }
  // first person, the mouse looking round: the view turns at once (no easing after it)
  lookBy(yaw, pitch) { if (this.fpCam) { this.fpCam.yaw += yaw; this.fpCam.pitch += pitch; } }

  // F2: looking through my cook's eyes, or at the whole room
  setFirstPerson(on) {
    this.firstPerson = on;
    this.camera.fov = on ? 80 : 32;
    this.fpCam = null; // (start right at my eyes)
    this.camera.near = on ? 0.03 : 0.1;
    this.camera.updateProjectionMatrix();
    this.camInit = false;
  }

  // panels cover part of the screen: centre the kitchen in what's left
  setInsets(left, bottom, top = 64) {
    this.insets = { left, bottom, top };
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.camera.setViewOffset(w, h, -left / 2, (bottom - top) / 2, w, h);
  }

  // grid point → screen (CSS px), for name tags and prompts
  project(gx, y, gz) {
    const v = new THREE.Vector3(gx, y, gz).project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, on: v.z < 1 };
  }

  // ---------------------------------------------------------------- first person: hands on things
  // (client px ↔ the world)
  screenOf(w) {
    const r = this.canvas.getBoundingClientRect();
    const v = w.clone().project(this.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, on: v.z < 1 && v.z > -1 };
  }
  rayAt(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const rc = this.raycaster || (this.raycaster = new THREE.Raycaster());
    rc.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1), this.camera);
    return rc.ray;
  }
  // where the middle of the view is on the screen (the view is shifted clear of the panels)
  viewCenter() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return this.screenOf(this.camera.position.clone().add(d));
  }
  rayPoint(cx, cy, d) { return this.rayAt(cx, cy).at(d, new THREE.Vector3()); }
  // how many screen px a world size is, there
  pxOf(w, size) {
    const r = this.canvas.getBoundingClientRect();
    const d = Math.max(0.05, w.distanceTo(this.camera.position));
    return size / (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * r.height;
  }
  // how far a store's door is open (as drawn)
  doorOpenness(fx) {
    const F = this.k3.fx[fx];
    return F && F.parts.door ? F.parts.door.userData.o || 0 : 0;
  }
  // a store's handle (where a hand takes it), in the world
  handleWorld(fx) {
    const F = this.k3.fx[fx];
    if (!F || !F.parts.leaf) return null;
    F.parts.leaf.updateWorldMatrix(true, false);
    const [a, b] = F.parts.handle;
    return F.parts.leaf.localToWorld(a.clone().lerp(b, 0.5));
  }
  // How far open the door would be with the hand holding its handle at this
  // point of the screen: round its hinge, as far as the handle swings.
  doorAt(fx, cx, cy) {
    const F = this.k3.fx[fx];
    const hinge = F.parts.door, g = hinge.parent;
    const ray = this.rayAt(cx, cy);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv);
    const h = hinge.position, R = F.parts.handle[0].x + F.parts.leaf.position.x;
    // in the floor plane: where the line of sight meets the handle's circle round the hinge
    const ox = o.x - h.x, oz = o.z - h.z, n = Math.hypot(d.x, d.z) || 1, dx = d.x / n, dz = d.z / n;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - R * R, disc = b * b - c;
    let px, pz;
    if (disc >= 0) { const t = -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : -b + Math.sqrt(disc); px = ox + dx * t; pz = oz + dz * t; } else { px = ox - dx * b; pz = oz - dz * b; }
    return Math.max(0, Math.min(1, Math.atan2(pz, px) / 1.75));
  }
  // the spot on a store's shelves under this point of the screen: {r, x, w}
  shelfSpotAt(fx, cx, cy) {
    const F = this.k3.fx[fx];
    if (!F || !F.anchors.shelfL || this.doorOpenness(fx) < 0.45) return null;
    const g = F.parts.door.parent;
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const ray = this.rayAt(cx, cy);
    const o = ray.origin.clone().applyMatrix4(inv), d = ray.direction.clone().transformDirection(inv);
    const Ls = F.anchors.shelfL.map((w) => w.clone().applyMatrix4(inv)), Rs = F.anchors.shelfR.map((w) => w.clone().applyMatrix4(inv));
    let best = null;
    Ls.forEach((L, lv) => {
      if (Math.abs(d.y) < 1e-4) return;
      const t = (L.y + 0.02 - o.y) / d.y;
      if (t <= 0 || (best && t >= best.t)) return;
      const p = o.clone().addScaledVector(d, t);
      if (p.x < L.x - 0.06 || p.x > Rs[lv].x + 0.06 || p.z < L.z - 0.6 || p.z > L.z + 0.26) return; // (from the back of the shelf to just in front of it)
      const u = Math.max(0, Math.min(1, (p.x - L.x) / (Rs[lv].x - L.x)));
      best = { t, r: Ls.length - 1 - lv, x: Math.round(Math.max(0, Math.min(1, (u - 0.08) / 0.84)) * 100) / 100, w: F.anchors.shelfL[lv].clone().lerp(F.anchors.shelfR[lv], u) };
    });
    return best && { r: best.r, x: best.x, w: best.w };
  }
  // What a hand could take hold of at this point of the screen, in reach:
  // a thing in my hands, a store's door handle, a thing on its shelves (door
  // open), or a spot on a shelf (to put something) – or null.
  fpPick(cx, cy, me, held = []) {
    if (!this.firstPerson || !me) return null;
    const near = (q) => {
      const best = { d: Infinity, q: null };
      for (const c of q) { const s = this.screenOf(c.w); if (!s.on) continue; const d = Math.hypot(s.x - cx, s.y - cy); if (d < c.r && d < best.d) { best.d = d; best.q = c; } }
      return best.q;
    };
    // what's in my hands
    const mine = [];
    for (const [k, e] of this.stashAt || []) {
      if (!e.fp || !held.includes(k)) continue;
      const w = this.glides.get(k) ? this.glides.get(k).pos.clone() : e.pos.clone();
      const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      w.y += vr ? vr.h * 0.5 : (e.size || 0.1) * 0.4;
      mine.push({ kind: 'held', key: k, w, r: Math.max(34, this.pxOf(w, vr ? vr.r * 1.6 : (e.size || 0.1) * 0.9)) });
    }
    const m = near(mine);
    if (m) return m;
    // the stores in reach, in front of me
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      if (!F.parts.leaf) continue;
      const c = F.f;
      const ddx = Math.max(c.x, Math.min(c.x + c.w, me.x)) - me.x, ddz = Math.max(c.y, Math.min(c.y + c.h, me.y)) - me.y;
      if (Math.hypot(ddx, ddz) > 1.3) continue;
      const hw = this.handleWorld(fx);
      const [a, b] = F.parts.handle.map((p) => this.screenOf(F.parts.leaf.localToWorld(p.clone())));
      if (a.on && b.on) {
        // near the handle's line on the screen
        const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((cx - a.x) * vx + (cy - a.y) * vy) / L2));
        if (Math.hypot(a.x + vx * t - cx, a.y + vy * t - cy) < Math.max(28, this.pxOf(hw, 0.07))) return { kind: 'door', fx, w: hw };
      }
      if (this.doorOpenness(fx) < 0.45) continue;
      const things = [];
      for (const [k, e] of this.stashAt || []) {
        if (!e.stored || !e.sig || !e.sig.startsWith(`s:${fx}:`)) continue;
        const w = (this.glides.get(k) ? this.glides.get(k).pos : e.pos).clone();
        const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
        w.y += vr ? vr.h * 0.8 * 0.5 : 0.17 * 0.4;
        things.push({ kind: 'thing', key: k, fx, w, r: Math.max(26, this.pxOf(w, vr ? vr.r * 0.8 * 1.6 : 0.15)) });
      }
      const t = near(things);
      if (t) return t;
      const spot = this.shelfSpotAt(fx, cx, cy);
      if (spot) return { kind: 'shelf', fx, ...spot };
    }
    // (or just the fridge / pantry itself: its door to open or shut)
    for (const [fx, F] of Object.entries(this.k3.fx)) {
      if (!F.parts.leaf) continue;
      const c = F.f;
      if (Math.hypot(Math.max(c.x, Math.min(c.x + c.w, me.x)) - me.x, Math.max(c.y, Math.min(c.y + c.h, me.y)) - me.y) > 1.3) continue;
      const box = new THREE.Box3(new THREE.Vector3(c.x, 0, c.y), new THREE.Vector3(c.x + c.w, 1.25, c.y + c.h));
      if (this.rayAt(cx, cy).intersectsBox(box)) return { kind: 'store', fx };
    }
    return null;
  }

  // the screen-space directions of the grid axes (for moving with keys / stick)
  screenAxes() {
    const o = this.project(0, 0, 0), ex = this.project(1, 0, 0), ez = this.project(0, 0, 1);
    return { x: [ex.x - o.x, ex.y - o.y], z: [ez.x - o.x, ez.y - o.y] };
  }

  // ------------------------------------------------------------------ frame

  // view: {C, D, cooks: [{id, x, y, yaw, walk, work, carry, avatar, me}], target, guide: Set, activeAt: Map, me}
  frame(dt, view) {
    if (!this.K) return;
    this.t += dt;
    this.dt = dt;
    this.updateCamera(dt, view);
    this.workScene(view);
    this.updateFixtures(view);
    this.updateCooks(view, dt); // first: things in their hands follow them
    this.updateArms(view, dt);
    this.updateStash(view);
    this.updateVessels(view, dt);
    this.updateItems(view);
    this.updateWorkFx(dt);
    this.updateMarker(view);
    this.updateLights(view);
    this.updateSteam(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt, view) {
    const K = this.K;
    const W = K.w, H = K.h;
    const me = view.cooks.find((c) => c.me);
    if (this.firstPerson && me) {
      // at my eyes, looking where I face (and up / down as I like)
      // (the view eases after where I face – keys, stick or dragging – so it never jumps)
      const c = this.fpCam;
      if (!c || Math.hypot(c.x - me.x, c.y - me.y) > 1.5) this.fpCam = { x: me.x, y: me.y, yaw: me.yaw || 0, pitch: view.pitch ?? -0.18 };
      const F = this.fpCam, k = 1 - Math.exp(-dt * 22);
      let dy = (me.yaw || 0) - F.yaw;
      dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      F.yaw += dy * k;
      F.pitch += ((view.pitch ?? -0.18) - F.pitch) * k;
      F.x = me.x; F.y = me.y;
      const pitch = F.pitch, yaw = F.yaw;
      // eyes a little above the chibi head and a step back, so a counter right in front doesn't fill the view
      // (leaning in a little while reaching for something)
      // (and a little closer while working at something)
      // (further in for something at the back – the back burner, the middle of the sink)
      const wo = this.work && !this.work.idle && this.work.O;
      const wantLean = wo ? this.workLeanAt(wo, me.x, me.y, this.work.real) : 0;
      this.workLean = (this.workLean || 0) + (wantLean - (this.workLean || 0)) * (1 - Math.exp(-dt * 4));
      const lean = Math.max(this.fpArms.lean(), this.workLean);
      const eye = this.eyeAt(me.x, me.y, yaw, view.eyeOff || 0, lean);
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.camera.position.copy(eye);
      this.camTarget.copy(eye).add(dir);
      this.camera.lookAt(this.camTarget);
      this.camPos.copy(eye);
      return;
    }
    const R = Math.hypot(W, H) / 2 + 0.6;
    // fit into the part of the screen the panels leave free
    const ins = this.insets || { left: 0, bottom: 0, top: 64 };
    const cw = Math.max(200, this.canvas.clientWidth - ins.left), ch = Math.max(200, this.canvas.clientHeight - ins.bottom - ins.top);
    const vfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * ch / this.canvas.clientHeight);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cw / ch);
    let dist = R / Math.sin(Math.min(vfov, hfov) / 2) * 0.9;
    // big kitchens: stay closer and follow the cook
    const big = dist > 13;
    if (big) dist = 12.5;
    dist *= this.zoom;
    const center = new THREE.Vector3(W / 2, 0.3, H / 2 + 0.15);
    const target = center.clone();
    if (me && (big || this.zoom < 0.9)) {
      const f = big ? 0.85 : 0.6;
      target.lerp(new THREE.Vector3(me.x, 0.4, me.y), f);
    }
    const az = Math.PI / 4, el = THREE.MathUtils.degToRad(46);
    const offset = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
    const pos = target.clone().add(offset);
    const k = this.camInit ? 1 - Math.exp(-dt * 4) : 1;
    this.camTarget.lerp(target, k);
    this.camPos.lerp(pos, k);
    this.camInit = true;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  // ------------------------------------------------------------------ fixtures' live parts

  updateFixtures(view) {
    const C = view.C, D = view.D;
    const fxs = (C && C.fx) || {};
    for (const [id, F] of Object.entries(this.k3.fx)) {
      const P = F.parts;
      if (P.door) {
        // the fridge door swings open / shut
        const u = P.door.userData;
        if (u.base == null) { u.base = P.door.rotation.y; u.o = 0; }
        const live = view.doors && view.doors.has(id);
        const want = live ? view.doors.get(id) : fxs[id] && fxs[id].door ? 1 : 0;
        u.o += (want - u.o) * (live ? 0.35 : 0.18);
        P.door.rotation.y = u.base - u.o * 1.75;
      }
      if (P.drop) {
        // the oven door folds down towards you
        const u = P.drop.userData;
        // tip about its own hinge, whichever way the oven faces
        if (u.o == null) { u.o = 0; P.drop.rotation.setFromQuaternion(P.drop.quaternion, 'YXZ'); u.baseX = P.drop.rotation.x; }
        const live = view.doors && view.doors.has(id);
        const want = live ? view.doors.get(id) : fxs[id] && fxs[id].door ? 1 : 0;
        u.o += (want - u.o) * (live ? 0.35 : 0.18);
        P.drop.rotation.x = u.baseX + u.o * 1.45;
      }
      const st = fxs[id] || {};
      if (P.water) {
        P.water.visible = !!st.tap;
        if (P.water.visible) { P.water.scale.x = P.water.scale.z = 1 + Math.sin(this.t * 30) * 0.15; }
        if (P.water.visible && Math.random() < 0.3) this.puff(F.anchors.basin, 'drop');
      }
      if (P.lever) P.lever.rotation.z = st.tap ? 0.6 : 0;
      // burners
      if (P.flames) {
        P.flames.forEach((fr, slot) => {
          const v = D && vesselAtSlot(D, id, slot, F.f.type);
          const lit = fxs[id] && fxs[id].lit && fxs[id].lit[slot];
          const heat = v ? v.heat || 0 : lit || 0; // (an empty burner left on burns too)
          fr.visible = heat > 0;
          if (heat > 0) {
            fr.scale.set(1, 0.6 + heat * 0.35, 1);
            fr.children.forEach((c, i) => { c.scale.y = 0.8 + Math.sin(this.t * 22 + i * 1.7) * 0.25; });
          }
          if (P.knobs && P.knobs[slot]) P.knobs[slot].rotation.z = -heat * 0.9;
          // (turning it right now, in first person: it follows the hand)
          if (P.knobs && P.knobs[slot] && this.work && this.work.knob && this.work.knob.fx === id && this.work.knob.slot === slot) P.knobs[slot].rotation.z = -this.work.knob.level * 0.9;
        });
      }
      // ovens glow when something bakes inside
      if (P.glow) {
        const on = D && Object.values(D.vessels).some((v) => v.at && v.at.fx === id && v.heat > 0 && !v.onHob);
        P.glow.material.emissiveIntensity = on ? 1.4 + Math.sin(this.t * 3) * 0.15 : 0;
      }
      if (P.fire) P.fire.children.forEach((c, i) => { c.scale.y = 0.75 + Math.sin(this.t * (9 + i) + i * 2) * 0.3; });
      if (P.fire && P.fire.isMesh) P.fire.material.emissiveIntensity = 2.6 + Math.sin(this.t * 5) * 0.4;
      // bins: the bag bulges as it fills; a full one has its lid up
      if (P.lid) {
        const holds = FIXTURES[F.f.type].holds;
        const fill = C && C.bins && C.bins[id] ? C.bins[id].fill : 0;
        const k = Math.min(1, fill / holds);
        const busy = view.busy && view.busy.has(id);
        const open = k >= 1 || busy ? -1.3 : 0;
        P.lid.rotation.x += (open - P.lid.rotation.x) * 0.15;
        P.bag.visible = k > 0.6;
        P.bag.scale.set(1, 0.5 + (k - 0.6) * 1.5, 1);
        if (k >= 1 && Math.random() < 0.05) this.puff(F.anchors.top, 'fly');
      }
    }
  }

  // ------------------------------------------------------------------ where things are kept / carried

  // Things put away in the fridge / on the shelf each get a place there, and
  // things in someone's hands go where their hands are: thing key -> {pos, yaw}.
  updateStash(view) {
    const D = view.D;
    const out = new Map();
    this.stashAt = out;
    if (!D) return;
    // put away: each store's things, in order – pans at the bottom, dishes
    // above, food at the top (the fridge: food from the top shelf down)
    const per = new Map();
    const add = (fx, key) => { if (!per.has(fx)) per.set(fx, []); per.get(fx).push(key); };
    for (const [id, v] of Object.entries(D.vessels)) if (!v.at && v.held == null && v.home) add(v.home, `v:${id}`);
    for (const [id, it] of Object.entries(D.items)) {
      if (it.in || it.hidden || it.held != null || !it.at) continue;
      const F = this.k3.fx[it.at];
      if (F && F.anchors.shelfL) add(it.at, `i:${id}`);
    }
    for (const [fx, keys] of per) {
      const F = this.k3.fx[fx];
      if (!F || !F.anchors.shelfL) continue;
      const Ls = F.anchors.shelfL, Rs = F.anchors.shelfR, n = Ls.length;
      const fridge = F.f.type === 'fridge';
      const kindOf = (k) => (k[0] === 'v' ? D.vessels[k.slice(2)].kind : D.items[k.slice(2)].kind);
      const cat = (k) => (k[0] === 'i' ? 'food' : VESSELS[kindOf(k)] && VESSELS[kindOf(k)].hob ? 'pans' : 'dishes');
      // (levels bottom to top here; a spot's shelf r counts from the top)
      const prefer = fridge ? { food: [3, 2, 1, 0], pans: [0, 1, 2, 3], dishes: [0, 1, 2, 3] } : { pans: [0, 1, 2, 3], dishes: [1, 0, 2, 3], food: [2, 3, 1, 0] };
      const SLOTS = [0.125, 0.375, 0.625, 0.875];
      const taken = Ls.map(() => new Set());
      const put = (k, lv, u) => {
        out.set(k, { pos: Ls[lv].clone().lerp(Rs[lv], u), yaw: k[0] === 'v' && GRIP3D[kindOf(k)] ? Math.atan2(F.front.z, -F.front.x) : null, stored: true, sig: `s:${fx}:${lv}:${u.toFixed(2)}` });
        taken[lv].add(SLOTS.reduce((a, q, i) => (Math.abs(q - u) < Math.abs(SLOTS[a] - u) ? i : a), 0));
      };
      // where cooks put things (handles turned to the back of the shelf), then the rest in order
      const loose = [];
      for (const k of keys) {
        const t = k[0] === 'v' ? D.vessels[k.slice(2)] : D.items[k.slice(2)];
        if (t.spot && t.spot.r < n) put(k, n - 1 - t.spot.r, 0.08 + t.spot.x * 0.84);
        else loose.push(k);
      }
      loose.sort((a, b) => ['pans', 'dishes', 'food'].indexOf(cat(a)) - ['pans', 'dishes', 'food'].indexOf(cat(b)) || a.localeCompare(b));
      for (const k of loose) {
        const pr = prefer[cat(k)].filter((i) => i < n);
        let lv = pr.find((i) => taken[i].size < SLOTS.length);
        if (lv === undefined) lv = pr[0];
        const slot = SLOTS.findIndex((q, i) => !taken[lv].has(i));
        put(k, lv, slot >= 0 ? SLOTS[slot] : 0.5);
      }
    }
    // in my own hands, in first person – and on their way into them or out
    const meRec = this.fpOn ? this.cooks.get(this.fpMe) : null;
    if (meRec) {
      for (let i = 0; i < 2; i++) {
        const r = this.fpArms.reaching(i);
        const k = r && !r.take && !r.released ? r.key : this.fpSlots[i];
        if (!k || out.has(k)) continue;
        // (where it lay till the hand closes on it; then, if the hand only got
        // within arm's length of it, it comes the rest of the way)
        if (r && r.key === k && r.take && !r.grabbed) { out.set(k, { pos: r.src, yaw: r.srcYaw, sig: 'fp:lying', fp: true, size: 0.24 }); continue; }
        // (food is drawn hand-sized in the hand, and grows back to its size on the
        // counter as it goes there – on its way out of the hand, see updateItems)
        const p = r && r.key === k && r.take ? r.p : 0;
        out.set(k, { ...this.fpAttach(k, i, meRec), sig: 'fp', fp: true, size: 0.1 + 0.14 * p });
      }
    }
    // in someone's hands
    for (const rec of this.cooks.values()) {
      if (!rec.holding || !rec.hands || (rec === meRec && rec.fig.visible === false)) continue;
      rec.holding.forEach((k, i) => {
        if (k[0] === 'v' && !GRIP3D[rec.holdKind] && !twoHanded(rec.holdKind)) {
          // a plate, a bowl: carried on one hand, out in front
          const p = rec.rightHand.clone();
          p.x += Math.sin(rec.yaw) * 0.06; p.z += Math.cos(rec.yaw) * 0.06; p.y -= 0.02;
          out.set(k, { pos: this.aboveCounter(p), yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
          return;
        }
        const g = k[0] === 'v' && GRIP3D[rec.holdKind];
        if (g) {
          // a pan by its handle, in the right hand, the pan out in front
          const th = rec.yaw + Math.PI / 2, sc = 0.85;
          const gx = g.x * Math.cos(th) + g.z * Math.sin(th), gz = -g.x * Math.sin(th) + g.z * Math.cos(th);
          const p = rec.rightHand.clone().sub(new THREE.Vector3(gx * sc, g.y * sc, gz * sc));
          out.set(k, { pos: this.aboveCounter(p, 0.12), yaw: th, held: true, sig: `h:${rec.id}` });
          return;
        }
        const p = rec.hands.clone();
        p.x += Math.sin(rec.yaw) * 0.02 + Math.cos(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.z += Math.cos(rec.yaw) * 0.02 - Math.sin(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.y -= 0.05;
        out.set(k, { pos: this.aboveCounter(p), yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
      });
    }
  }

  // Things travel between places in a little arc instead of jumping: when
  // where it belongs changes (sig), it glides from where it was drawn.
  glide(key, sig, target) {
    let g = this.glides.get(key);
    if (!g) { g = { sig, pos: target.clone(), from: null, t: 1 }; this.glides.set(key, g); return g.pos; }
    if (g.sig !== sig) { g.fromHand = g.sig === 'fp'; g.sig = sig; g.from = g.pos.clone(); g.t = 0; }
    if (g.t < 1) {
      g.t = Math.min(1, g.t + this.dt / GLIDE_S);
      const e = g.t * g.t * (3 - 2 * g.t);
      g.pos.lerpVectors(g.from, target, e);
      g.pos.y += Math.sin(Math.PI * g.t) * 0.12 * Math.min(1, g.from.distanceTo(target) * 1.5);
    } else g.pos.copy(target);
    return g.pos;
  }

  // ------------------------------------------------------------------ pots & pans

  updateVessels(view, dt) {
    const D = view.D;
    const seen = new Set();
    // vessels resting on the same counter / table share its spots
    const spotUse = new Map();
    if (D) {
      for (const [id, v] of Object.entries(D.vessels)) {
        const ov = this.work && this.work.ov.get(`v:${id}`);
        const kept = ov || (this.stashAt && this.stashAt.get(`v:${id}`));
        if (!v.at && !kept) continue;
        const F = v.at && this.k3.fx[v.at.fx];
        if (!F && !kept) continue;
        let p = null;
        const A = F ? F.anchors : {};
        if (kept) p = kept.pos;
        else if (A.burners && (v.onHob || F.f.type === 'stove' || F.f.type === 'paellaBurner') && A.burners[v.at.slot]) p = A.burners[v.at.slot];
        else if (A.mouth) p = A.mouth;
        else if (A.inside) p = null; // shut in the oven
        else if (A.basin && F.f.type === 'sink') p = A.basin.clone().setY(A.basin.y + 0.02);
        else if (F.f.type === 'fridge') p = A.shelf; // chilling (behind the door)
        else if (A.spots) {
          const n = spotUse.get(v.at.fx) || 0; spotUse.set(v.at.fx, n + 1); p = A.spots[Math.min(n, A.spots.length - 1)];
          // (a bowl / plate on the board – unless something's being worked on there)
          if (n === 0 && A.board && (v.kind === 'bowl' || v.kind === 'plate' || v.kind === 'blender') && !(view.activeAt && view.activeAt.has(v.at.fx))) p = A.board;
        }
        else if (A.top) p = A.top;
        if (!p) continue;
        seen.add(id);
        let rec = this.vessels.get(id);
        if (!rec || rec.kind !== v.kind) {
          if (rec) this.dynamic.remove(rec.group);
          rec = buildVessel(v.kind);
          this.vessels.set(id, rec);
          this.dynamic.add(rec.group);
        }
        rec.group.position.copy(this.glide(`v:${id}`, kept ? kept.sig : `a:${v.at.fx}:${v.at.slot}:${v.onHob ? 1 : 0}`, p));
        rec.group.rotation.set(0, kept && kept.yaw != null ? kept.yaw : 0, 0);
        rec.group.scale.setScalar(ov || (kept && kept.fp) ? 1 : kept && kept.held ? 0.85 : kept ? 0.8 : 1);
        // (at work, first person: tipped to pour, tossed …)
        if (ov && ov.tilt) rec.group.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ov.axis, ov.tilt));
        if (ov) rec.group.position.copy(ov.pos);
        updateVessel(rec, v, this.t);
        if (v.boil > 0.25 && Math.random() < v.boil * dt * 25) this.puff(p.clone().setY(p.y + rec.h), 'steam');
        if (v.heat > 0 && (v.kind === 'pan' || v.kind === 'paellaPan') && v.contents && v.contents.length && Math.random() < dt * 12) this.puff(p.clone().setY(p.y + 0.05), 'sizzle');
        // food lying on trays / plates
        rec.items = (v.items || []).map((i) => ({ id: i.id, st: D.items[i.id] }));
      }
    }
    for (const [id, rec] of this.vessels) if (!seen.has(id)) rec.group.visible = false; else rec.group.visible = true;
    this.spotsTaken = spotUse; // (the food there takes the spots after these)
  }

  // ------------------------------------------------------------------ food on the boards (2D drawings as standees)

  spriteFor(kind, st, cut) {
    // (the key of an item's look is worked out once per state object)
    let key = cut ? `p|${kind}|${cut}` : st && this.lookKeys.get(st);
    if (!key) {
      key = `i|${kind}|${JSON.stringify(st, ['qty', 'washed', 'peeled', 'cut', 'k', 'n', 'cook', 'shape', 'size', 'sauce', 'coverage', 'toppings', 'x', 'y', 'kind', 'boiled', 'cored', 'rolls', 'stuffed', 'form'])}`;
      if (st && typeof st === 'object') this.lookKeys.set(st, key);
    }
    let tex = this.spriteTex.get(key);
    if (!tex) {
      if (this.spriteTex.size > 300) { for (const t of this.spriteTex.values()) t.dispose(); this.spriteTex.clear(); }
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const g = c.getContext('2d');
      try {
        if (cut) drawPieces(g, kind, cut, 7, 96, 170, 0.7, 3);
        else drawIngredient(g, kind, st, 96, 170, 0.9, 0);
      } catch { /* the art never throws, but be safe */ }
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.spriteTex.set(key, tex);
    }
    return tex;
  }

  placeSprite(slot, tex, pos, size = 0.3) {
    let s = this.sprites.get(slot);
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.center.set(0.5, 0.1);
      this.sprites.set(slot, s);
      this.dynamic.add(s);
    }
    if (s.material.map !== tex) { s.material.map = tex; s.material.needsUpdate = true; }
    s.position.copy(pos);
    s.scale.set(size, size, 1);
    s.visible = true;
    s.userData.seen = this.t;
  }

  // first person: a food in 3D at a slot (rebuilt only when its look changes)
  placeFood(slot, kind, st, pos, yaw = 0) {
    const key = foodKey(kind, st);
    let f = this.foods.get(slot);
    if (!f || f.key !== key) {
      if (f) this.dynamic.remove(f.g);
      f = { key, g: buildFood(kind, st) };
      this.foods.set(slot, f);
      this.dynamic.add(f.g);
    }
    f.g.position.copy(pos);
    f.g.rotation.set(0, yaw, 0);
    f.g.visible = true;
  }

  updateItems(view) {
    const D = view.D;
    if (!D) { for (const s of this.sprites.values()) s.visible = false; for (const f of this.foods.values()) f.g.visible = false; return; }
    const used = new Set();
    const show = (slot, tex, pos, size) => { this.placeSprite(slot, tex, pos, size); used.add(slot); };
    // first person: the food itself, in 3D (the room view keeps its cartoon standees)
    const fp = this.firstPerson;
    const usedFood = new Set();
    const food = (slot, kind, st, pos, yaw = 0) => { this.placeFood(slot, kind, st, pos, yaw); usedFood.add(slot); };
    const put = (slot, kind, st, tex, pos, size, yaw = 0) => (fp ? food(slot, kind, st, pos, yaw) : show(slot, tex(), pos, size));
    const yawAt = (fxId) => { const F = fxId && this.k3.fx[fxId]; return F ? Math.atan2(F.front.x, F.front.z) : 0; };
    // what's being worked on, and prepped piles waiting
    const perFx = new Map();
    for (const [id, it] of Object.entries(D.items)) {
      if (it.hidden || it.in) continue;
      const ov = this.work && this.work.ov.get(`i:${id}`);
      if (ov) { put(`item:${id}`, it.kind, it, () => this.spriteFor(it.kind, it), ov.pos, ov.size || 0.2, this.work.yaw || 0); continue; }
      const kept = this.stashAt && this.stashAt.get(`i:${id}`);
      if (kept) {
        // in the fridge / on the shelf, or in someone's hands
        put(`item:${id}`, it.kind, it, () => this.spriteFor(it.kind, it), this.glide(`i:${id}`, kept.sig, kept.pos), kept.fp ? kept.size : kept.held ? 0.2 : 0.17, kept.yaw || 0);
        continue;
      }
      if (it.used && !it.at) continue;
      const fxId = it.at || (view.activeItems && view.activeItems.get(id));
      if (!fxId) continue;
      const F = this.k3.fx[fxId];
      if (!F) continue;
      const n = perFx.get(fxId) || 0;
      perFx.set(fxId, n + 1);
      const A = F.anchors;
      const active = view.activeAt && view.activeAt.get(fxId) === id;
      const taken = (this.spotsTaken && this.spotsTaken.get(fxId)) || 0;
      const pos = active && A.board ? A.board : A.spots ? A.spots[(n + taken) % A.spots.length] : A.top;
      if (!pos) continue;
      const done = it.cut && (it.k || 0) >= (it.n || 0);
      const tex = () => (done && !active ? this.spriteFor(it.kind, null, it.cut) : this.spriteFor(it.kind, it));
      const at = this.glide(`i:${id}`, `a:${fxId}`, pos), g = this.glides.get(`i:${id}`);
      const size = active ? 0.34 : 0.24;
      put(`item:${id}`, it.kind, done && !active ? { cut: it.cut, k: it.n, n: it.n, cook: it.cook } : it, tex, at, g.fromHand && g.t < 1 ? 0.1 + (size - 0.1) * g.t * g.t * (3 - 2 * g.t) : size, yawAt(fxId));
    }
    // at work (first person): what's in my hand that isn't a thing of its own (an egg to crack, a topping, a spoonful)
    if (this.work) this.work.sprites.forEach((q, i) => put(`work:${i}`, q.kind, q.st, () => q.tex, q.pos, q.size, this.work.yaw || 0));
    // food on trays and plates
    for (const [vid, rec] of this.vessels) {
      if (!rec.group.visible || !rec.items) continue;
      rec.items.forEach((i, k) => {
        if (!i.st) return;
        // (in 3D it lies on the tray / plate itself)
        const at = fp ? rec.group.position.clone().add(v3((k - (rec.items.length - 1) / 2) * 0.07, rec.h + 0.002, 0)) : rec.group.position.clone().add(v3((k - (rec.items.length - 1) / 2) * 0.12, rec.h * 0.6, 0));
        put(`on:${vid}:${k}`, i.st.kind, i.st, () => this.spriteFor(i.st.kind, i.st), at, 0.28, rec.group.rotation.y);
      });
    }
    // scraps on counters
    const C = view.C;
    if (C && C.scraps) for (const [fxId, sc] of Object.entries(C.scraps)) {
      if (!sc || !sc.n) continue;
      const F = this.k3.fx[fxId];
      if (!F || !F.anchors.scraps) continue;
      const kind = sc.kinds[sc.kinds.length - 1] || 'onion';
      const skin = { egg: '#f4e4c8', onion: '#c98a3c', potato: '#c49a5c', carrot: '#f08a24', tomato: '#4f9a3a', garlic: '#f1ead9' }[kind] || '#c98a3c';
      put(`scraps:${fxId}`, { type: 'scraps', c1: skin, n: Math.min(6, sc.n) }, {}, () => this.scrapTex(kind, sc.n), F.anchors.scraps, 0.16 + Math.min(4, sc.n) * 0.02, yawAt(fxId));
    }
    for (const [slot, s] of this.sprites) if (!used.has(slot)) s.visible = false;
    for (const [slot, f] of this.foods) if (!usedFood.has(slot)) f.g.visible = false;
  }

  scrapTex(kind, n) {
    const key = `scraps|${kind}|${Math.min(6, n)}`;
    let tex = this.spriteTex.get(key);
    if (!tex) {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d');
      const cols = { egg: '#f4e4c8', onion: '#c98a3c', potato: '#c49a5c', carrot: '#f08a24', tomato: '#4f9a3a', garlic: '#f1ead9' };
      for (let i = 0; i < Math.min(6, n) * 3; i++) {
        g.save(); g.translate(20 + (i * 37) % 56, 60 + (i * 23) % 26); g.rotate(i * 1.3);
        g.fillStyle = cols[kind] || ['#c98a3c', '#7ab05a', '#e8c88a'][i % 3];
        g.strokeStyle = '#3d2a24'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
      }
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.spriteTex.set(key, tex);
    }
    return tex;
  }

  // ------------------------------------------------------------------ cooks

  updateCooks(view, dt) {
    const seen = new Set();
    for (const c of view.cooks) {
      seen.add(c.id);
      const key = JSON.stringify(c.avatar);
      let rec = this.cooks.get(c.id);
      if (!rec || rec.key !== key) {
        if (rec) { this.scene.remove(rec.fig); disposeTree(rec.fig); }
        rec = { fig: buildCook(c.avatar), key, yaw: c.yaw || 0 };
        this.cooks.set(c.id, rec);
        this.scene.add(rec.fig);
      }
      // how fast they really move (the walk cycle keeps pace with it); a jump is a teleport
      const moved = rec.px === undefined ? 0 : Math.hypot(c.x - rec.px, c.y - rec.py);
      const v = dt > 0 && moved < 1 ? moved / dt : 0;
      rec.speed = rec.speed === undefined ? v : rec.speed + (v - rec.speed) * (1 - Math.exp(-dt * 14));
      rec.px = c.x; rec.py = c.y;
      rec.fig.position.set(c.x, 0, c.y);
      // turn smoothly towards the wanted heading
      let d = (c.yaw || 0) - rec.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turn = d * (1 - Math.exp(-dt * 12));
      rec.yaw += turn;
      rec.fig.rotation.y = rec.yaw;
      // what they hold changed: they reached out to take it / put it down
      const holding = c.holding || [];
      const hsig = `${holding.join(',')}|${c.carry ? c.carry.n : 0}`;
      if (rec.hsig !== undefined && rec.hsig !== hsig) rec.reachT = 0;
      rec.hsig = hsig;
      if (rec.reachT !== undefined) rec.reachT += dt;
      const reach = rec.reachT !== undefined && rec.reachT < REACH_S ? Math.sin(Math.PI * rec.reachT / REACH_S) : 0;
      const vk = holding.find((k) => k[0] === 'v');
      const vkind = vk && view.D && view.D.vessels[vk.slice(2)] ? view.D.vessels[vk.slice(2)].kind : null;
      const hold = vk ? (GRIP3D[vkind] || !twoHanded(vkind) ? 'handle' : 'both') : holding.length ? 'items' : null;
      // a counter just in front: lift what's carried up over it
      const lift = holding.length && !c.work && this.lowFixtureAt(c.x + Math.sin(rec.yaw) * 0.42, c.y + Math.cos(rec.yaw) * 0.42) ? 1 : 0;
      poseCook(rec.fig, { speed: rec.speed, turn: dt > 0 ? turn / dt : 0, work: c.work, carry: !!c.carry || holding.length > 0, hold, reach, lift, scraps: !!c.carry, t: this.t + c.id * 1.7 }, dt);
      rec.fig.updateMatrixWorld(true);
      rec.hands = rec.fig.userData.carry.getWorldPosition(rec.hands || new THREE.Vector3());
      rec.rightHand = rec.fig.userData.hands[1].getWorldPosition(rec.rightHand || new THREE.Vector3());
      rec.holding = holding.length ? holding : null;
      rec.holdKind = vkind;
      rec.id = c.id;
      // first person: I don't see myself; otherwise, see-through while in front of what I'm looking at
      rec.fig.visible = !(c.me && this.firstPerson);
      fadeCook(rec.fig, this.blocksView(c, view) ? 0.28 : 1, dt);
    }
    for (const [id, rec] of this.cooks) if (!seen.has(id)) { this.scene.remove(rec.fig); disposeTree(rec.fig); this.cooks.delete(id); }
  }

  // A counter-high fixture (not a tall fridge / pantry / oven dome) on the floor square at x, z.
  lowFixtureAt(x, z) {
    const K = this.K;
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!K || tx < 0 || ty < 0 || tx >= K.w || ty >= K.h || !K.solid[ty][tx]) return null;
    const f = K.fixtures.find((q) => tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h);
    return f && !['fridge', 'shelf', 'pizzaOven', 'stoneOven', 'tandoor', 'plant'].includes(f.type) ? f : null;
  }
  // A carried thing never sinks into a counter: over one, it's at least at the worktop.
  aboveCounter(p, r = 0.08) {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (this.lowFixtureAt(p.x + dx, p.z + dz)) { if (p.y < COUNTER_H + 0.012) p.y = COUNTER_H + 0.012; break; }
    }
    return p;
  }

  // First person: my own arms. Each thing stays in the hand that took it (a
  // pot takes both); a new one is reached for where it lay, and one put down
  // is carried to where it goes and let go there.
  updateArms(view, dt) {
    const me = view.cooks.find((c) => c.me);
    const rec = me && this.cooks.get(me.id);
    const D = view.D;
    const on = this.firstPerson && !!rec && (!view.working || !!this.work);
    this.fpOn = on;
    this.fpMe = me && me.id;
    const holding = (rec && rec.holding) || [];
    const vk = (k) => (k && k[0] === 'v' && D && D.vessels[k.slice(2)] ? D.vessels[k.slice(2)].kind : null);
    const holdOf = (k) => { const kd = vk(k); return !kd ? 'palm' : twoHanded(kd) ? 'side' : GRIP3D[kd] ? 'handle' : 'palm'; };
    const slots = this.fpSlots, came = [], gone = [];
    for (let i = 0; i < 2; i++) if (slots[i] && !holding.includes(slots[i])) { gone.push([i, slots[i]]); slots[i] = null; }
    for (const k of holding) {
      if (slots.includes(k)) continue;
      const h = holdOf(k);
      this.fpHold.set(k, h);
      const want = this.fpWant.get(k);
      this.fpWant.delete(k);
      if (h === 'side') { slots[0] = slots[1] = k; came.push([0, k], [1, k]); } else { const i = want != null && slots[want] == null ? want : slots[1] == null ? 1 : 0; slots[i] = k; came.push([i, k]); }
    }
    if (!on) { this.fpArms.cancel(); this.fpArms.update(dt, [null, null], { visible: false }); return; }
    this.fpArms.setLook(lookOf(me.avatar));
    const right = new THREE.Vector3(-Math.cos(rec.yaw), 0, Math.sin(rec.yaw));
    // where a hand takes hold of a thing lying at base (yaw: how it lies)
    const gripAt = (k, i, base, yaw) => {
      const h = this.fpHold.get(k) || 'palm', vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      if (h === 'handle') {
        const g = GRIP3D[vk(k)], c = Math.cos(yaw), sn = Math.sin(yaw);
        const off = new THREE.Vector3(g.x * c + g.z * sn, g.y, -g.x * sn + g.z * c);
        return { world: base.clone().add(off), aimAt: off.clone().setY(0).negate().normalize() };
      }
      if (h === 'side') return { world: base.clone().add(right.clone().multiplyScalar((i ? 1 : -1) * ((vr ? vr.r : 0.13) + 0.035))).setY(base.y + (vr ? vr.h * 0.8 : 0.1)) };
      return { world: base.clone().setY(base.y + (vr ? vr.h * 0.5 : 0.04)) };
    };
    for (const [i, k] of came) {
      const g = this.glides.get(k);
      if (!g) continue;
      const vr = k[0] === 'v' ? this.vessels.get(k.slice(2)) : null;
      const yaw = vr ? vr.group.rotation.y : 0;
      this.fpArms.reach(i, { key: k, take: true, hold: this.fpHold.get(k), src: g.pos.clone(), srcYaw: yaw, ...gripAt(k, i, g.pos, yaw) });
    }
    for (const [i, k] of gone) {
      const dest = this.restPos(k, D);
      if (dest) this.fpArms.reach(i, { key: k, take: false, hold: this.fpHold.get(k), ...gripAt(k, i, dest, 0) });
    }
    // (a point in the world, for the hand on side s: in the right hand's camera space)
    const handAt = (w, s) => { const p = this.camera.worldToLocal(w.clone()); if (s < 0) p.x = -p.x; return p; };
    const holds = slots.map((k, i) => {
      if (!k) return null;
      const h = this.fpHold.get(k) || 'palm';
      // carried over to a shelf with the pointer
      if (view.fpGrab && view.fpGrab.key === k && h !== 'side') return { kind: h, at: handAt(view.fpGrab.w, i ? 1 : -1) };
      if (h !== 'side') return { kind: h };
      const vr = this.vessels.get(k.slice(2)), r = vr ? vr.r : 0.13;
      return { kind: 'side', at: new THREE.Vector3(r + 0.035, -0.17, -0.3 - r) };
    });
    // at work: what my hands are doing
    if (this.work && !this.work.idle) {
      this.work.hands.forEach((h, i) => {
        if (!h) return;
        // (a direction for the hand, in the right hand's camera space)
        let dir = null;
        if (h.dir) { dir = h.dir.clone().transformDirection(this.camera.matrixWorldInverse); if (!i) dir.x = -dir.x; }
        holds[i] = { kind: h.kind, at: handAt(h.w, i ? 1 : -1), curl: h.curl, tool: h.tool, dir };
      });
    }
    // a free hand on a door's handle
    if (view.fpGrab && !view.fpGrab.key) {
      const want = view.fpGrab.hand;
      const i = want >= 0 && holds[want] == null ? want : holds[1] == null ? 1 : holds[0] == null ? 0 : -1;
      if (i >= 0) holds[i] = { kind: 'grab', at: handAt(view.fpGrab.w, i ? 1 : -1) };
    }
    this.fpArms.update(dt, holds, { visible: true, walk: (rec.speed || 0) / 1.5, t: this.t });
  }

  // Where a thing in my hands goes, now it's been put down (roughly: the
  // place's spot for it) – null if it went nowhere to be seen.
  restPos(k, D) {
    const t = k[0] === 'v' ? D && D.vessels[k.slice(2)] : D && D.items[k.slice(2)];
    const fx = t && (k[0] === 'v' ? (t.at ? t.at.fx : t.held == null && t.home) : t.at);
    const F = fx && this.k3.fx[fx];
    if (!F || t.in) return null;
    const A = F.anchors;
    // put away: its spot on the shelf
    if (A.shelfL) {
      const n = A.shelfL.length, r = t.spot ? Math.min(n - 1, t.spot.r) : 1, u = t.spot ? 0.08 + t.spot.x * 0.84 : 0.5;
      return A.shelfL[n - 1 - r].clone().lerp(A.shelfR[n - 1 - r], u);
    }
    if (k[0] === 'v' && A.burners && (t.onHob || F.f.type === 'stove') && A.burners[t.at.slot]) return A.burners[t.at.slot];
    return A.board || A.basin || (A.spots && A.spots[0]) || A.top || A.mouth || null;
  }

  // where a thing in my hand i is drawn: {pos, yaw}
  fpAttach(k, i, me) {
    const A = this.fpArms, h = this.fpHold.get(k) || 'palm';
    if (h === 'side') {
      const a = A.palm(0), b = A.palm(1);
      const vr = this.vessels.get(k.slice(2));
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= vr ? vr.h * 0.8 : 0.1;
      return { pos: mid, yaw: Math.atan2(-(b.z - a.z), b.x - a.x) };
    }
    if (h === 'handle') {
      const g = GRIP3D[this.vessels.get(k.slice(2)) ? this.vessels.get(k.slice(2)).kind : 'pan'] || GRIP3D.pan;
      const d = A.handleDir(i);
      const th = Math.atan2(d.z, -d.x);
      const c = Math.cos(th), sn = Math.sin(th);
      return { pos: A.fist(i).sub(new THREE.Vector3(g.x * c + g.z * sn, g.y, -g.x * sn + g.z * c)), yaw: th };
    }
    return { pos: A.onPalm(i), yaw: me.yaw };
  }

  // ---------------------------------------------------------------- first person: work right there
  // There's no close-up in first person: the close-up's gestures (station.js,
  // run without drawing) happen on a plane standing on the work spot, facing
  // you – a point of the close-up (logical px; MAIN is the spot itself) is a
  // point on that plane, and back. Your hands, the tools, the food and the
  // pans are drawn there, in the kitchen.
  workFrame(fxId, kind, slot = 0, scale = WORK_S) {
    const F = this.k3.fx[fxId];
    if (!F) return null;
    const A = F.anchors;
    const pick = (...ks) => { for (const k of ks) { const a = A[k]; if (a) return Array.isArray(a) ? a[Math.min(slot, a.length - 1)] : a; } return null; };
    let O = kind === 'hob' ? pick('burners', 'top') : kind === 'sink' ? pick('basin', 'top') : ['oven', 'dome', 'tandoor'].includes(kind) ? pick('inside', 'mouth', 'top')
      : kind === 'chill' ? pick('shelf', 'top') : pick('board', 'top', 'mouth', 'basin', 'inside', 'shelf');
    if (!O) return null;
    // (the sink: under the tap's spout, at the worktop – the basin lies in front of it, towards me)
    if (kind === 'sink') O = (A.spout || O).clone().setY(COUNTER_H);
    // facing the side it's worked from (a bin, a table, an island stands free: maybe from the side)
    const f = F.f, sd = f.stand;
    let N = F.front.clone();
    if (sd) {
      const dx = sd.x + 0.5 - (f.x + f.w / 2), dz = sd.y + 0.5 - (f.y + f.h / 2);
      if (Math.abs(dx) > 1e-3 || Math.abs(dz) > 1e-3) N = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz));
    }
    return { fx: fxId, kind, slot, O: O.clone(), N, R: new THREE.Vector3().crossVectors(N.clone().negate(), UP).normalize(), U: UP.clone(), S: scale };
  }
  // (The close-up looks down at the worktop: above the work spot its points
  // stand up into the air, below it they lie on the worktop, towards you – the
  // plane folds at the spot, so nothing put down beside it sinks into the counter.)
  workWorld(w, x, y) {
    const p = w.O.clone().addScaledVector(w.R, (x - MAIN.x) * w.S);
    return y <= MAIN.y ? p.addScaledVector(w.U, (MAIN.y - y) * w.S) : p.addScaledVector(w.N, (y - MAIN.y) * w.S);
  }
  // a point of the kitchen as a close-up point (on the plane, or on the worktop in front of it)
  workPoint(w, P) {
    const d = P.clone().sub(w.O);
    const x = MAIN.x + d.dot(w.R) / w.S, up = d.dot(w.U);
    return up > 0.001 ? { x, y: MAIN.y - up / w.S } : { x, y: MAIN.y + d.dot(w.N) / w.S };
  }
  // the close-up point under this point of the screen
  workAt(w, cx, cy) {
    const ray = this.rayAt(cx, cy);
    const den = ray.direction.dot(w.N);
    if (Math.abs(den) > 1e-4) {
      const t = w.O.clone().sub(ray.origin).dot(w.N) / den;
      if (t > 0) {
        const P = ray.at(t, new THREE.Vector3()).sub(w.O);
        if (P.dot(w.U) >= 0) return { x: MAIN.x + P.dot(w.R) / w.S, y: MAIN.y - P.dot(w.U) / w.S };
      }
    }
    // below the spot: on the worktop, towards me
    if (ray.direction.y < -1e-4) {
      const t = (w.O.y - ray.origin.y) / ray.direction.y;
      const Q = ray.at(t, new THREE.Vector3()).sub(w.O);
      if (t > 0 && Q.dot(w.N) >= 0) return { x: MAIN.x + Q.dot(w.R) / w.S, y: MAIN.y + Q.dot(w.N) / w.S };
    }
    return null;
  }
  // The real thing a gesture takes hold of, where the close-up has it somewhere
  // else (the knob for this burner on the stove's front, the tap's lever): its
  // world point and the close-up point – the pointer is shifted from one to the
  // other on the screen, so you take the real one.
  workReal(w, st) {
    const g = st && st.g;
    const F = g && this.k3.fx[w.fx];
    if (!F) return null;
    if (g.kind === 'knob' && F.parts.knobs && F.parts.knobs.length) {
      const kn = F.parts.knobs[Math.min(w.slot || 0, F.parts.knobs.length - 1)];
      return { w: kn.getWorldPosition(new THREE.Vector3()).addScaledVector(w.N, 0.02), at: st.knobPos() };
    }
    if ((g.kind === 'tap' && g.ph.hot === 'faucet') && F.parts.lever) {
      return { w: F.parts.lever.localToWorld(new THREE.Vector3(0.1, 0.03, 0)), at: st.hotspot() };
    }
    return null;
  }
  // the screen shift (px) from the real thing to where the close-up has it
  workOffset(w, st) {
    const r = this.workReal(w, st);
    if (!r) return { x: 0, y: 0 };
    const a = this.screenOf(this.workWorld(w, r.at.x, r.at.y)), b = this.screenOf(r.w);
    return { x: a.x - b.x, y: a.y - b.y };
  }

  // the mouth of the pan I'm working at, in close-up px (what the close-up's drawing would have set)
  workGeo(w, vesselId) {
    const rec = vesselId && this.vessels.get(vesselId);
    if (!rec || !rec.group.visible) return null;
    const p = rec.group.position.clone().sub(w.O);
    const x = MAIN.x + p.dot(w.R) / w.S, base = MAIN.y - p.dot(w.U) / w.S, r = rec.r / w.S;
    return { mouthX: x, mouthY: base - rec.h / w.S, mouthRx: r, mouthRy: r * 0.35, bottomY: base, top: base - rec.h / w.S };
  }

  // What my hands do at work this frame, and where the things they move are
  // (from the close-up's state): this.work = {hands, ov, sprites, rings, stream, knob}.
  workScene(view) {
    this.work = null;
    const W = view.work;
    if (!W || !W.st || !W.st.on || !this.firstPerson || !W.frame) return;
    const st = W.st, g = st.g, w = W.frame;
    if (!g || st.done) { this.work = { hands: [null, null], ov: new Map(), sprites: [], rings: [], stream: null, knob: null, idle: true }; return; }
    const at = (p) => this.workWorld(w, p.x, p.y);
    const D = view.D, ph = g.ph, p = st.ptr;
    const out = { hands: [null, null], ov: new Map(), sprites: [], rings: [], stream: null, knob: null, O: w.O, yaw: Math.atan2(w.N.x, w.N.z), real: !!this.workReal(w, st) };
    // the food worked on stands right on the work spot (under the tap, on the board), as big as the gesture has it
    if (g.subject && g.subject.type === 'item' && D && D.items[g.subject.id] && !['drag', 'dip'].includes(g.kind)) {
      const b = st.subjectBox();
      out.ov.set(`i:${g.subject.id}`, { pos: this.firstPerson ? at({ x: b.cx, y: b.y1 }) : at({ x: b.cx, y: b.y1 }).addScaledVector(UP, -0.1 * b.h * w.S), size: Math.max(0.12, Math.min(0.32, Math.max(b.w, b.h) * w.S * 1.15)) });
      // washing: the tap runs on it
      const F = this.k3.fx[w.fx];
      if (w.kind === 'sink' && g.kind === 'strokes' && F && F.anchors.spout) out.stream = { from: F.anchors.spout.clone(), to: at({ x: b.cx, y: b.y0 }), color: '#cfe8f8' };
    }
    // the tool, as the close-up has it
    let tool = ph.tool || { chop: 'knife', peel: 'peeler', circle: 'spoon', paint: 'spoon' }[g.kind] || 'hand';
    if (['drag', 'scoop', 'dip', 'crack', 'knob', 'tap', 'pour', 'fill', 'place', 'flick', 'door'].includes(g.kind) || (g.kind === 'wrap' && g.stage === 0)) {
      if (!['tongs', 'ladle', 'spoon', 'pizzaPeel', 'spatula'].includes(tool)) tool = 'hand';
    }
    if (tool === 'grab') tool = 'hand';
    // (the hand already holding what's carried does it; else the free one)
    const srcKey = g.source && g.source.id ? `${g.source.type === 'vessel' ? 'v' : 'i'}:${g.source.id}` : null;
    const held = srcKey ? this.fpSlots.indexOf(srcKey) : -1;
    // (Q – the left hand – doing it, if it's free)
    const wi = held >= 0 ? (this.fpSlots[1] === srcKey ? 1 : held) : (this.fpSlots[1] || p.id === 'kq') && this.fpSlots[0] == null ? 0 : 1, oi = 1 - wi;
    const pt = p.seen ? { x: p.x, y: p.y } : { x: MAIN.x + 60, y: MAIN.y - 120 };
    const len = TOOL_LEN[tool] || 0;
    const hand = (i, pos, kind, extra = {}) => { out.hands[i] = { w: pos, kind, ...extra }; };
    // a tool's working end where I point: the knife's edge (the blade forward over the food), a spoon's bowl …
    const into = w.N.clone().negate();
    const toolHand = (pos) => {
      if (tool === 'hand') return hand(wi, pos.clone().addScaledVector(UP, 0.02), 'hand', { curl: p.down ? 0.8 : 0.3 });
      if (tool === 'knife') {
        const blade = into.clone().addScaledVector(w.R, -0.5).addScaledVector(UP, -0.1).normalize();
        const grip = pos.clone().addScaledVector(blade, -0.065).addScaledVector(UP, 0.024);
        out.tool = { kind: 'knife', grip, dir: blade, hand: wi };
        return hand(wi, grip, 'knife', { dir: blade });
      }
      const grip = pos.clone().addScaledVector(UP, len).addScaledVector(w.N, len * 0.25);
      out.tool = { kind: tool, grip, dir: grip.clone().sub(pos).normalize(), hand: wi };
      return hand(wi, grip, 'tool');
    };
    const vKey = (q) => (q && q.type === 'vessel' && q.id ? `v:${q.id}` : q && q.type === 'item' && q.id ? `i:${q.id}` : null);
    const ring = (q, r = 60) => { if (q) out.rings.push({ w: at(q), r: (q.r || r) * w.S }); };
    switch (g.kind) {
      case 'drag': {
        const k = vKey(g.source);
        const pos = at(g.pos);
        if (k) out.ov.set(k, { pos: this.firstPerson ? pos.clone() : k[0] === 'v' ? pos.clone().addScaledVector(UP, -0.03) : pos.clone().addScaledVector(UP, -0.05), size: 0.22, yaw: Math.atan2(w.N.x, w.N.z) });
        hand(wi, at(st.grabPoint()), g.grip ? 'grab' : 'hand', { curl: g.drag ? 0.85 : 0.35 });
        if (!g.drag) ring(g.pos, 50);
        ring(g.target);
        break;
      }
      case 'dip': {
        const k = vKey(g.source);
        if (k) out.ov.set(k, { pos: at(g.pos).addScaledVector(UP, -0.04), size: 0.2 });
        toolHand(at(g.pos));
        if (!g.drag) ring(g.pos, 50);
        ring({ x: MAIN.x, y: MAIN.y - 80, r: 100 });
        break;
      }
      case 'crack': {
        const tex = this.spriteFor('egg', { qty: 1 });
        if (g.stage === 0) {
          out.sprites.push({ tex, kind: 'egg', st: { qty: 1 }, pos: at(g.egg).addScaledVector(UP, -0.03), size: 0.12 });
          hand(wi, at(g.egg).addScaledVector(UP, 0.02), 'hand', { curl: 0.7 });
          ring(st.rimPoint(), 40);
        } else {
          const sp = (g.spread || 0) * 0.5;
          out.sprites.push({ tex, kind: 'egg', st: { qty: 1 }, pos: at({ x: g.egg.x - sp, y: g.egg.y }).addScaledVector(UP, -0.03), size: 0.11 });
          hand(wi, at({ x: g.egg.x + 30 + sp, y: g.egg.y }), 'hand', { curl: 0.8 });
          hand(oi, at({ x: g.egg.x - 30 - sp, y: g.egg.y }), 'hand', { curl: 0.8 });
        }
        break;
      }
      case 'pour': case 'fill': {
        if (g.kind === 'pour') {
          // the jug / pan / bag in my hand, tipped over the pot
          // (held on my right – a pan by its handle, the handle away from the pour – tipped left into the pot)
          const k = vKey(g.source);
          const lip = at({ x: MAIN.x + 80, y: MAIN.y - 165 });
          const tilt = g.pouring ? 1.15 : 0.25;
          const pos = lip.clone().addScaledVector(w.R, 0.06).addScaledVector(UP, -0.08);
          const yaw = Math.atan2(w.N.x, w.N.z);
          if (k) out.ov.set(k, { pos, size: 0.2, yaw, tilt, axis: w.N });
          const vr = k && k[0] === 'v' && this.vessels.get(k.slice(2));
          const grip = vr && GRIP3D[vr.kind];
          if (grip) {
            const q = new THREE.Quaternion().setFromAxisAngle(w.N, tilt).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
            // (the fist along the handle, toward the pan)
            hand(wi, pos.clone().add(grip.clone().applyQuaternion(q)), 'handle', { curl: 1, dir: new THREE.Vector3(-1, 0, 0).applyQuaternion(q) });
          } else hand(wi, pos.clone().addScaledVector(w.R, 0.08).addScaledVector(UP, 0.04), 'grab', { curl: 0.9 });
          if (g.pouring) out.stream = { from: lip.clone().addScaledVector(w.R, -0.03), to: at({ x: MAIN.x, y: MAIN.y - 60 }), color: (st.pourColor && st.pourColor()) || '#c8e4f4' };
        } else {
          // the tap: my hand on its lever, the water running while I hold it
          const F = this.k3.fx[w.fx];
          const lever = F && F.parts.lever ? F.parts.lever.getWorldPosition(new THREE.Vector3()).addScaledVector(w.R, 0.08) : at({ x: 580, y: 200 });
          hand(wi, lever, 'hand', { curl: g.pouring ? 0.8 : 0.35 });
          // (into the pan in the basin)
          const vr = g.subject && g.subject.type === 'vessel' && this.vessels.get(g.subject.id);
          const into = vr && vr.group.visible ? vr.group.position.clone().addScaledVector(UP, vr.h * 0.7) : (F && F.anchors.basin ? F.anchors.basin.clone() : w.O.clone());
          if (g.pouring && F && F.anchors.spout) out.stream = { from: F.anchors.spout.clone(), to: into, color: '#cfe8f8' };
        }
        break;
      }
      case 'knob': {
        // the real knob on the stove's front (or the oven's panel)
        const F = this.k3.fx[w.fx];
        const kn = F && F.parts.knobs && F.parts.knobs[Math.min(w.slot || 0, F.parts.knobs.length - 1)];
        const kp = kn ? kn.getWorldPosition(new THREE.Vector3()) : at(st.knobPos());
        hand(wi, kp.clone().addScaledVector(w.N, 0.05), 'hand', { curl: g.turning ? 0.85 : 0.4 });
        out.knob = { fx: w.fx, slot: w.slot || 0, level: (g.ang + 2.4) / 4.8 * 3 };
        if (!g.turning) out.rings.push({ w: kp.clone().addScaledVector(w.N, 0.03), r: 0.045 });
        break;
      }
      case 'tap': {
        // the tap's lever (or the bell, the bin's pedal …): the hand on the real one
        const real = this.workReal(w, st);
        const h = st.hotspot();
        if (real) {
          const off = this.workOffset(w, st), s0 = this.screenOf(at(pt));
          const r2 = this.rayAt(s0.x - off.x, s0.y - off.y);
          hand(wi, r2.at(real.w.distanceTo(this.camera.position), new THREE.Vector3()), 'hand', { curl: p.down ? 0.8 : 0.3 });
          out.rings.push({ w: real.w, r: 0.04 });
        } else {
          toolHand(at(pt));
          if (h) ring(h);
        }
        break;
      }
      case 'door': {
        hand(wi, at(st.doorGrab(g.geo, g.v)), 'grab', { curl: g.drag ? 0.9 : 0.4 });
        if (!g.drag) ring({ ...st.doorGrab(g.geo, g.v), r: 45 });
        break;
      }
      case 'scoop': {
        toolHand(at(g.drag && g.pos ? g.pos : pt));
        if (g.drag && g.pos) out.sprites.push({ tex: this.blobTex(st.scoopColor()), kind: { type: 'blob', c1: st.scoopColor() }, st: {}, pos: at(g.pos).addScaledVector(UP, -0.02), size: 0.06 });
        else ring(st.scoopSource(), 60);
        for (const q of st.scoopTargets()) ring(q, 45);
        break;
      }
      case 'place': {
        toolHand(at(pt));
        if (ph.piece) out.sprites.push({ tex: this.spriteFor(ph.piece, null, 'slice'), kind: ph.piece, st: { cut: 'slice', k: 1, n: 1 }, pos: at(pt).addScaledVector(UP, -0.03), size: 0.08 });
        break;
      }
      default: {
        // knife, peeler, grater, spoon, whisk, brush … – and the other hand on the food
        toolHand(at(pt));
        const s2 = st.steadies && st.steadies() && st.steadyAt();
        if (s2) hand(oi, at(s2).addScaledVector(UP, 0.01), 'claw');
        // the pan jumps when you toss it
        if (g.kind === 'flick' && g.toss) {
          const k = vKey(g.subject);
          const rec = k && k[0] === 'v' && this.vessels.get(k.slice(2));
          if (rec) out.ov.set(k, { pos: rec.group.position.clone().setY(w.O.y + Math.sin(Math.min(1, g.toss) * Math.PI) * 0.12), yaw: rec.group.rotation.y });
        }
        break;
      }
    }
    // a second finger on a touch screen is my other hand
    if (st.ptr2 && !out.hands[oi]) hand(oi, at(st.ptr2), 'hand', { curl: 0.7 });
    this.work = out;
  }

  // a little round spoonful (scooping)
  blobTex(color) {
    const key = `blob|${color}`;
    let tex = this.texCache && this.texCache.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = color; x.strokeStyle = '#3a2a24'; x.lineWidth = 4;
    x.beginPath(); x.ellipse(32, 40, 24, 16, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    (this.texCache || (this.texCache = new Map())).set(key, tex);
    return tex;
  }

  // the rings showing where to put things / take hold, and the water / a pour running
  updateWorkFx(dt) {
    const W = this.work;
    if (!this.workFx) {
      this.workFx = { rings: [], stream: null };
      const sm = new THREE.MeshBasicMaterial({ color: '#cfe8f8', transparent: true, opacity: 0.75, depthWrite: false });
      this.workFx.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1, 10, 1, true), sm);
      this.workFx.stream.visible = false;
      this.scene.add(this.workFx.stream);
    }
    const fx = this.workFx;
    const rings = (W && W.rings) || [];
    while (fx.rings.length < rings.length) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 10;
      this.scene.add(m);
      fx.rings.push(m);
    }
    fx.rings.forEach((m, i) => {
      const r = rings[i];
      m.visible = !!r;
      if (!r) return;
      m.position.copy(r.w);
      m.lookAt(this.camera.position);
      m.scale.setScalar(Math.max(0.02, r.r) * (1 + Math.sin(this.t * 6) * 0.06));
    });
    // the tool in my hand (first person at work)
    const T = W && W.tool;
    if (!T || !this.firstPerson) { if (fx.tool) fx.tool.visible = false; } else {
      if (!fx.tool || fx.toolKind !== T.kind) {
        if (fx.tool) this.scene.remove(fx.tool);
        fx.tool = T.kind === 'knife' ? fpKnife() : toolMesh(T.kind);
        fx.toolKind = T.kind;
        fx.tool.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
        this.scene.add(fx.tool);
      }
      fx.tool.visible = true;
      // (in the fist itself – where the hand got to)
      fx.tool.position.copy(this.fpArms.group.visible ? this.fpArms.fist(T.hand) : T.grip);
      if (T.kind === 'knife') {
        // blade along x, its edge down
        const xA = T.dir.clone().normalize(), zA = new THREE.Vector3().crossVectors(xA, UP).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
        fx.tool.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
      } else fx.tool.quaternion.setFromUnitVectors(UP, T.dir); // (hanging from the fist, leaning toward me)
    }
    const S = W && W.stream;
    fx.stream.visible = !!S;
    if (S) {
      const len = S.from.distanceTo(S.to);
      fx.stream.position.copy(S.from).lerp(S.to, 0.5);
      fx.stream.quaternion.setFromUnitVectors(UP, S.from.clone().sub(S.to).normalize());
      fx.stream.scale.set(0.012, len, 0.012);
      fx.stream.material.color.set(S.color);
      if (Math.random() < dt * 20) this.puff(S.to.clone(), 'drop');
    }
  }

  // Is this cook standing between the camera and what I'm facing (or what's on it)?
  blocksView(c, view) {
    if (this.firstPerson || !view.target) return false;
    const F = this.k3.fx[view.target];
    if (!F) return false;
    const A = F.anchors;
    const pts = [A.board, A.basin, A.top, ...(A.spots || [])].filter(Boolean);
    if (!pts.length) pts.push(new THREE.Vector3(F.f.x + F.f.w / 2, topHeight(F.f), F.f.y + F.f.h / 2));
    const cam = this.camera.position;
    const near = cam.distanceTo(new THREE.Vector3(c.x, 0.4, c.y));
    const feet = this.project(c.x, 0, c.y), head = this.project(c.x, 1.15, c.y); // (with the hat)
    const half = Math.abs(feet.y - head.y) * 0.4;
    return pts.some((tp) => {
      if (cam.distanceTo(tp) <= near) return false;
      const t = this.project(tp.x, tp.y, tp.z);
      return t.x > feet.x - half && t.x < feet.x + half && t.y > head.y - 8 && t.y < feet.y + 8;
    });
  }

  // ------------------------------------------------------------------ highlights

  buildMarker() {
    const g = new THREE.Group();
    const glow = mat('#ffbe28', { emissive: '#ffb020', ei: 1.4, rough: 0.4 });
    const arrow = cyl(0.0, 0.07, 0.12, glow, 0, 0, 0, 12);
    arrow.rotation.x = Math.PI;
    arrow.position.y = 0.12;
    g.add(arrow);
    g.add(ring(0.42, 0.014, mat('#ffd060', { emissive: '#ffc040', ei: 1.2, opacity: 0.85 }), 0, -0.7, 0, 32));
    g.visible = false;
    return g;
  }

  updateMarker(view) {
    const m = this.marker;
    // (first person: no marker over what I face – the dot in the middle is enough)
    const F = !this.firstPerson && view.target && this.k3.fx[view.target];
    if (F) {
      const f = F.f;
      const h = topHeight(f);
      m.visible = true;
      m.position.set(f.x + f.w / 2, h + 0.35 + Math.sin(this.t * 5) * 0.04, f.y + f.h / 2);
      m.children[1].position.y = -(h + 0.35) + 0.01;
      m.children[1].scale.setScalar(Math.max(f.w, f.h) * 0.9);
    } else m.visible = false;
    this.updateGlow(view);
  }

  // What's next glows a little: the equipment (the fridge, the sink, the
  // stove …) and the things (the pan on the shelf, the eggs in the fridge) –
  // their own surfaces lit along the rims, breathing. view.guide: fixture ids
  // and thing keys ('v:pan', 'i:egg').
  updateGlow(view) {
    const want = view.guide || new Set();
    GLOW_MAT.uniforms.uK.value = GLOW_THING.uniforms.uK.value = 0.6 + 0.4 * Math.sin(this.t * 2.6);
    const on = new Set(), things = new Set();
    for (const key of want) {
      const F = this.k3.fx[key];
      if (F) {
        const g = this.fixtureGhost(key, F);
        if (g) on.add(g);
        for (const o of F.live || []) on.add(o);
        continue;
      }
      // things in 3D (the room view's cartoon food is a standee: its place glows instead)
      const obj = key[0] === 'v' ? this.vessels.get(key.slice(2))?.group : this.firstPerson ? this.foods.get(`item:${key.slice(2)}`)?.g : null;
      if (obj && obj.visible) { on.add(obj); things.add(obj); }
    }
    for (const o of this.glowing || []) if (!on.has(o)) setGhost(o, false);
    for (const o of on) setGhost(o, true, things.has(o) ? GLOW_THING : GLOW_MAT);
    this.glowing = on;
  }
  // a fixture's static meshes (baked in with the room) as one rim-lit copy, made the first time it glows
  fixtureGhost(id, F) {
    this.ghosts = this.ghosts || new Map();
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    let ghost = null;
    if (F.src) {
      const geos = [];
      F.src.updateMatrixWorld(true);
      F.src.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.userData.glow) return;
        const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal') geo.deleteAttribute(n);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        geo.clearGroups();
        geo.applyMatrix4(o.matrixWorld);
        geos.push(geo);
      });
      const merged = geos.length ? mergeGeometries(geos, false) : null;
      for (const g of geos) g.dispose();
      if (merged) {
        ghost = new THREE.Mesh(merged, GLOW_MAT);
        ghost.userData.glow = true;
        ghost.renderOrder = 4;
        ghost.raycast = () => {};
        ghost.visible = false;
        this.guides.add(ghost);
      }
    }
    this.ghosts.set(id, ghost);
    return ghost;
  }

  // first person: where my hand touches a fixture (where I look, on its top, in reach) – or the air before me
  touchPoint(fid) {
    const F = fid && this.k3.fx[fid];
    const c = this.viewCenter();
    const ray = this.rayAt(c.x, c.y);
    if (!F) return ray.at(0.45, new THREE.Vector3());
    const f = F.f, top = topHeight(f);
    let p = null;
    if (top < this.camera.position.y - 0.1 && ray.direction.y < -0.05) {
      const t = (top - ray.origin.y) / ray.direction.y;
      if (t > 0 && t < 1.6) p = ray.at(t, new THREE.Vector3());
    }
    if (!p) return ray.at(0.5, new THREE.Vector3()); // (a tall thing: its front, where I look)
    p.x = Math.max(f.x + 0.06, Math.min(f.x + f.w - 0.06, p.x));
    p.z = Math.max(f.y + 0.06, Math.min(f.y + f.h - 0.06, p.z));
    p.y = top + 0.015;
    return p;
  }

  // ------------------------------------------------------------------ lights

  updateLights(view) {
    const D = view.D;
    const cands = [];
    for (const g of this.staticGlows) cands.push({ pos: g.pos, color: g.color, power: g.power, reach: g.reach, kind: g.kind, prio: g.kind === 'fire' ? 3 : g.kind === 'window' ? 2.5 : 2 });
    if (D) {
      for (const v of Object.values(D.vessels)) {
        if (!v.at || !v.heat) continue;
        const F = this.k3.fx[v.at.fx];
        if (!F) continue;
        const hob = F.anchors.burners && F.anchors.burners[v.at.slot] && (v.onHob || F.f.type === 'stove' || F.f.type === 'paellaBurner');
        const p = hob ? F.anchors.burners[v.at.slot] : F.anchors.inside || F.anchors.mouth || F.anchors.top;
        if (!p) continue;
        cands.push({ pos: p.clone().setY(p.y + (hob ? 0.05 : 0.15)), color: hob ? '#6a9aff' : '#ff8a3a', power: hob ? 0.35 + v.heat * 0.12 : 1.4, reach: hob ? 1 : 1.8, prio: hob ? 1 : 2.2, flicker: true });
      }
    }
    // the most important first; nearest to the camera's focus breaks ties
    const focus = this.camTarget;
    cands.sort((a, b) => (b.prio - a.prio) || (a.pos.distanceTo(focus) - b.pos.distanceTo(focus)));
    this.lamps.forEach((l, i) => {
      const c = cands[i];
      if (!c) { l.intensity = 0; l.position.set(0, -10, 0); return; }
      l.position.copy(c.pos);
      l.color.set(c.color);
      l.distance = c.reach;
      l.intensity = c.power * (c.kind === 'fire' || c.flicker ? 0.85 + Math.sin(this.t * 13 + i) * 0.1 + Math.sin(this.t * 31 + i) * 0.05 : 1);
    });
  }

  // ------------------------------------------------------------------ steam, drops, sparks, flies

  buildSteam() {
    const n = 300;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const matl = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; varying float vA;
        uniform float uScale;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = color; vA = size > 0.0 ? 1.0 : 0.0;
          gl_PointSize = abs(size) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a * 0.75); }`,
      transparent: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, matl);
    points.frustumCulled = false;
    return { points, n, list: [] };
  }

  puff(p, kind) {
    const S = this.steam;
    if (S.list.length >= S.n) return;
    const r = Math.random;
    const e = { x: p.x + (r() - 0.5) * 0.08, y: p.y, z: p.z + (r() - 0.5) * 0.08, vx: (r() - 0.5) * 0.05, vy: 0.25 + r() * 0.2, vz: (r() - 0.5) * 0.05, life: 0, max: 1.6 + r(), kind };
    if (kind === 'drop') { e.vy = -0.6; e.max = 0.35; }
    if (kind === 'sizzle') { e.vy = 0.5 + r() * 0.5; e.vx *= 6; e.vz *= 6; e.max = 0.35; }
    if (kind === 'fly') { e.max = 2; e.vy = 0.05; e.y += 0.15; }
    S.list.push(e);
  }

  updateSteam(dt) {
    const S = this.steam;
    const pos = S.points.geometry.attributes.position.array, col = S.points.geometry.attributes.color.array, size = S.points.geometry.attributes.size.array;
    S.list = S.list.filter((e) => (e.life += dt) < e.max);
    S.points.material.uniforms.uScale.value = this.canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (let i = 0; i < S.n; i++) {
      const e = S.list[i];
      if (!e) { size[i] = 0; continue; }
      const k = e.life / e.max;
      if (e.kind === 'fly') { e.x += Math.cos(this.t * 7 + i) * dt * 0.3; e.z += Math.sin(this.t * 6 + i) * dt * 0.3; }
      else { e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; }
      if (e.kind === 'sizzle' || e.kind === 'drop') e.vy -= 3 * dt;
      pos[i * 3] = e.x; pos[i * 3 + 1] = e.y; pos[i * 3 + 2] = e.z;
      const c = e.kind === 'steam' ? [1, 1, 1] : e.kind === 'drop' ? [0.6, 0.82, 0.98] : e.kind === 'fly' ? [0.1, 0.1, 0.12] : [1, 0.9, 0.5];
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      size[i] = e.kind === 'steam' ? 0.05 + k * 0.1 : e.kind === 'fly' ? 0.012 : 0.012;
      if (e.kind === 'steam' && k > 0.8) size[i] *= (1 - k) * 5;
    }
    S.points.geometry.attributes.position.needsUpdate = true;
    S.points.geometry.attributes.color.needsUpdate = true;
    S.points.geometry.attributes.size.needsUpdate = true;
  }
}

// ======================================================================= helpers

// The glow: a thing's own surfaces again, lit along the rims (where they turn
// away from me) with a faint wash on what faces me, added over it.
// (equipment gently – big surfaces; a thing to fetch a little brighter, so it stands out on its shelf)
const glowMat = (rim, wash) => new THREE.ShaderMaterial({
  uniforms: { uK: { value: 1 }, uColor: { value: new THREE.Color('#ffc23a') } },
  vertexShader: `varying vec3 vN; varying vec3 vV;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uK; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); gl_FragColor = vec4(uColor, (pow(f, 2.5) * ${rim.toFixed(2)} + ${wash.toFixed(2)}) * uK); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
});
const GLOW_MAT = glowMat(0.5, 0.06), GLOW_THING = glowMat(0.85, 0.14);
// lit or not: a mesh's glowing copy rides along as its child (doors, knobs, a pan all move)
function setGhost(o, on, mat = GLOW_MAT) {
  if (o.userData.glow) { o.visible = on; return; }
  o.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.userData.glow) return;
    let g = m.userData.ghost;
    if (!g) {
      if (!on) return;
      g = new THREE.Mesh(m.geometry, mat);
      g.userData.glow = true;
      g.renderOrder = 4;
      g.raycast = () => {};
      m.userData.ghost = g;
      m.add(g);
    }
    g.visible = on;
  });
}

export function topHeight(f) {
  switch (f.type) {
    case 'fridge': return 1.2;
    case 'shelf': return 1.3;
    case 'pizzaOven': case 'stoneOven': return 1.15;
    case 'tandoor': return 0.66;
    case 'binL': return 0.75;
    case 'binM': return 0.58;
    case 'binS': return 0.4;
    case 'plant': return 0.7;
    case 'table': return 0.42;
    case 'aga': return 0.66;
    case 'piano': return 0.6;
    default: return COUNTER_H;
  }
}

function vesselAtSlot(D, fx, slot, type) {
  for (const v of Object.values(D.vessels)) if (v.at && v.at.fx === fx && v.at.slot === slot && (v.onHob || type === 'stove' || type === 'paellaBurner' || type === 'aga' || type === 'piano')) return v;
  return null;
}

function disposeTree(o) {
  o.traverse((c) => { if (c.isMesh && c.geometry) c.geometry.dispose(); });
}

// ------------------------------------------------------------------ vessel models

const VCOL = { pot: '#c9ccd2', bigPot: '#c9ccd2', copperPot: '#d0804a', cocotte: '#c0412d', saucepan: '#c9ccd2', pan: '#3a3a42', paellaPan: '#4a4a52' };

// First person's knife: a slim blade forward from the grip (x), its edge down,
// a dark wooden handle back from it.
function fpKnife() {
  const g = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(0.012, -0.022); sh.lineTo(0.1, -0.02); sh.quadraticCurveTo(0.13, -0.016, 0.135, 0.004); sh.lineTo(0.012, 0.006); sh.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.0018, bevelEnabled: false }), mat('#d8dde2', { metal: 0.85, rough: 0.22 }));
  blade.position.z = -0.0009;
  g.add(blade);
  g.add(box(0.008, 0.02, 0.012, mat('#9aa0a6', { metal: 0.8, rough: 0.3 }), 0.009, -0.01, 0)); // (the bolster)
  const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.0075, 0.05, 4, 10), mat('#5a3a24', { rough: 0.5 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.025, -0.006, 0);
  g.add(handle);
  return g;
}

function buildVessel(kind) {
  const g = new THREE.Group();
  const rec = { kind, group: g, h: 0.1, r: 0.12, liquid: null, lid: null, bits: [], bubbles: [] };
  const metal = (c) => mat(c, { metal: c === '#c9ccd2' ? 0.85 : 0.5, rough: c === '#c9ccd2' ? 0.28 : 0.4 });
  const potLike = (r, h, c, handles = 2, long = false) => {
    rec.r = r; rec.h = h;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, h, 24, 1, true), metal(c));
    body.position.y = h / 2;
    body.material.side = THREE.DoubleSide;
    g.add(body);
    g.add(cyl(r * 0.95, r * 0.95, 0.006, metal(c), 0, 0, 0, 24));
    g.add(ring(r, 0.008, metal(c), 0, h, 0, 24));
    if (handles === 2) for (const sx of [-1, 1]) { const hd = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 10, Math.PI), metal(c)); hd.position.set(sx * (r + 0.01), h * 0.8, 0); hd.rotation.set(0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 0); g.add(hd); }
    if (long) g.add(rod(v3(r, h * 0.85, 0), v3(r + 0.18, h * 0.95, 0.04), 0.012, mat('#2a2a30', { rough: 0.5 })));
  };
  switch (kind) {
    case 'pot': potLike(0.13, 0.15, VCOL.pot); break;
    case 'bigPot': potLike(0.16, 0.2, VCOL.bigPot); break;
    case 'copperPot': potLike(0.13, 0.15, VCOL.copperPot); break;
    case 'cocotte': potLike(0.15, 0.14, VCOL.cocotte); break;
    case 'saucepan': potLike(0.11, 0.1, VCOL.saucepan, 0, true); break;
    case 'pan': potLike(0.15, 0.04, VCOL.pan, 0, true); break;
    case 'paellaPan': potLike(0.3, 0.04, VCOL.paellaPan, 2); break;
    case 'bowl': rec.r = 0.13; rec.h = 0.08; g.add(lathe([[0, 0], [0.06, 0.005], [0.12, 0.05], [0.13, 0.08]], mat('#f2efe6', { rough: 0.35, double: true }), 0, 0, 0, 20)); g.add(ring(0.128, 0.006, mat('#5aa0c8'), 0, 0.075, 0, 20)); break;
    case 'colander': rec.r = 0.13; rec.h = 0.08; g.add(lathe([[0, 0], [0.08, 0.01], [0.13, 0.08]], M.steel(), 0, 0, 0, 20)); break;
    case 'tray': case 'peel': rec.r = 0.2; rec.h = 0.02; g.add(box(0.4, 0.02, 0.3, M.steelDark(), 0, 0, 0)); break;
    case 'bakingDish': rec.r = 0.18; rec.h = 0.06; g.add(box(0.36, 0.06, 0.24, mat('#f2efe6', { rough: 0.3 }), 0, 0, 0)); g.add(box(0.32, 0.005, 0.2, mat('#d8603a'), 0, 0.058, 0)); break;
    case 'plate': rec.r = 0.13; rec.h = 0.015; g.add(cyl(0.13, 0.1, 0.015, mat('#ffffff', { rough: 0.3 }), 0, 0, 0, 24)); g.add(ring(0.11, 0.004, mat('#5aa0c8'), 0, 0.016, 0, 24)); break;
    case 'glass': rec.r = 0.035; rec.h = 0.1; g.add(lathe([[0, 0], [0.03, 0.005], [0.022, 0.05], [0.036, 0.1]], mat('#f4f8fa', { rough: 0.05, opacity: 0.5, double: true }), 0, 0, 0, 14)); break;
    case 'cup': rec.r = 0.045; rec.h = 0.06; potLike(0.045, 0.06, '#ffffff', 0); break;
    case 'cezve': rec.r = 0.05; rec.h = 0.09; potLike(0.05, 0.09, '#d0804a', 0, true); break;
    case 'kettle': case 'caydanlik': {
      rec.r = 0.1; rec.h = kind === 'caydanlik' ? 0.24 : 0.16;
      g.add(lathe([[0, 0], [0.11, 0.01], [0.12, 0.08], [0.08, 0.15], [0.04, 0.16]], mat(kind === 'kettle' ? '#e8e2d4' : '#d9dde4', { metal: 0.6, rough: 0.3 }), 0, 0, 0, 20));
      g.add(rod(v3(0.1, 0.06, 0), v3(0.17, 0.13, 0), 0.012, M.steel()));
      if (kind === 'caydanlik') g.add(lathe([[0, 0], [0.06, 0.005], [0.07, 0.05], [0.04, 0.08], [0.015, 0.09]], mat('#e8b84a', { metal: 0.6, rough: 0.3 }), 0, 0.16, 0, 16));
      break;
    }
    case 'blender': rec.r = 0.07; rec.h = 0.22; g.add(box(0.14, 0.06, 0.14, mat('#3a3a42'), 0, 0, 0)); g.add(cyl(0.07, 0.06, 0.16, mat('#dbe8ef', { rough: 0.05, opacity: 0.45, double: true }), 0, 0.06, 0, 16)); break;
    case 'skewer': rec.r = 0.15; rec.h = 0.03; for (let i = 0; i < 3; i++) g.add(rod(v3(-0.15, 0.02, -0.05 + i * 0.05), v3(0.15, 0.02, -0.05 + i * 0.05), 0.004, M.steel())); break;
    default: potLike(0.12, 0.12, '#c9ccd2'); break;
  }
  // liquid surface, lid, and bits floating about
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(rec.r * 0.92, 24), new THREE.MeshStandardMaterial({ color: '#8fc8ea', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }));
  liquid.rotation.x = -Math.PI / 2;
  liquid.visible = false;
  g.add(liquid);
  rec.liquid = liquid;
  const lid = new THREE.Group();
  lid.add(lathe([[rec.r * 1.02, 0], [rec.r * 0.9, 0.025], [rec.r * 0.4, 0.04], [0, 0.045]], mat('#c9ccd2', { metal: 0.8, rough: 0.3, double: true }), 0, 0, 0, 20));
  lid.add(ball(0.018, mat('#3a3a42'), 0, 0.05, 0));
  lid.position.y = rec.h;
  lid.visible = false;
  g.add(lid);
  rec.lid = lid;
  const towel = box(rec.r * 2.3, 0.01, rec.r * 2.3, mat('#f8f4ec', { rough: 0.95 }), 0, rec.h - 0.005, 0);
  towel.visible = false;
  g.add(towel);
  rec.towel = towel;
  for (let i = 0; i < 8; i++) { const b = ball(0.016, mat('#ffffff'), 0, 0, 0, 1, 0.7, 1, 8); b.visible = false; g.add(b); rec.bits.push(b); }
  for (let i = 0; i < 6; i++) { const b = ball(0.01, mat('#ffffff', { opacity: 0.7 }), 0, 0, 0, 1, 1, 1, 6); b.visible = false; g.add(b); rec.bubbles.push(b); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return rec;
}

const CONTENT_COL = { water: '#8fc8ea' };
function updateVessel(rec, v, t) {
  const r = rec.r;
  const level = Math.max(0, Math.min(1, v.water || 0));
  const hasFood = v.contents && v.contents.some((c) => c.kind !== 'water');
  const show = level > 0.02 || hasFood;
  rec.liquid.visible = show && !v.lid;
  if (show) {
    rec.liquid.position.y = 0.008 + (level > 0.02 ? level : 0.25) * rec.h * 0.9;
    const col = v.liquid || (level > 0.02 ? CONTENT_COL.water : mainColor(v));
    rec.liquid.material.color.set(col);
    rec.liquid.material.opacity = level > 0.02 && !v.liquid ? 0.72 : 0.96;
    if (v.cook) rec.liquid.material.color.lerp(new THREE.Color('#8a4a1a'), Math.min(0.5, v.cook * 0.4));
  }
  rec.lid.visible = !!v.lid;
  rec.towel.visible = !!v.towel;
  // bits of what's inside, bobbing
  const kinds = (v.contents || []).filter((c) => c.kind !== 'water');
  rec.bits.forEach((b, i) => {
    const c = kinds[i % Math.max(1, kinds.length)];
    b.visible = !!c && !v.lid && i < kinds.length * 2;
    if (!b.visible) return;
    b.material = mat(bitColor(c.kind), { rough: 0.6 });
    const a = i * 2.4 + (v.boil > 0.3 ? t * 0.8 : 0);
    const rr = r * (0.25 + (i % 3) * 0.2);
    b.position.set(Math.cos(a) * rr, rec.liquid.position.y + 0.006 + (v.boil > 0.3 ? Math.abs(Math.sin(t * 5 + i)) * 0.01 : 0), Math.sin(a) * rr);
  });
  rec.bubbles.forEach((b, i) => {
    b.visible = v.boil > 0.3 && !v.lid;
    if (!b.visible) return;
    const ph = (t * 1.5 + i * 0.37) % 1;
    b.position.set(Math.cos(i * 2.1) * r * 0.5, rec.liquid.position.y + 0.004, Math.sin(i * 2.1) * r * 0.5);
    b.scale.setScalar(0.4 + ph * v.boil);
  });
}

function bitColor(kind) {
  try { return liquidColor(kind) || '#e0c080'; } catch { return '#e0c080'; }
}
function mainColor(v) {
  const c = (v.contents || []).find((q) => q.kind !== 'water');
  return c ? bitColor(c.kind) : '#e0c080';
}

export { walkable };
