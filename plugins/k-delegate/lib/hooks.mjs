// Hook handlers. They read the hook input JSON from stdin, never use the network, finish in
// well under 2 seconds and stay silent when the plugin is disabled or inside a child run.
// Claude Code exports the plugin's userConfig values (API key, model) to hook processes only,
// which is why starting queued workers happens here.

import { fileURLToPath } from 'node:url';
import { emptyUsage, savings, savingsLine, totalTokens } from './prices.mjs';
import { ID, loadProject, resolveKey, resolveModel } from './settings.mjs';
import { FINISHED, listTasks, mark, updateTask } from './tasks.mjs';
import { startWorker } from './worker.mjs';

const BIN = fileURLToPath(new URL('../bin/kds.mjs', import.meta.url));
const KDS_COMMAND = /kds\.mjs\b/;
const CONFIGURE = '/plugin configure k-delegate@kodffe';

async function readInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

async function enabledProject(input) {
  if (process.env.KODFFE_CHILD) return null;
  try {
    const project = await loadProject(input.cwd || process.cwd());
    return project.settings.enabled === true ? project : null;
  } catch {
    return null;
  }
}

function sessionContext(hasKey) {
  const cli = `node "${BIN}"`;
  if (!hasKey) {
    return (
      'k-delegate is enabled in this project, but no DeepSeek API key is configured, ' +
      'so do not delegate tasks to DeepSeek in this session. If the user asks, tell them to run ' +
      `${CONFIGURE}.`
    );
  }
  return [
    'k-delegate is enabled in this project. You can hand small, well-scoped coding tasks',
    'to a cheaper DeepSeek model to save Claude tokens. DeepSeek works in an isolated git worktree',
    'and you always review its diff before applying it. Delegate only tasks that need many reads',
    'or iterations but produce a small, checkable diff (tests for a given function, the same change',
    'across files, boilerplate, docs, simple refactors). Do it yourself for one-line edits, design',
    'decisions, bugs with unknown causes and security-sensitive code. Follow the',
    'k-delegate:delegate skill for the steps.',
    `The CLI is: ${cli}`,
  ].join(' ');
}

export async function sessionStart() {
  const input = await readInput();
  const project = await enabledProject(input);
  if (!project) return null;
  const hasKey = Boolean(resolveKey().key);
  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionContext(hasKey),
    },
  };
  if (!hasKey) {
    output.systemMessage = `k-delegate is enabled here but has no DeepSeek API key. Run ${CONFIGURE}.`;
  }
  return output;
}

/** After a kds command: start queued workers with the hook's key and announce new tasks. */
export async function postToolUse() {
  const input = await readInput();
  if (input.tool_name !== 'Bash' || !KDS_COMMAND.test(input.tool_input?.command ?? '')) return null;
  const project = await enabledProject(input);
  if (!project) return null;

  const { key } = resolveKey();
  const messages = [];
  for (const task of await listTasks(project)) {
    if (task.status === 'queued') {
      if (key) {
        await startWorker(project, task.id, key, resolveModel(project.settings));
      } else if (await mark(project, 'claims', task.id)) {
        await updateTask(project, task.id, () => ({
          status: 'failed',
          endedAt: new Date().toISOString(),
          error: `No DeepSeek API key. Run ${CONFIGURE}.`,
        }));
        messages.push(`DeepSeek task not started: no API key. Run ${CONFIGURE}.`);
        continue;
      }
    }
    if (
      project.settings.notify !== false &&
      (task.status === 'queued' || task.status === 'running') &&
      (await mark(project, 'announced', task.id))
    ) {
      messages.push(`🔀 Delegated to DeepSeek: ${task.title} [${task.id}]`);
    }
  }
  return messages.length ? { systemMessage: messages.join('\n') } : null;
}

/** End of a turn: one savings line for DeepSeek work not reported yet. Never blocks. */
export async function stop() {
  const input = await readInput();
  const project = await enabledProject(input);
  if (!project || project.settings.notify === false) return null;

  const fresh = [];
  for (const task of await listTasks(project)) {
    if (!FINISHED.has(task.status)) continue;
    if (task.sessionId && input.session_id && task.sessionId !== input.session_id) continue;
    if (totalTokens(task.usage ?? emptyUsage()) === 0) continue;
    if (await mark(project, 'reported', task.id)) fresh.push(task);
  }
  if (fresh.length === 0) return null;
  return { systemMessage: savingsLine(savings(fresh, project.settings)) };
}

export const HOOKS = { 'session-start': sessionStart, 'post-tool-use': postToolUse, stop };
export { ID };
