# Spider

Spider is an original cross-platform desktop Spider Solitaire app built with Tauri 2, React, TypeScript, Vite, and SQLite.

This project is not affiliated with Microsoft and does not use Microsoft branding, sounds, layouts, or card art.

## Current Scope

- Classic Spider Solitaire only.
- Difficulty modes: 1 suit, 2 suits, and 4 suits.
- Deterministic seeds for reproducible deals.
- Local-only saved game, settings, and statistics.
- Tauri desktop packaging for Windows and macOS.
- GitHub Actions CI and semver release automation.

## Development Setup

Install Node.js LTS, npm, Rust, and the platform prerequisites from the official Tauri setup guide.

```bash
npm ci
npm run dev
```

For the desktop shell:

```bash
npm run tauri dev
```

The frontend can run in a browser with a localStorage fallback, but the production persistence path is SQLite through Tauri commands in the OS app-data directory for `com.jaysqvl.spider`.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run tauri build
```

The pure game engine lives in `src/game` and is tested without React, DOM, Tauri, SQLite, or filesystem access.

## Project Structure

```text
src/
  game/             Pure Spider rules, deterministic shuffle, state transitions
  persistence/      Frontend persistence client and development fallback
  components/       Reusable React UI components
  styles/           Global styles and design tokens
  test/             Test setup
src-tauri/
  src/              Tauri commands, SQLite storage, updater integration
  capabilities/     Tauri command permissions
.github/workflows/
  ci.yml
  release.yml
```

See `rules.md` for engineering rules and `PLANNING.md` for product requirements.

## Local Data

All user data is local-only. The Tauri shell creates `spider.sqlite3` inside the OS app-data directory for `com.jaysqvl.spider`. The database stores settings, the active game snapshot, completed game records, and aggregate statistics. If SQLite quick-check or migration fails, the app backs up the existing database with a timestamped filename and creates a clean database.

## Release Automation

Downloadable builds are published from GitHub Releases:

<https://github.com/jaysqvl/spider/releases>

Release tags use semantic versioning with a leading `v`, for example `v0.1.0`. The tag version must match `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

`.github/workflows/release.yml` builds:

- Windows x64 NSIS artifacts on `windows-latest`.
- macOS Apple Silicon artifacts on `macos-14`.
- macOS Intel artifacts on `macos-13`.
- SHA-256 checksum files for release assets.
- A published GitHub Release on semver tags or manual dispatch.

Unsigned builds remain possible by default.

Optional release secrets:

- `TAURI_UPDATER_PUBKEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

Set `TAURI_UPDATER_ENDPOINT` as a repository variable to override the default GitHub Release updater metadata URL.

## Commit Style

Use conventional commits:

```text
feat: scaffold Spider desktop app
test: cover stock dealing invariants
fix: prevent mixed-suit run moves
docs: document release prerequisites
```
