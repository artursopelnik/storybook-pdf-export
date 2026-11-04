import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('--help and --version', () => {
  const help = cli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage[\s\S]*--config/);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(cli('--version').stdout.trim(), version);
});

test('bad arguments exit with code 2', () => {
  const unknown = cli('--nope');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown option/);
  const bad = cli('--concurrency', 'many');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--concurrency must be/);
});

test('missing build or config exits with code 1 and a helpful message', () => {
  const missing = cli('./definitely-missing-build');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /does not look like a Storybook build/);
  const config = cli('--config', './missing.config.js');
  assert.equal(config.status, 1);
  assert.match(config.stderr, /Config file not found/);
});

test('--help documents browser and build options', () => {
  const { stdout } = cli('--help');
  for (const flag of ['--browser ', '--browser-path', '--build', '--no-build', '--config-dir']) assert.ok(stdout.includes(flag), flag);
});
