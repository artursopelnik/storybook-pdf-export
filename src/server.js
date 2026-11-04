import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { MIME } from './util.js';

/**
 * Serves a static Storybook build on a random local port.
 * Storybook's iframe cannot be loaded from file:// (ES modules, fetch of
 * index.json), so a tiny HTTP server is needed. It only listens on 127.0.0.1,
 * on a random free port unless `port` is given (some company setups only let
 * the browser reach certain local ports).
 */
export async function serveStatic(dir, { port = 0 } = {}) {
  const root = resolve(dir);

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      const file = normalize(join(root, pathname));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }

      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch {
      // Malformed URI escapes and similar end up here.
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });

  await new Promise((ok, fail) => {
    server.once('error', (err) =>
      fail(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Pick another --port, or leave it out for a random one.`) : err),
    );
    server.listen(port, '127.0.0.1', ok);
  });

  const { port: actual } = server.address();
  return {
    url: `http://127.0.0.1:${actual}/`,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}
