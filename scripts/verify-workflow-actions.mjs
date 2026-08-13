import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

const workflowDir = new URL("../.github/workflows/", import.meta.url);
const fullShaActionRef = /^[^@\s]+@[a-f0-9]{40}$/i;
const ciWorkflow = new URL("ci.yml", workflowDir);
const releaseWorkflow = new URL("release.yml", workflowDir);
const devReleaseWorkflow = new URL("dev-release.yml", workflowDir);
const releasePleaseWorkflow = new URL("release-please.yml", workflowDir);
const releasePleaseConfig = new URL("../../release-please-config.json", workflowDir);
const releasePleaseManifest = new URL("../../.release-please-manifest.json", workflowDir);

const files = (await readdir(workflowDir))
  .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
  .sort();

const workflowSyntaxFailures = [];
const actionPinFailures = [];
const workflowOrderFailures = [];

for (const file of files) {
  const content = await readFile(new URL(file, workflowDir), "utf8");
  const lines = content.split(/\r?\n/);
  const document = parseDocument(content, { prettyErrors: true, uniqueKeys: true });

  document.errors.forEach((error) => {
    workflowSyntaxFailures.push(`${join(".github/workflows", file)}: ${error.message}`);
  });

  if (document.errors.length === 0) {
    const jobs = document.toJS()?.jobs ?? {};

    Object.entries(jobs).forEach(([jobName, job]) => {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const installIndex = steps.findIndex(({ run }) => run === "npm ci");
      const verifyIndex = steps.findIndex(({ run }) => run === "npm run verify:workflows");

      if (verifyIndex >= 0 && (installIndex < 0 || installIndex > verifyIndex)) {
        workflowOrderFailures.push(
          `${join(".github/workflows", file)} job ${jobName} must run npm ci before npm run verify:workflows`
        );
      }
    });
  }

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
      actionPinFailures.push(`${join(".github/workflows", file)}:${index + 1} uses ${ref}`);
    }
  });
}

