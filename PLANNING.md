# Spider Planning And Requirements

## Purpose

Build `Spider`, a cross-platform desktop Spider Solitaire app inspired by the classic Microsoft Spider Solitaire experience. This project is Spider Solitaire only. The implementation must not become a general solitaire collection or a Microsoft Solitaire Collection clone.

This document is the source of truth for the implementation agent. If another agent is assigned to build the app, it should follow this document without re-deciding the app stack, persistence model, release target, game scope, or app identity.

## Product Identity

- Product name: `Spider`
- Bundle identifier: `com.jaysqvl.spider`
- Repository: `jaysqvl/spider`
- License: MIT, matching the existing repository license
- Initial release channel: GitHub Releases
- Target platforms for v1: Windows and macOS
- Linux support: acceptable as a later bonus if Tauri build support falls out naturally, but not required for v1 acceptance

The bundle identifier is part of the durable local-data namespace. Do not change it casually after users have installed builds, because doing so can orphan saved games and settings.

## Scope

### In Scope

- One desktop app that installs, launches, updates, and persists local user data.
- Classic Spider Solitaire gameplay only.
- Difficulty modes:
  - 1 suit
  - 2 suits
  - 4 suits
- Local saved game resume.
- Local statistics.
- Local settings.
- GitHub Actions CI and release automation.
- Windows and macOS packaged artifacts.
- Optional signing and notarization when credentials are configured.

### Explicitly Out Of Scope

- Klondike.
- FreeCell.
- Pyramid.
- TriPeaks.
- Golf.
- Daily Challenges.
- Microsoft Solitaire Collection-style multi-game shell.
- Microsoft branding, logos, sounds, card art, UI assets, or exact visual copies.
- Cloud saves.
- Accounts.
- Telemetry.
- Ads.
- Online leaderboards.
- In-app purchases.

## Stack Decision

Use:

- Tauri 2 for the desktop shell and packaging.
- React for the UI.
- TypeScript for the game engine and frontend.
- Vite for frontend build tooling.
- npm for package management.
- SQLite for durable local data.
- GitHub Actions for CI/CD.
- GitHub Releases for distribution.

Electron is not required. Electron is a valid cross-platform desktop option, but this app does not need a bundled Chromium and Node runtime. Tauri is the default because it can provide a smaller native desktop package, native installers, updater integration, and a clean split between a web-based UI and OS-level app behavior. Tauri does require Rust and platform build prerequisites, so the implementation must document local setup clearly.

## Architecture Overview

The app should be organized around three boundaries:

- Pure game engine: deterministic Spider rules and state transitions in TypeScript.
- React application: rendering, interaction, animation, settings, stats, and user workflows.
- Tauri shell: OS integration, durable data paths, SQLite access, updater integration, packaging, signing, and native window lifecycle.

Keep the game engine independent of React and Tauri. It should run in unit tests with no DOM, no filesystem, and no native APIs.

Recommended future structure:

```text
src/
  game/             Pure TypeScript Spider engine
  persistence/      Frontend-facing persistence client and serializers
  components/       React UI components
  screens/          Game, settings, stats, about/update screens
  styles/           App styling and tokens
  test/             Frontend and game test helpers
src-tauri/
  src/              Tauri commands and SQLite/native integration
  migrations/       SQLite migrations if managed from Rust
.github/workflows/
  ci.yml
  release.yml
```

## Game Rules

Implement classic Spider Solitaire rules.

### Deck Composition

All difficulty modes use 104 cards total:

- 1 suit: 8 copies of each rank in one suit label.
- 2 suits: 4 copies of each rank in each of two suit labels.
- 4 suits: 2 standard 52-card decks, with 2 copies of each rank and suit.

The implementation must track a stable card ID for each physical card. Rank and suit are not enough because duplicate cards exist.

### Initial Deal

- Create 10 tableau columns.
- Deal 54 cards to tableau.
- The first 4 columns receive 6 cards each.
- The remaining 6 columns receive 5 cards each.
- Only the top card of each tableau column starts face up.
- The remaining 50 cards become the stock.
- The stock is dealt as 5 rounds of 10 cards.

