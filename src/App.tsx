import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { CheckCircle2, ShieldAlert, Trophy } from "lucide-react";
import {
  canDealStock,
  canMoveRun,
  dealStock,
  findHint,
  moveCards,
  newGame,
  rankLabel,
  redo,
  restartGame,
  suitSymbol,
  undo
} from "./game/engine";
import { DIFFICULTIES, type Card, type CardMove, type Difficulty, type GameState } from "./game/types";
import { CardView } from "./components/CardView";
import { Modal } from "./components/Modal";
import { Toolbar } from "./components/Toolbar";
import {
  checkForUpdates,
  installAvailableUpdate,
  installUpdate,
  loadAppState,
  loadStats,
  recordCompletedGame,
  resetLocalData,
  saveActiveGame,
  saveSettings
} from "./persistence/client";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  GAME_SCALE,
  type CardBack,
  type Settings,
  type StatsPayload,
  type StatsRollup,
  type UpdateInfo
} from "./persistence/types";
import "./styles/app.css";

const DRAG_THRESHOLD_PX = 6;
const BASE_CARD_MAX_WIDTH = 92;
const DEFAULT_VISUAL_SCALE_MULTIPLIER = 1.3;
const DEAL_ANIMATION_DURATION_MS = 620;
const DEAL_ANIMATION_STAGGER_MS = 26;
const TABLEAU_COLUMN_COUNT = 10;
const TABLEAU_COLUMN_INLINE_PADDING = 10;
const TABLEAU_COLUMN_BLOCK_PADDING = 10;
const CARD_HEIGHT_RATIO = 1.38;
const CARD_STACK_VISIBLE_RATIO = 0.32;
const TOP_ROW_HEIGHT_RATIO = 0.83;

type ModalName = "settings" | "stats" | "about" | "reset" | null;

