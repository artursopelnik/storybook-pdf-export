import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findConfigDir, findStorybookCli } from '../src/build.js';
import { exportPdf } from '../src/index.js';

test('findConfigDir / findStorybookCli', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-build-'));
  try {
    assert.equal(findConfigDir(dir), null);
    await mkdir(join(dir, '.storybook'));
    assert.equal(findConfigDir(dir), join(dir, '.storybook'));
    assert.equal(findConfigDir(dir, 'config/sb'), null);
    await assert.rejects(findStorybookCli(dir), /Storybook is not installed/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('no build and no .storybook folder: clear error, nothing is built', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-build-'));
  try {
    await assert.rejects(exportPdf({ cwd: dir, source: './storybook-static', warn: () => {} }), /no \.storybook folder/);
    await mkdir(join(dir, '.storybook'));
    await assert.rejects(exportPdf({ cwd: dir, source: './storybook-static', build: false, warn: () => {} }), /does not look like a Storybook build/);
    await assert.rejects(exportPdf({ cwd: dir, source: './storybook-static', warn: () => {} }), /Storybook is not installed/);
    await assert.rejects(exportPdf({ cwd: dir, source: '.', build: 'yes' }), /"build" must be/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