### Moves

- Tableau builds downward by rank.
- A card or run may be placed onto a destination card exactly one rank higher.
- The destination suit does not need to match for placement.
- Only a face-up descending same-suit run may be moved as a unit.
- Empty tableau columns may accept any single card or valid movable run.
- Face-down cards are revealed when they become the top card of a tableau column.
- Deal from stock by placing one face-up card on each tableau column.
- Do not allow stock dealing when any tableau column is empty.
- Automatically remove a complete King-to-Ace same-suit face-up sequence.
- The player wins when all 8 complete same-suit sequences have been removed.

### Required Player Actions

- New game.
- Restart current seed and difficulty.
- Undo.
- Redo.
- Hint.
- Deal stock.
- Move cards by drag/drop.
- Move cards by click/tap selection as a fallback.
- Resume saved game.
- Reset local data from inside the app, with confirmation.

### Scoring And Timing

Use a simple classic-style score model unless implementation discovers a stronger Microsoft-compatible rule that is easy to test:

- Start each game at 500 points.
- Subtract 1 point per player move.
- Add 100 points for each completed removed sequence.
- Track elapsed active play time.
- Pausing/minimizing should not keep incrementing active play time if the app can reliably detect it.

The scoring system must be isolated enough to change later without rewriting move validation.

### Determinism

- Every game must have a deterministic seed.
- Given difficulty plus seed, the initial deal must be reproducible.
- Tests must verify seeded shuffle determinism.
- Store the seed with saved games and completed game records.

## UI Requirements

The first screen should be the playable game, not a marketing page.

Primary UI:

- 10 tableau columns.
- Stock indicator with remaining deals.
- Completed sequence/foundation area showing progress out of 8.
- Header or toolbar with new game, restart, undo, redo, hint, settings, stats, and update/about access.
- Visible score, move count, elapsed time, and difficulty.
- Clear win state.

Interaction requirements:

- Drag/drop cards and valid runs.
- Click/select fallback for accessibility and non-pointer workflows.
- Keyboard shortcuts for common actions where practical:
  - New game.
  - Undo.
  - Redo.
  - Hint.
  - Deal stock.
- Animations for deals, moves, reveals, and sequence removal.
- Animations must be interrupt-safe and must not corrupt game state.
- UI must remain usable at common desktop window sizes, including smaller laptop windows.

Visual design:

- Original card art and UI only.
- Do not copy Microsoft assets or exact layout treatment.
- Use a polished desktop-game feel: readable cards, restrained controls, smooth motion, and no unnecessary landing-page content.
- Support at least light and dark themes.
- Include card back selection if it can be implemented without delaying core gameplay.

## Persistence Requirements

All user data must be local-only and stored in the OS app-data directory associated with `com.jaysqvl.spider`. Never store saves, settings, or stats inside the installed app bundle or beside the executable.

Local data must survive:

- App restart.
- App update.
- Normal uninstall/reinstall flows by default.

Local data may be deleted only by:

- An explicit in-app reset action with confirmation.
- A future installer option that clearly asks the user whether to delete app data.
- Manual user deletion outside the app.

Use SQLite for:

- Schema migrations.
- Settings.
- Active saved game.
- Completed game records.
- Aggregate statistics.

Recommended logical tables:

- `schema_migrations`: applied migration IDs and timestamps.
- `settings`: key/value settings, stored as JSON values when appropriate.
- `active_game`: the current resumable game snapshot, difficulty, seed, timestamps, score, moves, elapsed time, and serialized engine state.
- `completed_games`: one row per completed or abandoned game, including difficulty, seed, outcome, score, moves, elapsed time, and timestamps.
- `stats_rollups`: aggregate stats by difficulty and all-time totals.

Persistence behavior:

- Save after every committed player move, stock deal, undo, redo, restart, and settings change.
- Use atomic database transactions for writes.
- Include a `state_version` field in serialized game snapshots.
- Add migration code before changing serialized state shape.
- If the database is corrupted or cannot be migrated, back it up with a timestamped filename, create a clean database, and show a non-fatal recovery message.

## Tauri Boundary

