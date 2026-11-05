# storybook-pdf-export

<p align="center">
  <a href="https://www.npmjs.com/package/storybook-pdf-export"><img src="https://img.shields.io/npm/v/storybook-pdf-export?color=ff4785" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Storybook-8_|_9_|_10-ff4785?logo=storybook&logoColor=white" alt="Storybook 8, 9, 10">
  <img src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node 20+">
  <img src="https://img.shields.io/badge/Runs-Locally-green" alt="Runs locally">
  <img src="https://img.shields.io/badge/No_Cloud-Required-green" alt="No cloud required">
  <img src="https://img.shields.io/badge/Corporate_Design-Templates_%26_Hooks-0b5fff" alt="Templates and hooks">
  <img src="https://img.shields.io/badge/Works_in-Claude_Code-D97757?logo=claude&logoColor=white" alt="Works in Claude Code">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License"></a>
</p>

<p align="center">
  <b>Your whole Storybook as one PDF.</b><br>
  Cover, table of contents, bookmarks, page numbers and working links, in your corporate design.<br>
  One command. Runs locally. Works with any Storybook build.
</p>

<p align="center">
  <img src="docs/preview.png" alt="Cover, table of contents and docs pages of an exported Storybook" width="100%">
</p>

<p align="center">
  Built by <a href="https://github.com/artursopelnik"><b>Artur Sopelnik</b></a>
</p>

---

## What is this?

Storybook and Chromatic **don't have a built-in way to export a whole Storybook or design system as a PDF.** Hitting <kbd>Ctrl</kbd>+<kbd>P</kbd> prints one page at a time, and the result is missing parts, cut off, or looks like a screenshot of a web app.

Still, a PDF is often exactly what people need:

> "Can you send the design system documentation to the agency?"
> "Legal needs a frozen copy of the component guidelines for release 3.2."
> "I want to read the docs on paper and mark them up."
> "Attach the UI specs to the tender."

**storybook-pdf-export** turns your Storybook into one clean, navigable PDF:

```bash
npx storybook-pdf-export ./storybook-static -o design-system.pdf
```

That's it. Every docs page (MDX and autodocs) ends up in the file, in sidebar order, with:

- 📘 a **cover page** and a **table of contents** with clickable page numbers
- 🔖 **PDF bookmarks** that mirror your Storybook sidebar
- 🔗 **working links**: `[Button](?path=/docs/button--docs)` in your MDX jumps to the right page in the PDF
- 🔢 **page numbers** and the current section in the footer
- 🖨️ a **print stylesheet** for Storybook's docs blocks: readable type, code that doesn't get cut off, stories that don't break across pages, and no zoom buttons or "Copy code" chrome
- 🎨 **your corporate design**: colors, fonts, logo, your own cover, header, footer and back page

---

## Quick start

No install, no addon, no config. In your project folder:

```bash
npx storybook-pdf-export
```

That's it. If there is no `storybook-static` yet, the tool runs `storybook build` for you in a temporary folder, exports the PDF, and cleans up. Nothing is added to your project, no `package.json` change, no Storybook addon to register. The browser it needs is the Google Chrome or Microsoft Edge you already have (see [Browser](#browser)).

```bash
npx storybook-pdf-export ./storybook-static -o design-system.pdf   # an existing build
npx storybook-pdf-export http://localhost:6006 -o docs.pdf          # a served Storybook (static build is fastest)
npx storybook-pdf-export https://design.acme.com/storybook/         # a deployed one
```

### Want it in your project?

Only if you want to pin the version or run it in CI:

```bash
npm i -D storybook-pdf-export
```

```json
{
  "scripts": {
    "storybook:pdf": "storybook-pdf-export -o storybook.pdf"
  }
}
```

