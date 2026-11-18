# k-delegate — design

Status: implemented in 0.1.0 (`plugins/k-delegate/`). Last updated: 2026-11-18.

Keep working in Claude Code, but let Claude hand small, well-scoped tasks to a cheaper DeepSeek model. DeepSeek works in an isolated git worktree; Claude always reviews the result before it reaches the developer's branch. The goal is to spend fewer Claude tokens on easy work.

## Names

| What               | Name                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| Plugin             | `k-delegate` (folder `plugins/k-delegate/`), display name "DeepSeek Delegate" |
| Short id           | `kds` (Kodffe DeepSeek Skill)                                                 |
| Command            | `/k-delegate:kds <task>` forces delegation; `/k-delegate:kds <subcommand>`    |
| Skill              | `delegate`, exposed as `k-delegate:delegate`                                  |
| CLI                | `bin/kds.mjs`                                                                 |
| Config section     | `"kds"` in `.claude/kodffe.json`                                              |
| Per-repo state     | `.git/kodffe/kds/` (resolved with `--git-common-dir`)                         |
| Worktrees          | `~/.kodffe/kds/worktrees/<repo>/<id>`                                         |
| Branches           | `kds/<id>`, id `YYMMDD-HHMM-slug`                                             |
| Personal variables | `KDS_API_KEY`, `KDS_MODEL`, `KDS_BASE_URL`                                    |

The plugin name is short because Claude Code types it in front of every command (`/<plugin>:<command>`); `displayName` carries the descriptive name. The short id is used everywhere else. This needs the naming rule change in the standards (see "Standards impact").

## Pieces

| Piece               | Role                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skill `delegate`    | Tells Claude when to delegate, how to write the brief, how to review, what to tell the user                                                                  |
| Hook `SessionStart` | If the plugin is enabled in this project, adds a short reminder to Claude's context that delegation is available and when to use it. No network, under 2 s   |
| Hook `PostToolUse`  | On a `kds run` call, shows a `systemMessage`: "Delegated to DeepSeek: <task>"                                                                                |
| Hook `Stop`         | If a DeepSeek task finished during the turn, shows the estimated savings. Silent otherwise                                                                   |
| `userConfig`        | Claude Code asks for the API key (sensitive, stored in the system keychain) and the model when the plugin is enabled. Works the same in Desktop and terminal |
| CLI `bin/kds.mjs`   | All logic. Skill, command and hooks only call it with `--json`                                                                                               |

All hooks exit immediately when the plugin is disabled in the project or when `KODFFE_CHILD` is set.

## Command and CLI

`/k-delegate:kds <free text>` runs that text as a forced delegation. Any first word that matches a subcommand is treated as the subcommand.

| Subcommand            | What it does                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `run "<task>"`        | Creates worktree and branch `kds/<id>`, starts DeepSeek in the background, returns the id at once |
| `status [id]`         | Lists tasks (running, done, failed, applied) with tokens and cost                                 |
| `show <id>`           | Summary from DeepSeek, files changed and diff                                                     |
| `apply <id>`          | Applies the diff to the current working tree, uncommitted. Exit 5 on conflict                     |
| `clean [id]`          | Removes worktrees and branches of finished tasks                                                  |
| `on`                  | Sets `kds.enabled = true` in `.claude/kodffe.json`                                                |
| `off`                 | Sets `kds.enabled = false`                                                                        |
| `config`              | Effective configuration without secrets; checks the key with a minimal call when enabled          |
| `--help`, `--version` | Standard                                                                                          |

## Flow

1. Claude decides a task fits (skill criteria) and writes a closed brief: goal, files, acceptance criteria, verify command.
2. Claude tells the user: "Delegated to DeepSeek: <task>". The `PostToolUse` hook shows the same message.
3. `kds run` creates the worktree and launches a child `claude -p` with:
   - `ANTHROPIC_BASE_URL` = DeepSeek's Anthropic-compatible endpoint, `ANTHROPIC_AUTH_TOKEN` = the member's key, `ANTHROPIC_MODEL` = configured model;
   - `KODFFE_CHILD=kds`, no user MCP servers (`--strict-mcp-config`), minimal `--allowedTools`, `--permission-mode acceptEdits`, `--max-turns`, `--output-format json`;
   - working directory = the worktree. `--dangerously-skip-permissions` is never used.
4. Claude keeps working. Several tasks can run in parallel, each in its own worktree.
5. When a task ends, Claude runs `kds show <id>`, reviews the diff and runs the verify command in the worktree.
6. Approved: Claude runs `kds apply <id>`. The Claude Code permission prompt for that command is the developer's approval.
7. Rejected: Claude fixes it itself, or sends it back to DeepSeek once with concrete feedback.
8. `kds clean` removes the worktree. The `Stop` hook prints the savings line.

## When Claude delegates (skill criteria)

Delegate: well-specified tasks that need many reads or iterations but produce a small, checkable diff. Examples: write tests for a given function, apply the same change across several files, boilerplate, docs and comments, simple refactors with a verify command.

Do not delegate: one-line edits (reviewing costs more than doing), architecture or design decisions, bugs whose cause is unknown, security-sensitive code, anything the user asked Claude to do personally, projects where the plugin is disabled.

## Fallback

