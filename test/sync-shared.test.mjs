import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkShared, syncShared } from '../scripts/sync-shared.mjs';

async function makeRepo(t) {
  const root = await mkdtemp(join(tmpdir(), 'kodffe-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'shared', 'nested'), { recursive: true });
  await writeFile(join(root, 'shared', 'config.mjs'), 'export const a = 1;\n');
  await writeFile(join(root, 'shared', 'nested', 'git.mjs'), 'export const b = 2;\n');
  await mkdir(join(root, 'plugins', 'kds'), { recursive: true });
  await mkdir(join(root, 'plugins', 'kab'), { recursive: true });
  return root;
}

test('sync copies shared/ into every plugin and check then passes', async (t) => {
  const root = await makeRepo(t);

  assert.ok((await checkShared(root)).length > 0, 'unsynced copies must fail the check');

  const result = await syncShared(root);
  assert.deepEqual(result, { skipped: false, plugins: ['kab', 'kds'] });
  assert.equal(
    await readFile(join(root, 'plugins', 'kds', 'lib', '_shared', 'nested', 'git.mjs'), 'utf8'),
    'export const b = 2;\n',
  );
  assert.deepEqual(await checkShared(root), []);
});

test('check reports edited, missing and extra files', async (t) => {
  const root = await makeRepo(t);
  await syncShared(root);
  const copy = join(root, 'plugins', 'kds', 'lib', '_shared');

  await writeFile(join(copy, 'config.mjs'), 'export const a = 99;\n');
  await rm(join(copy, 'nested', 'git.mjs'));
  await writeFile(join(copy, 'extra.mjs'), '');

  assert.deepEqual((await checkShared(root)).sort(), [
    'plugins/kds/lib/_shared/config.mjs: differs from shared/',
    'plugins/kds/lib/_shared/extra.mjs: not in shared/',
    'plugins/kds/lib/_shared/nested/git.mjs: missing',
  ]);
});

test('sync removes stale files from the copy', async (t) => {
  const root = await makeRepo(t);
  await syncShared(root);
  await rm(join(root, 'shared', 'config.mjs'));

  await syncShared(root);
  assert.deepEqual(await checkShared(root), []);
});

test('without shared/ sync is skipped and check passes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kodffe-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'plugins', 'kds'), { recursive: true });

  assert.deepEqual(await syncShared(root), { skipped: true, plugins: [] });
  assert.deepEqual(await checkShared(root), []);
});
