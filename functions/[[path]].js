// _worker.js
const BACKEND_ORIGIN = 'https://intermediate.tailfd92d1.ts.net';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1️⃣ Trusted assets served from Pages
    if (
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname === '/installer.js' ||
      url.pathname === '/sw.js'
    ) {
      return env.ASSETS.fetch(request);
    }

    // 2️⃣ EVERYTHING else → proxy to intermediate
    const upstreamUrl = new URL(
      url.pathname + url.search,
      BACKEND_ORIGIN
    );

    const upstreamReq = new Request(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    upstreamReq.headers.set('X-Proxy-By', 'cloudflare-pages');

    return fetch(upstreamReq);
  }
};
