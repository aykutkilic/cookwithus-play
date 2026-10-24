// The Cloudflare Worker (cloud/) that brokers WebRTC connections and hands out
// TURN relay credentials, so rooms work across any network. 'self': the game
// is served by that Worker (scripts/build-site.mjs sets this). Empty: fall back
// to the public PeerJS broker (works on most home networks, unreliable on
// mobile / strict NATs). `?cloud=<url>` or localStorage 'cookwithus.cloud'
// overrides it for testing.
export const CLOUD_URL = '';

export function cloudUrl() {
  let url = CLOUD_URL;
  try {
    const q = new URLSearchParams(location.search).get('cloud');
    if (q) localStorage.setItem('cookwithus.cloud', q);
    url = localStorage.getItem('cookwithus.cloud') || CLOUD_URL;
  } catch { /* storage unavailable */ }
  return url === 'self' ? location.origin : url;
}