if (workflowSyntaxFailures.length > 0) {
  console.error("GitHub Actions workflows must contain valid YAML:");
  workflowSyntaxFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (workflowOrderFailures.length > 0) {
  console.error("Workflow verification dependencies must be installed first:");
  workflowOrderFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (actionPinFailures.length > 0) {
  console.error("Workflow actions must be pinned to full 40-character commit SHAs:");
  actionPinFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const releaseContent = await readFile(releaseWorkflow, "utf8");
const releaseAssetExpectations = [
  {
    label: "release-please reusable workflow entrypoint",
    pattern: "workflow_call:"
  },
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
  },
  {
    label: "release-please release identifier handoff",
    pattern: "releaseId: ${{ needs.validate.outputs.release_id }}"
  },
  {
    label: "authenticated draft release lookup",
    pattern: 'gh api --paginate "repos/${GITHUB_REPOSITORY}/releases"'
  },
  {
    label: "draft release publication gate",
    pattern: "needs: [validate, release]"
  },
  {
    label: "complete release publication",
    pattern: 'gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${RELEASE_ID}"'
  }
];
const releaseAssetFailures = releaseAssetExpectations
  .filter(({ pattern }) => !releaseContent.includes(pattern))
  .map(({ label, pattern }) => `${label} release asset pattern is missing: ${pattern}`);

if (/assetNamePattern:\s*["']Spider_\[version\]_\[platform\]_\[arch\]/.test(releaseContent)) {
  releaseAssetFailures.push("release workflow must not use raw [platform]_[arch] names for public assets");
}

if (releaseContent.includes('releases/tags/${tag}')) {
  releaseAssetFailures.push("release workflow must enumerate authenticated releases when resolving an unpublished draft");
}

if (releaseAssetFailures.length > 0) {
  console.error("Release asset names must be clear to non-developers:");
  releaseAssetFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Verified YAML syntax and pinned actions in ${files.length} workflow file(s).`);
console.log("Verified user-facing release asset names.");

const ciContent = await readFile(ciWorkflow, "utf8");
const ciExpectations = [
  {
    label: "CI Playwright browser install",
    pattern: "npx playwright install --with-deps chromium"
  },
  {
    label: "CI browser layout tests",
    pattern: "npm run test:layout"
  }
];
const ciFailures = ciExpectations
  .filter(({ pattern }) => !ciContent.includes(pattern))
  .map(({ label, pattern }) => `${label} expectation is missing: ${pattern}`);

if (ciFailures.length > 0) {
  console.error("CI must run browser layout checks:");
  ciFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

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
  },
  {
    label: "dev testing tools build flag",
    pattern: 'VITE_SPIDER_DEV_TOOLS: "true"'
  },
  {
    label: "dev browser layout gate",
    pattern: "layout-check:"
  },
  {
    label: "dev browser layout tests",
    pattern: "npm run test:layout"
  },
  {
    label: "stable release dev-channel skip",
    pattern: "contains(github.event.head_commit.message, 'chore(main): release ') == false"
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

const releaseQualityExpectations = [
  {
    label: "stable Playwright browser install",
    pattern: "npx playwright install chromium"
  },
  {
    label: "stable browser layout tests",
    pattern: "npm run test:layout"
  }
];
const releaseQualityFailures = releaseQualityExpectations
  .filter(({ pattern }) => !releaseContent.includes(pattern))
  .map(({ label, pattern }) => `${label} expectation is missing: ${pattern}`);

if (releaseQualityFailures.length > 0) {
  console.error("Stable release quality gate must run browser layout checks:");
  releaseQualityFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Verified browser layout CI gates.");
console.log("Verified dev release channel configuration.");

const releasePleaseWorkflowContent = await readFile(releasePleaseWorkflow, "utf8");
const releasePleaseWorkflowExpectations = [
  {
    label: "pinned release-please action",
    pattern: "googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7"
  },
  {
    label: "release-created package gate",
    pattern: "if: needs.release-please.outputs.release_created == 'true'"
  },
  {
    label: "stable packaging workflow handoff",
    pattern: "uses: ./.github/workflows/release.yml"
  },
  {
    label: "draft packaging mode",
    pattern: "release_draft: true"
  }
];
const releasePleaseWorkflowFailures = releasePleaseWorkflowExpectations
  .filter(({ pattern }) => !releasePleaseWorkflowContent.includes(pattern))
  .map(({ label, pattern }) => `${label} expectation is missing: ${pattern}`);

const releaseConfig = JSON.parse(await readFile(releasePleaseConfig, "utf8"));
const releaseManifest = JSON.parse(await readFile(releasePleaseManifest, "utf8"));
const rootRelease = releaseConfig.packages?.["."];
const extraFiles = rootRelease?.["extra-files"] ?? [];
const changelogTypes = new Set((releaseConfig["changelog-sections"] ?? []).map(({ type }) => type));
const expectedChangelogTypes = ["feat", "fix", "perf", "refactor", "test", "docs", "ci", "build", "chore"];
const expectedVersionTargets = [
  ["src-tauri/tauri.conf.json", "$.version"],
  ["src-tauri/Cargo.toml", "$.package.version"],
  ["src-tauri/Cargo.lock", "$.package[?(@.name.value == 'spider')].version"]
];
const releaseConfigFailures = [
  ...releasePleaseWorkflowFailures,
  ...(releaseConfig["release-type"] === "node" ? [] : ["root release type must be node"]),
  ...(releaseConfig.draft === true ? [] : ["release-please must create a draft release"]),
  ...(releaseConfig["force-tag-creation"] === true ? [] : ["release-please must create the semver tag before packaging"]),
  ...(releaseConfig["include-v-in-tag"] === true ? [] : ["release tags must keep the leading v"]),
  ...(releaseConfig["pull-request-title-pattern"] === "chore(main): release ${version}"
    ? []
    : ["release pull requests must use a conventional commit title"]),
  ...(releaseManifest["."] ? [] : ["release-please manifest must track the root package"]),
  ...expectedChangelogTypes
    .filter((type) => !changelogTypes.has(type))
    .map((type) => `release changelog section is missing: ${type}`),
  ...expectedVersionTargets
    .filter(([path, jsonpath]) => !extraFiles.some((file) => file.path === path && file.jsonpath === jsonpath))
    .map(([path, jsonpath]) => `release-please version target is missing: ${path} ${jsonpath}`)
];

if (releaseConfigFailures.length > 0) {
  console.error("Release Please must own every Spider version pin and package only completed releases:");
  releaseConfigFailures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Verified release-please version pins and installer handoff.");
