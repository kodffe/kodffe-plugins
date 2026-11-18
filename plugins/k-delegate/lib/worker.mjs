// Runs one delegated task: a headless `claude -p` pointed at DeepSeek, inside the task's
// worktree. The worker is a detached process so Claude (and the hook that may start it)
// return immediately.

import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './_shared/git.mjs';
import { emptyUsage, usageFromResult } from './prices.mjs';
import { ID } from './settings.mjs';
import { logPath, mark, readTask, updateTask } from './tasks.mjs';

const BIN = fileURLToPath(new URL('../bin/kds.mjs', import.meta.url));
const SUMMARY_LIMIT = 8000;
const KILL_GRACE_MS = 5000;

export const WORKER_PROMPT = [
  'You are a worker started by the k-delegate plugin for Claude Code.',
  "You run inside an isolated git worktree that is a copy of the developer's project.",
  'Do only the task you are given. Do not change files unrelated to it.',
  'Do not commit, push, create branches or touch git configuration.',
  'If a CLAUDE.md file exists at the root, read it first and follow its conventions.',
  'If a verify command is given, run it before finishing and fix failures your change caused.',
  'Finish with a short report: what you changed (files), the verify result, and anything you',
  'were unsure about or did not do. Another model reviews your work before it is used.',
].join(' ');

/**
 * Starts the detached worker for a queued task, once. The API key travels only through the
 * worker's environment; it is never written to disk. `model`, when given, replaces the
 * task's model first: hooks see the model picked in the plugin settings, the Bash call that
 * queued the task does not.
 */
export async function startWorker(project, id, key, model = null) {
  if (!(await mark(project, 'claims', id))) return false;
  if (model) await updateTask(project, id, () => ({ model }));
  const log = logPath(project, id);
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [BIN, '_work', id], {
    cwd: project.root,
    detached: true,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, KDS_API_KEY: key },
  });
  child.unref();
  await updateTask(project, id, () => ({ status: 'running', pid: child.pid }));
  return true;
}

/** Environment for the child: no inherited Anthropic or plugin secrets, DeepSeek instead. */
export function childEnv(task, key, env = process.env) {
  const clean = {};
  for (const [name, value] of Object.entries(env)) {
    if (/^(ANTHROPIC_|CLAUDE_PLUGIN_OPTION_|KDS_|CLAUDE_CODE_)/.test(name)) continue;
    if (name === 'CLAUDECODE') continue;
    clean[name] = value;
  }
  return {
    ...clean,
    ANTHROPIC_BASE_URL: task.baseUrl,
    ANTHROPIC_API_KEY: key,
    ANTHROPIC_MODEL: task.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: task.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: task.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: task.model,
    ANTHROPIC_SMALL_FAST_MODEL: task.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    KODFFE_CHILD: ID,
  };
}

export function childArgs(task) {
  return [
    '--bare',
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--max-turns',
    String(task.maxTurns),
    '--model',
    task.model,
    '--append-system-prompt',
    WORKER_PROMPT,
    '--allowedTools',
    ...task.allowedTools,
  ];
}

function childPrompt(task) {
  const verify = task.verify ? `\n\nVerify command: ${task.verify}` : '';
  return `${task.brief}${verify}\n`;
}

function runChild(task, key) {
  return new Promise((resolve) => {
    const child = spawn(process.env.KDS_CLAUDE_BIN || 'claude', childArgs(task), {
      cwd: task.worktree,
      env: childEnv(task, key),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    }, task.timeoutMinutes * 60_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: `Could not start claude: ${error.message}`, stdout, stderr });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });
    child.stdin.end(childPrompt(task));
  });
}

function parseResult(stdout) {
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((text) => text.startsWith('{'));
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** Commits whatever the child changed so the diff lives on the task branch. */
function commitChanges(task) {
  git(['add', '-A'], { cwd: task.worktree });
  const staged = git(['diff', '--cached', '--name-only'], { cwd: task.worktree });
  if (staged) {
    git(
      [
        '-c',
        'user.name=k-delegate',
        '-c',
        'user.email=k-delegate@users.noreply.github.com',
        'commit',
        '--no-verify',
        '-q',
        '-m',
        `${ID}: ${task.title}`,
      ],
      { cwd: task.worktree },
    );
  }
  const files = git(['diff', '--name-only', `${task.baseCommit}..HEAD`], { cwd: task.worktree });
  return files ? files.split('\n') : [];
}

/** Body of the detached `_work <id>` process. */
export async function runWorker(project, id) {
  const key = process.env.KDS_API_KEY;
  const task = await readTask(project, id);
  if (!task) throw new Error(`Unknown task ${id}`);
  await updateTask(project, id, () => ({ status: 'running', pid: process.pid }));

  const finish = (change) =>
    updateTask(project, id, () => ({ endedAt: new Date().toISOString(), ...change }));

  if (!key) return finish({ status: 'failed', error: 'No DeepSeek API key was provided.' });

  const outcome = await runChild(task, key);
  const result = parseResult(outcome.stdout);
  const usage = result ? usageFromResult(result) : emptyUsage();
  const summary = (result?.result ?? '').slice(0, SUMMARY_LIMIT);
  const base = { usage, summary, turns: result?.num_turns ?? null };

  if (outcome.error) return finish({ ...base, status: 'failed', error: outcome.error });
  if (outcome.timedOut) {
    return finish({
      ...base,
      status: 'failed',
      error: `Timed out after ${task.timeoutMinutes} minutes.`,
    });
  }
  if (!result) {
    const detail = outcome.stderr.trim().split('\n').slice(-3).join(' ');
    return finish({
      ...base,
      status: 'failed',
      error: `The DeepSeek run returned no result (exit ${outcome.code}). ${detail}`.trim(),
    });
  }
  if (result.is_error) {
    return finish({
      ...base,
      status: 'failed',
      error: `DeepSeek run failed: ${result.result || result.terminal_reason || 'unknown error'}`,
    });
  }

  try {
    const files = commitChanges(task);
    return finish({ ...base, status: 'done', files });
  } catch (error) {
    return finish({ ...base, status: 'failed', error: error.message });
  }
}
