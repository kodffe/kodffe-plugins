// Standard CLI contract: exit codes, --json envelope, errors and the KODFFE_CHILD guard.

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  DISABLED: 3,
  CHILD: 4,
  CONFLICT: 5,
});

export class CliError extends Error {
  constructor(code, message, exit = EXIT.ERROR) {
    super(message);
    this.code = code;
    this.exit = exit;
  }
}

/** Splits argv into positional arguments and --flags (--key value or --flag). */
export function parseArgs(argv, { booleans = [], strings = [] } = {}) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || arg === '--') {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (booleans.includes(key)) {
      flags[key] = true;
    } else if (strings.includes(key)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new CliError('usage', `--${key} needs a value`, EXIT.USAGE);
      flags[key] = value;
    } else {
      throw new CliError('usage', `Unknown option --${key}`, EXIT.USAGE);
    }
  }
  return { positional, flags };
}

/** Prints the result on stdout: the JSON envelope with --json, otherwise human text. */
export function printResult(json, data, human) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
  } else if (human) {
    process.stdout.write(`${human}\n`);
  }
}

export function printError(json, error) {
  const code = error instanceof CliError ? error.code : 'error';
  const message = error?.message ?? String(error);
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  return error instanceof CliError ? error.exit : EXIT.ERROR;
}

/** Plugins with side effects must not run inside a child process launched by a plugin. */
export function assertNotChild(id) {
  const parent = process.env.KODFFE_CHILD;
  if (parent) {
    throw new CliError(
      'recursion',
      `${id} cannot run inside a child process of ${parent} (KODFFE_CHILD is set)`,
      EXIT.CHILD,
    );
  }
}
