import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveStatic } from '../src/server.js';

test('serves files with mime types and blocks path traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-'));
  await writeFile(join(dir, 'index.json'), '{"v":5,"entries":{}}');
  await writeFile(join(dir, 'index.html'), '<h1>hi</h1>');
  const server = await serveStatic(dir);
  try {
    let res = await fetch(new URL('index.json', server.url));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await res.json(), { v: 5, entries: {} });

    res = await fetch(server.url);
    assert.match(await res.text(), /hi/);

    res = await fetch(new URL('missing.js', server.url));
    assert.equal(res.status, 404);

    res = await fetch(`${server.url}..%2f..%2fetc%2fpasswd`);
    assert.ok([403, 404].includes(res.status));
  } finally {
    await server.close();
    await rm(dir, { recursive: true });
  }
});
