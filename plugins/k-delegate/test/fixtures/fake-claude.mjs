#!/usr/bin/env node
// Stands in for `claude -p` in tests. Reads the brief on stdin and follows simple commands:
//   WRITE <path> <text>   writes a file in the worktree
//   FAKE_FAIL             returns an error result
//   FAKE_SLEEP            never answers (for timeouts)
// Records argv and the relevant environment in $FAKE_RECORD.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let brief = '';
for await (const chunk of process.stdin) brief += chunk;

if (process.env.FAKE_RECORD) {
  const env = {};
  for (const name of [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'KODFFE_CHILD',
    'KDS_API_KEY',
    'CLAUDE_PLUGIN_OPTION_API_KEY',
  ]) {
    env[name] = process.env[name] ?? null;
  }
  appendFileSync(
    process.env.FAKE_RECORD,
    `${JSON.stringify({ argv: process.argv.slice(2), env, cwd: process.cwd(), brief })}\n`,
  );
}

if (brief.includes('FAKE_SLEEP')) await new Promise(() => setInterval(() => {}, 1000));

const usage = {
  input_tokens: 1000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 2000,
  output_tokens: 500,
};

if (brief.includes('FAKE_FAIL')) {
  process.stdout.write(
    `${JSON.stringify({ type: 'result', is_error: true, result: 'Authentication failed', usage, num_turns: 1 })}\n`,
  );
  process.exit(1);
}

for (const line of brief.split('\n')) {
  const match = line.match(/^WRITE (\S+) (.*)$/);
  if (!match) continue;
  const path = join(process.cwd(), match[1]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${match[2]}\n`);
}
process.stdout.write(
  `${JSON.stringify({ type: 'result', is_error: false, result: 'Done: wrote the requested files.', usage, num_turns: 3 })}\n`,
);
