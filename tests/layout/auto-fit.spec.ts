import { expect, test, type Page } from "@playwright/test";

interface ViewportCase {
  name: string;
  width: number;
  height: number;
  minCardWidth: number;
  minTableauCoverage?: number;
  expectedLayout?: "bottom" | "side";
  maxTallestColumnRatio?: number;
  minTallestFaceUpReveal?: number;
}

interface RectSnapshot {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface LayoutSnapshot {
  layout: string;
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  cardWidth: number;
  renderedCardWidth: number;
  columnCount: number;
  cardCount: number;
  tableauCoverage: number;
  surface: RectSnapshot;
  tableau: RectSnapshot;
  resource: RectSnapshot;
  foundation: RectSnapshot;
  stock: RectSnapshot;
  leftActions: RectSnapshot;
  rightActions: RectSnapshot;
  leftmostColumn: number;
  rightmostColumn: number;
  topmostCard: number;
  bottommostCard: number;
  tallestColumnHeight: number;
  tallestColumnMinFaceUpReveal: number;
  foundationDirection: string;
}

const VIEWPORTS: ViewportCase[] = [
  { name: "standard-desktop", width: 1440, height: 900, minCardWidth: 96, minTableauCoverage: 0.68 },
  { name: "ultrawide-short", width: 2048, height: 872, minCardWidth: 110, minTableauCoverage: 0.62 },
  { name: "ultrawide-very-short", width: 2560, height: 760, minCardWidth: 96, minTableauCoverage: 0.48 },
  {
    name: "diagnostic-ultrawide-short",
    width: 2827,
    height: 680,
    minCardWidth: 118,
    minTallestFaceUpReveal: 25
  },
  {
    name: "diagnostic-snapped-short",
    width: 1295,
    height: 680,
    minCardWidth: 112,
    expectedLayout: "bottom",
    maxTallestColumnRatio: 1,
    minTallestFaceUpReveal: 22
  },
  { name: "tall-desktop", width: 900, height: 1180, minCardWidth: 56 },
  { name: "tight-desktop", width: 900, height: 720, minCardWidth: 56 },
  {
    name: "narrow-hidden-run",
    width: 1024,
    height: 768,
    minCardWidth: 68,
    expectedLayout: "bottom",
    maxTallestColumnRatio: 0.92
  }
];

test("keeps auto-fit tableau and resource dock stable across desktop resize shapes", async ({ page }) => {
  await page.goto("/");
  await loadScenario(page, "hidden-king-to-two");

  const firstUltrawide = await captureViewport(page, VIEWPORTS[1]);

  for (const viewport of VIEWPORTS) {
    const snapshot = viewport.name === VIEWPORTS[1].name ? firstUltrawide : await captureViewport(page, viewport);

    assertPlayableGeometry(snapshot, viewport);
  }

  await captureViewport(page, VIEWPORTS[3]);
  const repeatedUltrawide = await captureViewport(page, VIEWPORTS[1]);

  expect(repeatedUltrawide.layout).toBe(firstUltrawide.layout);
  expect(repeatedUltrawide.cardWidth).toBeCloseTo(firstUltrawide.cardWidth, 0);
  expect(repeatedUltrawide.tableauCoverage).toBeCloseTo(firstUltrawide.tableauCoverage, 1);
});

test("keeps the resource dock out of the tableau and action buttons", async ({ page }) => {
  await page.goto("/");
  await loadScenario(page, "resource-rail");

  for (const viewport of VIEWPORTS) {
    const snapshot = await captureViewport(page, viewport);

    assertPlayableGeometry(snapshot, viewport);
    assertResourceDockPlacement(snapshot);
  }
});

test("settles resource dock layout at the ultrawide threshold", async ({ page }) => {
  await page.goto("/");
  await loadScenario(page, "hidden-king-to-two");
  await page.setViewportSize({ width: 2001, height: 860 });
  await settleLayout(page);

  const samples = await page.evaluate(async () => {
    const frames: Array<{ layout: string; cardWidth: string }> = [];

    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const surface = document.querySelector<HTMLElement>(".play-surface");
      frames.push({
        layout: surface?.dataset.controlLayout ?? "missing",
        cardWidth: getComputedStyle(document.documentElement).getPropertyValue("--card-fit-width").trim()
      });
    }

    return frames;
  });
  const trailingSamples = samples.slice(-12);
  const sequence = samples.map((sample) => `${sample.layout}:${sample.cardWidth}`).join(" -> ");

  expect(new Set(trailingSamples.map((sample) => sample.layout)).size, sequence).toBe(1);
  expect(trailingSamples[0]?.layout, sequence).not.toBe("missing");
  expect(new Set(trailingSamples.map((sample) => sample.cardWidth)).size, sequence).toBe(1);
});

