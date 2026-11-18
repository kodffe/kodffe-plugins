#!/usr/bin/env node
// Copies the common core (shared/) into every plugin's lib/_shared/.
// With --check, changes nothing and exits 1 if any copy differs from shared/.

import { cp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARED_DIR = 'shared';
const PLUGINS_DIR = 'plugins';
const COPY_DIR = join('lib', '_shared');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir) {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

export async function listPlugins(root) {
  const dir = join(root, PLUGINS_DIR);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function syncShared(root) {
  const source = join(root, SHARED_DIR);
  if (!(await exists(source))) return { skipped: true, plugins: [] };

  const plugins = await listPlugins(root);
  for (const plugin of plugins) {
    const target = join(root, PLUGINS_DIR, plugin, COPY_DIR);
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true });
  }
  return { skipped: false, plugins };
}

export async function checkShared(root) {
  const source = join(root, SHARED_DIR);
  const sourceFiles = await listFiles(source);
  const problems = [];

  for (const plugin of await listPlugins(root)) {
    const target = join(root, PLUGINS_DIR, plugin, COPY_DIR);
    const label = `${PLUGINS_DIR}/${plugin}/lib/_shared`;
    const targetFiles = await listFiles(target);

    for (const file of sourceFiles) {
      if (!targetFiles.includes(file)) {
        problems.push(`${label}/${file}: missing`);
        continue;
      }
      const [expected, actual] = await Promise.all([
        readFile(join(source, file)),
        readFile(join(target, file)),
      ]);
      if (!expected.equals(actual)) problems.push(`${label}/${file}: differs from shared/`);
    }
    for (const file of targetFiles) {
      if (!sourceFiles.includes(file)) problems.push(`${label}/${file}: not in shared/`);
    }
  }
  return problems;
}

async function main() {
  const root = process.cwd();

  if (process.argv.includes('--check')) {
    const problems = await checkShared(root);
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error('lib/_shared/ is out of date. Run "npm run sync".');
      process.exit(1);
    }
    console.log('lib/_shared/ matches shared/ in every plugin.');
    return;
  }

  const result = await syncShared(root);
  if (result.skipped) {
    console.log('No shared/ folder yet; nothing to sync.');
    return;
  }
  console.log(`Synced shared/ into ${result.plugins.length} plugin(s).`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
