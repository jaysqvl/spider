import type { MouseEvent, PointerEvent } from "react";
import { rankLabel, suitSymbol } from "../game/engine";
import type { Card } from "../game/types";
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
      {card.faceUp ? (
        <>
          <span className="card__corner">
            <span>{rankLabel(card.rank)}</span>
            <span>{suitSymbol(card.suit)}</span>
          </span>
          <span className="card__suit" aria-hidden="true">
            {suitSymbol(card.suit)}
          </span>
          <span className="card__corner card__corner--bottom">
            <span>{rankLabel(card.rank)}</span>
            <span>{suitSymbol(card.suit)}</span>
          </span>
        </>
      ) : (
        <span className="card__back-mark" aria-hidden="true" />
      )}
    </button>
  );
}
