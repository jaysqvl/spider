import { invoke } from "@tauri-apps/api/core";
import { reviveGameState, serializeGameState } from "../game/engine";
import type { Difficulty, GameState } from "../game/types";
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  GAME_SCALE,
  type CompletedGameInput,
  type LoadAppState,
  type Settings,
  type StatsPayload,
  type StatsRollup,
  type UpdateInfo
} from "./types";

const SETTINGS_KEY = "spider.settings";
const ACTIVE_GAME_KEY = "spider.activeGame";
const STATS_KEY = "spider.stats";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function loadAppState(): Promise<LoadAppState> {
  if (isTauriRuntime()) {
    return invoke<LoadAppState>("load_app_state");
  }

  return {
    settings: loadLocalSettings(),
    activeGame: reviveGameState(readJson(ACTIVE_GAME_KEY)),
    stats: loadLocalStats(),
    recoveryMessage: null,
    appVersion: "0.1.1-dev"
  };
}

export async function saveActiveGame(game: GameState): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_active_game", { game: serializeGameState(game) });
    return;
  }

  writeJson(ACTIVE_GAME_KEY, serializeGameState(game));
}

export async function clearActiveGame(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("clear_active_game");
    return;
  }

  localStorage.removeItem(ACTIVE_GAME_KEY);
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("save_settings", { settings });
    return;
  }

  writeJson(SETTINGS_KEY, settings);
}

export async function recordCompletedGame(record: CompletedGameInput): Promise<StatsPayload> {
  if (isTauriRuntime()) {
    return invoke<StatsPayload>("record_completed_game", { record });
  }

  const stats = applyCompletedGame(loadLocalStats(), record);
  writeJson(STATS_KEY, stats);
  return stats;
}

export async function loadStats(): Promise<StatsPayload> {
  if (isTauriRuntime()) {
    return invoke<StatsPayload>("load_stats");
  }

  return loadLocalStats();
}

export async function resetLocalData(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("reset_local_data");
    return;
  }

  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(ACTIVE_GAME_KEY);
  localStorage.removeItem(STATS_KEY);
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (isTauriRuntime()) {
    return invoke<UpdateInfo | null>("check_for_updates");
  }

  return null;
}

export async function installUpdate(): Promise<void> {
  if (isTauriRuntime()) {
    await invoke("install_update");
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function loadLocalSettings(): Settings {
  return mergeSettings(readJson(SETTINGS_KEY));
}

function loadLocalStats(): StatsPayload {
  const value = readJson(STATS_KEY);

  if (!isRecord(value) || !Array.isArray(value.rollups)) {
    return DEFAULT_STATS;
  }

  return value as unknown as StatsPayload;
}

function mergeSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS;
  }

  return {
    theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system",
    difficulty: isDifficulty(value.difficulty) ? value.difficulty : DEFAULT_SETTINGS.difficulty,
    cardBack:
      value.cardBack === "midnight" || value.cardBack === "ember" || value.cardBack === "spruce"
        ? value.cardBack
        : DEFAULT_SETTINGS.cardBack,
    gameScale: normalizeGameScale(value.gameScale),
    reducedMotion: typeof value.reducedMotion === "boolean" ? value.reducedMotion : DEFAULT_SETTINGS.reducedMotion
  };
}

function normalizeGameScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.gameScale;
  }

  const stepped = Math.round(value / GAME_SCALE.step) * GAME_SCALE.step;
  return Math.min(GAME_SCALE.max, Math.max(GAME_SCALE.min, stepped));
}

function applyCompletedGame(stats: StatsPayload, record: CompletedGameInput): StatsPayload {
  const rollups = [...stats.rollups];
  const allRollup = upsertRollup(rollups, "all", "all");
  const difficultyRollup = upsertRollup(rollups, "difficulty", record.difficulty);

  updateRollup(allRollup, record);
  updateRollup(difficultyRollup, record);

  return { rollups };
}

function upsertRollup(
  rollups: StatsRollup[],
  scope: StatsRollup["scope"],
  difficulty: Difficulty | "all"
): StatsRollup {
  const existing = rollups.find((rollup) => rollup.scope === scope && rollup.difficulty === difficulty);

  if (existing) {
    return existing;
  }

  const next: StatsRollup = {
    scope,
    difficulty,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesAbandoned: 0,
    bestScore: null,
    bestTimeMs: null,
    totalMoves: 0,
    totalElapsedMs: 0
  };
  rollups.push(next);
  return next;
}

function updateRollup(rollup: StatsRollup, record: CompletedGameInput): void {
  rollup.gamesPlayed += 1;
  rollup.totalMoves += record.moves;
  rollup.totalElapsedMs += record.elapsedMs;

  if (record.outcome === "won") {
    rollup.gamesWon += 1;
    rollup.bestScore = rollup.bestScore === null ? record.score : Math.max(rollup.bestScore, record.score);
    rollup.bestTimeMs =
      rollup.bestTimeMs === null ? record.elapsedMs : Math.min(rollup.bestTimeMs, record.elapsedMs);
    return;
  }

  rollup.gamesAbandoned += 1;
}

function readJson(key: string): unknown {
  const raw = localStorage.getItem(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "one-suit" || value === "two-suit" || value === "four-suit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
