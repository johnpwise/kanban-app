import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * Deliberately tolerant: only the fields this module reads or mutates are asserted. Every other
 * field is `z.unknown()` and passed through untouched — this module must never reshape or drop
 * repository-owned package metadata it doesn't itself own.
 */
const packageJsonShape = z.looseObject({ version: z.string() });

const lockfileRootPackageShape = z.looseObject({ version: z.string() });
const lockfileShape = z.looseObject({
  version: z.string(),
  packages: z.looseObject({ "": lockfileRootPackageShape }),
});

export interface ReleaseVersionMutationRequest {
  /** The still-live materialised workspace path, checked out on the verified release branch. */
  workspacePath: string;
  /** The exact trusted version from the fresh eligibility result — never caller-supplied. */
  version: string;
}

export type WriteReleaseVersionOutcome =
  | { ok: true; originalPackageJson: unknown; originalLockfile: unknown }
  | { ok: false; reason: "package_json_read_failed" }
  | { ok: false; reason: "package_json_invalid" }
  | { ok: false; reason: "lockfile_read_failed" }
  | { ok: false; reason: "lockfile_invalid" }
  | { ok: false; reason: "version_write_failed" };

function packageJsonPath(workspacePath: string): string {
  return join(workspacePath, "package.json");
}

function packageLockPath(workspacePath: string): string {
  return join(workspacePath, "package-lock.json");
}

async function readJsonFile(path: string): Promise<{ ok: true; data: unknown } | { ok: false; reason: "read_failed" | "invalid" }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Deterministically applies the exact trusted `version` to root `package.json` and root
 * `package-lock.json`, without executing any repository-controlled npm lifecycle script — only
 * `readFile`/`writeFile` and a code-owned JSON mutation. Reads and validates both files before
 * writing either, so a malformed/missing lockfile never leaves a partially-bumped `package.json`
 * behind. Returns the original (pre-mutation) parsed contents of both files so a caller can later
 * verify no unrelated field changed.
 */
export async function writeReleaseVersion({ workspacePath, version }: ReleaseVersionMutationRequest): Promise<WriteReleaseVersionOutcome> {
  const packageJsonRead = await readJsonFile(packageJsonPath(workspacePath));
  if (!packageJsonRead.ok) {
    return { ok: false, reason: packageJsonRead.reason === "read_failed" ? "package_json_read_failed" : "package_json_invalid" };
  }
  const packageJsonParsed = packageJsonShape.safeParse(packageJsonRead.data);
  if (!packageJsonParsed.success) {
    return { ok: false, reason: "package_json_invalid" };
  }

  const lockfileRead = await readJsonFile(packageLockPath(workspacePath));
  if (!lockfileRead.ok) {
    return { ok: false, reason: lockfileRead.reason === "read_failed" ? "lockfile_read_failed" : "lockfile_invalid" };
  }
  const lockfileParsed = lockfileShape.safeParse(lockfileRead.data);
  if (!lockfileParsed.success) {
    return { ok: false, reason: "lockfile_invalid" };
  }

  const originalPackageJson = packageJsonRead.data;
  const originalLockfile = lockfileRead.data;

  const mutatedPackageJson = JSON.parse(JSON.stringify(originalPackageJson)) as Record<string, unknown>;
  mutatedPackageJson.version = version;

  const mutatedLockfile = JSON.parse(JSON.stringify(originalLockfile)) as { version: unknown; packages: Record<string, Record<string, unknown>> };
  mutatedLockfile.version = version;
  mutatedLockfile.packages[""].version = version;

  try {
    await writeFile(packageJsonPath(workspacePath), `${JSON.stringify(mutatedPackageJson, null, 2)}\n`, "utf8");
    await writeFile(packageLockPath(workspacePath), `${JSON.stringify(mutatedLockfile, null, 2)}\n`, "utf8");
  } catch {
    return { ok: false, reason: "version_write_failed" };
  }

  return { ok: true, originalPackageJson, originalLockfile };
}

