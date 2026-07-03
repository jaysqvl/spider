import { useMemo, useState } from "react";
import { STATE_VERSION, type Card, type CompletedSequence, type Difficulty, type GameState, type Rank, type Suit } from "../game/types";
import {
  clearDevLogEntries,
  getDevLogEntries,
  type DevDiagnosticsSnapshot,
  type DevLogEntry
} from "./devTools";

export interface DevScenarioPanelProps {
  onLoadGame: (game: GameState, label: string) => void;
  onClose: () => void;
  getDiagnostics: () => DevDiagnosticsSnapshot;
}

type DevScenarioId = "hidden-king-to-two" | "deep-compression" | "full-width-stagger" | "resource-rail";

interface DevScenario {
  id: DevScenarioId;
  label: string;
  description: string;
  createGame: () => GameState;
}

const RANKS_HIGH_TO_LOW: Rank[] = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const KING_TO_TWO: Rank[] = RANKS_HIGH_TO_LOW.slice(0, -1);
const SUIT_CYCLE: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

const DEV_SCENARIOS: DevScenario[] = [
  {
    id: "hidden-king-to-two",
    label: "Hidden + K-to-2 vertical run",
    description: "Four face-down cards under a full King-to-2 face-up run in the first column.",
    createGame: createHiddenKingToTwoGame
  },
  {
    id: "deep-compression",
    label: "Deep mixed compression",
    description: "A very tall mixed-suit column with hidden cards to stress local reveal compression.",
    createGame: createDeepCompressionGame
  },
  {
    id: "full-width-stagger",
    label: "Full-width staggered tableau",
    description: "All ten columns carry different heights so spacing and horizontal fit can be checked quickly.",
    createGame: createFullWidthStaggerGame
  },
  {
    id: "resource-rail",
    label: "Resource rail pressure",
    description: "Four-suit foundations plus stock and uneven columns for side-rail and bottom-rail checks.",
    createGame: createResourceRailGame
  }
];

interface DebugReport {
  capturedAt: string;
  diagnostics: DevDiagnosticsSnapshot;
  logs: DevLogEntry[];
}

