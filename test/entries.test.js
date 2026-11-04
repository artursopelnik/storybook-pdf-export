import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseIndex, selectEntries, buildTree, globToRegExp } from '../src/entries.js';

const index = normaliseIndex({
  v: 5,
  entries: {
    'introduction--docs': { id: 'introduction--docs', title: 'Introduction', name: 'Docs', type: 'docs', tags: [] },
    'components-button--docs': { id: 'components-button--docs', title: 'Components/Button', name: 'Docs', type: 'docs', tags: ['autodocs'] },
    'components-button--primary': { id: 'components-button--primary', title: 'Components/Button', name: 'Primary', type: 'story', tags: [] },
    'components-badge--default': { id: 'components-badge--default', title: 'Components/Badge', name: 'Default', type: 'story', tags: [] },
    'components-badge--hidden': { id: 'components-badge--hidden', title: 'Components/Badge', name: 'Hidden', type: 'story', tags: ['no-pdf'] },
    'internal-playground--x': { id: 'internal-playground--x', title: 'Internal/Playground', name: 'X', type: 'story', tags: [] },
  },
});

const ids = (list) => list.map((e) => e.id);

test('auto mode: docs pages plus stories of components without docs', () => {
  assert.deepEqual(ids(selectEntries(index)), [
    'introduction--docs',
    'components-button--docs',
    'components-badge--default',
    'internal-playground--x',
  ]);
});

test('docs / stories / all modes', () => {
  assert.deepEqual(ids(selectEntries(index, { mode: 'docs' })), ['introduction--docs', 'components-button--docs']);
  assert.equal(selectEntries(index, { mode: 'stories' }).length, 3);
  assert.equal(selectEntries(index, { mode: 'all' }).length, 5);
  assert.throws(() => selectEntries(index, { mode: 'nope' }), /Unknown mode/);
});

test('"no-pdf" tag excludes entries', () => {
  assert.ok(!ids(selectEntries(index, { mode: 'all' })).includes('components-badge--hidden'));
});

test('include / exclude patterns match titles and everything below them', () => {
  assert.deepEqual(ids(selectEntries(index, { include: ['Components'] })), ['components-button--docs', 'components-badge--default']);
  assert.deepEqual(ids(selectEntries(index, { exclude: ['Internal/**', 'introduction--*'] })), ['components-button--docs', 'components-badge--default']);
  assert.deepEqual(ids(selectEntries(index, { mode: 'all', include: ['components/button/primary'] })), ['components-button--primary']);
});

test('globToRegExp', () => {
  assert.ok(globToRegExp('Components/*').test('Components/Button'));
  assert.ok(!globToRegExp('Components/*').test('Components/Forms/Button'));
  assert.ok(globToRegExp('Components/**').test('Components/Forms/Button'));
  assert.ok(globToRegExp('a.b?').test('a.bc'));
  assert.ok(!globToRegExp('a.b').test('axb'));
});

test('legacy stories.json is understood', () => {
  const [e] = normaliseIndex({ v: 3, stories: { 'a--b': { id: 'a--b', kind: 'A', story: 'B', parameters: {} } } });
  assert.deepEqual(e, { id: 'a--b', title: 'A', name: 'B', type: 'story', tags: [], importPath: undefined });
  assert.throws(() => normaliseIndex({}), /Unrecognised/);
});

test('buildTree mirrors the sidebar', () => {
  const list = selectEntries(index, { mode: 'all' });
  const tree = buildTree(list);
  const show = (nodes, d = 0) => nodes.flatMap((n) => [`${'  '.repeat(d)}${n.label}@${n.entry}`, ...show(n.children, d + 1)]);
  assert.deepEqual(show(tree), [
    'Introduction@0',
    'Components@1',
    '  Button@1',
    '    Docs@1',
    '    Primary@2',
    '  Badge@3',
    '    Default@3',
    'Internal@4',
    '  Playground@4',
    '    X@4',
  ]);
});
