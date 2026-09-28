import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { expand } from "brace-expansion";
import { minimatch } from "minimatch";
import { nanoid } from "nanoid";
import { nanoid as postcssId } from "nanoid/non-secure";

test("ordinary glob expansion and minimatch file selection remain compatible", () => {
  const pattern = "src/{game,components}/**/*.{ts,tsx}";
  assert.deepEqual(expand(pattern), [
    "src/game/**/*.ts", "src/game/**/*.tsx",
    "src/components/**/*.ts", "src/components/**/*.tsx"
  ]);
  assert.deepEqual(expand("{01..03}"), ["01", "02", "03"]);
  assert.equal(minimatch("src/game/engine.ts", pattern), true);
  assert.equal(minimatch("src/components/CardView.tsx", pattern), true);
  assert.equal(minimatch("src/styles.css", pattern), false);
});

test("expansion and rewrites honor bounds without huge hostile allocations", () => {
  const input = "{" + "abcdefghij,".repeat(200) + "last}";
  const bounded = expand(input, { maxLength: 50 });
  assert.ok(bounded.length > 0);
  assert.ok(bounded.reduce((length, value) => length + value.length, 0) <= 50);
  // The trailing brace is intentional and matches upstream's benign control.
  assert.deepEqual(expand("{a},b}"), ["a}", "b"]);
  assert.deepEqual(expand("{a},b}", { maxRewrites: 0 }), ["{a},b}"]);
});

test("normal PostCSS IDs work and excessive ID requests fail safely", () => {
  assert.match(nanoid(), /^[A-Za-z0-9_-]{21}$/);
  assert.equal(nanoid(6).length, 6);
  assert.equal(postcssId(6).length, 6);
  assert.equal(nanoid(1024).length, 1024);
  assert.throws(() => nanoid(1025), /Wrong ID size/);
  assert.equal(nanoid().length, 21);
});

test("zero-size custom ID generation terminates", () => {
  // A child timeout turns an infinite-loop regression into a bounded failure.
  const result = execFileSync(process.execPath, ["--input-type=module", "-e",
    "import { customAlphabet } from 'nanoid'; process.stdout.write(JSON.stringify(customAlphabet('abc', 0)()));"
  ], { cwd: process.cwd(), timeout: 2000, encoding: "utf8" });
  assert.equal(JSON.parse(result), "");
});
