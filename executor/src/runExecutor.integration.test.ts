import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureAdaDeliveryBranch } from "./deliveryBranch";
import { ensureAdaDeliveryCommit } from "./deliveryCommit";
import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { verifyGitIntegrity } from "./gitIntegrityVerification";
import { runGit } from "./gitProcess";
import { materializeRepositoryWorkspace } from "./repositoryWorkspace";
import { runExecutor } from "./runExecutor";
import { inspectWorkingTree } from "./workingTreeInspection";

import type { EnsureAdaDeliveryBranch } from "./deliveryBranch";
import type { EnsureAdaDeliveryCommit } from "./deliveryCommit";
import type { ExecutorLogger } from "./runExecutor";
import type { VerifyGitIntegrity } from "./gitIntegrityVerification";
import type { MaterializeRepositoryWorkspace } from "./repositoryWorkspace";
import type { InspectWorkingTree } from "./workingTreeInspection";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const silentLogger: ExecutorLogger = {
  info: () => undefined,
  error: () => undefined,
};

/**
 * Builds a local temp git repository with a "develop" default branch — matching
 * `acceptedRunData`'s fixed `baseBranch: "develop"` — so tests can materialise a real workspace
 * without any network access to the live GitHub repository (forbidden for automated tests; see
 * `main.integration.test.ts`).
 */
async function createFixtureRepository(): Promise<{ path: string; headSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-run-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), "develop\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "develop commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  return { path, headSha };
}

/** Binds the real `materializeRepositoryWorkspace` to a local fixture repo instead of the network. */
function localMaterializeRepositoryWorkspace(fixturePath: string): MaterializeRepositoryWorkspace {
  return (request) => materializeRepositoryWorkspace({ ...request, runGit, buildCloneUrl: () => fixturePath });
}

/** Binds the real `inspectWorkingTree` to the real `runGit`, exercising the actual `git status` invocation. */
const localInspectWorkingTree: InspectWorkingTree = (request) => inspectWorkingTree({ ...request, runGit });

/** Binds the real `verifyGitIntegrity` to the real `runGit`, exercising the actual `git rev-parse` invocations. */
const localVerifyGitIntegrity: VerifyGitIntegrity = (request) => verifyGitIntegrity({ ...request, runGit });

/** Binds the real `ensureAdaDeliveryBranch` to the real `runGit`, exercising the actual `git checkout -b` invocation. */
const localEnsureAdaDeliveryBranch: EnsureAdaDeliveryBranch = (request) => ensureAdaDeliveryBranch({ ...request, runGit });

/** Binds the real `ensureAdaDeliveryCommit` to the real `runGit`, exercising the actual `git add`/`git commit` invocations. */
const localEnsureAdaDeliveryCommit: EnsureAdaDeliveryCommit = (request) => ensureAdaDeliveryCommit({ ...request, runGit });

function acceptedRunData(overrides: { executionRequestId: string; projectId: string; cardId: string }) {
  return {
    executionRequestId: overrides.executionRequestId,
    correlationId: overrides.executionRequestId,
    projectId: overrides.projectId,
    cardId: overrides.cardId,
    status: "accepted" as const,
    acceptedAt: Timestamp.now(),
    firstMessageId: "msg-1",
    input: {
      schemaVersion: 1 as const,
      eventType: "ada.execution.requested" as const,
      title: "Ship the demo",
      prompt: "Ship the demo build.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
    },
  };
}

