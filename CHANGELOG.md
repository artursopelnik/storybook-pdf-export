# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-11-06

First stable release. Everything from the 0.1.0 alphas, with a settled public API.

### Export

- One command: `npx storybook-pdf-export` exports a static build, a running
  Storybook (URL), or builds the project's Storybook on the fly into a
  temporary folder (`--build`, `--no-build`, `--config-dir`).
- Cover, table of contents with page numbers and links, PDF bookmarks in
  sidebar order, running header / footer with page numbers, optional back page.
- Entries in Storybook's sidebar order. Modes `auto`, `docs`, `stories`, `all`;
  `--include` / `--exclude` globs; `no-pdf` / `!pdf` tags.
- Links to other stories become internal PDF links; links to stories outside
  the PDF point to `--storybook-url` or are made non-clickable.
- Uses Playwright's Chromium, an installed Google Chrome or Microsoft Edge
  (`--browser`, `--browser-path`, `STORYBOOK_PDF_BROWSER`, `STORYBOOK_PDF_BROWSER_PATH`).
- Fixed `--port` for the local server, for locked-down company machines.

### Print quality

- Pages are laid out at the printable width of the paper.
- Scroll containers are expanded; wide tables and boxes are fitted gentlest
  step first (wrap, break after separators, scale, break anywhere).
- Tab sets (`role="tablist"`) print every tab under its label, including web
  components with shadow DOM and slots, nested and late-hydrating tab sets.
- Single-colour SVG mask icons are printed as clean vectors (no hairlines).
- Waits for Storybook's render events, web component hydration, fonts, images
  and a quiet DOM, bounded in time so a restless page can't hang the export.

### Corporate design

- Theme (colours, fonts, logo, locale), template functions for cover, TOC,
  header, footer and back page, template CSS, extra print stylesheets.
- Hooks: `filterEntries`, `beforeRender`, `afterRender`, `beforeSave`.
- Optional Storybook addon: print button and PDF download in the toolbar.

### Breaking changes since 0.1.0-alpha.4

- Removed the `chromium` option, the `--chromium` flag and the
  `STORYBOOK_PDF_CHROMIUM` variable. Use `browserPath`, `--browser-path` and
  `STORYBOOK_PDF_BROWSER_PATH`.
- The `templates` export now holds only the default templates
  (`cover`, `toc`, `header`, `footer`, `back`, `css`) plus `DEFAULT_THEME` and
  `BASE_CSS`, as documented in the typings, instead of internal helpers.