async function loadScenario(page: Page, scenarioId: string): Promise<void> {
  await page.getByRole("button", { name: "Testing" }).click();
  await expect(page.getByRole("dialog", { name: "Testing" })).toBeVisible();
  await page.getByLabel("Stress state").selectOption(scenarioId);
  await page.getByRole("button", { name: "Load State" }).click();
  await expect(page.getByText(/^Dev state loaded:/)).toBeVisible();
}

async function captureViewport(page: Page, viewport: ViewportCase): Promise<LayoutSnapshot> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await settleLayout(page);

  const snapshot = await page.evaluate(readLayoutSnapshot);

  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: `test-results/layout-${test.info().titlePath.at(-1)}-${viewport.name}.png`
  });

  return snapshot;
}

async function settleLayout(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--card-fit-width").trim().endsWith("px")
  );

  for (let frame = 0; frame < 4; frame += 1) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
}

function assertPlayableGeometry(snapshot: LayoutSnapshot, viewport: ViewportCase): void {
  expect.soft(snapshot.viewportWidth, viewport.name).toBe(viewport.width);
  expect.soft(snapshot.viewportHeight, viewport.name).toBe(viewport.height);
  expect.soft(snapshot.columnCount, viewport.name).toBe(10);
  expect.soft(snapshot.cardCount, viewport.name).toBeGreaterThan(20);
  expect.soft(snapshot.scrollWidth, viewport.name).toBeLessThanOrEqual(viewport.width + 1);
  expect.soft(snapshot.scrollHeight, viewport.name).toBeLessThanOrEqual(viewport.height + 1);
  expect.soft(snapshot.cardWidth, viewport.name).toBeGreaterThanOrEqual(viewport.minCardWidth);
  expect.soft(snapshot.renderedCardWidth, viewport.name).toBeGreaterThanOrEqual(viewport.minCardWidth);
  expect.soft(snapshot.renderedCardWidth, viewport.name).toBeCloseTo(snapshot.cardWidth, 0);
  expect.soft(snapshot.leftmostColumn, viewport.name).toBeGreaterThanOrEqual(snapshot.surface.left - 1);
  expect.soft(snapshot.rightmostColumn, viewport.name).toBeLessThanOrEqual(snapshot.surface.right + 1);
  expect.soft(snapshot.topmostCard, viewport.name).toBeGreaterThanOrEqual(snapshot.tableau.top - 1);
  expect.soft(snapshot.bottommostCard, viewport.name).toBeLessThanOrEqual(snapshot.tableau.bottom + 1);

  if (viewport.minTableauCoverage !== undefined) {
    expect.soft(snapshot.tableauCoverage, viewport.name).toBeGreaterThanOrEqual(viewport.minTableauCoverage);
  }

  if (viewport.expectedLayout !== undefined) {
    expect.soft(snapshot.layout, viewport.name).toBe(viewport.expectedLayout);
  }

  if (viewport.maxTallestColumnRatio !== undefined) {
    expect
      .soft(snapshot.tallestColumnHeight, viewport.name)
      .toBeLessThanOrEqual(snapshot.tableau.height * viewport.maxTallestColumnRatio);
  }

  if (viewport.minTallestFaceUpReveal !== undefined) {
    expect
      .soft(snapshot.tallestColumnMinFaceUpReveal, viewport.name)
      .toBeGreaterThanOrEqual(viewport.minTallestFaceUpReveal);
  }
}

