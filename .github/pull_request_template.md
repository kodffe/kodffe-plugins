## What changes

<!-- One or two lines: which plugin, what it does now that it did not before. -->

## Every PR

- [ ] `npm run check` passes locally (manifests, lib/\_shared sync, lint, format, tests)
- [ ] CHANGELOG.md of each touched plugin updated (Keep a Changelog)
- [ ] Version bumped in plugin.json and in .claude-plugin/marketplace.json when releasing
- [ ] An incompatible change to the CLI contract or to a state schema is a major version
- [ ] No secrets, client names, internal URLs or hosts, server paths or pricing policies

## New plugin checklist

<!-- Delete this section if the PR does not add a plugin. -->

- [ ] Name of 2 to 4 letters with the "k" prefix, no collision with existing plugins
- [ ] Standard folder structure and plugin.json with all required fields
- [ ] Entry in marketplace.json
- [ ] CLI with config, status, --help, --version, --json and the standard exit codes
- [ ] Opt-in through its section in .claude/kodffe.json; exit code 3 when not enabled
- [ ] State in .git/kodffe/<plugin>/ and user data in ~/.kodffe/<plugin>/
- [ ] Respects KODFFE_CHILD and exports it to its child processes
- [ ] Uses the common core in lib/\_shared/ instead of reimplementing config, state or logs
- [ ] Skill description with covered cases, excluded cases and neighboring plugins
- [ ] No side-effect action without developer confirmation
- [ ] Complete README, including the "Data that leaves your machine" section
- [ ] CHANGELOG, green tests and one approval
