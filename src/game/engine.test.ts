import { describe, expect, it } from "vitest";
import {
  canDealStock,
  canMoveRun,
  createDeck,
  dealStock,
  moveCards,
  newGame,
  restartGame,
  undo,
  redo
} from "./engine";
import { type Card, type GameState, type Rank, type Suit } from "./types";

describe("Spider engine", () => {
  it("creates the expected 104-card deck composition for each difficulty", () => {
    expect(createDeck("one-suit")).toHaveLength(104);
    expect(new Set(createDeck("one-suit").map((card) => card.suit))).toEqual(new Set(["spades"]));

    expect(createDeck("two-suit")).toHaveLength(104);
    expect(new Set(createDeck("two-suit").map((card) => card.suit))).toEqual(new Set(["spades", "hearts"]));

    expect(createDeck("four-suit")).toHaveLength(104);
    expect(new Set(createDeck("four-suit").map((card) => card.suit))).toEqual(
      new Set(["spades", "hearts", "diamonds", "clubs"])
    );
  });

  it("deals the initial tableau and stock shape", () => {
    const game = newGame("four-suit", "deal-shape");

    expect(game.tableau.map((column) => column.length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    expect(game.tableau.flat().filter((card) => card.faceUp)).toHaveLength(10);
    expect(game.tableau.flat().filter((card) => !card.faceUp)).toHaveLength(44);
    expect(game.stock).toHaveLength(5);
    expect(game.stock.flat()).toHaveLength(50);
  });

  it("reproduces a game from difficulty and seed", () => {
    const first = newGame("two-suit", "repeatable");
    const second = newGame("two-suit", "repeatable");
    const third = newGame("two-suit", "different");

    expect(first.tableau.map((column) => column.map((card) => card.id))).toEqual(
      second.tableau.map((column) => column.map((card) => card.id))
    );
    expect(first.stock.map((deal) => deal.map((card) => card.id))).toEqual(
      second.stock.map((deal) => deal.map((card) => card.id))
    );
    expect(first.tableau.map((column) => column.map((card) => card.id))).not.toEqual(
      third.tableau.map((column) => column.map((card) => card.id))
    );
  });

  it("deals one face-up card to every tableau column from stock", () => {
    const game = newGame("one-suit", "stock");
    const outcome = dealStock(game);

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.tableau.every((column) => column.at(-1)?.faceUp)).toBe(true);
      expect(outcome.state.tableau.map((column) => column.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6, 6, 6]);
      expect(outcome.state.stock).toHaveLength(4);
      expect(outcome.state.moves).toBe(1);
      expect(outcome.state.score).toBe(499);
    }
  });

  it("blocks stock dealing when any tableau column is empty", () => {
    const game = newGame("one-suit", "blocked-stock");
    game.tableau[3] = [];

    expect(canDealStock(game)).toBe(false);
    expect(dealStock(game).ok).toBe(false);
  });

  it("allows legal descending placement and rejects illegal rank placement", () => {
    const legal = stateWithTableau([
      [card(12), card(11)],
      [card(13)],
      []
    ]);
    const moved = moveCards(legal, { fromColumn: 0, startIndex: 0, toColumn: 1 });

    expect(moved.ok).toBe(true);

    const illegal = stateWithTableau([[card(10)], [card(13)], []]);
    expect(moveCards(illegal, { fromColumn: 0, startIndex: 0, toColumn: 1 }).ok).toBe(false);
  });

  it("moves only face-up same-suit descending runs", () => {
    expect(canMoveRun([card(13), card(12), card(11)], 0)).toBe(true);
    expect(canMoveRun([card(13, "spades"), card(12, "hearts")], 0)).toBe(false);
    expect(canMoveRun([card(13, "spades", false), card(12, "spades")], 0)).toBe(false);
  });

  it("accepts valid movable runs into empty tableau columns", () => {
    const game = stateWithTableau([[card(9), card(8), card(7)], []]);
    const outcome = moveCards(game, { fromColumn: 0, startIndex: 0, toColumn: 1 });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.tableau[1].map((item) => item.rank)).toEqual([9, 8, 7]);
    }
  });

  it("reveals a face-down card after uncovering it", () => {
    const game = stateWithTableau([[card(5, "spades", false), card(4)], []]);
    const outcome = moveCards(game, { fromColumn: 0, startIndex: 1, toColumn: 1 });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.tableau[0].at(-1)?.faceUp).toBe(true);
    }
  });

  it("removes a completed King-to-Ace same-suit sequence and updates score", () => {
    const game = stateWithTableau([
      [card(1)],
      [card(13), card(12), card(11), card(10), card(9), card(8), card(7), card(6), card(5), card(4), card(3), card(2)]
    ]);
    const outcome = moveCards(game, { fromColumn: 0, startIndex: 0, toColumn: 1 });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.completed).toHaveLength(1);
      expect(outcome.state.tableau[1]).toHaveLength(0);
      expect(outcome.state.score).toBe(599);
    }
  });

  it("supports undo and redo", () => {
    const game = stateWithTableau([[card(12)], [card(13)]]);
    const outcome = moveCards(game, { fromColumn: 0, startIndex: 0, toColumn: 1 });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      const undone = undo(outcome.state);
      expect(undone.tableau[0]).toHaveLength(1);
      expect(undone.tableau[1]).toHaveLength(1);

      const redone = redo(undone);
      expect(redone.tableau[0]).toHaveLength(0);
      expect(redone.tableau[1]).toHaveLength(2);
    }
  });

  it("detects a win after the eighth sequence is completed", () => {
    const game = stateWithTableau([
      [card(1)],
      [card(13), card(12), card(11), card(10), card(9), card(8), card(7), card(6), card(5), card(4), card(3), card(2)]
    ]);
    game.completed = Array.from({ length: 7 }, (_, index) => ({
      id: `done-${index}`,
      suit: "spades",
      removedAtMove: index + 1
    }));

    const outcome = moveCards(game, { fromColumn: 0, startIndex: 0, toColumn: 1 });

    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      expect(outcome.state.status).toBe("won");
    }
  });

  it("restarts the same seed and difficulty", () => {
    const game = newGame("four-suit", "restart-seed");
    const restarted = restartGame(game);

    expect(restarted.seed).toBe(game.seed);
    expect(restarted.difficulty).toBe(game.difficulty);
    expect(restarted.tableau.map((column) => column.map((card) => card.id))).toEqual(
      game.tableau.map((column) => column.map((card) => card.id))
    );
  });
});

let nextId = 0;

function card(rank: Rank, suit: Suit = "spades", faceUp = true): Card {
  nextId += 1;
  return {
    id: `test-${nextId}`,
    rank,
    suit,
    faceUp
  };
}

function stateWithTableau(tableau: Card[][]): GameState {
  const now = new Date().toISOString();
  const paddedTableau = Array.from({ length: 10 }, (_, index) => tableau[index] ?? []);

  return {
    stateVersion: 1,
    difficulty: "one-suit",
    seed: "test",
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    tableau: paddedTableau,
    stock: [],
    completed: [],
    score: 500,
    moves: 0,
    status: "playing",
    undoStack: [],
    redoStack: []
  };
}
