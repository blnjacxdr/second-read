// A tiny local web server for development, using only Node's built-in modules
// (nothing to download). Serves the repo folder at http://localhost:8080.
//
// Why not open the HTML file directly? Browsers block JavaScript modules on
// pages opened from disk (file://), so the page must come from a server.
//
// Security: listens only on this computer (127.0.0.1), and refuses any path
// that tries to climb out of the repo folder (for example "/../secrets").
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', // must be a JavaScript type, or browsers refuse to load modules
  '.mjs': 'text/javascript; charset=utf-8', // pdf.js ships as .mjs
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** The Content-Type header for a file path. */
export function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Maps a URL path to a file inside `root`, or returns null if it would escape
 * the root folder. "/" and folder paths map to index.html.
 */
export function resolveSafePath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null; // malformed URL encoding
  }
  if (decoded.includes('\0')) return null;
  if (decoded.endsWith('/')) decoded += 'index.html';
  const rootDir = resolve(root);
  const full = resolve(rootDir, '.' + decoded);
  return full === rootDir || full.startsWith(rootDir + sep) ? full : null;
}

function start(root, port) {
  const server = createServer(async (request, response) => {
    const filePath = resolveSafePath(root, request.url || '/');
    if (!filePath) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = await readFile(filePath);
      // no-store: always serve the newest file, so a refresh shows your latest change
      response.writeHead(200, { 'Content-Type': contentTypeFor(filePath), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found: ${request.url}`);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Second Read dev server running at http://localhost:${port}/`);
    console.log(`Test page: http://localhost:${port}/dev/spike.html`);
    console.log('Press Ctrl+C to stop.');
  });
}

// Start only when run directly (node tools/serve.js), not when tests import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start(fileURLToPath(new URL('..', import.meta.url)), Number(process.env.PORT) || 8080);
}
