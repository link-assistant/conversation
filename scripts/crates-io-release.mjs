#!/usr/bin/env node

/**
 * Publishes the Rust crate in rust/Cargo.toml to crates.io.
 *
 * When the version in Cargo.toml is missing from crates.io, `publish` runs
 * `cargo publish`; for a version crates.io already has, both modes do
 * nothing. Bump `version` in rust/Cargo.toml to release a new crate version.
 *
 * Credentials (organization policy): trusted publishing (OIDC) first through
 * rust-lang/crates-io-auth-action, falling back to the CARGO_REGISTRY_TOKEN /
 * CARGO_TOKEN secrets. The workflow resolves that chain into a single
 * CARGO_REGISTRY_TOKEN environment variable for the `publish` mode.
 *
 * Usage:
 *   node scripts/crates-io-release.mjs check   [--manifest rust/Cargo.toml]
 *   node scripts/crates-io-release.mjs publish [--manifest rust/Cargo.toml]
 *
 * `check` writes `name`, `version`, and `should_publish` to $GITHUB_OUTPUT.
 *
 * Exit codes:
 *   0 = published, or nothing to publish
 *   1 = publishing failed or no credential is available
 *   2 = bad usage or unreadable manifest
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MANIFEST = 'rust/Cargo.toml';
export const CRATES_IO_API = 'https://crates.io/api/v1';
// crates.io rejects API requests without an identifying User-Agent.
export const USER_AGENT =
  'link-assistant-conversation-release (https://github.com/link-assistant/conversation)';

export const MISSING_CREDENTIAL_MESSAGE = [
  'No crates.io credential is available, so the crate cannot be published.',
  'Trusted publishing (OIDC) did not return a token and neither',
  'CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set.',
  'To fix it, a crates.io owner runs once:',
  '  package-registry-manager setup --repository . --registry crates-io --execute',
  'It publishes the first version with a short-lived crate-scoped token and',
  'registers .github/workflows/conversation.yml as the trusted publisher;',
  'every later version then publishes from CI with no secret.',
  'Alternatively, set the CARGO_REGISTRY_TOKEN repository secret.',
].join('\n');

/**
 * Read `name` and `version` from the [package] table of a Cargo manifest.
 * @param {string} manifestText
 * @returns {{name: string, version: string}}
 */
export function parseCrateManifest(manifestText) {
  const text = String(manifestText).replaceAll('\r\n', '\n');
  const start = text.search(/^\[package\]\s*$/m);

  if (start === -1) {
    throw new Error('Cargo manifest has no [package] table');
  }

  const rest = text.slice(start).split('\n').slice(1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  const table = (end === -1 ? rest : rest.slice(0, end)).join('\n');
  const field = (key) =>
    table.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, 'm'))?.[1];

  const name = field('name');
  const version = field('version');

  if (!name || !version) {
    throw new Error('Cargo manifest [package] needs literal name and version');
  }

  if (/^publish\s*=\s*false\s*$/m.test(table)) {
    throw new Error(`${name} sets publish = false`);
  }

  return { name, version };
}

/**
 * Ask crates.io whether a crate version exists. A 404 means the crate or the
 * version has not been published yet.
 * @param {string} name
 * @param {string} version
 * @param {{fetchFn?: Function, apiUrl?: string}} [options]
 * @returns {Promise<boolean>}
 */
export async function isCrateVersionPublished(
  name,
  version,
  { fetchFn = fetch, apiUrl = CRATES_IO_API } = {}
) {
  const url = `${apiUrl}/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `crates.io returned ${response.status} ${response.statusText || ''} for ${url}`.trim()
    );
  }

  return true;
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  let manifest = DEFAULT_MANIFEST;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--manifest' && rest[index + 1]) {
      manifest = rest[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${rest[index]}`);
    }
  }

  if (mode !== 'check' && mode !== 'publish') {
    throw new Error(
      'Usage: crates-io-release.mjs <check|publish> [--manifest <Cargo.toml>]'
    );
  }

  return { mode, manifest };
}

function writeOutputs(outputs, outputFile) {
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${value}`
  );
  console.log(lines.join('\n'));

  if (outputFile) {
    appendFileSync(outputFile, `${lines.join('\n')}\n`);
  }
}

function runCargoPublish(manifest, token, spawn) {
  return spawn('cargo', ['publish', '--manifest-path', manifest, '--locked'], {
    stdio: 'inherit',
    env: { ...process.env, CARGO_REGISTRY_TOKEN: token },
  });
}

async function publishCrate({
  crate,
  manifest,
  env,
  fetchFn,
  spawn,
  log,
  error,
}) {
  const label = `${crate.name}@${crate.version}`;
  const token = env.CARGO_REGISTRY_TOKEN || '';

  if (!token) {
    error(MISSING_CREDENTIAL_MESSAGE);
    error(
      `::error title=crates.io credential missing::${MISSING_CREDENTIAL_MESSAGE.replaceAll('\n', '%0A')}`
    );
    return 1;
  }

  log(`Publishing ${label} to crates.io`);
  const result = runCargoPublish(manifest, token, spawn);

  if (result.status === 0) {
    log(
      `Published ${label}: https://crates.io/crates/${crate.name}/${crate.version}`
    );
    return 0;
  }

  // A concurrent run may have published the same version first.
  if (await isCrateVersionPublished(crate.name, crate.version, { fetchFn })) {
    log(`${label} was published by another run; nothing left to do.`);
    return 0;
  }

  const reason = result.status ?? result.signal ?? result.error?.message;
  error(`cargo publish failed for ${label} (exit ${reason})`);
  return 1;
}

/**
 * Run the release step.
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>} exit code
 */
export async function main(
  argv,
  {
    env = process.env,
    fetchFn = fetch,
    readFile = (path) => readFileSync(path, 'utf8'),
    spawn = spawnSync,
    log = console.log,
    error = console.error,
  } = {}
) {
  let mode;
  let manifest;
  let crate;

  try {
    ({ mode, manifest } = parseArgs(argv));
    crate = parseCrateManifest(readFile(manifest));
  } catch (err) {
    error(err.message);
    return 2;
  }

  const label = `${crate.name}@${crate.version}`;
  const published = await isCrateVersionPublished(crate.name, crate.version, {
    fetchFn,
  });

  log(
    published
      ? `${label} is already on crates.io; nothing to publish.`
      : `${label} is not on crates.io yet; it will be published.`
  );

  if (mode === 'check') {
    writeOutputs(
      { ...crate, should_publish: String(!published) },
      env.GITHUB_OUTPUT
    );
    return 0;
  }

  if (published) {
    return 0;
  }

  return publishCrate({ crate, manifest, env, fetchFn, spawn, log, error });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err.stack || err.message);
      process.exitCode = 1;
    }
  );
}
