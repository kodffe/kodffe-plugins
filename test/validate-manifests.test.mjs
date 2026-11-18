import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateRepo } from '../scripts/validate-manifests.mjs';

const README = `# kds

## Data that leaves your machine

Nothing.
`;

function manifest(overrides = {}) {
  return {
    name: 'kds',
    version: '0.1.0',
    description: 'Test plugin',
    author: { name: 'Kodffe Software', url: 'https://github.com/kodffe' },
    homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/kds',
    repository: 'https://github.com/kodffe/kodffe-plugins',
    license: 'MIT',
    keywords: ['kodffe'],
    ...overrides,
  };
}

async function write(root, path, content) {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content));
}

async function makeRepo(t, { plugin = manifest(), entries } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kodffe-validate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = plugin.name;
  await write(root, '.claude-plugin/marketplace.json', {
    name: 'kodffe',
    owner: { name: 'Kodffe Software' },
    plugins: entries ?? [{ name, source: `./plugins/${name}`, version: plugin.version }],
  });
  await write(root, `plugins/${name}/.claude-plugin/plugin.json`, plugin);
  await write(root, `plugins/${name}/commands/${name}.md`, '');
  await write(root, `plugins/${name}/bin/${name}.mjs`, '');
  await write(root, `plugins/${name}/README.md`, README);
  await write(root, `plugins/${name}/CHANGELOG.md`, '');
  return root;
}

test('a plugin that follows the standards passes', async (t) => {
  const root = await makeRepo(t);
  assert.deepEqual(await validateRepo(root), []);
});

test('an empty marketplace with no plugins passes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kodffe-validate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, '.claude-plugin/marketplace.json', { name: 'kodffe', plugins: [] });
  assert.deepEqual(await validateRepo(root), []);
});

test('reports manifest fields that break the standards', async (t) => {
  const root = await makeRepo(t, {
    plugin: manifest({ license: 'ISC', keywords: [], version: 'one' }),
  });
  const errors = await validateRepo(root);
  assert.ok(errors.includes('plugins/kds: plugin.json "license" must be "MIT"'));
  assert.ok(errors.includes('plugins/kds: plugin.json "keywords" must include "kodffe"'));
  assert.ok(errors.includes('plugins/kds: plugin.json "version" must be semver'));
});

test('rejects names outside the k + 1-3 letters rule', async (t) => {
  const root = await makeRepo(t, {
    plugin: manifest({
      name: 'deploy',
      homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/deploy',
    }),
  });
  assert.deepEqual(await validateRepo(root), [
    'plugins/deploy: name must be 2 to 4 lowercase letters starting with "k"',
  ]);
});

test('reports marketplace mismatches in both directions', async (t) => {
  const root = await makeRepo(t, {
    entries: [
      { name: 'kds', source: './plugins/kds', version: '0.2.0' },
      { name: 'kxx', source: './plugins/kxx' },
    ],
  });
  assert.deepEqual(await validateRepo(root), [
    'plugins/kds: marketplace.json version 0.2.0 does not match plugin.json 0.1.0',
    '.claude-plugin/marketplace.json: "kxx" has no plugins/ folder',
  ]);
});

test('requires the data section in the README', async (t) => {
  const root = await makeRepo(t);
  await write(root, 'plugins/kds/README.md', '# kds\n');
  assert.deepEqual(await validateRepo(root), [
    'plugins/kds: README.md needs a "## Data that leaves your machine" section',
  ]);
});