function assertResourceDockPlacement(snapshot: LayoutSnapshot): void {
  if (snapshot.layout === "side") {
    expect.soft(snapshot.resource.left).toBeGreaterThanOrEqual(snapshot.rightmostColumn + 6);
    expect.soft(snapshot.resource.right).toBeLessThanOrEqual(snapshot.surface.right + 1);
    expect.soft(snapshot.resource.bottom).toBeLessThanOrEqual(snapshot.rightActions.top - 6);
    return;
  }

  expect.soft(snapshot.resource.top).toBeGreaterThanOrEqual(snapshot.tableau.bottom - 1);
  expect.soft(Math.min(snapshot.foundation.left, snapshot.stock.left)).toBeGreaterThanOrEqual(snapshot.leftActions.right - 1);
  expect.soft(Math.max(snapshot.foundation.right, snapshot.stock.right)).toBeLessThanOrEqual(snapshot.rightActions.left + 1);
  expect.soft(snapshot.stock.bottom).toBeGreaterThanOrEqual(snapshot.rightActions.top);
  expect.soft(snapshot.stock.bottom).toBeLessThanOrEqual(snapshot.surface.bottom + 1);
  expect.soft(snapshot.foundationDirection).toBe("row");
}

function readLayoutSnapshot(): LayoutSnapshot {
  const requiredElement = <ElementType extends Element>(selector: string): ElementType => {
    const element = document.querySelector<ElementType>(selector);

    if (!element) {
      throw new Error(`Expected ${selector} to exist.`);
    }

    return element;
  };
  const rectSnapshot = (element: Element): RectSnapshot => {
    const rect = element.getBoundingClientRect();

    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  };
  const surface = requiredElement<HTMLElement>(".play-surface");
  const tableau = requiredElement<HTMLElement>(".tableau");
  const resource = requiredElement<HTMLElement>(".board-resource-zone");
  const stock = requiredElement<HTMLElement>(".stock-zone");
  const foundation = requiredElement<HTMLElement>(".foundation-zone");
  const leftActions = requiredElement<HTMLElement>(".board-actions--left");
  const rightActions = requiredElement<HTMLElement>(".board-actions--right");
  const columns = Array.from(document.querySelectorAll<HTMLElement>(".tableau-column"));
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".tableau-card"));
  const columnRects = columns.map((column) => rectSnapshot(column));
  const cardRects = cards.map((card) => rectSnapshot(card));
  const columnCardHeights = columns.map((column) => {
    const rects = Array.from(column.querySelectorAll<HTMLElement>(".tableau-card")).map((card) => card.getBoundingClientRect());

    if (rects.length === 0) {
      return 0;
    }

    return Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top));
  });
  const tallestColumnIndex = columnCardHeights.indexOf(Math.max(...columnCardHeights));
  const tallestColumnCards = Array.from(
    columns[tallestColumnIndex]?.querySelectorAll<HTMLElement>(".tableau-card") ?? []
  );
  const tallestColumnFaceUpReveals = tallestColumnCards
    .slice(1)
    .map((card, index) => ({
      card,
      exposedCard: tallestColumnCards[index]
    }))
    .filter(({ exposedCard }) => exposedCard?.dataset.cardFaceUp === "true")
    .map(({ card }) => Number.parseFloat(card.style.getPropertyValue("--card-reveal")))
    .filter((value) => Number.isFinite(value));
  const leftmostColumn = Math.min(...columnRects.map((rect) => rect.left));
  const rightmostColumn = Math.max(...columnRects.map((rect) => rect.right));
  const topmostCard = Math.min(...cardRects.map((rect) => rect.top));
  const bottommostCard = Math.max(...cardRects.map((rect) => rect.bottom));
  const cardFitWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-fit-width"));

  return {
    layout: surface.dataset.controlLayout ?? "bottom",
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    cardWidth: cardFitWidth,
    renderedCardWidth: cardRects[0]?.width ?? 0,
    columnCount: columns.length,
    cardCount: cards.length,
    tableauCoverage: (rightmostColumn - leftmostColumn) / rectSnapshot(surface).width,
    surface: rectSnapshot(surface),
    tableau: rectSnapshot(tableau),
    resource: rectSnapshot(resource),
    foundation: rectSnapshot(foundation),
    stock: rectSnapshot(stock),
    leftActions: rectSnapshot(leftActions),
    rightActions: rectSnapshot(rightActions),
    leftmostColumn,
    rightmostColumn,
    topmostCard,
    bottommostCard,
    tallestColumnHeight: Math.max(...columnCardHeights),
    tallestColumnMinFaceUpReveal:
      tallestColumnFaceUpReveals.length > 0 ? Math.min(...tallestColumnFaceUpReveals) : Number.POSITIVE_INFINITY,
    foundationDirection: getComputedStyle(foundation).flexDirection
  };
}
