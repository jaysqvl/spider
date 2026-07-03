import { memo, type MouseEvent, type PointerEvent } from "react";
import { rankLabel } from "../game/engine";
import type { Card, Rank, Suit } from "../game/types";
import type { CardBack } from "../persistence/types";

interface CardViewProps {
  card: Card;
  cardBack: CardBack;
  columnIndex?: number;
  cardIndex?: number;
  isSelected: boolean;
  isHinted: boolean;
  isDraggingSource: boolean;
  isMovable: boolean;
  isBlockedSource?: boolean;
  isBlockedAttachment?: boolean;
  isBlockedBreak?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}

export const CardView = memo(function CardView({
  card,
  cardBack,
  columnIndex,
  cardIndex,
  isSelected,
  isHinted,
  isDraggingSource,
  isMovable,
  isBlockedSource = false,
  isBlockedAttachment = false,
  isBlockedBreak = false,
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
        isMovable ? "is-movable" : "",
        isBlockedSource ? "is-blocked-source" : "",
        isBlockedAttachment ? "is-blocked-attachment" : "",
        isBlockedBreak ? "is-blocked-break" : ""
      ].join(" ")}
      aria-label={label}
      aria-pressed={isSelected}
      disabled={!card.faceUp}
      data-card-column-index={columnIndex}
      data-card-index={cardIndex}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      title={label}
    >
      <CardFace card={card} />
    </button>
  );
});

interface CardFaceProps {
  card: Card;
}

interface PipPlacement {
  x: number;
  y: number;
  size?: number;
  inverted?: boolean;
  emphasis?: boolean;
}

