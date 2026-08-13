# Spider Development Rules

Spider is a portfolio-quality desktop game project. Keep changes easy to review, easy to test, and consistent with the product goal: a simple, low-clutter Spider Solitaire app built for comfortable desktop play.

## Product Boundaries

- Build Spider Solitaire only.
- Do not add unrelated card games, accounts, telemetry, ads, online leaderboards, or cloud sync.
- Keep all card art, UI, naming, sound, and branding original.
- Preserve the app identity: `Spider`, `com.jaysqvl.spider`, Tauri 2, React, TypeScript, Vite, and npm.
- Keep the About dialog concise: short product summary, version metadata, and `Copyright 2026 Jay Esquivel.`

## Architecture Rules

- `src/game` is the pure TypeScript engine. It must not import React, browser APIs, Tauri APIs, filesystem APIs, or persistence clients.
- `src/persistence` owns the frontend persistence boundary and talks to Tauri commands. Browser fallbacks are for development preview only.
- `src/components` contains focused reusable UI components.
- `src/styles` contains global styling and design tokens.
- `src-tauri` owns OS integration, SQLite storage, migrations, updater checks, packaging, and native commands.
- Native storage commands must never re-enter the SQLite connection mutex while already holding it.
- Display settings such as theme, card back, card face theme, reduced motion, and game scale must remain persisted settings with UI coverage.
- Game scale must flow through CSS variables and shared settings types; do not duplicate hardcoded card or tableau dimensions in feature code.

## UI Rules

- The default `100%` game scale is the comfort baseline and maps to the original larger visual size.
- Auto-fit game scale is the default. It must consider both play-surface width and height and must avoid normal-play horizontal or vertical scrolling.
- Auto-fit should maximize available width first; use card overlap to solve height pressure before shrinking global card size.
- Auto-fit must not recompute global card scale or board-wide stack spacing from live tableau height during normal moves. Use stable viewport-based fit plus local column compression for tall stacks.
- Auto-fit should trust measured play-surface dimensions over transient viewport values during native desktop resize/maximize events.
- Ultrawide auto-fit must reserve readable height for a King-to-2 face-up run with hidden cards underneath before allowing cards to grow from extra horizontal space.
- Compact-width tall stacks must cap their visual height before they consume the entire tableau lane. Compress the local column reveal plan while preserving the exposed rank/suit floor instead of letting one run dominate the window.
- Stacked face-up cards must reveal enough of the top index to remain playable; do not use one aggressive overlap value for both face-down and face-up covered cards.
- On large or ultrawide boards, covered face-up cards must reserve enough exposed height for the full corner rank/suit pair. Do not let enlarged card art clip the stacked index.
- Tableau fit calculations need a rounding guard and browser-verified screenshots across tight, tall, standard, and ultrawide-short viewports so the rightmost column cannot be clipped and resize transitions cannot settle into stale tiny-card states.
- Card rank typography must scale from card dimensions so tighter windows preserve readable ranks without breaking tableau fit.
- Auto-fit must not impose an arbitrary preferred-width ceiling or fill ultrawide monitors purely by width. Let cards grow only while the measured tableau height can still support readable stacks, then compress tall stacks before shrinking global card size.
- Card faces should render as cohesive card units. Prefer a single card-local SVG viewBox for corners, pips, and court art over independently capped CSS text fragments.
- Corner ranks and their suit marks must scale together as a readable pair. Do not enlarge center pips while leaving the index tiny.
- Corner index suit marks must stay visually subordinate to central pips so they do not read as extra pips or make card values ambiguous.
- Corner rank/suit geometry must stay identical between full card faces and covered stack indexes. Do not move the suit from under the rank to beside it, or change rank size, when a card becomes covered or moves.
- Suit marks should be drawn with card-local SVG geometry, not font glyphs, so hearts, spades, clubs, and diamonds stay crisp at every card size.
- Keep core controls visible and dependable. Do not hide New Game, Restart, or primary utility controls behind a hover-only top-edge menu.
- Utility controls such as Settings, Stats, About, and installer actions should live in a normal right-aligned toolbar group or settings surface.
- Do not place utility controls in floating overlays that cover the score strip or board.
- Dev-only testing tools must include enough diagnostics to reproduce layout bugs: viewport/screen dimensions, control layout, card sizing CSS variables, relevant board rectangles, game seed/difficulty, tableau shape, settings, and recent dev log events.
- Debug report copy/download and extra UI logging must be gated to local/dev-release builds. Stable builds should compile the dev tools boundary to no-op behavior and must not expose debug logs or diagnostic exports.
- Do not render developer-style tableau column numbers on the game board.
- Restart follows the currently selected difficulty, matching New Game. Do not make difficulty changes apply to one primary game command but not the other.
- Stock and completed-sequence slots should live together in a compact resource dock. Use the right-side dead space when the bottom-fit tableau and dock can fit side by side without shrinking card width; otherwise use the bottom control area. Side placement must reserve real tableau width, never overlay playable cards.
- In constrained or narrow desktop windows, the resource dock belongs in the bottom control lane: completed-sequence summaries span horizontally, and the stock/deal control sits in the same bottom lane as the history actions instead of becoming a vertical side rail.
- Resource dock placement must be deterministic from the current viewport and bottom-layout baseline. Do not use the currently rendered tableau height, current dock placement, or hysteresis thresholds that make the same resized window end in different layouts or oscillate across animation frames.
- Completed-sequence status should summarize active suits with suit marks and completed/possible counts. Do not use generic empty slots, trophy icons, or card-back stacks for completed sequences.
- Do not use a persistent visual footer/status strip for transient messages.
- Stacked tableau cards must paint in card-index order so lower/front cards cover cards behind them.
- Covered tableau cards should render only their exposed top label; hidden centers and bottom corners must not paint through the front card face.
- Covered tableau cards should use a compact exposed rank/suit label so large-card stacks stay readable without wasting excessive vertical space. Auto-fit metrics must use the same effective card width that CSS renders, not an uncapped candidate width that creates oversized stack gaps.
- Comfortable face-up stack spacing and emergency compression floors are separate concerns. When a stack has vertical room, keep the generous reveal target; only tall local stacks should compress down toward compact rank/suit bands.
- Do not shrink the entire board to solve one tall tableau stack. Prefer large, responsive card sizing, then compress only the tall column's reveals enough to fit the measured lane.
- Full-height ultrawide boards must grow past the default desktop card cap when space allows it. Short-window safeguards must not make spacious monitors feel tiny.
- Dark card faces must keep rank, suit, pip, and court-art contrast high in both light and dark app themes.
- Dark card faces should stay clean and card-like; do not draw a visible inner inset rectangle that light cards do not show.
- Tableau card wrappers must not add line-height or baseline space; stack reveal math assumes each wrapper is exactly the rendered card height plus its explicit overlap margin.
- Stock and action controls must not overlap tableau cards. Auto-fit calculations should reserve enough space for floating controls.
- Empty completed-sequence placeholders must not reserve a full board row; the topbar completion count is the primary always-visible progress indicator.
- Drag movement should batch visual state updates with animation-frame scheduling. Do not re-render the full board on every raw pointer event.
- Move-to-place animation should be targeted to moved card IDs. Do not restore broad whole-board layout animation that makes every tableau update do layout work.
- Stock deal animations must originate from the visible stock pile/deal button position and fly to each destination column. Do not use synthetic left/right board-fill offsets.
- Stock deal animations must keep the previously top face-up card details visible until the incoming dealt card visually arrives. Do not blank covered card centers while the covering card is still in flight.

