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

/** CSS length (number = px, or "12mm", "1in", "2cm", "10pt", "8px") → CSS px at 96 dpi. */
export function toPx(value) {
  if (typeof value === 'number') return value;
  const match = /^\s*(-?[\d.]+)\s*(px|mm|cm|in|pt)?\s*$/i.exec(String(value ?? 0));
  if (!match) throw new Error(`Unsupported length "${value}". Use px, mm, cm, in or pt.`);
  const n = Number(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  return n * { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72 }[unit];
}

/** Paper sizes Playwright knows, in millimetres (width × height). */
const PAPER = {
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
  ledger: [431.8, 279.4],
  a0: [841, 1189],
  a1: [594, 841],
  a2: [420, 594],
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  a6: [105, 148],
};

/** Width of the printable area (paper minus left/right margin) in CSS px. */
export function printableWidth({ format = 'A4', landscape = false, margin = {} }) {
  const size = PAPER[String(format).toLowerCase()];
  if (!size) throw new Error(`Unknown paper format "${format}". Use one of: ${Object.keys(PAPER).map((k) => k.toUpperCase()).join(', ')}.`);
  const paper = toPx(`${landscape ? Math.max(...size) : size[0]}mm`);
  return Math.floor(paper - toPx(margin.left) - toPx(margin.right));
}
