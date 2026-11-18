#!/usr/bin/env node
// Validates every plugin against the Kodffe plugin standards (anatomy, plugin.json,
// naming) and checks that .claude-plugin/marketplace.json lists each plugin.
//
// Naming: the plugin folder is a short kebab-case name with the "k-" prefix (k-delegate),
// because Claude Code types it before every command (/k-delegate:kds); "displayName"
// carries the descriptive name. The short id (kds) comes from its single commands/<id>.md.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlugins } from './sync-shared.mjs';

const REPOSITORY = 'https://github.com/kodffe/kodffe-plugins';
const NAME_PATTERN = /^k(?:-[a-z0-9]+)+$/;
const ID_PATTERN = /^k[a-z]{1,3}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DATA_SECTION = /^##\s+Data that leaves your machine\s*$/m;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function readShortId(root, name) {
  const dir = join(root, 'plugins', name, 'commands');
  if (!(await exists(dir))) return null;
  const commands = (await readdir(dir)).filter((file) => file.endsWith('.md'));
  return commands.length === 1 ? commands[0].slice(0, -'.md'.length) : null;
}

async function validatePlugin(root, name, id, marketplaceEntry) {
  const errors = [];
  const dir = join(root, 'plugins', name);
  const at = (message) => errors.push(`plugins/${name}: ${message}`);

  if (!NAME_PATTERN.test(name)) at('plugin name must be kebab-case and start with "k-"');

  const requiredFiles = ['.claude-plugin/plugin.json', 'README.md', 'CHANGELOG.md'];
  if (id === null) {
    at('commands/ must contain exactly one <id>.md file');
  } else {
    if (!ID_PATTERN.test(id))
      at(`short id "${id}" must be 2 to 4 lowercase letters starting with "k"`);
    requiredFiles.push(`bin/${id}.mjs`);
  }
  for (const file of requiredFiles) {
    if (!(await exists(join(dir, file)))) at(`missing ${file}`);
  }

  const manifestPath = join(dir, '.claude-plugin', 'plugin.json');
  let manifest = null;
  if (await exists(manifestPath)) {
    try {
      manifest = await readJson(manifestPath);
    } catch (error) {
      at(`plugin.json is not valid JSON (${error.message})`);
    }
  }

  if (manifest) {
    if (manifest.name !== name) at(`plugin.json "name" must be "${name}"`);
    if (!SEMVER_PATTERN.test(manifest.version ?? '')) at('plugin.json "version" must be semver');
    if (!isNonEmptyString(manifest.description)) at('plugin.json "description" is required');
    if (!isNonEmptyString(manifest.displayName)) at('plugin.json "displayName" is required');
    if (manifest.author?.name !== 'Kodffe Software') {
      at('plugin.json "author.name" must be "Kodffe Software"');
    }
    if (manifest.author?.url !== 'https://github.com/kodffe') {
      at('plugin.json "author.url" must be "https://github.com/kodffe"');
    }
    const homepage = `${REPOSITORY}/tree/main/plugins/${name}`;
    if (manifest.homepage !== homepage) at(`plugin.json "homepage" must be "${homepage}"`);
    if (manifest.repository !== REPOSITORY) at(`plugin.json "repository" must be "${REPOSITORY}"`);
    if (manifest.license !== 'MIT') at('plugin.json "license" must be "MIT"');
    if (!Array.isArray(manifest.keywords) || !manifest.keywords.includes('kodffe')) {
      at('plugin.json "keywords" must include "kodffe"');
    }
  }

  const readmePath = join(dir, 'README.md');
  if ((await exists(readmePath)) && !DATA_SECTION.test(await readFile(readmePath, 'utf8'))) {
    at('README.md needs a "## Data that leaves your machine" section');
  }

  if (!marketplaceEntry) {
    at('missing entry in .claude-plugin/marketplace.json');
  } else {
    if (marketplaceEntry.source !== `./plugins/${name}`) {
      at(`marketplace.json "source" must be "./plugins/${name}"`);
    }
    if (manifest && marketplaceEntry.version && marketplaceEntry.version !== manifest.version) {
      at(
        `marketplace.json version ${marketplaceEntry.version} does not match plugin.json ${manifest.version}`,
      );
    }
  }

  return errors;
}

export async function validateRepo(root) {
  const errors = [];
  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');

  let marketplace;
  try {
    marketplace = await readJson(marketplacePath);
  } catch (error) {
    return [`.claude-plugin/marketplace.json: cannot be read (${error.message})`];
  }
  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  if (!Array.isArray(marketplace.plugins)) {
    errors.push('.claude-plugin/marketplace.json: "plugins" must be an array');
  }

  const plugins = await listPlugins(root);
  const owners = new Map();
  for (const name of plugins) {
    const id = await readShortId(root, name);
    if (id !== null && owners.has(id)) {
      errors.push(`plugins/${name}: short id "${id}" is already used by plugins/${owners.get(id)}`);
    }
    if (id !== null) owners.set(id, name);
    const entry = entries.find((candidate) => candidate.name === name);
    errors.push(...(await validatePlugin(root, name, id, entry)));
  }
  for (const entry of entries) {
    if (!plugins.includes(entry.name)) {
      errors.push(`.claude-plugin/marketplace.json: "${entry.name}" has no plugins/ folder`);
    }
  }

  return errors;
}

async function main() {
  const errors = await validateRepo(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error(`${errors.length} problem(s) found.`);
    process.exit(1);
  }
  console.log('All plugin manifests are valid.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
