// Task state in <git-common-dir>/kodffe/kds/: tasks/<id>.json plus marker folders
// (claims/, announced/, reported/) created atomically with mkdir so concurrent hooks and
// workers never act twice on the same task.

import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { commonDir } from './_shared/git.mjs';
import { listJson, readJson, userDataDir, writeJson } from './_shared/state.mjs';
import { ID } from './settings.mjs';

export const SCHEMA_VERSION = 1;
export const FINISHED = new Set(['done', 'failed', 'applied', 'discarded']);

export function taskPath(project, id) {
  return join(project.stateDir, 'tasks', `${id}.json`);
}

export function logPath(project, id) {
  return join(project.stateDir, 'logs', `${id}.log`);
}

export async function readTask(project, id) {
  return readJson(taskPath(project, id));
}

export async function writeTask(project, task) {
  await writeJson(taskPath(project, task.id), task);
  return task;
}

/** Reads a task, applies a change to it and writes it back. */
export async function updateTask(project, id, change) {
  const task = await readTask(project, id);
  if (!task) return null;
  return writeTask(project, { ...task, ...change(task) });
}

export async function listTasks(project) {
  const tasks = await listJson(join(project.stateDir, 'tasks'));
  return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Creates a marker once; returns false if it already existed. */
export async function mark(project, kind, id) {
  const path = join(project.stateDir, kind, id);
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export function slugify(text) {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'task';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function newTaskId(title, now = new Date()) {
  const stamp =
    `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${stamp}-${slugify(title)}`;
}

export async function uniqueTaskId(project, title, now) {
  const base = newTaskId(title, now);
  let id = base;
  for (let n = 2; await readTask(project, id); n++) id = `${base}-${n}`;
  return id;
}

/** ~/.kodffe/kds/worktrees/<repo>-<hash>/<id>; the hash keeps same-named repos apart. */
export function worktreePath(project, id) {
  const common = commonDir(project.root);
  const repo = basename(dirname(common));
  const hash = createHash('sha1').update(common).digest('hex').slice(0, 6);
  return join(userDataDir(ID), 'worktrees', `${repo}-${hash}`, id);
}

export function branchName(id) {
  return `${ID}/${id}`;
}

export function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** A running task whose worker process is gone is marked failed. */
export async function refreshStale(project, task) {
  if (task.status !== 'running' || isAlive(task.pid)) return task;
  return (
    (await updateTask(project, task.id, (current) =>
      current.status === 'running'
        ? {
            status: 'failed',
            endedAt: new Date().toISOString(),
            error: 'The worker process stopped unexpectedly. See the task log.',
          }
        : {},
    )) ?? task
  );
}
