import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const bundleDir = path.resolve(process.argv[2] ?? "src-tauri/target/release/bundle");
const outputFile = path.resolve(process.argv[3] ?? path.join(bundleDir, "SHA256SUMS.txt"));

const files = await collectFiles(bundleDir);
const lines = [];

for (const file of files) {
  if (file === outputFile || file.endsWith(".sha256")) {
    continue;
  }

  const hash = createHash("sha256");
  hash.update(await readFile(file));
  lines.push(`${hash.digest("hex")}  ${path.relative(bundleDir, file).replaceAll(path.sep, "/")}`);
}

lines.sort();
await writeFile(outputFile, `${lines.join("\n")}\n`);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && (await stat(fullPath)).size > 0) {
      files.push(fullPath);
    }
  }

  return files;
}