export interface VerifyReleaseVersionRequest extends ReleaseVersionMutationRequest {
  /** The exact pre-mutation contents `writeReleaseVersion` returned, for unrelated-change comparison. */
  originalPackageJson: unknown;
  originalLockfile: unknown;
}

export type VerifyReleaseVersionOutcome =
  | { ok: true }
  | { ok: false; reason: "package_json_read_failed" }
  | { ok: false; reason: "package_json_invalid" }
  | { ok: false; reason: "package_json_version_mismatch" }
  | { ok: false; reason: "package_json_unrelated_change" }
  | { ok: false; reason: "lockfile_read_failed" }
  | { ok: false; reason: "lockfile_invalid" }
  | { ok: false; reason: "lockfile_version_mismatch" }
  | { ok: false; reason: "lockfile_unrelated_change" };

/**
 * Order-independent structural equality for parsed JSON values (objects/arrays/primitives).
 * Exported for reuse by release-start recovery reconciliation (`releaseEligibility.ts`), which needs
 * the identical "only the version field(s) changed" semantics against remotely-observed content.
 */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => deepEqualJson(value, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqualJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Returns a deep clone of `value` with `version` overwritten — used to compare "everything except the version field(s)". */
function withVersion<T extends Record<string, unknown>>(value: T, version: string): T {
  return { ...(JSON.parse(JSON.stringify(value)) as T), version };
}

/**
 * Independently re-reads both files from disk and semantically verifies: the version field(s)
 * equal exactly the trusted `version`, and every other field is unchanged from
 * `originalPackageJson`/`originalLockfile` — never trusting `writeReleaseVersion`'s own success
 * alone. Comparison is structural (key-order independent), not textual.
 */
export async function verifyReleaseVersion({
  workspacePath,
  version,
  originalPackageJson,
  originalLockfile,
}: VerifyReleaseVersionRequest): Promise<VerifyReleaseVersionOutcome> {
  const packageJsonRead = await readJsonFile(packageJsonPath(workspacePath));
  if (!packageJsonRead.ok) {
    return { ok: false, reason: packageJsonRead.reason === "read_failed" ? "package_json_read_failed" : "package_json_invalid" };
  }
  const packageJsonParsed = packageJsonShape.safeParse(packageJsonRead.data);
  if (!packageJsonParsed.success) {
    return { ok: false, reason: "package_json_invalid" };
  }
  if (packageJsonParsed.data.version !== version) {
    return { ok: false, reason: "package_json_version_mismatch" };
  }
  const expectedPackageJson = withVersion(originalPackageJson as Record<string, unknown>, version);
  if (!deepEqualJson(packageJsonRead.data, expectedPackageJson)) {
    return { ok: false, reason: "package_json_unrelated_change" };
  }

  const lockfileRead = await readJsonFile(packageLockPath(workspacePath));
  if (!lockfileRead.ok) {
    return { ok: false, reason: lockfileRead.reason === "read_failed" ? "lockfile_read_failed" : "lockfile_invalid" };
  }
  const lockfileParsed = lockfileShape.safeParse(lockfileRead.data);
  if (!lockfileParsed.success) {
    return { ok: false, reason: "lockfile_invalid" };
  }
  if (lockfileParsed.data.version !== version || lockfileParsed.data.packages[""].version !== version) {
    return { ok: false, reason: "lockfile_version_mismatch" };
  }
  const originalLockfileRecord = originalLockfile as { packages: Record<string, Record<string, unknown>> };
  const expectedLockfile = {
    ...(JSON.parse(JSON.stringify(originalLockfile)) as Record<string, unknown>),
    version,
    packages: {
      ...(JSON.parse(JSON.stringify(originalLockfileRecord.packages)) as Record<string, Record<string, unknown>>),
      "": { ...(JSON.parse(JSON.stringify(originalLockfileRecord.packages[""])) as Record<string, unknown>), version },
    },
  };
  if (!deepEqualJson(lockfileRead.data, expectedLockfile)) {
    return { ok: false, reason: "lockfile_unrelated_change" };
  }

  return { ok: true };
}
