import { execFile } from "node:child_process";
import { mkdtemp, mkdir, cp, chmod, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const INVOCATION_SEPARATOR = "===GCLOUD_INVOCATION===";

const FAKE_GCLOUD_SCRIPT = `#!/usr/bin/env bash
{
  echo "${INVOCATION_SEPARATOR}"
  for arg in "$@"; do
    printf '%s\\n' "$arg"
  done
} >> "$GCLOUD_LOG_FILE"
exit 0
`;

async function parseGcloudInvocations(logFilePath: string): Promise<string[][]> {
  let contents: string;
  try {
    contents = await readFile(logFilePath, "utf8");
  } catch {
    return [];
  }
  return contents
    .split(`${INVOCATION_SEPARATOR}\n`)
    .slice(1)
    .map((block) => block.split("\n").filter((line) => line.length > 0));
}

describe("executor/deploy/deploy.sh deploy-release-ci-controller-job dispatch", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("invokes exactly one gcloud run jobs deploy call with the release-CI Job contract", async () => {
    // Arrange: isolated copy of the real script, plus a fake gcloud recording its argv.
    const workDir = await mkdtemp(join(tmpdir(), "deploy-script-test-"));
    tempDirs.push(workDir);

    const deployDir = join(workDir, "deploy");
    await mkdir(deployDir, { recursive: true });
    const scriptPath = join(deployDir, "deploy.sh");
    await cp(join(__dirname, "..", "deploy", "deploy.sh"), scriptPath);
    await chmod(scriptPath, 0o755);

    const fakeBinDir = join(workDir, "fake-bin");
    await mkdir(fakeBinDir, { recursive: true });
    const fakeGcloudPath = join(fakeBinDir, "gcloud");
    await writeFile(fakeGcloudPath, FAKE_GCLOUD_SCRIPT);
    await chmod(fakeGcloudPath, 0o755);

    const gcloudLogFile = join(workDir, "gcloud-invocations.log");

    const runtimeServiceAccount = "ada-executor-runtime@test-project.iam.gserviceaccount.com";
    const releaseRepository = "johnpwise/kanban-app";
    const githubAppPrivateKeySecret = "ada-github-app-private-key-test";

    // Act
    await execFileAsync(scriptPath, ["deploy-release-ci-controller-job"], {
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        GCLOUD_LOG_FILE: gcloudLogFile,
        ADA_GCP_PROJECT_ID: "test-project",
        ADA_GCP_REGION: "us-central1",
        ADA_ARTIFACT_REPO: "test-repo",
        ADA_IMAGE_NAME: "test-image",
        ADA_JOB_NAME: "ada-executor-test",
        ADA_CI_JOB_NAME: "ada-ci-controller-test",
        ADA_MERGE_JOB_NAME: "ada-merge-controller-test",
        ADA_RELEASE_JOB_NAME: "ada-release-controller-test",
        ADA_RELEASE_PR_JOB_NAME: "ada-release-pr-controller-test",
        ADA_RELEASE_CI_JOB_NAME: "ada-release-ci-controller",
        ADA_RELEASE_REPOSITORY: releaseRepository,
        ADA_RELEASE_SOURCE_BRANCH: "develop",
        ADA_RUNTIME_SERVICE_ACCOUNT: runtimeServiceAccount,
        ADA_CODEX_API_KEY_SECRET: "ada-codex-api-key-test",
        ADA_GITHUB_APP_PRIVATE_KEY_SECRET: githubAppPrivateKeySecret,
        ADA_IMAGE_TAG: "test-fixed-tag",
      },
    });

    // Assert
    const invocations = await parseGcloudInvocations(gcloudLogFile);
    expect(invocations).toHaveLength(1);

    const argv = invocations[0];
    expect(argv.slice(0, 2)).toEqual(["run", "jobs"]);
    expect(argv[2]).toBe("deploy");
    expect(argv).toContain("ada-release-ci-controller");
    expect(argv).toContain("--command=node");
    expect(argv).toContain("--args=lib/releaseCiControllerMain.js");
    expect(argv).toContain("--tasks=1");
    expect(argv).toContain("--max-retries=0");
    expect(argv).toContain("--task-timeout=1800s");
    expect(argv).toContain(`--service-account=${runtimeServiceAccount}`);
    expect(argv).toContain(`--set-secrets=ADA_GITHUB_APP_PRIVATE_KEY=${githubAppPrivateKeySecret}:latest`);
    expect(argv.some((arg) => arg.startsWith("--set-env-vars=") && arg.includes(`ADA_RELEASE_REPOSITORY=${releaseRepository}`))).toBe(true);

    const flattened = argv.join("\n");
    expect(flattened).not.toContain("ADA_RELEASE_INTENT_ID");
    expect(flattened).not.toContain("CODEX_API_KEY");
    expect(flattened).not.toContain("CODEX_MODEL");
    expect(flattened).not.toContain("CODEX_REASONING_EFFORT");
  });
});