const PIP_LAYOUTS: Partial<Record<Rank, PipPlacement[]>> = {
  1: [{ x: 50, y: 72, emphasis: true }],
  2: [
    { x: 50, y: 45 },
    { x: 50, y: 99, inverted: true }
  ],
  3: [
    { x: 50, y: 43 },
    { x: 50, y: 72 },
    { x: 50, y: 101, inverted: true }
  ],
  4: [
    { x: 34, y: 43 },
    { x: 66, y: 43 },
    { x: 34, y: 101, inverted: true },
    { x: 66, y: 101, inverted: true }
  ],
  5: [
    { x: 34, y: 43 },
    { x: 66, y: 43 },
    { x: 50, y: 72 },
    { x: 34, y: 101, inverted: true },
    { x: 66, y: 101, inverted: true }
  ],
  6: [
    { x: 34, y: 41 },
    { x: 66, y: 41 },
    { x: 34, y: 72 },
    { x: 66, y: 72 },
    { x: 34, y: 103, inverted: true },
    { x: 66, y: 103, inverted: true }
  ],
  7: [
    { x: 34, y: 40 },
    { x: 66, y: 40 },
    { x: 50, y: 55 },
    { x: 34, y: 72 },
    { x: 66, y: 72 },
    { x: 34, y: 104, inverted: true },
    { x: 66, y: 104, inverted: true }
  ],
  8: [
    { x: 34, y: 40 },
    { x: 66, y: 40 },
    { x: 50, y: 56 },
    { x: 34, y: 72 },
    { x: 66, y: 72 },
    { x: 50, y: 88, inverted: true },
    { x: 34, y: 104, inverted: true },
    { x: 66, y: 104, inverted: true }
  ],
  9: [
    { x: 34, y: 38, size: 20 },
    { x: 66, y: 38, size: 20 },
    { x: 34, y: 60, size: 20 },
    { x: 66, y: 60, size: 20 },
    { x: 50, y: 72, size: 20 },
    { x: 34, y: 84, size: 20, inverted: true },
    { x: 66, y: 84, size: 20, inverted: true },
    { x: 34, y: 106, size: 20, inverted: true },
    { x: 66, y: 106, size: 20, inverted: true }
  ],
  10: [
    { x: 34, y: 37, size: 20 },
    { x: 66, y: 37, size: 20 },
    { x: 50, y: 52, size: 18 },
    { x: 34, y: 62, size: 20 },
    { x: 66, y: 62, size: 20 },
    { x: 34, y: 82, size: 20 },
    { x: 66, y: 82, size: 20 },
    { x: 50, y: 97, size: 18, inverted: true },
    { x: 34, y: 107, size: 20, inverted: true },
    { x: 66, y: 107, size: 20, inverted: true }
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

export const CardFace = memo(function CardFace({ card }: CardFaceProps) {
  if (!card.faceUp) {
    return <span className="card__back-mark" aria-hidden="true" />;
  }

  return (
    <svg className="card__face" viewBox="0 0 100 138" aria-hidden="true" focusable="false">
      <rect className="card__face-inset" x="2" y="2" width="96" height="134" rx="5" />
      <CardCorner rank={card.rank} suit={card.suit} />
      <StackIndex rank={card.rank} suit={card.suit} />
      <g className="card__center">
        {isCourtRank(card.rank) ? (
          <CourtCard rank={card.rank} suit={card.suit} />
        ) : (
          <PipCard rank={card.rank} suit={card.suit} />
        )}
      </g>
      <CardCorner rank={card.rank} suit={card.suit} isBottom />
    </svg>
  );
});

function CardCorner({ rank, suit, isBottom = false }: { rank: Rank; suit: Suit; isBottom?: boolean }) {
  const rankText = rankLabel(rank);
  const suitX = getIndexSuitX(rankText);

  return (
    <g className={["card__corner", isBottom ? "card__corner--bottom" : "card__corner--top"].join(" ")}>
      <text className="card__rank" x="9" y="18" fontSize="22" textAnchor="start">
        {rankText}
      </text>
      <SuitMark suit={suit} x={suitX} y={18} size={13} className="card__corner-suit" />
    </g>
  );
}

function StackIndex({ rank, suit }: { rank: Rank; suit: Suit }) {
  const rankText = rankLabel(rank);
  const suitX = getIndexSuitX(rankText);

  return (
    <g className="card__stack-index">
      <text className="card__stack-rank" x="9" y="18" fontSize="22">
        {rankText}
      </text>
      <SuitMark suit={suit} x={suitX} y={18} size={13} className="card__stack-suit" />
    </g>
  );
}

function getIndexSuitX(rankText: string): number {
  return rankText === "10" ? 39 : 32;
}

function PipCard({ rank, suit }: { rank: Rank; suit: Suit }) {
  const placements = PIP_LAYOUTS[rank] ?? [];

  return (
    <g className={["card__pips", `card__pips--rank-${rank}`].join(" ")}>
      {placements.map((pip, index) => (
        <SuitMark
          key={`${rank}-${index}`}
          suit={suit}
          className={[
            "card__pip",
            pip.inverted ? "card__pip--inverted" : "",
            pip.emphasis ? "card__pip--emphasis" : ""
          ].join(" ")}
          x={pip.x}
          y={pip.y}
          size={pip.size ?? (pip.emphasis ? 50 : 25)}
          inverted={pip.inverted}
        />
      ))}
    </g>
  );
}

function CourtCard({ rank, suit }: { rank: 11 | 12 | 13; suit: Suit }) {
  const name = COURT_NAMES[rank];

  return (
    <g className={["card__court", `card__court--${name}`, `card__court--${suit}`].join(" ")}>
      <g className={["card__court-art", `card__court-art--${name}`].join(" ")} transform="translate(16 23) scale(0.68)">
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
        <SuitMark suit={suit} x={50} y={24} size={15} className="card__court-symbol card__court-symbol--top" />
        <text className="card__court-title" x="50" y="104" fontSize="9">
          {COURT_LABELS[rank]}
        </text>
        <SuitMark
          suit={suit}
          x={50}
          y={123}
          size={15}
          inverted
          className="card__court-symbol card__court-symbol--bottom"
        />
      </g>
    </g>
  );
}

export function SuitMark({
  suit,
  x,
  y,
  size,
  inverted = false,
  className = ""
}: {
  suit: Suit;
  x: number;
  y: number;
  size: number;
  inverted?: boolean;
  className?: string;
}) {
  return (
    <g
      className={["card__suit-mark", className].filter(Boolean).join(" ")}
      data-suit-size={size}
      transform={`translate(${x} ${y}) ${inverted ? "rotate(180)" : ""} scale(${size / 100}) translate(-50 -50)`}
    >
      <SuitShape suit={suit} />
    </g>
  );
}

function SuitShape({ suit }: { suit: Suit }) {
  switch (suit) {
    case "hearts":
      return <path d="M50 86C42 74 14 58 14 34c0-14 10-23 22-23 7 0 12 4 14 11 2-7 7-11 14-11 12 0 22 9 22 23 0 24-28 40-36 52Z" />;
    case "diamonds":
      return <path d="M50 8 88 50 50 92 12 50Z" />;
    case "spades":
      return <path d="M50 10c-8 16-32 32-32 54 0 12 9 21 21 21 5 0 9-2 12-6-1 9-7 15-18 18h34c-11-3-17-9-18-18 3 4 7 6 12 6 12 0 21-9 21-21 0-22-24-38-32-54Z" />;
    case "clubs":
      return (
        <>
          <circle cx="50" cy="31" r="18" />
          <circle cx="31" cy="59" r="18" />
          <circle cx="69" cy="59" r="18" />
          <path d="M50 65c0 15-7 24-18 31h36c-11-7-18-16-18-31Z" />
        </>
      );
  }
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
