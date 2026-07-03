import { createRng, createSeed } from "./rng";
import {
  DIFFICULTIES,
  STATE_VERSION,
  SUITS,
  type Card,
  type CardMove,
  type CompletedSequence,
  type CoreSnapshot,
  type Difficulty,
  type GameState,
  type Hint,
  type MoveOutcome,
  type Rank,
  type Suit
} from "./types";

const TABLEAU_COLUMNS = 10;
const INITIAL_TABLEAU_CARDS = 54;
const STOCK_DEALS = 5;
const CARDS_PER_STOCK_DEAL = 10;
const STARTING_SCORE = 500;
const MOVE_COST = 1;
const SEQUENCE_SCORE = 100;
const MAX_HISTORY = 200;

const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function createDeck(difficulty: Difficulty): Card[] {
  const suitCount = DIFFICULTIES[difficulty].suitCount;
  const activeSuits = SUITS.slice(0, suitCount);
  const copiesPerRank = 8 / suitCount;
  const cards: Card[] = [];

  for (const suit of activeSuits) {
    for (let copy = 0; copy < copiesPerRank; copy += 1) {
      for (const rank of RANKS) {
        cards.push({
          id: `${difficulty}-${suit}-${rank}-${copy}`,
          rank,
          suit,
          faceUp: false
        });
      }
    }
  }

  return cards;
}

export function shuffleDeck(cards: Card[], seed: string): Card[] {
  const rng = createRng(seed);
  const shuffled = cards.map(cloneCard);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function newGame(difficulty: Difficulty, seed = createSeed()): GameState {
  const shuffled = shuffleDeck(createDeck(difficulty), seed);
  const tableauCounts = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5];
  const tableau: Card[][] = [];
  let cursor = 0;

  for (const count of tableauCounts) {
    const column = shuffled.slice(cursor, cursor + count).map(cloneCard);
    column[column.length - 1].faceUp = true;
    tableau.push(column);
    cursor += count;
  }

  const stockCards = shuffled.slice(INITIAL_TABLEAU_CARDS).map((card) => ({
    ...card,
    faceUp: false
  }));
  const stock: Card[][] = [];

  for (let deal = 0; deal < STOCK_DEALS; deal += 1) {
    stock.push(
      stockCards
        .slice(deal * CARDS_PER_STOCK_DEAL, (deal + 1) * CARDS_PER_STOCK_DEAL)
        .map(cloneCard)
    );
  }

  const now = new Date().toISOString();

  return {
    stateVersion: STATE_VERSION,
    difficulty,
    seed,
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    tableau,
    stock,
    completed: [],
    score: STARTING_SCORE,
    moves: 0,
    status: "playing",
    undoStack: [],
    redoStack: []
  };
}

export function restartGame(state: GameState): GameState {
  return newGame(state.difficulty, state.seed);
}

export function moveCards(state: GameState, move: CardMove): MoveOutcome {
  const validation = validateMove(state, move);

  if (!validation.ok) {
    return validation;
  }

  const next = beginMutation(state, false);
  const source = next.tableau[move.fromColumn];
  const destination = next.tableau[move.toColumn];
  const movingCards = source.splice(move.startIndex);

  destination.push(...movingCards);
  revealTopCard(source);

  const completedSequences = removeCompletedSequences(next);
  finishPlayerAction(next, completedSequences);

  return {
    ok: true,
    state: next,
    completedSequences
  };
}

export function dealStock(state: GameState): MoveOutcome {
  if (!canDealStock(state)) {
    return {
      ok: false,
      reason:
        state.stock.length === 0
          ? "The stock is empty."
          : "Fill every tableau column before dealing from stock."
    };
  }

  const next = beginMutation(state);
  const deal = next.stock.shift();

  if (!deal) {
    return {
      ok: false,
      reason: "The stock is empty."
    };
  }

  for (let columnIndex = 0; columnIndex < TABLEAU_COLUMNS; columnIndex += 1) {
    next.tableau[columnIndex].push({
      ...deal[columnIndex],
      faceUp: true
    });
  }

  const completedSequences = removeCompletedSequences(next);
  finishPlayerAction(next, completedSequences);

  return {
    ok: true,
    state: next,
    completedSequences
  };
}

