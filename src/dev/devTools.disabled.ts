import type { GameState } from "../game/types";

export type DevLogLevel = "info" | "warn" | "error";
export type DevLogDetails = Record<string, unknown>;

export interface DevLogEntry {
  id: number;
  at: string;
  level: DevLogLevel;
  event: string;
  details?: DevLogDetails;
}

export interface DevDiagnosticsSnapshot {
  app: DevLogDetails;
  viewport: DevLogDetails;
  layout: DevLogDetails;
  game: DevLogDetails;
  settings: DevLogDetails;
}

interface DevToolsHostProps {
  onLoadGame: (game: GameState, message: string) => void;
  getDiagnostics: () => DevDiagnosticsSnapshot;
}

export function DevToolsHost(_props: DevToolsHostProps) {
  return null;
}

export function recordDevLog(_event: string, _details?: DevLogDetails, _level: DevLogLevel = "info"): void {}

export function getDevLogEntries(): DevLogEntry[] {
  return [];
}

export function clearDevLogEntries(): void {}
