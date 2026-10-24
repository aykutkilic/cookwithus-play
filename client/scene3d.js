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
import { buildKitchen, FIXTURES, walkable } from '../shared/kitchens.js';
import { VESSELS, twoHanded } from '../shared/ingredients.js';
import { buildKitchen3D, COUNTER_H } from './kitchen3d.js';
import { buildCook, poseCook, fadeCook } from './cook3d.js';
import { mat, M, ball, cyl, lathe, ring, box, rod, v3 } from './parts3d.js';
import { drawIngredient, drawPieces, liquidColor } from './art.js';
import { themeOf } from './theme.js';

const LIGHTS = 6;
const GLIDE_S = 0.45;  // a thing taken / put down travels this long, in a little arc
const REACH_S = 0.55;  // and the cook reaches out for it
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
        ao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 2, thickness: 1, scale: 1, samples: 12 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
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
    this.t = 0;
    this.dt = 0;
    this.zoom = 1;
    this.firstPerson = false;
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

  get quality() { return this.q.steps.slice(0, this.q.level).map((s) => s[0]).join(', ') || 'full'; }

  // Called every frame with the time since the last one. Averaged over ~1.5 s:
  // under ~50 fps, drop the next extra and look again.
  govern(ms) {
    const q = this.q;
    if (q.skip > 0) { q.skip--; return; }
    if (ms > 250) return; // a hidden tab, a dialog: not the renderer's fault
    q.n++; q.sum += ms;
    if (q.n < 90) return;
    const avg = q.sum / q.n;
    q.n = 0; q.sum = 0;
    this.fps = Math.round(1000 / avg);
    if (avg > 19.5 && q.level < q.steps.length) {
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

  // F2: looking through my cook's eyes, or at the whole room
  setFirstPerson(on) {
    this.firstPerson = on;
    this.camera.fov = on ? 72 : 32;
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
    this.updateFixtures(view);
    this.updateCooks(view, dt); // first: things in their hands follow them
    this.updateStash(view);
    this.updateVessels(view, dt);
    this.updateItems(view);
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
      const pitch = view.pitch ?? -0.18;
      const eye = new THREE.Vector3(me.x, 0.62, me.y);
      const dir = new THREE.Vector3(Math.sin(me.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(me.yaw) * Math.cos(pitch));
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
    // in someone's hands
    for (const rec of this.cooks.values()) {
      if (!rec.holding || !rec.hands) continue;
      rec.holding.forEach((k, i) => {
        if (k[0] === 'v' && !GRIP3D[rec.holdKind] && !twoHanded(rec.holdKind)) {
          // a plate, a bowl: carried on one hand, out in front
          const p = rec.rightHand.clone();
          p.x += Math.sin(rec.yaw) * 0.06; p.z += Math.cos(rec.yaw) * 0.06; p.y -= 0.02;
          out.set(k, { pos: p, yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
          return;
        }
        const g = k[0] === 'v' && GRIP3D[rec.holdKind];
        if (g) {
          // a pan by its handle, in the right hand, the pan out in front
          const th = rec.yaw + Math.PI / 2, sc = 0.85;
          const gx = g.x * Math.cos(th) + g.z * Math.sin(th), gz = -g.x * Math.sin(th) + g.z * Math.cos(th);
          const p = rec.rightHand.clone().sub(new THREE.Vector3(gx * sc, g.y * sc, gz * sc));
          out.set(k, { pos: p, yaw: th, held: true, sig: `h:${rec.id}` });
          return;
        }
        const p = rec.hands.clone();
        p.x += Math.sin(rec.yaw) * 0.02 + Math.cos(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.z += Math.cos(rec.yaw) * 0.02 - Math.sin(rec.yaw) * (i - (rec.holding.length - 1) / 2) * 0.07;
        p.y -= 0.05;
        out.set(k, { pos: p, yaw: rec.yaw, held: true, sig: `h:${rec.id}` });
      });
    }
  }

  // Things travel between places in a little arc instead of jumping: when
  // where it belongs changes (sig), it glides from where it was drawn.
  glide(key, sig, target) {
    let g = this.glides.get(key);
    if (!g) { g = { sig, pos: target.clone(), from: null, t: 1 }; this.glides.set(key, g); return g.pos; }
    if (g.sig !== sig) { g.sig = sig; g.from = g.pos.clone(); g.t = 0; }
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
    if (D) {
      // vessels resting on the same counter / table share its spots
      const spotUse = new Map();
      for (const [id, v] of Object.entries(D.vessels)) {
        const kept = this.stashAt && this.stashAt.get(`v:${id}`);
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
        else if (A.spots) { const n = spotUse.get(v.at.fx) || 0; spotUse.set(v.at.fx, n + 1); p = A.spots[Math.min(n, A.spots.length - 1)]; if (n === 0 && A.board && (v.kind === 'bowl' || v.kind === 'plate' || v.kind === 'blender')) p = A.board; }
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
        rec.group.rotation.y = kept && kept.yaw != null ? kept.yaw : 0;
        rec.group.scale.setScalar(kept && kept.held ? 0.85 : kept ? 0.8 : 1);
        updateVessel(rec, v, this.t);
        if (v.boil > 0.25 && Math.random() < v.boil * dt * 25) this.puff(p.clone().setY(p.y + rec.h), 'steam');
        if (v.heat > 0 && (v.kind === 'pan' || v.kind === 'paellaPan') && v.contents && v.contents.length && Math.random() < dt * 12) this.puff(p.clone().setY(p.y + 0.05), 'sizzle');
        // food lying on trays / plates
        rec.items = (v.items || []).map((i) => ({ id: i.id, st: D.items[i.id] }));
      }
    }
    for (const [id, rec] of this.vessels) if (!seen.has(id)) rec.group.visible = false; else rec.group.visible = true;
  }

  // ------------------------------------------------------------------ food on the boards (2D drawings as standees)

  spriteFor(kind, st, cut) {
    const key = cut ? `p|${kind}|${cut}` : `i|${kind}|${JSON.stringify(st, ['qty', 'washed', 'peeled', 'cut', 'k', 'n', 'cook', 'shape', 'size', 'sauce', 'coverage', 'toppings', 'x', 'y', 'kind', 'boiled', 'cored', 'rolls', 'stuffed', 'form'])}`;
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

  updateItems(view) {
    const D = view.D;
    if (!D) { for (const s of this.sprites.values()) s.visible = false; return; }
    const used = new Set();
    const show = (slot, tex, pos, size) => { this.placeSprite(slot, tex, pos, size); used.add(slot); };
    // what's being worked on, and prepped piles waiting
    const perFx = new Map();
    for (const [id, it] of Object.entries(D.items)) {
      if (it.hidden || it.in) continue;
      const kept = this.stashAt && this.stashAt.get(`i:${id}`);
      if (kept) {
        // in the fridge / on the shelf, or in someone's hands
        show(`item:${id}`, this.spriteFor(it.kind, it), this.glide(`i:${id}`, kept.sig, kept.pos), kept.held ? 0.2 : 0.17);
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
      const pos = active && A.board ? A.board : A.spots ? A.spots[n % A.spots.length] : A.top;
      if (!pos) continue;
      const done = it.cut && (it.k || 0) >= (it.n || 0);
      const tex = done && !active ? this.spriteFor(it.kind, null, it.cut) : this.spriteFor(it.kind, it);
      show(`item:${id}`, tex, this.glide(`i:${id}`, `a:${fxId}`, pos), active ? 0.34 : 0.24);
    }
    // food on trays and plates
    for (const [vid, rec] of this.vessels) {
      if (!rec.group.visible || !rec.items) continue;
      rec.items.forEach((i, k) => { if (i.st) show(`on:${vid}:${k}`, this.spriteFor(i.st.kind, i.st), rec.group.position.clone().add(v3((k - (rec.items.length - 1) / 2) * 0.12, rec.h * 0.6, 0)), 0.28); });
    }
    // scraps on counters
    const C = view.C;
    if (C && C.scraps) for (const [fxId, sc] of Object.entries(C.scraps)) {
      if (!sc || !sc.n) continue;
      const F = this.k3.fx[fxId];
      if (!F || !F.anchors.scraps) continue;
      const kind = sc.kinds[sc.kinds.length - 1] || 'onion';
      show(`scraps:${fxId}`, this.scrapTex(kind, sc.n), F.anchors.scraps, 0.16 + Math.min(4, sc.n) * 0.02);
    }
    for (const [slot, s] of this.sprites) if (!used.has(slot)) s.visible = false;
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
      poseCook(rec.fig, { speed: rec.speed, turn: dt > 0 ? turn / dt : 0, work: c.work, carry: !!c.carry || holding.length > 0, hold, reach, scraps: !!c.carry, t: this.t + c.id * 1.7 }, dt);
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
    const F = view.target && this.k3.fx[view.target];
    if (F) {
      const f = F.f;
      const h = topHeight(f);
      m.visible = true;
      m.position.set(f.x + f.w / 2, h + 0.35 + Math.sin(this.t * 5) * 0.04, f.y + f.h / 2);
      m.children[1].position.y = -(h + 0.35) + 0.01;
      m.children[1].scale.setScalar(Math.max(f.w, f.h) * 0.9);
    } else m.visible = false;
    // where the step you picked can be done: golden arrows
    const want = view.guide ? [...view.guide] : [];
    while (this.guides.children.length < want.length) {
      const a = cyl(0, 0.06, 0.1, mat('#ffe070', { emissive: '#ffd040', ei: 1.6 }), 0, 0, 0, 10);
      a.rotation.x = Math.PI;
      this.guides.add(a);
    }
    this.guides.children.forEach((a, i) => {
      const fid = want[i];
      const G = fid && this.k3.fx[fid];
      a.visible = !!G && fid !== view.target;
      if (G) a.position.set(G.f.x + G.f.w / 2, topHeight(G.f) + 0.55 + Math.sin(this.t * 4 + i) * 0.06, G.f.y + G.f.h / 2);
    });
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
