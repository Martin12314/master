import indexHtml from './index.html.txt';
import installerJs from './installer.js.txt';
import swJs from './sw.js.txt';

const BACKEND_ORIGIN = 'https://intermediate.tailfd92d1.ts.net';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(indexHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (url.pathname === '/installer.js') {
      return new Response(installerJs, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      });
    }

    if (url.pathname === '/sw.js') {
      return new Response(swJs, {
        headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
      });
    }

    // Proxy everything else
    const upstreamUrl = new URL(url.pathname + url.search, BACKEND_ORIGIN);
    const upstreamReq = new Request(upstreamUrl, request);
    upstreamReq.headers.set('X-Proxy-By', 'cloudflare-worker');

    return fetch(upstreamReq);
  }
};
