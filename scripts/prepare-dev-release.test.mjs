import { describe, expect, it } from "vitest";
import {
  applyDevTauriConfig,
  applyPackageLockVersion,
  devIdentifier,
  devProductName,
  nextDevVersion,
  normalizePrereleaseIdentifier,
  replaceCargoLockPackageVersion,
  replaceCargoPackageVersion,
  resolveDevVersion
} from "./prepare-dev-release.mjs";

describe("prepare dev release", () => {
  it("bumps the next patch into a dev prerelease", () => {
    expect(nextDevVersion("0.1.6", "123.2")).toBe("0.1.7-dev.123.2");
  });

  it("normalizes build identifiers into semver-safe prerelease parts", () => {
    expect(normalizePrereleaseIdentifier("run 123/attempt_2")).toBe("run.123.attempt.2");
  });

  it("rejects explicit versions outside the dev channel", () => {
    expect(() =>
      resolveDevVersion({
        baseVersion: "0.1.6",
        explicitVersion: "0.1.7",
        buildIdentifier: "1"
      })
    ).toThrow(/include a dev prerelease/);
  });

  it("updates npm lockfile root metadata", () => {
    const lockfile = applyPackageLockVersion(
      {
        name: "spider",
        version: "0.1.6",
        packages: {
          "": {
            name: "spider",
            version: "0.1.6"
          }
        }
      },
      "0.1.7-dev.99"
    );

    expect(lockfile.version).toBe("0.1.7-dev.99");
    expect(lockfile.packages[""].version).toBe("0.1.7-dev.99");
  });

  it("updates native package versions without touching dependency versions", () => {
    const cargoToml = '[package]\nname = "spider"\nversion = "0.1.6"\n\n[dependencies]\nserde = "1"\n';
    const cargoLock =
      '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "spider"\nversion = "0.1.6"\n';

    expect(replaceCargoPackageVersion(cargoToml, "0.1.7-dev.99")).toContain(
      'version = "0.1.7-dev.99"'
    );
    expect(replaceCargoLockPackageVersion(cargoLock, "0.1.7-dev.99")).toContain(
      'name = "spider"\nversion = "0.1.7-dev.99"'
    );
    expect(replaceCargoLockPackageVersion(cargoLock, "0.1.7-dev.99")).toContain(
      'name = "serde"\nversion = "1.0.0"'
    );
  });

  it("moves Tauri config to the separate dev app and update feed", () => {
    const config = applyDevTauriConfig(
      {
        productName: "Spider",
        version: "0.1.6",
        identifier: "com.jaysqvl.spider",
        app: {
          windows: [
            {
              label: "main",
              title: "Spider"
            }
          ]
        },
        bundle: {
          shortDescription: "Stable"
        },
        plugins: {
          updater: {
            endpoints: ["https://github.com/jaysqvl/spider/releases/latest/download/latest.json"]
          }
        }
      },
      {
        version: "0.1.7-dev.99",
        endpoint: "https://github.com/jaysqvl/spider/releases/download/dev-latest/latest.json"
      }
    );

    expect(config.productName).toBe(devProductName);
    expect(config.identifier).toBe(devIdentifier);
    expect(config.version).toBe("0.1.7-dev.99");
    expect(config.app.windows[0].title).toBe(devProductName);
    expect(config.plugins.updater.endpoints).toEqual([
      "https://github.com/jaysqvl/spider/releases/download/dev-latest/latest.json"
    ]);
  });
});
