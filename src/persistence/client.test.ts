import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newGame } from "../game/engine";
import {
  checkForUpdates,
  clearActiveGame,
  loadAppState,
  recordCompletedGame,
  resetLocalData,
  saveActiveGame,
  saveSettings
} from "./client";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

const invokeMock = vi.mocked(invoke);

describe("browser persistence fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("saves and loads active games", async () => {
    const game = newGame("two-suit", "persist-me");

    await saveActiveGame(game);

    const loaded = await loadAppState();
    expect(loaded.activeGame?.seed).toBe("persist-me");
    expect(loaded.activeGame?.difficulty).toBe("two-suit");
  });

  it("persists settings", async () => {
    await saveSettings({
      theme: "dark",
      difficulty: "four-suit",
      cardBack: "ember",
      gameScale: 85,
      reducedMotion: true
    });

    const loaded = await loadAppState();
    expect(loaded.settings).toEqual({
      theme: "dark",
      difficulty: "four-suit",
      cardBack: "ember",
      gameScale: 85,
      reducedMotion: true
    });
  });

  it("falls back to browser storage when a host Tauri shell lacks Spider commands", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    invokeMock.mockRejectedValue("command save_settings not found");

    await saveSettings({
      theme: "dark",
      difficulty: "two-suit",
      cardBack: "midnight",
      gameScale: 90,
      reducedMotion: true
    });

    const loaded = await loadAppState();
    expect(loaded.settings.theme).toBe("dark");
    expect(loaded.settings.difficulty).toBe("two-suit");
  });

  it("explains update checks are desktop-only when Spider update commands are unavailable", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {}
    });
    invokeMock.mockRejectedValue("command check_for_updates not found");

    await expect(checkForUpdates()).rejects.toThrow("installed Spider desktop app");
  });

  it("normalizes missing, old oversized, and out-of-range game scale settings", async () => {
    localStorage.setItem(
      "spider.settings",
      JSON.stringify({
        theme: "dark",
        difficulty: "one-suit",
        cardBack: "spruce",
        gameScale: 999,
        reducedMotion: false
      })
    );

    expect((await loadAppState()).settings.gameScale).toBe(100);

    localStorage.setItem(
      "spider.settings",
      JSON.stringify({
        theme: "dark",
        difficulty: "one-suit",
        cardBack: "spruce",
        gameScale: 120,
        reducedMotion: false
      })
    );

    expect((await loadAppState()).settings.gameScale).toBe(100);

    localStorage.setItem(
      "spider.settings",
      JSON.stringify({
        theme: "dark",
        difficulty: "one-suit",
        cardBack: "spruce",
        reducedMotion: false
      })
    );

    expect((await loadAppState()).settings.gameScale).toBe(100);
  });

  it("records completed games into aggregate stats", async () => {
    const stats = await recordCompletedGame({
      difficulty: "one-suit",
      seed: "finished",
      outcome: "won",
      score: 612,
      moves: 88,
      elapsedMs: 120_000,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:02:00.000Z"
    });

    const all = stats.rollups.find((rollup) => rollup.scope === "all");
    const oneSuit = stats.rollups.find((rollup) => rollup.difficulty === "one-suit");

    expect(all?.gamesPlayed).toBe(1);
    expect(all?.gamesWon).toBe(1);
    expect(oneSuit?.bestScore).toBe(612);
    expect(oneSuit?.bestTimeMs).toBe(120_000);
  });

  it("clears active games separately from full local reset", async () => {
    await saveActiveGame(newGame("one-suit", "clear-me"));
    await clearActiveGame();

    expect((await loadAppState()).activeGame).toBeNull();

    await saveSettings({
      theme: "dark",
      difficulty: "two-suit",
      cardBack: "midnight",
      gameScale: 95,
      reducedMotion: false
    });
    await resetLocalData();

    expect((await loadAppState()).settings.theme).toBe("system");
  });
});
