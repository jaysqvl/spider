import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const workflowDir = new URL("../.github/workflows/", import.meta.url);
const fullShaActionRef = /^[^@\s]+@[a-f0-9]{40}$/i;
const releaseWorkflow = new URL("release.yml", workflowDir);
const devReleaseWorkflow = new URL("dev-release.yml", workflowDir);

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

const releaseContent = await readFile(releaseWorkflow, "utf8");
const releaseAssetExpectations = [
  {
    label: "Windows x64",
    pattern: 'asset_name_pattern: "Spider_[version]_windows-x64_[bundle][ext]"'
  },
  {
    label: "macOS Apple Silicon arm64",
    pattern: 'asset_name_pattern: "Spider_[version]_macos-apple-silicon-arm64_[bundle][ext]"'
  },
  {
    label: "macOS Intel x64",
    pattern: 'asset_name_pattern: "Spider_[version]_macos-intel-x64_[bundle][ext]"'
  },
  {
    label: "matrix asset pattern input",
    pattern: "assetNamePattern: ${{ matrix.asset_name_pattern }}"
  },
  {
    label: "stable release notes generation",
    pattern: 'node scripts/release-notes.mjs stable "${{ steps.version.outputs.tag }}"'
  },
  {
    label: "stable release notes body",
    pattern: "releaseBody: ${{ needs.validate.outputs.body }}"
  }
];
const releaseAssetFailures = releaseAssetExpectations
  .filter(({ pattern }) => !releaseContent.includes(pattern))
  .map(({ label, pattern }) => `${label} release asset pattern is missing: ${pattern}`);

if (/assetNamePattern:\s*["']Spider_\[version\]_\[platform\]_\[arch\]/.test(releaseContent)) {
  releaseAssetFailures.push("release workflow must not use raw [platform]_[arch] names for public assets");
}

if (releaseAssetFailures.length > 0) {
  console.error("Release asset names must be clear to non-developers:");
  releaseAssetFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Verified pinned workflow actions in ${files.length} workflow file(s).`);
console.log("Verified user-facing release asset names.");

const devReleaseContent = await readFile(devReleaseWorkflow, "utf8");
const devReleaseExpectations = [
  {
    label: "dev updater endpoint",
    pattern: "releases/download/dev-latest/latest.json"
  },
  {
    label: "dev release tag",
    pattern: "tagName: dev-latest"
  },
  {
    label: "dev Windows x64",
    pattern: 'asset_name_pattern: "Spider_Dev_[version]_windows-x64_[bundle][ext]"'
  },
  {
    label: "dev macOS Apple Silicon arm64",
    pattern:
      'asset_name_pattern: "Spider_Dev_[version]_macos-apple-silicon-arm64_[bundle][ext]"'
  },
  {
    label: "dev release notes generation",
    pattern: 'node scripts/release-notes.mjs dev "${{ steps.version.outputs.version }}"'
  },
  {
    label: "dev release notes body",
    pattern: "releaseBody: ${{ needs.prepare.outputs.body }}"
  }
];
const devReleaseFailures = devReleaseExpectations
  .filter(({ pattern }) => !devReleaseContent.includes(pattern))
  .map(({ label, pattern }) => `${label} release expectation is missing: ${pattern}`);

if (devReleaseContent.includes("macos-13") || devReleaseContent.includes("macos-intel")) {
  devReleaseFailures.push("dev release workflow should not depend on the slower macOS Intel runner");
}

if (devReleaseFailures.length > 0) {
  console.error("Dev release workflow must stay on the separate fast test channel:");
  devReleaseFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Verified dev release channel configuration.");
