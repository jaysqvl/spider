# Spider Development Rules

This repository is a portfolio-quality desktop game project. Keep it easy to review, easy to test, and consistent with `PLANNING.md`.

## Product Boundaries

- Build Spider Solitaire only.
- Do not add a general solitaire shell, unrelated card games, accounts, telemetry, ads, online leaderboards, or cloud sync.
- Keep all card art, UI, naming, sound, and branding original. Do not copy Microsoft assets or exact visual treatments.
- Preserve the app identity:
  - Product name: `Spider`
  - Bundle identifier: `com.jaysqvl.spider`
  - Package manager: npm
  - Desktop shell: Tauri 2
  - Frontend: React, TypeScript, Vite

## Architecture Rules

- `src/game` is the pure TypeScript engine. It must not import React, browser APIs, Tauri APIs, filesystem APIs, or persistence clients.
- `src/persistence` owns the frontend persistence boundary and talks to Tauri commands. Browser-only fallbacks are acceptable for development preview, but SQLite through Tauri is the product path.
- `src/components` contains reusable UI components. Keep them focused and presentational unless local interaction state makes the component clearer.
- `src/styles` contains global styling and design tokens.
- `src-tauri` owns OS integration, SQLite storage, migrations, updater checks, packaging, and native commands.
- Display settings such as theme, card back, reduced motion, and game scale must remain persisted settings with UI coverage.
- Game scale must flow through CSS variables and shared settings types; do not duplicate hardcoded card or tableau dimensions in feature code.
- The default `100%` game scale is the comfort baseline for playability and maps to the original 130% visual size; lower values are shrink options.
- Update checks must be reachable from Settings and use the Tauri updater path in desktop builds.
- Tableau columns should stay visually quiet; do not render developer-style column numbers on the game board.
- Deal animations are UI-only. They must not alter engine state, persistence payloads, or move legality.
- Prefer small, named functions over hidden behavior in large event handlers.
- Add abstractions only when they remove real duplication or clarify a boundary.

## Game Invariants

- Every game uses exactly 104 physical cards with stable card IDs.
- Difficulty controls suit composition only:
  - 1 suit: 8 copies per rank in one suit.
  - 2 suits: 4 copies per rank in two suits.
  - 4 suits: 2 copies per rank in four suits.
- Initial tableau shape is always `[6, 6, 6, 6, 5, 5, 5, 5, 5, 5]`.
- Only the top card of each initial tableau column starts face up.
- Stock starts as 5 deals of 10 cards.
- Stock dealing is blocked if any tableau column is empty.
- Only face-up descending same-suit runs may move as a unit.
- Tableau placement builds downward by rank; suit does not matter for placement.
- Empty tableau columns accept any valid movable card or run.
- Complete face-up same-suit King-to-Ace runs are removed automatically.
- The game is won after 8 completed runs.
- Difficulty plus seed must reproduce the same initial deal.

## Testing Rules

- Every change to game rules requires unit tests in `src/game`.
- Tests should assert invariants and user-visible behavior, not implementation trivia.
- Engine tests must run without DOM, Tauri, SQLite, or filesystem access.
- UI tests should cover workflows that can regress: new game, moving cards, stock dealing, undo/redo, hints, settings, stats, and reset confirmation.
- Persistence tests should cover save/load, migrations, corrupted database recovery, settings, stats, completed games, and reset behavior.
- Do not mark a feature complete unless its core behavior can be verified by `npm test`, `npm run typecheck`, and `npm run lint` where the local toolchain permits it.
- Native Rust/Tauri changes must satisfy `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and the Rust smoke checks in CI.

## Commit And Review Rules

- Use conventional commit messages, for example:
  - `feat: scaffold Spider desktop app`
  - `test: cover stock dealing invariants`
  - `fix: prevent mixed-suit run moves`
  - `docs: document release prerequisites`
- Keep commits coherent and reviewable.
- Do not mix unrelated refactors with feature work.
- Update documentation when behavior, setup, release, or architecture changes.
- Before opening a PR or publishing a release, run the full available verification suite and call out any unavailable local checks.
- External GitHub Actions in workflow files must be pinned to full 40-character commit SHAs; `npm run verify:workflows` must pass.

## Release Rules

- Use semantic versioning for shipped versions.
- Keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` versions in sync.
- Publish releases from annotated tags named `vMAJOR.MINOR.PATCH`, for example `v0.1.0`.
- Do not claim a release exists until the tag has been pushed and GitHub Actions has produced downloadable artifacts.
- After each release workflow run, verify the published release with `gh release view` and confirm installer assets are present before calling the release complete.
- Release workflows must produce downloadable installers, signed updater artifacts, and `latest.json`; source-code archives alone do not count as a shipped app release.
- Do not publish a first installable release without updater configuration compiled in. The app needs a committed public updater key and the matching `TAURI_SIGNING_PRIVATE_KEY` GitHub secret.
- Commit `src-tauri/Cargo.lock` for native releases and treat a missing Rust lockfile as release-blocking.
- CI and release workflows must run a locked Cargo metadata check before native Rust tests or packaging.
- Pin third-party release workflow actions to immutable commit SHAs before trusting them with release, signing, updater, or notarization secrets.
