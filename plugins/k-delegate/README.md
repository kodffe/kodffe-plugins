# k-delegate

Lets Claude Code hand small, well-scoped tasks to a cheaper DeepSeek model in isolated git worktrees, then review the result before it reaches your branch.

Claude decides what to delegate, tells you on screen (`🔀 Delegated to DeepSeek: …`), keeps working while DeepSeek runs, reviews the diff, and applies it to your working tree uncommitted. At the end of a turn that used DeepSeek you get one line with the estimated savings. `/k-delegate:kds <task>` forces a task onto DeepSeek.

## Installation

In Claude Code (Desktop or terminal):

```
/plugin marketplace add kodffe/kodffe-plugins
/plugin install k-delegate@kodffe
```

Claude Code asks for your **DeepSeek API key** (one per team member, issued by Kodffe) and stores it in your system's secure credential store. Change it later with `/plugin configure k-delegate@kodffe`.

Requirements: Node >= 22 and `git` on the `PATH` Claude Code uses, and the `claude` CLI (it runs the DeepSeek worker).

To have Claude Code offer the plugin to everyone who opens a project, commit this to the project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "kodffe": { "source": { "source": "github", "repo": "kodffe/kodffe-plugins" } }
  },
  "enabledPlugins": { "k-delegate@kodffe": true }
}
```

## Configuration

The plugin does nothing until a project opts in: run `/k-delegate:kds on` and commit `.claude/kodffe.json`.

`.claude/kodffe.json` (committed, no secrets; every key is optional except `enabled`):

```json
{
  "common": { "verify": "npm test" },
  "kds": {
    "enabled": true,
    "notify": true,
    "maxTurns": 30,
    "timeoutMinutes": 15,
    "maxParallel": 3,
    "compareWith": "opus",
    "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npm test:*)"],
    "prices": {
      "deepseek": { "deepseek-flash": { "input": 0.3, "cacheRead": 0.006, "output": 1.2 } }
    }
  }
}
```

| Key                | Default                                                       | Meaning                                                         |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------- |
| `enabled`          | `false`                                                       | Opt-in for this project                                         |
| `notify`           | `true`                                                        | Show the "Delegated" and savings messages                       |
| `maxTurns`         | `30`                                                          | Turn limit for one DeepSeek run                                 |
| `timeoutMinutes`   | `15`                                                          | A run is stopped after this                                     |
| `maxParallel`      | `3`                                                           | Tasks running at the same time                                  |
| `compareWith`      | `opus`                                                        | Claude price used for the savings estimate: opus, sonnet, haiku |
| `allowedTools`     | read/edit tools, `git status`, `git diff`, the verify command | Tools DeepSeek may use; nothing else is allowed                 |
| `prices`           | built-in table (DeepSeek peak rates)                          | USD per million tokens, per model; override when prices change  |
| `model`, `baseUrl` | `deepseek-flash`, `https://api.deepseek.com/anthropic`        | Project-wide model and endpoint                                 |

Models (pick one in `/plugin configure k-delegate@kodffe`):

| Model             | Use                                                         |
| ----------------- | ----------------------------------------------------------- |
| `deepseek-flash`  | Default. Fast and cheapest; right for most delegated tasks  |
| `deepseek-v4-pro` | Stronger, about 4 times the price; for harder routine tasks |

Personal values (never committed):

| Where                                 | Value                                                    |
| ------------------------------------- | -------------------------------------------------------- |
| Plugin settings (`/plugin configure`) | `api_key` (secure storage), `model` (picked from a list) |
| `KDS_API_KEY`                         | API key for terminal use; overrides the plugin setting   |
| `KDS_MODEL`, `KDS_BASE_URL`           | Override model and endpoint                              |
| `KODFFE_LOG_LEVEL`                    | `error`, `warn` (default), `info`, `debug`               |

## Usage

Most of the time you do nothing: with the plugin enabled, Claude delegates when a task fits.

