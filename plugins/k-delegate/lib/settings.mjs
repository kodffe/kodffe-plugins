// Effective settings for k-delegate: project config, personal variables and the
// values Claude Code passes from the plugin's userConfig (hooks only).

import { loadConfig } from './_shared/config.mjs';
import { CliError, EXIT } from './_shared/cli.mjs';
import { repoRoot } from './_shared/git.mjs';
import { stateDir } from './_shared/state.mjs';

export const ID = 'kds';
// Model ids DeepSeek's Anthropic-compatible API accepts (api-docs.deepseek.com, 2026-11).
// Any other name that does not start with "claude" is rejected with HTTP 400.
export const MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);
export const DEFAULT_MODEL = 'deepseek-flash';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';

export const DEFAULTS = Object.freeze({
  enabled: false,
  notify: true,
  maxTurns: 30,
  timeoutMinutes: 15,
  maxParallel: 3,
  allowedTools: null,
  compareWith: 'opus',
  prices: {},
  model: null,
  baseUrl: null,
});

const BASE_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
];

/**
 * The API key never comes from a file. KDS_API_KEY (personal environment) wins; otherwise
 * Claude Code exports the sensitive userConfig value to hook processes only.
 */
export function resolveKey(env = process.env) {
  if (env.KDS_API_KEY) return { key: env.KDS_API_KEY, source: 'KDS_API_KEY' };
  if (env.CLAUDE_PLUGIN_OPTION_API_KEY) {
    return { key: env.CLAUDE_PLUGIN_OPTION_API_KEY, source: 'plugin settings' };
  }
  return { key: null, source: null };
}

export function resolveModel(settings, env = process.env) {
  return env.KDS_MODEL || env.CLAUDE_PLUGIN_OPTION_MODEL || settings.model || DEFAULT_MODEL;
}

export function resolveBaseUrl(settings, env = process.env) {
  return (env.KDS_BASE_URL || settings.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function resolveAllowedTools(settings, common) {
  if (Array.isArray(settings.allowedTools)) return settings.allowedTools;
  const tools = [...BASE_TOOLS];
  if (common.verify) tools.push(`Bash(${common.verify}:*)`);
  return tools;
}

/** Loads the repository, its kodffe config and the plugin's state folder. */
export async function loadProject(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  if (!root) throw new CliError('not_a_repo', 'Not inside a git repository', EXIT.USAGE);
  const { common, section } = await loadConfig(root, ID, DEFAULTS);
  return { root, common, settings: section, stateDir: stateDir(root, ID) };
}

export function assertEnabled(project) {
  if (project.settings.enabled !== true) {
    throw new CliError(
      'disabled',
      'k-delegate is not enabled in this project. Run "/k-delegate:kds on" (or "kds.mjs on").',
      EXIT.DISABLED,
    );
  }
}
