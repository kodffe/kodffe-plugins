import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers.mjs';

function hook(kds, name, input, extraEnv = {}) {
  const result = kds(['_hook', name], { input: JSON.stringify(input), extraEnv });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

const bash = (root, command) => ({
  cwd: root,
  session_id: 'session-1',
  tool_name: 'Bash',
  tool_input: { command },
});

test('session-start adds context only when enabled, and warns without a key', async (t) => {
  const enabled = await makeRepo(t, { key: null });
  const withKey = hook(
    enabled.kds,
    'session-start',
    { cwd: enabled.root },
    {
      CLAUDE_PLUGIN_OPTION_API_KEY: 'k',
    },
  );
  assert.match(withKey.hookSpecificOutput.additionalContext, /k-delegate:delegate/);
  assert.equal(withKey.systemMessage, undefined);

  const noKey = hook(enabled.kds, 'session-start', { cwd: enabled.root });
  assert.match(noKey.systemMessage, /no DeepSeek API key/);
  assert.match(noKey.hookSpecificOutput.additionalContext, /do not delegate/);

  const disabled = await makeRepo(t, { config: null });
  assert.equal(hook(disabled.kds, 'session-start', { cwd: disabled.root }), null);
});

test('post-tool-use starts a queued task with the plugin key and announces it once', async (t) => {
  const { root, kds, records } = await makeRepo(t, { key: null });
  const started = kds(['run', '--json', '--session', 'session-1', '--title', 'Add b'], {
    input: 'WRITE b.txt hi',
  });
  assert.equal(started.json.data.status, 'queued');
  const { id } = started.json.data;
  const command = `node "/x/bin/kds.mjs" run --json --title "Add b"`;
  const pluginKey = {
    CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key',
    CLAUDE_PLUGIN_OPTION_MODEL: 'deepseek-v4-pro',
  };

  // Unrelated Bash commands are ignored without touching the repository.
  assert.equal(hook(kds, 'post-tool-use', bash(root, 'npm test'), pluginKey), null);

  const first = hook(kds, 'post-tool-use', bash(root, command), pluginKey);
  assert.equal(first.systemMessage, `🔀 Delegated to DeepSeek: Add b [${id}]`);
  assert.equal(hook(kds, 'post-tool-use', bash(root, command), pluginKey), null);

  assert.equal(kds(['wait', id, '--json']).json.data[0].status, 'done');
  const [call] = await records();
  assert.equal(call.env.ANTHROPIC_API_KEY, 'plugin-key');
  // The model picked in the plugin settings reaches the worker, though Bash never saw it.
  assert.equal(call.env.ANTHROPIC_MODEL, 'deepseek-v4-pro');
  assert.equal(call.env.CLAUDE_PLUGIN_OPTION_API_KEY, null);

  // Stop: one savings line for this session, then silence.
  const stop = hook(kds, 'stop', { cwd: root, session_id: 'session-1' });
  assert.match(
    stop.systemMessage,
    /^DeepSeek: 1 task, 4k tokens, <\$0\.01\. Same tokens on Claude Opus ≈ \$0\.01\. Estimated savings ≈ \$0\.01\.$/,
  );
  assert.equal(hook(kds, 'stop', { cwd: root, session_id: 'session-1' }), null);
});

test('stop ignores tasks of other sessions and turns without DeepSeek work', async (t) => {
  const { root, kds } = await makeRepo(t);
  assert.equal(hook(kds, 'stop', { cwd: root, session_id: 's' }), null);
  const { id } = kds(['run', '--json', '--session', 'other'], { input: 'WRITE c.txt x' }).json.data;
  kds(['wait', id, '--json']);
  assert.equal(hook(kds, 'stop', { cwd: root, session_id: 's' }), null);
  assert.ok(hook(kds, 'stop', { cwd: root, session_id: 'other' }).systemMessage);
});

test('post-tool-use fails a queued task when no key is configured', async (t) => {
  const { root, kds } = await makeRepo(t, { key: null });
  const { id } = kds(['run', '--json'], { input: 'WRITE b.txt hi' }).json.data;
  const output = hook(kds, 'post-tool-use', bash(root, 'node kds.mjs run'));
  assert.match(output.systemMessage, /no API key/);
  assert.equal(kds(['status', id, '--json']).json.data.tasks[0].status, 'failed');
});

test('hooks stay silent inside a child process', async (t) => {
  const { root, kds } = await makeRepo(t);
  const input = { cwd: root };
  assert.equal(hook(kds, 'session-start', input, { KODFFE_CHILD: 'kds' }), null);
});
