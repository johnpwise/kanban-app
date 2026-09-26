import { describe, expect, it } from "vitest";

import { runReleasePullRequestCompletionController } from "./releasePullRequestCompletionController";

import type { ExecuteEligibleReleasePullRequestOutcome } from "./releasePullRequestExecution";
import type { ReleaseIntentRepository, RecordReleasePullRequestResultOutcome, ReleasePullRequestResultIdentity } from "./releaseIntentRepository";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const REPOSITORY = "johnpwise/kanban-app";
const VERSION = "0.2.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/0.2.0";
const RELEASE_COMMIT_SHA = "c".repeat(40);

function verifiedOutcome(target: ReleasePullRequestTarget, number: number): Extract<ExecuteEligibleReleasePullRequestOutcome, { outcome: "verified" }> {
  return {
    outcome: "verified",
    releaseIntentId: RELEASE_INTENT_ID,
    repository: REPOSITORY,
    version: VERSION,
    sourceBranch: SOURCE_BRANCH,
    sourceRevision: SOURCE_REVISION,
    target,
    releaseBranch: RELEASE_BRANCH,
    releaseCommitSha: RELEASE_COMMIT_SHA,
    number,
  };
}

function fakeExecute(
  byTarget: Record<ReleasePullRequestTarget, ExecuteEligibleReleasePullRequestOutcome>,
): { execute: (releaseIntentId: string, target: ReleasePullRequestTarget) => Promise<ExecuteEligibleReleasePullRequestOutcome>; calls: ReleasePullRequestTarget[] } {
  const calls: ReleasePullRequestTarget[] = [];
  return {
    calls,
    execute: async (_releaseIntentId, target) => {
      calls.push(target);
      return byTarget[target];
    },
  };
}

function fakeRepository(
  byTarget: Record<ReleasePullRequestTarget, RecordReleasePullRequestResultOutcome | Error>,
): { repository: ReleaseIntentRepository; calls: { target: ReleasePullRequestTarget; identity: ReleasePullRequestResultIdentity }[] } {
  const calls: { target: ReleasePullRequestTarget; identity: ReleasePullRequestResultIdentity }[] = [];
  return {
    calls,
    repository: {
      loadReleaseIntentData: async () => undefined,
      recordReleaseIntent: async () => ({ outcome: "created" }) as const,
      recordReleaseStartResult: async () => ({ outcome: "created" }) as const,
      recordReleasePullRequestResult: async (_releaseIntentId, identity) => {
        calls.push({ target: identity.target, identity });
        const outcome = byTarget[identity.target];
        if (outcome instanceof Error) {
          throw outcome;
        }
        return outcome;
      },
    },
  };
}

const NOT_ELIGIBLE: ExecuteEligibleReleasePullRequestOutcome = {
  outcome: "not_eligible",
  releaseIntentId: RELEASE_INTENT_ID,
  target: "main",
  eligibility: { eligible: false, reason: "release_start_missing" },
};

