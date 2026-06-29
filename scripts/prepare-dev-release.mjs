import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const packagePath = new URL("package.json", repoRoot);
const packageLockPath = new URL("package-lock.json", repoRoot);
const cargoTomlPath = new URL("src-tauri/Cargo.toml", repoRoot);
const cargoLockPath = new URL("src-tauri/Cargo.lock", repoRoot);
const tauriConfigPath = new URL("src-tauri/tauri.conf.json", repoRoot);

export const devProductName = "Spider Dev";
export const devIdentifier = "com.jaysqvl.spider.dev";

const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function normalizePrereleaseIdentifier(value) {
  const normalized = String(value)
    .trim()
    .replace(/[^0-9A-Za-z-]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  if (!normalized) {
    throw new Error("Dev release identifier must contain at least one semver-safe character.");
  }

  return normalized;
}

export function nextDevVersion(baseVersion, buildIdentifier) {
  const match = semverPattern.exec(baseVersion);

  if (!match?.groups) {
    throw new Error(`Base version must be semver: ${baseVersion}`);
  }

  const patch = Number(match.groups.patch) + 1;
  return `${match.groups.major}.${match.groups.minor}.${patch}-dev.${normalizePrereleaseIdentifier(
    buildIdentifier
  )}`;
}

export function resolveDevVersion({ baseVersion, explicitVersion, buildIdentifier }) {
  const version = explicitVersion || nextDevVersion(baseVersion, buildIdentifier);

  if (!semverPattern.test(version) || !version.includes("-dev.")) {
    throw new Error(`Dev release version must be semver and include a dev prerelease: ${version}`);
  }

  return version;
}

export function applyPackageVersion(packageJson, version) {
  return {
    ...packageJson,
    version
  };
}

export function applyPackageLockVersion(packageLock, version) {
  return {
    ...packageLock,
    version,
    packages: {
      ...packageLock.packages,
      "": {
        ...packageLock.packages?.[""],
        version
      }
    }
  };
}

export function replaceCargoPackageVersion(content, version) {
  return content.replace(/^version = "([^"]+)"/m, `version = "${version}"`);
}

export function replaceCargoLockPackageVersion(content, version) {
  return content.replace(
    /(\[\[package\]\]\r?\nname = "spider"\r?\nversion = )"([^"]+)"/,
    `$1"${version}"`
  );
}

export function applyDevTauriConfig(config, { version, endpoint }) {
  const windows = Array.isArray(config.app?.windows)
    ? config.app.windows.map((windowConfig) => ({
        ...windowConfig,
        title: windowConfig.title === "Spider" ? devProductName : windowConfig.title
      }))
    : config.app?.windows;

  return {
    ...config,
    productName: devProductName,
    version,
    identifier: devIdentifier,
    app: {
      ...config.app,
      windows
    },
    bundle: {
      ...config.bundle,
      shortDescription: "Independent Spider Solitaire dev build.",
      longDescription:
        "Spider Dev is the development update channel for testing signed prerelease Spider Solitaire builds."
    },
    plugins: {
      ...config.plugins,
      updater: {
        ...config.plugins?.updater,
        endpoints: [endpoint]
      }
    }
  };
}

function defaultBuildIdentifier(env) {
  const runNumber = env.GITHUB_RUN_NUMBER || Date.now().toString();
  const runAttempt = env.GITHUB_RUN_ATTEMPT || "1";
  return `${runNumber}.${runAttempt}`;
}

function defaultEndpoint(env) {
  const repository = env.GITHUB_REPOSITORY || "jaysqvl/spider";
  return `https://github.com/${repository}/releases/download/dev-latest/latest.json`;
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJson(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}

async function computeVersion(env) {
  const packageJson = await readJson(packagePath);
  return resolveDevVersion({
    baseVersion: env.DEV_RELEASE_BASE_VERSION || packageJson.version,
    explicitVersion: env.DEV_RELEASE_VERSION,
    buildIdentifier: env.DEV_RELEASE_BUILD_ID || defaultBuildIdentifier(env)
  });
}

async function applyDevRelease(env) {
  const version = await computeVersion(env);
  const endpoint = env.TAURI_UPDATER_ENDPOINT || defaultEndpoint(env);

  const packageJson = await readJson(packagePath);
  const packageLock = await readJson(packageLockPath);
  const cargoToml = await readFile(cargoTomlPath, "utf8");
  const cargoLock = await readFile(cargoLockPath, "utf8");
  const tauriConfig = await readJson(tauriConfigPath);

  await writeJson(packagePath, applyPackageVersion(packageJson, version));
  await writeJson(packageLockPath, applyPackageLockVersion(packageLock, version));
  await writeFile(cargoTomlPath, replaceCargoPackageVersion(cargoToml, version));
  await writeFile(cargoLockPath, replaceCargoLockPackageVersion(cargoLock, version));
  await writeJson(tauriConfigPath, applyDevTauriConfig(tauriConfig, { version, endpoint }));

  if (env.GITHUB_OUTPUT) {
    await writeFile(env.GITHUB_OUTPUT, `version=${version}\n`, { flag: "a" });
  }

  console.log(`Prepared ${devProductName} ${version}`);
  console.log(`Updater endpoint: ${endpoint}`);
}

async function main(argv, env) {
  if (argv.includes("--print-version")) {
    console.log(await computeVersion(env));
    return;
  }

  await applyDevRelease(env);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (entrypoint === import.meta.url) {
  process.chdir(fileURLToPath(repoRoot));
  await main(process.argv.slice(2), process.env);
}