The [Storybook addon](#addon-optional-print-button-and-pdf-download-in-storybook) is a separate, optional extra for a print button and a download button in Storybook's toolbar. The export doesn't need it.

### Browser

PDFs are printed by a Chromium-based browser. By default (`--browser auto`) the tool takes the first one it finds:

1. Playwright's own Chromium, if you installed it (`npx playwright-core install chromium`)
2. **Google Chrome**
3. **Microsoft Edge**

So on most machines nothing needs to be installed, including company machines where only Edge is allowed. To choose explicitly:

```bash
npx storybook-pdf-export --browser msedge                     # installed Edge
npx storybook-pdf-export --browser chrome                     # installed Chrome
npx storybook-pdf-export --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

The same works as `browser` / `browserPath` in the config file, or with the environment variables `STORYBOOK_PDF_BROWSER` and `STORYBOOK_PDF_BROWSER_PATH`, which is handy in CI. Pre-release channels like `chrome-beta` or `msedge-dev` work too. Firefox and Safari can't be used, because only Chromium can print a page to PDF this way.

#### Every page times out on a company machine?

To read a static build, the tool serves it on `http://127.0.0.1:<random port>`. On company machines, browser policies, a proxy or security software sometimes block or stall that address (this has nothing to do with the browser version), so every page runs into the timeout and the export ends with "Nothing could be rendered". First try a fixed port, as some setups only allow certain ports:

```bash
npx storybook-pdf-export --browser msedge --port 6006
```

If that doesn't help either, serve the build yourself and pass the URL:

```bash
npx http-server storybook-static -p 6006 -c-1                 # terminal 1
npx storybook-pdf-export http://localhost:6006 --browser msedge  # terminal 2
```

Use a static build here (`storybook build`), not the dev server (`storybook dev`): the dev server compiles each page on request and is far too slow for exporting many pages.

### Let your AI set it up

Using **Claude Code** or **Cursor**? Open your project and say:

> "Export our Storybook as a PDF with npx storybook-pdf-export."

> "Add storybook-pdf-export to this project: export the PDF after every Storybook build into storybook-static, and add the addon so there's a download button in the toolbar."

> "Create a storybook-pdf.config.js in our corporate design: logo from ./brand/logo.svg, primary color #0b5fff, font Inter, footer 'Internal · © ACME'."

Everything here is plain config and CLI flags, so an assistant can wire it up from this README.

---

## Ctrl+P vs Chromatic vs storybook-pdf-export

|                                        | Browser print (Ctrl+P) | Chromatic        | **storybook-pdf-export** |
| -------------------------------------- | :--------------------: | :--------------: | :----------------------: |
| Whole Storybook in one file            | ✗ one page at a time   | ✗ no PDF export  | **✓**                    |
| Table of contents + bookmarks          | ✗                      | ✗                | **✓**                    |
| Links between docs pages work          | ✗                      | ✗                | **✓**                    |
| Print-optimized docs blocks            | ✗                      | ✗                | **✓**                    |
| Corporate design (cover, header, footer) | ✗                    | ✗                | **✓**                    |
| Runs locally / in CI, no account       | ✓                      | ✗ cloud service  | **✓**                    |

---

## Corporate design: themes, templates and hooks

The PDF should look like *your* document, not like ours. Customization has three levels, and you can use as much or as little as you want. Put everything in a **`storybook-pdf.config.js`** in your project root. The CLI picks it up automatically, or you pass `--config path`.

### Cover title and subtitle

The cover shows a title, a subtitle and a meta line (version, date). On the command line:

```bash
npx storybook-pdf-export --title "My Design System" --subtitle "Storybook documentation"
```

Or once in `storybook-pdf.config.js`, then a plain `npx storybook-pdf-export` is enough:

```js
import { defineConfig } from 'storybook-pdf-export';

export default defineConfig({
  title: 'My Design System',
  subtitle: 'Storybook documentation',
  author: 'Design System Team',   // PDF metadata
  version: '2.4.0',               // meta line on the cover
});
```

Without `title`, the `name` from the `package.json` next to the build is used, and `version` comes from there too. When the source is a URL there is no `package.json` to read, so the title falls back to "Storybook": set `title` in that case. The title is also the PDF's document title.

### 1. Theme: colors, fonts, logo

Usually enough:

```js
// storybook-pdf.config.js
import { defineConfig } from 'storybook-pdf-export';

export default defineConfig({
  title: 'ACME Design System',
  subtitle: 'Components & Guidelines',
  theme: {
    accentColor: '#0b5fff',
    fontCss: "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');",
    fontFamily: 'Inter, Arial, sans-serif',
    logo: './brand/logo.svg',   // svg, png, jpg, webp; relative to the config file
    locale: 'de-DE',            // date format on the cover
  },
});
```

| theme key     | default             | used for                                            |
| ------------- | ------------------- | --------------------------------------------------- |
| `accentColor` | `#ff4785`           | Cover bar, TOC headings → `var(--pdf-accent)`        |
| `textColor`   | `#1b1b1b`           | Text of generated pages → `var(--pdf-text)`          |
| `mutedColor`  | `#73777b`           | Footer, meta lines → `var(--pdf-muted)`              |
| `fontFamily`  | Nunito Sans, system | Generated pages → `var(--pdf-font)`                  |
| `fontCss`     | –                   | `@import` / `@font-face` for your web fonts          |
| `logo`        | –                   | Cover and header (inlined as data URI)               |
| `locale`      | `en-GB`             | Date on the cover                                    |

### 2. Templates: your own HTML

The cover, table of contents, running header and footer, and an optional back page are **plain functions that return HTML**. Override the ones you want. Return `''` to leave something out.

```js
export default defineConfig({
  templates: {
    // Extra CSS for all generated pages
    css: `.running.header { border-bottom: 0.5pt solid #d0d3d6; padding-bottom: 2mm; }`,

    // Logo + current component at the top of every content page
    header: (ctx) => ctx.kind === 'content'
      ? `<div class="running header"><img src="${ctx.logo}"><span>${ctx.esc(ctx.section)}</span></div>`
      : '',

    // ctx.kind is 'cover' | 'toc' | 'content' | 'back'
    footer: (ctx) => ctx.kind === 'cover' ? '' :
      `<div class="running footer"><span>Internal · © ACME GmbH</span><span>Seite ${ctx.pageNumber} von ${ctx.total}</span></div>`,

    // Imprint / contact as the last page
    back: (ctx) => `<section style="padding-top:200mm"><img src="${ctx.logo}" style="height:12mm"><p>ACME GmbH · design@acme.example</p></section>`,

    // cover: (ctx) => `...`,
    // toc:   (ctx) => `...`,   // ctx.tree / ctx.items: [{ label, depth, page, href, children }]
  },
});
```

**What templates get (`ctx`):** `title`, `subtitle`, `author`, `version` (from your package.json), `date`, `dateText`, `logo`, `theme`, `entries`, `esc()` for HTML escaping.
Header and footer also get `kind`, `pageNumber`, `total`, `section` and `entry`. The TOC gets `tree` and `items`, and each `href` becomes an internal PDF link.

Header and footer are rendered by Chromium and laid over each page, so **web fonts, SVG logos and any CSS** work there too. Want to start from the defaults? `import { templates } from 'storybook-pdf-export'`.

**The cover can't break anything.** The default cover is deliberately calm: white page, your logo in its original colors, a short accent line, title, subtitle, and a meta line at the bottom. Long titles wrap and get a smaller size, and oversized logos are limited to 60 × 16 mm. The cover always has exactly one sheet. It is rendered without page margins (so a full-bleed background works if you want one), and if a custom cover template produces more than one page, only the first is used and you get a warning. The rest of the PDF is never affected.

### 3. Hooks: step into the pipeline

```js
export default defineConfig({
  hooks: {
    // Reorder / filter pages: (entries, fullIndex) => entries
    filterEntries: (entries) => entries.filter((e) => !e.title.startsWith('Deprecated')),

    // Playwright page, after Storybook rendered, before printing
    beforeRender: async ({ page, entry }) => {
      await page.addStyleTag({ content: '.sbdocs h1 { color: #0b5fff !important; }' });
    },

    // Raw PDF bytes of one entry: return new bytes to replace them
    afterRender: async ({ entry, pdf }) => pdf,

    // Final pdf-lib document: watermarks, attachments, metadata, …
    beforeSave: async ({ doc, PDFLib, entries, startPages }) => {
      doc.setKeywords(['design system']);
    },
  },
});
```

Paths in the config file (`source`, `output`, `css`, `theme.logo`) are relative to the config file. Paths on the command line are relative to the working directory. Typos in option, theme, template or hook names are reported as warnings. The package ships TypeScript types, so `defineConfig` gives you autocompletion in VS Code even in a plain `.js` config.

A complete example lives in [`examples/corporate`](examples/corporate/storybook-pdf.config.js). It produced the PDF in the preview above.

---

## Addon (optional): print button and PDF download in Storybook

Not needed for the export. Add it if readers of your Storybook should get the PDF right there. It needs the package as a dev dependency (`npm i -D storybook-pdf-export`).

Make the PDF available right where people read your docs:

```js
// .storybook/main.js
export default {
  addons: [
    '@storybook/addon-docs',
    { name: 'storybook-pdf-export', options: { pdfUrl: 'storybook.pdf' } },
  ],
};
```

```json
{
  "scripts": {
    "build-storybook": "storybook build && storybook-pdf-export storybook-static -o storybook-static/storybook.pdf"
  }
}
```

The toolbar gets two buttons:

- 🖨️ **Print this page.** Prints the current docs page with the print stylesheet.
- ⬇️ **Download PDF.** Only shown when the PDF actually exists in the deployed build.

| option     | default           | description                                         |
| ---------- | ----------------- | --------------------------------------------------- |
| `pdfUrl`   | `"storybook.pdf"` | Location of the PDF, relative to the Storybook root |
| `printCss` | `true`            | Inject the print stylesheet into the preview        |

---

## The print stylesheet

`print.css` is used for the export and for the toolbar's print button. It follows the ideas from [“Websites Should Be Printable”](https://brennenputh.me/blog/printable-websites/) and applies them to Storybook's docs blocks:

- **Fixed point sizes** (11pt body, 20/15/13pt headings) instead of screen-relative sizes
- **Black, underlined links.** External links get their URL printed after them, because paper can't be clicked.
- **Code blocks** stay in one piece when they fit on a page, and long lines wrap instead of being cut off
- **Story previews, table rows and images** never split across pages, and headings are never left alone at the bottom of a page
- **Scroll containers are made printable** (see below)
- **Interactive chrome hidden:** zoom toolbar, "Copy code", the controls column of the ArgTypes table
- **Colors kept** (`print-color-adjust: exact`), so color swatches and token tables survive

Utility classes for your MDX and components:

| class               | effect                          |
| ------------------- | ------------------------------- |
| `.sb-no-print`      | Hidden in print / PDF           |
| `.sb-print-only`    | Only visible in print / PDF     |
| `.sb-page-break`    | Starts a new page               |
| `.sb-keep-together` | Never split across pages        |
| `.sb-print-no-fit`  | Leave this scroll container / table exactly as it is |

```mdx
<div className="sb-print-only">
  Printed version. For the latest docs see design.acme.com.
