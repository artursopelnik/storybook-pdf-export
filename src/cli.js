#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportPdf, DEFAULTS } from './index.js';
import { isUrl } from './util.js';

const CONFIG_FILES = ['storybook-pdf.config.js', 'storybook-pdf.config.mjs'];

async function loadConfig(file) {
  const path = file ? resolve(file) : CONFIG_FILES.map((f) => resolve(f)).find(existsSync);
  if (!path) return { config: {}, path: null };
  if (!existsSync(path)) throw new Error(`Config file not found: ${path}`);
  const mod = await import(pathToFileURL(path).href);
  const config = typeof mod.default === 'function' ? await mod.default() : mod.default ?? {};
  return { config, path };
}

const HELP = `
storybook-pdf-export — turn a Storybook into one print-friendly PDF

Usage
  storybook-pdf-export [source] [options]

  source            Static build directory or URL of a running Storybook
                    (default: ./storybook-static; if there is none but a
                    .storybook folder, Storybook is built on the fly)

Options
      --config      Config file with theme, templates and hooks
                    (default: ./storybook-pdf.config.js if present)
  -o, --output      Output file                          (default: ${DEFAULTS.output})
  -t, --title       Title on the cover and in the PDF metadata (default: package name)
      --subtitle    Subtitle on the cover
      --author      Author in the PDF metadata
  -m, --mode        auto | docs | stories | all           (default: ${DEFAULTS.mode})
                      auto: docs pages, plus stories of components without docs
  -i, --include     Only export matching entries (glob on id/title, repeatable)
  -x, --exclude     Skip matching entries (repeatable). Tag stories "no-pdf" to skip them too.
      --css         Extra print stylesheet to inject (repeatable)
      --format      Paper format: A4, Letter, A3, ...     (default: ${DEFAULTS.format})
      --landscape   Landscape orientation
      --no-cover    Leave out the cover page
      --no-toc      Leave out the table of contents
      --no-page-numbers
      --browser     auto | chromium | chrome | msedge        (default: auto)
                      auto: Playwright's Chromium if installed, else Chrome, else Edge
      --browser-path  Path to a Chrome / Chromium / Edge binary
      --build       Always run "storybook build" first (into a temp folder)
      --no-build    Never build; fail if there is no build
      --config-dir  Storybook config folder used for building (default: .storybook)
      --storybook-url  Public Storybook URL; links to stories not in the PDF point there
      --no-expand-tabs  Print only the active tab of tab sets (default: every tab, under its label)
      --port        Fixed port for the local server that serves the build (default: random)
  -c, --concurrency Pages rendered in parallel           (default: ${DEFAULTS.concurrency})
      --timeout     Per-page timeout in ms                (default: ${DEFAULTS.timeout})
      --delay       Extra wait per page in ms, e.g. for animations (default: 0)
      --strict      Fail if any page fails to render
  -q, --quiet       Only print errors
  -v, --version
  -h, --help

Examples
  npx storybook-pdf-export                       # in your project: builds + exports
  npx storybook-pdf-export ./storybook-static -o design-system.pdf
  npx storybook-pdf-export --browser msedge      # use the installed Edge
  npx storybook-pdf-export http://localhost:6006 --include "Components/**" --landscape
`;

const options = {
  config: { type: 'string' },
  output: { type: 'string', short: 'o' },
  title: { type: 'string', short: 't' },
  subtitle: { type: 'string' },
  author: { type: 'string' },
  mode: { type: 'string', short: 'm' },
  include: { type: 'string', short: 'i', multiple: true },
  exclude: { type: 'string', short: 'x', multiple: true },
  css: { type: 'string', multiple: true },
  format: { type: 'string' },
  landscape: { type: 'boolean' },
  'no-cover': { type: 'boolean' },
  'no-toc': { type: 'boolean' },
  'no-page-numbers': { type: 'boolean' },
  'storybook-url': { type: 'string' },
  browser: { type: 'string' },
  'browser-path': { type: 'string' },
  build: { type: 'boolean' },
  'no-build': { type: 'boolean' },
  'config-dir': { type: 'string' },
  'no-expand-tabs': { type: 'boolean' },
  port: { type: 'string' },
  concurrency: { type: 'string', short: 'c' },
  timeout: { type: 'string' },
  delay: { type: 'string' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  version: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' },
};

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options, allowPositionals: true });
  } catch (err) {
    console.error(`${err.message}\nRun with --help for usage.`);
    process.exit(2);
  }
  const { values: v, positionals } = parsed;

  if (v.help) return console.log(HELP);
  if (v.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return console.log(pkg.version);
  }

  const num = (s, name) => {
    if (s == null) return undefined;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) {
      console.error(`--${name} must be a non-negative number`);
      process.exit(2);
    }
    return n;
  };

  const started = Date.now();
  const log = v.quiet ? () => {} : (msg) => console.log(msg);

  const { config, path: configPath } = await loadConfig(v.config);
  if (configPath) log(`Using config ${configPath}`);

  // Paths from the config file are relative to the config file, paths given on
  // the command line are relative to the working directory.
  const fromCli = (p) => (p == null || isUrl(p) ? p : resolve(p));
  const listFromCli = (values) => (values?.length ? values.map(fromCli) : undefined);

  // CLI flags win over the config file; flags that weren't given fall back to it.
  const flags = {
    cwd: configPath ? dirname(configPath) : process.cwd(),
    source: fromCli(positionals[0]) ?? config.source ?? './storybook-static',
    output: fromCli(v.output),
    title: v.title,
    subtitle: v.subtitle,
    author: v.author,
    mode: v.mode,
    include: v.include,
    exclude: v.exclude,
    css: listFromCli(v.css),
    format: v.format,
    landscape: v.landscape,
    cover: v['no-cover'] ? false : undefined,
    toc: v['no-toc'] ? false : undefined,
    pageNumbers: v['no-page-numbers'] ? false : undefined,
    storybookUrl: v['storybook-url'],
    browser: v.browser,
    browserPath: fromCli(v['browser-path']),
    build: v['no-build'] ? false : v.build,
    configDir: v['config-dir'],
    expandTabs: v['no-expand-tabs'] ? false : undefined,
    port: num(v.port, 'port'),
    concurrency: num(v.concurrency, 'concurrency'),
    timeout: num(v.timeout, 'timeout'),
    delay: num(v.delay, 'delay'),
    strict: v.strict,
    log,
  };
  const result = await exportPdf({
    ...config,
    ...Object.fromEntries(Object.entries(flags).filter(([, value]) => value !== undefined)),
  });

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const output = v.output ?? config.output ?? DEFAULTS.output;
  log(`\n✓ Wrote ${output} — ${result.pages} pages, ${result.entries.length} entries in ${secs}s`);
  if (result.failed.length) {
    console.warn(`⚠ ${result.failed.length} entr${result.failed.length === 1 ? 'y was' : 'ies were'} skipped because they failed to render.`);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