export function DevScenarioPanel({ onLoadGame, onClose, getDiagnostics }: DevScenarioPanelProps) {
  const [selectedId, setSelectedId] = useState<DevScenarioId>(DEV_SCENARIOS[0].id);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const selectedScenario = DEV_SCENARIOS.find((scenario) => scenario.id === selectedId) ?? DEV_SCENARIOS[0];
  const report = useMemo(() => createDebugReport(getDiagnostics), [getDiagnostics, refreshKey]);
  const reportJson = useMemo(() => JSON.stringify(report, null, 2), [report]);
  const viewportLabel = `${formatDebugValue(report.diagnostics.viewport.innerWidth)} x ${formatDebugValue(
    report.diagnostics.viewport.innerHeight
  )}`;
  const visualViewportLabel = `${formatDebugValue(report.diagnostics.viewport.visualViewportWidth)} x ${formatDebugValue(
    report.diagnostics.viewport.visualViewportHeight
  )}`;
  const layout = report.diagnostics.layout;
  const game = report.diagnostics.game;

  async function handleCopyReport(): Promise<void> {
    try {
      await navigator.clipboard.writeText(reportJson);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  function handleDownloadReport(): void {
    const blob = new Blob([reportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `spider-debug-${new Date().toISOString().replaceAll(":", "-")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function handleClearLogs(): void {
    clearDevLogEntries();
    setCopyState("idle");
    setRefreshKey((key) => key + 1);
  }

  return (
    <>
      <div className="settings-grid">
        <label>
          <span>Stress state</span>
          <select
            aria-label="Stress state"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value as DevScenarioId)}
          >
            {DEV_SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="about-panel">
        <p className="about-panel__summary">{selectedScenario.description}</p>
      </div>

      <section className="dev-diagnostics" aria-label="Debug diagnostics">
        <div className="dev-diagnostics__header">
          <h3>Debug Data</h3>
          <div className="dev-diagnostics__actions">
            <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
              Refresh
            </button>
            <button type="button" onClick={() => void handleCopyReport()}>
              Copy Report
            </button>
            <button type="button" onClick={handleDownloadReport}>
              Download Report
            </button>
            <button type="button" onClick={handleClearLogs}>
              Clear Logs
            </button>
          </div>
        </div>

        {copyState === "copied" ? <p className="dev-diagnostics__status">Debug report copied.</p> : null}
        {copyState === "failed" ? <p className="dev-diagnostics__status">Clipboard copy failed.</p> : null}

        <dl className="dev-diagnostics__grid">
          <DebugDatum label="Web UI" value={viewportLabel} />
          <DebugDatum label="Visual viewport" value={visualViewportLabel} />
          <DebugDatum label="Device pixel ratio" value={report.diagnostics.viewport.devicePixelRatio} />
          <DebugDatum label="Screen" value={`${formatDebugValue(report.diagnostics.viewport.screenWidth)} x ${formatDebugValue(report.diagnostics.viewport.screenHeight)}`} />
          <DebugDatum label="Control layout" value={layout.controlLayout} />
          <DebugDatum label="Card fit width" value={layout.cardFitWidth} />
          <DebugDatum label="Card width" value={formatPixels(layout.renderedCardWidth)} />
          <DebugDatum label="Card height" value={formatPixels(layout.renderedCardHeight)} />
          <DebugDatum label="Tableau" value={`${formatDebugValue(layout.tableauWidth)} x ${formatDebugValue(layout.tableauHeight)}`} />
          <DebugDatum label="Surface" value={`${formatDebugValue(layout.surfaceWidth)} x ${formatDebugValue(layout.surfaceHeight)}`} />
          <DebugDatum label="Scroll" value={`${formatDebugValue(layout.scrollWidth)} x ${formatDebugValue(layout.scrollHeight)}`} />
          <DebugDatum label="Difficulty" value={game.difficulty} />
          <DebugDatum label="Seed" value={game.seed} />
          <DebugDatum label="Stock" value={`${formatDebugValue(game.stockDeals)} deals`} />
          <DebugDatum label="Completed" value={`${formatDebugValue(game.completedSequences)}/8`} />
          <DebugDatum label="Columns" value={formatDebugValue(game.tableauHeights)} />
        </dl>

        <details className="dev-diagnostics__details">
          <summary>Recent Dev Logs ({report.logs.length})</summary>
          <ol className="dev-log-list">
            {report.logs.slice(-12).map((entry) => (
              <li key={entry.id}>
                <code>{entry.at}</code>
                <strong>{entry.event}</strong>
                {entry.details ? <span>{formatDebugValue(entry.details)}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      </section>

      <div className="modal-actions">
        <button type="button" onClick={() => onLoadGame(selectedScenario.createGame(), selectedScenario.label)}>
          Load State
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

function DebugDatum({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatDebugValue(value)}</dd>
    </div>
  );
}

function createDebugReport(getDiagnostics: () => DevDiagnosticsSnapshot): DebugReport {
  return {
    capturedAt: new Date().toISOString(),
    diagnostics: getDiagnostics(),
    logs: getDevLogEntries()
  };
}

function formatDebugValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value === null || value === undefined || value === "") {
    return "n/a";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatPixels(value: unknown): string {
  if (typeof value !== "number") {
    return formatDebugValue(value);
  }

  return `${value}px`;
}

function createHiddenKingToTwoGame(): GameState {
  const card = createCardFactory("hidden-king-to-two");

  return createDevGame("hidden-king-to-two", "one-suit", [
    [
      ...hiddenCards(card, [3, 6, 9, 1], "spades"),
      ...KING_TO_TWO.map((rank) => card(rank, "spades"))
    ],
    [card(1, "spades")],
    [card(13, "spades"), card(12, "spades")],
    [card(11, "spades"), card(10, "spades"), card(9, "spades")],
    [card(8, "spades")],
    [card(7, "spades"), card(6, "spades")],
    [card(5, "spades")],
    [card(4, "spades"), card(3, "spades")],
    [card(2, "spades")],
    [card(1, "spades")]
  ]);
}

function createDeepCompressionGame(): GameState {
  const card = createCardFactory("deep-compression");
  const tallColumn = [
    ...hiddenCards(card, [4, 7, 10, 13, 2, 5], "spades"),
    ...Array.from({ length: 20 }, (_, index) =>
      card(RANKS_HIGH_TO_LOW[index % RANKS_HIGH_TO_LOW.length], SUIT_CYCLE[index % 2])
    )
  ];

  return createDevGame("deep-compression", "two-suit", [
    tallColumn,
    createStack(card, 8, 0, 2, ["spades", "hearts"]),
    createStack(card, 4, 4, 1, ["hearts"]),
    [card(13, "spades")],
    [card(12, "hearts"), card(11, "hearts"), card(10, "hearts")],
    createStack(card, 7, 2, 3, ["spades"]),
    [card(9, "hearts")],
    createStack(card, 5, 6, 1, ["spades", "hearts"]),
    [card(8, "spades"), card(7, "spades")],
    [card(6, "hearts")]
  ]);
}

function createFullWidthStaggerGame(): GameState {
  const card = createCardFactory("full-width-stagger");
  const columns = Array.from({ length: 10 }, (_, columnIndex) =>
    createStack(card, 4 + columnIndex, columnIndex, Math.min(4, Math.floor(columnIndex / 2) + 1), SUIT_CYCLE)
  );

  return createDevGame("full-width-stagger", "four-suit", columns, {
    stock: createStock(card, 2, SUIT_CYCLE)
  });
}

function createResourceRailGame(): GameState {
  const card = createCardFactory("resource-rail");
  const columns = Array.from({ length: 10 }, (_, columnIndex) =>
    createStack(card, columnIndex % 2 === 0 ? 9 : 6, columnIndex * 2, columnIndex % 3, SUIT_CYCLE)
  );

  return createDevGame("resource-rail", "four-suit", columns, {
    stock: createStock(card, 5, SUIT_CYCLE),
    completed: completedSequences(["spades", "hearts", "diamonds", "clubs"])
  });
}

function createDevGame(
  id: DevScenarioId,
  difficulty: Difficulty,
  tableau: Card[][],
  overrides: Partial<Pick<GameState, "stock" | "completed">> = {}
): GameState {
  const now = new Date().toISOString();

  return {
    stateVersion: STATE_VERSION,
    difficulty,
    seed: `dev:${id}`,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    tableau: Array.from({ length: 10 }, (_, index) => tableau[index] ?? []),
    stock: overrides.stock ?? [],
    completed: overrides.completed ?? [],
    score: 500,
    moves: 0,
    status: "playing",
    undoStack: [],
    redoStack: []
  };
}

function createCardFactory(prefix: string) {
  let nextCardId = 0;

  return function card(rank: Rank, suit: Suit, faceUp = true): Card {
    nextCardId += 1;

    return {
      id: `dev-${prefix}-${nextCardId}`,
      rank,
      suit,
      faceUp
    };
  };
}

function hiddenCards(
  card: ReturnType<typeof createCardFactory>,
  ranks: Rank[],
  suit: Suit
): Card[] {
  return ranks.map((rank) => card(rank, suit, false));
}

function createStack(
  card: ReturnType<typeof createCardFactory>,
  height: number,
  rankOffset: number,
  hiddenCount: number,
  suits: Suit[]
): Card[] {
  return Array.from({ length: height }, (_, index) =>
    card(
      RANKS_HIGH_TO_LOW[(rankOffset + index) % RANKS_HIGH_TO_LOW.length],
      suits[(rankOffset + index) % suits.length],
      index >= hiddenCount
    )
  );
}

function createStock(
  card: ReturnType<typeof createCardFactory>,
  dealCount: number,
  suits: Suit[]
): Card[][] {
  return Array.from({ length: dealCount }, (_, dealIndex) =>
    Array.from({ length: 10 }, (_, cardIndex) =>
      card(
        RANKS_HIGH_TO_LOW[(dealIndex * 10 + cardIndex) % RANKS_HIGH_TO_LOW.length],
        suits[(dealIndex + cardIndex) % suits.length],
        false
      )
    )
  );
}

function completedSequences(suits: Suit[]): CompletedSequence[] {
  return suits.map((suit, index) => ({
    id: `dev-completed-${suit}`,
    suit,
    removedAtMove: index + 1
  }));
}
