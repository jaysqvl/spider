import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BarChart3,
  CheckCircle2,
  Download,
  Info,
  Lightbulb,
  Menu,
  Play,
  Redo2,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldAlert,
  Undo2
} from "lucide-react";
import {
  canDealStock,
  canMoveRun,
  dealStock,
  findAutoMove,
  findHint,
  findRunBlocker,
  moveCards,
  newGame,
  redo,
  restartGame,
  undo
} from "./game/engine";
import { DIFFICULTIES, SUITS, type Card, type CardMove, type Difficulty, type GameState, type Suit } from "./game/types";
import { CardFace, CardView, SuitMark } from "./components/CardView";
import { IconButton } from "./components/IconButton";
import { Modal } from "./components/Modal";
import { DevToolsHost, recordDevLog, type DevDiagnosticsSnapshot } from "#dev-tools";
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
  type CardFaceTheme,
  type Settings,
  type StatsPayload,
  type StatsRollup,
  type UpdateInfo
} from "./persistence/types";
import packageJson from "../package.json";
import "./styles/app.css";

const DRAG_THRESHOLD_PX = 6;
const BASE_CARD_MAX_WIDTH = 92;
const DEFAULT_VISUAL_SCALE_MULTIPLIER = 1.3;
const DEAL_ANIMATION_DURATION_MS = 620;
const DEAL_ANIMATION_STAGGER_MS = 38;
const TABLEAU_COLUMN_COUNT = 10;
const CARD_HEIGHT_RATIO = 1.38;
const CARD_STACK_VISIBLE_RATIO = 0.28;
const MIN_CARD_STACK_REVEAL_PX = 10;
const AUTO_FIT_REFERENCE_COLUMN_HEIGHT = 16;
const FACE_DOWN_REVEAL_RATIO = 0.1;
const FACE_UP_REVEAL_RATIO = 0.28;
const FACE_UP_REVEAL_MIN_RATIO = 0.24;
const FACE_UP_REVEAL_FLOOR_RATIO = 0.19;
const FACE_DOWN_REVEAL_MIN_PX = 7;
const FACE_DOWN_REVEAL_MAX_PX = 24;
const FACE_UP_REVEAL_MIN_PX = 24;
const FACE_UP_REVEAL_MAX_PX = 52;
const FACE_UP_REVEAL_FLOOR_PX = 34;
const FACE_UP_REVEAL_COMPACT_FLOOR_MIN_PX = 20;
const FACE_DOWN_REVEAL_FLOOR_PX = 6;
const COMPACT_STACK_HEIGHT_CAP_CARD_WIDTH_PX = 112;
const COMPACT_STACK_HEIGHT_CAP_RATIO = 0.86;
const TABLEAU_FIT_SAFETY_PX = 2;
const MAX_CARD_WIDTH_TO_TABLEAU_HEIGHT_RATIO = 0.28;
const ULTRAWIDE_HEIGHT_BALANCE_ASPECT_RATIO = 2;
const ULTRAWIDE_REFERENCE_FACE_DOWN_CARDS = 4;
const ULTRAWIDE_REFERENCE_FACE_UP_RUN_CARDS = 12;
const SIDE_RESOURCE_MIN_WIDTH_PX = 148;
const SIDE_RESOURCE_MAX_WIDTH_PX = 190;
const SIDE_RESOURCE_WIDTH_RATIO = 1.35;
const SIDE_RESOURCE_MIN_CARD_RETENTION_RATIO = 0.92;
const SIDE_RESOURCE_ENTER_GAP_PX = 18;
const SIDE_RESOURCE_ENTER_HEIGHT_PX = 740;
const TOAST_VISIBLE_MS = 5200;
const UPDATE_TOAST_ID = "update-status";
const BLOCKED_RUN_FEEDBACK_MS = 1100;
const MOVE_ANIMATION_DURATION_MS = 260;
const MOVE_ANIMATION_EASING = "cubic-bezier(0.2, 0.82, 0.2, 1)";
const MOVE_ANIMATION_THRESHOLD_PX = 1.5;
const MOVE_COVER_DETAIL_SETTLE_MS = 48;

type ModalName = "settings" | "stats" | "about" | "reset" | null;
type ToastTone = "info" | "success" | "error";
export type BoardControlLayout = "bottom" | "side";

interface DevToolsEnv {
  DEV: boolean;
  VITE_SPIDER_DEV_TOOLS?: string;
}

interface ToastMessage {
  id: string;
  title: string;
  body: string;
  tone: ToastTone;
}

interface DealAnimationConfig {
  order: number;
  fromX: number;
  fromY: number;
}

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

export interface AutoFitMetrics {
  cardWidth: number | null;
  stackVisibleRatio: number;
  availableHeight: number | null;
}

const DEFAULT_AUTO_FIT_METRICS: AutoFitMetrics = {
  cardWidth: null,
  stackVisibleRatio: CARD_STACK_VISIBLE_RATIO,
  availableHeight: null
};

interface BlockedRunFeedback {
  fromColumn: number;
  startIndex: number;
  blockerIndex: number;
  endIndex: number;
}

interface MoveAnimationSnapshot {
  cardId: string;
  element: HTMLElement;
  beforeRect: DOMRect;
}

