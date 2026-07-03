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

function readPipGeometry(pip: Element) {
  const transform = pip.getAttribute("transform") ?? "";
  const translate = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform);

  if (!translate) {
    throw new Error(`Missing pip translate transform: ${transform}`);
  }

  return {
    x: Number(translate[1]),
    y: Number(translate[2]),
    size: Number(pip.getAttribute("data-suit-size"))
  };
}

describe("CardView", () => {
  it("renders numeric cards with the matching number of suit pips", () => {
    const { container } = renderCard(card(2, "hearts"));

    expect(screen.getByRole("button", { name: "2 of hearts" })).toBeInTheDocument();
    const pips = Array.from(container.querySelectorAll(".card__pip"));

    expect(pips).toHaveLength(2);
    expect(pips.every((pip) => pip.classList.contains("card__suit-mark"))).toBe(true);
    expect(pips.every((pip) => pip.querySelector("path, circle"))).toBe(true);
  });

  it("keeps dense number cards readable with individual pips", () => {
    const { container } = renderCard(card(10, "spades"));
    const firstPip = container.querySelector(".card__pip");
    const firstCornerSuit = container.querySelector(".card__corner-suit");

    expect(screen.getByRole("button", { name: "10 of spades" })).toBeInTheDocument();
    expect(container.querySelectorAll(".card__pip")).toHaveLength(10);
    expect(container.querySelectorAll(".card__corner-suit")).toHaveLength(2);
    expect(Number(firstPip?.getAttribute("data-suit-size"))).toBeGreaterThan(
      Number(firstCornerSuit?.getAttribute("data-suit-size"))
    );
  });

  it("uses the same side-by-side index geometry for full and covered card states", () => {
    const { container } = renderCard(card(10, "hearts"));
    const cornerRank = container.querySelector(".card__rank");
    const cornerSuit = container.querySelector(".card__corner-suit");
    const stackRank = container.querySelector(".card__stack-rank");
    const stackSuit = container.querySelector(".card__stack-suit");

    expect(cornerRank).toHaveAttribute("x", stackRank?.getAttribute("x"));
    expect(cornerRank).toHaveAttribute("y", stackRank?.getAttribute("y"));
    expect(cornerRank).toHaveAttribute("font-size", stackRank?.getAttribute("font-size"));
    expect(cornerRank).toHaveAttribute("text-anchor", "start");
    expect(cornerSuit).toHaveAttribute("transform", stackSuit?.getAttribute("transform"));
    expect(cornerSuit).toHaveAttribute("data-suit-size", stackSuit?.getAttribute("data-suit-size"));
  });

  it("renders a compact stack index for covered tableau cards", () => {
    const { container } = renderCard(card(10, "hearts"));
    const stackIndex = container.querySelector(".card__stack-index");
    const stackSuit = container.querySelector(".card__stack-suit");

    expect(stackIndex).toBeInTheDocument();
    expect(stackIndex).toHaveTextContent("10");
    expect(stackSuit).toHaveAttribute("data-suit-size", "13");
    expect(stackSuit?.getAttribute("transform")).toContain("translate(39 18)");
  });

  it("spaces dense 9 and 10 suit pips without visual collisions", () => {
    for (const rank of [9, 10] as const) {
      const { container, unmount } = renderCard(card(rank, "spades"));
      const pips = Array.from(container.querySelectorAll(".card__pip")).map(readPipGeometry);

      expect(pips).toHaveLength(rank);

      for (let firstIndex = 0; firstIndex < pips.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < pips.length; secondIndex += 1) {
          const first = pips[firstIndex];
          const second = pips[secondIndex];
          const distance = Math.hypot(first.x - second.x, first.y - second.y);

          expect(distance).toBeGreaterThanOrEqual(Math.min(first.size, second.size) * 0.9);
        }
      }

      unmount();
    }
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
