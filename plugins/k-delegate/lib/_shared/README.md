# Kodffe common core

Source of the code every plugin shares: CLI output and exit codes, logging, git helpers, the `.claude/kodffe.json` config and the `kodffe` state locations.

`npm run sync` copies this folder into each `plugins/*/lib/_shared/`. Never edit those copies: change the files here and sync again. `npm run sync:check` fails if any copy differs.

Only add what an existing plugin uses.
