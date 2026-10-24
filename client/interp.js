// Other cooks are played back a moment behind, between the positions they
// sent, on their own clock – so they glide at an even pace however the
// messages bunch up on the way (the head chef relays them every 100 ms).
// How far behind adapts to how unevenly the messages arrive, and the
// playback clock only ever speeds up or slows down a little, never jumps.

const WARP = 0.06; // the playback clock may run up to 6 % fast or slow while it settles

export function newTrack(p) {
  return { buf: [], lat: [], lag: null, want: 0, seen: null, x: p.x, y: p.y, d: p.d || 0 };
}

// Where to draw a cook now, given their latest pos message p ({x, y, d, ts:
// their clock, at: when it arrived here}). Updates and returns the track o.
export function follow(o, p, now, dt) {
  const ts = Number.isFinite(p.ts) && p.ts > 0 ? p.ts : null;
  const fresh = ts !== null ? ts !== o.seen : (p.x !== o.lx || p.y !== o.ly || p.d !== o.ld);
  if (fresh) {
    o.seen = ts; o.lx = p.x; o.ly = p.y; o.ld = p.d;
    const t = ts !== null ? ts : p.at;
    const last = o.buf[o.buf.length - 1];
    if (last && (t <= last.t || Math.hypot(p.x - last.x, p.y - last.y) > 2.5)) { o.buf.length = 0; o.lat.length = 0; o.lag = null; } // restarted or teleported
    else if (last && t - last.t > 250) o.buf.push({ t: t - 100, x: last.x, y: last.y, d: last.d }); // stood still until just now
    o.buf.push({ t, x: p.x, y: p.y, d: p.d || 0, w: !!p.w });
    if (o.buf.length > 40) o.buf.splice(0, o.buf.length - 40);
    // how late messages arrive (on their clock vs ours): stay behind the slowest of late
    o.lat.push((p.at ?? now) - t);
    if (o.lat.length > 40) o.lat.shift();
    const lo = Math.min(...o.lat), hi = Math.max(...o.lat);
    o.want = lo + Math.min(340, Math.max(o.lat.length < 12 ? 240 : 100, hi - lo + 45)); // a safe margin until we've seen enough
    if (o.lag === null) o.lag = o.want;
  }
  const B = o.buf;
  if (!B.length) return o;
  // standing still, the delay can change at once (nobody can see it); walking, only gently
  const still = !B[B.length - 1].w && B[0].x === B[B.length - 1].x && B[0].y === B[B.length - 1].y;
  const step = still ? Infinity : dt * 1000 * WARP;
  o.lag += Math.max(-step, Math.min(step, o.want - o.lag));
  const tr = now - o.lag;
  while (B.length > 2 && B[1].t <= tr) B.shift();
  const a = B[0], b = B[1];
  if (!b || tr <= a.t) { o.x = a.x; o.y = a.y; o.d = a.d; return o; }
  if (tr >= b.t) {
    // past the newest: if they were still walking, carry on a little along the last stretch, then wait
    const ahead = b.w ? Math.min(tr - b.t, 90) / Math.max(1, b.t - a.t) : 0;
    o.x = b.x + (b.x - a.x) * ahead; o.y = b.y + (b.y - a.y) * ahead; o.d = b.d;
    return o;
  }
  const f = (tr - a.t) / (b.t - a.t);
  o.x = a.x + (b.x - a.x) * f; o.y = a.y + (b.y - a.y) * f;
  let dd = b.d - a.d;
  while (dd > Math.PI) dd -= Math.PI * 2;
  while (dd < -Math.PI) dd += Math.PI * 2;
  o.d = a.d + dd * f;
  return o;
}
