import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateRepo } from '../scripts/validate-manifests.mjs';

const README = `# k-delegate

## Data that leaves your machine

Nothing.
`;

function manifest(overrides = {}) {
  return {
    name: 'k-delegate',
    displayName: 'DeepSeek Delegate',
    version: '0.1.0',
    description: 'Test plugin',
    author: { name: 'Kodffe Software', url: 'https://github.com/kodffe' },
    homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/k-delegate',
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

async function makeRepo(t, { plugin = manifest(), id = 'kds', entries } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kodffe-validate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = plugin.name;
  await write(root, '.claude-plugin/marketplace.json', {
    name: 'kodffe',
    owner: { name: 'Kodffe Software' },
    plugins: entries ?? [{ name, source: `./plugins/${name}`, version: plugin.version }],
  });
  await write(root, `plugins/${name}/.claude-plugin/plugin.json`, plugin);
  await write(root, `plugins/${name}/commands/${id}.md`, '');
  await write(root, `plugins/${name}/bin/${id}.mjs`, '');
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
  assert.ok(errors.includes('plugins/k-delegate: plugin.json "license" must be "MIT"'));
  assert.ok(errors.includes('plugins/k-delegate: plugin.json "keywords" must include "kodffe"'));
  assert.ok(errors.includes('plugins/k-delegate: plugin.json "version" must be semver'));
});

test('rejects a short id outside the k + 1-3 letters rule', async (t) => {
  const root = await makeRepo(t, { id: 'deploy' });
  assert.deepEqual(await validateRepo(root), [
    'plugins/k-delegate: short id "deploy" must be 2 to 4 lowercase letters starting with "k"',
  ]);
});

test('rejects a plugin name that is not kebab-case', async (t) => {
  const root = await makeRepo(t, {
    plugin: manifest({
      name: 'DeepSeek_Delegate',
      homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/DeepSeek_Delegate',
    }),
  });
  assert.deepEqual(await validateRepo(root), [
    'plugins/DeepSeek_Delegate: plugin name must be kebab-case and start with "k-"',
  ]);
});

test('requires exactly one command file', async (t) => {
  const root = await makeRepo(t);
  await write(root, 'plugins/k-delegate/commands/kdx.md', '');
  assert.deepEqual(await validateRepo(root), [
    'plugins/k-delegate: commands/ must contain exactly one <id>.md file',
  ]);
});

test('rejects two plugins with the same short id', async (t) => {
  const root = await makeRepo(t, {
    entries: [
      { name: 'k-delegate', source: './plugins/k-delegate' },
      { name: 'k-other', source: './plugins/k-other' },
    ],
  });
  const other = 'plugins/k-other';
  await write(
    root,
    `${other}/.claude-plugin/plugin.json`,
    manifest({
      name: 'k-other',
      homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/k-other',
    }),
  );
  await write(root, `${other}/commands/kds.md`, '');
  await write(root, `${other}/bin/kds.mjs`, '');
  await write(root, `${other}/README.md`, README);
  await write(root, `${other}/CHANGELOG.md`, '');
  assert.deepEqual(await validateRepo(root), [
    'plugins/k-other: short id "kds" is already used by plugins/k-delegate',
  ]);
});

test('reports marketplace mismatches in both directions', async (t) => {
  const root = await makeRepo(t, {
    entries: [
      { name: 'k-delegate', source: './plugins/k-delegate', version: '0.2.0' },
      { name: 'kxx', source: './plugins/kxx' },
    ],
  });
  assert.deepEqual(await validateRepo(root), [
    'plugins/k-delegate: marketplace.json version 0.2.0 does not match plugin.json 0.1.0',
    '.claude-plugin/marketplace.json: "kxx" has no plugins/ folder',
  ]);
});

test('requires the data section in the README', async (t) => {
  const root = await makeRepo(t);
  await write(root, 'plugins/k-delegate/README.md', '# k-delegate\n');
  assert.deepEqual(await validateRepo(root), [
    'plugins/k-delegate: README.md needs a "## Data that leaves your machine" section',
  ]);
});

test('requires the "k-" plugin name prefix and a displayName', async (t) => {
  const root = await makeRepo(t, {
    plugin: manifest({
      name: 'delegate',
      displayName: '',
      homepage: 'https://github.com/kodffe/kodffe-plugins/tree/main/plugins/delegate',
    }),
  });
  const errors = await validateRepo(root);
  assert.ok(
    errors.includes('plugins/delegate: plugin name must be kebab-case and start with "k-"'),
  );
  assert.ok(errors.includes('plugins/delegate: plugin.json "displayName" is required'));
});
