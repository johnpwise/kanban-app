import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { boardSchema } from "@/schemas/board";

import type { AddCardRequest, Board, DeleteCardRequest, MoveCardRequest, UpdateCardRequest } from "@/schemas/board";

const seedBoard: Board = {
  columns: [
    { id: "todo", title: "To Do", cardIds: ["card-1", "card-2"] },
    { id: "in-progress", title: "In Progress", cardIds: ["card-3"] },
    { id: "done", title: "Done", cardIds: [] },
  ],
  cardsById: {
    "card-1": {
      id: "card-1",
      title: "Design the board schema",
      label: "feature",
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
    },
    "card-2": {
      id: "card-2",
      title: "Fix the drag ghost image",
      label: "bug",
      createdAt: "2026-01-06T09:00:00.000Z",
      notes: null,
      dueDate: null,
    },
    "card-3": {
      id: "card-3",
      title: "Wire up CI",
      label: "chore",
      createdAt: "2026-01-07T09:00:00.000Z",
      notes: null,
      dueDate: null,
    },
  },
};

export function moveCardInBoard(board: Board, request: MoveCardRequest): Board {
  const fromColumn = board.columns.find((column) => column.cardIds.includes(request.cardId));

  if (!fromColumn) {
    throw new Error(`Card "${request.cardId}" was not found on the board.`);
  }

  const toColumn = board.columns.find((column) => column.id === request.toColumnId);

  if (!toColumn) {
    throw new Error(`Column "${request.toColumnId}" was not found on the board.`);
  }

  const columns = board.columns.map((column) => {
    const withoutCard =
      column.id === fromColumn.id
        ? column.cardIds.filter((cardId) => cardId !== request.cardId)
        : column.cardIds;

    if (column.id !== toColumn.id) {
      return { ...column, cardIds: withoutCard };
    }

    const toIndex = Math.min(request.toIndex, withoutCard.length);
    const cardIds = [...withoutCard.slice(0, toIndex), request.cardId, ...withoutCard.slice(toIndex)];

    return { ...column, cardIds };
  });

  return { ...board, columns };
}

export function addCardToBoard(board: Board, request: AddCardRequest): Board {
  if (board.cardsById[request.cardId]) {
    throw new Error(`Card "${request.cardId}" already exists on the board.`);
  }

  const column = board.columns.find((column) => column.id === request.columnId);

  if (!column) {
    throw new Error(`Column "${request.columnId}" was not found on the board.`);
  }

  const columns = board.columns.map((column) =>
    column.id === request.columnId ? { ...column, cardIds: [...column.cardIds, request.cardId] } : column,
  );

  const card = {
    id: request.cardId,
    title: request.title,
    label: request.label,
    createdAt: new Date().toISOString(),
    notes: null,
    dueDate: null,
  };

  return { columns, cardsById: { ...board.cardsById, [request.cardId]: card } };
}

export function updateCardInBoard(board: Board, request: UpdateCardRequest): Board {
  const card = board.cardsById[request.cardId];

  if (!card) {
    throw new Error(`Card "${request.cardId}" was not found on the board.`);
  }

  const updatedCard = { ...card, notes: request.notes, dueDate: request.dueDate };

  return { ...board, cardsById: { ...board.cardsById, [request.cardId]: updatedCard } };
}

export function deleteCardFromBoard(board: Board, request: DeleteCardRequest): Board {
  if (!board.cardsById[request.cardId]) {
    throw new Error(`Card "${request.cardId}" was not found on the board.`);
  }

  const columns = board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((cardId) => cardId !== request.cardId),
  }));

  const cardsById = { ...board.cardsById };

  delete cardsById[request.cardId];

  return { columns, cardsById };
}

export async function readPersistedBoard(filePath: string): Promise<Board | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = boardSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writePersistedBoard(filePath: string, board: Board): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(board, null, 2), "utf-8");
}

const BOARD_FILE_PATH = path.join(process.cwd(), ".data", "board.json");

// Disabled under Vitest so unit tests keep running against a fresh in-memory board on every run,
// instead of reading/writing the same file the running app persists to.
const persistenceEnabled = process.env.VITEST === undefined;

let currentBoard: Board = structuredClone(seedBoard);
let loaded = !persistenceEnabled;

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }

  loaded = true;

  const persisted = await readPersistedBoard(BOARD_FILE_PATH);

  if (persisted) {
    currentBoard = persisted;
  }
}

async function persist(): Promise<void> {
  if (!persistenceEnabled) {
    return;
  }

  try {
    await writePersistedBoard(BOARD_FILE_PATH, currentBoard);
  } catch {
    // Persistence is best-effort; keep serving the in-memory copy if the write fails.
  }
}

export async function getBoard(): Promise<Board> {
  await ensureLoaded();

  return structuredClone(currentBoard);
}

export async function moveCard(request: MoveCardRequest): Promise<Board> {
  await ensureLoaded();
  currentBoard = moveCardInBoard(currentBoard, request);
  await persist();

  return structuredClone(currentBoard);
}

export async function addCard(request: AddCardRequest): Promise<Board> {
  await ensureLoaded();
  currentBoard = addCardToBoard(currentBoard, request);
  await persist();

  return structuredClone(currentBoard);
}

export async function deleteCard(request: DeleteCardRequest): Promise<Board> {
  await ensureLoaded();
  currentBoard = deleteCardFromBoard(currentBoard, request);
  await persist();

  return structuredClone(currentBoard);
}

export async function updateCard(request: UpdateCardRequest): Promise<Board> {
  await ensureLoaded();
  currentBoard = updateCardInBoard(currentBoard, request);
  await persist();

  return structuredClone(currentBoard);
}
