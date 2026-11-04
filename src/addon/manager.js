import React, { useEffect, useState } from 'react';
import { addons, types } from 'storybook/manager-api';
import { IconButton } from 'storybook/internal/components';

const ADDON_ID = 'storybook-pdf-export';
const config = window.__STORYBOOK_PDF_EXPORT__ ?? { pdfUrl: 'storybook.pdf' };

const h = React.createElement;

const PrinterIcon = () =>
  h(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M6 9V2h12v7' }),
    h('path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }),
    h('rect', { x: 6, y: 14, width: 12, height: 8 }),
  );

const DownloadIcon = () =>
  h(
    'svg',
    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M12 3v12' }),
    h('path', { d: 'm7 10 5 5 5-5' }),
    h('path', { d: 'M5 21h14' }),
  );

/** Prints the current docs page / story. The preview already contains print.css. */
function printPreview() {
  const frame = document.getElementById('storybook-preview-iframe');
  if (frame?.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } else {
    window.print();
  }
}

/** Only show the download button if the PDF was actually exported into the build. */
function usePdfAvailable(url) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { method: 'HEAD' })
      // Some hosts answer unknown paths with their index.html (SPA fallback), so a
      // 200 alone is not enough. Some serve PDFs as application/octet-stream.
      .then((r) => alive && setOk(r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return ok;
}

function Tool() {
  const pdfAvailable = usePdfAvailable(config.pdfUrl);
  return h(
    React.Fragment,
    null,
    h(IconButton, { key: 'print', title: 'Print this page', onClick: printPreview }, h(PrinterIcon)),
    pdfAvailable &&
      h(
        IconButton,
        { key: 'pdf', as: 'a', href: config.pdfUrl, download: '', target: '_blank', title: 'Download the whole Storybook as PDF' },
        h(DownloadIcon),
      ),
  );
}

addons.register(ADDON_ID, () => {
  addons.add(`${ADDON_ID}/tool`, {
    type: types.TOOL,
    title: 'PDF export',
    match: ({ viewMode }) => viewMode === 'docs' || viewMode === 'story',
    render: Tool,
  });
});
