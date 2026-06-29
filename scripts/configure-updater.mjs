import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const pubkey = process.env.TAURI_UPDATER_PUBKEY;
const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;

config.bundle ??= {};
config.plugins ??= {};

if (pubkey && privateKey) {
  config.bundle.createUpdaterArtifacts = true;
  config.plugins.updater = {
    pubkey,
    endpoints: [
      process.env.TAURI_UPDATER_ENDPOINT ??
        "https://github.com/jaysqvl/spider/releases/latest/download/latest.json"
    ]
  };
} else {
  config.bundle.createUpdaterArtifacts = false;
  delete config.plugins.updater;
}

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
