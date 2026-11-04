import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUrl, firstLine, formatTitle, entryLabel, plural, readProjectPackage } from '../src/util.js';

test('small helpers', () => {
  assert.ok(isUrl('http://localhost:6006'));
  assert.ok(isUrl('HTTPS://x.test'));
  assert.ok(!isUrl('./storybook-static'));
  assert.ok(!isUrl('C:\\\\sb'));
  assert.equal(firstLine(new Error('a\nb')), 'a');
  assert.equal(firstLine('plain'), 'plain');
  assert.equal(formatTitle('Components / Forms/Button'), 'Components › Forms › Button');
  assert.equal(entryLabel({ title: 'A/B', name: 'Docs' }), 'A › B › Docs');
  assert.equal(plural(1, 'entry', 'entries'), '1 entry');
  assert.equal(plural(3, 'entry', 'entries'), '3 entries');
});

test('readProjectPackage finds the package.json next to the build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-pkg-'));
  try {
    await mkdir(join(dir, 'storybook-static'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'acme-ds', version: '1.0.0' }));
    assert.deepEqual(await readProjectPackage(join(dir, 'storybook-static')), { name: 'acme-ds', version: '1.0.0' });
    assert.deepEqual(await readProjectPackage('http://localhost:6006'), {});
  } finally {
    await rm(dir, { recursive: true });
  }
});
