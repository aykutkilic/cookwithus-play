// Serverless kitchens (the same approach as the football game's rooms): the
// cook who opens a kitchen runs the authoritative Room in their own browser;
// friends connect to them directly with WebRTC.
//
//  * The kitchen starts at once in this tab – you can cook alone, offline.
//    In the background we register an invite code with the signalling broker
//    (our Cloudflare Worker if configured in cloud.js, else the free public
//    PeerJS broker); once that's done, friends can join with the code / link.
//  * Each guest gets one reliable, ordered DataChannel carrying JSON.
//  * The Room is clocked from a Web Worker, because page timers are
//    throttled hard in background tabs while worker timers are not.

import { Transport } from './net.js';
import { Room } from '../shared/room.js';
import { sanitizeProfile } from '../shared/names.js';
import { cloudUrl } from './cloud.js';

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
const PEERJS_SRI = 'sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu';
const PEER_PREFIX = 'cookwithus-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TICK_MS = 50;

let peerLib = null;
export function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEERJS_URL;
      s.integrity = PEERJS_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS failed to load')));
      s.onerror = () => { peerLib = null; reject(new Error('could not load PeerJS')); };
      document.head.appendChild(s);
    });
  }
  return peerLib;
}

// PeerJS options: our Worker as the broker, with its STUN/TURN servers
let iceOnce = null;
async function peerOptions() {
  const base = cloudUrl();
  if (!base) return { debug: 0 };
  const u = new URL(base);
  const secure = u.protocol === 'https:';
  const opts = { debug: 0, host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: '/', secure, key: 'peerjs' };
  if (!iceOnce) {
    iceOnce = fetch(new URL('/ice', base), { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => (Array.isArray(j.iceServers) && j.iceServers.length ? j.iceServers : null))
      .catch(() => null);
  }
  const ice = await iceOnce;
  if (!ice) iceOnce = null;
  opts.config = { iceServers: ice || [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }] };
  return opts;
}

function guestId(code) {
  return `${PEER_PREFIX}${code}-${Math.random().toString(36).slice(2, 10)}`;
}

async function openPeer(Peer, id) {
  const opts = await peerOptions();
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, opts);
    const timer = setTimeout(() => { peer.destroy(); reject(Object.assign(new Error('signalling timeout'), { type: 'timeout' })); }, 12000);
    peer.once('open', () => { clearTimeout(timer); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(timer); peer.destroy(); reject(e); });
  });
}

export function randomCode() {
  let code = '';
  for (let k = 0; k < 4; k++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return code;
}

// ---------------------------------------------------------------- host

export class HostSession {
  // opts: {name, size, cuisine, recipe}; onStatus(state, code): 'opening' | 'ready' | 'offline'
  constructor(opts, onStatus = () => {}) {
    this.peer = null;
    this.code = null;
    this.guests = new Set();
    this.nextId = 2; // 1 is the host's own client
    this.closed = false;
    this.onStatus = onStatus;
    this.room = new Room('----', opts);
    this.local = new LocalNet(this);
    this.startTicker();
  }

  // Register an invite code with the broker (retries in the background).
  async openInvites() {
    if (this.peer || this.opening || this.closed) return;
    this.opening = true;
    this.onStatus('opening', null);
    let delay = 2000;
    while (!this.peer && !this.closed) {
      try {
        const Peer = await loadPeer();
        for (let i = 0; i < 5 && !this.peer; i++) {
          const code = randomCode();
          try {
            this.peer = await openPeer(Peer, PEER_PREFIX + code);
            this.code = code;
          } catch (e) {
            if (e.type !== 'unavailable-id') throw e;
          }
        }
      } catch (e) {
        console.warn('[host] invites unavailable:', e.type || e.message);
        this.onStatus('offline', null);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(30000, delay * 2);
      }
    }
    this.opening = false;
    if (this.closed) { try { this.peer && this.peer.destroy(); } catch { /* ignore */ } return; }
    this.room.setCode(this.code);
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect(); } catch { /* ignore */ } } });
    this.peer.on('error', (e) => console.warn('[host] peer error:', e.type));
    this.onStatus('ready', this.code);
  }

  startTicker() {
    const run = () => {
      if (this.closed) return;
      const now = performance.now();
      this.room.tick(now);
      if (++this.watch % 40 === 0) this.dropSilentGuests(now);
    };
    this.watch = 0;
    try {
      const src = `setInterval(() => postMessage(0), ${TICK_MS});`;
      this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.worker.onmessage = run;
    } catch {
      this.interval = setInterval(run, TICK_MS);
    }
  }

  accept(conn) {
    const client = {
      id: this.nextId++, room: null, profile: sanitizeProfile(null), conn, lastSeen: performance.now(),
      sendText: (s) => { if (conn.open) { try { conn.send(s); } catch { /* closed */ } } },
    };
    conn.on('open', () => {
      if (this.closed) {
        client.sendText(JSON.stringify({ t: 'error', text: 'This kitchen has closed' }));
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.guests.add(client);
      client.sendText(JSON.stringify({ t: 'welcome', id: client.id }));
    });
    conn.on('data', (d) => this.text(client, d));
    conn.on('close', () => this.drop(client));
    conn.on('error', () => this.drop(client));
  }

  text(client, raw) {
    client.lastSeen = performance.now();
    let msg = raw;
    if (typeof raw === 'string') { try { msg = JSON.parse(raw); } catch { return; } }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      if (msg.t === 'hello') {
        client.profile = sanitizeProfile(msg.profile);
        if (!client.room) {
          if (!this.room.join(client)) setTimeout(() => this.drop(client), 500);
          return;
        }
      }
      if (msg.t === 'leave') { this.drop(client); return; }
      if (client.room) this.room.handleText(client, msg);
    } catch (e) { console.error('[host] message failed', msg.t, e); }
  }

  drop(client) {
    if (!this.guests.has(client) && !client.room) return;
    this.guests.delete(client);
    if (client.room) this.room.leave(client);
    try { client.conn.close(); } catch { /* ignore */ }
  }

  // a guest whose browser vanished without closing the connection
  dropSilentGuests(now) {
    for (const g of this.guests) if (now - g.lastSeen > 20000) this.drop(g);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    if (this.worker) this.worker.terminate();
    clearInterval(this.interval);
    for (const g of [...this.guests]) {
      g.sendText(JSON.stringify({ t: 'error', text: 'The head chef closed the kitchen', closed: true }));
      this.drop(g);
    }
    setTimeout(() => { try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ } }, 200);
  }
}

