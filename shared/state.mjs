// Well-known kodffe locations: per-repo state in <git-common-dir>/kodffe/<id>/ and user data
// in ~/.kodffe/<id>/ (KODFFE_HOME overrides ~/.kodffe). JSON files are written atomically.

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { commonDir } from './git.mjs';

export function stateDir(cwd, id) {
  return join(commonDir(cwd), 'kodffe', id);
}

export function userDataDir(id) {
  return join(process.env.KODFFE_HOME || join(homedir(), '.kodffe'), id);
}

export async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

export async function listJson(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const values = await Promise.all(
    files.filter((file) => file.endsWith('.json')).map((file) => readJson(join(dir, file))),
  );
  return values.filter(Boolean);
}
