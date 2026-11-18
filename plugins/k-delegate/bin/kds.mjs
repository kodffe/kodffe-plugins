#!/usr/bin/env node
// kds: CLI of the k-delegate plugin. Public API for the /k-delegate:kds command, the
// k-delegate:delegate skill, the plugin hooks and team scripts.

import { readFileSync } from 'node:fs';
import { CliError, EXIT, parseArgs, printError, printResult } from '../lib/_shared/cli.mjs';
import { createLogger } from '../lib/_shared/log.mjs';
import * as commands from '../lib/commands.mjs';
import { HOOKS } from '../lib/hooks.mjs';
import { ID, loadProject } from '../lib/settings.mjs';
import { runWorker } from '../lib/worker.mjs';

const log = createLogger(ID);

const HELP = `k-delegate (/k-delegate:kds): delegate small Claude Code tasks to DeepSeek.

Usage: kds.mjs <subcommand> [options]

Subcommands:
  run "<task>"     Start a DeepSeek task in its own git worktree (brief also on stdin)
                   --title <text>  short title   --verify <cmd>  check command
                   --session <id>  Claude session that owns the task
  wait [id...]     Block until the tasks finish (default: all active)  --timeout <min>
  status [id]      List tasks, tokens and estimated savings  --all includes cleaned
  show <id>        DeepSeek's report, changed files and diff  --stat skips the diff
  apply <id>       Apply a done task's diff to your working tree, uncommitted
  clean [id]       Remove worktrees and branches of finished tasks
  on|off           Turn the plugin on or off for this project (.claude/kodffe.json)
  config           Effective configuration; checks the API key  --offline skips it

Options: --json (all subcommands), --help, --version

Variables:
  KDS_API_KEY       DeepSeek API key (terminal; in Claude Code use the plugin settings)
  KDS_MODEL         deepseek-flash (default, cheapest) or deepseek-v4-pro (stronger)
  KDS_BASE_URL      Anthropic-compatible endpoint (default https://api.deepseek.com/anthropic)
  KODFFE_LOG_LEVEL  error | warn | info | debug

Exit codes: 0 ok, 1 error, 2 usage or config, 3 disabled, 4 recursion, 5 conflict`;

const OPTIONS = {
  booleans: ['json', 'help', 'version', 'all', 'stat', 'offline'],
  strings: ['title', 'verify', 'session', 'timeout'],
};

function version() {
  const manifest = new URL('../.claude-plugin/plugin.json', import.meta.url);
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

async function hook(name) {
  const handler = HOOKS[name];
  if (!handler) throw new CliError('usage', `Unknown hook ${name}`, EXIT.USAGE);
  try {
    const output = await handler();
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    // A hook must never break the user's session.
    log.warn(`hook ${name} failed: ${error.message}`);
  }
  return EXIT.OK;
}

async function main(argv) {
  const [subcommand, ...rest] = argv;
  if (subcommand === '_hook') return hook(rest[0]);
  if (subcommand === '_work') {
    await runWorker(await loadProject(), rest[0]);
    return EXIT.OK;
  }

  const { positional, flags } = parseArgs(argv, OPTIONS);
  if (flags.version) {
    printResult(flags.json, { version: version() }, version());
    return EXIT.OK;
  }
  if (flags.help || positional.length === 0) {
    printResult(flags.json, { help: HELP }, HELP);
    return positional.length === 0 && !flags.help ? EXIT.USAGE : EXIT.OK;
  }

  const [name, ...args] = positional;
  const input = { positional: args, flags };
  const handlers = {
    run: commands.run,
    wait: commands.wait,
    status: commands.status,
    show: commands.show,
    apply: commands.apply,
    clean: commands.clean,
    on: () => commands.setEnabled(true),
    off: () => commands.setEnabled(false),
    config: commands.config,
  };
  const handler = handlers[name];
  if (!handler) {
    throw new CliError('usage', `Unknown subcommand "${name}". Run kds.mjs --help.`, EXIT.USAGE);
  }
  const { data, human } = await handler(input);
  printResult(flags.json, data, human);
  return EXIT.OK;
}

const json = process.argv.includes('--json');
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    log.debug(error.stack ?? String(error));
    process.exitCode = printError(json, error);
  });
