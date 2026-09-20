import type { AddCardRequest, Board, DeleteCardRequest, MoveCardRequest, UpdateCardRequest } from "@/schemas/board";

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

export function addCardToBoard(board: Board, request: AddCardRequest, createdBy: string): Board {
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
  const now = new Date().toISOString();
  const card = {
    id: request.cardId,
    title: request.title,
    label: request.label,
    createdAt: now,
    notes: null,
    dueDate: null,
    prompt: request.prompt,
    executionStatus: "not_started" as const,
    createdBy,
    updatedAt: now,
  };

  return { columns, cardsById: { ...board.cardsById, [request.cardId]: card } };
}

export function updateCardInBoard(board: Board, request: UpdateCardRequest): Board {
  const card = board.cardsById[request.cardId];

  if (!card) {
    throw new Error(`Card "${request.cardId}" was not found on the board.`);
  }

  return {
    ...board,
    cardsById: {
      ...board.cardsById,
      [request.cardId]: {
        ...card,
        notes: request.notes,
        dueDate: request.dueDate,
        updatedAt: new Date().toISOString(),
      },
    },
  };
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
