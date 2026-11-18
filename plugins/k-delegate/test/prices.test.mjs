import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savings, savingsLine } from '../lib/prices.mjs';
import { newTaskId, slugify } from '../lib/tasks.mjs';

const usage = (input, output, cacheRead = 0) => ({
  inputTokens: input,
  cacheCreationTokens: 0,
  cacheReadTokens: cacheRead,
  outputTokens: output,
});

test('savings price the same tokens on DeepSeek and on Claude', () => {
  const tasks = [{ usage: usage(1_000_000, 100_000) }, { usage: usage(0, 0, 1_000_000) }];
  const result = savings(tasks, { compareWith: 'opus', prices: {} });
  // deepseek-flash (default): 1M * 0.3 + 1M * 0.006 + 0.1M * 1.2 = 0.426
  assert.equal(result.deepseekUsd, 0.426);
  // Opus: 1M * 4 + 1M * 0.2 + 0.1M * 20 = 6.2
  assert.equal(result.claudeUsd, 6.2);
  assert.equal(result.savedUsd, 5.774);
  assert.equal(
    savingsLine(result),
    'DeepSeek: 2 tasks, 2.1M tokens, $0.43. Same tokens on Claude Opus ≈ $6.20. Estimated savings ≈ $5.77.',
  );
});

test('prices and the comparison model come from kodffe.json', () => {
  const result = savings([{ usage: usage(1_000_000, 0) }], {
    compareWith: 'sonnet',
    prices: { deepseek: { 'deepseek-flash': { input: 1 } } },
  });
  assert.equal(result.deepseekUsd, 1);
  assert.equal(result.claudeUsd, 2);
  assert.equal(result.compareWith, 'Claude Sonnet');
});

test('each task is priced with its own DeepSeek model', () => {
  const tasks = [
    { model: 'deepseek-v4-pro', usage: usage(1_000_000, 0) },
    { model: 'deepseek-flash', usage: usage(1_000_000, 0) },
  ];
  // 1.32 (pro) + 0.3 (flash)
  assert.equal(savings(tasks, { compareWith: 'opus', prices: {} }).deepseekUsd, 1.62);
});

test('task ids are YYMMDD-HHMM-slug', () => {
  assert.equal(
    newTaskId('Add tests for parseDate()', new Date(2026, 10, 18, 9, 5)),
    '261118-0905-add-tests-for-parsedate',
  );
  assert.equal(slugify('Añadir validación ñ'), 'anadir-validacion-n');
  assert.equal(slugify('!!!'), 'task');
});
