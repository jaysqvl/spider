import type { GameState } from "../game/types";

interface DevToolsHostProps {
  onLoadGame: (game: GameState, message: string) => void;
}

export function DevToolsHost(_props: DevToolsHostProps) {
  return null;
}