// The hosting cook's own client: an in-memory loopback into the Room.
export class LocalNet extends Transport {
  constructor(host) {
    super('local');
    this.host = host;
    this.client = {
      id: 1, room: null, profile: sanitizeProfile(null), lastSeen: Infinity,
      sendText: (s) => queueMicrotask(() => { if (this.connected) this.emit('msg', JSON.parse(s)); }),
    };
  }

  connect() {
    this.connected = true;
    queueMicrotask(() => {
      this.emit('msg', { t: 'welcome', id: this.client.id, host: true });
      this.emit('open');
    });
  }

  send(obj) {
    const s = JSON.stringify(obj);
    queueMicrotask(() => this.host.text(this.client, s));
  }

  close() {
    if (!this.connected) return;
    this.connected = false;
    this.host.destroy();
    this.emit('close', { wasOpen: true });
  }
}

// ---------------------------------------------------------------- guest

export class PeerNet extends Transport {
  constructor(code) {
    super('webrtc');
    this.code = String(code).toUpperCase();
    this.done = false;
    this.lastRecv = 0;
  }

  async connect() {
    try {
      const Peer = await loadPeer();
      this.peer = await openPeer(Peer, guestId(this.code));
      const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'raw' });
      this.conn = conn;
      const timer = setTimeout(() => this.fail('Could not reach that kitchen (a strict firewall can block peer-to-peer).'), 20000);
      conn.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        this.lastRecv = performance.now();
        this.emit('open');
        this.watchdog = setInterval(() => {
          if (performance.now() - this.lastRecv > 12000) this.fail('Lost connection to the kitchen');
        }, 1000);
      });
      conn.on('data', (d) => {
        if (typeof d !== 'string') return;
        this.lastRecv = performance.now();
        this.bytesIn += d.length;
        let msg;
        try { msg = JSON.parse(d); } catch { return; }
        this.emit('msg', msg);
      });
      conn.on('close', () => this.closed());
      conn.on('error', () => this.closed());
      this.peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') this.fail(`No kitchen with code ${this.code} – is the head chef still there?`);
        else if (!this.connected) this.fail(`Connection failed (${e.type})`);
      });
    } catch (e) {
      this.fail(`Could not start peer-to-peer (${e.type || e.message})`);
    }
  }

  fail(text) {
    if (this.done) return;
    this.emit('msg', { t: 'error', text });
    this.closed();
  }

  closed() {
    if (this.done) return;
    this.done = true;
    const wasOpen = this.connected;
    this.connected = false;
    clearInterval(this.watchdog);
    try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
    this.emit('close', { wasOpen });
  }

  send(obj) {
    if (!this.conn || !this.conn.open) return;
    const s = JSON.stringify(obj);
    this.bytesOut += s.length;
    try { this.conn.send(s); } catch { /* closed */ }
  }

  close() {
    try { if (this.conn) this.conn.close(); } catch { /* ignore */ }
    this.closed();
  }
}