describeWithEmulator("executor against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-integration-${randomUUID()}`);
  const firestore = getFirestore(app);
  let fixture: { path: string; headSha: string };

  beforeAll(async () => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    fixture = await createFixtureRepository();
  });

  afterAll(async () => {
    await deleteApp(app);
    await rm(fixture.path, { recursive: true, force: true });
  });

  it("loads and validates a real seeded accepted execution run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("fails clearly for a missing document", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("fails validation for a malformed document", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    await firestore.collection("executionRuns").doc(executionRequestId).set({ not: "a valid run" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("leaves the immutable input unchanged and records a claim marker after a winning run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      claimIdFactory: () => "claim-1",
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    const data = (await docRef.get()).data();
    expect(data?.input).toEqual(runData.input);
    expect(data?.status).toBe("accepted");
    expect(data?.claim).toMatchObject({ claimId: "claim-1" });
    expect(data?.claim?.claimedAt).toBeInstanceOf(Timestamp);
  });

  it("given two concurrent executor attempts for the same run, exactly one wins the claim", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);

    // Act
    const [outcomeA, outcomeB] = await Promise.all([
      runExecutor({
        env: { ADA_EXECUTION_RUN_ID: executionRequestId },
        repository: createFirestoreExecutionRunRepository(),
        logger: silentLogger,
        materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
        inspectWorkingTree: localInspectWorkingTree,
        verifyGitIntegrity: localVerifyGitIntegrity,
        ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
        ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
        claimIdFactory: () => "attempt-A",
      }),
      runExecutor({
        env: { ADA_EXECUTION_RUN_ID: executionRequestId },
        repository: createFirestoreExecutionRunRepository(),
        logger: silentLogger,
        materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
        inspectWorkingTree: localInspectWorkingTree,
        verifyGitIntegrity: localVerifyGitIntegrity,
        ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
        ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
        claimIdFactory: () => "attempt-B",
      }),
    ]);

    // Assert
    const outcomes = [outcomeA, outcomeB];
    expect(outcomes.filter((outcome) => outcome.ok && outcome.claimed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.ok && !outcome.claimed)).toHaveLength(1);

    const winningClaimId = outcomeA.ok && outcomeA.claimed ? "attempt-A" : "attempt-B";
    const data = (await docRef.get()).data();
    expect(data?.claim).toMatchObject({ claimId: winningClaimId });
    expect(data?.input).toEqual(runData.input);
  });

  it("a duplicate executor observing an existing claim performs no writes and does not touch the Card", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const cardProjectId = `project-${randomUUID()}`;
    const cardId = `card-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: cardProjectId, cardId });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);
    const repository = createFirestoreExecutionRunRepository();
    await repository.claimExecutionRun(executionRequestId, "first-claim");
    const claimedSnapshotBefore = (await docRef.get()).data();

    const cardRef = firestore.doc(`projects/${cardProjectId}/cards/${cardId}`);
    const cardFixture = { title: "Ship the demo", executionStatus: "queued", updatedAt: Timestamp.now() };
    await cardRef.set(cardFixture);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository,
      logger: silentLogger,
      claimIdFactory: () => "second-claim",
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: false });
    const data = (await docRef.get()).data();
    expect(data).toEqual(claimedSnapshotBefore);
    expect(data?.claim).toMatchObject({ claimId: "first-claim" });
    const cardSnapshot = await cardRef.get();
    expect(cardSnapshot.data()).toEqual(cardFixture);

    await cardRef.delete();
  });

  it("leaves the related Card unchanged and queued after a successful run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const cardProjectId = `project-${randomUUID()}`;
    const cardId = `card-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: cardProjectId, cardId });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    const cardRef = firestore.doc(`projects/${cardProjectId}/cards/${cardId}`);
    const cardFixture = {
      title: "Ship the demo",
      executionStatus: "queued",
      updatedAt: Timestamp.now(),
    };
    await cardRef.set(cardFixture);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    const cardSnapshot = await cardRef.get();
    expect(cardSnapshot.data()).toEqual(cardFixture);
    expect(cardSnapshot.data()?.executionStatus).toBe("queued");

    await cardRef.delete();
  });

  it("keeps the real materialised workspace on disk while the coding agent is invoked, and removes it immediately after", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    let observedInvocation: { executionRequestId: string; path: string } | undefined;
    let workspaceExistedDuringInvocation = false;

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      invokeCodingAgent: async ({ executionRequestId: invokedExecutionRequestId, workspace }) => {
        observedInvocation = { executionRequestId: invokedExecutionRequestId, path: workspace.path };
        await stat(workspace.path);
        workspaceExistedDuringInvocation = true;
        expect(workspace.headSha).toBe(fixture.headSha);
      },
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(workspaceExistedDuringInvocation).toBe(true);
    expect(observedInvocation?.executionRequestId).toBe(executionRequestId);
    expect(observedInvocation?.path).toBeDefined();
    await expect(stat(observedInvocation?.path as string)).rejects.toThrow();
  });

  it("reports workingTree:'changes_detected', the ADA delivery branch, and the ADA delivery commit SHA end-to-end when the coding agent writes a new file into the real workspace", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      invokeCodingAgent: async ({ workspace }) => {
        await writeFile(join(workspace.path, "generated-by-agent.txt"), "content\n");
      },
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: `ada/${executionRequestId}`,
      deliveryCommitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
  });

  it("creates the ADA delivery branch from the persisted source revision and preserves tracked and untracked coding-agent changes", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);
    let observedAfterBranchCreation:
      | { checkedOutBranch: string; readmeContent: string; untrackedContent: string; statusPorcelain: string }
      | undefined;
    const spyingEnsureAdaDeliveryBranch: EnsureAdaDeliveryBranch = async (request) => {
      const outcome = await localEnsureAdaDeliveryBranch(request);
      if (outcome.ok) {
        // Inspected here, before `runExecutor`'s `finally` removes the workspace — this is the
        // only point at which the real, still-live post-branch-creation workspace can be observed.
        observedAfterBranchCreation = {
          checkedOutBranch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: request.workspacePath,
            encoding: "utf8",
          }).trim(),
          readmeContent: await readFile(join(request.workspacePath, "README.md"), "utf8"),
          untrackedContent: await readFile(join(request.workspacePath, "generated-by-agent.txt"), "utf8"),
          statusPorcelain: execFileSync("git", ["status", "--porcelain=v1"], {
            cwd: request.workspacePath,
            encoding: "utf8",
          }),
        };
      }
      return outcome;
    };

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: spyingEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      invokeCodingAgent: async ({ workspace }) => {
        await writeFile(join(workspace.path, "README.md"), "modified by the coding agent\n");
        await writeFile(join(workspace.path, "generated-by-agent.txt"), "content\n");
      },
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: `ada/${executionRequestId}`,
      deliveryCommitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    expect(observedAfterBranchCreation?.checkedOutBranch).toBe(`ada/${executionRequestId}`);
    expect(observedAfterBranchCreation?.readmeContent).toBe("modified by the coding agent\n");
    expect(observedAfterBranchCreation?.untrackedContent).toBe("content\n");
    // Still shows both the tracked modification and the untracked file as pending — branch
    // creation via `checkout -b` never staged or committed them.
    expect(observedAfterBranchCreation?.statusPorcelain).toContain("README.md");
    expect(observedAfterBranchCreation?.statusPorcelain).toContain("generated-by-agent.txt");
  });

  it("does not create a delivery branch, and leaves the fixture's base branch checked out, for a clean working tree", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);
    let deliveryBranchCalled = false;
    const spyingEnsureAdaDeliveryBranch: EnsureAdaDeliveryBranch = async (request) => {
      deliveryBranchCalled = true;
      return localEnsureAdaDeliveryBranch(request);
    };

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: localInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: spyingEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(deliveryBranchCalled).toBe(false);
  });

  it("fails safely end-to-end, without ever running working-tree inspection, when the coding agent creates a local commit and moves HEAD", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);
    let workingTreeInspected = false;
    const spyingInspectWorkingTree: InspectWorkingTree = async (request) => {
      workingTreeInspected = true;
      return localInspectWorkingTree(request);
    };

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: spyingInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      invokeCodingAgent: async ({ workspace }) => {
        await writeFile(join(workspace.path, "agent-change.txt"), "unsanctioned commit\n");
        execFileSync("git", ["add", "agent-change.txt"], { cwd: workspace.path });
        execFileSync("git", ["commit", "-m", "unsanctioned coding-agent commit"], { cwd: workspace.path });
      },
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_head_changed" });
    expect(workingTreeInspected).toBe(false);
  });

  it("fails safely end-to-end, without ever running working-tree inspection, when the coding agent switches to another branch", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);
    let workingTreeInspected = false;
    const spyingInspectWorkingTree: InspectWorkingTree = async (request) => {
      workingTreeInspected = true;
      return localInspectWorkingTree(request);
    };

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      materializeRepositoryWorkspace: localMaterializeRepositoryWorkspace(fixture.path),
      inspectWorkingTree: spyingInspectWorkingTree,
      verifyGitIntegrity: localVerifyGitIntegrity,
      ensureAdaDeliveryBranch: localEnsureAdaDeliveryBranch,
      ensureAdaDeliveryCommit: localEnsureAdaDeliveryCommit,
      invokeCodingAgent: async ({ workspace }) => {
        execFileSync("git", ["checkout", "-b", "coding-agent-branch"], { cwd: workspace.path });
      },
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_branch_changed" });
    expect(workingTreeInspected).toBe(false);
  });
});
