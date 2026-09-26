# Conversation

Portable linked archives for AI agent conversations. The first version provides
JavaScript and Rust libraries and CLIs, and adapters for Codex CLI and Claude
Code JSONL sessions.

The archive is a graph: a conversation node links to records with `contains`,
records link to their successor with `precedes`, and messages can link to their
parent with `reply_to`. Each imported source record is kept in full, while
normalized roles and content blocks make cross-tool conversion possible. The
same graph can be saved as JSON, readable Links Notation, or a portable binary
link file. See [the format specification](docs/CONVERSATION-FORMAT.md).

## Conversation quick start

```bash
npm install
node bin/conversation.js import codex rollout.jsonl archive.lino
node bin/conversation.js inspect archive.lino
node bin/conversation.js export claude archive.lino claude-session.jsonl

# Rust CLI with the same commands and archive format:
cargo run --manifest-path rust/Cargo.toml -- import claude session.jsonl archive.bin
```

The CLI also accepts `.json` archives. Add `--force` to replace an existing
output file. `convert <source> <target> <input.jsonl> <output.jsonl>` performs
an import and export in one command. Source and target are `codex` or `claude`.

JavaScript API:

```js
import {
  importJsonl,
  encodeLino,
  decodeLino,
  exportJsonl,
} from '@link-assistant/conversation';

const graph = importJsonl(codexSession, 'codex');
const saved = encodeLino(graph);
const claudeSession = exportJsonl(decodeLino(saved), 'claude');
```

Rust API:

```rust
use link_assistant_conversation::{import_jsonl, encode_lino, export_jsonl};

let graph = import_jsonl(&codex_session, "codex")?;
let saved = encode_lino(&graph)?;
let claude_session = export_jsonl(&graph, "claude")?;
```

Same-format export keeps every imported JSON record, including metadata and
tool events. Cross-format export maps text, tool calls, and tool results.
Unknown native content remains in the archive and produces an explicit error
if the target cannot represent it. Generated native JSONL is an initial
interchange format; loading it as a resumable session in each vendor app still
requires tool-specific validation and metadata support.

## Development checks

```bash
npm test
npm run check
npm run test:rust
npm run test:cross
```

## Repository infrastructure

The sections below describe the inherited CI pipeline and universal app
example. The calculator functions and example CLI remain available during the
transition from the repository template.

## Features

