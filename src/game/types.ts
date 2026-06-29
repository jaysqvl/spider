export const STATE_VERSION = 1;

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export type Difficulty = "one-suit" | "two-suit" | "four-suit";

export const DIFFICULTIES: Record<
  Difficulty,
  { label: string; suitCount: 1 | 2 | 4 }
> = {
  "one-suit": { label: "1 Suit", suitCount: 1 },
  "two-suit": { label: "2 Suits", suitCount: 2 },
  "four-suit": { label: "4 Suits", suitCount: 4 }
};

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
  faceUp: boolean;
}

export interface CompletedSequence {
  id: string;
  suit: Suit;
  removedAtMove: number;
}

export type GameStatus = "playing" | "won";

export interface CoreSnapshot {
  tableau: Card[][];
  stock: Card[][];
  completed: CompletedSequence[];
  score: number;
  moves: number;
  status: GameStatus;
}

export interface GameState extends CoreSnapshot {
  stateVersion: typeof STATE_VERSION;
  difficulty: Difficulty;
  seed: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  undoStack: CoreSnapshot[];
  redoStack: CoreSnapshot[];
}

export interface CardMove {
  fromColumn: number;
  startIndex: number;
  toColumn: number;
}

export type Hint =
  | {
      type: "move";
      move: CardMove;
      message: string;
    }
  | {
      type: "deal";
      message: string;
    }
  | {
      type: "none";
      message: string;
    };

export interface MoveResult {
  ok: true;
  state: GameState;
  completedSequences: number;
}

export interface InvalidMove {
  ok: false;
  reason: string;
}

export type MoveOutcome = MoveResult | InvalidMove;
