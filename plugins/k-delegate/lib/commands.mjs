// Subcommands of the kds CLI. Each returns { data, human }: data for --json, human text
// otherwise. Errors are thrown as CliError with the standard exit codes.

import { rm } from 'node:fs/promises';
import { configPath, updateSection } from './_shared/config.mjs';
import { CliError, EXIT, assertNotChild } from './_shared/cli.mjs';
import { git } from './_shared/git.mjs';
import { emptyUsage, formatTokens, savings, savingsLine, totalTokens } from './prices.mjs';
import {
  ID,
  assertEnabled,
  loadProject,
  resolveAllowedTools,
  resolveBaseUrl,
  resolveKey,
  resolveModel,
} from './settings.mjs';
import {
  SCHEMA_VERSION,
  branchName,
  listTasks,
  logPath,
  readTask,
  refreshStale,
  uniqueTaskId,
  updateTask,
  worktreePath,
  writeTask,
} from './tasks.mjs';
import { startWorker } from './worker.mjs';

function requireTask(task, id) {
  if (!task) throw new CliError('unknown_task', `No task with id ${id}`, EXIT.USAGE);
  return task;
}

function requireId(positional, usage) {
  if (!positional[0]) throw new CliError('usage', `Usage: ${usage}`, EXIT.USAGE);
  return positional[0];
}

function firstLine(text, max = 72) {
  const line = text.trim().split('\n')[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function publicTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    branch: task.branch,
    worktree: task.worktree,
    files: task.files ?? [],
    tokens: totalTokens(task.usage ?? emptyUsage()),
    createdAt: task.createdAt,
    endedAt: task.endedAt ?? null,
    error: task.error ?? null,
  };
}

// ---------------------------------------------------------------- run

export async function run({ positional, flags }) {
  assertNotChild(ID);
  const project = await loadProject();
  assertEnabled(project);

  const brief = (positional.join(' ') || (await readStdin())).trim();
  if (!brief) {
    throw new CliError('usage', 'Usage: kds run "<task>" (or pass the brief on stdin)', EXIT.USAGE);
  }

  const active = (
    await Promise.all((await listTasks(project)).map((t) => refreshStale(project, t)))
  ).filter((task) => task.status === 'queued' || task.status === 'running');
  if (active.length >= project.settings.maxParallel) {
    throw new CliError(
      'too_many_tasks',
      `${active.length} DeepSeek tasks are already running (maxParallel ${project.settings.maxParallel}). Wait for one to finish.`,
    );
  }

  const title = firstLine(flags.title || brief, 60);
  const id = await uniqueTaskId(project, title);
  // Snapshot of the working tree, uncommitted tracked changes included, without touching it.
  const baseCommit =
    git(['stash', 'create'], { cwd: project.root }) ||
    git(['rev-parse', 'HEAD'], { cwd: project.root });
  const worktree = worktreePath(project, id);
  const branch = branchName(id);
  git(['worktree', 'add', '-q', '-b', branch, worktree, baseCommit], { cwd: project.root });

  const task = await writeTask(project, {
    schemaVersion: SCHEMA_VERSION,
    id,
    title,
    brief,
    status: 'queued',
    sessionId: flags.session || null,
    branch,
    worktree,
    baseCommit,
    model: resolveModel(project.settings),
    baseUrl: resolveBaseUrl(project.settings),
    maxTurns: project.settings.maxTurns,
    timeoutMinutes: project.settings.timeoutMinutes,
    allowedTools: resolveAllowedTools(project.settings, project.common),
    verify: flags.verify || project.common.verify || null,
    createdAt: new Date().toISOString(),
    pid: null,
    endedAt: null,
    usage: emptyUsage(),
    files: [],
    summary: null,
    error: null,
  });

  // From a terminal with KDS_API_KEY the worker starts now. Inside Claude Code the key lives
  // in the plugin settings, which only hooks can read: the PostToolUse hook starts it.
  const { key } = resolveKey();
  const started = key ? await startWorker(project, id, key) : false;
  const status = started ? 'running' : 'queued';
  return {
    data: { ...publicTask(task), status },
    human: started
      ? `Delegated to DeepSeek: ${title} [${id}]`
      : `Queued for DeepSeek: ${title} [${id}]. The plugin hook starts it; from a terminal set KDS_API_KEY.`,
  };
}

// ---------------------------------------------------------------- wait

