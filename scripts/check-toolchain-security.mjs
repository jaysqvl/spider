import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createServer, resolveConfig } from "vite";
import { createManualModuleSource, interceptorPlugin } from "@vitest/mocker/node";

async function exerciseManualMock(t, url, names, deferred = false) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__vitest_mocker__");
  const marker = Object.getOwnPropertyDescriptor(globalThis, "__spider_mock_injected__");
  const calls = [];
  const values = Object.fromEntries(names.map((name, index) => [name, index + 10]));
  const factory = deferred ? {
    ...Object.fromEntries(names.map((name) => [name, null])),
    __factoryPromise: Promise.resolve(values)
  } : values;
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "__vitest_mocker__", previous);
    else delete globalThis.__vitest_mocker__;
    if (marker) Object.defineProperty(globalThis, "__spider_mock_injected__", marker);
    else delete globalThis.__spider_mock_injected__;
  });
  globalThis.__spider_mock_injected__ = false;
  globalThis.__vitest_mocker__ = {
    getFactoryModule(value) { calls.push(value); return factory; }
  };
  // Evaluate only this synthetic, side-effect-free fixture. A vulnerable
  // generator turns the URL text into a harmless global marker assignment.
  const source = createManualModuleSource(url, names);
  const module = await import("data:text/javascript," + encodeURIComponent(source));
  await Promise.resolve();
  assert.deepEqual(calls, [url]);
  assert.equal(globalThis.__spider_mock_injected__, false);
  for (const name of names) assert.equal(module[name], values[name]);
}

test("manual mock URLs remain data rather than injected JavaScript", async (t) => {
  await exerciseManualMock(t, 'x"); globalThis.__spider_mock_injected__ = true; void("', ["value"]);
});

test("manual mocks preserve ordinary URLs and unusual export names", async (t) => {
  await exerciseManualMock(t, "/src/legitimate.js", ["normal", 'quote"name', "back\\slash"]);
});

test("deferred manual mock exports retain their legitimate values", async (t) => {
  await exerciseManualMock(t, "/src/deferred.js", ["normal", 'quote"name'], true);
});

test("redirect mocks reject both traversal separators while allowing in-root files", async () => {
  // Resolve macOS /var aliases and Windows short-name temp paths before Vite
  // applies its canonical allowlist; the legitimate control must be in-root.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "spider-mocker-")));
  try {
    const root = join(directory, "root");
    await mkdir(root);
    await writeFile(join(root, "inside.js"), "SYNTHETIC_INSIDE_ROOT");
    await writeFile(join(directory, "outside.js"), "SYNTHETIC_OUTSIDE_ROOT");
    const config = await resolveConfig({
      configFile: false, root, logLevel: "silent",
      server: { fs: { allow: [root] } }
    }, "serve");
    const handlers = new Map();
    const acknowledgements = [];
    const plugin = interceptorPlugin();
    // Use the real plugin's registration, normalization, Vite allowlist and
    // readFile sink; this unit fixture replaces only WebSocket transport.
    plugin.configureServer({
      config,
      ws: {
        on(event, handler) { handlers.set(event, handler); },
        send(event) { acknowledgements.push(event); }
      }
    });
    const register = handlers.get("vitest:interceptor:register");
    for (const [id, redirect] of [
      ["/slash", "traversal:../outside.js"],
      ["/backslash", "traversal:..\\outside.js"]
    ]) {
      register({ type: "redirect", raw: "", id, url: id, redirect });
      assert.equal(await plugin.load.handler(id), undefined);
    }
    register({
      type: "redirect", raw: "", id: "/legitimate", url: "/legitimate",
      redirect: "fixture:/inside.js"
    });
    assert.equal(await plugin.load.handler("/legitimate"), "SYNTHETIC_INSIDE_ROOT");
    assert.equal(acknowledgements.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Vite project imports never authorize a matching outside-root file",
  { skip: process.platform === "win32", timeout: 20000 }, async () => {
    // GHSA-rq7h-c2jc-7f22 is a non-Windows path-confusion bug. Both files are
    // disposable synthetic canaries, never real host or application data.
    const directory = await realpath(await mkdtemp(join(tmpdir(), "spider-vite-")));
    let server;
    try {
      const root = join(directory, "project");
      const outside = join(directory, "outside.js");
      const relative = outside.replace(/^\/+/, "");
      const decoy = join(root, relative);
      await mkdir(dirname(decoy), { recursive: true });
      await writeFile(outside, 'export const outside = "SYNTHETIC_OUTSIDE_ROOT";');
      await writeFile(decoy, 'export const inside = "SYNTHETIC_PROJECT_DECOY";');
      await writeFile(join(root, "entry.js"), 'import "./' + relative + '";');
      server = await createServer({
        configFile: false, root, cacheDir: join(directory, "cache"),
        logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false,
          watch: null, fs: { allow: [root] } }
      });
      await server.listen();
      const address = server.httpServer.address();
      const base = "http://127.0.0.1:" + address.port;
      const entry = await fetch(base + "/entry.js");
      assert.equal(entry.status, 200);
      const inRoot = await fetch(base + "/" + relative);
      assert.equal(inRoot.status, 200);
      assert.match(await inRoot.text(), /SYNTHETIC_PROJECT_DECOY/);
      for (const suffix of ["", "?raw"]) {
        const denied = await fetch(base + "/@fs" + outside + suffix);
        assert.equal(denied.status, 403);
        assert.doesNotMatch(await denied.text(), /SYNTHETIC_OUTSIDE_ROOT/);
      }
    } finally {
      if (server) await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

