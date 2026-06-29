import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const configuredUpdater = config.plugins?.updater ?? {};
const pubkey = process.env.TAURI_UPDATER_PUBKEY || configuredUpdater.pubkey;
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
const requireUpdater = process.env.REQUIRE_TAURI_UPDATER === "true";
const defaultEndpoint = "https://github.com/jaysqvl/spider/releases/latest/download/latest.json";

config.bundle ??= {};
config.plugins ??= {};

if (!pubkey && requireUpdater) {
  throw new Error("TAURI_UPDATER_PUBKEY is required for release builds.");
}

if (!privateKey && requireUpdater) {
  throw new Error("TAURI_SIGNING_PRIVATE_KEY is required for release builds.");
}

config.bundle.createUpdaterArtifacts = Boolean(privateKey);
config.plugins.updater = {
  ...configuredUpdater,
  pubkey,
  endpoints: [process.env.TAURI_UPDATER_ENDPOINT || configuredUpdater.endpoints?.[0] || defaultEndpoint],
  windows: {
    ...configuredUpdater.windows,
    installMode: configuredUpdater.windows?.installMode ?? "passive"
  }
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
