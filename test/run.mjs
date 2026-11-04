#!/usr/bin/env node
// Runs every test/*.test.js file. `node --test "glob"` only works from Node 21
// on, and shell globs don't work on Windows, so collect the files here.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => join(dir, f));

const { status } = spawnSync(process.execPath, ['--test', ...files, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(status ?? 1);
