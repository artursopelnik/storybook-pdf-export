/**
 * Default templates for the generated pages (cover, table of contents,
 * header / footer, back page) and the theme that styles them.
 *
 * Every template is a plain function `(ctx) => html string`. Override any of
 * them through the `templates` option (or `storybook-pdf.config.js`) to match
 * your corporate design. Return an empty string to leave something out.
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { MIME } from './util.js';

/** Marker URL used in the TOC, rewritten into internal PDF links afterwards. */
export const PAGE_LINK = 'https://storybook-pdf-export.invalid/page/';

export const DEFAULT_THEME = {
  /** Brand / accent colour (cover bar, TOC top level). */
  accentColor: '#ff4785',
  textColor: '#1b1b1b',
  mutedColor: '#73777b',
  /** Font stack for the generated pages. Load web fonts via `fontCss`. */
  fontFamily: '"Nunito Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  /** Extra CSS, e.g. `@import url(https://fonts.googleapis.com/css2?family=Inter)` or @font-face rules. */
  fontCss: '',
  /** Path or URL of a logo (SVG, PNG, JPG). Shown on the cover and in the header. */
  logo: null,
  /** Locale for the date on the cover. */
  locale: 'en-GB',
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Local logo files are inlined as data URIs so the templates stay self-contained. */
export async function resolveLogo(logo, cwd = process.cwd()) {
  if (!logo || /^(https?:|data:)/i.test(logo)) return logo ?? null;
  const file = resolve(cwd, logo);
  const type = MIME[extname(file).toLowerCase()];
  if (!type?.startsWith('image/')) throw new Error(`Unsupported logo format: ${logo} (use svg, png, jpg, webp or gif)`);
  return `data:${type};base64,${(await readFile(file)).toString('base64')}`;
}

/** CSS custom properties every template can use: var(--pdf-accent) etc. */
export function themeCss(theme) {
  return `
${theme.fontCss ?? ''}
:root {
  --pdf-accent: ${theme.accentColor};
  --pdf-text: ${theme.textColor};
  --pdf-muted: ${theme.mutedColor};
  --pdf-font: ${theme.fontFamily};
}
html, body { margin: 0; padding: 0; }
body { font-family: var(--pdf-font); color: var(--pdf-text); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
}

export const BASE_CSS = `
  /* The cover is rendered without page margins: position: fixed + inset: 0 fills the whole sheet. */
  .cover { position: fixed; inset: 0; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center;
           padding: var(--pdf-margin-top) var(--pdf-margin-right) var(--pdf-margin-bottom) calc(var(--pdf-margin-left) + 8mm);
           border-left: 8mm solid var(--pdf-accent); }
  .cover .logo { max-height: 22mm; max-width: 70mm; margin-bottom: 18mm; align-self: flex-start; }
  .cover h1 { font-size: 32pt; margin: 0 0 8pt; line-height: 1.1; }
  .cover p { font-size: 14pt; margin: 0; color: var(--pdf-muted); }
  .cover .meta { margin-top: 24pt; font-size: 10.5pt; color: var(--pdf-muted); }
  .toc h1 { font-size: 20pt; margin: 0 0 14pt; }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc li { break-inside: avoid; }
  .toc a { display: flex; align-items: baseline; gap: 6pt; color: inherit; text-decoration: none; font-size: 10.5pt; line-height: 1.7; }
  .toc a .dots { flex: 1; border-bottom: 1px dotted #999; transform: translateY(-3pt); }
  .toc a .num { font-variant-numeric: tabular-nums; }
  .toc .d0 > a { font-weight: 700; font-size: 11.5pt; margin-top: 8pt; color: var(--pdf-accent); }
  .toc .d0 > a .num, .toc .d0 > a .label { color: var(--pdf-text); }
  .toc .d0:first-child > a { margin-top: 0; }
  .running { position: absolute; left: var(--pdf-margin-left); right: var(--pdf-margin-right); display: flex; justify-content: space-between; align-items: center; gap: 12pt; font-size: 7.5pt; color: var(--pdf-muted); }
  .running.header { top: 7mm; }
  .running.footer { bottom: 8mm; }
  .running img { max-height: 5mm; }
`;

// ---- Default templates -------------------------------------------------------

export function cover(ctx) {
  return `<section class="cover">
    ${ctx.logo ? `<img class="logo" src="${esc(ctx.logo)}" alt="">` : ''}
    <h1>${esc(ctx.title)}</h1>
    ${ctx.subtitle ? `<p>${esc(ctx.subtitle)}</p>` : ''}
    <div class="meta">${[ctx.version && `Version ${esc(ctx.version)}`, esc(ctx.dateText), ctx.author && esc(ctx.author)].filter(Boolean).join(' · ')}</div>
  </section>`;
}

export function toc(ctx) {
  const render = (items) =>
    `<ol>${items
      .map(
        (n) =>
          `<li class="d${n.depth}"><a href="${n.href}" style="padding-left:${n.depth * 12}pt">` +
          `<span class="label">${esc(n.label)}</span><span class="dots"></span><span class="num">${n.page}</span></a>` +
          (n.children.length ? render(n.children) : '') +
          `</li>`,
      )
      .join('')}</ol>`;
  return `<section class="toc"><h1>Contents</h1>${render(ctx.tree)}</section>`;
}

/** Running header — empty by default. */
export function header() {
  return '';
}

/** Running footer: title (and current section) left, page numbers right. Not on the cover. */
export function footer(ctx) {
  if (ctx.kind === 'cover') return '';
  const left = ctx.section ? `${esc(ctx.title)} · ${esc(ctx.section)}` : esc(ctx.title);
  return `<div class="running footer"><span>${left}</span><span>${ctx.pageNumber} / ${ctx.total}</span></div>`;
}

/** Optional last page (imprint, contact, legal) — none by default. */
export function back() {
  return '';
}

export const DEFAULT_TEMPLATES = { cover, toc, header, footer, back, css: '' };

function marginVars(margin) {
  return margin
    ? `:root { --pdf-margin-top: ${margin.top}; --pdf-margin-right: ${margin.right}; --pdf-margin-bottom: ${margin.bottom}; --pdf-margin-left: ${margin.left}; }`
    : '';
}

/** Shared document shell: optional print CSS, theme variables, base and template CSS. */
function htmlDocument(body, { printCss = '', theme, templateCss = '', margin, extraCss = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${printCss}</style>
<style>${themeCss(theme)}${marginVars(margin)}</style>
<style>${BASE_CSS}</style>
<style>${templateCss}</style>
<style>${extraCss}</style>
</head><body>${body}</body></html>`;
}

/**
 * Wraps a template's body in a full HTML document with print + theme CSS.
 * `fullBleed` drops the page margins (used for the cover).
 */
export function documentHtml(body, { fullBleed = false, ...options }) {
  return htmlDocument(body, { ...options, extraCss: fullBleed ? '@page { margin: 0; }' : '' });
}

/**
 * One HTML document with one sheet per PDF page, holding the running header
 * and footer. It is rendered once and laid over the merged pages.
 */
export function overlayHtml(pages, { widthPt, heightPt, ...options }) {
  const sheets = pages.map((p) => `<div class="sheet">${p}</div>`).join('');
  return htmlDocument(sheets, {
    ...options,
    printCss: '',
    extraCss: `
      @page { size: ${widthPt}pt ${heightPt}pt; margin: 0; }
      html, body { background: transparent !important; }
      .sheet { position: relative; width: ${widthPt}pt; height: ${heightPt}pt; overflow: hidden; break-after: page; }
      .sheet:last-child { break-after: auto; }`,
  });
}
