const out = document.getElementById('log');

function log(m) {
  console.log('[INSTALL]', m);
  out.textContent += '\n' + m;
  out.scrollTop = out.scrollHeight;
}

// DNS TXT pin lookup (DoH)
async function fetchDNSHash() {
  log('Fetching SIG-PUB pin from DNS TXT (_sigpub.app.masteroppgave2026.no)…');

  const r = await fetch(
    'https://cloudflare-dns.com/dns-query?name=_sigpub.app.masteroppgave2026.no&type=TXT',
    { headers: { accept: 'application/dns-json' }, cache: 'no-store' }
  );
  const j = await r.json();

  const raw = j.Answer?.[0]?.data?.replace(/"/g, '');
  if (!raw) throw new Error('DNS pin missing');

  const part = raw.split(';').find(p => p.startsWith('sha256='));
  if (!part) throw new Error('DNS pin invalid (expected sha256=...)');

  const pin = part.slice(7);
  log('DNS pin loaded');
  return pin;
}

async function hashJWK(jwk) {
  // Canonical form must match how you computed the pin
  const canonical = JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e });

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function main() {
  log('Installer started');

  // 1) DNS pin
  const pinned = await fetchDNSHash();

  // 2) Fetch sig-pub from SAME ORIGIN (Pages will proxy to intermediate → host)
  log('Fetching /sig-pub from app origin (proxied to host)…');
  const r = await fetch('/sig-pub', { cache: 'no-store' });
  if (!r.ok) throw new Error('Failed to fetch /sig-pub (HTTP ' + r.status + ')');

  const jwk = await r.json();
  log('Got SIG-PUB (kid=' + (jwk.kid || '?') + ')');

  // 3) Verify against DNS pin
  const local = await hashJWK(jwk);
  if (local !== pinned) {
    log('🚨 MITM DETECTED: SIG-PUB hash mismatch');
    document.body.insertAdjacentHTML('beforeend', '<p><b>MITM detected: key mismatch</b></p>');
    return;
  }
  log('SIG-PUB verified against DNS pin ✅');

  // 4) Register SW (trusted file served by Pages)
  if (!('serviceWorker' in navigator)) throw new Error('ServiceWorker not supported');
  log('Registering Service Worker /sw.js …');

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  log('Service Worker ready ✅');

  const active = reg.active || reg.waiting || reg.installing;
  if (!active) throw new Error('No SW instance available');

  // 5) Hand verified key to SW
  log('Sending verified key to SW (SET_SIG_KEY)…');
  active.postMessage({ type: 'SET_SIG_KEY', jwk });

  // 6) Redirect into the app (everything now protected by SW)
  log('Redirecting to /login.html …');
  await new Promise(r => setTimeout(r, 150));
  location.replace('/login.html');
}

main().catch(err => {
  log('FATAL: ' + (err?.message || err));
  console.error(err);
});
