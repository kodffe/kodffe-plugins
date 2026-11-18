// Test helpers: a real temporary git repository, an isolated KODFFE_HOME and the fake claude.

import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = fileURLToPath(new URL('../bin/kds.mjs', import.meta.url));
export const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

export function sh(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Inherited environment without anything that would change the plugin's behavior. */
function baseEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(KDS_|KODFFE_|CLAUDE_PLUGIN_OPTION_|ANTHROPIC_)/.test(name)) continue;
    env[name] = value;
  }
  return env;
}

export async function makeRepo(t, { config = { kds: { enabled: true } }, key = 'test-key' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kds-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo');
  await mkdir(root);
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.name', 'Test');
  sh(root, 'config', 'user.email', 'test@example.com');
  await writeFile(join(root, 'a.txt'), 'original\n');
  if (config) {
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude', 'kodffe.json'), JSON.stringify(config, null, 2));
  }
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'init');

  const record = join(dir, 'record.jsonl');
  const env = {
    ...baseEnv(),
    KODFFE_HOME: join(dir, 'home'),
    KDS_CLAUDE_BIN: FAKE_CLAUDE,
    KDS_POLL_MS: '50',
    FAKE_RECORD: record,
  };
  if (key) env.KDS_API_KEY = key;

  const kds = (args, { input, extraEnv = {}, removeEnv = [] } = {}) => {
    const runEnv = { ...env, ...extraEnv };
    for (const name of removeEnv) delete runEnv[name];
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: root,
      env: runEnv,
      input: input ?? '',
      encoding: 'utf8',
      timeout: 30_000,
    });
    let json = null;
    try {
      json = JSON.parse(result.stdout);
    } catch {
      // human output
    }
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, json };
  };

  // Async variant, for tests that serve HTTP from this same process.
  const kdsAsync = (args, { extraEnv = {} } = {}) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [BIN, ...args],
        { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30_000 },
        (error, stdout, stderr) => {
          let json = null;
          try {
            json = JSON.parse(stdout);
          } catch {
            // human output
          }
          resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr, json });
        },
      );
    });

  const records = async () => {
    try {
      return (await readFile(record, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };

  return { dir, root, env, kds, kdsAsync, records };
}
