// Project configuration in <repo>/.claude/kodffe.json: one section per plugin id plus "common".

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function configPath(root) {
  return join(root, '.claude', 'kodffe.json');
}

export async function readConfigFile(root) {
  try {
    return JSON.parse(await readFile(configPath(root), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`${configPath(root)} is not valid JSON: ${error.message}`, { cause: error });
  }
}

/** Returns { common, section } for one plugin id, with defaults applied to the section. */
export async function loadConfig(root, id, defaults = {}) {
  const file = await readConfigFile(root);
  return {
    common: file.common ?? {},
    section: { ...defaults, ...(file[id] ?? {}) },
  };
}

/** Merges a patch into this plugin's own section, leaving every other section untouched. */
export async function updateSection(root, id, patch) {
  const file = await readConfigFile(root);
  file[id] = { ...(file[id] ?? {}), ...patch };
  const path = configPath(root);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`);
  await rename(tmp, path);
  return file[id];
}
