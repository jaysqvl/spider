import { describe, expect, it } from "vitest";
import {
  buildDevReleaseBody,
  buildStableReleaseBody,
  compareReleaseTags,
  compareUrl,
  formatCommitList,
  latestStableTag,
  parseReleaseTag,
  previousReleaseTag,
  sortedReleaseTags
} from "./release-notes.mjs";

describe("release notes", () => {
  it("parses and sorts semver release tags", () => {
    const tags = sortedReleaseTags(["dev-latest", "v0.1.10", "v0.1.9", "v0.1.10-beta.1"]);

    expect(tags.map(({ tag }) => tag)).toEqual(["v0.1.9", "v0.1.10-beta.1", "v0.1.10"]);
    expect(
      compareReleaseTags(parseReleaseTag("v0.1.10"), parseReleaseTag("v0.1.10-beta.1"))
    ).toBeGreaterThan(0);
  });

  it("finds previous release and latest stable tags", () => {
    const tags = ["v0.1.4", "v0.1.5", "dev-latest", "v0.1.6-beta.1", "v0.1.6"];

    expect(previousReleaseTag(tags, "v0.1.6")).toBe("v0.1.6-beta.1");
    expect(latestStableTag(tags)).toBe("v0.1.6");
  });

  it("formats commit lists with hashes", () => {
    expect(formatCommitList([{ hash: "abc1234", subject: "fix: tighten tableau scaling" }])).toEqual([
      "- fix: tighten tableau scaling (abc1234)"
    ]);
    expect(formatCommitList([])).toEqual(["- No code changes in this range."]);
  });

  it("builds stable release notes with downloads and compare link", () => {
    const body = buildStableReleaseBody({
      tag: "v0.1.6",
      previousTag: "v0.1.5",
      repository: "jaysqvl/spider",
      commits: [{ hash: "b6879e2", subject: "fix: fit tableau within resized windows" }]
    });

    expect(body).toContain("## What's Changed");
    expect(body).toContain("- fix: fit tableau within resized windows (b6879e2)");
    expect(body).toContain("https://github.com/jaysqvl/spider/compare/v0.1.5...v0.1.6");
    expect(body).toContain("windows-x64 NSIS EXE");
  });

  it("builds dev release notes from the latest stable baseline", () => {
    const body = buildDevReleaseBody({
      version: "0.1.7-dev.3.1",
      stableTag: "v0.1.6",
      head: "abc123def456",
      repository: "jaysqvl/spider",
      commits: [{ hash: "ee00fe3", subject: "fix: handle windows dev release lockfile rewrites" }]
    });

    expect(body).toContain("Changes since v0.1.6:");
    expect(body).toContain("- fix: handle windows dev release lockfile rewrites (ee00fe3)");
    expect(body).toContain("https://github.com/jaysqvl/spider/compare/v0.1.6...abc123def456");
    expect(body).toContain("Spider Dev 0.1.7-dev.3.1");
  });

  it("omits compare links when no base tag exists", () => {
    expect(compareUrl({ repository: "jaysqvl/spider", base: null, head: "HEAD" })).toBeNull();
  });
});
