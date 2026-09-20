import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { addCard, createProject, getProjectBoard } from "./firestoreBoardRepository";
import {
  ExecutionCardNotFoundError,
  ExecutionNotAllowedError,
  ExecutionProjectNotFoundError,
  createExecutionRequest,
} from "./firestoreExecutionRepository";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

describeWithEmulator("Firestore execution repository", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `execution-repository-${randomUUID()}`);
  const firestore = getFirestore(app);
  const createdProjectIds: string[] = [];

  beforeAll(() => {
    expect(emulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(projectId).toMatch(/^demo-/);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await firestore.recursiveDelete(firestore.collection("projects").doc(id));
    }
    await firestore.recursiveDelete(firestore.collection("executionRequests"));
    await deleteApp(app);
  });

  async function createProjectWithCard() {
    const project = await createProject(firestore, {
      name: "Execution project",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
    });
    createdProjectIds.push(project.id);

    await addCard(
      firestore,
      project.id,
      {
        cardId: `card-${randomUUID()}`,
        columnId: "todo",
        title: "Wire up CI",
        label: "chore",
        prompt: "Wire up continuous integration for the kanban app repo.",
      },
      "creator-1",
    );
    const board = await getProjectBoard(firestore, project.id);
    const cardId = Object.keys(board?.cardsById ?? {})[0]!;

    return { project, cardId };
  }

  it("should create an execution request snapshotting the card and project, and queue the task", async () => {
    const { project, cardId } = await createProjectWithCard();

    const executionRequest = await createExecutionRequest(firestore, {
      projectId: project.id,
      cardId,
      requestedBy: "requester-1",
    });

    expect(executionRequest).toMatchObject({
      projectId: project.id,
      cardId,
      title: "Wire up CI",
      prompt: "Wire up continuous integration for the kanban app repo.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "requester-1",
    });
    expect(executionRequest.id).toEqual(expect.any(String));
    expect(executionRequest.requestedAt).toEqual(expect.any(String));

    const board = await getProjectBoard(firestore, project.id);
    expect(board?.cardsById[cardId]?.executionStatus).toBe("queued");
  });

  it("should update the card's updatedAt when queuing", async () => {
    const { project, cardId } = await createProjectWithCard();
    const boardBefore = await getProjectBoard(firestore, project.id);
    const updatedAtBefore = boardBefore?.cardsById[cardId]?.updatedAt;

    await createExecutionRequest(firestore, { projectId: project.id, cardId, requestedBy: "requester-1" });

    const boardAfter = await getProjectBoard(firestore, project.id);
    expect(boardAfter?.cardsById[cardId]?.updatedAt).not.toEqual(updatedAtBefore);
  });

  it("should reject a request for a missing project", async () => {
    await expect(
      createExecutionRequest(firestore, { projectId: "missing-project", cardId: "card-1", requestedBy: "requester-1" }),
    ).rejects.toBeInstanceOf(ExecutionProjectNotFoundError);
  });

  it("should reject a request for a missing card", async () => {
    const project = await createProject(firestore, {
      name: "No cards yet",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
    });
    createdProjectIds.push(project.id);

    await expect(
      createExecutionRequest(firestore, { projectId: project.id, cardId: "missing-card", requestedBy: "requester-1" }),
    ).rejects.toBeInstanceOf(ExecutionCardNotFoundError);
  });

  it("should reject a duplicate request for a card that is no longer not_started", async () => {
    const { project, cardId } = await createProjectWithCard();
    await createExecutionRequest(firestore, { projectId: project.id, cardId, requestedBy: "requester-1" });

    await expect(
      createExecutionRequest(firestore, { projectId: project.id, cardId, requestedBy: "requester-2" }),
    ).rejects.toBeInstanceOf(ExecutionNotAllowedError);
  });

  it("should leave no partial state when a request fails because the task is not available", async () => {
    const { project, cardId } = await createProjectWithCard();
    await createExecutionRequest(firestore, { projectId: project.id, cardId, requestedBy: "requester-1" });
    const boardBeforeRetry = await getProjectBoard(firestore, project.id);
    const updatedAtBeforeRetry = boardBeforeRetry?.cardsById[cardId]?.updatedAt;

    await expect(
      createExecutionRequest(firestore, { projectId: project.id, cardId, requestedBy: "requester-2" }),
    ).rejects.toBeInstanceOf(ExecutionNotAllowedError);

    const executionRequests = await firestore
      .collection("executionRequests")
      .where("cardId", "==", cardId)
      .get();
    expect(executionRequests.size).toBe(1);

    const boardAfterRetry = await getProjectBoard(firestore, project.id);
    expect(boardAfterRetry?.cardsById[cardId]?.updatedAt).toEqual(updatedAtBeforeRetry);
    expect(boardAfterRetry?.cardsById[cardId]?.executionStatus).toBe("queued");
  });
});
