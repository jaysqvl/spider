import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");

describe("style invariants", () => {
  it("keeps completed sequences as suit-count summaries", () => {
    expect(appCss).toContain("--foundation-counter-width:");
    expect(appCss).toContain(".foundation__suit");
    expect(appCss).toContain(".foundation__count");
    expect(appCss).not.toContain(".foundation--back-spruce");
  });

  it("keeps dark card faces free of an inner inset outline", () => {
    expect(appCss).toContain(':root[data-card-face="dark"]');
    expect(appCss).toContain("--card-face-inset: transparent;");
  });
});
