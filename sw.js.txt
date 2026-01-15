// sw.js (served from Cloudflare Pages, trusted origin app.masteroppgave2026.no)
// Verifies responses using Content-Digest + HTTP Message Signatures.

let SIG_VERIFY_KEY = null;

function log(...args) {
  const msg = args.join(' ');
  console.log('[SW]', msg);
  self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
    for (const c of clients) c.postMessage({ type: 'SW_LOG', message: msg, ts: new Date().toISOString() });
  });
}

self.addEventListener('install', (e) => {
  log('install → skipWaiting');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  log('activate → clients.claim');
  e.waitUntil(self.clients.claim());
});

self.addEventListener('message', async (event) => {
  if (event.data?.type === 'SET_SIG_KEY') {
    try {
      SIG_VERIFY_KEY = await crypto.subtle.importKey(
        'jwk',
        event.data.jwk,
        { name: 'RSA-PSS', hash: 'SHA-256' },
        false,
        ['verify']
      );
      log('signature verification key installed (kid=' + (event.data.jwk?.kid || '?') + ')');
    } catch (e) {
      SIG_VERIFY_KEY = null;
      log('ERROR installing signature key:', e?.message || String(e));
    }
  }
});

function b64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function parseDigestHeader(cd) {
  const m = cd?.match(/sha-256=:(.+):/i);
  return m ? m[1] : null;
}

function parseSigHeader(sig) {
  const m = sig?.match(/sig1=:(.+):/i);
  return m ? m[1] : null;
}

function isProtectedContentType(ct) {
  ct = ct || '';
  return ct.includes('text/html') || ct.includes('application/json') || ct.includes('application/javascript') || ct.includes('text/javascript');
}

async function verifyResponse(response, bodyText) {
  if (!SIG_VERIFY_KEY) throw new Error('verification key not installed');

  const cd = response.headers.get('Content-Digest');
  const sig = response.headers.get('Signature');
  const sigInput = response.headers.get('Signature-Input');

  if (!cd || !sig || !sigInput) throw new Error('missing security headers');

  // Digest check
  const expectedB64 = parseDigestHeader(cd);
  if (!expectedB64) throw new Error('bad Content-Digest format');

  const actualHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyText));
  const actualB64 = btoa(String.fromCharCode(...new Uint8Array(actualHash)));
  if (actualB64 !== expectedB64) throw new Error('digest mismatch');

  // Signature check
  const params = sigInput.replace(/^sig1=/, '');
  const base =
    `"@status": ${response.status}\n` +
    `content-digest: ${cd}\n` +
    `"@signature-params": ${params}`;

  const sigB64 = parseSigHeader(sig);
  if (!sigB64) throw new Error('bad Signature format');

  const ok = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 },
    SIG_VERIFY_KEY,
    b64ToBytes(sigB64),
    new TextEncoder().encode(base)
  );
  if (!ok) throw new Error('signature verification failed');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) return;
  if (url.origin !== self.location.origin) return;

  // Never intercept trusted installer assets
  if (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/installer.js' ||
    url.pathname === '/sw.js'
  ) return;

  event.respondWith((async () => {
    const res = await fetch(event.request);

    // Until key installed, pass-through (installer should set it before redirect)
    if (!SIG_VERIFY_KEY) {
      log('PASS (no key yet)', url.pathname, '→', res.status);
      return res;
    }

    const ct = res.headers.get('Content-Type') || '';
    if (!isProtectedContentType(ct)) {
      log('PASS (unverified type)', url.pathname, 'ct=', ct, '→', res.status);
      return res;
    }

    const text = await res.clone().text();

    try {
      await verifyResponse(res, text);
      log('OK', url.pathname, 'status=', res.status);
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch (e) {
      log('BLOCK', url.pathname, 'reason=', e.message || String(e), 'status=', res.status);
      return new Response('Blocked by Service Worker (integrity violation): ' + (e.message || 'unknown'), {
        status: 498,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
