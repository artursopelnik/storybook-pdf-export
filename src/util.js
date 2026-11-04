import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Content types for the static server and for inlined logos. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

export const NO_MARGIN = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export const isUrl = (source) => /^https?:\/\//i.test(String(source));

/** First line of an error message, for compact logs. */
export const firstLine = (err) => String(err?.message ?? err).split('\n')[0];

/** "Components/Forms/Button" → "Components › Forms › Button" */
export const formatTitle = (title) => title.split('/').map((s) => s.trim()).join(' › ');

/** "Components › Forms › Button › Primary" */
export const entryLabel = (entry) => `${formatTitle(entry.title)} › ${entry.name}`;

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * package.json of the project that owns a static build. storybook-static
 * usually lives next to it, so look there first, then in the working directory.
 */
export async function readProjectPackage(source) {
  if (isUrl(source)) return {};
  for (const dir of [resolve(source, '..'), resolve(source), process.cwd()]) {
    try {
      return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    } catch {}
  }
  return {};
}
