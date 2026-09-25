import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyReleaseVersion, writeReleaseVersion } from "./releaseVersionMutation";

const BASE_PACKAGE_JSON = {
  name: "kanban-app",
  version: "0.1.0",
  private: true,
  scripts: { build: "next build" },
  dependencies: { next: "16.3.5", react: "19.2.8" },
  devDependencies: { typescript: "^5" },
};

const BASE_LOCKFILE = {
  name: "kanban-app",
  version: "0.1.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "": {
      name: "kanban-app",
      version: "0.1.0",
      dependencies: { next: "16.3.5" },
    },
    "node_modules/next": { version: "16.3.5", resolved: "https://example.invalid/next" },
  },
};

async function writeFixtureFiles(
  workspacePath: string,
  overrides: { packageJson?: unknown; lockfile?: unknown } = {},
): Promise<void> {
  await writeFile(join(workspacePath, "package.json"), JSON.stringify(overrides.packageJson ?? BASE_PACKAGE_JSON, null, 2) + "\n");
  await writeFile(join(workspacePath, "package-lock.json"), JSON.stringify(overrides.lockfile ?? BASE_LOCKFILE, null, 2) + "\n");
}

describe("releaseVersionMutation", () => {
  const workspacePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(workspacePaths.map((path) => rm(path, { recursive: true, force: true })));
    workspacePaths.length = 0;
  });

  async function createWorkspace(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "ada-executor-release-version-"));
    workspacePaths.push(path);
    return path;
  }

  describe("writeReleaseVersion", () => {
    it("writes the requested version into root package.json", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome.ok).toBe(true);
      const written = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8"));
      expect(written.version).toBe("0.2.0");
    });

    it("writes the requested version into the lockfile's top-level version and packages[\"\"].version", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);

      // Act
      await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      const written = JSON.parse(await readFile(join(workspacePath, "package-lock.json"), "utf8"));
      expect(written.version).toBe("0.2.0");
      expect(written.packages[""].version).toBe("0.2.0");
    });

    it("preserves every unrelated package.json and lockfile field exactly", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);

      // Act
      await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      const writtenPackageJson = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8"));
      expect(writtenPackageJson.dependencies).toEqual(BASE_PACKAGE_JSON.dependencies);
      expect(writtenPackageJson.devDependencies).toEqual(BASE_PACKAGE_JSON.devDependencies);
      expect(writtenPackageJson.scripts).toEqual(BASE_PACKAGE_JSON.scripts);

      const writtenLockfile = JSON.parse(await readFile(join(workspacePath, "package-lock.json"), "utf8"));
      expect(writtenLockfile.packages["node_modules/next"]).toEqual(BASE_LOCKFILE.packages["node_modules/next"]);
      expect(writtenLockfile.packages[""].dependencies).toEqual(BASE_LOCKFILE.packages[""].dependencies);
    });

    it("returns the original parsed package.json and lockfile for later unrelated-change verification", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.originalPackageJson).toEqual(BASE_PACKAGE_JSON);
      expect(outcome.originalLockfile).toEqual(BASE_LOCKFILE);
    });

    it("fails closed with package_json_read_failed when package.json is missing", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFile(join(workspacePath, "package-lock.json"), JSON.stringify(BASE_LOCKFILE, null, 2));

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_read_failed" });
    });

    it("fails closed with package_json_invalid when package.json is malformed JSON", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFile(join(workspacePath, "package.json"), "{ not valid json");
      await writeFile(join(workspacePath, "package-lock.json"), JSON.stringify(BASE_LOCKFILE, null, 2));

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_invalid" });
    });

    it("fails closed with package_json_invalid when package.json has no string version field", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, { packageJson: { name: "kanban-app" } });

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_invalid" });
    });

    it("fails closed with lockfile_read_failed when package-lock.json is missing", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFile(join(workspacePath, "package.json"), JSON.stringify(BASE_PACKAGE_JSON, null, 2));

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "lockfile_read_failed" });
    });

    it("fails closed with lockfile_invalid when packages[\"\"] is missing", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, { lockfile: { version: "0.1.0", lockfileVersion: 3, packages: {} } });

      // Act
      const outcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "lockfile_invalid" });
    });

    it("never writes package.json when the lockfile is invalid, leaving no partial bump", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, { lockfile: { version: "0.1.0", lockfileVersion: 3, packages: {} } });

      // Act
      await writeReleaseVersion({ workspacePath, version: "0.2.0" });

      // Assert
      const stillOriginal = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8"));
      expect(stillOriginal.version).toBe("0.1.0");
    });
  });

  describe("verifyReleaseVersion", () => {
    it("succeeds when both files carry exactly the requested version and nothing else changed", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);
      const writeOutcome = await writeReleaseVersion({ workspacePath, version: "0.2.0" });
      if (!writeOutcome.ok) throw new Error("expected write to succeed");

      // Act
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: writeOutcome.originalPackageJson,
        originalLockfile: writeOutcome.originalLockfile,
      });

      // Assert
      expect(outcome).toEqual({ ok: true });
    });

    it("fails closed with package_json_version_mismatch when package.json's version was not actually updated", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath);

      // Act — verifying against the *unwritten* fixture, simulating a write that silently no-opped
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: BASE_PACKAGE_JSON,
        originalLockfile: BASE_LOCKFILE,
      });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_version_mismatch" });
    });

    it("fails closed with lockfile_version_mismatch when the lockfile's packages[\"\"].version disagrees with the top-level version", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, {
        packageJson: { ...BASE_PACKAGE_JSON, version: "0.2.0" },
        lockfile: { ...BASE_LOCKFILE, version: "0.2.0", packages: { ...BASE_LOCKFILE.packages, "": { ...BASE_LOCKFILE.packages[""], version: "0.1.0" } } },
      });

      // Act
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: BASE_PACKAGE_JSON,
        originalLockfile: BASE_LOCKFILE,
      });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "lockfile_version_mismatch" });
    });

    it("fails closed with package_json_unrelated_change when an unrelated field was modified", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, {
        packageJson: { ...BASE_PACKAGE_JSON, version: "0.2.0", private: false },
      });

      // Act
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: BASE_PACKAGE_JSON,
        originalLockfile: BASE_LOCKFILE,
      });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_unrelated_change" });
    });

    it("fails closed with lockfile_unrelated_change when an unrelated dependency entry was modified", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, {
        packageJson: { ...BASE_PACKAGE_JSON, version: "0.2.0" },
        lockfile: {
          ...BASE_LOCKFILE,
          version: "0.2.0",
          packages: {
            ...BASE_LOCKFILE.packages,
            "": { ...BASE_LOCKFILE.packages[""], version: "0.2.0" },
            "node_modules/next": { version: "16.9.9", resolved: "https://example.invalid/next" },
          },
        },
      });

      // Act
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: BASE_PACKAGE_JSON,
        originalLockfile: BASE_LOCKFILE,
      });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "lockfile_unrelated_change" });
    });

    it("fails closed with package_json_read_failed when package.json disappeared before verification", async () => {
      // Arrange
      const workspacePath = await createWorkspace();
      await writeFixtureFiles(workspacePath, { packageJson: { ...BASE_PACKAGE_JSON, version: "0.2.0" } });
      await rm(join(workspacePath, "package.json"));

      // Act
      const outcome = await verifyReleaseVersion({
        workspacePath,
        version: "0.2.0",
        originalPackageJson: BASE_PACKAGE_JSON,
        originalLockfile: BASE_LOCKFILE,
      });

      // Assert
      expect(outcome).toEqual({ ok: false, reason: "package_json_read_failed" });
    });
  });
});