describe("runReleasePullRequestCompletionController", () => {
  it("durably records both freshly verified pull requests", async () => {
    // Arrange
    const { execute, calls: executeCalls } = fakeExecute({ main: verifiedOutcome("main", 101), develop: verifiedOutcome("develop", 102) });
    const { repository, calls: persistCalls } = fakeRepository({ main: { outcome: "created" }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.releaseIntentId).toBe(RELEASE_INTENT_ID);
    expect(result.main).toEqual({
      outcome: "release_pull_request_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository: REPOSITORY,
      version: VERSION,
      releaseBranch: RELEASE_BRANCH,
      releaseCommitSha: RELEASE_COMMIT_SHA,
      number: 101,
    });
    expect(result.develop).toEqual({
      outcome: "release_pull_request_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      repository: REPOSITORY,
      version: VERSION,
      releaseBranch: RELEASE_BRANCH,
      releaseCommitSha: RELEASE_COMMIT_SHA,
      number: 102,
    });
    expect(executeCalls).toEqual(["main", "develop"]);
    expect(persistCalls).toHaveLength(2);
    expect(persistCalls[0].identity).toEqual({
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      releaseBranch: RELEASE_BRANCH,
      commitSha: RELEASE_COMMIT_SHA,
      target: "main",
      number: 101,
    });
  });

  it("converges idempotently when both results are already durably recorded (crash after both created, before persistence, on retry)", async () => {
    // Arrange — the execution layer's own idempotent create-or-reuse lookup reuses both existing PRs
    // (no second GitHub create), and persistence converges without overwriting.
    const { execute } = fakeExecute({ main: verifiedOutcome("main", 101), develop: verifiedOutcome("develop", 102) });
    const { repository } = fakeRepository({ main: { outcome: "already_recorded" }, develop: { outcome: "already_recorded" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main.outcome).toBe("release_pull_request_already_recorded");
    expect(result.develop.outcome).toBe("release_pull_request_already_recorded");
  });

  it("records only the missing target when the other was already persisted (crash after main created, before persistence)", async () => {
    // Arrange — main was already durably recorded on a prior attempt; develop was never created.
    const { execute, calls: executeCalls } = fakeExecute({ main: verifiedOutcome("main", 101), develop: verifiedOutcome("develop", 102) });
    const { repository, calls: persistCalls } = fakeRepository({ main: { outcome: "already_recorded" }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert — both targets are still independently executed/observed (execution's own lookup-first
    // create-or-reuse makes main's re-execution a safe reuse, never a duplicate create), but only
    // develop's persistence is a fresh write.
    expect(executeCalls).toEqual(["main", "develop"]);
    expect(persistCalls).toHaveLength(2);
    expect(result.main.outcome).toBe("release_pull_request_already_recorded");
    expect(result.develop.outcome).toBe("release_pull_request_recorded");
  });

  it("passes through a not_eligible outcome for a target without attempting persistence", async () => {
    // Arrange
    const { execute } = fakeExecute({ main: NOT_ELIGIBLE, develop: verifiedOutcome("develop", 102) });
    const { repository, calls: persistCalls } = fakeRepository({ main: { outcome: "created" }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main).toEqual(NOT_ELIGIBLE);
    expect(result.develop.outcome).toBe("release_pull_request_recorded");
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0].target).toBe("develop");
  });

  it("passes through a create_or_reuse_failed outcome for a target without attempting persistence", async () => {
    // Arrange
    const createFailure: ExecuteEligibleReleasePullRequestOutcome = {
      outcome: "create_or_reuse_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      reason: "create_failed",
      httpStatus: 422,
    };
    const { execute } = fakeExecute({ main: createFailure, develop: verifiedOutcome("develop", 102) });
    const { repository, calls: persistCalls } = fakeRepository({ main: { outcome: "created" }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main).toEqual(createFailure);
    expect(persistCalls).toHaveLength(1);
  });

  it("passes through a verification mismatch outcome for a target without attempting persistence", async () => {
    // Arrange
    const verificationFailure: ExecuteEligibleReleasePullRequestOutcome = {
      outcome: "verification_head_sha_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
      expectedHeadSha: RELEASE_COMMIT_SHA,
      actualHeadSha: "d".repeat(40),
    };
    const { execute } = fakeExecute({ main: verificationFailure, develop: verifiedOutcome("develop", 102) });
    const { repository, calls: persistCalls } = fakeRepository({ main: { outcome: "created" }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main).toEqual(verificationFailure);
    expect(persistCalls).toHaveLength(1);
  });

  it("reports release_pull_request_persistence_error, and never adopts a manually altered PR as conflict, distinctly per target", async () => {
    // Arrange
    const { execute } = fakeExecute({ main: verifiedOutcome("main", 101), develop: verifiedOutcome("develop", 102) });
    const { repository } = fakeRepository({
      main: new Error("firestore unavailable"),
      develop: { outcome: "conflict" },
    });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main).toEqual({ outcome: "release_pull_request_persistence_error", releaseIntentId: RELEASE_INTENT_ID, target: "main" });
    expect(result.develop).toEqual({ outcome: "release_pull_request_conflict", releaseIntentId: RELEASE_INTENT_ID, target: "develop" });
  });

  it.each([
    ["release_intent_not_found", "release_pull_request_intent_not_found"],
    ["release_intent_invalid", "release_pull_request_intent_invalid"],
    ["release_intent_identity_mismatch", "release_pull_request_intent_identity_mismatch"],
    ["release_start_missing", "release_pull_request_start_missing"],
    ["release_start_identity_mismatch", "release_pull_request_start_identity_mismatch"],
  ] as const)("maps repository outcome %s to controller outcome %s", async (repositoryOutcome, controllerOutcome) => {
    // Arrange
    const { execute } = fakeExecute({ main: verifiedOutcome("main", 101), develop: verifiedOutcome("develop", 102) });
    const { repository } = fakeRepository({ main: { outcome: repositoryOutcome }, develop: { outcome: "created" } });

    // Act
    const result = await runReleasePullRequestCompletionController({
      releaseIntentId: RELEASE_INTENT_ID,
      executeEligibleReleasePullRequest: execute,
      repository,
    });

    // Assert
    expect(result.main).toEqual({ outcome: controllerOutcome, releaseIntentId: RELEASE_INTENT_ID, target: "main" });
  });
});
