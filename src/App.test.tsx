import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { applyAutoFitScale } from "./App";
import type { Card, GameState, Rank, Suit } from "./game/types";
import { DEFAULT_SETTINGS } from "./persistence/types";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-game-scale");
    document.documentElement.removeAttribute("data-game-scale-mode");
    document.documentElement.removeAttribute("data-motion");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("style");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it("starts on the playable Spider game screen", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Spider" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Deal stock" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tableau")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-column-index]")).toHaveLength(10);
    expect(container.querySelector(".toolbar-hotspot")).toBeInTheDocument();
    expect(screen.queryByText(/Column \d+/)).not.toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.gameScale).toBe("100"));
    expect(document.documentElement.dataset.gameScaleMode).toBe("auto");
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-preferred-width"))).toBeCloseTo(119.6);
    expect(container.querySelector(".status-line")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("updates settings through the in-app settings dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    fireEvent.change(screen.getByLabelText("Game scale"), { target: { value: "80" } });
    expect(screen.getByLabelText("Auto fit to window")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    await waitFor(() => expect(document.documentElement.dataset.gameScale).toBe("80"));
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-preferred-width"))).toBeCloseTo(95.68);
  });

  it("can switch game scale out of auto fit mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByLabelText("Auto fit to window"));

    await waitFor(() => expect(document.documentElement.dataset.gameScaleMode).toBe("manual"));
  });

  it("caps auto-fit card width to the visible viewport", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 900, configurable: true },
      clientHeight: { value: 360, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 520, configurable: true });
    surface.style.paddingLeft = "4px";
    surface.style.paddingRight = "4px";
    surface.style.paddingTop = "6px";
    surface.style.paddingBottom = "6px";
    surface.style.rowGap = "8px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "2px");

    applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, gameWithRun());

    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(49);
    surface.remove();
  });

  it("opens the toolbar intentionally and closes it after a delay", async () => {
    const { container } = render(<App />);

    await screen.findByLabelText("Tableau");
    vi.useFakeTimers();
    const hotspot = container.querySelector<HTMLElement>(".toolbar-hotspot");
    const toolbar = container.querySelector<HTMLElement>(".app-toolbar");

    expect(hotspot).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(toolbar).not.toHaveClass("is-open");

    fireEvent.pointerEnter(hotspot!);
    fireEvent.pointerLeave(hotspot!);
    act(() => vi.advanceTimersByTime(120));
    expect(toolbar).not.toHaveClass("is-open");

    fireEvent.pointerEnter(hotspot!);
    act(() => vi.advanceTimersByTime(120));
    expect(toolbar).toHaveClass("is-open");

    fireEvent.pointerLeave(toolbar!);
    act(() => vi.advanceTimersByTime(2399));
    expect(toolbar).toHaveClass("is-open");

    act(() => vi.advanceTimersByTime(1));
    expect(toolbar).not.toHaveClass("is-open");
    vi.useRealTimers();
  });

  it("renders scalable rank and suit labels on face-up cards", async () => {
    const { container } = render(<App />);

    await screen.findByLabelText("Tableau");
    const faceUpCard = container.querySelector(".card--face-up");

    expect(faceUpCard?.querySelectorAll(".card__rank").length).toBe(2);
    expect(faceUpCard?.querySelectorAll(".card__corner-suit").length).toBe(2);
  });

  it("surfaces update checks from settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "About" })).not.toBeInTheDocument();
  });

  it("keeps primary toolbar commands labeled for readability", async () => {
    render(<App />);

    const newGame = await screen.findByRole("button", { name: "New Game" });
    const restart = screen.getByRole("button", { name: "Restart" });

    expect(newGame).not.toHaveClass("icon-button--compact");
    expect(restart).not.toHaveClass("icon-button--compact");
    expect(newGame).toHaveAttribute("title", "New Game");
    expect(newGame).toHaveTextContent("New Game");
    expect(screen.getByLabelText("Application actions")).toBeInTheDocument();
    expect(screen.getByLabelText("Application actions")).toHaveClass("utility-actions");
    expect(screen.getByLabelText("Application actions")).not.toHaveClass("utility-dock");
  });

  it("explains that browser previews cannot install desktop updates", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Check for Updates" }));

    expect(await screen.findByText(/installed Spider desktop app/)).toBeInTheDocument();
  });

  it("shows the whole selected run as a drag preview", async () => {
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithRun()));
    render(<App />);

    await screen.findByText("Saved game resumed.");
    const queen = await screen.findByRole("button", { name: "Q of spades" });
    expect(screen.getByRole("button", { name: "J of spades" })).toBeInTheDocument();
    vi.spyOn(queen, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 90,
      bottom: 130,
      width: 80,
      height: 110,
      toJSON: () => ({})
    });

    await act(async () => {
      queen.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 30
        })
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 80,
          clientY: 120
        })
      );
    });

    const preview = await screen.findByTestId("drag-preview");
    expect(preview.querySelectorAll(".drag-preview__card")).toHaveLength(2);
    expect(preview).toHaveStyle("transform: translate3d(70px, 110px, 0)");
  });

  it("animates stock cards into each tableau column", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await screen.findByText("New game ready.");
    await user.click(screen.getByRole("button", { name: "Deal stock" }));

    await waitFor(() => expect(container.querySelectorAll(".tableau-card.is-dealt-card")).toHaveLength(10));
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".tableau-card.is-dealt-card")).map(
        (card) => card.dataset.dealAnimationOrder
      )
    ).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });
});

let nextCardId = 0;

function gameWithRun(): GameState {
  const now = new Date().toISOString();

  return {
    stateVersion: 1,
    difficulty: "one-suit",
    seed: "ui-drag-run",
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    tableau: [
      [card(12), card(11)],
      [card(13)],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ],
    stock: [],
    completed: [],
    score: 500,
    moves: 0,
    status: "playing",
    undoStack: [],
    redoStack: []
  };
}

function card(rank: Rank, suit: Suit = "spades"): Card {
  nextCardId += 1;

  return {
    id: `ui-card-${nextCardId}`,
    rank,
    suit,
    faceUp: true
  };
}