</div>
```

Add your own rules with `--css my-print.css` (or `css: [...]` in the config).

---

### Tables and scroll containers

Docs often wrap wide tables (tokens, props, browser support) in a box with `overflow-x: auto`, or long lists in a box with a fixed height. Paper can't scroll, so a plain print cuts everything off that isn't visible.

Before printing, every page is laid out at the real printable width (A4 minus margins ≈ 178 mm) and each scroll container is handled like this:

| situation | what happens |
| --- | --- |
| box with fixed height and vertical scrolling | expanded, so every row is printed; long tables continue on the next page with the header row repeated |
| box with horizontal scrolling | opened up |
| content still wider than the page (that box, or any wide table) | made to fit, gentlest step first, stopping as soon as it fits: **1.** let cells wrap at spaces, **2.** allow breaks after `.` `/` `-` `_` `:` in values like `color.primary.default`, `--color-primary-default` or `Color/primary/Default` (version numbers like `1.0.0` stay together), **3.** scale only this element down, never below 65 %, **4.** as a last resort, break cell content anywhere |

Nothing is cut off, and the rest of the page keeps its size. The toolbar's print button does the same and restores the page afterwards. For tables that are really wide, `--landscape` gives them more room.

### Tabs

Paper can't click, so tab sets would only show the active tab. Before printing, every tab set with the usual ARIA roles (`role="tablist"`, `role="tab"`, `role="tabpanel"`) is expanded: all tabs are printed one after another, in tab order, each under its label, and the tab bar is hidden. Disabled tabs are skipped.

Web components often render after Storybook reports the page as rendered, so the export first waits (bounded) until custom elements are defined and the DOM, including open shadow roots, has stopped changing. After expanding, it waits again for images and fonts in the revealed panels.

It works with the common ways tabs are built:

| tab component | what happens |
| --- | --- |
| **Web components / Shadow DOM** (Lit, Stencil, your own `<x-tabs>`): tabs and panels inside an open shadow root, or panels in light-DOM hosts (`<x-tab-panel>`) whose own shadow root holds the `role="tabpanel"` and a slot | found by walking the composed tree (open shadow roots, slots); inactive panels (`hidden` or hidden by the component's CSS) are revealed in place, keeping slots, content and styles |
| **Light DOM panels slotted** into a web component (`<div slot="panel" role="tabpanel">`) | revealed in place; the label goes into the same slot |
| **All panels in the DOM**, inactive ones `hidden` (Radix, Headless UI, plain HTML) | revealed in place |
| **Only the active panel is rendered** (most React tab components) | each tab is clicked in turn and its content copied as rendered, including content of shadow roots and slots |
| **Nested tab sets** | expanded once their parent panel is visible |

Each tab list is matched only to its own panels: through `aria-controls` when every tab points to a panel in its own document or shadow root, otherwise by order among the panels of its tab set, leaving out nested tab sets and their panels.

- Turn it off with `--no-expand-tabs` (or `expandTabs: false`), or for one tab set with the class `sb-print-no-fit` on it or on a parent (also on the host element of a web component).
- Restyle the labels with your own `--css`: `.sb-pdf-tab-label` (label), `.sb-pdf-tab` / `.sb-pdf-tabs` (copied tabs). Labels inside a shadow root get their styles injected there, as page CSS doesn't reach into shadow roots.
- Tab sets that can't be expanded (a tab doesn't react to clicks, or renders an empty panel) are reported as a warning; empty panels are left out instead of being printed blank.
- Not covered: tab components without ARIA roles and closed shadow roots.

### Icons with CSS masks

A common icon technique is an element with a `background-color` and an SVG as `mask-image`, so icons take the text color. Chromium prints masks with thin hairlines along the edges. So before printing, such icons are turned into the SVG itself, filled with the background color, as a sharp vector background, also inside shadow roots of web components. Nothing to do on your side; opt out with `sb-print-no-fit`. Only single-color SVG masks are converted, anything else is printed as it is.

## Choosing what goes into the PDF

| `--mode`  | what ends up in the PDF                                          |
| --------- | ---------------------------------------------------------------- |
| `auto`    | Docs pages, plus the stories of components that have no docs page (default) |
| `docs`    | Docs pages only (MDX + autodocs)                                 |
| `stories` | Each story on its own page, with a title header                  |
| `all`     | Both                                                             |

```bash
npx storybook-pdf-export -i "Components" -x "Components/Internal" --landscape
```

Filters match the story id, the title (`Components/Forms/Button`) and `title/name`. A pattern also covers everything below it. To keep single stories or whole components out of the PDF, tag them:

```js
export default { title: 'Playground', tags: ['no-pdf'] };
```

---

## CLI reference

```
storybook-pdf-export [source] [options]

  source              Static build directory or URL of a running Storybook (default: ./storybook-static,
                      built on the fly if missing)

  --config            Config file with theme, templates and hooks (default: ./storybook-pdf.config.js)
  -o, --output        Output file                                 (default: storybook.pdf)
  -t, --title         Title on the cover and in the PDF metadata  (default: package name)
      --subtitle      Subtitle on the cover
      --author        Author in the PDF metadata
  -m, --mode          auto | docs | stories | all                 (default: auto)
  -i, --include       Only export matching entries (glob, repeatable)
  -x, --exclude       Skip matching entries (glob, repeatable)
      --css           Extra print stylesheet (repeatable)
      --format        A4, Letter, A3, …                           (default: A4)
      --landscape
      --no-cover / --no-toc / --no-page-numbers
      --storybook-url Public Storybook URL. Links to stories not in the PDF point there.
      --browser       auto | chromium | chrome | msedge        (default: auto)
      --browser-path  Path to a Chrome / Chromium / Edge binary
      --build         Always run "storybook build" first (into a temp folder)
      --no-build      Never build; fail if there is no build
      --config-dir    Storybook config folder used for building   (default: .storybook)
      --port          Fixed port for the local server             (default: random)
      --no-expand-tabs  Print only the active tab of tab sets     (default: every tab)
  -c, --concurrency   Pages rendered in parallel                  (default: 4)
      --timeout       Per-page timeout in ms                      (default: 30000)
      --delay         Extra wait per page in ms                   (default: 0)
      --strict        Exit with an error if any page fails to render
  -q, --quiet
