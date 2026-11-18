---
name: delegate
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" run:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" wait:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" status:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" show:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" clean:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" config:*)
description: >
  Use when k-delegate is enabled in the project and a coding task is small and well
  specified but would cost many Claude tokens to carry out: tests for a named function, the same
  change across several files, boilerplate, docs or comments, a simple refactor with a verify
  command. Hands it to a cheaper DeepSeek model in an isolated git worktree, then you review the
  diff before applying it. Do not use for one-line edits, design or architecture decisions, bugs
  whose cause is unknown, security-sensitive code, or tasks the user asked you to do yourself.
---

# Delegate a task to DeepSeek

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs"` (written `kds` below). Run each command exactly as written, on its own (no `;`, `&&` or extra `echo`), so the plugin's pre-approved commands match. Always pass `--json` and decide from its output: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`.

## When to use

- The plugin is enabled (the session context says so, or `kds status --json` returns `enabled: true`).
- The task is clear enough to write as a closed brief: goal, files, acceptance criteria.
- Doing it would take many reads or iterations, but the resulting diff is small and checkable.
- Several independent small tasks: delegate each one; they run in parallel in separate worktrees.

## When not to use

- One-line or trivial edits: reviewing the diff costs more than doing it.
- Design or architecture decisions, unclear requirements, bugs whose cause is unknown.
- Security-sensitive code (auth, crypto, secrets, permissions).
- The user asked you to do it yourself, or the plugin is disabled.

## Steps

1. **Write the brief.** Self-contained, because DeepSeek sees nothing of this conversation: the goal, the files to read and change, the conventions to follow, the acceptance criteria and what not to touch.
2. **Start it** with a short title and this session's id:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" run --json --session "${CLAUDE_SESSION_ID}" --title "<3-6 word title>" <<'KDS_BRIEF'
   <the brief>
   KDS_BRIEF
   ```

   Add `--verify "<command>"` when the project's verify command is not configured and one applies.

3. **Tell the user in one line**: `🔀 Delegated to DeepSeek: <title>`.
4. **Keep working** on other parts of the request. When you need the result, run `kds wait <id> [<id>...] --json`, in the background if your environment allows it.
5. **Review.** Run `kds show <id> --json`. Read DeepSeek's report and the diff. Check that it does what the brief asked, touches nothing else and follows the project's conventions. If a verify command exists, run it inside the task's `worktree` folder.
6. **Accepted**: run `kds apply <id> --json`. The changes land in the working tree, uncommitted. Exit code 5 means they conflict with the current files: nothing was changed; tell the user and offer to apply the diff by hand.
7. **Rejected**: either apply and fix the problems yourself, or run `kds clean <id> --json` and do the task yourself. Re-delegate at most once, with concrete feedback in a new brief.
8. **Finish**: run `kds clean --json` to remove applied and failed worktrees.

If `run` fails, the task fails, or `wait` times out: do the task yourself and tell the user why in one line. A missing API key never blocks your work.

## Result format

One line per delegated task, after the review:

- `DeepSeek: <title> — applied (<n> files)`
- `DeepSeek: <title> — rejected: <reason>; done by Claude`
- `DeepSeek: <title> — failed: <reason>; done by Claude`

The plugin adds the estimated savings line at the end of the turn; do not compute it yourself.
