import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { makeRepo, sh } from './helpers.mjs';

function startTask(kds, brief, args = []) {
  const started = kds(['run', '--json', '--title', 'test task', ...args], { input: brief });
  assert.equal(started.code, 0, started.stdout + started.stderr);
  return started.json.data.id;
}

test('--version, --help and a disabled project', async (t) => {
  const { kds } = await makeRepo(t, { config: null });
  assert.equal(kds(['--version']).stdout.trim(), '0.1.0');
  assert.equal(kds(['--help']).code, 0);

  const run = kds(['run', '--json', 'do something']);
  assert.equal(run.code, 3);
  assert.equal(run.json.error.code, 'disabled');

  const status = kds(['status', '--json']);
  assert.equal(status.code, 0);
  assert.equal(status.json.data.enabled, false);
  assert.equal(kds(['config', '--json', '--offline']).code, 0);
});

test('refuses to run inside a child process (KODFFE_CHILD)', async (t) => {
  const { kds } = await makeRepo(t);
  const run = kds(['run', '--json', 'x'], { extraEnv: { KODFFE_CHILD: 'kds' } });
  assert.equal(run.code, 4);
  assert.equal(run.json.error.code, 'recursion');
});

test('run, wait, show, apply and clean a task, keeping uncommitted work', async (t) => {
  const { root, kds, records } = await makeRepo(t);
  // Uncommitted work in the developer's tree must be part of the task's base.
  await writeFile(join(root, 'a.txt'), 'work in progress\n');

  const id = startTask(kds, 'Create b.txt\nWRITE b.txt hello from deepseek\n');
  assert.match(id, /^\d{6}-\d{4}-test-task$/);

  const waited = kds(['wait', id, '--json']);
  assert.equal(waited.code, 0);
  assert.equal(waited.json.data[0].status, 'done', JSON.stringify(waited.json));
  assert.deepEqual(waited.json.data[0].files, ['b.txt']);

  const [call] = await records();
  assert.equal(call.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(call.env.ANTHROPIC_API_KEY, 'test-key');
  assert.equal(call.env.ANTHROPIC_MODEL, 'deepseek-flash');
  assert.equal(call.env.KODFFE_CHILD, 'kds');
  assert.equal(call.env.KDS_API_KEY, null, 'the child must not inherit KDS_* variables');
  assert.ok(call.argv.includes('--bare'));
  assert.ok(!call.argv.includes('--dangerously-skip-permissions'));
  assert.equal(await readFile(join(call.cwd, 'a.txt'), 'utf8'), 'work in progress\n');

  const shown = kds(['show', id, '--json']);
  assert.equal(shown.json.data.summary, 'Done: wrote the requested files.');
  assert.match(shown.json.data.diff, /\+hello from deepseek/);

  const applied = kds(['apply', id, '--json']);
  assert.equal(applied.code, 0, applied.stdout);
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), 'hello from deepseek\n');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'work in progress\n');
  assert.equal(sh(root, 'diff', '--cached', '--name-only'), '', 'apply must not stage anything');
  assert.equal(sh(root, 'log', '--oneline').split('\n').length, 1, 'apply must not commit');

  const status = kds(['status', '--json']);
  assert.equal(status.json.data.tasks[0].status, 'applied');
  assert.equal(status.json.data.savings.tasks, 1);
  assert.equal(status.json.data.savings.tokens, 3500);

  const cleaned = kds(['clean', '--json']);
  assert.deepEqual(cleaned.json.data.cleaned, [id]);
  assert.equal(existsSync(call.cwd), false);
  assert.equal(sh(root, 'branch', '--list', `kds/${id}`), '');
});

test('a failed DeepSeek run is reported and cannot be applied', async (t) => {
  const { kds } = await makeRepo(t);
  const id = startTask(kds, 'FAKE_FAIL');
  const waited = kds(['wait', id, '--json']);
  assert.equal(waited.json.data[0].status, 'failed');
  assert.match(waited.json.data[0].error, /Authentication failed/);
  assert.equal(kds(['apply', id, '--json']).code, 2);
});

test('apply stops with exit 5 when the working tree conflicts', async (t) => {
  const { root, kds } = await makeRepo(t);
  const id = startTask(kds, 'WRITE a.txt from deepseek');
  assert.equal(kds(['wait', id, '--json']).json.data[0].status, 'done');

  await writeFile(join(root, 'a.txt'), 'changed by the developer meanwhile\n');
  const applied = kds(['apply', id, '--json']);
  assert.equal(applied.code, 5);
  assert.equal(applied.json.error.code, 'conflict');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'changed by the developer meanwhile\n');
});

test('a run that takes too long is stopped', async (t) => {
  const { kds } = await makeRepo(t, { config: { kds: { enabled: true, timeoutMinutes: 0.005 } } });
  const id = startTask(kds, 'FAKE_SLEEP');
  const waited = kds(['wait', id, '--json', '--timeout', '0.5']);
  assert.equal(waited.json.data[0].status, 'failed');
  assert.match(waited.json.data[0].error, /Timed out/);
});

test('maxParallel limits active tasks', async (t) => {
  const { kds } = await makeRepo(t, {
    config: { kds: { enabled: true, maxParallel: 1 } },
    key: null,
  });
  startTask(kds, 'first'); // stays queued: no key outside a hook
  const second = kds(['run', '--json', 'second']);
  assert.equal(second.code, 1);
  assert.equal(second.json.error.code, 'too_many_tasks');
});

test('on and off keep the other sections of kodffe.json', async (t) => {
  const { root, kds } = await makeRepo(t, {
    config: { common: { verify: 'npm test' }, other: { enabled: true } },
  });
  assert.equal(kds(['on', '--json']).code, 0);
  let file = JSON.parse(await readFile(join(root, '.claude', 'kodffe.json'), 'utf8'));
  assert.deepEqual(file, {
    common: { verify: 'npm test' },
    other: { enabled: true },
    kds: { enabled: true },
  });
  kds(['off', '--json']);
  file = JSON.parse(await readFile(join(root, '.claude', 'kodffe.json'), 'utf8'));
  assert.equal(file.kds.enabled, false);
  assert.equal(file.other.enabled, true);
});

test('config checks the key without ever printing it', async (t) => {
  const server = createServer((request, response) => {
    const ok = request.headers['x-api-key'] === 'good-key';
    response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { kdsAsync } = await makeRepo(t, { key: 'good-key' });
  const good = await kdsAsync(['config', '--json'], { extraEnv: { KDS_BASE_URL: baseUrl } });
  assert.equal(good.json.data.keyCheck.ok, true);
  assert.ok(!good.stdout.includes('good-key'));

  const bad = await kdsAsync(['config'], {
    extraEnv: { KDS_BASE_URL: baseUrl, KDS_API_KEY: 'bad-key' },
  });
  assert.match(bad.stdout, /rejected \(HTTP 401\)/);
  assert.ok(!bad.stdout.includes('bad-key'));
});