Tauri/Rust should own:

- App-data path resolution.
- SQLite database file creation.
- SQLite migrations.
- Atomic persistence commands.
- Local-data reset command.
- App version lookup.
- Update checks and install flow.
- Native window settings.
- Packaging configuration.

Expose a narrow command API to the frontend. Recommended initial commands:

- `load_app_state`
- `save_active_game`
- `clear_active_game`
- `record_completed_game`
- `load_settings`
- `save_settings`
- `load_stats`
- `reset_local_data`
- `check_for_updates`
- `install_update`

The frontend should not directly write arbitrary filesystem paths.

## CI Requirements

Create `.github/workflows/ci.yml` once the app is scaffolded.

CI should run on pull requests and pushes to `main`.

Required checks:

- Install dependencies with `npm ci`.
- Typecheck TypeScript.
- Lint frontend and TypeScript.
- Run game engine and frontend unit tests.
- Build the frontend.
- Run Rust formatting/checks/tests for `src-tauri`.
- Run a Tauri build smoke check where practical.

Expected commands to make true:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run tauri build
```

If platform packaging is too slow for every PR, keep heavyweight packaging in release workflow and run lighter compile/build checks in PR CI.

## Release Requirements

Create `.github/workflows/release.yml` once the app is scaffolded.

Release workflow:

- Trigger manually with `workflow_dispatch`.
- Trigger on version tags matching `v*`.
- Build Windows artifacts on GitHub-hosted Windows runners.
- Build macOS artifacts on GitHub-hosted macOS runners.
- Cache npm dependencies.
- Cache Rust build artifacts.
- Generate installers and update artifacts.
- Generate SHA-256 checksums for release assets.
- Publish a draft GitHub Release with artifacts, checksums, and release notes.

Initial artifacts:

- Windows x64 NSIS installer.
- macOS Apple Silicon artifact.
- macOS Intel artifact.
- Updater artifacts when updater signing keys are configured.

Optional later artifacts:

- macOS universal artifact if Tauri configuration and CI time make it practical.
- Linux AppImage/deb if Linux support is added.

Signing and notarization:

- macOS signing and notarization are required for smooth public downloads, but unsigned/ad-hoc development builds must remain possible.
- Windows code signing is required to reduce SmartScreen friction, but unsigned development builds must remain possible.
- Signing steps must be credential-gated so release builds still produce unsigned draft artifacts when secrets are absent.

Updater:

- Use Tauri updater support.
- Prefer GitHub Release-hosted static metadata for v1.
- The app should expose manual "Check for Updates" first.
- Automatic background checks may be added later, but must not block app startup or gameplay.

## Security And Privacy Requirements

- No telemetry in v1.
- No accounts in v1.
- No cloud sync in v1.
- No ads in v1.
- No third-party analytics.
- Keep Tauri command permissions narrow.
- Do not expose broad filesystem access to the frontend.
- Do not download executable code at runtime outside the official update mechanism.
- Treat update signing keys and code-signing credentials as CI secrets only.

## Testing Plan

### Game Engine Tests

- Deck composition for 1-suit, 2-suit, and 4-suit modes.
- Initial deal shape.
- Initial face-up and face-down card counts.
- Stock contains 50 cards after initial deal.
- Stock deal places one face-up card on each tableau column.
- Stock deal is blocked when any tableau column is empty.
- Legal descending placement.
- Illegal rank placement.
- Moving a same-suit descending run.
- Blocking a mixed-suit run move.
- Empty tableau accepts valid movable runs.
- Face-down reveal after uncovering.
- Completed same-suit King-to-Ace sequence removal.
- Score changes after moves and sequence completion.
- Move count changes.
- Undo.
- Redo.
- Win detection.
- Seeded shuffle determinism.
- Restart reproduces the same initial deal.

### Persistence Tests

- Save and load active game.
- Resume game after app restart.
- Settings persist across restart.
- Completed games are recorded.
- Aggregate stats update correctly.
- Migrations run once.
- Migrations preserve existing data.
- Corrupted database is backed up.
- Clean database is created after corruption recovery.
- In-app reset clears local data only after confirmation.

### UI Tests

- Start a new 1-suit game.
- Start a new 2-suit game.
- Start a new 4-suit game.
- Drag a legal card/run.
- Reject an illegal card/run.
- Deal from stock.
- Block stock deal with an empty tableau.
- Undo and redo from toolbar.
- Use hint.
- Complete a sequence.
- Win state is shown.
- Open settings.
- Change theme.
- Open stats.
- Resize to common desktop sizes without overlapping controls or unreadable cards.

### Release Acceptance Tests

- Windows installer is generated.
- Windows app installs and launches.
- macOS artifact is generated.
- macOS app launches.
- Updating from one version to the next preserves active game, settings, and stats.
- Normal uninstall/reinstall preserves active game, settings, and stats by default.
- In-app reset deletes active game, settings, and stats only after confirmation.

## Documentation Requirements

The implementation should add or update:

- `README.md` with local setup, development commands, build commands, and release overview.
- Contributor notes for installing Rust and platform prerequisites.
- CI/CD secret names for optional signing and updater support.
- A short explanation that this is an original Spider Solitaire app and not affiliated with Microsoft.

## External References

Use these official references while implementing CI, packaging, updates, and signing:

- Tauri GitHub pipeline: https://v2.tauri.app/distribute/pipelines/github/
- Tauri updater: https://v2.tauri.app/plugin/updater/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
- Tauri Windows signing: https://v2.tauri.app/distribute/sign/windows/
- GitHub-hosted runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

Relevant implementation notes from those references:

- Tauri's GitHub pipeline supports using `tauri-action` to build and upload app artifacts through GitHub Actions.
- Tauri updater can use a dynamic update server or static release metadata.
- macOS public distribution needs signing and notarization for the smoothest user experience.
- Windows public distribution benefits from code signing to reduce SmartScreen friction.
- GitHub-hosted runners include Windows and macOS environments suitable for platform-specific builds.

## Implementation Milestones

### Milestone 1: Scaffold

- Create Tauri 2 + React + TypeScript + Vite app.
- Configure product name `Spider`.
- Configure bundle identifier `com.jaysqvl.spider`.
- Add basic app window and first playable screen shell.
- Add initial CI for install, typecheck, lint, test, and build.

### Milestone 2: Game Engine

- Implement pure TypeScript model and rules.
- Add deterministic seeded shuffle.
- Add full unit test coverage for core Spider rules.
- Add save-state serialization versioning.

### Milestone 3: Playable UI

- Render tableau, stock, completed sequences, score, moves, timer, and toolbar.
- Implement drag/drop and click/select movement.
- Implement undo, redo, restart, new game, stock deal, hints, and win state.
- Add responsive desktop layout checks.

### Milestone 4: Local Persistence

- Add SQLite integration through Tauri.
- Add migrations.
- Persist active game, settings, completed games, and stats.
- Add corruption backup and recovery.
- Add in-app reset local data action.

### Milestone 5: Release Pipeline

- Add Windows and macOS release workflow.
- Upload draft GitHub Releases.
- Generate checksums.
- Add optional signing/notarization gates.
- Add updater metadata and manual update check when keys are configured.

## Acceptance Criteria

The implementation is acceptable when:

- The app is Spider Solitaire only.
- The app uses original branding, UI, and assets.
- The app can be installed and launched on Windows.
- The app can be installed and launched on macOS.
- The app supports 1-suit, 2-suit, and 4-suit Spider.
- The game rules match this document.
- Saved game, settings, and stats persist across restart.
- Local data survives updates.
- Local data survives normal uninstall/reinstall by default.
- The app has an explicit reset-local-data workflow.
- CI runs the required checks.
- Release workflow can produce GitHub Release artifacts.
- Unsigned development builds remain possible.
- Signing/notarization can be enabled by adding CI secrets.

## Assumptions

- The implementation agent should build from this planning document.
- The current repository starts essentially empty except for `LICENSE`.
- No cloud services are required for v1.
- No Microsoft-owned assets may be used.
- Rust must be installed locally for Tauri development and packaging.
- npm is the package manager unless this document is intentionally revised.