interface CompletedSuitSummary {
  suit: Suit;
  completed: number;
  total: number;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [game, setGame] = useState<GameState>(() => newGame(DEFAULT_SETTINGS.difficulty, "loading"));
  const [stats, setStats] = useState<StatsPayload>(DEFAULT_STATS);
  const [modal, setModal] = useState<ModalName>(null);
  const [selectedMove, setSelectedMove] = useState<Omit<CardMove, "toColumn"> | null>(null);
  const [hintMove, setHintMove] = useState<CardMove | null>(null);
  const [blockedRun, setBlockedRun] = useState<BlockedRunFeedback | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [dealAnimations, setDealAnimations] = useState<Record<string, DealAnimationConfig>>({});
  const [heldCoveredCardIds, setHeldCoveredCardIds] = useState<ReadonlySet<string>>(() => new Set());
  const [message, setMessage] = useState("Ready.");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [appVersion, setAppVersion] = useState(packageJson.version);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [autoFitMetrics, setAutoFitMetrics] = useState<AutoFitMetrics>(DEFAULT_AUTO_FIT_METRICS);
  const [controlLayout, setControlLayout] = useState<BoardControlLayout>("bottom");
  const [isLoaded, setIsLoaded] = useState(false);
  const gameRef = useRef(game);
  const selectedMoveRef = useRef(selectedMove);
  const dragPreviewRef = useRef<DragPreviewState | null>(null);
  const dragPreviewElementRef = useRef<HTMLDivElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const moveAnimationFrameRef = useRef<number | null>(null);
  const lastPointerDownAtRef = useRef(0);
  const suppressNextClickRef = useRef(false);
  const saveGameTimerRef = useRef<number | null>(null);
  const dealAnimationTimerRef = useRef<number | null>(null);
  const dealAnimationFrameRef = useRef<number | null>(null);
  const blockedRunTimerRef = useRef<number | null>(null);
  const coverDetailReleaseTimersRef = useRef(new Map<string, number>());
  const toastTimersRef = useRef(new Map<string, number>());
  const playSurfaceRef = useRef<HTMLElement | null>(null);
  const tableauRef = useRef<HTMLDivElement | null>(null);
  const stockDeckRef = useRef<HTMLSpanElement | null>(null);
  const recordedCompletionKeys = useRef(new Set<string>());
  const settingsRef = useRef(settings);
  const controlLayoutRef = useRef<BoardControlLayout>("bottom");
  const lastDevLayoutSignatureRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    loadAppState()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setSettingsAndRef(payload.settings);
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
    selectedMoveRef.current = selectedMove;
  }, [selectedMove]);

  useLayoutEffect(() => {
    controlLayoutRef.current = controlLayout;
  }, [controlLayout]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const effectiveTheme = settings.theme === "system" ? (media?.matches ? "dark" : "light") : settings.theme;
      const effectiveCardFace =
        settings.cardFace === "system" ? effectiveTheme : settings.cardFace === "dark" ? "dark" : "light";
      root.dataset.theme = effectiveTheme;
      root.dataset.cardFace = effectiveCardFace;
      root.dataset.motion = settings.reducedMotion ? "reduced" : "full";
      applyGameScale(root, settings);
    };

    applyTheme();
    media?.addEventListener("change", applyTheme);

    return () => {
      media?.removeEventListener("change", applyTheme);
    };
  }, [settings]);

  const getDevDiagnostics = useCallback((): DevDiagnosticsSnapshot => {
    const rootStyle = getComputedStyle(document.documentElement);
    const surface = playSurfaceRef.current;
    const tableau = tableauRef.current;
    const resource = surface?.querySelector<HTMLElement>(".board-resource-zone") ?? null;
    const stock = surface?.querySelector<HTMLElement>(".stock-zone") ?? null;
    const leftActions = surface?.querySelector<HTMLElement>(".board-actions--left") ?? null;
    const rightActions = surface?.querySelector<HTMLElement>(".board-actions--right") ?? null;
    const cards = Array.from(surface?.querySelectorAll<HTMLElement>(".tableau-card") ?? []);
    const firstCardRect = cards[0]?.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const surfaceRect = surface?.getBoundingClientRect();
    const tableauRect = tableau?.getBoundingClientRect();

    return {
      app: {
        version: appVersion,
        message,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
        userAgent: window.navigator.userAgent,
        platform: window.navigator.platform,
        language: window.navigator.language
      },
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualViewportWidth: visualViewport?.width ?? null,
        visualViewportHeight: visualViewport?.height ?? null,
        visualViewportScale: visualViewport?.scale ?? null,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        availableScreenWidth: window.screen.availWidth,
        availableScreenHeight: window.screen.availHeight
      },
      layout: {
        controlLayout,
        autoFitCardWidth: autoFitMetrics.cardWidth,
        autoFitAvailableHeight: autoFitMetrics.availableHeight,
        autoFitStackVisibleRatio: autoFitMetrics.stackVisibleRatio,
        cardFitWidth: rootStyle.getPropertyValue("--card-fit-width").trim(),
        cardWidth: rootStyle.getPropertyValue("--card-width").trim(),
        cardHeight: rootStyle.getPropertyValue("--card-height").trim(),
        stackVisibleRatio: rootStyle.getPropertyValue("--card-stack-visible-ratio").trim(),
        gameScale: document.documentElement.dataset.gameScale ?? null,
        gameScaleMode: document.documentElement.dataset.gameScaleMode ?? null,
        surface: getDevRectSnapshot(surface),
        surfaceWidth: surfaceRect ? roundDebugNumber(surfaceRect.width) : null,
        surfaceHeight: surfaceRect ? roundDebugNumber(surfaceRect.height) : null,
        tableau: getDevRectSnapshot(tableau),
        tableauWidth: tableauRect ? roundDebugNumber(tableauRect.width) : null,
        tableauHeight: tableauRect ? roundDebugNumber(tableauRect.height) : null,
        resource: getDevRectSnapshot(resource),
        stock: getDevRectSnapshot(stock),
        leftActions: getDevRectSnapshot(leftActions),
        rightActions: getDevRectSnapshot(rightActions),
        renderedCardWidth: firstCardRect ? roundDebugNumber(firstCardRect.width) : null,
        renderedCardHeight: firstCardRect ? roundDebugNumber(firstCardRect.height) : null,
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        cardCount: cards.length
      },
      game: {
        difficulty: game.difficulty,
        seed: game.seed,
        status: game.status,
        score: game.score,
        moves: game.moves,
        elapsedMs: game.elapsedMs,
        stockDeals: game.stock.length,
        completedSequences: game.completed.length,
        undoDepth: game.undoStack.length,
        redoDepth: game.redoStack.length,
        tableauHeights: game.tableau.map((column) => column.length),
        faceUpCounts: game.tableau.map((column) => column.filter((card) => card.faceUp).length),
        hiddenCounts: game.tableau.map((column) => column.filter((card) => !card.faceUp).length),
        topCards: game.tableau.map((column) => formatDebugCard(column.at(-1) ?? null))
      },
      settings: {
        difficulty: settings.difficulty,
        theme: settings.theme,
        cardFace: settings.cardFace,
        cardBack: settings.cardBack,
        reducedMotion: settings.reducedMotion,
        gameScale: settings.gameScale,
        gameScaleMode: settings.gameScaleMode
      }
    };
  }, [appVersion, autoFitMetrics, controlLayout, game, message, settings]);

  useLayoutEffect(() => {
    const surface = playSurfaceRef.current;

    if (!surface) {
      return;
    }

    let fitFrame: number | null = null;

    const updateFit = () => {
      fitFrame = null;
      const resolvedLayout = resolveAutoFitLayout(surface, settings, controlLayoutRef.current, tableauRef.current);

      if (resolvedLayout) {
        applyResolvedAutoFitMetrics(settings, resolvedLayout.metrics);

        setAutoFitMetrics((current) =>
          areAutoFitMetricsEqual(current, resolvedLayout.metrics) ? current : resolvedLayout.metrics
        );

        const layoutSignature = [
          resolvedLayout.controlLayout,
          resolvedLayout.metrics.cardWidth,
          resolvedLayout.metrics.availableHeight,
          window.innerWidth,
          window.innerHeight,
          getVisibleInlineSize(surface),
          getVisibleBlockSize(surface)
        ].join(":");

        if (layoutSignature !== lastDevLayoutSignatureRef.current) {
          lastDevLayoutSignatureRef.current = layoutSignature;
          recordDevLog("layout.autoFit", {
            controlLayout: resolvedLayout.controlLayout,
            cardWidth: resolvedLayout.metrics.cardWidth,
            availableHeight: resolvedLayout.metrics.availableHeight,
            stackVisibleRatio: resolvedLayout.metrics.stackVisibleRatio,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            surface: `${Math.round(getVisibleInlineSize(surface))}x${Math.round(getVisibleBlockSize(surface))}`
          });
        }

        if (resolvedLayout.controlLayout !== controlLayoutRef.current) {
          setControlLayout(resolvedLayout.controlLayout);
        }
      }
    };
    const scheduleFit = () => {
      if (fitFrame !== null) {
        return;
      }

      fitFrame = window.requestAnimationFrame(updateFit);
    };
    const cancelScheduledFit = () => {
      if (fitFrame === null) {
        return;
      }

      window.cancelAnimationFrame(fitFrame);
      fitFrame = null;
    };

    updateFit();

    const ResizeObserverCtor = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;

    if (!ResizeObserverCtor) {
      window.addEventListener("resize", scheduleFit);
      return () => {
        cancelScheduledFit();
        window.removeEventListener("resize", scheduleFit);
      };
    }

    const observer = new ResizeObserverCtor(scheduleFit);
    observer.observe(surface);
    window.addEventListener("resize", scheduleFit);

    return () => {
      cancelScheduledFit();
      observer.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  }, [settings]);

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
    const saveCurrentGame = () => {
      flushActiveGameSave();
    };

    window.addEventListener("beforeunload", saveCurrentGame);
    return () => window.removeEventListener("beforeunload", saveCurrentGame);
  }, []);

  useEffect(() => {
    return () => {
      clearQueuedActiveGameSave();
      clearDealAnimation(false);
      clearMoveAnimationFrame();
      clearCoveredCardDetailHolds(false);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearBlockedRunFeedback(false);
      clearToastTimers();
    };
  }, []);

  useEffect(() => {
    const cancelDragFrame = () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
    };

    const queueDragFrame = () => {
      if (dragFrameRef.current !== null) {
        return;
      }

      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const nextDrag = dragPreviewRef.current;

        if (nextDrag?.hasMoved) {
          updateDragPreviewPosition(nextDrag);
        }

        setDragPreview((currentDrag) =>
          shouldRenderDragPreviewUpdate(currentDrag, nextDrag) ? nextDrag : currentDrag
        );
      });
    };

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
      queueDragFrame();

      if (hasMoved) {
        event.preventDefault();
      }
    };

    const finishDrag = (clientX: number, clientY: number, pointerId: number | null) => {
      const currentDrag = dragPreviewRef.current;

      if (!currentDrag || currentDrag.pointerId !== pointerId) {
        return;
      }

      cancelDragFrame();
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
      cancelDragFrame();
    };
  }, []);

  const stockDealsRemaining = game.stock.length;
  const completedSuitSummaries = useMemo(() => getCompletedSuitSummaries(game), [game.completed, game.difficulty]);
  const tableauRenderData = useMemo(
    () =>
      game.tableau.map((column) => ({
        movableRunStarts: getMovableRunStarts(column),
        cardReveals: getColumnCardReveals(column, autoFitMetrics)
      })),
    [game.tableau, autoFitMetrics]
  );
  const allStats = useMemo(() => getRollup(stats, "all"), [stats]);
  const selectedMovingCard =
    selectedMove === null
      ? null
      : game.tableau[selectedMove.fromColumn]?.[selectedMove.startIndex] ?? null;
  const handleElapsedTick = useCallback((elapsedMs: number) => {
    const current = gameRef.current;

    if (current.status !== "playing" || current.elapsedMs === elapsedMs) {
      return;
    }

    gameRef.current = {
      ...current,
      elapsedMs
    };
  }, []);
  const handleCardClickEvent = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const position = readCardEventPosition(event.currentTarget);

    if (position) {
      handleCardClick(position.columnIndex, position.cardIndex, event);
    }
  }, []);
  const handleCardMouseDownEvent = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const position = readCardEventPosition(event.currentTarget);

    if (position) {
      handleMouseDown(position.columnIndex, position.cardIndex, event);
    }
  }, []);
  const handleCardPointerDownEvent = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const position = readCardEventPosition(event.currentTarget);

    if (position) {
      handlePointerDown(position.columnIndex, position.cardIndex, event);
    }
  }, []);

  function setGameAndRef(next: GameState): void {
    gameRef.current = next;
    setGame(next);
  }

  function setSettingsAndRef(next: Settings): void {
    settingsRef.current = next;
    setSettings(next);
  }

  function persistGame(next: GameState, previous = gameRef.current): void {
    clearDealAnimation();
    clearBlockedRunFeedback();
    clearCoveredCardDetailHolds();
    setGameAndRef(next);
    setSelectedMove((current) => (current === null ? current : null));
    setHintMove((current) => (current === null ? current : null));
    queueActiveGameSave();

    if (previous.status !== "won" && next.status === "won") {
      void recordOutcome(next, "won");
      setMessage("Game won.");
    }
  }

  function queueActiveGameSave(): void {
    clearQueuedActiveGameSave();
    saveGameTimerRef.current = window.setTimeout(() => {
      saveGameTimerRef.current = null;
      void saveActiveGame(gameRef.current).catch((error: unknown) => {
        console.warn("Unable to save active game.", error);
      });
    }, 0);
  }

  function flushActiveGameSave(): void {
    clearQueuedActiveGameSave();
    void saveActiveGame(gameRef.current).catch((error: unknown) => {
      console.warn("Unable to save active game.", error);
    });
  }

  function clearQueuedActiveGameSave(): void {
    if (saveGameTimerRef.current !== null) {
      window.clearTimeout(saveGameTimerRef.current);
      saveGameTimerRef.current = null;
    }
  }

  async function recordOutcome(state: GameState, outcome: "won" | "abandoned"): Promise<void> {
    const key = `${outcome}:${state.seed}:${state.moves}:${state.score}`;

    if (recordedCompletionKeys.current.has(key)) {
      return;
    }

    recordedCompletionKeys.current.add(key);
    try {
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
    } catch (error: unknown) {
      recordedCompletionKeys.current.delete(key);
      console.warn("Unable to record game outcome.", error);
    }
  }

  function recordAbandonIfNeeded(): void {
    const current = gameRef.current;

    if (current.status === "playing" && current.moves > 0) {
      void recordOutcome(current, "abandoned");
    }
  }

  async function updateSettings(next: Settings): Promise<void> {
    setSettingsAndRef(next);

    try {
      await saveSettings(next);
    } catch (error: unknown) {
      console.warn("Unable to save settings.", error);
    }
  }

  async function handleDifficultyChange(difficulty: Difficulty): Promise<void> {
    recordDevLog("settings.difficulty", {
      previousDifficulty: settingsRef.current.difficulty,
      nextDifficulty: difficulty
    });
    await updateSettings({ ...settingsRef.current, difficulty });
    setMessage(`${DIFFICULTIES[difficulty].label} selected.`);
  }

  function handleNewGame(): void {
    recordAbandonIfNeeded();
    const next = newGame(settingsRef.current.difficulty);
    recordDevLog("game.new", {
      difficulty: next.difficulty,
      seed: next.seed
    });
    persistGame(next);
    scheduleDealAnimation(getInitialDealAnimationOrders(next.tableau));
    setMessage(`${DIFFICULTIES[next.difficulty].label} game started.`);
  }

  function handleRestart(): void {
    recordAbandonIfNeeded();
    const selectedDifficulty = settingsRef.current.difficulty;
    const next = gameRef.current.difficulty === selectedDifficulty ? restartGame(gameRef.current) : newGame(selectedDifficulty);
    recordDevLog("game.restart", {
      previousDifficulty: gameRef.current.difficulty,
      selectedDifficulty,
      nextSeed: next.seed
    });
    persistGame(next);
    scheduleDealAnimation(getInitialDealAnimationOrders(next.tableau));
    setMessage(`${DIFFICULTIES[next.difficulty].label} game restarted.`);
  }

  function handleUndo(): void {
    const next = undo(gameRef.current);
    recordDevLog("game.undo", {
      changed: next !== gameRef.current,
      undoDepth: gameRef.current.undoStack.length,
      redoDepth: gameRef.current.redoStack.length
    });
    persistGame(next);
    setMessage(next === gameRef.current ? "Nothing to undo." : "Move undone.");
  }

  function handleRedo(): void {
    const next = redo(gameRef.current);
    recordDevLog("game.redo", {
      changed: next !== gameRef.current,
      undoDepth: gameRef.current.undoStack.length,
      redoDepth: gameRef.current.redoStack.length
    });
    persistGame(next);
    setMessage(next === gameRef.current ? "Nothing to redo." : "Move redone.");
  }

  function handleHint(): void {
    const hint = findHint(gameRef.current);
    recordDevLog("game.hint", {
      type: hint.type,
      message: hint.message
    });
    clearBlockedRunFeedback();
    setMessage(hint.message);
    setHintMove(hint.type === "move" ? hint.move : null);
  }

  function handleDeal(): void {
    const coveredCardIds = getTopTableauCardIds(gameRef.current);
    const outcome = dealStock(gameRef.current);

    if (!outcome.ok) {
      recordDevLog("game.deal.blocked", { reason: outcome.reason }, "warn");
      setMessage(outcome.reason);
      return;
    }

    recordDevLog("game.deal", {
      stockDealsRemaining: outcome.state.stock.length,
      completedSequences: outcome.completedSequences,
      tableauHeights: outcome.state.tableau.map((column) => column.length)
    });
    persistGame(outcome.state);
    const dealOrders = getStockDealAnimationOrders(outcome.state.tableau);

    if (!settingsRef.current.reducedMotion) {
      holdCoveredCardDetails(coveredCardIds, getDealAnimationHoldDuration(dealOrders));
    }

    scheduleDealAnimation(dealOrders);
    setMessage(outcome.completedSequences > 0 ? "Sequence cleared." : "Stock dealt.");
  }

  function handleMove(move: CardMove): void {
    applyMove(move, "Move completed.");
  }

  function applyMove(move: CardMove, successMessage: string): boolean {
    const current = gameRef.current;
    const movingCardIds = getMovingCardIds(current, move);
    const moveAnimationSnapshots = captureMoveAnimationSnapshots(movingCardIds);
    const coverDetailCardIds = getDestinationCoverDetailCardIds(current, move);
    const outcome = moveCards(current, move);

    if (!outcome.ok) {
      recordDevLog("game.move.blocked", { reason: outcome.reason, move }, "warn");
      setMessage(outcome.reason);
      return false;
    }

    recordDevLog("game.move", {
      move,
      completedSequences: outcome.completedSequences,
      score: outcome.state.score,
      moves: outcome.state.moves
    });
    persistGame(outcome.state);
    scheduleMoveAnimation(moveAnimationSnapshots, coverDetailCardIds);
    setMessage(outcome.completedSequences > 0 ? "Sequence cleared." : successMessage);
    return true;
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
    const move = { fromColumn: columnIndex, startIndex: cardIndex };

    const activeSelectedMove = selectedMoveRef.current;

    if (activeSelectedMove) {
      if (activeSelectedMove.fromColumn === columnIndex && activeSelectedMove.startIndex === cardIndex) {
        setSelectedMove(null);
        clearBlockedRunFeedback();
        return;
      }

      const didMove = applyMove({
        ...activeSelectedMove,
        toColumn: columnIndex
      }, "Move completed.");

      if (didMove) {
        return;
      }
    }

    if (canMoveRun(column, cardIndex)) {
      const autoMove = findAutoMove(current, move);

      if (autoMove) {
        applyMove(autoMove, "Move completed.");
        return;
      }

      clearBlockedRunFeedback();
      setSelectedMove(move);
      setHintMove(null);
      setMessage("No automatic destination. Run selected.");
      return;
    }

    flashBlockedRun(columnIndex, cardIndex);
  }

  function handleColumnClick(columnIndex: number): void {
    if (consumeSuppressedClick()) {
      return;
    }

    const activeSelectedMove = selectedMoveRef.current;

    if (!activeSelectedMove) {
      return;
    }

    handleMove({ ...activeSelectedMove, toColumn: columnIndex });
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

    clearBlockedRunFeedback();
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

  function updateDragPreviewPosition(preview: DragPreviewState): void {
    if (!dragPreviewElementRef.current) {
      return;
    }

    dragPreviewElementRef.current.style.transform = getDragPreviewTransform(preview);
  }

  function flashBlockedRun(columnIndex: number, cardIndex: number): void {
    const column = gameRef.current.tableau[columnIndex] ?? [];
    const blocker = findRunBlocker(column, cardIndex);
    const blockerIndex = blocker?.index ?? cardIndex;

    clearBlockedRunFeedback();
    setSelectedMove(null);
    setHintMove(null);

    setBlockedRun({
      fromColumn: columnIndex,
      startIndex: cardIndex,
      blockerIndex,
      endIndex: Math.max(blockerIndex, column.length - 1)
    });

    blockedRunTimerRef.current = window.setTimeout(() => {
      blockedRunTimerRef.current = null;
      setBlockedRun(null);
    }, BLOCKED_RUN_FEEDBACK_MS);

    setMessage(
      blocker?.kind === "face-down"
        ? "Face-down attached cards cannot move."
        : "That card is pinned by incompatible attached cards."
    );
  }

  function clearBlockedRunFeedback(resetState = true): void {
    if (blockedRunTimerRef.current !== null) {
      window.clearTimeout(blockedRunTimerRef.current);
      blockedRunTimerRef.current = null;
    }

    if (resetState) {
      setBlockedRun((current) => (current === null ? current : null));
    }
  }

  function clearDealAnimation(resetState = true): void {
    if (dealAnimationTimerRef.current !== null) {
      window.clearTimeout(dealAnimationTimerRef.current);
      dealAnimationTimerRef.current = null;
    }

    if (dealAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dealAnimationFrameRef.current);
      dealAnimationFrameRef.current = null;
    }

    if (resetState) {
      setDealAnimations((current) => (Object.keys(current).length === 0 ? current : {}));
    }
  }

  function scheduleDealAnimation(orders: Record<string, number>): void {
    clearDealAnimation();

    const orderValues = Object.values(orders);

    if (orderValues.length === 0) {
      return;
    }

    dealAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dealAnimationFrameRef.current = null;
      const animations = measureDealAnimations(orders, stockDeckRef.current);

      setDealAnimations(animations);
      dealAnimationTimerRef.current = window.setTimeout(
        () => clearDealAnimation(),
        DEAL_ANIMATION_DURATION_MS + Math.max(...orderValues) * DEAL_ANIMATION_STAGGER_MS + 120
      );
    });
  }

  function clearMoveAnimationFrame(): void {
    if (moveAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(moveAnimationFrameRef.current);
      moveAnimationFrameRef.current = null;
    }
  }

  function holdCoveredCardDetails(
    cardIds: string[],
    durationMs = MOVE_ANIMATION_DURATION_MS + MOVE_COVER_DETAIL_SETTLE_MS
  ): void {
    const uniqueCardIds = Array.from(new Set(cardIds));

    if (uniqueCardIds.length === 0) {
      return;
    }

    setHeldCoveredCardIds((current) => {
      const next = new Set(current);

      uniqueCardIds.forEach((cardId) => next.add(cardId));
      return next;
    });

    uniqueCardIds.forEach((cardId) => {
      const currentTimer = coverDetailReleaseTimersRef.current.get(cardId);

      if (currentTimer !== undefined) {
        window.clearTimeout(currentTimer);
      }

      const releaseTimer = window.setTimeout(() => {
        releaseCoveredCardDetails([cardId]);
      }, durationMs);

      coverDetailReleaseTimersRef.current.set(cardId, releaseTimer);
    });
  }

  function releaseCoveredCardDetails(cardIds: string[]): void {
    const uniqueCardIds = Array.from(new Set(cardIds));

    if (uniqueCardIds.length === 0) {
      return;
    }

    uniqueCardIds.forEach((cardId) => {
      const currentTimer = coverDetailReleaseTimersRef.current.get(cardId);

      if (currentTimer !== undefined) {
        window.clearTimeout(currentTimer);
        coverDetailReleaseTimersRef.current.delete(cardId);
      }
    });

    setHeldCoveredCardIds((current) => {
      if (uniqueCardIds.every((cardId) => !current.has(cardId))) {
        return current;
      }

      const next = new Set(current);

      uniqueCardIds.forEach((cardId) => next.delete(cardId));
      return next;
    });
  }

  function clearCoveredCardDetailHolds(resetState = true): void {
    coverDetailReleaseTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    coverDetailReleaseTimersRef.current.clear();

    if (resetState) {
      setHeldCoveredCardIds((current) => (current.size === 0 ? current : new Set()));
    }
  }

  function scheduleMoveAnimation(snapshots: MoveAnimationSnapshot[], coverDetailCardIds: string[]): void {
    clearMoveAnimationFrame();

    if (settingsRef.current.reducedMotion || snapshots.length === 0) {
      return;
    }

    holdCoveredCardDetails(coverDetailCardIds);

    moveAnimationFrameRef.current = window.requestAnimationFrame(() => {
      moveAnimationFrameRef.current = null;
      let connectedElementsByCardId: Map<string, HTMLElement> | null = null;
      let startedAnimations = 0;

      snapshots.forEach(({ cardId, element, beforeRect }, index) => {
        const currentElement =
          element.isConnected
            ? element
            : (connectedElementsByCardId ??= getTableauCardElementMap()).get(cardId);

        if (!currentElement || typeof currentElement.animate !== "function") {
          return;
        }

        const after = currentElement.getBoundingClientRect();
        const deltaX = beforeRect.left - after.left;
        const deltaY = beforeRect.top - after.top;

        if (Math.hypot(deltaX, deltaY) < MOVE_ANIMATION_THRESHOLD_PX) {
          return;
        }

        currentElement.classList.add("is-moving-card");
        currentElement.style.setProperty("--moving-card-layer", String(1000 + index));
        startedAnimations += 1;

        const animation = currentElement.animate(
          [
            { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" }
          ],
          {
            duration: MOVE_ANIMATION_DURATION_MS,
            easing: MOVE_ANIMATION_EASING
          }
        );

        void animation.finished.finally(() => {
          currentElement.classList.remove("is-moving-card");
          currentElement.style.removeProperty("--moving-card-layer");
        });
      });

      if (startedAnimations === 0) {
        releaseCoveredCardDetails(coverDetailCardIds);
      }
    });
  }

  function clearToastTimers(): void {
    for (const timer of toastTimersRef.current.values()) {
      window.clearTimeout(timer);
    }

    toastTimersRef.current.clear();
  }

  function dismissToast(id: string): void {
    const timer = toastTimersRef.current.get(id);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function showToast(toast: ToastMessage, options: { persist?: boolean } = {}): void {
    const previousTimer = toastTimersRef.current.get(toast.id);

    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
      toastTimersRef.current.delete(toast.id);
    }

    setToasts((current) => [toast, ...current.filter((item) => item.id !== toast.id)].slice(0, 3));

    if (!options.persist) {
      const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_VISIBLE_MS);
      toastTimersRef.current.set(toast.id, timer);
    }
  }

  async function handleResetConfirmed(): Promise<void> {
    await resetLocalData();
    const nextSettings = DEFAULT_SETTINGS;
    const nextGame = newGame(DEFAULT_SETTINGS.difficulty);
    setSettingsAndRef(nextSettings);
    setStats(DEFAULT_STATS);
    setGameAndRef(nextGame);
    setModal(null);
    setSelectedMove(null);
    setHintMove(null);
    setMessage("Local data reset.");
  }

  async function handleCheckUpdates(): Promise<void> {
    showToast(
      {
        id: UPDATE_TOAST_ID,
        title: "Checking for updates",
        body: "Looking for a signed Spider release from GitHub Releases.",
        tone: "info"
      },
      { persist: true }
    );

    try {
      const update = await checkForUpdates();
      setUpdateInfo(update);
      setMessage(update ? `Update ${update.version} is available.` : "No update available.");
      showToast({
        id: UPDATE_TOAST_ID,
        title: update ? "Update available" : "Spider is up to date",
        body: update
          ? `Version ${update.version} is ready to install.`
          : `You are running the latest available release, ${appVersion}.`,
        tone: update ? "success" : "info"
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Update check failed.";
      setMessage(errorMessage);
      showToast({
        id: UPDATE_TOAST_ID,
        title: errorMessage.includes("installed Spider desktop app") ? "Update check unavailable" : "Update check failed",
        body: errorMessage,
        tone: "error"
      });
    }
  }

  async function handleInstallUpdate(): Promise<void> {
    showToast(
      {
        id: UPDATE_TOAST_ID,
        title: "Installing update",
        body: updateInfo
          ? `Installing Spider ${updateInfo.version}. The app will restart when the update is applied.`
          : "Installing the available Spider update. The app will restart when the update is applied.",
        tone: "info"
      },
      { persist: true }
    );

    try {
      await installUpdate();
      setMessage("Update installed.");
      showToast({
        id: UPDATE_TOAST_ID,
        title: "Update installed",
        body: "Restarting Spider to finish the update.",
        tone: "success"
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Update installation failed.";
      setMessage(errorMessage);
      showToast({
        id: UPDATE_TOAST_ID,
        title: "Update installation failed",
        body: errorMessage,
        tone: "error"
      });
    }
  }

  function handleLoadToolGame(nextGame: GameState, message: string): void {
    recordDevLog("dev.state.applied", {
      seed: nextGame.seed,
      difficulty: nextGame.difficulty,
      tableauHeights: nextGame.tableau.map((column) => column.length)
    });
    persistGame(nextGame);
    setDragPreview(null);
    dragPreviewRef.current = null;
    setMessage(message);
  }

  return (
    <main className="app-shell">
      <section
        ref={playSurfaceRef}
        className="play-surface"
        data-control-layout={controlLayout}
        aria-busy={!isLoaded}
      >
        <GameTopBar
          game={game}
          selectedDifficulty={settings.difficulty}
          canInstallUpdate={Boolean(updateInfo)}
          onDifficultyChange={(difficulty) => {
            void handleDifficultyChange(difficulty);
          }}
          onRestart={() => {
            void handleRestart();
          }}
          onSettings={() => setModal("settings")}
          onStats={() => {
            void loadStats().then(setStats);
            setModal("stats");
          }}
          onAbout={() => setModal("about")}
          devToolsSlot={<DevToolsHost onLoadGame={handleLoadToolGame} getDiagnostics={getDevDiagnostics} />}
          onInstallUpdate={() => {
            void handleInstallUpdate();
          }}
          onElapsedTick={handleElapsedTick}
        />

        <div className="board-resource-zone" aria-label="Stock and completed sequences">
          <div className="foundation-zone" aria-label="Completed sequences by suit">
            {completedSuitSummaries.map((summary) => (
              <div
                key={summary.suit}
                className={["foundation", `foundation--${summary.suit}`, summary.completed > 0 ? "is-filled" : null]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={`${suitLabel(summary.suit)} completed sequences: ${summary.completed} of ${summary.total}`}
              >
                <svg className="foundation__suit" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                  <SuitMark suit={summary.suit} x={50} y={50} size={82} />
                </svg>
                <span className="foundation__count">
                  {summary.completed}/{summary.total}
                </span>
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
              <span ref={stockDeckRef} className={`stock__deck stock__deck--${settings.cardBack}`} />
              <span className="stock__count">{stockDealsRemaining}</span>
            </button>
          </div>
        </div>

        <div ref={tableauRef} className="tableau" aria-label="Tableau">
          {game.tableau.map((column, columnIndex) => {
            const isHintDestination = hintMove?.toColumn === columnIndex;
            const isLegalDestination =
              selectedMove !== null &&
              selectedMovingCard !== null &&
              selectedMove.fromColumn !== columnIndex &&
              canPlaceMovingCardOnColumn(column, selectedMovingCard);
            const columnRenderData = tableauRenderData[columnIndex];
            const movableRunStarts = columnRenderData?.movableRunStarts ?? [];
            const cardReveals = columnRenderData?.cardReveals ?? [];

            return (
              <div
                key={columnIndex}
                data-column-index={columnIndex}
                className={[
                  "tableau-column",
                  isHintDestination ? "is-hint-destination" : "",
                  isLegalDestination ? "is-legal-destination" : "",
                  dragPreview?.hasMoved && dragPreview.overColumn === columnIndex ? "is-drop-target" : ""
                ].join(" ")}
                onClick={() => handleColumnClick(columnIndex)}
              >
                <div className="tableau-column__cards">
                  {column.map((card, cardIndex) => {
                    const isSelected =
                      selectedMove?.fromColumn === columnIndex && selectedMove.startIndex === cardIndex;
                    const isHinted = hintMove?.fromColumn === columnIndex && hintMove.startIndex === cardIndex;
                    const isMovable = movableRunStarts[cardIndex] === true;
                    const isBlockedColumn = blockedRun?.fromColumn === columnIndex;
                    const isBlockedSource =
                      Boolean(isBlockedColumn) && blockedRun?.startIndex === cardIndex;
                    const isBlockedAttachment =
                      Boolean(isBlockedColumn) &&
                      blockedRun !== null &&
                      cardIndex !== blockedRun.startIndex &&
                      cardIndex >= blockedRun.blockerIndex &&
                      cardIndex <= blockedRun.endIndex;
                    const isBlockedBreak =
                      Boolean(isBlockedColumn) && blockedRun?.blockerIndex === cardIndex;
                    const isCovered = cardIndex < column.length - 1;
                    const isCoverDetailHeld = isCovered && heldCoveredCardIds.has(card.id);
                    const isDraggingSource =
                      Boolean(dragPreview?.hasMoved) &&
                      dragPreview?.move.fromColumn === columnIndex &&
                      cardIndex >= dragPreview.move.startIndex;
                    const dealAnimation = dealAnimations[card.id];
                    const dealAnimationStyle =
                      dealAnimation === undefined
                        ? undefined
                        : ({
                            "--deal-delay": `${dealAnimation.order * DEAL_ANIMATION_STAGGER_MS}ms`,
                            "--deal-from-x": `${dealAnimation.fromX}px`,
                            "--deal-from-y": `${dealAnimation.fromY}px`
                          } as CSSProperties);

                    return (
                      <div
                        key={card.id}
                        className={[
                          "tableau-card",
                          isCovered ? "is-covered" : "",
                          isCoverDetailHeld ? "is-cover-detail-held" : "",
                          dealAnimation === undefined ? "" : "is-dealt-card"
                        ].join(" ")}
                        data-card-id={card.id}
                        data-card-face-up={card.faceUp ? "true" : "false"}
                        data-deal-animation-order={dealAnimation?.order}
                        style={
                          {
                            ...dealAnimationStyle,
                            "--card-layer": cardIndex,
                            ...(cardReveals[cardIndex] === undefined
                              ? {}
                              : { "--card-reveal": `${cardReveals[cardIndex]}px` })
                          } as CSSProperties
                        }
                      >
                        <CardView
                          card={card}
                          cardBack={settings.cardBack}
                          columnIndex={columnIndex}
                          cardIndex={cardIndex}
                          isSelected={isSelected}
                          isHinted={isHinted}
                          isDraggingSource={isDraggingSource}
                          isMovable={isMovable}
                          isBlockedSource={isBlockedSource}
                          isBlockedAttachment={isBlockedAttachment}
                          isBlockedBreak={isBlockedBreak}
                          onClick={handleCardClickEvent}
                          onMouseDown={handleCardMouseDownEvent}
                          onPointerDown={handleCardPointerDownEvent}
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
            previewRef={dragPreviewElementRef}
            cards={game.tableau[dragPreview.move.fromColumn].slice(dragPreview.move.startIndex)}
            cardBack={settings.cardBack}
            cardReveals={getColumnCardReveals(
              game.tableau[dragPreview.move.fromColumn].slice(dragPreview.move.startIndex),
              autoFitMetrics
            )}
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

        <div className="board-actions board-actions--left" aria-label="Quick actions">
          <IconButton icon={<Play size={22} />} label="New Game" className="board-action" onClick={handleNewGame} />
          <IconButton icon={<Lightbulb size={22} />} label="Hint" className="board-action" onClick={handleHint} />
        </div>

        <div className="board-actions board-actions--right" aria-label="History actions">
          <IconButton
            icon={<Undo2 size={22} />}
            label="Undo"
            className="board-action"
            onClick={handleUndo}
            disabled={game.undoStack.length === 0}
          />
          <IconButton
            icon={<Redo2 size={22} />}
            label="Redo"
            className="board-action"
            onClick={handleRedo}
            disabled={game.redoStack.length === 0}
          />
        </div>
      </section>

      <div className="sr-only" role="status" aria-live="polite">
        {message}
      </div>

      {toasts.length > 0 ? (
        <div className="toast-region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
              <strong>{toast.title}</strong>
              <span>{toast.body}</span>
            </div>
          ))}
        </div>
      ) : null}

      {modal === "settings" ? (
        <Modal title="Settings" onClose={() => setModal(null)}>
          <div className="settings-grid">
            <label>
              <span>Theme</span>
              <select
                value={settings.theme}
                onChange={(event) => {
                  void updateSettings({ ...settingsRef.current, theme: event.target.value as Settings["theme"] });
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
                  void updateSettings({ ...settingsRef.current, cardBack: event.target.value as CardBack });
                }}
              >
                <option value="spruce">Spruce</option>
                <option value="midnight">Midnight</option>
                <option value="ember">Ember</option>
              </select>
            </label>

            <label>
              <span>Card face</span>
              <select
                value={settings.cardFace}
                onChange={(event) => {
                  void updateSettings({ ...settingsRef.current, cardFace: event.target.value as CardFaceTheme });
                }}
              >
                <option value="system">Match theme</option>
                <option value="classic">Light cards</option>
                <option value="dark">Dark cards</option>
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
                    void updateSettings({ ...settingsRef.current, gameScale: Number(event.target.value) });
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
                    ...settingsRef.current,
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
                  void updateSettings({ ...settingsRef.current, reducedMotion: event.target.checked });
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
            <p className="about-panel__summary">
              A simple, low-clutter Spider Solitaire game for desktop play.
            </p>
            <dl className="about-panel__meta">
              <div>
                <dt>Version</dt>
                <dd>{appVersion}</dd>
              </div>
              <div>
                <dt>Copyright</dt>
                <dd>Copyright 2026 Jay Esquivel.</dd>
              </div>
            </dl>
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

export function shouldEnableDevTools(env: DevToolsEnv): boolean {
  return env.DEV || env.VITE_SPIDER_DEV_TOOLS === "true";
}

function getDevRectSnapshot(element: Element | null | undefined): Record<string, number> | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  return {
    left: roundDebugNumber(rect.left),
    right: roundDebugNumber(rect.right),
    top: roundDebugNumber(rect.top),
    bottom: roundDebugNumber(rect.bottom),
    width: roundDebugNumber(rect.width),
    height: roundDebugNumber(rect.height)
  };
}

function formatDebugCard(card: Card | null): string | null {
  if (!card) {
    return null;
  }

  return `${card.rank}-${card.suit}-${card.faceUp ? "up" : "down"}`;
}

function roundDebugNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function applyGameScale(root: HTMLElement, settings: Settings): void {
  const scale = (settings.gameScale / 100) * DEFAULT_VISUAL_SCALE_MULTIPLIER;

  root.dataset.gameScale = String(settings.gameScale);
  root.dataset.gameScaleMode = settings.gameScaleMode;
  root.style.setProperty("--card-preferred-width", `${BASE_CARD_MAX_WIDTH * scale}px`);
  root.style.setProperty("--card-max-width", `${BASE_CARD_MAX_WIDTH * scale}px`);
}

function getCompletedSuitSummaries(game: GameState): CompletedSuitSummary[] {
  const activeSuits = SUITS.slice(0, DIFFICULTIES[game.difficulty].suitCount);
  const totalPerSuit = 8 / DIFFICULTIES[game.difficulty].suitCount;
  const completedBySuit = new Map<Suit, number>();

  for (const sequence of game.completed) {
    completedBySuit.set(sequence.suit, (completedBySuit.get(sequence.suit) ?? 0) + 1);
  }

  return activeSuits.map((suit) => ({
    suit,
    completed: completedBySuit.get(suit) ?? 0,
    total: totalPerSuit
  }));
}

function suitLabel(suit: Suit): string {
  return `${suit.slice(0, 1).toUpperCase()}${suit.slice(1)}`;
}

export function applyAutoFitScale(
  surface: HTMLElement,
  settings: Settings,
  _game?: GameState,
  tableauElement?: HTMLElement | null,
  controlLayout: BoardControlLayout = "bottom"
): AutoFitMetrics | null {
  if (settings.gameScaleMode !== "auto") {
    applyResolvedAutoFitMetrics(settings, DEFAULT_AUTO_FIT_METRICS);
    return DEFAULT_AUTO_FIT_METRICS;
  }

  const metrics = calculateAutoFitMetrics(surface, settings, tableauElement, controlLayout);

  if (metrics) {
    applyResolvedAutoFitMetrics(settings, metrics);
  }

  return metrics;
}

interface ResolvedAutoFitLayout {
  controlLayout: BoardControlLayout;
  metrics: AutoFitMetrics;
}

export function resolveAutoFitLayout(
  surface: HTMLElement,
  settings: Settings,
  currentControlLayout: BoardControlLayout = "bottom",
  _tableauElement?: HTMLElement | null
): ResolvedAutoFitLayout | null {
  if (settings.gameScaleMode !== "auto") {
    return {
      controlLayout: "bottom",
      metrics: DEFAULT_AUTO_FIT_METRICS
    };
  }

  // Layout choice must be based on candidate geometry, not the currently rendered
  // tableau height; otherwise side and bottom docks can feed back into each other.
  const bottomMetrics = calculateCandidateAutoFitMetrics(surface, settings, "bottom");

  if (!bottomMetrics) {
    return null;
  }

  const sideMetrics = calculateCandidateAutoFitMetrics(surface, settings, "side");
  const sideCardWidth = sideMetrics?.cardWidth ?? null;
  const bottomCardWidth = bottomMetrics.cardWidth;
  const keepsCardSize =
    sideCardWidth !== null &&
    bottomCardWidth !== null &&
    sideCardWidth >= bottomCardWidth * SIDE_RESOURCE_MIN_CARD_RETENTION_RATIO;
  const useSideLayout = sideMetrics && keepsCardSize
    ? getBoardControlLayout(surface, sideMetrics, currentControlLayout) === "side"
    : false;
  const nextControlLayout = useSideLayout ? "side" : "bottom";
  const nextMetrics = useSideLayout && sideMetrics ? sideMetrics : bottomMetrics;

  return {
    controlLayout: nextControlLayout,
    metrics: nextMetrics
  };
}

function calculateCandidateAutoFitMetrics(
  surface: HTMLElement,
  settings: Settings,
  controlLayout: BoardControlLayout
): AutoFitMetrics | null {
  const root = document.documentElement;
  const previousLayout = surface.getAttribute("data-control-layout");
  const previousFitWidth = root.style.getPropertyValue("--card-fit-width");
  let nextFitWidth = parsePixels(previousFitWidth);
  let metrics: AutoFitMetrics | null = null;

  try {
    for (let step = 0; step < 4; step += 1) {
      surface.dataset.controlLayout = controlLayout;

      if (nextFitWidth > 0) {
        root.style.setProperty("--card-fit-width", `${nextFitWidth}px`);
      }

      metrics = calculateAutoFitMetrics(surface, settings, undefined, controlLayout);

      if (!metrics?.cardWidth || metrics.cardWidth === nextFitWidth) {
        break;
      }

      nextFitWidth = metrics.cardWidth;
    }

    return metrics;
  } finally {
    if (previousLayout === null) {
      surface.removeAttribute("data-control-layout");
    } else {
      surface.setAttribute("data-control-layout", previousLayout);
    }

    if (previousFitWidth) {
      root.style.setProperty("--card-fit-width", previousFitWidth);
    } else {
      root.style.removeProperty("--card-fit-width");
    }
  }
}

function calculateAutoFitMetrics(
  surface: HTMLElement,
  settings: Settings,
  tableauElement: HTMLElement | null | undefined,
  controlLayout: BoardControlLayout
): AutoFitMetrics | null {
  const surfaceWidth = getVisibleInlineSize(surface);
  const surfaceHeight = getVisibleBlockSize(surface);

  if (surfaceWidth <= 0 || surfaceHeight <= 0) {
    return null;
  }

  const surfaceStyle = getComputedStyle(surface);
  const inlinePadding = parsePixels(surfaceStyle.paddingLeft) + parsePixels(surfaceStyle.paddingRight);
  const blockPadding = parsePixels(surfaceStyle.paddingTop) + parsePixels(surfaceStyle.paddingBottom);
  const rowGap = parsePixels(surfaceStyle.rowGap || surfaceStyle.gap);
  const columnGap = getResolvedTableauGap(surface, tableauElement);
  const sideResourceReserve =
    controlLayout === "side" ? SIDE_RESOURCE_MAX_WIDTH_PX + SIDE_RESOURCE_ENTER_GAP_PX : 0;
  const availableWidth = Math.max(1, surfaceWidth - inlinePadding - sideResourceReserve - TABLEAU_FIT_SAFETY_PX);
  const userScale = settings.gameScale / GAME_SCALE.default;
  const horizontalFit =
    ((availableWidth - columnGap * (TABLEAU_COLUMN_COUNT - 1)) / TABLEAU_COLUMN_COUNT) * userScale;
  const availableHeight = Math.floor(getAvailableTableauBlockSize(surfaceHeight, blockPadding, rowGap, tableauElement));
  const verticalFit = getMinimumRevealFitWidth(availableHeight, AUTO_FIT_REFERENCE_COLUMN_HEIGHT);
  const heightBalancedFit = getHeightBalancedFitWidth(surfaceWidth, surfaceHeight, availableHeight);
  const visualMaxWidth = BASE_CARD_MAX_WIDTH * DEFAULT_VISUAL_SCALE_MULTIPLIER * userScale;
  const fitWidth = Math.floor(Math.max(1, Math.min(horizontalFit, verticalFit, heightBalancedFit, visualMaxWidth)));
  const stackVisibleRatio = CARD_STACK_VISIBLE_RATIO;

  return {
    cardWidth: fitWidth,
    stackVisibleRatio,
    availableHeight
  };
}

function applyResolvedAutoFitMetrics(settings: Settings, metrics: AutoFitMetrics): void {
  const root = document.documentElement;

  if (settings.gameScaleMode !== "auto" || metrics.cardWidth === null) {
    root.style.removeProperty("--card-fit-width");
    root.style.removeProperty("--card-stack-visible-ratio");
    return;
  }

  setRootStyleProperty(root, "--card-fit-width", `${metrics.cardWidth}px`);
  setRootStyleProperty(root, "--card-stack-visible-ratio", metrics.stackVisibleRatio.toFixed(3));
}

function setRootStyleProperty(root: HTMLElement, property: string, value: string): void {
  if (root.style.getPropertyValue(property) !== value) {
    root.style.setProperty(property, value);
  }
}

export function getBoardControlLayout(
  surface: HTMLElement,
  metrics: AutoFitMetrics,
  _currentControlLayout: BoardControlLayout = "bottom"
): BoardControlLayout {
  if (metrics.cardWidth === null) {
    return "bottom";
  }

  const surfaceWidth = getVisibleInlineSize(surface);
  const surfaceHeight = getVisibleBlockSize(surface);
  const surfaceStyle = getComputedStyle(surface);
  const inlinePadding = parsePixels(surfaceStyle.paddingLeft) + parsePixels(surfaceStyle.paddingRight);
  const columnGap = getResolvedTableauGap(surface);
  const tableauWidth = metrics.cardWidth * TABLEAU_COLUMN_COUNT + columnGap * (TABLEAU_COLUMN_COUNT - 1);
  const availableInlineSpace = Math.max(0, surfaceWidth - inlinePadding);
  const resourceWidth = getSideResourceWidth(metrics.cardWidth);
  const requiredInlineSpace = tableauWidth + resourceWidth + SIDE_RESOURCE_ENTER_GAP_PX;

  return availableInlineSpace >= requiredInlineSpace && surfaceHeight >= SIDE_RESOURCE_ENTER_HEIGHT_PX
    ? "side"
    : "bottom";
}

function getSideResourceWidth(cardWidth: number): number {
  return clamp(cardWidth * SIDE_RESOURCE_WIDTH_RATIO, SIDE_RESOURCE_MIN_WIDTH_PX, SIDE_RESOURCE_MAX_WIDTH_PX);
}

function getAvailableTableauBlockSize(
  surfaceHeight: number,
  blockPadding: number,
  rowGap: number,
  tableauElement?: HTMLElement | null
): number {
  if (tableauElement) {
    const measuredTableauHeight = getVisibleBlockSize(tableauElement);

    if (measuredTableauHeight > 0) {
      return Math.max(1, measuredTableauHeight - TABLEAU_FIT_SAFETY_PX);
    }
  }

  return Math.max(1, surfaceHeight - blockPadding - rowGap - TABLEAU_FIT_SAFETY_PX);
}

function getResolvedTableauGap(surface: HTMLElement, tableauElement?: HTMLElement | null): number {
  const tableau = tableauElement ?? surface.querySelector<HTMLElement>(".tableau");

  if (tableau) {
    const style = getComputedStyle(tableau);
    const gap = parsePixels(style.columnGap || style.gap);

    if (gap > 0) {
      return gap;
    }
  }

  return readRootPixels("--tableau-gap");
}

function getMinimumRevealFitWidth(availableHeight: number, columnHeight: number): number {
  const stackedRevealHeight = Math.max(0, columnHeight - 1) * MIN_CARD_STACK_REVEAL_PX;
  const remainingHeight = availableHeight - stackedRevealHeight;

  if (remainingHeight <= 0) {
    return 1;
  }

  return remainingHeight / CARD_HEIGHT_RATIO;
}

function getHeightBalancedFitWidth(surfaceWidth: number, surfaceHeight: number, availableHeight: number): number {
  const standardFit = availableHeight * MAX_CARD_WIDTH_TO_TABLEAU_HEIGHT_RATIO;

  if (surfaceHeight <= 0 || surfaceWidth / surfaceHeight < ULTRAWIDE_HEIGHT_BALANCE_ASPECT_RATIO) {
    return standardFit;
  }

  return Math.min(standardFit, getUltrawideReadableStackFitWidth(availableHeight) ?? standardFit);
}

function getUltrawideReadableStackFitWidth(availableHeight: number): number | null {
  const smallestReadableStackHeight = getReferenceStackCompressedHeight(1);

  if (availableHeight < smallestReadableStackHeight) {
    return null;
  }

  let low = 1;
  let high = Math.max(1, availableHeight / CARD_HEIGHT_RATIO);

  for (let step = 0; step < 18; step += 1) {
    const midpoint = (low + high) / 2;

    if (getReferenceStackCompressedHeight(midpoint) <= availableHeight) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return low;
}

function getReferenceStackCompressedHeight(cardWidth: number): number {
  const faceDownReveal =
    ULTRAWIDE_REFERENCE_FACE_DOWN_CARDS * getReferenceCardRevealFloorPxForFace(false, cardWidth);
  const faceUpCoveredCards = Math.max(0, ULTRAWIDE_REFERENCE_FACE_UP_RUN_CARDS - 1);
  const faceUpReveal = faceUpCoveredCards * getReferenceCardRevealFloorPxForFace(true, cardWidth);

  return cardWidth * CARD_HEIGHT_RATIO + faceDownReveal + faceUpReveal;
}

export function getColumnCardReveals(column: Card[], metrics: AutoFitMetrics): Array<number | undefined> {
  if (column.length <= 1 || metrics.cardWidth === null || metrics.availableHeight === null) {
    return column.map((_, index) => (index === 0 ? undefined : getFallbackCardRevealPx(metrics)));
  }

  const cardWidth = metrics.cardWidth;
  const availableHeight = metrics.availableHeight;
  const cardHeight = cardWidth * CARD_HEIGHT_RATIO;
  const rawAvailableColumnHeight = Math.max(cardHeight, availableHeight);
  const coveredCardCount = column.length - 1;
  const revealTargets = new Array<number>(coveredCardCount);
  let targetRevealTotal = 0;

  for (let index = 0; index < coveredCardCount; index += 1) {
    const target = getCardRevealTargetPx(column[index], cardWidth);

    revealTargets[index] = target;
    targetRevealTotal += target;
  }

  const reveals: Array<number | undefined> = [undefined];
  const targetHeight = cardHeight + targetRevealTotal;
  const revealMinimums = new Array<number>(coveredCardCount);
  const revealFloors = new Array<number>(coveredCardCount);
  let minimumRevealTotal = 0;
  let floorRevealTotal = 0;

  for (let index = 0; index < coveredCardCount; index += 1) {
    const card = column[index];
    const minimum = getCardRevealMinimumPx(card, cardWidth);
    const floor = getCardRevealFloorPx(card, cardWidth);

    revealMinimums[index] = minimum;
    revealFloors[index] = floor;
    minimumRevealTotal += minimum;
    floorRevealTotal += floor;
  }

  const minimumHeight = cardHeight + minimumRevealTotal;
  const floorHeight = cardHeight + floorRevealTotal;
  const availableColumnHeight = getCappedColumnStackHeight(
    rawAvailableColumnHeight,
    cardWidth,
    targetHeight,
    floorHeight
  );

  if (targetHeight <= availableColumnHeight) {
    for (const target of revealTargets) {
      reveals.push(roundRevealPx(target));
    }

    return reveals;
  }

  const compressionMinimums =
    minimumHeight <= availableColumnHeight
      ? revealMinimums
      : floorHeight <= availableColumnHeight
        ? revealFloors
        : getUniformFitReveals(column.length, cardHeight, availableColumnHeight);
  const compressionMinimumHeight =
    compressionMinimums === revealMinimums
      ? minimumHeight
      : compressionMinimums === revealFloors
        ? floorHeight
        : cardHeight + sumNumbers(compressionMinimums);
  const compressionRatio =
    targetHeight === compressionMinimumHeight
      ? 0
      : Math.max(
          0,
          Math.min(1, (availableColumnHeight - compressionMinimumHeight) / (targetHeight - compressionMinimumHeight))
        );

  for (let index = 0; index < revealTargets.length; index += 1) {
    const minimum = compressionMinimums[index];
    const target = revealTargets[index];
    reveals.push(roundRevealPx(minimum + (target - minimum) * compressionRatio));
  }

  return reveals;
}

function getCappedColumnStackHeight(
  rawAvailableHeight: number,
  cardWidth: number,
  targetHeight: number,
  floorHeight: number
): number {
  if (cardWidth > COMPACT_STACK_HEIGHT_CAP_CARD_WIDTH_PX) {
    return rawAvailableHeight;
  }

  const preferredCap = Math.max(cardWidth * CARD_HEIGHT_RATIO, rawAvailableHeight * COMPACT_STACK_HEIGHT_CAP_RATIO);

  if (targetHeight <= preferredCap) {
    return rawAvailableHeight;
  }

  const readableCap = Math.max(preferredCap, Math.min(floorHeight, rawAvailableHeight));

  return Math.min(rawAvailableHeight, readableCap);
}

function getFallbackCardRevealPx(metrics: AutoFitMetrics): number {
  if (metrics.cardWidth === null || metrics.availableHeight === null) {
    return MIN_CARD_STACK_REVEAL_PX;
  }

  return roundRevealPx(metrics.cardWidth * metrics.stackVisibleRatio);
}

function getCardRevealTargetPx(card: Card, cardWidth: number): number {
  return getCardRevealTargetPxForFace(card.faceUp, cardWidth);
}

function getCardRevealTargetPxForFace(faceUp: boolean, cardWidth: number): number {
  return faceUp
    ? clamp(cardWidth * FACE_UP_REVEAL_RATIO, FACE_UP_REVEAL_MIN_PX, FACE_UP_REVEAL_MAX_PX)
    : clamp(cardWidth * FACE_DOWN_REVEAL_RATIO, FACE_DOWN_REVEAL_MIN_PX, FACE_DOWN_REVEAL_MAX_PX);
}

function getCardRevealMinimumPx(card: Card, cardWidth: number): number {
  return card.faceUp
    ? clamp(cardWidth * FACE_UP_REVEAL_MIN_RATIO, FACE_UP_REVEAL_MIN_PX, FACE_UP_REVEAL_MAX_PX)
    : FACE_DOWN_REVEAL_MIN_PX;
}

function getCardRevealFloorPx(card: Card, cardWidth: number): number {
  return getCardRevealFloorPxForFace(card.faceUp, cardWidth);
}

function getCardRevealFloorPxForFace(faceUp: boolean, cardWidth: number): number {
  if (!faceUp) {
    return FACE_DOWN_REVEAL_FLOOR_PX;
  }

  return clamp(cardWidth * FACE_UP_REVEAL_FLOOR_RATIO, FACE_UP_REVEAL_COMPACT_FLOOR_MIN_PX, FACE_UP_REVEAL_FLOOR_PX);
}

function getReferenceCardRevealFloorPxForFace(faceUp: boolean, cardWidth: number): number {
  return faceUp
    ? Math.min(cardWidth * FACE_UP_REVEAL_FLOOR_RATIO, FACE_UP_REVEAL_FLOOR_PX)
    : FACE_DOWN_REVEAL_FLOOR_PX;
}

function getUniformFitReveals(cardCount: number, cardHeight: number, availableHeight: number): number[] {
  const coveredCardCount = Math.max(0, cardCount - 1);

  if (coveredCardCount === 0) {
    return [];
  }

  const reveal = Math.max(1, (availableHeight - cardHeight) / coveredCardCount);

  return Array.from({ length: coveredCardCount }, () => reveal);
}

function roundRevealPx(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumNumbers(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function areAutoFitMetricsEqual(current: AutoFitMetrics, next: AutoFitMetrics): boolean {
  return (
    current.cardWidth === next.cardWidth &&
    current.stackVisibleRatio === next.stackVisibleRatio &&
    current.availableHeight === next.availableHeight
  );
}

function getVisibleInlineSize(surface: HTMLElement): number {
  const rect = surface.getBoundingClientRect();
  const candidates = [surface.clientWidth, rect.width].filter(isPositiveFiniteNumber);

  if (candidates.length > 0) {
    return Math.min(...candidates);
  }

  return getViewportWidth();
}

function getVisibleBlockSize(surface: HTMLElement): number {
  const rect = surface.getBoundingClientRect();
  const candidates = [surface.clientHeight, rect.height].filter(isPositiveFiniteNumber);

  if (candidates.length > 0) {
    return Math.min(...candidates);
  }

  return getViewportHeight();
}

function getViewportWidth(): number {
  return window.visualViewport?.width ?? window.innerWidth;
}

function getViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

function isPositiveFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function readRootPixels(property: string): number {
  return parsePixels(getComputedStyle(document.documentElement).getPropertyValue(property));
}

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function measureDealAnimations(
  orders: Record<string, number>,
  sourceElement: HTMLElement | null
): Record<string, DealAnimationConfig> {
  const sourceRect = sourceElement?.getBoundingClientRect();
  const elementsByCardId = getTableauCardElementMap();
  const fallbackSource = {
    x: getViewportWidth() - 48,
    y: getViewportHeight() - 96
  };
  const sourceCenter =
    sourceRect === undefined
      ? fallbackSource
      : {
          x: sourceRect.left + sourceRect.width / 2,
          y: sourceRect.top + sourceRect.height / 2
        };

  return Object.fromEntries(
    Object.entries(orders).map(([cardId, order]) => {
      const cardElement = elementsByCardId.get(cardId)?.querySelector<HTMLElement>(".card");
      const cardRect = cardElement?.getBoundingClientRect();
      const cardCenter =
        cardRect === undefined
          ? {
              x: sourceCenter.x,
              y: sourceCenter.y
            }
          : {
              x: cardRect.left + cardRect.width / 2,
              y: cardRect.top + cardRect.height / 2
            };

      return [
        cardId,
        {
          order,
          fromX: Math.round(sourceCenter.x - cardCenter.x),
          fromY: Math.round(sourceCenter.y - cardCenter.y)
        }
      ];
    })
  );
}

function getStockDealAnimationOrders(tableau: Card[][]): Record<string, number> {
  return Object.fromEntries(
    tableau.flatMap((column, columnIndex) => {
      const card = column.at(-1);
      return card ? [[card.id, columnIndex]] : [];
    })
  );
}

function getDealAnimationHoldDuration(orders: Record<string, number>): number {
  const orderValues = Object.values(orders);

  if (orderValues.length === 0) {
    return MOVE_ANIMATION_DURATION_MS + MOVE_COVER_DETAIL_SETTLE_MS;
  }

  return DEAL_ANIMATION_DURATION_MS + Math.max(...orderValues) * DEAL_ANIMATION_STAGGER_MS + MOVE_COVER_DETAIL_SETTLE_MS;
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

interface GameTopBarProps {
  game: GameState;
  selectedDifficulty: Difficulty;
  canInstallUpdate: boolean;
  devToolsSlot?: ReactNode;
  onDifficultyChange: (difficulty: Difficulty) => void;
  onRestart: () => void;
  onSettings: () => void;
  onStats: () => void;
  onAbout: () => void;
  onInstallUpdate: () => void;
  onElapsedTick: (elapsedMs: number) => void;
}

function GameTopBar({
  game,
  selectedDifficulty,
  canInstallUpdate,
  devToolsSlot = null,
  onDifficultyChange,
  onRestart,
  onSettings,
  onStats,
  onAbout,
  onInstallUpdate,
  onElapsedTick
}: GameTopBarProps) {
  return (
    <header className="game-topbar" aria-label="Game status and controls">
      <div className="game-topbar__left" aria-label="Game controls">
        <IconButton icon={<Menu size={23} />} label="Menu" className="game-topbar__button" onClick={onSettings} />
        <IconButton
          icon={<RotateCcw size={22} />}
          label="Restart"
          className="game-topbar__button"
          onClick={onRestart}
        />
        <div className="game-title-lockup">
          <span className="game-title-lockup__mark" aria-hidden="true">
            ♠
          </span>
          <div>
            <h1>Spider</h1>
            <p>{DIFFICULTIES[game.difficulty].label}</p>
          </div>
        </div>
        <label className="difficulty-picker difficulty-picker--topbar">
          <span className="sr-only">Difficulty</span>
          <select
            value={selectedDifficulty}
            aria-label="Difficulty"
            onChange={(event) => onDifficultyChange(event.target.value as Difficulty)}
          >
            {Object.entries(DIFFICULTIES).map(([value, config]) => (
              <option key={value} value={value}>
                {config.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="game-topbar__scoreboard" aria-label="Game status">
        <TopBarMetric label="Score" value={String(game.score)} />
        <TopBarMetric label="Moves" value={String(game.moves)} />
        <ElapsedTimeMetric
          timerId={`${game.seed}:${game.startedAt}`}
          initialElapsedMs={game.elapsedMs}
          status={game.status}
          onElapsedTick={onElapsedTick}
        />
        <TopBarMetric label="Complete" value={`${game.completed.length}/8`} />
      </div>

      <div className="game-topbar__utilities" aria-label="Application actions">
        {canInstallUpdate ? (
          <IconButton icon={<Download size={19} />} label="Install Update" compact onClick={onInstallUpdate} />
        ) : null}
        {devToolsSlot}
        <IconButton icon={<BarChart3 size={19} />} label="Stats" compact onClick={onStats} />
        <IconButton icon={<Info size={19} />} label="About" compact onClick={onAbout} />
        <IconButton icon={<SettingsIcon size={19} />} label="Settings" compact onClick={onSettings} />
      </div>
    </header>
  );
}

function TopBarMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="game-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ElapsedTimeMetric({
  timerId,
  initialElapsedMs,
  status,
  onElapsedTick
}: {
  timerId: string;
  initialElapsedMs: number;
  status: GameState["status"];
  onElapsedTick: (elapsedMs: number) => void;
}) {
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);
  const elapsedMsRef = useRef(initialElapsedMs);

  useEffect(() => {
    elapsedMsRef.current = initialElapsedMs;
    setElapsedMs(initialElapsedMs);
  }, [initialElapsedMs, timerId]);

  useEffect(() => {
    let lastTick = Date.now();

    const tick = () => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      if (document.hidden || status !== "playing") {
        return;
      }

      const nextElapsedMs = elapsedMsRef.current + delta;
      elapsedMsRef.current = nextElapsedMs;
      onElapsedTick(nextElapsedMs);
      setElapsedMs(nextElapsedMs);
    };

    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [onElapsedTick, status, timerId]);

  return <TopBarMetric label="Time" value={formatDuration(elapsedMs)} />;
}

function StatsView({ stats, allStats }: { stats: StatsPayload; allStats: StatsRollup }) {
  const difficultyRollups = stats.rollups.filter((rollup) => rollup.scope === "difficulty");
  const averageScore = allStats.gamesPlayed === 0 ? 0 : Math.round(allStats.totalScore / allStats.gamesPlayed);
  const winRate = allStats.gamesPlayed === 0 ? 0 : Math.round((allStats.gamesWon / allStats.gamesPlayed) * 100);

  return (
    <div className="stats-grid">
      <Metric label="Lifetime Points" value={formatNumber(allStats.totalScore)} />
      <Metric label="Average Points" value={allStats.gamesPlayed === 0 ? "—" : formatNumber(averageScore)} />
      <Metric label="Games" value={formatNumber(allStats.gamesPlayed)} />
      <Metric label="Wins" value={formatNumber(allStats.gamesWon)} />
      <Metric label="Win Rate" value={allStats.gamesPlayed === 0 ? "—" : `${winRate}%`} />
      <Metric label="Abandoned" value={formatNumber(allStats.gamesAbandoned)} />
      <Metric label="Best Score" value={allStats.bestScore === null ? "—" : formatNumber(allStats.bestScore)} />
      <Metric label="Best Time" value={allStats.bestTimeMs === null ? "—" : formatDuration(allStats.bestTimeMs)} />
      <Metric label="Moves Made" value={formatNumber(allStats.totalMoves)} />
      <Metric label="Time Played" value={formatDuration(allStats.totalElapsedMs)} />

      {difficultyRollups.length > 0 ? (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Difficulty</th>
              <th>Played</th>
              <th>Won</th>
              <th>Points</th>
              <th>Best</th>
            </tr>
          </thead>
          <tbody>
            {difficultyRollups.map((rollup) => (
              <tr key={rollup.difficulty}>
                <td>{rollup.difficulty === "all" ? "All" : DIFFICULTIES[rollup.difficulty].label}</td>
                <td>{formatNumber(rollup.gamesPlayed)}</td>
                <td>{formatNumber(rollup.gamesWon)}</td>
                <td>{formatNumber(rollup.totalScore)}</td>
                <td>{rollup.bestScore === null ? "—" : formatNumber(rollup.bestScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function DragPreview({
  previewRef,
  cards,
  cardBack,
  cardReveals,
  x,
  y
}: {
  previewRef: Ref<HTMLDivElement>;
  cards: Card[];
  cardBack: CardBack;
  cardReveals: Array<number | undefined>;
  x: number;
  y: number;
}) {
  return (
    <div
      ref={previewRef}
      className="drag-preview"
      data-testid="drag-preview"
      style={
        {
          transform: getDragPreviewTransformFromPosition(x, y)
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {cards.map((card, index) => {
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
            style={
              cardReveals[index] === undefined
                ? undefined
                : ({ "--card-reveal": `${cardReveals[index]}px` } as CSSProperties)
            }
          >
            <CardFace card={card} />
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

function readCardEventPosition(element: HTMLElement): { columnIndex: number; cardIndex: number } | null {
  const columnIndex = Number.parseInt(element.dataset.cardColumnIndex ?? "", 10);
  const cardIndex = Number.parseInt(element.dataset.cardIndex ?? "", 10);

  if (!Number.isInteger(columnIndex) || !Number.isInteger(cardIndex)) {
    return null;
  }

  return { columnIndex, cardIndex };
}

function shouldRenderDragPreviewUpdate(
  current: DragPreviewState | null,
  next: DragPreviewState | null
): boolean {
  if (current === next) {
    return false;
  }

  if (!current || !next) {
    return current !== next;
  }

  return (
    current.hasMoved !== next.hasMoved ||
    current.overColumn !== next.overColumn ||
    current.pointerId !== next.pointerId ||
    current.move.fromColumn !== next.move.fromColumn ||
    current.move.startIndex !== next.move.startIndex
  );
}

function getDragPreviewTransform(preview: DragPreviewState): string {
  return getDragPreviewTransformFromPosition(preview.x - preview.offsetX, preview.y - preview.offsetY);
}

function getDragPreviewTransformFromPosition(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}

function getMovingCardIds(state: GameState, move: CardMove): string[] {
  return state.tableau[move.fromColumn]?.slice(move.startIndex).map((card) => card.id) ?? [];
}

function getTopTableauCardIds(state: GameState): string[] {
  return state.tableau.flatMap((column) => {
    const card = column.at(-1);
    return card?.faceUp ? [card.id] : [];
  });
}

function getDestinationCoverDetailCardIds(state: GameState, move: CardMove): string[] {
  const destinationCard = state.tableau[move.toColumn]?.at(-1);

  return destinationCard?.faceUp ? [destinationCard.id] : [];
}

function captureMoveAnimationSnapshots(cardIds: string[]): MoveAnimationSnapshot[] {
  const wantedCardIds = new Set(cardIds);
  const snapshotsByCardId = new Map<string, MoveAnimationSnapshot>();

  document.querySelectorAll<HTMLElement>(".tableau-card[data-card-id]").forEach((element) => {
    const cardId = element.dataset.cardId;

    if (cardId && wantedCardIds.has(cardId)) {
      snapshotsByCardId.set(cardId, {
        cardId,
        element,
        beforeRect: element.getBoundingClientRect()
      });
    }
  });

  return cardIds
    .map((cardId) => snapshotsByCardId.get(cardId))
    .filter((snapshot): snapshot is MoveAnimationSnapshot => snapshot !== undefined);
}

function getTableauCardElementMap(): Map<string, HTMLElement> {
  const elementsByCardId = new Map<string, HTMLElement>();

  document.querySelectorAll<HTMLElement>(".tableau-card[data-card-id]").forEach((element) => {
    const cardId = element.dataset.cardId;

    if (cardId) {
      elementsByCardId.set(cardId, element);
    }
  });

  return elementsByCardId;
}

function canPlaceMovingCardOnColumn(column: Card[], movingCard: Card): boolean {
  const destinationCard = column.at(-1);

  return !destinationCard || (destinationCard.faceUp && destinationCard.rank === movingCard.rank + 1);
}

function getMovableRunStarts(column: Card[]): boolean[] {
  const movableStarts = Array<boolean>(column.length).fill(false);
  let tailCanMove = true;

  for (let index = column.length - 1; index >= 0; index -= 1) {
    const card = column[index];
    const next = column[index + 1];

    if (!card.faceUp) {
      tailCanMove = false;
      continue;
    }

    if (next && (!next.faceUp || card.suit !== next.suit || card.rank !== next.rank + 1)) {
      tailCanMove = false;
    }

    movableStarts[index] = tailCanMove;
  }

  return movableStarts;
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

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
