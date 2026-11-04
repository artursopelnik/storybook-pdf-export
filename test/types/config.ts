import { defineConfig, exportPdf, templates } from 'storybook-pdf-export';
export default defineConfig({
  title: 'x', theme: { accentColor: '#000', logo: './l.svg' }, mode: 'docs',
  templates: { footer: (ctx) => `${ctx.pageNumber}/${ctx.total} ${ctx.section ?? ''}`, toc: (ctx) => ctx.items.map((i) => i.label).join(), css: '' },
  hooks: { beforeRender: async ({ page }) => { await page.title(); }, beforeSave: ({ doc }) => { doc.setKeywords([]); } },
});
const r = await exportPdf({ source: 'x' }); r.failed[0]?.error.message; templates.footer;

// @ts-expect-error unknown mode
defineConfig({ mode: 'everything' });
// @ts-expect-error hooks must be functions
defineConfig({ hooks: { beforeSave: 'x' } });
