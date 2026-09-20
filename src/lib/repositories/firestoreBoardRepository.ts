import { Timestamp } from "firebase-admin/firestore";

import { deleteCardFromBoard, moveCardInBoard } from "@/lib/domain/board";
import { boardSchema } from "@/schemas/board";
import { projectNameSchema, projectSchema } from "@/schemas/project";

import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import type {
  AddCardRequest,
  Board,
  DeleteCardRequest,
  ExecutionStatus,
  MoveCardRequest,
  UpdateCardRequest,
} from "@/schemas/board";
import type { Project } from "@/schemas/project";

const DEFAULT_COLUMNS = [
  { id: "todo", title: "To Do", position: 0 },
  { id: "in-progress", title: "In Progress", position: 1 },
  { id: "done", title: "Done", position: 2 },
] as const;

const DEMO_CARD_CREATED_BY = "demo-seed";

const DEMO_CARDS = [
  {
    id: "card-1",
    title: "Design the board schema",
    label: "feature",
    createdAt: "2026-01-05T09:00:00.000Z",
    prompt: "Design the Firestore board schema for the kanban app.",
  },
  {
    id: "card-2",
    title: "Fix the drag ghost image",
    label: "bug",
    createdAt: "2026-01-06T09:00:00.000Z",
    prompt: "Fix the drag ghost image so it matches the card being dragged.",
  },
  {
    id: "card-3",
    title: "Wire up CI",
    label: "chore",
    createdAt: "2026-01-07T09:00:00.000Z",
    prompt: "Wire up continuous integration for the kanban app repo.",
  },
] as const;

interface ProjectDocument {
  name: string;
  createdAt: Timestamp;
}

interface ColumnDocument {
  title: string;
  position: number;
  cardIds: string[];
}

