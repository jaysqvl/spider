import { render, screen } from "@testing-library/react";
import { CardView } from "./CardView";
import type { Card, Rank, Suit } from "../game/types";

function renderCard(card: Card) {
  return render(
    <CardView
      card={card}
      cardBack="spruce"
      isSelected={false}
      isHinted={false}
      isDraggingSource={false}
      isMovable={false}
      onClick={vi.fn()}
      onMouseDown={vi.fn()}
      onPointerDown={vi.fn()}
    />
  );
}

function card(rank: Rank, suit: Suit, faceUp = true): Card {
  return {
    id: `${suit}-${rank}`,
    rank,
    suit,
    faceUp
  };
}

describe("CardView", () => {
  it("renders numeric cards with the matching number of suit pips", () => {
    const { container } = renderCard(card(2, "hearts"));

    expect(screen.getByRole("button", { name: "2 of hearts" })).toBeInTheDocument();
    const pips = Array.from(container.querySelectorAll(".card__pip"));

    expect(pips).toHaveLength(2);
    expect(pips.every((pip) => pip.textContent === "♥")).toBe(true);
  });

  it("keeps dense number cards readable with individual pips", () => {
    const { container } = renderCard(card(10, "spades"));

    expect(screen.getByRole("button", { name: "10 of spades" })).toBeInTheDocument();
    expect(container.querySelectorAll(".card__pip")).toHaveLength(10);
    expect(container.querySelectorAll(".card__corner-suit")).toHaveLength(2);
  });

  it("renders original court artwork for face cards", () => {
    const { container } = renderCard(card(13, "clubs"));

    expect(screen.getByRole("button", { name: "K of clubs" })).toBeInTheDocument();
    expect(container.querySelector(".card__court")).toHaveClass("card__court--king");
    expect(container.querySelector(".card__court-art--king")).toBeInTheDocument();
    expect(container.querySelectorAll(".card__pip")).toHaveLength(0);
  });

  it("renders the selected card back for face-down cards", () => {
    const { container } = renderCard(card(7, "diamonds", false));

    expect(screen.getByRole("button", { name: "Face-down card" })).toBeDisabled();
    expect(container.querySelector(".card--back-spruce")).toBeInTheDocument();
    expect(container.querySelector(".card__back-mark")).toBeInTheDocument();
  });
});
