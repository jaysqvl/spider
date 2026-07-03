import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";
import App from "./App";
import {
  findAutoMove,
  findHint,
  moveCards,
  newGame,
  validateMove
} from "./game/engine";
import type { Card, GameState, Rank, Suit } from "./game/types";

const ENGINE_ITERATIONS = 20_000;
const UI_ITERATIONS = 20;
const TIMER_TICKS = 60;
const shouldRunPerf =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SPIDER_PERF === "1";
const describePerf = shouldRunPerf ? describe : describe.skip;

interface PerfMetric {
  metric: string;
  totalMs: number;
  iterations: number;
  averageMs: number;
}

describePerf("Spider performance", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures engine and interaction timings", async () => {
    const metrics: PerfMetric[] = [];

    metrics.push(measureEngineHints());
    metrics.push(measureEngineAutoMoves());
    metrics.push(measureEngineMoveValidation());
    metrics.push(await measureElapsedTimerTicks());
    metrics.push(await measureAutomaticClickMove());

    console.log(`SPIDER_PERF_METRICS=${JSON.stringify(metrics)}`);
  });
});

function measureEngineHints(): PerfMetric {
  const games = Array.from({ length: 25 }, (_, index) => newGame("four-suit", `perf-hint-${index}`));

  return measure("engine.findHint", ENGINE_ITERATIONS, (iteration) => {
    findHint(games[iteration % games.length]);
  });
}

function measureEngineAutoMoves(): PerfMetric {
  const game = gameWithAutoMoveRun();
  const move = { fromColumn: 0, startIndex: 0 };

  return measure("engine.findAutoMove", ENGINE_ITERATIONS, () => {
    findAutoMove(game, move);
  });
}

function measureEngineMoveValidation(): PerfMetric {
  const game = gameWithAutoMoveRun();
  const move = { fromColumn: 0, startIndex: 0, toColumn: 1 };

  return measure("engine.validateMove+moveCards", ENGINE_ITERATIONS, () => {
    validateMove(game, move);
    moveCards(game, move);
  });
}

async function measureElapsedTimerTicks(): Promise<PerfMetric> {
  mockBrowserLayout();
  localStorage.setItem("spider.activeGame", JSON.stringify(newGame("four-suit", "perf-timer")));
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });

  render(<App />);
  await flushAppLoad();

  const start = performance.now();

  for (let tick = 0; tick < TIMER_TICKS; tick += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
  }

  return toMetric("ui.elapsedTimerTicks", performance.now() - start, TIMER_TICKS);
}

async function measureAutomaticClickMove(): Promise<PerfMetric> {
  const samples: number[] = [];

  for (let iteration = 0; iteration < UI_ITERATIONS; iteration += 1) {
    cleanup();
    localStorage.clear();
    mockBrowserLayout();
    mockElementAnimate();
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithAutoMoveRun()));

    render(<App />);
    await flushAppLoad();

    const start = performance.now();
    fireEvent.click(screen.getByRole("button", { name: "Q of spades" }));
    await flushAppLoad();
    samples.push(performance.now() - start);
  }

  return toMetric("ui.automaticClickMove", sum(samples), samples.length);
}

function measure(metric: string, iterations: number, task: (iteration: number) => void): PerfMetric {
  const start = performance.now();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    task(iteration);
  }

  return toMetric(metric, performance.now() - start, iterations);
}

function toMetric(metric: string, totalMs: number, iterations: number): PerfMetric {
  return {
    metric,
    totalMs: round(totalMs),
    iterations,
    averageMs: round(totalMs / iterations)
  };
}

async function flushAppLoad(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockBrowserLayout(): void {
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 860, configurable: true });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: HTMLElement
  ) {
    if (this.classList.contains("play-surface")) {
      return domRect(0, 0, 1280, 860);
    }

    if (this.classList.contains("tableau-card")) {
      const columnIndex = Number.parseInt(
        this.closest<HTMLElement>("[data-column-index]")?.dataset.columnIndex ?? "0",
        10
      );
      const cardIndex = Array.from(this.parentElement?.children ?? []).indexOf(this);

      return domRect(24 + columnIndex * 112, 120 + Math.max(0, cardIndex) * 32, 92, 127);
    }

    return domRect(0, 0, 92, 127);
  });

  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: {
      configurable: true,
      get() {
        return this.classList.contains("play-surface") ? 1280 : 92;
      }
    },
    clientHeight: {
      configurable: true,
      get() {
        return this.classList.contains("play-surface") ? 860 : 127;
      }
    }
  });
}

function mockElementAnimate(): void {
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: vi.fn().mockReturnValue({ finished: Promise.resolve() } as unknown as Animation)
  });
}

function gameWithAutoMoveRun(): GameState {
  const now = new Date().toISOString();

  return {
    stateVersion: 1,
    difficulty: "one-suit",
    seed: "perf-auto-move-run",
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    tableau: [
      [card(12), card(11)],
      [card(13)],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ],
    stock: [],
    completed: [],
    score: 500,
    moves: 0,
    status: "playing",
    undoStack: [],
    redoStack: []
  };
}

let nextCardId = 0;

function card(rank: Rank, suit: Suit = "spades"): Card {
  nextCardId += 1;

  return {
    id: `perf-card-${nextCardId}`,
    rank,
    suit,
    faceUp: true
  };
}

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({})
  } as DOMRect;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
