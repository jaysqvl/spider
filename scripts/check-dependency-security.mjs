import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { expand } from "brace-expansion";
import { minimatch } from "minimatch";
import { nanoid } from "nanoid";
import { nanoid as postcssId } from "nanoid/non-secure";
import { SourceMapConsumer, SourceMapGenerator } from "source-map-js";
import { JSDOM } from "jsdom";
import { MockAgent } from "undici";

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

test("jsdom's HTTP dispatcher preserves redirects, cookies, and resource errors", { timeout: 5000 }, async (t) => {
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  t.after(() => dispatcher.close());
  const origin = "https://spider-test.invalid";
  const client = dispatcher.get(origin);
  client.intercept({ path: "/start", method: "GET" }).reply(302, "", {
    headers: { location: "/board", "set-cookie": "mode=one-suit; Path=/" },
  });
  client.intercept({ path: "/board", method: "GET" }).reply(200,
    "<!doctype html><title>Spider</title><button>New game</button>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  client.intercept({ path: "/unavailable", method: "GET" }).reply(503, "Unavailable");
  const options = { resources: { dispatcher } };
  const dom = await JSDOM.fromURL(`${origin}/start`, options);
  t.after(() => dom.window.close());
  assert.equal(dom.window.location.href, `${origin}/board`);
  assert.equal(dom.window.document.title, "Spider");
  assert.equal(dom.window.document.querySelector("button").textContent, "New game");
  assert.equal(dom.window.document.cookie, "mode=one-suit");
  await assert.rejects(JSDOM.fromURL(`${origin}/unavailable`, options), /Status: 503/);
  await assert.rejects(JSDOM.fromURL(`${origin}/not-mocked`, options), {
    code: "UND_MOCK_ERR_MOCK_NOT_MATCHED",
  });
  dispatcher.assertNoPendingInterceptors();
});

const basicMap = () => ({
  version: 3,
  sources: ["input.js"],
  sourcesContent: ["const value = 1;"],
  names: [],
  mappings: "AAAA",
});

function indexedMap(line, column = 0, map = basicMap()) {
  return { version: 3, sections: [{ offset: { line, column }, map }] };
}

test("indexed source maps reject non-integer and non-numeric section offsets", () => {
  // GHSA-68fv-2mgg-jv7q: unsafe offsets amplify work when maps are flattened.
  const invalid = [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    "1", null, undefined, {}];
  for (const value of invalid) {
    for (const field of ["line", "column"]) {
      const map = indexedMap(0);
      map.sections[0].offset[field] = value;
      assert.throws(() => new SourceMapConsumer(map), /non-negative integers/,
        `${field}=${String(value)}`);
    }
  }
});

test("indexed source maps reject excessive direct and cumulative line offsets", () => {
  assert.throws(() => new SourceMapConsumer(indexedMap(10_000_001)), /must not exceed/);
  const inner = indexedMap(5_000_000);
  const atLimit = indexedMap(5_000_000, 0, inner);
  const valid = new SourceMapConsumer(atLimit);
  const generatedLines = [];
  valid.eachMapping((mapping) => generatedLines.push(mapping.generatedLine));
  assert.deepEqual(generatedLines, [10_000_001]);
  assert.throws(() => new SourceMapConsumer(indexedMap(1, 0, atLimit)),
    /including offsets of nested sections/);
});

test("nested source lookup reads the underlying sources only once", () => {
  let map = basicMap();
  for (let depth = 0; depth < 12; depth++) map = indexedMap(0, 0, map);
  const consumer = new SourceMapConsumer(map);
  let inner = consumer;
  for (let depth = 0; depth < 12; depth++) inner = inner._sections[0].consumer;
  const sources = inner.sources;
  let reads = 0;
  Object.defineProperty(inner, "sources", { get() { reads++; return sources; } });
  assert.deepEqual(consumer.sources, ["input.js"]);
  assert.equal(reads, 1);
});

test("ordinary nested source maps still flatten and round-trip correctly", () => {
  const consumer = new SourceMapConsumer(indexedMap(2, 0, indexedMap(3)));
  const generator = new SourceMapGenerator();
  consumer.eachMapping((mapping) => generator.addMapping({
    generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
    original: { line: mapping.originalLine, column: mapping.originalColumn },
    source: mapping.source,
  }));
  for (const source of consumer.sources) {
    generator.setSourceContent(source, consumer.sourceContentFor(source));
  }
  const restored = new SourceMapConsumer(generator.toJSON());
  assert.deepEqual(restored.originalPositionFor({ line: 6, column: 0 }), {
    source: "input.js", line: 1, column: 0, name: null,
  });
  assert.equal(restored.sourceContentFor("input.js"), "const value = 1;");
});
