// Moving the cook, as in the football game: arrow keys / WASD (E or Space to
// use what's in front of you, Q – or Tab – for every option there), or on
// phones and tablets a floating thumb stick on the left, a big Use button on
// the right and a little ⋯ button for every option. In first person it's a
// shooter: W / S walk, A / D step sideways, ← → turn (the mouse looks round),
// E is your right hand and Q your left (held: the hand holds on), Tab every
// option, Ctrl (or C) held crouches and Space held stands you up on your toes;
// on a touch screen, two little ⬇ ⬆ buttons do that. Directions are in
// screen space ("up" is away from the camera); the scene turns them into
// kitchen directions.

export class Controls {
  constructor({ onUse, onMore, onView, onFirst, onMenuMove, onHand, onStep, onPour, onWork }) {
    this.onWork = onWork;   // first person: R pressed – using what my main hand holds on what I aim at
    this.onUse = onUse;
    this.onPour = onPour;   // first person: T held (down?) – tipping what I hold into the pot / pan I aim at
    this.onHand = onHand;   // first person: (hand – 1 right, 0 left, down?)
    this.onStep = onStep;   // a move key just pressed
    this.onMore = onMore;
    this.onView = onView;
    this.onFirst = onFirst;
    this.onMenuMove = onMenuMove;
    this.keys = new Set();
    this.stick = null;
    this.sx = 0; this.sy = 0; this.mag = 0;
    this.enabled = true;
    this.menuOpen = false;
    this.fp = false;        // first person (Space and Ctrl change how high you stand)
    this.held = { down: false, up: false }; // (the touch buttons)

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (this.menuOpen && ['arrowup', 'w', 'arrowdown', 's'].includes(k)) { this.onMenuMove(k === 'arrowup' || k === 'w' ? -1 : 1); e.preventDefault(); return; }
      if (MOVE[k]) { this.keys.add(k); e.preventDefault(); this.first(); if (!e.repeat && this.onStep) this.onStep(); }
      if (this.fp && (k === 'control' || k === 'c' || k === ' ')) { this.keys.add(k === ' ' ? 'space' : k); e.preventDefault(); this.first(); return; }
      if (k === 'tab') { e.preventDefault(); if (!e.repeat && this.onMore) { this.first(); this.onMore(); } return; }
      if (this.fp && this.onHand && !this.menuOpen && (k === 'e' || k === 'q')) { e.preventDefault(); if (!e.repeat) { this.first(); this.onHand(k === 'e' ? 1 : 0, true); } return; }
      if ((k === 'e' || k === ' ' || k === 'enter') && !e.repeat) { e.preventDefault(); this.first(); this.onUse(); }
      if (k === 'q' && !e.repeat && this.onMore) { e.preventDefault(); this.first(); this.onMore(); }
      if (k === 'f2' && !e.repeat && this.onView) { e.preventDefault(); this.first(); this.onView(); }
      if (this.fp && k === 't' && !e.repeat && this.onPour) { e.preventDefault(); this.first(); this.onPour(true); }
      if (this.fp && k === 'r' && !e.repeat && this.onWork) { e.preventDefault(); this.first(); this.onWork(); }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.keys.delete(k === ' ' ? 'space' : k);
      if (this.onHand && (k === 'e' || k === 'q')) this.onHand(k === 'e' ? 1 : 0, false);
      if (k === 't' && this.onPour) this.onPour(false);
    });
    addEventListener('blur', () => { this.keys.clear(); if (this.onHand) { this.onHand(1, false); this.onHand(0, false); } });

    // the touch layer
    const root = document.createElement('div');
    root.id = 'touch';
    root.hidden = true;
    root.innerHTML = '<div class="tzone"></div><div class="tstick" hidden><div class="tknob"></div></div><button class="tuse" id="tuse"><b>✋</b><span>Use</span></button><button class="tmore" id="tmore" title="Every option here">⋯</button>'
      + '<button class="tstance tdown" title="Crouch (hold)" hidden>⬇</button><button class="tstance tup" title="Up on your toes (hold)" hidden>⬆</button>';
    document.body.appendChild(root);
    this.root = root;
    this.zone = root.querySelector('.tzone');
    this.stickEl = root.querySelector('.tstick');
    this.knob = root.querySelector('.tknob');
    this.useBtn = root.querySelector('.tuse');
    this.useBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.first(); this.useBtn.classList.add('on'); this.onUse(); });
    root.querySelector('.tmore').addEventListener('pointerdown', (e) => { e.preventDefault(); this.first(); if (this.onMore) this.onMore(); });
    for (const [cls, which] of [['.tdown', 'down'], ['.tup', 'up']]) {
      const b = root.querySelector(cls);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.first(); this.held[which] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
      const off = () => { this.held[which] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
    }
    const offUse = () => this.useBtn.classList.remove('on');
    this.useBtn.addEventListener('pointerup', offUse);
    this.useBtn.addEventListener('pointercancel', offUse);
    this.zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.first();
      if (this.stick) return;
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      this.stickEl.style.left = `${e.clientX}px`;
      this.stickEl.style.top = `${e.clientY}px`;
      this.stickEl.hidden = false;
      this.moveStick(e);
    });
    this.zone.addEventListener('pointermove', (e) => { if (this.stick && e.pointerId === this.stick.id) this.moveStick(e); });
    const release = (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      this.stickEl.hidden = true;
      this.sx = this.sy = this.mag = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    this.zone.addEventListener('pointerup', release);
    this.zone.addEventListener('pointercancel', release);
  }

  first() { if (this.onFirst) { const f = this.onFirst; this.onFirst = null; f(); } }

  moveStick(e) {
    const R = this.stickEl.offsetWidth / 2 || 55;
    let dx = e.clientX - this.stick.x0, dy = e.clientY - this.stick.y0;
    const d = Math.hypot(dx, dy);
    // drag far and the base follows the thumb, so turning stays quick
    if (d > R * 1.35) {
      const k = (d - R * 1.35) / d;
      this.stick.x0 += dx * k; this.stick.y0 += dy * k;
      this.stickEl.style.left = `${this.stick.x0}px`; this.stickEl.style.top = `${this.stick.y0}px`;
      dx = e.clientX - this.stick.x0; dy = e.clientY - this.stick.y0;
    }
    const dd = Math.hypot(dx, dy);
    const dead = R * 0.12;
    this.mag = dd < dead ? 0 : Math.min(1, (dd - dead) / (R * 0.75));
    this.sx = dd > 0 ? dx / dd : 0; this.sy = dd > 0 ? dy / dd : 0;
    const kd = Math.min(dd, R);
    this.knob.style.transform = `translate(calc(-50% + ${this.sx * kd}px), calc(-50% + ${this.sy * kd}px))`;
  }

  // screen-space direction {x, y, mag, stick}; y down is towards the camera
  // (first person: the keys' x is a step sideways – ← → turn instead, turnDir())
  dir() {
    if (!this.enabled) return { x: 0, y: 0, mag: 0 };
    if (this.stick && this.mag > 0) return { x: this.sx, y: this.sy, mag: this.mag, stick: true };
    let x = 0, y = 0;
    for (const k of this.keys) { const m = MOVE[k]; if (m && !(this.fp && TURNS[k])) { x += m[0]; y += m[1]; } }
    const d = Math.hypot(x, y);
    return d ? { x: x / d, y: y / d, mag: 1 } : { x: 0, y: 0, mag: 0 };
  }
  // first person: ← → held (1 turns right)
  turnDir() {
    if (!this.fp || !this.enabled) return 0;
    let t = 0;
    for (const k of this.keys) if (TURNS[k]) t += TURNS[k];
    return t;
  }

  // how high I'd stand: -1 crouching, 1 on my toes, 0 standing
  stance() {
    if (!this.fp || !this.enabled) return 0;
    if (this.keys.has('control') || this.keys.has('c') || this.held.down) return -1;
    if (this.keys.has('space') || this.held.up) return 1;
    return 0;
  }
  setFirstPerson(on) {
    this.fp = on;
    for (const b of this.root.querySelectorAll('.tstance')) b.hidden = !on;
    if (!on) { this.keys.delete('control'); this.keys.delete('c'); this.keys.delete('space'); this.held.down = this.held.up = false; }
  }

  setTouch(on) {
    this.root.hidden = !on;
    document.body.classList.toggle('touchui', on);
  }

  // the Use button says what it will do
  setUseLabel(text, enabled) {
    this.useBtn.querySelector('span').textContent = text || 'Use';
    this.useBtn.classList.toggle('dim', !enabled);
  }
}

const MOVE = {
  arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1],
  arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0],
};
const TURNS = { arrowleft: -1, arrowright: 1 };

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function isTouchDevice() {
  return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 1;
}

// Pinching and double-tapping must never zoom the page (iOS ignores user-scalable=no).
export function lockZoom() {
  const block = (e) => { if (e.cancelable) e.preventDefault(); };
  for (const k of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(k, block, { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) block(e); }, { passive: false });
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => {
    const ui = e.target.closest && e.target.closest('button, a, label, input, textarea, select');
    if (e.timeStamp - lastEnd < 350 && e.touches.length === 0 && !ui) block(e);
    lastEnd = e.timeStamp;
  }, { passive: false });
}
