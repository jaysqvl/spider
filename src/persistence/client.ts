import { invoke } from "@tauri-apps/api/core";
import packageJson from "../../package.json";
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
const DESKTOP_UPDATE_UNAVAILABLE_MESSAGE =
  "Updates are only available in the installed Spider desktop app. This browser preview cannot check or install releases.";

export type AutoUpdateOutcome = "unavailable" | "current" | "installed";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function loadAppState(): Promise<LoadAppState> {
  return invokeOrLocal("load_app_state", undefined, () => ({
    settings: loadLocalSettings(),
    activeGame: reviveGameState(readJson(ACTIVE_GAME_KEY)),
    stats: loadLocalStats(),
    recoveryMessage: null,
    appVersion: packageJson.version
  }));
}

export async function saveActiveGame(game: GameState): Promise<void> {
  const serialized = serializeGameState(game);

  await invokeOrLocal("save_active_game", { game: serialized }, () => {
    writeJson(ACTIVE_GAME_KEY, serialized);
  });
}

export async function clearActiveGame(): Promise<void> {
  await invokeOrLocal("clear_active_game", undefined, () => {
    localStorage.removeItem(ACTIVE_GAME_KEY);
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await invokeOrLocal("save_settings", { settings }, () => {
    writeJson(SETTINGS_KEY, settings);
  });
}

export async function recordCompletedGame(record: CompletedGameInput): Promise<StatsPayload> {
  return invokeOrLocal("record_completed_game", { record }, () => {
    const stats = applyCompletedGame(loadLocalStats(), record);
    writeJson(STATS_KEY, stats);
    return stats;
  });
}

export async function loadStats(): Promise<StatsPayload> {
  return invokeOrLocal("load_stats", undefined, loadLocalStats);
}

export async function resetLocalData(): Promise<void> {
  await invokeOrLocal("reset_local_data", undefined, () => {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(ACTIVE_GAME_KEY);
    localStorage.removeItem(STATS_KEY);
  });
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_UPDATE_UNAVAILABLE_MESSAGE);
  }

  try {
    return await invoke<UpdateInfo | null>("check_for_updates");
  } catch (error) {
    if (isTauriCommandUnavailable(error)) {
      throw new Error(DESKTOP_UPDATE_UNAVAILABLE_MESSAGE, { cause: error });
    }

    throw toError(error, "Update check failed.");
  }
}

export async function installUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_UPDATE_UNAVAILABLE_MESSAGE);
  }

  try {
    await invoke("install_update");
  } catch (error) {
    if (isTauriCommandUnavailable(error)) {
      throw new Error(DESKTOP_UPDATE_UNAVAILABLE_MESSAGE, { cause: error });
    }

    throw toError(error, "Update installation failed.");
  }
}

export async function installAvailableUpdate(): Promise<AutoUpdateOutcome> {
  if (!isTauriRuntime()) {
    return "unavailable";
  }

  try {
    const update = await checkForUpdates();

    if (!update) {
      return "current";
    }

    await installUpdate();
    return "installed";
  } catch (error) {
    if (isDesktopUpdateUnavailable(error)) {
      return "unavailable";
    }

    throw error;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function isDesktopUpdateUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === DESKTOP_UPDATE_UNAVAILABLE_MESSAGE;
}

async function invokeOrLocal<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  localFallback: () => T | Promise<T>
): Promise<T> {
  if (!isTauriRuntime()) {
    return localFallback();
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (isTauriCommandUnavailable(error)) {
      return localFallback();
    }

    throw toError(error, `${command} failed.`);
  }
}

function isTauriCommandUnavailable(error: unknown): boolean {
  const message = stringifyError(error).toLowerCase();

  return (
    message.includes("unknown command") ||
    /command .*not found/.test(message) ||
    message.includes("__tauri_ipc__") ||
    message.includes("ipc channel")
  );
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  const message = stringifyError(error);
  return new Error(message || fallbackMessage, { cause: error });
}

function stringifyError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

function loadLocalSettings(): Settings {
  return mergeSettings(readJson(SETTINGS_KEY));
}

function loadLocalStats(): StatsPayload {
  return normalizeStats(readJson(STATS_KEY));
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
    cardFace:
      value.cardFace === "system" || value.cardFace === "classic" || value.cardFace === "dark"
        ? value.cardFace
        : DEFAULT_SETTINGS.cardFace,
    gameScale: normalizeGameScale(value.gameScale),
    gameScaleMode: isGameScaleMode(value.gameScaleMode) ? value.gameScaleMode : DEFAULT_SETTINGS.gameScaleMode,
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
  const rollups = normalizeStats(stats).rollups;
  const allRollup = upsertRollup(rollups, "all", "all");
  const difficultyRollup = upsertRollup(rollups, "difficulty", record.difficulty);

  updateRollup(allRollup, record);
  updateRollup(difficultyRollup, record);

  return { rollups };
}

function normalizeStats(value: unknown): StatsPayload {
  if (!isRecord(value) || !Array.isArray(value.rollups)) {
    return cloneDefaultStats();
  }

  const rollups = value.rollups.flatMap((rollup) => {
    const normalized = normalizeRollup(rollup);
    return normalized === null ? [] : [normalized];
  });

  if (!rollups.some((rollup) => rollup.scope === "all" && rollup.difficulty === "all")) {
    rollups.unshift(createEmptyRollup("all", "all"));
  }

  return { rollups };
}

function normalizeRollup(value: unknown): StatsRollup | null {
  if (!isRecord(value)) {
    return null;
  }

  const scope = value.scope === "all" || value.scope === "difficulty" ? value.scope : null;

  if (scope === null) {
    return null;
  }

  const difficulty = scope === "all" ? "all" : isDifficulty(value.difficulty) ? value.difficulty : null;

  if (difficulty === null) {
    return null;
  }

  return {
    scope,
    difficulty,
    gamesPlayed: normalizeCount(value.gamesPlayed),
    gamesWon: normalizeCount(value.gamesWon),
    gamesAbandoned: normalizeCount(value.gamesAbandoned),
    bestScore: normalizeOptionalInteger(value.bestScore),
    bestTimeMs: normalizeOptionalInteger(value.bestTimeMs),
    totalScore: normalizeInteger(value.totalScore),
    totalMoves: normalizeCount(value.totalMoves),
    totalElapsedMs: normalizeCount(value.totalElapsedMs)
  };
}

function cloneDefaultStats(): StatsPayload {
  return {
    rollups: DEFAULT_STATS.rollups.map((rollup) => ({ ...rollup }))
  };
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

  const next = createEmptyRollup(scope, difficulty);
  rollups.push(next);
  return next;
}

function createEmptyRollup(scope: StatsRollup["scope"], difficulty: Difficulty | "all"): StatsRollup {
  return {
    scope,
    difficulty,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesAbandoned: 0,
    bestScore: null,
    bestTimeMs: null,
    totalScore: 0,
    totalMoves: 0,
    totalElapsedMs: 0
  };
}

function updateRollup(rollup: StatsRollup, record: CompletedGameInput): void {
  rollup.gamesPlayed += 1;
  rollup.totalScore += record.score;
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

function normalizeCount(value: unknown): number {
  return Math.max(0, normalizeInteger(value));
}

function normalizeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function isGameScaleMode(value: unknown): value is Settings["gameScaleMode"] {
  return value === "auto" || value === "manual";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
