// Example: a PDF in your own corporate design.
// Copy this file to your project root as `storybook-pdf.config.js` and run
//   npx storybook-pdf-export
import { defineConfig } from 'storybook-pdf-export';

export default defineConfig({
  source: './storybook-static',
  output: './storybook-static/storybook.pdf',

  title: 'ACME Design System',
  subtitle: 'Components & Guidelines',
  author: 'ACME Design Team',
  mode: 'auto',
  exclude: ['Internal'],

  // ---- 1. Theme: colors, fonts, logo ------------------------------------
  theme: {
    accentColor: '#0b5fff',
    textColor: '#0b2a5b',
    fontCss: "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');",
    fontFamily: 'Inter, Arial, sans-serif',
    logo: './logo.svg', // relative to this file
    locale: 'de-DE',
  },

  // ---- 2. Templates: your own HTML for the generated pages --------------
  // Every template gets a context object (title, subtitle, author, version,
  // dateText, logo, theme, entries, esc, …). Return '' to leave it out.
  templates: {
    css: `
      .running.header { border-bottom: 0.5pt solid #d0d3d6; padding-bottom: 2mm; }
    `,

    // Running header: logo + current component on every content page.
    header: (ctx) =>
      ctx.kind === 'content'
        ? `<div class="running header"><img src="${ctx.logo}"><span>${ctx.esc(ctx.section)}</span></div>`
        : '',

    // Running footer: kind is 'cover' | 'toc' | 'content' | 'back'.
    footer: (ctx) =>
      ctx.kind === 'cover'
        ? ''
        : `<div class="running footer"><span>Internal · © ACME GmbH</span><span>Seite ${ctx.pageNumber} von ${ctx.total}</span></div>`,

    // Last page: imprint / contact.
    back: (ctx) => `
      <section style="padding-top: 200mm">
        <img src="${ctx.logo}" style="height: 12mm">
        <p>ACME GmbH · Musterstraße 1 · 12345 Berlin<br>design@acme.example</p>
      </section>`,

    // cover: (ctx) => `...`  and  toc: (ctx) => `...` can be replaced as well.
    // toc gets ctx.tree / ctx.items: [{ label, depth, page, href, children }].
  },

  // ---- 3. Hooks: step into the pipeline ---------------------------------
  hooks: {
    // Reorder or filter the pages: (entries, fullIndex) => entries
    filterEntries: (entries) => entries,

    // Playwright page, after Storybook rendered and before printing.
    beforeRender: async ({ page, entry }) => {
      await page.addStyleTag({ content: '.sbdocs-content h1 { color: #0b5fff !important; }' });
    },

    // Raw PDF bytes of one entry: return new bytes to replace them.
    afterRender: async ({ entry, pdf }) => pdf,

    // Final pdf-lib document: watermarks, attachments, extra metadata …
    beforeSave: async ({ doc, PDFLib }) => {
      doc.setKeywords(['design system', 'acme']);
    },
  },
});
