import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

import {
  MISSING_CREDENTIAL_MESSAGE,
  isCrateVersionPublished,
  main,
  parseCrateManifest,
} from '../scripts/crates-io-release.mjs';

const MANIFEST = `[package]
name = "demo-crate"
version = "1.2.3"

[dependencies]
version = "9.9.9"
`;

function response(status) {
  return { ok: status >= 200 && status < 300, status, statusText: '' };
}

function harness({ statuses, token = '', publishStatus = 0 }) {
  const urls = [];
  const spawned = [];
  const logs = [];
  const errors = [];
  const queue = [...statuses];

  const deps = {
    env: token ? { CARGO_REGISTRY_TOKEN: token } : {},
    readFile: () => MANIFEST,
    fetchFn: async (url) => {
      urls.push(url);
      return response(queue.shift());
    },
    spawn: (command, args, options) => {
      spawned.push({
        command,
        args,
        token: options.env.CARGO_REGISTRY_TOKEN,
      });
      return { status: publishStatus };
    },
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
  };

  return { deps, urls, spawned, logs, errors };
}

describe('crates.io release script', () => {
  it('reads name and version from the [package] table only', () => {
    expect(parseCrateManifest(MANIFEST)).toEqual({
      name: 'demo-crate',
      version: '1.2.3',
    });
  });

  it('refuses a crate marked publish = false', () => {
    expect(() =>
      parseCrateManifest(`${MANIFEST.split('\n\n')[0]}\npublish = false\n`)
    ).toThrow('publish = false');
  });

  it('keeps the shipped crate publishable', () => {
    expect(
      parseCrateManifest(readFileSync('rust/Cargo.toml', 'utf8')).name
    ).toBe('link-assistant-conversation');
  });

  it('treats 404 as unpublished and other failures as errors', async () => {
    expect(
      await isCrateVersionPublished('a', '1.0.0', {
        fetchFn: async () => response(404),
      })
    ).toBe(false);
    expect(
      await isCrateVersionPublished('a', '1.0.0', {
        fetchFn: async () => response(200),
      })
    ).toBe(true);
    let failure;
    try {
      await isCrateVersionPublished('a', '1.0.0', {
        fetchFn: async () => response(503),
      });
    } catch (err) {
      failure = err;
    }
    expect(failure?.message).toContain('503');
  });

  it('skips publishing a version that is already on crates.io', async () => {
    const run = harness({ statuses: [200], token: 'secret' });
    expect(await main(['publish'], run.deps)).toBe(0);
    expect(run.urls).toEqual([
      'https://crates.io/api/v1/crates/demo-crate/1.2.3',
    ]);
    expect(run.spawned).toEqual([]);
  });

  it('fails with setup instructions when no credential exists', async () => {
    const run = harness({ statuses: [404] });
    expect(await main(['publish'], run.deps)).toBe(1);
    expect(run.spawned).toEqual([]);
    expect(run.errors[0]).toBe(MISSING_CREDENTIAL_MESSAGE);
    expect(MISSING_CREDENTIAL_MESSAGE).toContain(
      'package-registry-manager setup --repository . --registry crates-io --execute'
    );
  });

  it('publishes a new version with the resolved token', async () => {
    const run = harness({ statuses: [404], token: 'oidc-token' });
    expect(await main(['publish'], run.deps)).toBe(0);
    expect(run.spawned).toEqual([
      {
        command: 'cargo',
        args: ['publish', '--manifest-path', 'rust/Cargo.toml', '--locked'],
        token: 'oidc-token',
      },
    ]);
  });

  it('accepts a failed publish only when the version appeared anyway', async () => {
    const raced = harness({
      statuses: [404, 200],
      token: 't',
      publishStatus: 101,
    });
    expect(await main(['publish'], raced.deps)).toBe(0);

    const failed = harness({
      statuses: [404, 404],
      token: 't',
      publishStatus: 101,
    });
    expect(await main(['publish'], failed.deps)).toBe(1);
  });

  it('reports bad usage with exit code 2', async () => {
    const run = harness({ statuses: [] });
    expect(await main(['release'], run.deps)).toBe(2);
  });
});

describe('crates.io publish workflow', () => {
  const workflow = readFileSync(
    '.github/workflows/conversation.yml',
    'utf8'
  ).replaceAll('\r\n', '\n');
  const job = workflow.slice(workflow.indexOf('\n  crates-io-publish:\n'));

  it('tries trusted publishing first and falls back to token secrets', () => {
    expect(job).toContain('id-token: write');
    expect(job).toMatch(
      /uses: rust-lang\/crates-io-auth-action@[0-9a-f]{40} # v\d/
    );
    expect(job).toMatch(
      /crates-io-auth-action@[^\n]+\n\s+continue-on-error: true/
    );
    expect(job).toContain(
      'CARGO_REGISTRY_TOKEN: ${{ steps.crates_auth.outputs.token || secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}'
    );
  });

  it('publishes only from main after the Rust checks pass', () => {
    expect(job).toContain('needs: [rust-and-cross-language]');
    expect(job).toContain("github.ref == 'refs/heads/main'");
  });

  it('verifies the crate package on pull requests', () => {
    expect(workflow).toContain(
      'cargo publish --manifest-path rust/Cargo.toml --locked --dry-run'
    );
  });
});
