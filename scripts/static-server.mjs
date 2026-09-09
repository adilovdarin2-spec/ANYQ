/**
 * Serves one built front end. Shared by all three, because it was three copies.
 *
 * `apps/pos/server.js`, `apps/admin/server.js` and `apps/orders/server.js` were
 * identical but for a port number, a log line and a comment — so every fix below
 * would have had to be made three times, and the one that matters most is the
 * kind nobody makes twice.
 *
 * What it does beyond reading files off disk:
 *
 *   - **Cache headers, per kind of file.** Without them a browser applies its own
 *     heuristic, and the file that must never be cached is `index.html`: it names
 *     the hashed bundles, and a deploy deletes the old ones. A till holding a
 *     stale index.html asks for a script that is no longer there and shows
 *     nothing at all. Meanwhile the hashed bundles themselves can be kept
 *     forever, which is the whole point of hashing them.
 *   - **gzip.** The register is 434 kB of JavaScript and 125 kB compressed, and
 *     this product's entire premise is shops on connections that drop. Sending
 *     three times more bytes than necessary over one of them is a choice.
 *   - **404 for a missing asset.** The SPA fallback is right for a route and
 *     wrong for a file: answering a request for `/assets/old-hash.js` with
 *     index.html gives the browser HTML where it expected a script, and a parse
 *     error where it could have had a clear 404.
 */

import { createReadStream, existsSync, promises as fsp } from 'node:fs';
import { createGzip } from 'node:zlib';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Worth compressing. Images and fonts are already compressed; gzip costs and gains nothing. */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

/**
 * How long each kind of file may be reused.
 *
 * The two that must revalidate every time are `index.html` and `sw.js`. The
 * first names the bundles; the second decides what the app does when the network
 * is gone, and a service worker a week out of date is a register behaving like
 * last week's build.
 */
function cacheControl(urlPath, ext) {
  if (urlPath === '/' || ext === '.html') return 'no-cache';
  if (urlPath === '/sw.js') return 'no-cache';
  // Vite puts a content hash in the name, so the bytes behind one of these names
  // never change. `immutable` stops a browser revalidating on every load.
  if (urlPath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  // The manifest and icons change rarely and are not named by hash. An hour is
  // short enough that a changed icon appears the same day.
  return 'public, max-age=3600';
}

/** A request for a page, as opposed to a request for a file. */
function isNavigation(req, ext) {
  if (ext !== '') return false;
  return (req.headers.accept ?? '').includes('text/html');
}

export function serveStatic({ name, rootDir, defaultPort, frameAncestors = 'DENY' }) {
  const DIST_DIR = path.join(rootDir, 'dist');
  const PORT = process.env.PORT || defaultPort;

  if (!existsSync(DIST_DIR)) {
    // Said now, loudly, rather than answering 404 to everything. A service that
    // starts and serves nothing looks healthy to a platform health check.
    console.error(`${name}: ${DIST_DIR} does not exist — the build did not run, or ran somewhere else.`);
    process.exit(1);
  }

  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': frameAncestors,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...securityHeaders });
      res.end();
      return;
    }

    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(DIST_DIR, urlPath);

    // Compared with the separator appended: a bare `startsWith(DIST_DIR)` also
    // accepts a sibling directory whose name merely begins with it.
    if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
      res.writeHead(403, securityHeaders);
      res.end('Forbidden');
      return;
    }

    let ext = path.extname(filePath);
    let stats = await fsp.stat(filePath).catch(() => null);

    if (!stats?.isFile()) {
      if (!isNavigation(req, ext) && urlPath !== '/') {
        // A file that is not there is a 404, not the index page wearing its
        // content type.
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders });
        res.end('Not found');
        return;
      }
      filePath = path.join(DIST_DIR, 'index.html');
      ext = '.html';
      stats = await fsp.stat(filePath).catch(() => null);
      if (!stats?.isFile()) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders });
        res.end('index.html is missing from the build');
        return;
      }
    }

    const wantsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
    const compress = wantsGzip && COMPRESSIBLE.has(ext);

    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl(urlPath, ext),
      // Said even when this response is not compressed: a cache that stored the
      // plain copy must not hand it to a client that asked for gzip, or the
      // other way round.
      Vary: 'Accept-Encoding',
      ...securityHeaders,
    };
    if (compress) headers['Content-Encoding'] = 'gzip';
    // Only when the length is actually known. A gzipped stream's length is not.
    else headers['Content-Length'] = String(stats.size);

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    try {
      if (compress) await pipeline(createReadStream(filePath), createGzip(), res);
      else await pipeline(createReadStream(filePath), res);
    } catch (err) {
      // A client that closed the tab mid-download is not an error worth logging
      // on a till; anything else is.
      if (err?.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err?.code !== 'EPIPE') {
        console.error(`${name}: failed serving ${urlPath}:`, err?.message ?? err);
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ANYQ ${name} static server listening on http://0.0.0.0:${PORT}`);
  });

  return server;
}
