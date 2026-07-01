import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { rankLabel, suitSymbol } from "../game/engine";
import type { Card, Rank, Suit } from "../game/types";
import type { CardBack } from "../persistence/types";

interface CardViewProps {
  card: Card;
  cardBack: CardBack;
  isSelected: boolean;
  isHinted: boolean;
  isDraggingSource: boolean;
  isMovable: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}

export function CardView({
  card,
  cardBack,
  isSelected,
  isHinted,
  isDraggingSource,
  isMovable,
  onClick,
  onMouseDown,
  onPointerDown
}: CardViewProps) {
  const color = card.suit === "hearts" || card.suit === "diamonds" ? "red" : "black";
  const label = card.faceUp ? `${rankLabel(card.rank)} of ${card.suit}` : "Face-down card";

  return (
    <button
      type="button"
      className={[
        "card",
        card.faceUp ? "card--face-up" : "card--face-down",
        `card--${color}`,
        `card--back-${cardBack}`,
        isSelected ? "is-selected" : "",
        isHinted ? "is-hinted" : "",
        isDraggingSource ? "is-dragging-source" : "",
        isMovable ? "is-movable" : ""
      ].join(" ")}
      aria-label={label}
      aria-pressed={isSelected}
      disabled={!card.faceUp}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      title={label}
    >
      <CardFace card={card} />
    </button>
  );
}

interface CardFaceProps {
  card: Card;
}

interface PipPlacement {
  area: string;
  inverted?: boolean;
  emphasis?: boolean;
}

const PIP_LAYOUTS: Partial<Record<Rank, PipPlacement[]>> = {
  1: [{ area: "3 / 2", emphasis: true }],
  2: [
    { area: "2 / 2" },
    { area: "4 / 2", inverted: true }
  ],
  3: [
    { area: "2 / 2" },
    { area: "3 / 2" },
    { area: "4 / 2", inverted: true }
  ],
  4: [
    { area: "2 / 1" },
    { area: "2 / 3" },
    { area: "4 / 1", inverted: true },
    { area: "4 / 3", inverted: true }
  ],
  5: [
    { area: "2 / 1" },
    { area: "2 / 3" },
    { area: "3 / 2" },
    { area: "4 / 1", inverted: true },
    { area: "4 / 3", inverted: true }
  ],
  6: [
    { area: "1 / 1" },
    { area: "1 / 3" },
    { area: "3 / 1" },
    { area: "3 / 3" },
    { area: "5 / 1", inverted: true },
    { area: "5 / 3", inverted: true }
  ],
  7: [
    { area: "1 / 1" },
    { area: "1 / 3" },
    { area: "2 / 2" },
    { area: "3 / 1" },
    { area: "3 / 3" },
    { area: "5 / 1", inverted: true },
    { area: "5 / 3", inverted: true }
  ],
  8: [
    { area: "1 / 1" },
    { area: "1 / 3" },
    { area: "2 / 2" },
    { area: "3 / 1" },
    { area: "3 / 3" },
    { area: "4 / 2", inverted: true },
    { area: "5 / 1", inverted: true },
    { area: "5 / 3", inverted: true }
  ],
  9: [
    { area: "1 / 1" },
    { area: "1 / 3" },
    { area: "2 / 2" },
    { area: "3 / 1" },
    { area: "3 / 2" },
    { area: "3 / 3" },
    { area: "4 / 2", inverted: true },
    { area: "5 / 1", inverted: true },
    { area: "5 / 3", inverted: true }
  ],
  10: [
    { area: "1 / 1" },
    { area: "1 / 3" },
    { area: "2 / 1" },
    { area: "2 / 3" },
    { area: "3 / 1" },
    { area: "3 / 3" },
    { area: "4 / 1", inverted: true },
    { area: "4 / 3", inverted: true },
    { area: "5 / 1", inverted: true },
    { area: "5 / 3", inverted: true }
  ]
};

const COURT_NAMES = {
  11: "jack",
  12: "queen",
  13: "king"
} as const;

const COURT_LABELS = {
  11: "JACK",
  12: "QUEEN",
  13: "KING"
} as const;