If DeepSeek fails, times out, hits `maxTurns`, or the key is missing or invalid, Claude does the task itself and tells the user why in one line. A missing key never blocks the session.

## Configuration

`.claude/kodffe.json` (committed, no secrets):

```json
{
  "common": { "verify": "npm test" },
  "kds": {
    "enabled": false,
    "maxTurns": 30,
    "timeoutMinutes": 15,
    "maxParallel": 3,
    "allowedTools": ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npm test:*)"]
  }
}
```

Personal: API key and model come from `userConfig`; `KDS_API_KEY`, `KDS_MODEL` and `KDS_BASE_URL` in the environment override them (terminal users, scripts).

## Keys

One DeepSeek key per team member, issued by Kodffe. A key can be revoked without affecting anyone else, and each key has a spending limit set in the DeepSeek console. Issuing, limits and revocation are an internal Kodffe process and are not documented in this repo.

## Savings report

Only shown when DeepSeek was actually used in the turn. Example:

```
DeepSeek: 2 tasks, 184k tokens, $0.05. Same tokens on Claude ≈ $1.10. Estimated savings ≈ $1.05.
```

- Tokens and cost come from the child's `--output-format json` usage, stored in the task state.
- The Claude equivalent prices the same input and output tokens at the session model's public price.
- Prices live in one table in the CLI with documented defaults, overridable in `.claude/kodffe.json` because public prices change.
- It is labeled "estimated": it does not subtract the Claude tokens spent on the brief and the review.

## State

`.git/kodffe/kds/tasks/<id>.json`, documented in the plugin README:

```json
{
  "schemaVersion": 1,
  "id": "261118-1530-add-date-tests",
  "task": "Add tests for parseDate",
  "status": "running | done | failed | applied | discarded",
  "branch": "kds/261118-1530-add-date-tests",
  "worktree": "~/.kodffe/kds/worktrees/<repo>/261118-1530-add-date-tests",
  "baseCommit": "<sha>",
  "model": "<model>",
  "startedAt": "<iso>",
  "endedAt": "<iso>",
  "usage": { "inputTokens": 0, "outputTokens": 0, "costUsd": 0 },
  "error": null
}
```

## Data that leaves your machine

When enabled, the task brief, every file DeepSeek reads in the worktree and the output of commands it runs are sent to the DeepSeek API. The plugin starts disabled in every project. Which projects may enable it (for example, client code under contract) is an internal Kodffe policy.

## Standards impact

The standards say the plugin name is 2 to 4 letters with a "k" prefix and equal to the command. Proposed new rule: the plugin name is descriptive kebab-case; the command is 2 to 4 lowercase letters starting with "k" and is the short id used for config, state, branches and variables. `scripts/validate-manifests.mjs` changes with it.

## To verify during implementation

- How `userConfig` values reach the CLI and hooks (variable names), and that sensitive values go to the keychain on macOS and Windows.
- How `systemMessage` from `PostToolUse` and `Stop` hooks looks in Desktop.
- How to keep the user's plugins out of the child `claude -p`.
- DeepSeek's current Anthropic-compatible endpoint and model names.

## Implementation notes (0.1.0)

Findings while building it, and how the design adapted:

- **The API key reaches hooks only.** Claude Code exports `userConfig` values as `CLAUDE_PLUGIN_OPTION_<KEY>` to hook processes, not to commands Claude runs with Bash. So `kds run` creates the task as `queued`, and the `PostToolUse` hook (which sees the key) starts the detached worker. From a terminal, `KDS_API_KEY` starts it directly. The key never touches disk.
- **Command name.** Claude Code namespaces plugin commands: the command is `/k-delegate:kds`. Plain `/kds` is rejected as an unknown command (Claude Code 2.1.314), so every message and doc uses the full form. The plugin was renamed from `deepseek-delegate` to `k-delegate` to keep that command short.
- **Permissions.** The command and the skill pre-approve `run`, `wait`, `status`, `show`, `clean` and `config` with `allowed-tools`, so Claude Code asks once to run the skill instead of on every call. `apply`, `on` and `off` keep asking: that prompt is the developer's approval.
- **Child isolation.** The worker runs `claude --bare -p`: no user plugins, hooks, MCP servers or CLAUDE.md auto-discovery, and it never reads the user's Claude login, so a misconfigured key cannot bill Claude.
- **Uncommitted work.** `run` snapshots the working tree with `git stash create` (tracked changes, nothing touched), so DeepSeek starts from what the developer sees, and `apply` writes the diff without staging or committing.
- **`wait` subcommand** added so Claude can block on one or more tasks, ideally in the background.
- **Savings** compare against Claude Opus 5.5 by default (`compareWith`), prices overridable in `kds.prices`.
- **Models.** DeepSeek's Anthropic endpoint accepts `deepseek-flash` and `deepseek-v4-pro` (other names that do not start with `claude` get HTTP 400; `deepseek-chat` is no longer listed). The plugin setting is a picker with those two, default `deepseek-flash`. The model picked there reaches hooks only, so the hook writes it into the task before starting the worker. Prices are per model, at DeepSeek's peak rates.

Still to verify with a real DeepSeek key: the endpoint and model name defaults, and how `systemMessage` from `PostToolUse` and `Stop` looks in Claude Desktop.