export function undo(state: GameState): GameState {
  const previous = state.undoStack.at(-1);

  if (!previous) {
    return state;
  }

  const next = cloneState(state);
  const current = snapshotCore(state);

  applySnapshot(next, previous);
  next.undoStack = state.undoStack.slice(0, -1).map(cloneSnapshot);
  next.redoStack = [...state.redoStack.map(cloneSnapshot), current].slice(-MAX_HISTORY);
  touch(next);

  return next;
}

export function redo(state: GameState): GameState {
  const future = state.redoStack.at(-1);

  if (!future) {
    return state;
  }

  const next = cloneState(state);
  const current = snapshotCore(state);

  applySnapshot(next, future);
  next.undoStack = [...state.undoStack.map(cloneSnapshot), current].slice(-MAX_HISTORY);
  next.redoStack = state.redoStack.slice(0, -1).map(cloneSnapshot);
  touch(next);

  return next;
}

export function findHint(state: GameState): Hint {
  if (state.status === "won") {
    return {
      type: "none",
      message: "This game is already complete."
    };
  }

  for (let fromColumn = 0; fromColumn < state.tableau.length; fromColumn += 1) {
    const column = state.tableau[fromColumn];

    for (let startIndex = 0; startIndex < column.length; startIndex += 1) {
      if (!canMoveRun(column, startIndex)) {
        continue;
      }

      const movingCard = column[startIndex];

      for (let toColumn = 0; toColumn < state.tableau.length; toColumn += 1) {
        if (fromColumn === toColumn) {
          continue;
        }

        if (!getDestinationMoveBlocker(state.tableau[toColumn], movingCard)) {
          const move = { fromColumn, startIndex, toColumn };
          return {
            type: "move",
            move,
            message: `Move ${rankLabel(movingCard.rank)} to column ${toColumn + 1}.`
          };
        }
      }
    }
  }

  if (canDealStock(state)) {
    return {
      type: "deal",
      message: "Deal the next row from stock."
    };
  }

  return {
    type: "none",
    message: "No legal moves are available right now."
  };
}

export interface RunBlocker {
  kind: "missing-card" | "face-down" | "incompatible";
  index: number;
}

export function findRunBlocker(column: Card[], startIndex: number): RunBlocker | null {
  if (startIndex < 0 || startIndex >= column.length) {
    return {
      kind: "missing-card",
      index: startIndex
    };
  }

  for (let index = startIndex; index < column.length; index += 1) {
    const card = column[index];

    if (!card.faceUp) {
      return {
        kind: "face-down",
        index
      };
    }

    const next = column[index + 1];

    if (!next) {
      continue;
    }

    if (!next.faceUp) {
      return {
        kind: "face-down",
        index: index + 1
      };
    }

    if (card.suit !== next.suit || card.rank !== next.rank + 1) {
      return {
        kind: "incompatible",
        index: index + 1
      };
    }
  }

  return null;
}

