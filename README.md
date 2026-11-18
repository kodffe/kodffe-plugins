# Kodffe Plugins

Claude Code plugins by Kodffe Software.

Each plugin lives in `plugins/<name>/` and follows the shared Kodffe plugin standards: opt-in per project, human approval for side effects, no secrets in the repo, Node >= 22 ESM with no runtime dependencies.

## Plugins

| Plugin                            | Command           | What it does                                                                        |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| [k-delegate](plugins/k-delegate/) | `/k-delegate:kds` | Claude hands small, well-scoped tasks to DeepSeek in git worktrees and reviews them |

## Installation

Add the marketplace once, then install any plugin from it:

```
/plugin marketplace add kodffe/kodffe-plugins
/plugin install <plugin>@kodffe
```

## Development

Requires Node >= 22.

```bash
npm install        # ESLint and Prettier (dev only; plugins have no runtime dependencies)
npm run check      # everything a PR must pass
```

| Script               | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `npm run sync`       | Copies the common core `shared/` into every `plugins/*/lib/_shared/` |
| `npm run sync:check` | Fails if any `lib/_shared/` differs from `shared/`                   |
| `npm run validate`   | Checks plugin anatomy, `plugin.json` fields and `marketplace.json`   |
| `npm run lint`       | ESLint                                                               |
| `npm run format`     | Prettier (write); `format:check` only verifies                       |
| `npm test`           | `node:test` for the repo scripts and every plugin                    |

Never edit `plugins/*/lib/_shared/` by hand: change `shared/` and run `npm run sync`.

## License

MIT