| Command                                     | What it does                                                   |
| ------------------------------------------- | -------------------------------------------------------------- |
| `/k-delegate:kds <task>`                    | Force this task onto DeepSeek; Claude still reviews the result |
| `/k-delegate:kds status`                    | Tasks, tokens and estimated savings                            |
| `/k-delegate:kds show <id>`                 | DeepSeek's report and the diff                                 |
| `/k-delegate:kds apply <id>`                | Apply a reviewed task to your working tree (uncommitted)       |
| `/k-delegate:kds clean [id]`                | Remove worktrees and branches of finished tasks                |
| `/k-delegate:kds on`, `/k-delegate:kds off` | Opt this project in or out                                     |
| `/k-delegate:kds config`                    | Effective configuration                                        |

Claude Code namespaces plugin commands, so the command is `/k-delegate:kds`. Plain `/kds` is not recognized.

Example:

```
/k-delegate:kds add unit tests for parseDate in src/date.ts covering empty, ISO and invalid input
```

The same CLI works from a terminal: `node <plugin>/bin/kds.mjs --help`, with `KDS_API_KEY` set.

### How a task runs

1. `kds run` snapshots your working tree (uncommitted tracked changes included), creates the branch `kds/<id>` and a worktree in `~/.kodffe/kds/worktrees/`.
2. A detached worker runs `claude --bare -p` in that worktree with `ANTHROPIC_BASE_URL` pointing at DeepSeek: no plugins, hooks or MCP servers, only the allowed tools, `KODFFE_CHILD=kds`. `--dangerously-skip-permissions` is never used.
3. Claude reviews the diff (`kds show`) and, if it is good, `kds apply` writes it to your working tree without staging or committing. If your files changed in the meantime and the diff no longer applies, nothing is touched (exit code 5).

### State

`<git-common-dir>/kodffe/kds/tasks/<id>.json`, shared by every worktree of the repository (`schemaVersion` 1):

| Field                                                                      | Meaning                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `id`, `title`, `brief`                                                     | Task id (`YYMMDD-HHMM-slug`), short title, full brief                   |
| `status`                                                                   | `queued`, `running`, `done`, `failed`, `applied`, `discarded`           |
| `sessionId`                                                                | Claude Code session that started it                                     |
| `branch`, `worktree`, `baseCommit`                                         | Where the work lives and what it started from                           |
| `model`, `baseUrl`, `maxTurns`, `timeoutMinutes`, `allowedTools`, `verify` | Run settings                                                            |
| `usage`                                                                    | `inputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `outputTokens` |
| `files`, `summary`, `error`                                                | Changed files, DeepSeek's report, failure reason                        |
| `createdAt`, `endedAt`, `appliedAt`, `cleaned`                             | Timeline                                                                |

Marker folders `claims/`, `announced/` and `reported/` sit next to `tasks/`; logs are in `logs/<id>.log`.

## Data that leaves your machine

When the plugin is enabled in a project, the following is sent to the DeepSeek API (`api.deepseek.com` by default) for each delegated task:

- the task brief Claude writes;
- the content of every file DeepSeek reads in the task's worktree (a copy of your project);
- the output of the commands it runs (the verify command, `git status`, `git diff`).

Nothing is sent while the plugin is disabled, and it starts disabled in every project. `/k-delegate:kds config` sends one tiny request to check the key. Check with Kodffe before enabling it in a project whose code may not leave the company or the client.

## Troubleshooting

| Symptom                                    | Fix                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| "no DeepSeek API key"                      | `/plugin configure k-delegate@kodffe`, or `KDS_API_KEY` in a terminal                                                       |
| Task stays `queued`                        | It is started by the plugin hook after Claude's command. From a terminal, set `KDS_API_KEY`                                 |
| Hooks do nothing in Claude Desktop         | `node` must be on the `PATH` Claude Code sees. With nvm, add the node folder to the `env.PATH` in `~/.claude/settings.json` |
| Task `failed` with an authentication error | The key is wrong or revoked: ask Kodffe for a new one                                                                       |
| `apply` exits with code 5                  | Your files changed since the task started. Review `kds show <id>` and apply by hand, or run the task again                  |
| Messages are noise                         | Set `"notify": false` in the `kds` section                                                                                  |
| Anything else                              | `KODFFE_LOG_LEVEL=debug`, and the task log in `.git/kodffe/kds/logs/<id>.log`                                               |

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