export function findAutoMove(state: GameState, move: Omit<CardMove, "toColumn">): CardMove | null {
  const source = state.tableau[move.fromColumn];

  if (!source || !canMoveRun(source, move.startIndex)) {
    return null;
  }

  const movingCard = source[move.startIndex];
  const movingCards = source.length - move.startIndex;
  let bestToColumn = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let toColumn = 0; toColumn < state.tableau.length; toColumn += 1) {
    if (toColumn === move.fromColumn) {
      continue;
    }

    const destination = state.tableau[toColumn];
    const destinationCard = destination[destination.length - 1];

    if (destinationCard && (!destinationCard.faceUp || destinationCard.rank !== movingCard.rank + 1)) {
      continue;
    }

    const score = destinationCard
      ? getBuildDestinationScore(destination, movingCard)
      : getEmptyDestinationScore(source, movingCards);
    const distance = Math.abs(move.fromColumn - toColumn);

    if (
      bestToColumn === -1 ||
      score > bestScore ||
      (score === bestScore && (distance < bestDistance || (distance === bestDistance && toColumn < bestToColumn)))
    ) {
      bestToColumn = toColumn;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return bestToColumn === -1
    ? null
    : {
        ...move,
        toColumn: bestToColumn
      };
}

export function validateMove(state: GameState, move: CardMove): { ok: true } | { ok: false; reason: string } {
  if (state.status !== "playing") {
    return {
      ok: false,
      reason: "The game is already complete."
    };
  }

  if (move.fromColumn === move.toColumn) {
    return {
      ok: false,
      reason: "Choose a different destination column."
    };
  }

  const source = state.tableau[move.fromColumn];
  const destination = state.tableau[move.toColumn];

  if (!source || !destination) {
    return {
      ok: false,
      reason: "That column does not exist."
    };
  }

  if (!canMoveRun(source, move.startIndex)) {
    return {
      ok: false,
      reason: "Only a face-up descending same-suit run can move together."
    };
  }

  const movingCard = source[move.startIndex];
  const destinationCard = destination[destination.length - 1];

  if (!destinationCard) {
    return { ok: true };
  }

  if (!destinationCard.faceUp) {
    return {
      ok: false,
      reason: "Cards cannot be placed on a face-down card."
    };
  }

  if (destinationCard.rank !== movingCard.rank + 1) {
    return {
      ok: false,
      reason: "Tableau cards must build downward by rank."
    };
  }

  return { ok: true };
}

export function canMoveRun(column: Card[], startIndex: number): boolean {
  return findRunBlocker(column, startIndex) === null;
}

export function canDealStock(state: GameState): boolean {
  return state.status === "playing" && state.stock.length > 0 && state.tableau.every((column) => column.length > 0);
}

export function reviveGameState(value: unknown): GameState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.stateVersion !== STATE_VERSION) {
    return null;
  }

  if (!isDifficulty(value.difficulty) || typeof value.seed !== "string") {
    return null;
  }

  const state = value as unknown as GameState;

  if (!Array.isArray(state.tableau) || !Array.isArray(state.stock)) {
    return null;
  }

  return cloneState({
    ...state,
    undoStack: Array.isArray(state.undoStack) ? state.undoStack : [],
    redoStack: Array.isArray(state.redoStack) ? state.redoStack : [],
    elapsedMs: typeof state.elapsedMs === "number" ? state.elapsedMs : 0,
    status: state.status === "won" ? "won" : "playing"
  });
}

export function serializeGameState(state: GameState): GameState {
  return cloneState(state);
}

export function rankLabel(rank: Rank): string {
  if (rank === 1) {
    return "A";
  }

  if (rank === 11) {
    return "J";
  }

  if (rank === 12) {
    return "Q";
  }

  if (rank === 13) {
    return "K";
  }

  return String(rank);
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case "spades":
      return "♠";
    case "hearts":
      return "♥";
    case "diamonds":
      return "♦";
    case "clubs":
      return "♣";
  }
}

function beginMutation(state: GameState, cloneStock = true): GameState {
  const undoStack =
    state.undoStack.length >= MAX_HISTORY
      ? state.undoStack.slice(1)
      : state.undoStack.slice();

  undoStack.push(snapshotCore(state));

  return {
    ...state,
    tableau: state.tableau.map((column) => column.slice()),
    stock: cloneStock ? state.stock.map((deal) => deal.slice()) : state.stock,
    completed: state.completed.map((sequence) => ({ ...sequence })),
    undoStack,
    redoStack: []
  };
}

function finishPlayerAction(state: GameState, completedSequences: number): void {
  state.moves += 1;
  state.score = state.score - MOVE_COST + completedSequences * SEQUENCE_SCORE;
  state.status = state.completed.length === 8 ? "won" : "playing";
  touch(state);
}

function removeCompletedSequences(state: GameState): number {
  let removed = 0;

  for (const column of state.tableau) {
    let sequence = getCompletedSequence(column);

    while (sequence) {
      column.splice(column.length - 13, 13);
      state.completed.push({
        id: `${sequence.suit}-${state.completed.length + 1}`,
        suit: sequence.suit,
        removedAtMove: state.moves + 1
      });
      removed += 1;
      revealTopCard(column);
      sequence = getCompletedSequence(column);
    }
  }

  return removed;
}

