// Transports. Every transport exposes the same interface to the game:
//   on('open'|'close'|'msg', fn), send(obj), close()
//
//  * LocalNet – your own kitchen: an in-memory loopback into the Room running
//               in this tab (p2p.js), so cooking starts instantly, even offline.
//  * PeerNet  – a friend's kitchen: WebRTC straight to their browser (p2p.js).
// Cooking is not twitchy like football: everything is small JSON messages on
// one reliable, ordered channel.

export class Transport {
  constructor(kind) {
    this.handlers = {};
    this.connected = false;
    this.kind = kind;
    this.bytesIn = 0; this.bytesOut = 0;
  }
  on(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { const h = this.handlers[type]; if (h) h(data); }
}
