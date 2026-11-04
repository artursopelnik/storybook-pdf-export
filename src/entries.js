/**
 * Reading and filtering of Storybook's index (index.json / stories.json).
 */

export const EXCLUDE_TAGS = ['no-pdf', '!pdf'];

/** Normalises index.json (v7+) and the legacy stories.json (v6) format. */
export function normaliseIndex(json) {
  const raw = json?.entries ?? json?.stories;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Unrecognised Storybook index: expected an "entries" (index.json) or "stories" (stories.json) object.');
  }
  return Object.values(raw).filter((e) => e?.id && (e.title ?? e.kind)).map((e) => ({
    id: e.id,
    title: e.title ?? e.kind,
    name: e.name ?? e.story,
    type: e.type ?? (e.parameters?.docsOnly ? 'docs' : 'story'),
    tags: e.tags ?? [],
    importPath: e.importPath,
  }));
}

/** Turns a simple glob (`*` = anything inside a segment, `**` = anything) into a RegExp. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

/**
 * Compiles filter patterns once. A pattern also matches everything below it:
 * "Components" ⇒ "Components" and "Components/**".
 */
function compile(patterns) {
  const res = patterns.flatMap((p) => [p, `${p}/**`]).map(globToRegExp);
  return (entry) => {
    const candidates = [entry.id, entry.title, `${entry.title}/${entry.name}`];
    return res.some((re) => candidates.some((c) => re.test(c)));
  };
}

export const MODES = ['auto', 'docs', 'stories', 'all'];

export function assertMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}". Use one of: ${MODES.join(', ')}.`);
}

/**
 * Picks the entries that should end up in the PDF.
 *
 * mode:
 *   auto    – docs pages; components without a docs page contribute their stories
 *   docs    – docs pages only
 *   stories – stories only
 *   all     – docs pages and stories
 */
export function selectEntries(entries, { mode = 'auto', include = [], exclude = [] } = {}) {
  assertMode(mode);

  let list = entries.filter((e) => !e.tags.some((t) => EXCLUDE_TAGS.includes(t)));
  if (include.length) {
    const included = compile(include);
    list = list.filter(included);
  }
  if (exclude.length) {
    const excluded = compile(exclude);
    list = list.filter((e) => !excluded(e));
  }

  switch (mode) {
    case 'docs':
      return list.filter((e) => e.type === 'docs');
    case 'stories':
      return list.filter((e) => e.type === 'story');
    case 'all':
      return list;
    default: {
      // auto
      const titlesWithDocs = new Set(list.filter((e) => e.type === 'docs').map((e) => e.title));
      return list.filter((e) => e.type === 'docs' || !titlesWithDocs.has(e.title));
    }
  }
}

/**
 * Builds the tree used for both the printed table of contents and the PDF
 * bookmarks. Every node knows the index of its first entry.
 *
 *   Components/Forms/Button (Docs)   →  Components › Forms › Button
 *   Components/Forms/Button (Primary)→                         › Primary
 */
export function buildTree(entries) {
  const root = { label: null, children: [], entry: -1 };
  const perTitle = new Map();
  for (const e of entries) perTitle.set(e.title, (perTitle.get(e.title) ?? 0) + 1);

  entries.forEach((entry, index) => {
    let node = root;
    for (const seg of entry.title.split('/').map((s) => s.trim())) {
      let child = node.children.at(-1);
      if (!child || child.label !== seg || child.leaf) {
        child = { label: seg, children: [], entry: index };
        node.children.push(child);
      }
      node = child;
    }
    // A single docs page is represented by its title node; anything else
    // (multiple docs pages, stories) gets its own leaf below the title.
    const single = perTitle.get(entry.title) === 1 && entry.type === 'docs';
    if (!single) node.children.push({ label: entry.name, children: [], entry: index, leaf: true });
  });

  return root.children;
}
