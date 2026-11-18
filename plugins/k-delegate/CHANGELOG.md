# Changelog

All notable changes to k-delegate are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-18

### Added

- `k-delegate:delegate` skill: Claude delegates small, well-scoped tasks to DeepSeek and reviews the result.
- `/k-delegate:kds` command to force a task onto DeepSeek and manage tasks.
- `kds.mjs` CLI: `run`, `wait`, `status`, `show`, `apply`, `clean`, `on`, `off`, `config`, with `--json` and the standard exit codes.
- One git worktree and branch `kds/<id>` per task, so several tasks run in parallel.
- Hooks: session context, start and announce delegated tasks, estimated savings line at the end of a turn.
- API key and model through the plugin settings (secure storage; the model is picked from a list: `deepseek-flash` by default or `deepseek-v4-pro`), or `KDS_API_KEY` / `KDS_MODEL` in a terminal.