- **Multi-runtime support**: Works with Bun, Node.js, and Deno
- **Universal testing**: Uses [test-anywhere](https://github.com/link-foundation/test-anywhere) for cross-runtime tests
- **Automated releases**: Changesets-based versioning with GitHub Actions
- **Optional Docker Hub publishing**: Docker images can be published after the matching npm version is visible
- **Universal app example**: React UI for the package API with GitHub Pages, Electron, and Capacitor build paths
- **Code quality**: ESLint + Prettier with pre-commit hooks via Husky
- **Package manager agnostic**: Works with bun, npm, yarn, pnpm, and deno
- **Broken link checks**: Automated link validation with [lychee](https://github.com/lycheeverse/lychee-action) and Web Archive fallback suggestions

## Quick Start

### Using This Repository

1. Clone the repository.
2. Install dependencies with `npm install` or `bun install`.
3. Import a Codex or Claude Code JSONL session with the commands above.

### Development

```bash
# Install dependencies
bun install

# Run tests
bun test --timeout 30000

# Or with other runtimes:
npm test
deno test --allow-read --allow-env=LINO_CODEC_DEBUG

# Lint code
bun run lint

# Format code
bun run format

# Check all (lint + format + file size)
bun run check

# Build the universal React example app
npm install --prefix examples/universal-app
npm run example:web:build
npm run example:desktop:package

# Try the CLI locally
node bin/example-package-name.js add 2 3
```

## Project Structure

```
.
├── .changeset/           # Changeset configuration
├── .github/workflows/    # GitHub Actions CI/CD
├── .husky/               # Git hooks (pre-commit)
├── examples/             # Usage examples
│   └── universal-app/    # React + GitHub Pages + Electron + Capacitor app
├── scripts/              # Build and release scripts
├── src/                  # Source code
│   ├── index.js          # Main entry point
│   └── index.d.ts        # TypeScript definitions
├── tests/                # Test files
├── .eslintrc.js          # ESLint configuration
├── .prettierrc           # Prettier configuration
├── bunfig.toml           # Bun configuration
├── deno.json             # Deno configuration
└── package.json          # Node.js package manifest
```

## Design Choices

### Multi-Runtime Support

This template is designed to work seamlessly with all major JavaScript runtimes:

- **Bun**: Primary runtime with highest performance, uses native test support (`bun test`)
- **Node.js**: Alternative runtime, uses built-in test runner (`node --test`)
- **Deno**: Secure runtime with built-in TypeScript support (`deno test`)

The [test-anywhere](https://github.com/link-foundation/test-anywhere) framework provides a unified testing API that works identically across all runtimes.

### Package Manager Agnostic

While `package.json` is the source of truth for dependencies, the template supports:

- **bun**: Primary choice, uses `bun.lockb`
- **npm**: Uses `package-lock.json`
- **yarn**: Uses `yarn.lock`
- **pnpm**: Uses `pnpm-lock.yaml`
- **deno**: Uses `deno.json` for configuration

Note: `package-lock.json` is not committed by default to allow any package manager.

### Universal App Example

The template includes `examples/universal-app`, a Vite React app that imports
`add` and `multiply` from `src/index.js` and renders a visual calculator UI.
The same static build is used by:

- GitHub Pages (`npm run example:web:build`)
- Electron desktop packaging (`npm run example:desktop:package`)
- Capacitor Android/iOS sync (`npm run example:mobile:sync`)

The example app has its own `package.json` and lockfile so template users can
opt into the frontend stack without adding React, Electron, or Capacitor to the
library package itself.

See [examples/universal-app/README.md](examples/universal-app/README.md) for
local web, desktop, Android, and iOS testing instructions.

### Code Quality

- **ESLint**: Configured with recommended rules + Prettier integration
- **Prettier**: Consistent code formatting
- **Husky + lint-staged**: Pre-commit hooks ensure code quality
- **File size limit**: Files must stay under 1500 lines for maintainability (enforced via ESLint and CI)

### Release Workflow

The release workflow uses [Changesets](https://github.com/changesets/changesets) for version management:

1. **Creating a changeset**: Run `bun run changeset` to document changes
2. **PR validation**: CI checks for valid changeset in each PR
3. **Automated versioning**: Merging to `main` triggers version bump
4. **npm publishing**: Automated via OIDC trusted publishing (no tokens needed)
5. **Optional Docker Hub publishing**: When configured, waits for the exact npm version and tags the Docker image with that version
6. **GitHub releases**: Auto-created with formatted release notes

> **First release of a brand-new package**: OIDC trusted publishing cannot
> create a package that does not exist yet (the first publish fails with
> `E404`, because a trusted publisher can only be configured for an existing
> package). To bootstrap, add a repository secret named `NPM_TOKEN` (a
> granular/automation token with publish access). The release workflow passes
> it as `NODE_AUTH_TOKEN` automatically. Once the package exists and OIDC
> trusted publishing is configured on npmjs.com, the token becomes optional and
> can be removed.

#### Manual Releases

Two manual release modes are available via GitHub Actions:

- **Instant release**: Immediately bump version and publish
- **Changeset PR**: Create a PR with changeset for review

### CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/release.yml`) implements a fast-fail pipeline:

**Fast checks** (~7-30s each, run first for fastest feedback):

1. **Test compilation**: Syntax-checks all `.mjs` files with `node --check`
2. **Lint, format & secrets scan**: ESLint, Prettier, jscpd, and [secretlint](https://github.com/secretlint/secretlint) for credential leak detection
3. **File line limits**: Enforces the 1500-line limit on JavaScript (`.js`, `.mjs`, `.cjs`) and Markdown (`.md`) files plus `release.yml`
4. **Changeset check**: Validates PR has exactly one changeset (added by that PR)
5. **Version check**: Blocks manual version changes in `package.json`
6. **Documentation validation**: Checks required doc files (doc line limits are enforced by the file line limits check)

**Slow checks** (only run after all fast checks pass):

7. **Test matrix**: 3 runtimes × 3 OS = 9 test combinations
8. **Broken link checks**: Validates all links in Markdown/HTML files (separate workflow)

**Release** (on merge to main):

9. **Changeset merge**: Combines multiple pending changesets at release time
10. **Release**: Automated versioning and npm publishing
11. **Optional Docker publish**: Publishes Docker Hub `latest` and npm-version tags after the npm package is visible

#### Reasonable Timeouts

Every CI job declares an explicit `timeout-minutes` so hung steps fail
in minutes instead of reaching the GitHub Actions default of six hours.
Fast checks use 5-10 minute caps, release jobs use 30 minutes, and the
link checker uses 10 minutes for external network variance.

That cap is a backstop, never the deadline: GitHub reports a job it
kills as **cancelled**, not **failed**. Long steps therefore own an
explicit budget via `scripts/run-with-budget-warning.sh`, which warns at
70% of the budget and fails the step with exit code 124 when it expires.
See [CI-TIMEOUT-BUDGETS.md](docs/CI-TIMEOUT-BUDGETS.md).

Individual tests are also capped inside supported runners:
`npm test` runs `node --test --test-timeout=30000`, and the CI Bun
runner uses `bun test --timeout 30000`. Both bound a _single test_, not
the suite, which is why the suite budget above exists. Deno does not
provide a single global per-test timeout flag, so Deno tests are
protected by their step budget and the matrix job backstop.

See [BEST-PRACTICES.md](docs/BEST-PRACTICES.md) for detailed explanations of each practice.

#### Robust Changeset Handling

The CI/CD pipeline is designed to handle concurrent PRs gracefully:

- **PR Validation**: Only validates changesets **added by the current PR**, not pre-existing ones from other merged PRs. This prevents false failures when multiple PRs merge before a release cycle completes.

- **Release-time Merging**: If multiple changesets exist when releasing, they are automatically merged into a single changeset with:
  - The highest version bump type (major > minor > patch)
  - All descriptions preserved in chronological order

This design decouples PR validation from the need to pull changes from the default branch, reducing conflicts and ensuring that even if CI/CD fails, all unpublished changesets will still get published when the error is resolved.

### Deploying the example app

The `example-app.yml` workflow deploys the universal example app to GitHub
Pages on every push to `main`. Before the first run on `main` in a new
repository created from this template, open **Settings → Pages** and set
**Source = GitHub Actions**. This is a one-time manual step and cannot be
configured from a workflow because the Pages source defaults to
_Deploy from a branch_. Without it, the `pages-deploy` job fails on
`actions/deploy-pages` with `Get Pages site failed` /
`Failed to create deployment`. After flipping the source, the workflow
provisions the Pages site on its first run.

### Auto-regenerated preview screenshots

The same `example-app.yml` workflow contains a `preview-regen` job that boots
the built example app in a headless Chromium via
[`browser-commander`](https://www.npmjs.com/package/browser-commander) +
Playwright and writes fresh screenshots to
`docs/screenshots/example-app/example-app-{locale}-{theme}.png` on every
push to `main` (and on `workflow_dispatch`). Any drift is committed back to
`main` so README/site images never go stale between releases. Screenshot-only
pushes do not match this workflow's path filter, while a protected-branch
fallback PR remains eligible for its required checks. The job runs in the
official Playwright container with the browser already installed, avoiding CI
stalls from live Chromium downloads.

The same script is available locally:

```bash
npm install --prefix examples/universal-app
npm run example:web:preview-images
# Verbose probe of <html data-theme>, <html lang>, and PNG signatures:
PREVIEW_VERBOSE=1 npm run example:web:preview-images
```

The matrix defaults to `{en, ru} × {light, dark}`. The shipped example app
has no localization or theme toggle yet, so every cell currently renders
the same UI — when a fork adds either, the matrix produces real per-cell
variants without script edits.

### Broken Link Checker

The link checker workflow (`.github/workflows/links.yml`) validates all links in Markdown and HTML files:

1. **Detection**: Uses [lychee](https://github.com/lycheeverse/lychee-action) to scan all `*.md` and `*.html` files
2. **Web Archive fallback**: For any broken links found, automatically checks the [Wayback Machine](https://web.archive.org) for archived versions
3. **Actionable suggestions**: Reports one of three outcomes for each broken link:
   - **Archived**: Suggests the Web Archive URL as a replacement
   - **Not archived**: Clearly reports the link is unrecoverable
4. **Scheduled checks**: Runs weekly to catch links that break over time (even if no files changed)
5. **Issue creation**: On scheduled runs, creates a GitHub Issue with the full broken links report

Add regex patterns to `.lycheeignore` to exclude URLs from checks (e.g., local dev URLs, example.com, known rate-limited sites).

## Configuration

### Package Name

The JavaScript package is `@link-assistant/conversation`. Release scripts derive
the package name from `package.json` at runtime.

### Protected-Branch Release Pull Requests

If `main` requires pull requests and the `Pipeline Status` check, configure a
repository secret named `RELEASE_PR_TOKEN`. It must be a fine-grained PAT for
an automation actor other than the workflow's built-in `GITHUB_TOKEN`, scoped
to this repository with Contents and Pull requests write access and Checks read
access. The release and generated-preview fallbacks use it to open the PR, wait
for the PR's own checks, and merge only after they pass. The manual
changeset-PR mode uses it for the same reason. Teams that generate short-lived
GitHub App installation tokens can wire that action output to the same workflow
inputs instead of storing a PAT.

Repositories that allow the release workflow to push directly to `main` do not
exercise the fallback, but manual changeset PR creation still requires this
secret.

### Optional Docker Hub Publishing

Docker publishing is disabled by default. To enable it for a project that ships
a Docker image, add a `Dockerfile` and configure these GitHub Actions settings:

| Setting              | Type               | Description                                                                           |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `DOCKERHUB_IMAGE`    | Variable           | Docker Hub image name, for example `namespace/image`. This enables Docker publishing. |
| `DOCKERHUB_USERNAME` | Variable           | Docker Hub username used by `docker/login-action`.                                    |
| `DOCKERHUB_TOKEN`    | Secret             | Docker Hub access token used for registry authentication.                             |
| `DOCKER_CONTEXT`     | Variable, optional | Docker build context. Defaults to `.`.                                                |
| `DOCKERFILE`         | Variable, optional | Dockerfile path. Defaults to `./Dockerfile`.                                          |

When enabled, the release workflow waits until the exact published npm version
is visible in the npm registry, then publishes Docker Hub tags for `latest` and
that same version. The Docker build also receives `NPM_PACKAGE_VERSION` as a
build argument so Dockerfiles can install the matching published package.

### ESLint Rules

Customize ESLint in `eslint.config.js`. Current configuration:

- ES Modules support
- Prettier integration
- No console restrictions (common in CLI tools)
- Strict equality enforcement
- Async/await best practices
- **Strict unused variables rule**: No exceptions - all unused variables, arguments, and caught errors must be removed (no `_` prefix exceptions)

### Prettier Options

Configured in `.prettierrc`:

- Single quotes
- Semicolons
- 2-space indentation
- 80-character line width
- ES5 trailing commas
- LF line endings

## Scripts Reference

| Script                               | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `bun test --timeout 30000`           | Run tests with Bun and a 30s per-test cap             |
| `npm test`                           | Run tests with Node.js and a 30s per-test cap         |
| `bun run lint`                       | Check code with ESLint                                |
| `bun run lint:fix`                   | Fix ESLint issues automatically                       |
| `bun run format`                     | Format code with Prettier                             |
| `bun run format:check`               | Check formatting without changing files               |
| `bun run check`                      | Run all checks (lint + format)                        |
| `npm run example:web:dev`            | Start the universal app Vite dev server               |
| `npm run example:web:build`          | Build the universal app static web bundle             |
| `npm run example:web:preview-images` | Regenerate preview screenshots via browser-commander  |
| `npm run example:desktop:package`    | Package the Electron desktop app locally              |
| `npm run example:mobile:sync`        | Build and sync the app bundle into Capacitor projects |
| `bun run changeset`                  | Create a new changeset                                |

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed contribution guidelines.

Quick steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Create a changeset: `bun run changeset`
5. Commit your changes (pre-commit hooks will run automatically)
6. Push and create a Pull Request

## Best Practices

This template implements CI/CD best practices for AI-driven development. See [BEST-PRACTICES.md](docs/BEST-PRACTICES.md) for details on:

- File size limits for AI readability
- Automated formatting and linting
- Multi-runtime and cross-platform testing
- Changeset-based versioning
- Concurrency control for CI/CD pipelines

## License

[Unlicense](LICENSE) - Public Domain