export function CardFace({ card }: CardFaceProps) {
  if (!card.faceUp) {
    return <span className="card__back-mark" aria-hidden="true" />;
  }

  const symbol = suitSymbol(card.suit);

  return (
    <span className="card__face">
      <CardCorner rank={card.rank} symbol={symbol} />
      <span className="card__center">
        {isCourtRank(card.rank) ? (
          <CourtCard rank={card.rank} suit={card.suit} symbol={symbol} />
        ) : (
          <PipCard rank={card.rank} symbol={symbol} />
        )}
      </span>
      <CardCorner rank={card.rank} symbol={symbol} isBottom />
    </span>
  );
}

function CardCorner({ rank, symbol, isBottom = false }: { rank: Rank; symbol: string; isBottom?: boolean }) {
  return (
    <span className={["card__corner", isBottom ? "card__corner--bottom" : ""].join(" ")}>
      <span className="card__rank">{rankLabel(rank)}</span>
      <span className="card__corner-suit">{symbol}</span>
    </span>
  );
}

function PipCard({ rank, symbol }: { rank: Rank; symbol: string }) {
  const placements = PIP_LAYOUTS[rank] ?? [];

  return (
    <span className={["card__pips", `card__pips--rank-${rank}`].join(" ")} aria-hidden="true">
      {placements.map((pip, index) => (
        <span
          key={`${rank}-${index}`}
          className={[
            "card__pip",
            pip.inverted ? "card__pip--inverted" : "",
            pip.emphasis ? "card__pip--emphasis" : ""
          ].join(" ")}
          style={rank === 1 ? undefined : ({ gridArea: pip.area } as CSSProperties)}
        >
          {symbol}
        </span>
      ))}
    </span>
  );
}

function CourtCard({ rank, suit, symbol }: { rank: 11 | 12 | 13; suit: Suit; symbol: string }) {
  const name = COURT_NAMES[rank];

  return (
    <span className={["card__court", `card__court--${name}`, `card__court--${suit}`].join(" ")} aria-hidden="true">
      <svg
        className={["card__court-art", `card__court-art--${name}`].join(" ")}
        viewBox="0 0 100 136"
        focusable="false"
      >
        <rect className="card__court-panel" x="4" y="6" width="92" height="124" rx="14" />
        <path className="card__court-robe" d="M24 113c6-25 18-38 26-38s20 13 26 38c-12 7-40 7-52 0Z" />
        <path className="card__court-sash" d="M35 80c12 15 23 26 39 34" />
        <circle className="card__court-face" cx="50" cy="57" r="18" />
        <path className="card__court-hair" d={hairPathFor(rank)} />
        {rank === 13 ? <path className="card__court-gold" d="M28 41 36 20l14 16 14-16 8 21H28Z" /> : null}
        {rank === 12 ? (
          <>
            <path className="card__court-gold" d="M31 41 39 27l11 12 11-12 8 14H31Z" />
            <path className="card__court-gem" d="M50 23 57 31 50 39 43 31Z" />
          </>
        ) : null}
        {rank === 11 ? (
          <>
            <path className="card__court-gold" d="M33 39c10-23 29-22 35-5-13-8-25-6-35 5Z" />
            <path className="card__court-plume" d="M64 31c13-18 22-17 20-1-8-5-13-4-20 1Z" />
          </>
        ) : null}
        <text className="card__court-symbol card__court-symbol--top" x="50" y="25">
          {symbol}
        </text>
        <text className="card__court-title" x="50" y="104">
          {COURT_LABELS[rank]}
        </text>
        <text className="card__court-symbol card__court-symbol--bottom" x="50" y="123">
          {symbol}
        </text>
      </svg>
    </span>
  );
}

function hairPathFor(rank: 11 | 12 | 13): string {
  if (rank === 13) {
    return "M30 58c2-20 38-20 40 0-4-12-36-12-40 0Z";
  }

  if (rank === 12) {
    return "M30 59c4-19 36-19 40 0-6-9-12-14-20-14s-14 5-20 14Z";
  }

  return "M32 58c2-15 28-23 38-3-9-4-21-1-38 3Z";
}

function isCourtRank(rank: Rank): rank is 11 | 12 | 13 {
  return rank >= 11;
}
