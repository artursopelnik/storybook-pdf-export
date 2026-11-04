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

test('listens on a fixed port when one is given', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-'));
  await writeFile(join(dir, 'index.html'), '<h1>hi</h1>');
  // Find a free port first, then ask for exactly that one.
  const probe = await serveStatic(dir);
  const port = Number(new URL(probe.url).port);
  await probe.close();
  const server = await serveStatic(dir, { port });
  try {
    assert.equal(server.url, `http://127.0.0.1:${port}/`);
    assert.match(await (await fetch(server.url)).text(), /hi/);
  } finally {
    await server.close();
    await rm(dir, { recursive: true });
  }
});

test('a port that is taken gives a clear error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pdf-'));
  const first = await serveStatic(dir);
  try {
    const port = Number(new URL(first.url).port);
    const second = await serveStatic(dir, { port }).catch((err) => err);
    if (!(second instanceof Error)) await second.close(); // don't leave a server behind when the test fails
    assert.match(String(second?.message), new RegExp(`Port ${port} is already in use`));
  } finally {
    await first.close();
    await rm(dir, { recursive: true });
  }
});