## Game Invariants

- Every game uses exactly 104 physical cards with stable card IDs.
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
- Stats rollups must preserve cumulative lifetime points, moves, play time, outcomes, best score, and best win time across updates. Schema changes need browser fallback and Tauri storage migrations.

## Testing Rules

- Every change to game rules requires unit tests in `src/game`.
- UI tests should cover workflows that can regress: new game, moving cards, stock dealing, undo/redo, hints, settings, stats, reset confirmation, responsiveness, and card stacking.
- Persistence tests should cover save/load, migrations, corrupted data recovery, settings, stats, completed games, and reset behavior.
- Do not mark a feature complete unless `npm run typecheck`, `npm run lint`, and `npm test` pass locally where the toolchain permits it.
- Auto-fit, card sizing, resource dock, or responsive board changes must also pass `npm run test:layout`; inspect the generated screenshots when changing layout thresholds.
- Before release, also run `npm run build` and `npm run verify:workflows`.
- Native Rust/Tauri changes must satisfy `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and native smoke checks in CI.

## Commit And Release Rules

- Use conventional commit messages, for example `feat: scaffold Spider desktop app`, `fix: prevent covered card bleed-through`, or `test: cover stock dealing invariants`.
- Keep commits coherent and reviewable; do not mix unrelated refactors with feature work.
- Update documentation when behavior, setup, release, or architecture changes.
- Use semantic versioning for shipped versions.
- Keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` versions in sync.
- Release Please owns stable version bumps across npm, Tauri, and Rust manifests and lockfiles. Do not hand-edit only one version pin.
- Merge the release-please pull request to cut a stable release; ordinary feature merges should only update that pending release pull request.
- Publish releases from tags named `vMAJOR.MINOR.PATCH`.
- Do not claim a release exists until GitHub Actions has produced downloadable installers.
- Keep release-please releases in draft state until all platform installers, updater signatures, and `latest.json` have been built successfully.
- Quote GitHub Actions expressions that contain YAML-significant text such as `: `, and keep every workflow covered by the repository YAML parser; malformed workflow YAML can be rejected before any job or log exists.
- Release workflows must produce installers, signed updater artifacts, and `latest.json`; source-code archives alone do not count.
- Release notes must include included commit subjects and short hashes.
- Public installer asset names should use `macos-apple-silicon-arm64`, `macos-intel-x64`, and `windows-x64` style labels.
