import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';

/** Fake Playwright launcher: `installed` lists channels that exist ('chromium' = bundled). */
function fakeLauncher(installed, { crash } = {}) {
  const calls = [];
  return {
    calls,
    async launch(opts) {
      calls.push(opts);
      if (crash) throw new Error(crash);
      const name = opts.executablePath ?? opts.channel ?? 'chromium';
      if (opts.executablePath || installed.includes(name)) return { name };
      throw new Error(opts.channel ? `Chromium distribution '${name}' is not found at /opt/x` : "Executable doesn't exist at /ms-playwright/chromium");
    },
  };
}

test('auto prefers Playwright Chromium, then Chrome, then Edge', async () => {
  for (const [installed, expected] of [[['chromium', 'chrome', 'msedge'], 'chromium'], [['chrome', 'msedge'], 'chrome'], [['msedge'], 'msedge']]) {
    const launcher = fakeLauncher(installed);
    const logs = [];
    const { name } = await launchBrowser({ launcher, log: (m) => logs.push(m) });
    assert.equal(name, expected);
    if (expected !== 'chromium') assert.match(logs.join(), expected === 'chrome' ? /Google Chrome/ : /Microsoft Edge/);
  }
});

test('auto fails with a helpful message when nothing is installed', async () => {
  await assert.rejects(launchBrowser({ launcher: fakeLauncher([]) }), /No usable browser found \(tried Playwright's Chromium, Google Chrome, Microsoft Edge\)[\s\S]*npx playwright-core install chromium/);
});

test('an explicit browser is used as a Playwright channel and not substituted', async () => {
  const launcher = fakeLauncher(['chrome', 'msedge']);
  assert.equal((await launchBrowser({ browser: 'msedge', launcher })).name, 'msedge');
  assert.deepEqual(launcher.calls.at(-1), { headless: true, channel: 'msedge' });
  await assert.rejects(launchBrowser({ browser: 'chromium', launcher }), /Playwright's Chromium was not found/);
  assert.equal((await launchBrowser({ browser: 'chrome-beta', launcher: fakeLauncher(['chrome-beta']) })).name, 'chrome-beta');
});

test('browserPath wins over browser', async () => {
  const launcher = fakeLauncher([]);
  const { name } = await launchBrowser({ browser: 'msedge', browserPath: '/opt/edge/msedge', launcher });
  assert.equal(name, '/opt/edge/msedge');
  assert.deepEqual(launcher.calls, [{ headless: true, executablePath: '/opt/edge/msedge' }]);
});

test('real launch errors are not swallowed by the fallback', async () => {
  await assert.rejects(launchBrowser({ launcher: fakeLauncher([], { crash: 'Target crashed: sandbox' }) }), /Target crashed/);
});
