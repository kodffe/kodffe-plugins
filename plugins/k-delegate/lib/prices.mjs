// Prices in USD per million tokens. Public prices change: every value can be overridden in
// .claude/kodffe.json under kds.prices. Claude prices as of 2026-11. DeepSeek prices are its
// published peak rates (2026-11; off-peak is half), so the savings estimate stays conservative.

import { DEFAULT_MODEL } from './settings.mjs';

export const DEFAULT_PRICES = Object.freeze({
  deepseek: {
    'deepseek-flash': { input: 0.3, cacheRead: 0.006, output: 1.2 },
    'deepseek-v4-pro': { input: 1.32, cacheRead: 0.044, output: 3.96 },
  },
  claude: {
    opus: { label: 'Claude Opus', input: 4, cacheRead: 0.2, output: 20 },
    sonnet: { label: 'Claude Sonnet', input: 2, cacheRead: 0.1, output: 10 },
    haiku: { label: 'Claude Haiku', input: 0.1, cacheRead: 0.01, output: 0.5 },
  },
});

const CACHE_WRITE_MULTIPLIER = 1.25;

export function emptyUsage() {
  return { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

/** Maps the usage block of `claude -p --output-format json` to our fields. */
export function usageFromResult(result) {
  const usage = result?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

export function totalTokens(usage) {
  return usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens + usage.outputTokens;
}

export function priceTable(settings) {
  const overrides = settings.prices ?? {};
  const claude = { ...DEFAULT_PRICES.claude };
  for (const [name, value] of Object.entries(overrides.claude ?? {})) {
    claude[name] = { ...(claude[name] ?? { label: name }), ...value };
  }
  const deepseek = { ...DEFAULT_PRICES.deepseek };
  for (const [name, value] of Object.entries(overrides.deepseek ?? {})) {
    deepseek[name] = { ...(deepseek[name] ?? DEFAULT_PRICES.deepseek[DEFAULT_MODEL]), ...value };
  }
  return { deepseek, claude };
}

/** Prices of a DeepSeek model; unknown names are priced as the default model. */
export function deepseekPrices(prices, model) {
  return prices.deepseek[model] ?? prices.deepseek[DEFAULT_MODEL];
}

export function deepseekCost(usage, p) {
  const fresh = usage.inputTokens + usage.cacheCreationTokens;
  return (
    (fresh * p.input + usage.cacheReadTokens * p.cacheRead + usage.outputTokens * p.output) / 1e6
  );
}

export function claudeCost(usage, model) {
  return (
    (usage.inputTokens * model.input +
      usage.cacheCreationTokens * model.input * CACHE_WRITE_MULTIPLIER +
      usage.cacheReadTokens * model.cacheRead +
      usage.outputTokens * model.output) /
    1e6
  );
}

export function sumUsage(usages) {
  const total = emptyUsage();
  for (const usage of usages) {
    for (const key of Object.keys(total)) total[key] += usage?.[key] ?? 0;
  }
  return total;
}

/** Estimated savings for a set of tasks: same tokens priced on Claude minus DeepSeek's cost. */
export function savings(tasks, settings) {
  const prices = priceTable(settings);
  const compare = prices.claude[settings.compareWith] ?? prices.claude.opus;
  const usage = sumUsage(tasks.map((task) => task.usage));
  let spent = 0;
  for (const task of tasks) {
    spent += deepseekCost(task.usage ?? emptyUsage(), deepseekPrices(prices, task.model));
  }
  const onClaude = claudeCost(usage, compare);
  return {
    tasks: tasks.length,
    tokens: totalTokens(usage),
    deepseekUsd: round(spent),
    claudeUsd: round(onClaude),
    savedUsd: round(onClaude - spent),
    compareWith: compare.label,
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

export function formatTokens(tokens) {
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}k`;
  return String(tokens);
}

export function formatUsd(value) {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;
}

export function savingsLine(summary) {
  const tasks = summary.tasks === 1 ? '1 task' : `${summary.tasks} tasks`;
  return (
    `DeepSeek: ${tasks}, ${formatTokens(summary.tokens)} tokens, ${formatUsd(summary.deepseekUsd)}. ` +
    `Same tokens on ${summary.compareWith} ≈ ${formatUsd(summary.claudeUsd)}. ` +
    `Estimated savings ≈ ${formatUsd(summary.savedUsd)}.`
  );
}
