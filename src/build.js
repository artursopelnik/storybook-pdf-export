/**
 * Builds the project's Storybook on demand, so `npx storybook-pdf-export`
 * works in a project that has never run `storybook build`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Folder that holds the Storybook config (`.storybook` unless told otherwise). */
export function findConfigDir(cwd, configDir = '.storybook') {
  const dir = resolve(cwd, configDir);
  return existsSync(dir) ? dir : null;
}

/** Path of the `storybook` CLI installed in the project. */
export async function findStorybookCli(cwd) {
  const require = createRequire(join(resolve(cwd), 'noop.js'));
  let pkgPath;
  try {
    pkgPath = require.resolve('storybook/package.json');
  } catch {
    throw new Error(
      `Storybook is not installed in ${resolve(cwd)}. Install it, or pass a built Storybook (a storybook-static folder) or the URL of a running one.`,
    );
  }
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.storybook ?? pkg.bin?.sb;
  if (!bin) throw new Error(`Could not find the storybook CLI in ${pkgPath}.`);
  return join(dirname(pkgPath), bin);
}

/**
 * Runs `storybook build` into a temporary folder.
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
export async function buildStorybook({ cwd, configDir = '.storybook', log = () => {}, quiet = false }) {
  const cli = await findStorybookCli(cwd);
  const dir = await mkdtemp(join(tmpdir(), 'storybook-pdf-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });

  log(`No Storybook build found, building one (storybook build -c ${configDir})…`);
  const args = [cli, 'build', '--config-dir', configDir, '--output-dir', dir, '--quiet', '--disable-telemetry'];
  const code = await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, { cwd, stdio: quiet ? 'ignore' : ['ignore', 'inherit', 'inherit'] });
    child.on('error', fail);
    child.on('exit', ok);
  });
  if (code !== 0 || !existsSync(join(dir, 'iframe.html'))) {
    await cleanup();
    throw new Error(`storybook build failed (exit code ${code}). Run it yourself to see the error: npx storybook build`);
  }
  return { dir, cleanup };
}
