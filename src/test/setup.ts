import "@testing-library/jest-dom/vitest";

if (!window.PointerEvent) {
  window.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
}