interface CardDocument {
  title: string;
  label: AddCardRequest["label"];
  createdAt: Timestamp;
  notes: string | null;
  dueDate: string | null;
  prompt: string;
  executionStatus: ExecutionStatus;
  createdBy: string;
  updatedAt: Timestamp;
}

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project "${projectId}" was not found.`);
    this.name = "ProjectNotFoundError";
  }
}

function mapProject(snapshot: QueryDocumentSnapshot): Project {
  const data = snapshot.data() as ProjectDocument;

  return projectSchema.parse({
    id: snapshot.id,
    name: data.name,
    createdAt: data.createdAt.toDate().toISOString(),
  });
}

function projectReference(firestore: Firestore, projectId: string) {
  return firestore.collection("projects").doc(projectId);
}

async function requireUpdatedBoard(firestore: Firestore, projectId: string): Promise<Board> {
  const board = await getProjectBoard(firestore, projectId);

  if (!board) {
    throw new ProjectNotFoundError(projectId);
  }

  return board;
}

export async function listProjects(firestore: Firestore): Promise<Project[]> {
  const snapshot = await firestore.collection("projects").orderBy("createdAt", "asc").get();

  return snapshot.docs.map(mapProject);
}

export async function createProject(firestore: Firestore, name: string): Promise<Project> {
  const parsedName = projectNameSchema.parse(name);
  const reference = firestore.collection("projects").doc();
  const createdAt = Timestamp.now();
  const batch = firestore.batch();

  batch.create(reference, { name: parsedName, createdAt } satisfies ProjectDocument);

  for (const column of DEFAULT_COLUMNS) {
    batch.create(reference.collection("columns").doc(column.id), {
      title: column.title,
      position: column.position,
      cardIds: [],
    } satisfies ColumnDocument);
  }

  await batch.commit();

  return projectSchema.parse({ id: reference.id, name: parsedName, createdAt: createdAt.toDate().toISOString() });
}

export async function seedDemoProject(firestore: Firestore): Promise<Project> {
  const projects = firestore.collection("projects");
  const reference = projects.doc();

  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(projects.where("name", "==", "Demo Project").limit(1));

    if (!existing.empty) {
      return mapProject(existing.docs[0]);
    }

    const createdAt = Timestamp.now();
    transaction.create(reference, { name: "Demo Project", createdAt } satisfies ProjectDocument);

    for (const column of DEFAULT_COLUMNS) {
      const cardIds =
        column.id === "todo" ? ["card-1", "card-2"] : column.id === "in-progress" ? ["card-3"] : [];
      transaction.create(reference.collection("columns").doc(column.id), {
        title: column.title,
        position: column.position,
        cardIds,
      } satisfies ColumnDocument);
    }

    for (const card of DEMO_CARDS) {
      const cardCreatedAt = Timestamp.fromDate(new Date(card.createdAt));

      transaction.create(reference.collection("cards").doc(card.id), {
        title: card.title,
        label: card.label,
        createdAt: cardCreatedAt,
        notes: null,
        dueDate: null,
        prompt: card.prompt,
        executionStatus: "not_started",
        createdBy: DEMO_CARD_CREATED_BY,
        updatedAt: cardCreatedAt,
      } satisfies CardDocument);
    }

    return projectSchema.parse({
      id: reference.id,
      name: "Demo Project",
      createdAt: createdAt.toDate().toISOString(),
    });
  });
}

export async function getProject(firestore: Firestore, projectId: string): Promise<Project | null> {
  const snapshot = await projectReference(firestore, projectId).get();

  return snapshot.exists ? mapProject(snapshot as QueryDocumentSnapshot) : null;
}

export async function getProjectBoard(firestore: Firestore, projectId: string): Promise<Board | null> {
  const reference = projectReference(firestore, projectId);
  const [projectSnapshot, columnsSnapshot, cardsSnapshot] = await Promise.all([
    reference.get(),
    reference.collection("columns").orderBy("position", "asc").get(),
    reference.collection("cards").get(),
  ]);

  if (!projectSnapshot.exists) {
    return null;
  }

  const columns = columnsSnapshot.docs.map((snapshot) => {
    const data = snapshot.data() as ColumnDocument;

    return { id: snapshot.id, title: data.title, cardIds: data.cardIds };
  });

  const cardsById = Object.fromEntries(
    cardsSnapshot.docs.map((snapshot) => {
      const data = snapshot.data() as CardDocument;

      return [
        snapshot.id,
        {
          id: snapshot.id,
          title: data.title,
          label: data.label ?? null,
          createdAt: data.createdAt.toDate().toISOString(),
          notes: data.notes ?? null,
          dueDate: data.dueDate ?? null,
          prompt: data.prompt,
          executionStatus: data.executionStatus,
          createdBy: data.createdBy,
          updatedAt: data.updatedAt.toDate().toISOString(),
        },
      ];
    }),
  );

  return boardSchema.parse({ columns, cardsById });
}

export async function addCard(
  firestore: Firestore,
  projectId: string,
  request: AddCardRequest,
  createdBy: string,
): Promise<Board> {
  const reference = projectReference(firestore, projectId);
  const columnReference = reference.collection("columns").doc(request.columnId);
  const cardReference = reference.collection("cards").doc(request.cardId);

  await firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, columnSnapshot, cardSnapshot] = await transaction.getAll(
      reference,
      columnReference,
      cardReference,
    );

    if (!projectSnapshot.exists) {
      throw new ProjectNotFoundError(projectId);
    }
    if (!columnSnapshot.exists) {
      throw new Error(`Column "${request.columnId}" was not found on the board.`);
    }
    if (cardSnapshot.exists) {
      throw new Error(`Card "${request.cardId}" already exists on the board.`);
    }

    const now = Timestamp.now();

    transaction.create(cardReference, {
      title: request.title,
      label: request.label,
      createdAt: now,
      notes: null,
      dueDate: null,
      prompt: request.prompt,
      executionStatus: "not_started",
      createdBy,
      updatedAt: now,
    } satisfies CardDocument);
    const column = columnSnapshot.data() as ColumnDocument;
    transaction.update(columnReference, { cardIds: [...column.cardIds, request.cardId] });
  });

  return requireUpdatedBoard(firestore, projectId);
}

export async function moveCard(
  firestore: Firestore,
  projectId: string,
  request: MoveCardRequest,
): Promise<Board> {
  const reference = projectReference(firestore, projectId);

  await firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, columnsSnapshot, cardsSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(reference.collection("columns").orderBy("position", "asc")),
      transaction.get(reference.collection("cards")),
    ]);

    if (!projectSnapshot.exists) {
      throw new ProjectNotFoundError(projectId);
    }

    const board = boardSchema.parse({
      columns: columnsSnapshot.docs.map((snapshot) => {
        const data = snapshot.data() as ColumnDocument;
        return { id: snapshot.id, title: data.title, cardIds: data.cardIds };
      }),
      cardsById: Object.fromEntries(
        cardsSnapshot.docs.map((snapshot) => {
          const data = snapshot.data() as CardDocument;
          return [
            snapshot.id,
            {
              id: snapshot.id,
              title: data.title,
              label: data.label ?? null,
              createdAt: data.createdAt.toDate().toISOString(),
              notes: data.notes ?? null,
              dueDate: data.dueDate ?? null,
              prompt: data.prompt,
              executionStatus: data.executionStatus,
              createdBy: data.createdBy,
              updatedAt: data.updatedAt.toDate().toISOString(),
            },
          ];
        }),
      ),
    });
    const updatedBoard = moveCardInBoard(board, request);

    for (const column of updatedBoard.columns) {
      transaction.update(reference.collection("columns").doc(column.id), { cardIds: column.cardIds });
    }
  });

  return requireUpdatedBoard(firestore, projectId);
}

export async function updateCard(
  firestore: Firestore,
  projectId: string,
  request: UpdateCardRequest,
): Promise<Board> {
  const reference = projectReference(firestore, projectId);
  const cardReference = reference.collection("cards").doc(request.cardId);

  await firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, cardSnapshot] = await transaction.getAll(reference, cardReference);

    if (!projectSnapshot.exists) {
      throw new ProjectNotFoundError(projectId);
    }
    if (!cardSnapshot.exists) {
      throw new Error(`Card "${request.cardId}" was not found on the board.`);
    }

    transaction.update(cardReference, {
      notes: request.notes,
      dueDate: request.dueDate,
      updatedAt: Timestamp.now(),
    });
  });

  return requireUpdatedBoard(firestore, projectId);
}

export async function deleteCard(
  firestore: Firestore,
  projectId: string,
  request: DeleteCardRequest,
): Promise<Board> {
  const reference = projectReference(firestore, projectId);
  const cardReference = reference.collection("cards").doc(request.cardId);

  await firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, cardSnapshot, columnsSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(cardReference),
      transaction.get(reference.collection("columns").orderBy("position", "asc")),
    ]);

    if (!projectSnapshot.exists) {
      throw new ProjectNotFoundError(projectId);
    }
    if (!cardSnapshot.exists) {
      throw new Error(`Card "${request.cardId}" was not found on the board.`);
    }

    const board = boardSchema.parse({
      columns: columnsSnapshot.docs.map((snapshot) => {
        const data = snapshot.data() as ColumnDocument;
        return { id: snapshot.id, title: data.title, cardIds: data.cardIds };
      }),
      cardsById: {
        [request.cardId]: {
          id: request.cardId,
          ...(cardSnapshot.data() as CardDocument),
          createdAt: (cardSnapshot.data() as CardDocument).createdAt.toDate().toISOString(),
          updatedAt: (cardSnapshot.data() as CardDocument).updatedAt.toDate().toISOString(),
        },
      },
    });
    const updatedBoard = deleteCardFromBoard(board, request);

    for (const column of updatedBoard.columns) {
      transaction.update(reference.collection("columns").doc(column.id), { cardIds: column.cardIds });
    }
    transaction.delete(cardReference);
  });

  return requireUpdatedBoard(firestore, projectId);
}
