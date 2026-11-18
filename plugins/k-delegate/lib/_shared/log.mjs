// Logs go to stderr only; stdout is reserved for data. Level from KODFFE_LOG_LEVEL.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger(id) {
  const level = LEVELS[process.env.KODFFE_LOG_LEVEL] ?? LEVELS.warn;
  const write = (name) => (message) => {
    if (LEVELS[name] <= level) process.stderr.write(`[${id}] ${name}: ${message}\n`);
  };
  return { error: write('error'), warn: write('warn'), info: write('info'), debug: write('debug') };
}
