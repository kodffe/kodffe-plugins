---
description: Force a task onto DeepSeek, or manage k-delegate (status, show, apply, clean, on, off, config)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" run:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" wait:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" status:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" show:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" clean:*), Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs" config:*)
argument-hint: <task> | status | show <id> | apply <id> | clean [id] | on | off | config
---

The user ran `/k-delegate:kds` with these arguments: $ARGUMENTS

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/bin/kds.mjs"`. Always add `--json`, run it on its own (no `;`, `&&` or extra `echo`) and decide from its output. `status`, `show`, `wait`, `run`, `clean` and `config` are pre-approved; `apply`, `on` and `off` ask the user, on purpose.

1. **No arguments**: run `status --json` and summarize the tasks in a few lines.
2. **First word is a subcommand** (`status`, `show`, `apply`, `clean`, `wait`, `on`, `off`, `config`): run the CLI with exactly those arguments plus `--json` and present the result briefly.
   - `apply` changes the user's working tree: before running it, review the task with `show <id> --json` as described in the `k-delegate:delegate` skill, unless you already did in this conversation.
   - `on` and `off` change `.claude/kodffe.json`, a committed file: say so after running them.
3. **Anything else is a task to force onto DeepSeek.** Follow the steps of the `k-delegate:delegate` skill with this text as the task. Skip the "should I delegate" judgment: the user already chose DeepSeek. Still write a complete brief and still review the result before applying it.

If the CLI exits with code 3, tell the user the plugin is disabled in this project and that `/k-delegate:kds on` turns it on (and that it sends code to DeepSeek).