```

CLI flags override the config file.

## Node API

```js
import { exportPdf } from 'storybook-pdf-export';

const { pages, entries, failed } = await exportPdf({
  source: './storybook-static',
  output: 'design-system.pdf',
  title: 'ACME Design System',
  theme: { accentColor: '#0b5fff', logo: './logo.svg' },
  templates: { footer: (ctx) => `…` },
  hooks: { beforeSave: ({ doc }) => {} },
  log: console.log,
});
```

All config file keys work here too. Pass `output: null` to get the bytes back without writing a file.

**Links in your docs**

| link in your MDX / docs                      | in the PDF                                                       |
| -------------------------------------------- | ---------------------------------------------------------------- |
| to a docs page or story that is in the PDF    | jumps to its page                                                |
| to a story that is *not* in the PDF          | points to `--storybook-url`; without it, the link is removed, because it would point at a temporary local server |
| to an external site                          | stays a normal link, and the URL is printed after it              |

---

## How it works

1. **Serve.** The static build (or a fresh `storybook build` in a temporary folder) is served on a random local port, because Storybook can't run from `file://`.
2. **Read the index.** It reads `index.json` (or `stories.json` from Storybook 6) and keeps the entries in sidebar order.
3. **Render.** Each entry opens in `iframe.html?id=…&viewMode=docs|story` in headless Chromium (Playwright), laid out at the printable width of the paper. It waits for Storybook's `docsRendered` / `storyRendered` event, network idle, fonts and images (lazy images are loaded too), and 400 ms without DOM changes, capped at 10 s so a restless page can't hang the export. Then scroll containers and wide tables are fitted to the page, and it prints with the print stylesheet. A page that fails is reported and skipped, or fails the run with `--strict`.
4. **Assemble.** It renders the cover, TOC, back page, header and footer from your templates and merges everything with pdf-lib. TOC entries and `?path=/docs/…` links become internal jumps, and bookmarks are added.

Everything runs on your machine or in your CI. No account, no upload, no API key.

## Known limitations

- Each docs page starts on a new sheet. If a page fills its last sheet almost exactly, Chromium can add an empty page after it.
- The PDF shows each story as it looks after it rendered. Interactive states such as hover or open menus only appear if a story shows them by default.

---

## Contributing

```bash
npm install
npx playwright-core install chromium   # optional: Chrome or Edge work too

npm test             # unit tests + end-to-end tests against a fake Storybook build
npm run test:smoke   # builds a real Storybook 10 (test/fixtures/storybook) and checks the export
npm run test:types   # type definitions
```

The end-to-end tests are skipped locally when no browser is available (they never are on CI). Without Playwright's Chromium they use your installed Chrome or Edge. To use a specific binary, set `STORYBOOK_PDF_BROWSER_PATH=/path/to/chrome`.

CI runs the tests on Node 20, 22 and 24 on Linux, plus Windows and macOS, once without Playwright's Chromium (falling back to the runner's Google Chrome), along with the smoke test, the type check and a package dry-run.

Issues and pull requests are welcome.

## License

MIT © [Artur Sopelnik](https://github.com/artursopelnik)
