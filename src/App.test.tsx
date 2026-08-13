import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, {
  applyAutoFitScale,
  getBoardControlLayout,
  getColumnCardReveals,
  resolveAutoFitLayout,
  shouldEnableDevTools
} from "./App";
import type { Card, GameState, Rank, Suit } from "./game/types";
import { DEFAULT_SETTINGS } from "./persistence/types";
import packageJson from "../package.json";

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-game-scale");
    document.documentElement.removeAttribute("data-game-scale-mode");
    document.documentElement.removeAttribute("data-motion");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-card-face");
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts on the playable Spider game screen", async () => {
    const { container } = render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Spider" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Deal stock" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tableau")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-column-index]")).toHaveLength(10);
    expect(container.querySelector(".game-topbar")).toBeInTheDocument();
    expect(container.querySelector(".board-actions--left")).toBeInTheDocument();
    expect(container.querySelector(".board-actions--right")).toBeInTheDocument();
    expect(container.querySelector(".board-resource-zone")).toBeInTheDocument();
    expect(container.querySelector(".foundation-zone")).toBeInTheDocument();
    expect(container.querySelectorAll(".foundation")).toHaveLength(1);
    expect(screen.getByLabelText("Spades completed sequences: 0 of 8")).toHaveTextContent("0/8");
    expect(screen.queryByLabelText("Empty completed sequence slot")).not.toBeInTheDocument();
    expect(screen.queryByText(/Column \d+/)).not.toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.gameScale).toBe("100"));
    expect(document.documentElement.dataset.gameScaleMode).toBe("auto");
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-preferred-width"))).toBeCloseTo(119.6);
    expect(container.querySelector(".score-strip")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("sr-only");
  });

  it("gates testing tools to local dev mode and the dev release channel", () => {
    expect(shouldEnableDevTools({ DEV: true })).toBe(true);
    expect(shouldEnableDevTools({ DEV: false, VITE_SPIDER_DEV_TOOLS: "true" })).toBe(true);
    expect(shouldEnableDevTools({ DEV: false })).toBe(false);
  });

  it("loads dev-only stress states from the Testing panel", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(await screen.findByRole("button", { name: "Testing" }));
    expect(await screen.findByRole("dialog", { name: "Testing" })).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Stress state"), "hidden-king-to-two");
    await user.click(screen.getByRole("button", { name: "Load State" }));

    expect(await screen.findByText("Dev state loaded: Hidden + K-to-2 vertical run.")).toBeInTheDocument();
    await waitFor(() => {
      const firstColumn = container.querySelector('[data-column-index="0"]');

      expect(firstColumn?.querySelectorAll(".tableau-card")).toHaveLength(16);
      expect(firstColumn?.querySelector('[aria-label="K of spades"]')).toBeInTheDocument();
    });
  });

  it("exports dev diagnostics with viewport, layout, game, and log data", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Testing" }));
    expect(await screen.findByRole("dialog", { name: "Testing" })).toBeInTheDocument();
    expect(screen.getByText("Debug Data")).toBeInTheDocument();
    expect(screen.getByText("Web UI")).toBeInTheDocument();
    expect(screen.getByText("1024 x 768")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Stress state"), "hidden-king-to-two");
    await user.click(screen.getByRole("button", { name: "Load State" }));
    expect(await screen.findByText("Dev state loaded: Hidden + K-to-2 vertical run.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Testing" }));
    await user.click(await screen.findByRole("button", { name: "Copy Report" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const report = JSON.parse(writeText.mock.calls.at(-1)?.[0] as string) as {
      diagnostics: {
        viewport: { innerWidth: number; innerHeight: number; devicePixelRatio: number };
        layout: { controlLayout: string; cardCount: number };
        game: { seed: string; tableauHeights: number[] };
      };
      logs: Array<{ event: string }>;
    };

    expect(report.diagnostics.viewport).toMatchObject({
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1.5
    });
    expect(report.diagnostics.layout.controlLayout).toMatch(/bottom|side/);
    expect(report.diagnostics.layout.cardCount).toBeGreaterThan(0);
    expect(report.diagnostics.game.seed).toBe("dev:hidden-king-to-two");
    expect(report.diagnostics.game.tableauHeights[0]).toBe(16);
    expect(report.logs.some((entry) => entry.event === "dev.state.load")).toBe(true);
    expect(report.logs.some((entry) => entry.event === "dev.state.applied")).toBe(true);
  });

  it("summarizes completed sequences by active suit", async () => {
    const game = {
      ...gameWithRun(),
      difficulty: "two-suit" as const,
      completed: [
        { id: "spades-1", suit: "spades" as const, removedAtMove: 4 },
        { id: "hearts-1", suit: "hearts" as const, removedAtMove: 7 },
        { id: "hearts-2", suit: "hearts" as const, removedAtMove: 12 }
      ]
    };
    localStorage.setItem("spider.activeGame", JSON.stringify(game));

    const { container } = render(<App />);

    await screen.findByText("Saved game resumed.");
    expect(container.querySelectorAll(".foundation")).toHaveLength(2);
    expect(screen.getByLabelText("Spades completed sequences: 1 of 4")).toHaveTextContent("1/4");
    expect(screen.getByLabelText("Hearts completed sequences: 2 of 4")).toHaveTextContent("2/4");
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
    expect(document.documentElement.dataset.cardFace).toBe("dark");
    await waitFor(() => expect(document.documentElement.dataset.gameScale).toBe("80"));
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-preferred-width"))).toBeCloseTo(95.68);
  });

  it("lets card faces match the app theme or use an explicit override", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    await waitFor(() => expect(document.documentElement.dataset.cardFace).toBe("dark"));

    await user.selectOptions(screen.getByLabelText("Card face"), "classic");
    await waitFor(() => expect(document.documentElement.dataset.cardFace).toBe("light"));

    await user.selectOptions(screen.getByLabelText("Card face"), "dark");
    await waitFor(() => expect(document.documentElement.dataset.cardFace).toBe("dark"));
  });

  it("can switch game scale out of auto fit mode", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByLabelText("Auto fit to window"));

    await waitFor(() => expect(document.documentElement.dataset.gameScaleMode).toBe("manual"));
  });

  it("trusts measured play-surface size during native viewport churn", () => {
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

    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(87);
    surface.remove();
  });

  it("lets auto-fit cards grow on wide boards when height allows it", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 2200, configurable: true },
      clientHeight: { value: 1200, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 2200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1200, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "18px";
    surface.style.paddingBottom = "18px";
    surface.style.rowGap = "18px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, gameWithTallColumn(6));

    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(143);
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-stack-visible-ratio"))).toBe(0.28);
    surface.remove();
  });

  it("lets full ultrawide boards grow beyond the default desktop cap", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 3440, configurable: true },
      clientHeight: { value: 1271, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 3440, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1271, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "92px";
    surface.style.paddingBottom = "124px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, undefined, undefined, "side");

    expect(metrics?.availableHeight).toBe(1053);
    expect(metrics?.cardWidth).toBe(176);
    surface.remove();
  });

  it("uses the measured tableau lane when fitting auto-scale height", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    Object.defineProperties(surface, {
      clientWidth: { value: 1800, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    Object.defineProperties(tableau, {
      clientWidth: { value: 1800, configurable: true },
      clientHeight: { value: 250, configurable: true }
    });
    vi.spyOn(tableau, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1800,
      bottom: 250,
      width: 1800,
      height: 250,
      toJSON: () => ({})
    });
    Object.defineProperty(window, "innerWidth", { value: 1800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "80px";
    surface.style.paddingBottom = "220px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(
      surface,
      { ...DEFAULT_SETTINGS, gameScaleMode: "auto" },
      gameWithTallColumn(16),
      tableau
    );

    expect(metrics?.availableHeight).toBe(248);
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(69);
    surface.remove();
  });

  it("balances ultrawide card growth against the visible tableau height", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    Object.defineProperties(surface, {
      clientWidth: { value: 2200, configurable: true },
      clientHeight: { value: 820, configurable: true }
    });
    Object.defineProperties(tableau, {
      clientWidth: { value: 2200, configurable: true },
      clientHeight: { value: 520, configurable: true }
    });
    vi.spyOn(tableau, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 2200,
      bottom: 520,
      width: 2200,
      height: 520,
      toJSON: () => ({})
    });
    Object.defineProperty(window, "innerWidth", { value: 2200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 820, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, undefined, tableau);

    expect(metrics?.availableHeight).toBe(518);
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(119);
    surface.remove();
  });

  it("limits ultrawide card growth for a readable king-to-two run with hidden cards", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    Object.defineProperties(surface, {
      clientWidth: { value: 2200, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    Object.defineProperties(tableau, {
      clientWidth: { value: 2200, configurable: true },
      clientHeight: { value: 806, configurable: true }
    });
    vi.spyOn(tableau, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 2200,
      bottom: 806,
      width: 2200,
      height: 806,
      toJSON: () => ({})
    });
    Object.defineProperty(window, "innerWidth", { value: 2200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, undefined, tableau);
    const column = hiddenKingToTwoColumn();
    const reveals = getColumnCardReveals(
      column,
      metrics ?? { cardWidth: null, stackVisibleRatio: 0.28, availableHeight: null }
    );
    const visibleHeight = (metrics?.cardWidth ?? 0) * 1.38 + sumRevealPx(reveals);
    const faceUpReveals = reveals.slice(5).map((reveal) => reveal ?? 0);

    expect(metrics?.cardWidth).toBe(133);
    expect(visibleHeight).toBeLessThanOrEqual((metrics?.availableHeight ?? 0) + 0.5);
    expect(Math.min(...faceUpReveals)).toBeGreaterThanOrEqual(24);
    surface.remove();
  });

  it("keeps short ultrawide boards from shrinking every card for a hidden king-to-two run", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 2827, configurable: true },
      clientHeight: { value: 680, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 2827, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 680, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "80px";
    surface.style.paddingBottom = "115px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" });
    const reveals = getColumnCardReveals(
      hiddenKingToTwoColumn(),
      metrics ?? { cardWidth: null, stackVisibleRatio: 0.28, availableHeight: null }
    );
    const visibleHeight = (metrics?.cardWidth ?? 0) * 1.38 + sumRevealPx(reveals);
    const faceUpReveals = reveals.slice(5).map((reveal) => reveal ?? 0);

    expect(metrics?.availableHeight).toBe(483);
    expect(metrics?.cardWidth).toBe(119);
    expect(visibleHeight).toBeLessThanOrEqual(483.5);
    expect(Math.min(...faceUpReveals)).toBeGreaterThanOrEqual(26);
    surface.remove();
  });

  it("trades width for readable stack bands on snapped short boards", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 1295, configurable: true },
      clientHeight: { value: 680, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 1295, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 680, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "80px";
    surface.style.paddingBottom = "160px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const metrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" });
    const reveals = getColumnCardReveals(
      hiddenKingToTwoColumn(),
      metrics ?? { cardWidth: null, stackVisibleRatio: 0.28, availableHeight: null }
    );
    const visibleHeight = (metrics?.cardWidth ?? 0) * 1.38 + sumRevealPx(reveals);
    const faceUpReveals = reveals.slice(5).map((reveal) => reveal ?? 0);

    expect(metrics?.availableHeight).toBe(438);
    expect(metrics?.cardWidth).toBe(114);
    expect(visibleHeight).toBeLessThanOrEqual(438.5);
    expect(Math.min(...faceUpReveals)).toBeGreaterThanOrEqual(22);
    surface.remove();
  });

  it("keeps snapped short boards readable without over-condensing hidden king-to-two runs", () => {
    const metrics = {
      cardWidth: 114,
      stackVisibleRatio: 0.28,
      availableHeight: 437
    };
    const reveals = getColumnCardReveals(hiddenKingToTwoColumn(), metrics);
    const visibleHeight = metrics.cardWidth * 1.38 + sumRevealPx(reveals);
    const hiddenReveals = reveals.slice(1, 5).map((reveal) => reveal ?? 0);
    const faceUpReveals = reveals.slice(5).map((reveal) => reveal ?? 0);

    expect(visibleHeight).toBeLessThanOrEqual(metrics.availableHeight + 0.5);
    expect(Math.max(...hiddenReveals)).toBeLessThan(Math.min(...faceUpReveals));
    expect(Math.min(...faceUpReveals)).toBeGreaterThanOrEqual(22);
  });

  it("reserves a right-side resource rail when side controls are active", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 1800, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 1800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const bottomMetrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, undefined, tableau);
    const sideMetrics = applyAutoFitScale(
      surface,
      { ...DEFAULT_SETTINGS, gameScaleMode: "auto" },
      undefined,
      tableau,
      "side"
    );

    expect(bottomMetrics?.cardWidth).toBe(127);
    expect(sideMetrics?.cardWidth).toBe(127);
    surface.remove();
  });

  it("uses the side rail when it preserves the rendered card width", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 1800, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const resolved = resolveAutoFitLayout(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, "bottom", tableau);

    expect(resolved?.controlLayout).toBe("side");
    expect(resolved?.metrics.cardWidth).toBe(127);
    expect(document.documentElement.style.getPropertyValue("--card-fit-width")).toBe("");
    surface.remove();
  });

  it("uses the side rail only when the bottom-fit tableau leaves real dead space", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 3000, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 3000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);
    document.documentElement.style.setProperty("--tableau-gap", "12px");

    const resolved = resolveAutoFitLayout(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, "bottom", tableau);

    expect(resolved?.controlLayout).toBe("side");
    expect(resolved?.metrics.cardWidth).toBe(150);
    surface.remove();
  });

  it("places resources in the side rail only when the tableau and dock fit together", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 2048, configurable: true },
      clientHeight: { value: 760, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 2048, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 760, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);

    expect(getBoardControlLayout(surface, { cardWidth: 160, stackVisibleRatio: 0.28, availableHeight: 574 })).toBe(
      "side"
    );
    expect(getBoardControlLayout(surface, { cardWidth: 175, stackVisibleRatio: 0.28, availableHeight: 631 })).toBe(
      "bottom"
    );
    surface.remove();
  });

  it("uses a deterministic resource dock layout at resize thresholds", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 2048, configurable: true },
      clientHeight: { value: 760, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 2048, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 760, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    document.body.append(surface);
    surface.append(tableau);

    const metrics = { cardWidth: 172, stackVisibleRatio: 0.28, availableHeight: 600 };

    expect(getBoardControlLayout(surface, metrics, "bottom")).toBe("bottom");
    expect(getBoardControlLayout(surface, metrics, "side")).toBe("bottom");
    surface.remove();
  });

  it("does not let the rendered dock layout feed back into ultrawide auto-fit decisions", () => {
    const surface = document.createElement("section");
    const tableau = document.createElement("div");
    tableau.className = "tableau";
    tableau.style.columnGap = "12px";
    Object.defineProperties(surface, {
      clientWidth: { value: 2001, configurable: true },
      clientHeight: { value: 860, configurable: true }
    });
    Object.defineProperties(tableau, {
      clientWidth: { value: 1757, configurable: true },
      clientHeight: { value: 578, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 2001, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 860, configurable: true });
    surface.style.paddingLeft = "18px";
    surface.style.paddingRight = "18px";
    surface.style.paddingTop = "80px";
    surface.style.paddingBottom = "113px";
    document.body.append(surface);
    surface.append(tableau);

    const resolvedFromSideDom = resolveAutoFitLayout(
      surface,
      { ...DEFAULT_SETTINGS, gameScaleMode: "auto" },
      "side",
      tableau
    );

    Object.defineProperty(tableau, "clientHeight", { value: 667, configurable: true });

    const resolvedFromBottomDom = resolveAutoFitLayout(
      surface,
      { ...DEFAULT_SETTINGS, gameScaleMode: "auto" },
      "bottom",
      tableau
    );

    expect(resolvedFromSideDom?.controlLayout).toBe(resolvedFromBottomDom?.controlLayout);
    expect(resolvedFromSideDom?.metrics).toEqual(resolvedFromBottomDom?.metrics);
    surface.remove();
  });

  it("keeps global auto-fit stable when only tableau stack heights change", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 1200, configurable: true },
      clientHeight: { value: 760, configurable: true }
    });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 760, configurable: true });
    surface.style.paddingLeft = "12px";
    surface.style.paddingRight = "12px";
    surface.style.paddingTop = "12px";
    surface.style.paddingBottom = "12px";
    surface.style.rowGap = "12px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "8px");

    const shortMetrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, gameWithTallColumn(6));
    const tallMetrics = applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, gameWithTallColumn(22));

    expect(tallMetrics).toEqual(shortMetrics);
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(shortMetrics?.cardWidth);
    surface.remove();
  });

  it("uses measured play-surface height instead of transient viewport height", () => {
    const surface = document.createElement("section");
    Object.defineProperties(surface, {
      clientWidth: { value: 1200, configurable: true },
      clientHeight: { value: 900, configurable: true }
    });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 110,
      left: 0,
      top: 110,
      right: 1200,
      bottom: 1010,
      width: 1200,
      height: 900,
      toJSON: () => ({})
    });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 360, configurable: true });
    surface.style.paddingLeft = "4px";
    surface.style.paddingRight = "4px";
    surface.style.paddingTop = "6px";
    surface.style.paddingBottom = "6px";
    surface.style.rowGap = "8px";
    document.body.append(surface);
    document.documentElement.style.setProperty("--tableau-gap", "4px");

    applyAutoFitScale(surface, { ...DEFAULT_SETTINGS, gameScaleMode: "auto" }, gameWithTallColumn(16));

    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-fit-width"))).toBe(115);
    expect(parseFloat(document.documentElement.style.getPropertyValue("--card-stack-visible-ratio"))).toBe(0.28);
    surface.remove();
  });

  it("moves clicked automatic runs without requiring layout animation", async () => {
    const user = userEvent.setup();

    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithRun()));

    const { container } = render(<App />);

    await screen.findByText("Saved game resumed.");
    await user.click(screen.getByRole("button", { name: "Q of spades" }));

    expect(await screen.findByText("Move completed.")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('[data-column-index="1"]')?.querySelectorAll(".card")).toHaveLength(3)
    );
  });

  it("animates moved cards into their destination stack", async () => {
    const user = userEvent.setup();
    const { animateSpy, restore } = mockElementAnimate();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => window.clearTimeout(handle));
    mockTableauCardRects();
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithRun()));

    try {
      render(<App />);

      await screen.findByText("Saved game resumed.");
      await user.click(screen.getByRole("button", { name: "Q of spades" }));

      await waitFor(() => expect(animateSpy).toHaveBeenCalledTimes(2));
      expect(animateSpy.mock.calls[0][0]).toEqual([
        { transform: expect.stringContaining("translate3d(") },
        { transform: "translate3d(0, 0, 0)" }
      ]);
      expect(animateSpy.mock.calls[0][1]).toMatchObject({
        duration: 260,
        easing: "cubic-bezier(0.2, 0.82, 0.2, 1)"
      });
    } finally {
      restore();
    }
  });

  it("keeps the destination card face visible until the incoming move settles", async () => {
    const { animateSpy, restore } = mockElementAnimate();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => window.clearTimeout(handle));
    mockTableauCardRects();
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithRun()));

    try {
      render(<App />);

      await screen.findByText("Saved game resumed.");
      fireEvent.click(screen.getByRole("button", { name: "Q of spades" }));

      const destinationCard = screen.getByRole("button", { name: "K of spades" }).closest(".tableau-card");
      const movedTopCard = screen.getByRole("button", { name: "Q of spades" }).closest(".tableau-card");

      expect(destinationCard).toHaveClass("is-covered", "is-cover-detail-held");
      expect(movedTopCard).toHaveClass("is-covered");
      expect(movedTopCard).not.toHaveClass("is-cover-detail-held");

      await waitFor(() => expect(animateSpy).toHaveBeenCalledTimes(2));

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 320));
      });
      expect(destinationCard).toHaveClass("is-covered");
      expect(destinationCard).not.toHaveClass("is-cover-detail-held");
    } finally {
      restore();
    }
  });

  it("keeps the table controls visible without a hover hotspot", async () => {
    const { container } = render(<App />);

    await screen.findByLabelText("Tableau");

    expect(container.querySelector(".toolbar-hotspot")).not.toBeInTheDocument();
    expect(container.querySelector(".app-toolbar")).not.toBeInTheDocument();
    expect(container.querySelector(".game-topbar")).toBeInTheDocument();
    expect(screen.getByLabelText("Quick actions")).toBeInTheDocument();
    expect(screen.getByLabelText("History actions")).toBeInTheDocument();
  });

  it("renders readable corners and rich face content on face-up cards", async () => {
    const { container } = render(<App />);

    await screen.findByLabelText("Tableau");
    const faceUpCard = Array.from(container.querySelectorAll<HTMLElement>(".card--face-up")).find((card) =>
      card.querySelector(".card__pip")
    );
    const cardFace = faceUpCard?.querySelector(".card__face");
    const cornerRank = faceUpCard?.querySelector(".card__rank");
    const cornerSuit = faceUpCard?.querySelector(".card__corner-suit");

    expect(cardFace?.tagName.toLowerCase()).toBe("svg");
    expect(faceUpCard?.querySelectorAll(".card__rank").length).toBe(2);
    expect(faceUpCard?.querySelectorAll(".card__corner-suit").length).toBe(2);
    expect(faceUpCard?.querySelector(".card__center")).toBeInTheDocument();
    expect(Number(cornerRank?.getAttribute("font-size"))).toBeGreaterThanOrEqual(17);
    expect(cornerSuit?.tagName.toLowerCase()).toBe("g");
    expect(Number(cornerSuit?.getAttribute("data-suit-size"))).toBeGreaterThanOrEqual(13);
    expect(Number(faceUpCard?.querySelector(".card__pip")?.getAttribute("data-suit-size"))).toBeGreaterThan(
      Number(cornerSuit?.getAttribute("data-suit-size"))
    );
    expect(container.querySelector(".card__pip path, .card__pip circle")).toBeInTheDocument();
  });

  it("layers stacked tableau cards so front cards cover cards behind them", async () => {
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithTallColumn(4)));
    const { container } = render(<App />);

    await screen.findByText("Saved game resumed.");

    const firstColumnCards = Array.from(
      container.querySelectorAll<HTMLElement>('[data-column-index="0"] .tableau-card')
    );

    expect(firstColumnCards.map((card) => card.style.getPropertyValue("--card-layer"))).toEqual([
      "0",
      "1",
      "2",
      "3"
    ]);
    expect(firstColumnCards.slice(0, -1).every((card) => card.classList.contains("is-covered"))).toBe(true);
    expect(firstColumnCards.at(-1)).not.toHaveClass("is-covered");
  });

  it("keeps face-up stacked ranks readable without changing neighboring reveal plans", async () => {
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithMixedStackVisibility()));
    const { container } = render(<App />);

    await screen.findByText("Saved game resumed.");
    const columns = Array.from(container.querySelectorAll<HTMLElement>(".tableau-column__cards"));
    const firstColumnReveals = Array.from(columns[0].querySelectorAll<HTMLElement>(".tableau-card")).map((card) =>
      readRevealPx(card.style.getPropertyValue("--card-reveal"))
    );
    const neighborColumnReveals = Array.from(columns[1].querySelectorAll<HTMLElement>(".tableau-card")).map((card) =>
      card.style.getPropertyValue("--card-reveal")
    );

    expect(firstColumnReveals[4]).toBeGreaterThan(firstColumnReveals[1]);
    expect(firstColumnReveals.slice(4).every((reveal) => reveal >= 46)).toBe(true);
    expect(neighborColumnReveals.slice(1).every((reveal) => reveal === neighborColumnReveals[1])).toBe(true);
  });

  it("uses comfortable face-up spacing when a stack has vertical room", () => {
    const metrics = {
      cardWidth: 119,
      stackVisibleRatio: 0.28,
      availableHeight: 700
    };
    const column = [card(13), card(12), card(11), card(10), card(9)];

    const reveals = getColumnCardReveals(column, metrics);
    const visibleHeight = metrics.cardWidth * 1.38 + sumRevealPx(reveals);

    expect(visibleHeight).toBeLessThan(metrics.availableHeight);
    expect(Math.min(...reveals.slice(1).map((reveal) => reveal ?? 0))).toBeGreaterThanOrEqual(46);
  });

  it("keeps ultrawide covered card indexes readable", () => {
    const metrics = {
      cardWidth: 175,
      stackVisibleRatio: 0.28,
      availableHeight: 760
    };
    const column = Array.from({ length: 10 }, (_, index) => card((((index + 2) % 13) + 1) as Rank));

    const reveals = getColumnCardReveals(column, metrics);

    expect(Math.min(...reveals.slice(1).map((reveal) => reveal ?? 0))).toBeGreaterThanOrEqual(48);
  });

  it("compresses very tall columns to fit the measured tableau lane", () => {
    const metrics = {
      cardWidth: 106,
      stackVisibleRatio: 0.28,
      availableHeight: 472
    };
    const tallColumn = [
      ...Array.from({ length: 4 }, (_, index) => card(((index % 13) + 1) as Rank, "spades", false)),
      ...Array.from({ length: 18 }, (_, index) => card((((index + 4) % 13) + 1) as Rank, "hearts", true))
    ];

    const reveals = getColumnCardReveals(tallColumn, metrics);
    const visibleHeight = metrics.cardWidth * 1.38 + sumRevealPx(reveals);

    expect(visibleHeight).toBeLessThanOrEqual(metrics.availableHeight + 0.5);
    expect(Math.min(...reveals.slice(1).map((reveal) => reveal ?? 0))).toBeGreaterThanOrEqual(14);
  });

  it("caps compact hidden runs before they consume the entire tableau lane", () => {
    const metrics = {
      cardWidth: 69,
      stackVisibleRatio: 0.28,
      availableHeight: 593
    };
    const hiddenKingToTwo = hiddenKingToTwoColumn();

    const reveals = getColumnCardReveals(hiddenKingToTwo, metrics);
    const visibleHeight = metrics.cardWidth * 1.38 + sumRevealPx(reveals);
    const faceUpReveals = reveals.slice(5).map((reveal) => reveal ?? 0);

    expect(visibleHeight).toBeLessThanOrEqual(metrics.availableHeight * 0.87);
    expect(Math.min(...faceUpReveals)).toBeGreaterThanOrEqual(24);
  });

  it("surfaces update checks from settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Check for Updates" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "About" })).not.toBeInTheDocument();
  });

  it("keeps primary board commands labeled for readability", async () => {
    render(<App />);

    const newGame = await screen.findByRole("button", { name: "New Game" });
    const restart = screen.getByRole("button", { name: "Restart" });

    expect(newGame).not.toHaveClass("icon-button--compact");
    expect(restart).not.toHaveClass("icon-button--compact");
    expect(newGame).toHaveAttribute("title", "New Game");
    expect(newGame).toHaveTextContent("New Game");
    expect(screen.getByLabelText("Application actions")).toBeInTheDocument();
    expect(screen.getByLabelText("Application actions")).toHaveClass("game-topbar__utilities");
    expect(screen.getByLabelText("Application actions")).not.toHaveClass("utility-dock");
  });

  it("explains that browser previews cannot install desktop updates", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Check for Updates" }));

    expect(await screen.findByText("Update check unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText("Notifications")).toHaveTextContent(/installed Spider desktop app/);
  });

  it("keeps restart playable when local persistence writes fail", async () => {
    const user = userEvent.setup();
    const playedGame = {
      ...gameWithRun(),
      moves: 1,
      score: 499
    };
    localStorage.setItem("spider.activeGame", JSON.stringify(playedGame));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItemSpy = failStorageWrites("spider.activeGame", "spider.stats");

    render(<App />);

    await screen.findByText("Saved game resumed.");
    await user.click(screen.getByRole("button", { name: "Restart" }));

    expect(await screen.findByText("1 Suit game restarted.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tableau")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("restarts with the newly selected difficulty", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("New game ready.");
    await user.selectOptions(screen.getByLabelText("Difficulty"), "four-suit");
    await user.click(screen.getByRole("button", { name: "Restart" }));

    expect(await screen.findByText("4 Suits game restarted.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spider" }).nextElementSibling).toHaveTextContent("4 Suits");
  });

  it("starts the newly selected difficulty even when settings persistence fails", async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItemSpy = failStorageWrites("spider.activeGame", "spider.settings");

    render(<App />);

    await screen.findByText("New game ready.");
    await user.selectOptions(screen.getByLabelText("Difficulty"), "four-suit");
    await user.click(screen.getByRole("button", { name: "New Game" }));

    expect(await screen.findByText("4 Suits game started.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spider" }).nextElementSibling).toHaveTextContent("4 Suits");
    expect(warnSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("shows lifetime points and fun aggregate stats", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "spider.stats",
      JSON.stringify({
        rollups: [
          {
            scope: "all",
            difficulty: "all",
            gamesPlayed: 3,
            gamesWon: 2,
            gamesAbandoned: 1,
            bestScore: 650,
            bestTimeMs: 90_000,
            totalScore: 1680,
            totalMoves: 123,
            totalElapsedMs: 300_000
          },
          {
            scope: "difficulty",
            difficulty: "one-suit",
            gamesPlayed: 3,
            gamesWon: 2,
            gamesAbandoned: 1,
            bestScore: 650,
            bestTimeMs: 90_000,
            totalScore: 1680,
            totalMoves: 123,
            totalElapsedMs: 300_000
          }
        ]
      })
    );

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Stats" }));

    expect(screen.getByText("Lifetime Points").parentElement).toHaveTextContent("1,680");
    expect(screen.getByText("Average Points").parentElement).toHaveTextContent("560");
    expect(screen.getByText("Win Rate").parentElement).toHaveTextContent("67%");
    expect(screen.getByText("Moves Made").parentElement).toHaveTextContent("123");
    expect(screen.getByText("Time Played").parentElement).toHaveTextContent("5:00");
    expect(screen.getByRole("columnheader", { name: "Points" })).toBeInTheDocument();
  });

  it("shows clean version and copyright metadata in the about dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "About" }));

    expect(screen.getByText("A simple, low-clutter Spider Solitaire game for desktop play.")).toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText(packageJson.version)).toBeInTheDocument();
    expect(screen.getByText("Copyright 2026 Jay Esquivel.")).toBeInTheDocument();
    expect(screen.queryByText(/independent Spider Solitaire app/)).not.toBeInTheDocument();
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
    expect(preview.querySelectorAll(".card__court")).toHaveLength(2);
    expect(preview).toHaveStyle("transform: translate3d(70px, 110px, 0)");
  });

  it("moves a clicked run to the best fitting tableau column", async () => {
    const user = userEvent.setup();
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithRun()));
    const { container } = render(<App />);

    await screen.findByText("Saved game resumed.");
    await user.click(screen.getByRole("button", { name: "Q of spades" }));

    expect(await screen.findByText("Move completed.")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('[data-column-index="1"]')?.querySelectorAll(".card")).toHaveLength(3)
    );
    expect(container.querySelector('[data-column-index="0"]')?.querySelectorAll(".card")).toHaveLength(0);
  });

  it("highlights incompatible attached cards when a clicked card cannot move", async () => {
    const user = userEvent.setup();
    localStorage.setItem("spider.activeGame", JSON.stringify(gameWithBlockedRun()));
    render(<App />);

    await screen.findByText("Saved game resumed.");
    await user.click(screen.getByRole("button", { name: "Q of spades" }));

    expect(await screen.findByText("That card is pinned by incompatible attached cards.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Q of spades" })).toHaveClass("is-blocked-source");
    expect(screen.getByRole("button", { name: "J of hearts" })).toHaveClass(
      "is-blocked-attachment",
      "is-blocked-break"
    );
    expect(screen.getByRole("button", { name: "10 of hearts" })).toHaveClass("is-blocked-attachment");
    expect(screen.getByRole("button", { name: "10 of hearts" })).not.toHaveClass("is-blocked-break");
  });

  it("animates stock cards into each tableau column", async () => {
    const user = userEvent.setup();
    mockStockDealRects();
    const { container } = render(<App />);

    await screen.findByText("New game ready.");
    const previousTopCards = getTopTableauCards(container);
    await user.click(screen.getByRole("button", { name: "Deal stock" }));

    await waitFor(() => expect(container.querySelectorAll(".tableau-card.is-dealt-card")).toHaveLength(10));
    const dealtCards = Array.from(container.querySelectorAll<HTMLElement>(".tableau-card.is-dealt-card"));
    const firstCardFromX = readCssPixels(dealtCards[0].style.getPropertyValue("--deal-from-x"));
    const firstCardFromY = readCssPixels(dealtCards[0].style.getPropertyValue("--deal-from-y"));
    const lastCardFromX = readCssPixels(dealtCards[9].style.getPropertyValue("--deal-from-x"));
    const lastCardFromY = readCssPixels(dealtCards[9].style.getPropertyValue("--deal-from-y"));

    expect(dealtCards.map((card) => card.dataset.dealAnimationOrder)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9"
    ]);
    expect(previousTopCards).toHaveLength(10);
    expect(previousTopCards.every((card) => card.classList.contains("is-cover-detail-held"))).toBe(true);
    expect(firstCardFromX).toBeGreaterThan(lastCardFromX);
    expect(firstCardFromY).toBeGreaterThan(0);
    expect(lastCardFromY).toBeGreaterThan(0);
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

function gameWithBlockedRun(): GameState {
  return {
    ...gameWithRun(),
    seed: "ui-blocked-run",
    tableau: [
      [card(12, "spades"), card(11, "hearts"), card(10, "hearts")],
      [card(13)],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ]
  };
}

function gameWithTallColumn(count: number): GameState {
  return {
    ...gameWithRun(),
    tableau: [Array.from({ length: count }, (_, index) => card(((index % 13) + 1) as Rank)), [], [], [], [], [], [], [], [], []]
  };
}

function gameWithMixedStackVisibility(): GameState {
  return {
    ...gameWithRun(),
    tableau: [
      [
        card(5, "spades", false),
        card(6, "spades", false),
        card(7, "spades", false),
        card(8, "hearts"),
        card(7, "hearts"),
        card(6, "hearts"),
        card(5, "hearts")
      ],
      [card(2, "spades", false), card(3, "spades", false), card(4, "spades", false), card(5, "spades", false)],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ]
  };
}

function hiddenKingToTwoColumn(): Card[] {
  return [
    card(3, "spades", false),
    card(6, "spades", false),
    card(9, "spades", false),
    card(1, "spades", false),
    ...([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as Rank[]).map((rank) => card(rank, "spades"))
  ];
}

function card(rank: Rank, suit: Suit = "spades", faceUp = true): Card {
  nextCardId += 1;

  return {
    id: `ui-card-${nextCardId}`,
    rank,
    suit,
    faceUp
  };
}

function failStorageWrites(...keys: string[]) {
  const originalSetItem = Storage.prototype.setItem;

  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(
    this: Storage,
    key: string,
    value: string
  ) {
    if (keys.includes(key)) {
      throw new Error(`Blocked test write for ${key}.`);
    }

    return originalSetItem.call(this, key, value);
  });
}

function readRevealPx(value: string): number {
  if (value === "") {
    return 0;
  }

  const match = value.match(/^(\d+(?:\.\d+)?)px$/);

  expect(match).not.toBeNull();

  return Number(match?.[1]);
}

function readCssPixels(value: string): number {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);

  expect(match).not.toBeNull();

  return Number(match?.[1]);
}

function getTopTableauCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-column-index]")).flatMap((column) => {
    const cards = column.querySelectorAll<HTMLElement>(".tableau-card");
    const card = cards.item(cards.length - 1);

    return card ? [card] : [];
  });
}

function sumRevealPx(reveals: Array<number | undefined>): number {
  return reveals.slice(1).reduce<number>((total, reveal) => total + (reveal ?? 0), 0);
}

function mockElementAnimate() {
  const originalAnimate = HTMLElement.prototype.animate;
  const animateSpy = vi.fn().mockReturnValue({ finished: Promise.resolve() } as unknown as Animation);

  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animateSpy
  });

  return {
    animateSpy,
    restore: () => {
      if (originalAnimate) {
        Object.defineProperty(HTMLElement.prototype, "animate", {
          configurable: true,
          value: originalAnimate
        });
        return;
      }

      delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    }
  };
}

function mockTableauCardRects() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: HTMLElement
  ) {
    if (!this.classList.contains("tableau-card")) {
      return domRect(0, 0, 0, 0);
    }

    const columnIndex = Number.parseInt(
      this.closest<HTMLElement>("[data-column-index]")?.dataset.columnIndex ?? "0",
      10
    );
    const cardIndex = Array.from(this.parentElement?.children ?? []).indexOf(this);

    return domRect(24 + columnIndex * 112, 96 + Math.max(0, cardIndex) * 34, 92, 127);
  });
}

function mockStockDealRects() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
    this: HTMLElement
  ) {
    if (this.classList.contains("stock__deck")) {
      return domRect(1010, 650, 64, 86);
    }

    if (this.classList.contains("card")) {
      const columnIndex = Number.parseInt(
        this.closest<HTMLElement>("[data-column-index]")?.dataset.columnIndex ?? "0",
        10
      );

      return domRect(42 + columnIndex * 94, 210, 72, 99);
    }

    return domRect(0, 0, 0, 0);
  });
}

function domRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({})
  } as DOMRect;
}