function getCompletedSequence(column: Card[]): Pick<CompletedSequence, "suit"> | null {
  if (column.length < 13) {
    return null;
  }

  const startIndex = column.length - 13;
  const first = column[startIndex];

  if (!first?.faceUp) {
    return null;
  }

  for (let index = 0; index < 13; index += 1) {
    const card = column[startIndex + index];

    if (!card.faceUp || card.suit !== first.suit || card.rank !== ((13 - index) as Rank)) {
      return null;
    }
  }

  return {
    suit: first.suit
  };
}

function revealTopCard(column: Card[]): void {
  const topCard = column[column.length - 1];

  if (topCard && !topCard.faceUp) {
    column[column.length - 1] = {
      ...topCard,
      faceUp: true
    };
  }
}

function getBuildDestinationScore(destination: Card[], movingCard: Card): number {
  const destinationCard = destination[destination.length - 1];

  if (!destinationCard) {
    return 0;
  }

  const sameSuitBonus = destinationCard.suit === movingCard.suit ? 200 : 100;

  return sameSuitBonus + getSameSuitTailLength(destination);
}

function getEmptyDestinationScore(source: Card[], movingCards: number): number {
  return source.length > movingCards ? 50 : 10;
}

function getDestinationMoveBlocker(destination: Card[] | undefined, movingCard: Card): string | null {
  if (!destination) {
    return "That column does not exist.";
  }

  const destinationCard = destination[destination.length - 1];

  if (!destinationCard) {
    return null;
  }

  if (!destinationCard.faceUp) {
    return "Cards cannot be placed on a face-down card.";
  }

  if (destinationCard.rank !== movingCard.rank + 1) {
    return "Tableau cards must build downward by rank.";
  }

  return null;
}

function getSameSuitTailLength(column: Card[]): number {
  const topCard = column[column.length - 1];

  if (!topCard?.faceUp) {
    return 0;
  }

  let length = 1;

  for (let index = column.length - 2; index >= 0; index -= 1) {
    const card = column[index];
    const previous = column[index + 1];

    if (!card.faceUp || card.suit !== previous.suit || card.rank !== previous.rank + 1) {
      break;
    }

    length += 1;
  }

  return length;
}

function snapshotCore(state: GameState): CoreSnapshot {
  return {
    tableau: state.tableau.map((column) => column.slice()),
    stock: state.stock.map((deal) => deal.slice()),
    completed: state.completed.slice(),
    score: state.score,
    moves: state.moves,
    status: state.status
  };
}

function applySnapshot(state: GameState, snapshot: CoreSnapshot): void {
  state.tableau = snapshot.tableau.map((column) => column.map(cloneCard));
  state.stock = snapshot.stock.map((deal) => deal.map(cloneCard));
  state.completed = snapshot.completed.map((sequence) => ({ ...sequence }));
  state.score = snapshot.score;
  state.moves = snapshot.moves;
  state.status = snapshot.status;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    tableau: state.tableau.map((column) => column.map(cloneCard)),
    stock: state.stock.map((deal) => deal.map(cloneCard)),
    completed: state.completed.map((sequence) => ({ ...sequence })),
    undoStack: state.undoStack.map(cloneSnapshot),
    redoStack: state.redoStack.map(cloneSnapshot)
  };
}

function cloneSnapshot(snapshot: CoreSnapshot): CoreSnapshot {
  return {
    ...snapshot,
    tableau: snapshot.tableau.map((column) => column.map(cloneCard)),
    stock: snapshot.stock.map((deal) => deal.map(cloneCard)),
    completed: snapshot.completed.map((sequence) => ({ ...sequence }))
  };
}

function cloneCard(card: Card): Card {
  return { ...card };
}

function touch(state: GameState): void {
  state.updatedAt = new Date().toISOString();
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "one-suit" || value === "two-suit" || value === "four-suit";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
