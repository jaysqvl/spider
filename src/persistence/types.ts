import type { Difficulty, GameState } from "../game/types";

export type ThemePreference = "system" | "light" | "dark";
export type CardBack = "spruce" | "midnight" | "ember";
export type GameScaleMode = "auto" | "manual";

export interface Settings {
  theme: ThemePreference;
  difficulty: Difficulty;
  cardBack: CardBack;
  gameScale: number;
  gameScaleMode: GameScaleMode;
  reducedMotion: boolean;
}

export const GAME_SCALE = {
  min: 70,
  max: 100,
  step: 5,
  default: 100
} as const;

export interface CompletedGameInput {
  difficulty: Difficulty;
  seed: string;
  outcome: "won" | "abandoned";
  score: number;
  moves: number;
  elapsedMs: number;
  startedAt: string;
  completedAt: string;
}

export interface StatsRollup {
  scope: "all" | "difficulty";
  difficulty: Difficulty | "all";
  gamesPlayed: number;
  gamesWon: number;
  gamesAbandoned: number;
  bestScore: number | null;
  bestTimeMs: number | null;
  totalMoves: number;
  totalElapsedMs: number;
}

export interface StatsPayload {
  rollups: StatsRollup[];
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string | null;
  date?: string | null;
}

export interface LoadAppState {
  settings: Settings;
  activeGame: GameState | null;
  stats: StatsPayload;
  recoveryMessage?: string | null;
  appVersion: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  difficulty: "one-suit",
  cardBack: "spruce",
  gameScale: GAME_SCALE.default,
  gameScaleMode: "auto",
  reducedMotion: false
};

export const DEFAULT_STATS: StatsPayload = {
  rollups: [
    {
      scope: "all",
      difficulty: "all",
      gamesPlayed: 0,
      gamesWon: 0,
      gamesAbandoned: 0,
      bestScore: null,
      bestTimeMs: null,
      totalMoves: 0,
      totalElapsedMs: 0
    }
  ]
};
