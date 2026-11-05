/**
 * Minimal text extraction for the PDFs Chromium prints, for tests only:
 * decodes the text-showing operators of every page (and form XObjects) with
 * the fonts' ToUnicode CMaps. Returns the text per page in paint order, which
 * for printed HTML is document order.
 */
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';

const bytesOf = (stream) => {
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const names = filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
  if (names.some((n) => n !== '/FlateDecode')) throw new Error(`unsupported filter ${names}`);
  return names.length ? inflateSync(stream.contents) : Buffer.from(stream.contents);
};

const utf16 = (hex) => {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

/** ToUnicode CMap → { width (hex digits per code), map: hex code → text }. */
function parseCMap(text) {
  const map = new Map();
  let width = 4;
  for (const [, body] of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of body.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      width = src.length;
      map.set(src.toLowerCase(), utf16(dst));
    }
  }
  for (const [, body] of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of body.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      width = lo.length;
      const from = parseInt(lo, 16);
      const to = parseInt(hi, 16);
      const list = rest.startsWith('[') ? [...rest.matchAll(/<([0-9a-f]*)>/gi)].map((m) => m[1]) : null;
      for (let code = from; code <= to; code++) {
        const key = code.toString(16).padStart(lo.length, '0');
        if (list) map.set(key, utf16(list[code - from] ?? ''));
        else {
          const base = parseInt(rest.slice(-5, -1), 16);
          map.set(key, utf16(rest.slice(1, -5)) + String.fromCharCode(base + code - from));
        }
      }
    }
  }
  return { width, map };
}

const TOKEN = /\/[^\s/[\]()<>]+|<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|\[|\]|[^\s/[\]()<>]+/g;

function textOf(content, resources, cmaps, out) {
  const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  const cmapOf = (name) => {
    const font = fonts?.lookupMaybe(PDFName.of(name.slice(1)), PDFDict);
    if (!font) return null;
    if (!cmaps.has(font)) {
      const stream = font.lookupMaybe(PDFName.of('ToUnicode'), PDFRawStream);
      cmaps.set(font, stream ? parseCMap(bytesOf(stream).toString('latin1')) : null);
    }
    return cmaps.get(font);
  };
  const decode = (token, cmap) => {
    if (!cmap) return '';
    const hex = token.startsWith('<')
      ? token.slice(1, -1).replace(/\s/g, '').toLowerCase()
      : Buffer.from(token.slice(1, -1).replace(/\\(.)/g, '$1'), 'latin1').toString('hex');
    let s = '';
    for (let i = 0; i < hex.length; i += cmap.width) s += cmap.map.get(hex.slice(i, i + cmap.width)) ?? '';
    return s;
  };

  let cmap = null;
  let operands = [];
  let array = null;
  for (const [token] of content.matchAll(TOKEN)) {
    if (token === '[') array = [];
    else if (token === ']') { operands.push(array); array = null; }
    else if (array) array.push(token);
    else if (/^[/<(]|^[-+.\d]/.test(token)) operands.push(token);
    else {
      if (token === 'Tf') cmap = cmapOf(operands.at(-2));
      else if (token === 'Tj' || token === "'" || token === '"') out.push(decode(operands.at(-1), cmap));
      else if (token === 'TJ') out.push((operands.at(-1) ?? []).map((t) => (/^[<(]/.test(t) ? decode(t, cmap) : Number(t) < -200 ? ' ' : '')).join(''));
      else if (token === 'ET') out.push('\n');
      else if (token === 'Do') {
        const form = xobjects?.lookupMaybe(PDFName.of(operands.at(-1).slice(1)), PDFRawStream);
        if (form && String(form.dict.get(PDFName.of('Subtype'))) === '/Form') {
          textOf(bytesOf(form).toString('latin1'), form.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources, cmaps, out);
        }
      }
      operands = [];
    }
  }
}

/** @returns {Promise<string[]>} text of every page */
export async function pdfText(bytes) {
  const doc = await PDFDocument.load(bytes);
  const cmaps = new Map();
  return doc.getPages().map((page) => {
    const out = [];
    const contents = page.node.lookup(PDFName.of('Contents'));
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const content = streams.map((s) => bytesOf(s).toString('latin1')).join('\n');
    textOf(content, page.node.Resources(), cmaps, out);
    return out.join('');
  });
}