interface DragPreviewState {
  move: Omit<CardMove, "toColumn">;
  pointerId: number | null;
  originX: number;
  originY: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  hasMoved: boolean;
  overColumn: number | null;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [game, setGame] = useState<GameState>(() => newGame(DEFAULT_SETTINGS.difficulty, "loading"));
  const [stats, setStats] = useState<StatsPayload>(DEFAULT_STATS);
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedMove, setSelectedMove] = useState<Omit<CardMove, "toColumn"> | null>(null);
  const [hintMove, setHintMove] = useState<CardMove | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [dealAnimationOrders, setDealAnimationOrders] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("Ready.");
  const [appVersion, setAppVersion] = useState("0.1.2");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const gameRef = useRef(game);
  const dragPreviewRef = useRef<DragPreviewState | null>(null);
  const lastPointerDownAtRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const dealAnimationTimerRef = useRef<number | null>(null);
  const playSurfaceRef = useRef<HTMLElement | null>(null);
  const recordedCompletionKeys = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    loadAppState()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setSettings(payload.settings);
        setStats(payload.stats);
        setAppVersion(payload.appVersion);
        const loadedGame = payload.activeGame ?? newGame(payload.settings.difficulty);
        setGameAndRef(loadedGame);
        setMessage(payload.recoveryMessage ?? (payload.activeGame ? "Saved game resumed." : "New game ready."));
      })
      .catch((error: unknown) => {
        const fallback = newGame(DEFAULT_SETTINGS.difficulty);
        setGameAndRef(fallback);
        setMessage(error instanceof Error ? error.message : "Unable to load saved data.");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const effectiveTheme = settings.theme === "system" ? (media?.matches ? "dark" : "light") : settings.theme;
      root.dataset.theme = effectiveTheme;
      root.dataset.motion = settings.reducedMotion ? "reduced" : "full";
      applyGameScale(root, settings);
    };

    applyTheme();
    media?.addEventListener("change", applyTheme);

    return () => {
      media?.removeEventListener("change", applyTheme);
    };
  }, [settings]);

  useEffect(() => {
    const surface = playSurfaceRef.current;

    if (!surface) {
      return;
    }

    const updateFit = () => applyAutoFitScale(surface, settings, gameRef.current);
    updateFit();

    const ResizeObserverCtor = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

    if (!ResizeObserverCtor) {
      window.addEventListener("resize", updateFit);
      return () => window.removeEventListener("resize", updateFit);
    }

    const observer = new ResizeObserverCtor(updateFit);
    observer.observe(surface);
    window.addEventListener("resize", updateFit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateFit);
    };
  }, [game.tableau, settings]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    let cancelled = false;

    installAvailableUpdate().catch((error: unknown) => {
      if (!cancelled) {
        console.warn("Silent update failed.", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isLoaded]);

  useEffect(() => {
    let lastTick = Date.now();

    const tick = () => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      if (document.hidden || gameRef.current.status !== "playing") {
        return;
      }

      setGame((current) => {
        if (current.status !== "playing") {
          return current;
        }

        const next = {
          ...current,
          elapsedMs: current.elapsedMs + delta
        };
        gameRef.current = next;
        return next;
      });
    };

    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const saveCurrentGame = () => {
      void saveActiveGame(gameRef.current);
    };

    window.addEventListener("beforeunload", saveCurrentGame);
    return () => window.removeEventListener("beforeunload", saveCurrentGame);
  }, []);

  useEffect(() => {
    return () => clearDealAnimation(false);
  }, []);

  useEffect(() => {
    const updateDrag = (clientX: number, clientY: number, pointerId: number | null, event: Event) => {
      const currentDrag = dragPreviewRef.current;

      if (!currentDrag || currentDrag.pointerId !== pointerId) {
        return;
      }

      const deltaX = clientX - currentDrag.originX;
      const deltaY = clientY - currentDrag.originY;
      const hasMoved =
        currentDrag.hasMoved || Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX;
      const nextDrag = {
        ...currentDrag,
        x: clientX,
        y: clientY,
        hasMoved,
        overColumn: hasMoved ? getColumnIndexAtPoint(clientX, clientY) : null
      };

      if (hasMoved && !currentDrag.hasMoved) {
        setSelectedMove(currentDrag.move);
        setHintMove(null);
      }

      dragPreviewRef.current = nextDrag;
      setDragPreview(nextDrag);

      if (hasMoved) {
        event.preventDefault();
      }
    };

    const finishDrag = (clientX: number, clientY: number, pointerId: number | null) => {
      const currentDrag = dragPreviewRef.current;

      if (!currentDrag || currentDrag.pointerId !== pointerId) {
        return;
      }

      dragPreviewRef.current = null;
      setDragPreview(null);

      if (!currentDrag.hasMoved) {
        return;
      }

      suppressNextClickRef.current = true;

      const dropColumn = getColumnIndexAtPoint(clientX, clientY) ?? currentDrag.overColumn;

      if (dropColumn === null) {
        setSelectedMove(null);
        setMessage("Drop onto a tableau column.");
        return;
      }

      handleMove({
        ...currentDrag.move,
        toColumn: dropColumn
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateDrag(event.clientX, event.clientY, event.pointerId ?? null, event);
    };

    const finishPointerDrag = (event: PointerEvent) => {
      finishDrag(event.clientX, event.clientY, event.pointerId ?? null);
    };

    const handleMouseMove = (event: MouseEvent) => {
      updateDrag(event.clientX, event.clientY, null, event);
    };

    const finishMouseDrag = (event: MouseEvent) => {
      finishDrag(event.clientX, event.clientY, null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finishPointerDrag);
    window.addEventListener("pointercancel", finishPointerDrag);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishMouseDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointerDrag);
      window.removeEventListener("pointercancel", finishPointerDrag);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishMouseDrag);
    };
  }, []);

  const stockDealsRemaining = game.stock.length;
  const allStats = useMemo(() => getRollup(stats, "all"), [stats]);

  function setGameAndRef(next: GameState): void {
    gameRef.current = next;
    setGame(next);
  }

  function persistGame(next: GameState, previous = gameRef.current): void {
    clearDealAnimation();
    setGameAndRef(next);
    setSelectedMove(null);
    setHintMove(null);
    void saveActiveGame(next);

    if (previous.status !== "won" && next.status === "won") {
      void recordOutcome(next, "won");
      setMessage("Game won.");
    }
  }

  async function recordOutcome(state: GameState, outcome: "won" | "abandoned"): Promise<void> {
    const key = `${outcome}:${state.seed}:${state.moves}:${state.score}`;

    if (recordedCompletionKeys.current.has(key)) {
      return;
    }

    recordedCompletionKeys.current.add(key);
    const nextStats = await recordCompletedGame({
      difficulty: state.difficulty,
      seed: state.seed,
      outcome,
      score: state.score,
      moves: state.moves,
      elapsedMs: state.elapsedMs,
      startedAt: state.startedAt,
      completedAt: new Date().toISOString()
    });
    setStats(nextStats);
  }

  async function recordAbandonIfNeeded(): Promise<void> {
    const current = gameRef.current;

    if (current.status === "playing" && current.moves > 0) {
      await recordOutcome(current, "abandoned");
    }
  }

  async function updateSettings(next: Settings): Promise<void> {
    setSettings(next);
    await saveSettings(next);
  }

  async function handleDifficultyChange(difficulty: Difficulty): Promise<void> {
    await updateSettings({ ...settings, difficulty });
    setMessage(`${DIFFICULTIES[difficulty].label} selected.`);
  }

  async function handleNewGame(): Promise<void> {
    await recordAbandonIfNeeded();
    const next = newGame(settings.difficulty);
    persistGame(next);
    scheduleDealAnimation(getInitialDealAnimationOrders(next.tableau));
    setMessage(`${DIFFICULTIES[next.difficulty].label} game started.`);
  }

  async function handleRestart(): Promise<void> {
    await recordAbandonIfNeeded();
    const next = restartGame(gameRef.current);
    persistGame(next);
    scheduleDealAnimation(getInitialDealAnimationOrders(next.tableau));
    setMessage("Game restarted.");
  }

  function handleUndo(): void {
    const next = undo(gameRef.current);
    persistGame(next);
    setMessage(next === gameRef.current ? "Nothing to undo." : "Move undone.");
  }

  function handleRedo(): void {
    const next = redo(gameRef.current);
    persistGame(next);
    setMessage(next === gameRef.current ? "Nothing to redo." : "Move redone.");
  }

  function handleHint(): void {
    const hint = findHint(gameRef.current);
    setMessage(hint.message);
    setHintMove(hint.type === "move" ? hint.move : null);
  }

  function handleDeal(): void {
    const outcome = dealStock(gameRef.current);

    if (!outcome.ok) {
      setMessage(outcome.reason);
      return;
    }

    persistGame(outcome.state);
    scheduleDealAnimation(getStockDealAnimationOrders(outcome.state.tableau));
    setMessage(outcome.completedSequences > 0 ? "Sequence cleared." : "Stock dealt.");
  }

  function handleMove(move: CardMove): void {
    applyOutcome(moveCards(gameRef.current, move), "Move completed.");
  }

  function applyOutcome(outcome: ReturnType<typeof moveCards>, successMessage: string): void {
    if (!outcome.ok) {
      setMessage(outcome.reason);
      return;
    }

    persistGame(outcome.state);
    setMessage(outcome.completedSequences > 0 ? "Sequence cleared." : successMessage);
  }

  function consumeSuppressedClick(): boolean {
    if (!suppressNextClickRef.current) {
      return false;
    }

    suppressNextClickRef.current = false;
    return true;
  }

  function handleCardClick(columnIndex: number, cardIndex: number, event: ReactMouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();

    if (consumeSuppressedClick()) {
      return;
    }

    const current = gameRef.current;
    const column = current.tableau[columnIndex];

    if (selectedMove) {
      if (selectedMove.fromColumn === columnIndex && selectedMove.startIndex === cardIndex) {
        setSelectedMove(null);
        return;
      }

      const outcome = moveCards(current, {
        ...selectedMove,
        toColumn: columnIndex
      });

      if (outcome.ok) {
        persistGame(outcome.state);
        setMessage(outcome.completedSequences > 0 ? "Sequence cleared." : "Move completed.");
        return;
      }
    }

    if (canMoveRun(column, cardIndex)) {
      setSelectedMove({ fromColumn: columnIndex, startIndex: cardIndex });
      setHintMove(null);
      setMessage("Run selected.");
      return;
    }

    setMessage("That card cannot move as a run.");
  }

  function handleColumnClick(columnIndex: number): void {
    if (consumeSuppressedClick()) {
      return;
    }

    if (!selectedMove) {
      return;
    }

    handleMove({ ...selectedMove, toColumn: columnIndex });
  }

  function handleMouseDown(
    columnIndex: number,
    cardIndex: number,
    event: ReactMouseEvent<HTMLButtonElement>
  ): void {
    if (event.button > 0 || Date.now() - lastPointerDownAtRef.current < 80) {
      return;
    }

    startCardDrag(columnIndex, cardIndex, event.clientX, event.clientY, null, event.currentTarget);
  }

  function handlePointerDown(
    columnIndex: number,
    cardIndex: number,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void {
    if (event.button > 0) {
      return;
    }

    lastPointerDownAtRef.current = Date.now();
    startCardDrag(columnIndex, cardIndex, event.clientX, event.clientY, event.pointerId ?? null, event.currentTarget);
  }

  function startCardDrag(
    columnIndex: number,
    cardIndex: number,
    clientX: number,
    clientY: number,
    pointerId: number | null,
    target: HTMLElement
  ): void {
    const column = gameRef.current.tableau[columnIndex];

    if (!canMoveRun(column, cardIndex)) {
      return;
    }

    const move = { fromColumn: columnIndex, startIndex: cardIndex };
    const rect = target.getBoundingClientRect();
    const dragState = {
      move,
      pointerId,
      originX: clientX,
      originY: clientY,
      x: clientX,
      y: clientY,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      hasMoved: false,
      overColumn: null
    };

    dragPreviewRef.current = dragState;
    setDragPreview(dragState);
  }

  function clearDealAnimation(resetState = true): void {
    if (dealAnimationTimerRef.current !== null) {
      window.clearTimeout(dealAnimationTimerRef.current);
      dealAnimationTimerRef.current = null;
    }

    if (resetState) {
      setDealAnimationOrders({});
    }
  }

  function scheduleDealAnimation(orders: Record<string, number>): void {
    clearDealAnimation();

    const orderValues = Object.values(orders);

    if (orderValues.length === 0) {
      return;
    }

    setDealAnimationOrders(orders);
    dealAnimationTimerRef.current = window.setTimeout(
      () => clearDealAnimation(),
      DEAL_ANIMATION_DURATION_MS + Math.max(...orderValues) * DEAL_ANIMATION_STAGGER_MS + 120
    );
  }

  async function handleResetConfirmed(): Promise<void> {
    await resetLocalData();
    const nextSettings = DEFAULT_SETTINGS;
    const nextGame = newGame(DEFAULT_SETTINGS.difficulty);
    setSettings(nextSettings);
    setStats(DEFAULT_STATS);
    setGameAndRef(nextGame);
    setModal(null);
    setSelectedMove(null);
    setHintMove(null);
    setMessage("Local data reset.");
  }

  async function handleCheckUpdates(): Promise<void> {
    try {
      const update = await checkForUpdates();
      setUpdateInfo(update);
      setMessage(update ? `Update ${update.version} is available.` : "No update available.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update check failed.");
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    try {
      await installUpdate();
      setMessage("Update installed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update installation failed.");
    }
  }

  return (
    <main className="app-shell">
      <Toolbar
        game={game}
        selectedDifficulty={settings.difficulty}
        canInstallUpdate={Boolean(updateInfo)}
        onDifficultyChange={(difficulty) => {
          void handleDifficultyChange(difficulty);
        }}
        onNewGame={() => {
          void handleNewGame();
        }}
        onRestart={() => {
          void handleRestart();
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onHint={handleHint}
        onDeal={handleDeal}
        onSettings={() => setModal("settings")}
        onStats={() => {
          void loadStats().then(setStats);
          setModal("stats");
        }}
        onAbout={() => setModal("about")}
        onInstallUpdate={() => {
          void handleInstallUpdate();
        }}
      />

      <section className="score-strip" aria-label="Game status">
        <Metric label="Score" value={String(game.score)} />
        <Metric label="Moves" value={String(game.moves)} />
        <Metric label="Time" value={formatDuration(game.elapsedMs)} />
        <Metric label="Stock" value={`${stockDealsRemaining} deals`} />
        <Metric label="Complete" value={`${game.completed.length}/8`} />
      </section>

      <section ref={playSurfaceRef} className="play-surface" aria-busy={!isLoaded}>
        <div className="foundation-zone" aria-label="Completed sequences">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={index < game.completed.length ? "foundation is-filled" : "foundation"}>
              {index < game.completed.length ? <Trophy size={24} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>

        <div className="stock-zone">
          <button
            type="button"
            className="stock"
            disabled={!canDealStock(game)}
            onClick={handleDeal}
            aria-label="Deal stock"
            title="Deal stock"
          >
            <span className={`stock__deck stock__deck--${settings.cardBack}`} />
            <span>{stockDealsRemaining}</span>
          </button>
        </div>

        <div className="tableau" aria-label="Tableau">
          {game.tableau.map((column, columnIndex) => {
            const isHintDestination = hintMove?.toColumn === columnIndex;

            return (
              <div
                key={columnIndex}
                data-column-index={columnIndex}
                className={[
                  "tableau-column",
                  isHintDestination ? "is-hint-destination" : "",
                  dragPreview?.hasMoved && dragPreview.overColumn === columnIndex ? "is-drop-target" : ""
                ].join(" ")}
                onClick={() => handleColumnClick(columnIndex)}
              >
                <div className="tableau-column__cards">
                  {column.map((card, cardIndex) => {
                    const isSelected =
                      selectedMove?.fromColumn === columnIndex && selectedMove.startIndex === cardIndex;
                    const isHinted = hintMove?.fromColumn === columnIndex && hintMove.startIndex === cardIndex;
                    const isMovable = canMoveRun(column, cardIndex);
                    const isDraggingSource =
                      Boolean(dragPreview?.hasMoved) &&
                      dragPreview?.move.fromColumn === columnIndex &&
                      cardIndex >= dragPreview.move.startIndex;
                    const dealOrder = dealAnimationOrders[card.id];
                    const dealAnimationStyle =
                      dealOrder === undefined
                        ? undefined
                        : ({
                            "--deal-delay": `${dealOrder * DEAL_ANIMATION_STAGGER_MS}ms`,
                            "--deal-from-x": `${-42 - columnIndex * 74}px`,
                            "--deal-from-y": `${-110 - Math.min(dealOrder, 8) * 4}px`
                          } as CSSProperties);

                    return (
                      <div
                        key={card.id}
                        className={["tableau-card", dealOrder === undefined ? "" : "is-dealt-card"].join(" ")}
                        data-deal-animation-order={dealOrder}
                        style={dealAnimationStyle}
                      >
                        <CardView
                          card={card}
                          cardBack={settings.cardBack}
                          isSelected={isSelected}
                          isHinted={isHinted}
                          isDraggingSource={isDraggingSource}
                          isMovable={isMovable}
                          onClick={(event) => handleCardClick(columnIndex, cardIndex, event)}
                          onMouseDown={(event) => handleMouseDown(columnIndex, cardIndex, event)}
                          onPointerDown={(event) => handlePointerDown(columnIndex, cardIndex, event)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {dragPreview?.hasMoved ? (
          <DragPreview
            cards={game.tableau[dragPreview.move.fromColumn].slice(dragPreview.move.startIndex)}
            cardBack={settings.cardBack}
            x={dragPreview.x - dragPreview.offsetX}
            y={dragPreview.y - dragPreview.offsetY}
          />
        ) : null}

        {game.status === "won" ? (
          <div className="win-banner" role="status">
            <CheckCircle2 size={26} aria-hidden="true" />
            <span>Game won</span>
          </div>
        ) : null}
      </section>

      <footer className="status-line" role="status">
        <span>{message}</span>
      </footer>

      {modal === "settings" ? (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label>
              <span>Theme</span>
              <select
                value={settings.theme}
                onChange={(event) => {
                  void updateSettings({ ...settings, theme: event.target.value as Settings["theme"] });
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label>
              <span>Card back</span>
              <select
                value={settings.cardBack}
                onChange={(event) => {
                  void updateSettings({ ...settings, cardBack: event.target.value as CardBack });
                }}
              >
                <option value="spruce">Spruce</option>
                <option value="midnight">Midnight</option>
                <option value="ember">Ember</option>
              </select>
            </label>

            <label className="scale-control">
              <span>Game scale</span>
              <div className="range-row">
                <input
                  type="range"
                  min={GAME_SCALE.min}
                  max={GAME_SCALE.max}
                  step={GAME_SCALE.step}
                  value={settings.gameScale}
                  aria-label="Game scale"
                  onChange={(event) => {
                    void updateSettings({ ...settings, gameScale: Number(event.target.value) });
                  }}
                />
                <output>{settings.gameScale}%</output>
              </div>
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.gameScaleMode === "auto"}
                onChange={(event) => {
                  void updateSettings({
                    ...settings,
                    gameScaleMode: event.target.checked ? "auto" : "manual"
                  });
                }}
              />
              <span>Auto fit to window</span>
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(event) => {
                  void updateSettings({ ...settings, reducedMotion: event.target.checked });
                }}
              />
              <span>Reduced motion</span>
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={() => void handleCheckUpdates()}>
              Check for Updates
            </button>
            {updateInfo ? (
              <button type="button" onClick={() => void handleInstallUpdate()}>
                Install {updateInfo.version}
              </button>
            ) : null}
            <button type="button" className="danger-button" onClick={() => setModal("reset")}>
              Reset Local Data
            </button>
          </div>
        </Modal>
      ) : null}

      {modal === "stats" ? (
        <Modal title="Stats" onClose={() => setModal(null)}>
          <StatsView stats={stats} allStats={allStats} />
        </Modal>
      ) : null}

      {modal === "about" ? (
        <Modal title="About" onClose={() => setModal(null)}>
          <div className="about-panel">
            <p>
              Spider {appVersion} is an independent Spider Solitaire app for desktop with local-only saves,
              settings, and stats.
            </p>
          </div>
        </Modal>
      ) : null}

      {modal === "reset" ? (
        <Modal title="Reset Local Data" onClose={() => setModal(null)}>
          <div className="reset-panel">
            <ShieldAlert size={30} aria-hidden="true" />
            <p>This clears saved game, settings, and local stats on this device.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setModal("settings")}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={() => void handleResetConfirmed()}>
                Reset
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

function applyGameScale(root: HTMLElement, settings: Settings): void {
  const scale = (settings.gameScale / 100) * DEFAULT_VISUAL_SCALE_MULTIPLIER;

  root.dataset.gameScale = String(settings.gameScale);
  root.dataset.gameScaleMode = settings.gameScaleMode;
  root.style.setProperty("--card-preferred-width", `${BASE_CARD_MAX_WIDTH * scale}px`);
  root.style.setProperty("--card-max-width", `${BASE_CARD_MAX_WIDTH * scale}px`);
}

function applyAutoFitScale(surface: HTMLElement, settings: Settings, game: GameState): void {
  const root = document.documentElement;

  if (settings.gameScaleMode !== "auto") {
    root.style.removeProperty("--card-fit-width");
    return;
  }

  const surfaceWidth = surface.clientWidth;
  const surfaceHeight = surface.clientHeight;

  if (surfaceWidth <= 0 || surfaceHeight <= 0) {
    return;
  }

  const surfaceStyle = getComputedStyle(surface);
  const inlinePadding = parsePixels(surfaceStyle.paddingLeft) + parsePixels(surfaceStyle.paddingRight);
  const blockPadding = parsePixels(surfaceStyle.paddingTop) + parsePixels(surfaceStyle.paddingBottom);
  const rowGap = parsePixels(surfaceStyle.rowGap || surfaceStyle.gap);
  const columnGap = readRootPixels("--tableau-gap");
  const availableWidth = surfaceWidth - inlinePadding;
  const availableHeight = surfaceHeight - blockPadding - rowGap;
  const horizontalFit =
    (availableWidth -
      columnGap * (TABLEAU_COLUMN_COUNT - 1) -
      TABLEAU_COLUMN_INLINE_PADDING * TABLEAU_COLUMN_COUNT) /
    TABLEAU_COLUMN_COUNT;
  const tallestColumn = Math.max(1, ...game.tableau.map((column) => column.length));
  const stackHeightRatio = CARD_HEIGHT_RATIO * (1 + (tallestColumn - 1) * CARD_STACK_VISIBLE_RATIO);
  const verticalFit =
    (availableHeight - TABLEAU_COLUMN_BLOCK_PADDING) / (TOP_ROW_HEIGHT_RATIO + stackHeightRatio);
  const fitWidth = Math.floor(Math.max(1, Math.min(horizontalFit, verticalFit)));

  root.style.setProperty("--card-fit-width", `${fitWidth}px`);
}

function readRootPixels(property: string): number {
  return parsePixels(getComputedStyle(document.documentElement).getPropertyValue(property));
}

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStockDealAnimationOrders(tableau: Card[][]): Record<string, number> {
  return Object.fromEntries(
    tableau.flatMap((column, columnIndex) => {
      const card = column.at(-1);
      return card ? [[card.id, columnIndex]] : [];
    })
  );
}

function getInitialDealAnimationOrders(tableau: Card[][]): Record<string, number> {
  const orders: Record<string, number> = {};
  const maxColumnHeight = Math.max(...tableau.map((column) => column.length));
  let order = 0;

  for (let rowIndex = 0; rowIndex < maxColumnHeight; rowIndex += 1) {
    for (const column of tableau) {
      const card = column[rowIndex];

      if (!card) {
        continue;
      }

      orders[card.id] = order;
      order += 1;
    }
  }

  return orders;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatsView({ stats, allStats }: { stats: StatsPayload; allStats: StatsRollup }) {
  const difficultyRollups = stats.rollups.filter((rollup) => rollup.scope === "difficulty");

  return (
    <div className="stats-grid">
      <Metric label="Games" value={String(allStats.gamesPlayed)} />
      <Metric label="Wins" value={String(allStats.gamesWon)} />
      <Metric label="Abandoned" value={String(allStats.gamesAbandoned)} />
      <Metric label="Best Score" value={allStats.bestScore === null ? "—" : String(allStats.bestScore)} />
      <Metric label="Best Time" value={allStats.bestTimeMs === null ? "—" : formatDuration(allStats.bestTimeMs)} />
      <Metric label="Total Time" value={formatDuration(allStats.totalElapsedMs)} />

      {difficultyRollups.length > 0 ? (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Difficulty</th>
              <th>Played</th>
              <th>Won</th>
              <th>Best</th>
            </tr>
          </thead>
          <tbody>
            {difficultyRollups.map((rollup) => (
              <tr key={rollup.difficulty}>
                <td>{rollup.difficulty === "all" ? "All" : DIFFICULTIES[rollup.difficulty].label}</td>
                <td>{rollup.gamesPlayed}</td>
                <td>{rollup.gamesWon}</td>
                <td>{rollup.bestScore ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function DragPreview({ cards, cardBack, x, y }: { cards: Card[]; cardBack: CardBack; x: number; y: number }) {
  return (
    <div
      className="drag-preview"
      data-testid="drag-preview"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`
      }}
      aria-hidden="true"
    >
      {cards.map((card) => {
        const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";

        return (
          <div
            key={card.id}
            className={[
              "drag-preview__card",
              "card",
              card.faceUp ? "card--face-up" : "card--face-down",
              `card--${color}`,
              `card--back-${cardBack}`
            ].join(" ")}
          >
            {card.faceUp ? (
              <>
                <span className="card__corner">
                  <span>{rankLabel(card.rank)}</span>
                  <span>{suitSymbol(card.suit)}</span>
                </span>
                <span className="card__suit">{suitSymbol(card.suit)}</span>
                <span className="card__corner card__corner--bottom">
                  <span>{rankLabel(card.rank)}</span>
                  <span>{suitSymbol(card.suit)}</span>
                </span>
              </>
            ) : (
              <span className="card__back-mark" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function getColumnIndexAtPoint(x: number, y: number): number | null {
  const element = document.elementFromPoint?.(x, y);
  const column = element?.closest<HTMLElement>("[data-column-index]");
  const rawIndex = column?.dataset.columnIndex;

  if (rawIndex === undefined) {
    return null;
  }

  const index = Number.parseInt(rawIndex, 10);
  return Number.isInteger(index) ? index : null;
}

function getRollup(stats: StatsPayload, difficulty: Difficulty | "all"): StatsRollup {
  return (
    stats.rollups.find((rollup) => rollup.difficulty === difficulty) ?? {
      ...DEFAULT_STATS.rollups[0],
      difficulty
    }
  );
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
