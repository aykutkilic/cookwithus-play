// Kitchen sounds, all synthesised live with WebAudio (no samples): knife
// thunks, scrubbing, running water, sizzling pans, bubbling pots, the oven
// ding, the serving bell … plus a gentle generative tune in the colour of
// the kitchen's cuisine (a Turkish hicaz, a Spanish phrygian, an Indian raga …).

const SCALES = {
  turkish: [0, 1, 4, 5, 7, 8, 10, 12],      // hicaz
  spanish: [0, 1, 4, 5, 7, 8, 10, 12],      // phrygian dominant
  indian: [0, 1, 4, 5, 7, 8, 11, 12],       // bhairav
  italian: [0, 2, 4, 5, 7, 9, 11, 12],      // major, mandolin-ish
  french: [0, 2, 3, 5, 7, 8, 10, 12],       // a little musette minor
  english: [0, 2, 4, 7, 9, 12, 14, 16],     // pentatonic folk
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
    this.musicVol = 0.35;
    this.muted = false;
    try {
      const s = JSON.parse(localStorage.getItem('cookwithus.sound') || 'null');
      if (s) { this.vol = s.vol ?? 0.8; this.musicVol = s.music ?? 0.35; this.muted = !!s.muted; }
    } catch { /* ignore */ }
    this.cuisine = 'turkish';
    this.last = {};
    this.loops = {};
  }

  save() { try { localStorage.setItem('cookwithus.sound', JSON.stringify({ vol: this.vol, music: this.musicVol, muted: this.muted })); } catch { /* ignore */ } }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.vol;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; this.save(); }
  setVolume(v) { this.vol = v; if (this.master && !this.muted) this.master.gain.value = v; this.save(); }
  setMusic(v) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; this.save(); }

  // ------------------------------------------------------------------ building blocks
  env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, at = 0, dest = null) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    this.env(g, t, 0.005, dur, vol);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  hiss(dur, freq, q = 1, vol = 0.3, type = 'bandpass', at = 0, sweep = 0) {
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, dur, vol);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ the sounds
  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (now - (this.last[name] || 0) < 35) return;
    this.last[name] = now;
    const v = vol;
    switch (name) {
      case 'chop': this.hiss(0.05, 2400, 1.2, 0.5 * v); this.tone(150, 0.09, 'sine', 0.5 * v, 0.6); break;
      case 'thud': this.tone(110, 0.14, 'sine', 0.55 * v, 0.5); this.hiss(0.06, 600, 1, 0.25 * v); break;
      case 'scrub': this.hiss(0.16, 1800 + Math.random() * 600, 0.8, 0.22 * v, 'bandpass', 0, 0.7); break;
      case 'squish': this.hiss(0.14, 500, 1.5, 0.25 * v, 'lowpass', 0, 0.5); this.tone(180, 0.12, 'sine', 0.15 * v, 0.7); break;
      case 'water': this.hiss(0.25, 3000, 0.6, 0.12 * v, 'bandpass', 0, 1.2); break;
      case 'tap': this.tone(900, 0.04, 'square', 0.12 * v); this.tone(600, 0.06, 'sine', 0.2 * v, 1, 0.03); break;
      case 'door': this.tone(140, 0.2, 'triangle', 0.35 * v, 0.6); this.hiss(0.1, 900, 1, 0.15 * v); break;
      case 'click': this.tone(1800, 0.02, 'square', 0.12 * v); break;
      case 'whoosh': this.hiss(0.3, 600, 0.7, 0.3 * v, 'bandpass', 0, 4); break;
      case 'grab': this.tone(320, 0.06, 'sine', 0.15 * v, 1.4); break;
      case 'clunk': this.tone(220, 0.12, 'triangle', 0.4 * v, 0.7); this.hiss(0.05, 1500, 1, 0.15 * v); break;
      case 'plop': this.tone(520, 0.14, 'sine', 0.4 * v, 0.45); break;
      case 'splash': this.hiss(0.35, 1400, 0.7, 0.35 * v, 'bandpass', 0, 0.4); this.tone(300, 0.15, 'sine', 0.2 * v, 0.5); break;
      case 'pour': case 'pourTick': this.hiss(0.22, 900 + Math.random() * 300, 1.4, (name === 'pour' ? 0.25 : 0.12) * v, 'bandpass'); break;
      case 'stop': break;
      case 'crack': this.hiss(0.04, 3500, 2, 0.5 * v, 'highpass'); this.tone(900, 0.04, 'square', 0.12 * v, 0.6, 0.02); break;
      case 'peel': this.hiss(0.2, 2600, 2, 0.2 * v, 'bandpass', 0, 0.5); break;
      case 'peeler': this.hiss(0.18, 4200, 3, 0.18 * v, 'bandpass', 0, 0.6); break;
      case 'grate': for (let i = 0; i < 4; i++) this.hiss(0.03, 3200, 4, 0.22 * v, 'bandpass', i * 0.035); break;
      case 'roll': this.hiss(0.3, 300, 0.6, 0.2 * v, 'lowpass', 0, 1.5); break;
      case 'shake': for (let i = 0; i < 3; i++) this.hiss(0.025, 5000, 2, 0.18 * v, 'highpass', i * 0.04); break;
      case 'whisk': this.hiss(0.12, 4000, 1.5, 0.12 * v, 'bandpass', 0, 0.8); this.tone(2200, 0.05, 'triangle', 0.05 * v); break;
      case 'stir': this.hiss(0.2, 700, 0.8, 0.15 * v, 'bandpass', 0, 1.3); break;
      case 'blend': this.tone(90, 0.35, 'sawtooth', 0.08 * v, 1.3); this.hiss(0.35, 800, 0.8, 0.12 * v); break;
      case 'slit': this.hiss(0.25, 2800, 3, 0.2 * v, 'bandpass', 0, 0.6); break;
      case 'smear': this.hiss(0.1, 900, 0.6, 0.08 * v, 'lowpass'); break;
      case 'scoop': this.tone(300, 0.08, 'sine', 0.15 * v, 1.6); break;
      case 'pop': this.tone(660, 0.1, 'sine', 0.25 * v, 1.6); break;
      case 'ding': [784, 988, 1175].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.22 * v, 1, i * 0.09)); break;
      case 'timer': [1318, 1318, 1318].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18 * v, 1, i * 0.22)); break;
      case 'bell': [1046, 2093, 3136].forEach((f, i) => this.tone(f, 1.6 - i * 0.4, 'sine', (0.3 - i * 0.08) * v)); break;
      case 'pedal': this.tone(180, 0.1, 'triangle', 0.3 * v, 0.8); this.tone(420, 0.12, 'square', 0.06 * v, 1.2, 0.05); break;
      case 'bag': this.hiss(0.3, 2000, 0.5, 0.2 * v, 'highpass', 0, 0.6); break;
      case 'chat': this.tone(880, 0.07, 'sine', 0.15 * v, 1.2); this.tone(1320, 0.08, 'sine', 0.12 * v, 1, 0.06); break;
      case 'join': [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.15 * v, 1, i * 0.08)); break;
      case 'leave': [659, 523].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.13 * v, 1, i * 0.1)); break;
      case 'step': this.tone(220, 0.04, 'sine', 0.05 * v); break;
      case 'ui': this.tone(740, 0.05, 'sine', 0.12 * v, 1.3); break;
      case 'fanfare': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.18 * v, 1, i * 0.12)); break;
      default: break;
    }
  }

  // continuous kitchen ambience: sizzle (hot pans with food) and bubbling (boiling pots)
  ambience(sizzle, boil) {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    if (sizzle > 0 && now - (this.last.sz || 0) > 90) {
      this.last.sz = now;
      this.hiss(0.12, 6000 + Math.random() * 2000, 0.7, Math.min(0.12, 0.04 * sizzle), 'highpass');
    }
    if (boil > 0 && now - (this.last.bb || 0) > 140 + Math.random() * 200) {
      this.last.bb = now;
      this.tone(300 + Math.random() * 500, 0.06, 'sine', Math.min(0.12, 0.04 * boil), 1.8);
    }
  }

  // ------------------------------------------------------------------ music
  setCuisine(c) { this.cuisine = SCALES[c] ? c : 'turkish'; }

  startMusic() {
    if (this.musicOn) return;
    this.musicOn = true;
    const beat = 0.42;
    let step = 0;
    let next = this.ctx.currentTime + 0.3;
    const melody = (deg, oct = 0) => {
      const sc = SCALES[this.cuisine];
      return 261.63 * 2 ** ((sc[((deg % sc.length) + sc.length) % sc.length] + 12 * (oct + Math.floor(deg / sc.length))) / 12);
    };
    let deg = 0;
    const tick = () => {
      if (!this.ctx) return;
      while (next < this.ctx.currentTime + 0.6) {
        const at = next - this.ctx.currentTime;
        const bar = Math.floor(step / 8);
        // a soft bass on the bar, a wandering plucked melody, sometimes a rest
        if (step % 8 === 0) {
          const root = [0, 3, 4, 0][bar % 4];
          this.tone(melody(root, -2), beat * 3.6, 'triangle', 0.12, 1, at, this.musicBus);
          this.tone(melody(root + 2, -1), beat * 3.6, 'sine', 0.05, 1, at, this.musicBus);
        }
        if (Math.random() < 0.72) {
          deg += [-2, -1, -1, 0, 1, 1, 2, 3][(Math.random() * 8) | 0];
          deg = Math.max(-2, Math.min(9, deg));
          const pluck = this.cuisine === 'italian' || this.cuisine === 'spanish';
          if (pluck && Math.random() < 0.3) {
            for (let i = 0; i < 4; i++) this.tone(melody(deg), 0.09, 'triangle', 0.05, 1, at + i * 0.08, this.musicBus);
          } else this.tone(melody(deg), beat * (Math.random() < 0.3 ? 1.8 : 0.9), this.cuisine === 'french' ? 'square' : 'triangle', this.cuisine === 'french' ? 0.025 : 0.07, 1, at, this.musicBus);
        }
        step++;
        next += beat;
      }
    };
    this.musicTimer = setInterval(tick, 200);
  }
}
