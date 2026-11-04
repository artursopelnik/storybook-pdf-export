/**
 * Finds and launches a Chromium-based browser. PDF printing needs Chromium,
 * but it does not have to be Playwright's own download: an installed Google
 * Chrome or Microsoft Edge works just as well, which is often the only thing
 * allowed on company machines.
 */

/** Values for the `browser` option. Any other Playwright channel name (e.g. `chrome-beta`, `msedge-dev`) works too. */
export const BROWSERS = ['auto', 'chromium', 'chrome', 'msedge'];

/** Order in which `auto` tries browsers. */
const AUTO_ORDER = ['chromium', 'chrome', 'msedge'];

const LABELS = { chromium: "Playwright's Chromium", chrome: 'Google Chrome', msedge: 'Microsoft Edge' };

const isMissing = (err) => /Executable doesn't exist|is not found at|not found|ENOENT|Chromium distribution .* is not found|Cannot find/i.test(err?.message ?? '');

/**
 * @param {object} options
 * @param {string} [options.browser]      auto | chromium | chrome | msedge | other Playwright channel
 * @param {string} [options.browserPath]  path to a Chrome / Chromium / Edge binary (wins over `browser`)
 * @param {(msg: string) => void} [options.log]
 * @param {{ launch(opts: object): Promise<any> }} [options.launcher]  injected for tests
 * @returns {Promise<{ browser: any, name: string }>}
 */
export async function launchBrowser({ browser = 'auto', browserPath, log = () => {}, launcher } = {}) {
  const chromium = launcher ?? (await import('playwright-core')).chromium;
  const launch = (opts) => chromium.launch({ headless: true, ...opts });

  if (browserPath) {
    log(`Using browser at ${browserPath}`);
    return { browser: await launch({ executablePath: browserPath }), name: browserPath };
  }

  const candidates = browser === 'auto' ? AUTO_ORDER : [browser];
  const tried = [];
  for (const name of candidates) {
    try {
      const instance = await launch(name === 'chromium' ? {} : { channel: name });
      if (browser === 'auto' && name !== 'chromium') log(`Using ${LABELS[name] ?? name}.`);
      return { browser: instance, name };
    } catch (err) {
      if (!isMissing(err)) throw err;
      tried.push(LABELS[name] ?? name);
    }
  }

  throw new Error(
    (browser === 'auto' ? `No usable browser found (tried ${tried.join(', ')}). Either:\n` : `${tried[0]} was not found. Use --browser auto, or:\n`) +
      '  - install Google Chrome or Microsoft Edge, or\n' +
      '  - run "npx playwright-core install chromium", or\n' +
      '  - point --browser-path at a Chrome / Chromium / Edge binary.',
  );
}
