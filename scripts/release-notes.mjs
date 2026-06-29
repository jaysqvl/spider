import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const stableDownloads = [
  "macos-apple-silicon-arm64 DMG: Apple Silicon Macs, including M1, M2, M3, and M4.",
  "macos-intel-x64 DMG: Intel Macs.",
  "windows-x64 NSIS EXE: 64-bit Windows on Intel or AMD CPUs."
];

const devDownloads = [
  "macos-apple-silicon-arm64 DMG: Apple Silicon Macs, including M1, M2, M3, and M4.",
  "windows-x64 NSIS EXE: 64-bit Windows on Intel or AMD CPUs."
];

const tagPattern =
  /^v(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?<prerelease>-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function parseReleaseTag(tag) {
  const match = tagPattern.exec(tag);

  if (!match?.groups) {
    return null;
  }

  return {
    tag,
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease?.slice(1) ?? null
  };
}

function comparePrerelease(a, b) {
  if (a === b) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a.localeCompare(b, "en", { numeric: true });
}

export function compareReleaseTags(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    const delta = left[key] - right[key];

    if (delta !== 0) {
      return delta;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

export function sortedReleaseTags(tags) {
  return tags
    .map(parseReleaseTag)
    .filter(Boolean)
    .sort(compareReleaseTags);
}

export function previousReleaseTag(tags, currentTag) {
  const releases = sortedReleaseTags(tags);
  const current = parseReleaseTag(currentTag);

  if (!current) {
    return null;
  }

  return releases.filter((tag) => compareReleaseTags(tag, current) < 0).at(-1)?.tag ?? null;
}

export function latestStableTag(tags) {
  return sortedReleaseTags(tags)
    .filter((tag) => tag.prerelease === null)
    .at(-1)?.tag;
}

export function formatCommitList(commits) {
  if (commits.length === 0) {
    return ["- No code changes in this range."];
  }

  return commits.map(({ hash, subject }) => `- ${subject} (${hash})`);
}

export function compareUrl({ repository, base, head }) {
  if (!base) {
    return null;
  }

  return `https://github.com/${repository}/compare/${base}...${head}`;
}

export function buildStableReleaseBody({ tag, previousTag, commits, repository }) {
  const heading = previousTag ? `Changes since ${previousTag}:` : "Initial release commits:";
  const compare = compareUrl({ repository, base: previousTag, head: tag });

  return [
    "Desktop release for Spider.",
    "",
    "## What's Changed",
    "",
    heading,
    ...formatCommitList(commits),
    ...(compare ? ["", `Compare: ${compare}`] : []),
    "",
    "## Downloads",
    "",
    ...stableDownloads.map((download) => `- ${download}`),
    "",
    "Files ending in .tar.gz, .sig, and latest.json support automatic updates."
  ].join("\n");
}

export function buildDevReleaseBody({ version, stableTag, commits, repository, head }) {
  const compare = compareUrl({ repository, base: stableTag, head });

  return [
    "Development build for testing the next Spider patch.",
    "",
    "This prerelease uses a separate app name, bundle identifier, local data directory, and update feed from stable Spider.",
    "",
    "## What's Changed",
    "",
    stableTag ? `Changes since ${stableTag}:` : "Dev build commits:",
    ...formatCommitList(commits),
    ...(compare ? ["", `Compare: ${compare}`] : []),
    "",
    "## Downloads",
    "",
    ...devDownloads.map((download) => `- ${download}`),
    "",
    `Files ending in .tar.gz, .sig, and latest.json support automatic updates for Spider Dev ${version}.`
  ].join("\n");
}

function listTags() {
  const output = runGit(["tag", "--list", "v*"]);
  return output ? output.split(/\r?\n/) : [];
}

function refExists(ref) {
  try {
    runGit(["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

function listCommits(range) {
  const output = runGit(["log", "--no-merges", "--pretty=format:%h%x09%s", range]);

  if (!output) {
    return [];
  }

  return output.split(/\r?\n/).map((line) => {
    const [hash, ...subjectParts] = line.split("\t");
    return {
      hash,
      subject: subjectParts.join("\t")
    };
  });
}

function releaseHead(tag) {
  return refExists(tag) ? tag : "HEAD";
}

function repositoryName(env) {
  return env.GITHUB_REPOSITORY || "jaysqvl/spider";
}

function gitHead(env) {
  return env.GITHUB_SHA || runGit(["rev-parse", "--short=12", "HEAD"]);
}

export function stableRange(tags, tag) {
  const previousTag = previousReleaseTag(tags, tag);
  return {
    previousTag,
    range: previousTag ? `${previousTag}..${releaseHead(tag)}` : releaseHead(tag)
  };
}

export function devRange(tags, env) {
  const stableTag = latestStableTag(tags);
  const head = gitHead(env);

  return {
    stableTag,
    head,
    range: stableTag ? `${stableTag}..HEAD` : "HEAD"
  };
}

function generateStableNotes(tag, env) {
  const tags = listTags();
  const { previousTag, range } = stableRange(tags, tag);

  return buildStableReleaseBody({
    tag,
    previousTag,
    commits: listCommits(range),
    repository: repositoryName(env)
  });
}

function generateDevNotes(version, env) {
  const tags = listTags();
  const { stableTag, head, range } = devRange(tags, env);

  return buildDevReleaseBody({
    version,
    stableTag,
    head,
    commits: listCommits(range),
    repository: repositoryName(env)
  });
}

async function main(argv, env) {
  const [channel, versionOrTag] = argv;

  if (channel === "stable" && versionOrTag) {
    console.log(generateStableNotes(versionOrTag, env));
    return;
  }

  if (channel === "dev" && versionOrTag) {
    console.log(generateDevNotes(versionOrTag, env));
    return;
  }

  throw new Error("Usage: node scripts/release-notes.mjs <stable vX.Y.Z|dev VERSION>");
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  await main(process.argv.slice(2), process.env);
}