export async function wait({ positional, flags }) {
  const project = await loadProject();
  assertEnabled(project);
  const ids = positional.length
    ? positional
    : (await listTasks(project))
        .filter((task) => task.status === 'queued' || task.status === 'running')
        .map((task) => task.id);
  const timeoutMs = Number(flags.timeout ?? project.settings.timeoutMinutes + 2) * 60_000;
  const deadline = Date.now() + timeoutMs;
  const interval = Number(process.env.KDS_POLL_MS || 1000);

  let tasks;
  for (;;) {
    tasks = await Promise.all(
      ids.map(async (id) => refreshStale(project, requireTask(await readTask(project, id), id))),
    );
    const pending = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
    if (pending.length === 0 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  const lines = tasks.map(
    (task) => `${task.id}: ${task.status}${task.error ? ` (${task.error})` : ''}`,
  );
  return { data: tasks.map(publicTask), human: lines.join('\n') || 'No tasks to wait for.' };
}

// ---------------------------------------------------------------- status

export async function status({ positional, flags }) {
  const project = await loadProject();
  if (project.settings.enabled !== true && positional.length === 0) {
    return {
      data: { enabled: false, tasks: [] },
      human: 'k-delegate: disabled in this project.',
    };
  }
  let tasks = await Promise.all(
    (await listTasks(project)).map((task) => refreshStale(project, task)),
  );
  if (positional[0])
    tasks = [
      requireTask(
        tasks.find((task) => task.id === positional[0]),
        positional[0],
      ),
    ];
  else if (!flags.all) tasks = tasks.filter((task) => !task.cleaned);

  const used = tasks.filter((task) => totalTokens(task.usage ?? emptyUsage()) > 0);
  const summary = savings(used, project.settings);
  const lines = tasks.map((task) => {
    const usage = task.usage ?? emptyUsage();
    const files = task.files?.length ? `, ${task.files.length} file(s)` : '';
    const tokens = totalTokens(usage) ? `, ${formatTokens(totalTokens(usage))} tokens` : '';
    const queuedHint =
      task.status === 'queued' && Date.now() - Date.parse(task.createdAt) > 30_000
        ? ' — waiting for an API key (see /k-delegate:kds config)'
        : '';
    return `${task.id}  ${task.status}${files}${tokens}${queuedHint}${task.error ? ` — ${task.error}` : ''}`;
  });
  if (used.length) lines.push('', savingsLine(summary));
  return {
    data: {
      enabled: project.settings.enabled === true,
      tasks: tasks.map(publicTask),
      savings: summary,
    },
    human: lines.length ? lines.join('\n') : 'k-delegate: enabled, no tasks yet.',
  };
}

// ---------------------------------------------------------------- show

export async function show({ positional, flags }) {
  const project = await loadProject();
  assertEnabled(project);
  const id = requireId(positional, 'kds show <id>');
  const task = await refreshStale(project, requireTask(await readTask(project, id), id));
  const hasBranch = git(['rev-parse', '--verify', '-q', task.branch], {
    cwd: project.root,
    allowFailure: true,
  });
  const range = `${task.baseCommit}..${task.branch}`;
  const stat = hasBranch ? git(['diff', '--stat', range], { cwd: project.root }) : '';
  const diff = hasBranch && !flags.stat ? git(['diff', range], { cwd: project.root }) : null;
  const usage = task.usage ?? emptyUsage();
  const data = {
    ...publicTask(task),
    summary: task.summary,
    verify: task.verify,
    log: logPath(project, id),
    stat,
    diff,
  };
  const human = [
    `${task.id} — ${task.status}: ${task.title}`,
    task.error ? `Error: ${task.error}` : null,
    totalTokens(usage) ? `Tokens: ${formatTokens(totalTokens(usage))}` : null,
    task.summary ? `\nDeepSeek report:\n${task.summary}` : null,
    stat ? `\n${stat}` : null,
    diff ? `\n${diff}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return { data, human };
}

// ---------------------------------------------------------------- apply

export async function apply({ positional }) {
  assertNotChild(ID);
  const project = await loadProject();
  assertEnabled(project);
  const id = requireId(positional, 'kds apply <id>');
  const task = requireTask(await readTask(project, id), id);
  if (task.status !== 'done') {
    throw new CliError(
      'not_ready',
      `Task ${id} is ${task.status}; only a done task can be applied.`,
      EXIT.USAGE,
    );
  }
  const patch = git(['diff', '--binary', `${task.baseCommit}..${task.branch}`], {
    cwd: project.root,
  });
  if (!patch)
    throw new CliError(
      'empty',
      `Task ${id} changed nothing; there is nothing to apply.`,
      EXIT.USAGE,
    );

  const input = `${patch}\n`;
  try {
    git(['apply', '--check', '--whitespace=nowarn'], { cwd: project.root, input });
  } catch (error) {
    throw new CliError(
      'conflict',
      `The changes of ${id} do not apply cleanly to your working tree. Nothing was changed. ${error.message}`,
      EXIT.CONFLICT,
    );
  }
  git(['apply', '--whitespace=nowarn'], { cwd: project.root, input });
  await updateTask(project, id, () => ({ status: 'applied', appliedAt: new Date().toISOString() }));
  return {
    data: { ...publicTask({ ...task, status: 'applied' }) },
    human: `Applied ${id} to your working tree (not committed): ${(task.files ?? []).join(', ')}`,
  };
}

// ---------------------------------------------------------------- clean

export async function clean({ positional }) {
  assertNotChild(ID);
  const project = await loadProject();
  assertEnabled(project);
  let targets;
  if (positional[0]) {
    const task = await refreshStale(
      project,
      requireTask(await readTask(project, positional[0]), positional[0]),
    );
    if (task.status === 'queued' || task.status === 'running') {
      throw new CliError('running', `Task ${task.id} is still ${task.status}.`, EXIT.USAGE);
    }
    targets = [task];
  } else {
    const tasks = await Promise.all(
      (await listTasks(project)).map((task) => refreshStale(project, task)),
    );
    targets = tasks.filter(
      (task) => !task.cleaned && ['applied', 'failed', 'discarded'].includes(task.status),
    );
  }

  for (const task of targets) {
    git(['worktree', 'remove', '--force', task.worktree], {
      cwd: project.root,
      allowFailure: true,
    });
    await rm(task.worktree, { recursive: true, force: true });
    git(['branch', '-D', task.branch], { cwd: project.root, allowFailure: true });
    await updateTask(project, task.id, (current) => ({
      cleaned: true,
      status: current.status === 'done' ? 'discarded' : current.status,
    }));
  }
  git(['worktree', 'prune'], { cwd: project.root, allowFailure: true });
  return {
    data: { cleaned: targets.map((task) => task.id) },
    human: targets.length
      ? `Cleaned: ${targets.map((task) => task.id).join(', ')}`
      : 'Nothing to clean.',
  };
}

// ---------------------------------------------------------------- on / off

export async function setEnabled(enabled) {
  assertNotChild(ID);
  const project = await loadProject();
  await updateSection(project.root, ID, { enabled });
  const path = configPath(project.root);
  return {
    data: { enabled, config: path },
    human: `k-delegate ${enabled ? 'enabled' : 'disabled'} in ${path}. Commit it to share with the team.`,
  };
}

// ---------------------------------------------------------------- config

async function verifyKey(baseUrl, model, key) {
  try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true, message: 'API key works' };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `API key rejected (HTTP ${response.status})` };
    }
    return { ok: false, message: `Unexpected response HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, message: `Could not reach ${baseUrl}: ${error.message}` };
  }
}

export async function config({ flags }) {
  const project = await loadProject();
  const settings = project.settings;
  const { key, source } = resolveKey();
  const model = resolveModel(settings);
  const baseUrl = resolveBaseUrl(settings);
  let check = null;
  if (settings.enabled === true && key && !flags.offline)
    check = await verifyKey(baseUrl, model, key);

  const keyText = key
    ? `set (${source})`
    : 'not visible here. Inside Claude Code it lives in the plugin settings (/plugin configure k-delegate@kodffe) and is checked on the first run; from a terminal set KDS_API_KEY.';
  const data = {
    enabled: settings.enabled === true,
    model,
    baseUrl,
    apiKey: key ? `set (${source})` : 'not visible',
    keyCheck: check,
    notify: settings.notify,
    maxTurns: settings.maxTurns,
    timeoutMinutes: settings.timeoutMinutes,
    maxParallel: settings.maxParallel,
    allowedTools: resolveAllowedTools(settings, project.common),
    verify: project.common.verify ?? null,
    compareWith: settings.compareWith,
    configFile: configPath(project.root),
    stateDir: project.stateDir,
  };
  const human = [
    `Enabled:      ${data.enabled ? 'yes' : 'no (run /k-delegate:kds on)'}`,
    `Model:        ${model}`,
    `Endpoint:     ${baseUrl}`,
    `API key:      ${keyText}`,
    check ? `Key check:    ${check.message}` : null,
    `Limits:       ${settings.maxTurns} turns, ${settings.timeoutMinutes} min, ${settings.maxParallel} parallel`,
    `Verify:       ${data.verify ?? '(none; set common.verify)'}`,
    `Savings vs:   ${settings.compareWith}`,
    `Config file:  ${data.configFile}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { data, human };
}
