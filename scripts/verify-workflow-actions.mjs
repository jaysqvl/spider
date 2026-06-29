import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const workflowDir = new URL("../.github/workflows/", import.meta.url);
const fullShaActionRef = /^[^@\s]+@[a-f0-9]{40}$/i;

const files = (await readdir(workflowDir))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();

const failures = [];

for (const file of files) {
  const content = await readFile(new URL(file, workflowDir), "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*([^#\s]+)(?:\s+#.*)?$/);

    if (!match) {
      return;
    }

    const ref = match[1].replace(/^["']|["']$/g, "");

    if (ref.startsWith("./")) {
      return;
    }

    if (!fullShaActionRef.test(ref)) {
      failures.push(`${join(".github/workflows", file)}:${index + 1} uses ${ref}`);
    }
  });
}

if (failures.length > 0) {
  console.error("Workflow actions must be pinned to full 40-character commit SHAs:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Verified pinned workflow actions in ${files.length} workflow file(s).`);
