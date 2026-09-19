import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  addCard,
  createProject,
  deleteCard,
  getProjectBoard,
  listProjects,
  moveCard,
  seedDemoProject,
  updateCard,
} from "./firestoreBoardRepository";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

describeWithEmulator("Firestore board repository", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `repository-${randomUUID()}`);
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
    await deleteApp(app);
  });

  it("should create and list a project with three empty default columns", async () => {
    const project = await createProject(firestore, "  Project Alpha  ");
    createdProjectIds.push(project.id);

    const board = await getProjectBoard(firestore, project.id);
    const projects = await listProjects(firestore);

    expect(project).toMatchObject({ name: "Project Alpha", createdAt: expect.any(String) });
    expect(board?.columns).toEqual([
      { id: "todo", title: "To Do", cardIds: [] },
      { id: "in-progress", title: "In Progress", cardIds: [] },
      { id: "done", title: "Done", cardIds: [] },
    ]);
    expect(board?.cardsById).toEqual({});
    expect(projects).toContainEqual(project);
  });

  it("should keep card mutations isolated to their project", async () => {
    const firstProject = await createProject(firestore, "First project");
    const secondProject = await createProject(firestore, "Second project");
    createdProjectIds.push(firstProject.id, secondProject.id);

    await addCard(firestore, firstProject.id, {
      cardId: "card-1",
      columnId: "todo",
      title: "Only in first",
      label: "feature",
    });
    await moveCard(firestore, firstProject.id, { cardId: "card-1", toColumnId: "done", toIndex: 0 });
    await updateCard(firestore, firstProject.id, {
      cardId: "card-1",
      notes: "Ready",
      dueDate: "2026-10-01",
    });

    const firstBoard = await getProjectBoard(firestore, firstProject.id);
    const secondBoard = await getProjectBoard(firestore, secondProject.id);

    expect(firstBoard?.columns.find((column) => column.id === "done")?.cardIds).toEqual(["card-1"]);
    expect(firstBoard?.cardsById["card-1"]).toMatchObject({ notes: "Ready", dueDate: "2026-10-01" });
    expect(secondBoard?.cardsById).toEqual({});

    await deleteCard(firestore, firstProject.id, { cardId: "card-1" });
    expect((await getProjectBoard(firestore, firstProject.id))?.cardsById).toEqual({});
  });

  it("should return null for a missing project", async () => {
    await expect(getProjectBoard(firestore, "missing-project")).resolves.toBeNull();
  });

  it("should seed the existing sample board as one idempotent Demo Project", async () => {
    const first = await seedDemoProject(firestore);
    const second = await seedDemoProject(firestore);
    createdProjectIds.push(first.id);

    const board = await getProjectBoard(firestore, first.id);

    expect(second.id).toBe(first.id);
    expect(first.name).toBe("Demo Project");
    expect(board?.columns.find((column) => column.id === "todo")?.cardIds).toEqual(["card-1", "card-2"]);
    expect(board?.cardsById["card-3"]).toMatchObject({
      title: "Wire up CI",
      label: "chore",
      createdAt: "2026-01-07T09:00:00.000Z",
      notes: null,
      dueDate: null,
    });
  });
});
