"use client";

import { startTransition, useActionState, useOptimistic, useState } from "react";

import CardDetailModal from "@/components/card-detail-modal/CardDetailModal";
import KanbanColumn from "@/components/kanban-column/KanbanColumn";

import { addCardAction } from "@/actions/addCard";
import { deleteCardAction } from "@/actions/deleteCard";
import { moveCardAction } from "@/actions/moveCard";
import { updateCardAction } from "@/actions/updateCard";
import { useBoardFilterStore } from "@/store/boardFilterStore";

import type {
  AddCardRequest,
  Board,
  CardLabel,
  DeleteCardRequest,
  MoveCardRequest,
  UpdateCardRequest,
} from "@/schemas/board";

import { KANBAN_BOARD_TEST_IDS } from "./KanbanBoard.testIds";

interface KanbanBoardProps {
  initialBoard: Board;
}

interface BoardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

type BoardMutation =
  | { kind: "move"; request: MoveCardRequest }
  | { kind: "add"; request: AddCardRequest }
  | { kind: "delete"; request: DeleteCardRequest }
  | { kind: "update"; request: UpdateCardRequest };

async function dispatchBoardMutation(_previousState: BoardActionState, mutation: BoardMutation): Promise<BoardActionState> {
  switch (mutation.kind) {
    case "move":
      return moveCardAction({ status: "idle" }, mutation.request);
    case "add":
      return addCardAction({ status: "idle" }, mutation.request);
    case "delete":
      return deleteCardAction({ status: "idle" }, mutation.request);
    case "update":
      return updateCardAction({ status: "idle" }, mutation.request);
  }
}

function applyOptimisticMove(board: Board, request: MoveCardRequest): Board {
  const fromColumn = board.columns.find((column) => column.cardIds.includes(request.cardId));
  const toColumnExists = board.columns.some((column) => column.id === request.toColumnId);

  if (!fromColumn || !toColumnExists) {
    return board;
  }

  const columns = board.columns.map((column) => {
    const withoutCard =
      column.id === fromColumn.id
        ? column.cardIds.filter((cardId) => cardId !== request.cardId)
        : column.cardIds;

    if (column.id !== request.toColumnId) {
      return { ...column, cardIds: withoutCard };
    }

    const toIndex = Math.min(request.toIndex, withoutCard.length);
    const cardIds = [...withoutCard.slice(0, toIndex), request.cardId, ...withoutCard.slice(toIndex)];

    return { ...column, cardIds };
  });

  return { ...board, columns };
}

function applyOptimisticAdd(board: Board, request: AddCardRequest): Board {
  const column = board.columns.find((column) => column.id === request.columnId);

  if (!column || board.cardsById[request.cardId]) {
    return board;
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

function applyOptimisticDelete(board: Board, request: DeleteCardRequest): Board {
  if (!board.cardsById[request.cardId]) {
    return board;
  }

  const columns = board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((cardId) => cardId !== request.cardId),
  }));

  const cardsById = { ...board.cardsById };

  delete cardsById[request.cardId];

  return { columns, cardsById };
}

function applyOptimisticUpdate(board: Board, request: UpdateCardRequest): Board {
  const card = board.cardsById[request.cardId];

  if (!card) {
    return board;
  }

  const updatedCard = { ...card, notes: request.notes, dueDate: request.dueDate };

  return { ...board, cardsById: { ...board.cardsById, [request.cardId]: updatedCard } };
}

function applyOptimisticMutation(board: Board, mutation: BoardMutation): Board {
  switch (mutation.kind) {
    case "move":
      return applyOptimisticMove(board, mutation.request);
    case "add":
      return applyOptimisticAdd(board, mutation.request);
    case "delete":
      return applyOptimisticDelete(board, mutation.request);
    case "update":
      return applyOptimisticUpdate(board, mutation.request);
  }
}

const initialActionState: BoardActionState = { status: "idle" };

export default function KanbanBoard({ initialBoard }: KanbanBoardProps) {
  const [actionState, dispatchMutation] = useActionState(dispatchBoardMutation, initialActionState);
  const confirmedBoard = actionState.board ?? initialBoard;
  const [optimisticBoard, applyOptimistic] = useOptimistic(confirmedBoard, applyOptimisticMutation);
  const activeLabel = useBoardFilterStore((state) => state.activeLabel);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  function handleMoveCard(cardId: string, toColumnId: string) {
    const toColumn = optimisticBoard.columns.find((column) => column.id === toColumnId);

    if (!toColumn || toColumn.cardIds.includes(cardId)) {
      return;
    }

    const request: MoveCardRequest = { cardId, toColumnId, toIndex: toColumn.cardIds.length };

    startTransition(() => {
      applyOptimistic({ kind: "move", request });
      dispatchMutation({ kind: "move", request });
    });
  }

  function handleAddCard(columnId: string, title: string, label: CardLabel | null) {
    const request: AddCardRequest = { cardId: crypto.randomUUID(), columnId, title, label };

    startTransition(() => {
      applyOptimistic({ kind: "add", request });
      dispatchMutation({ kind: "add", request });
    });
  }

  function handleDeleteCard(cardId: string) {
    const request: DeleteCardRequest = { cardId };

    startTransition(() => {
      applyOptimistic({ kind: "delete", request });
      dispatchMutation({ kind: "delete", request });
    });
  }

  function handleReorderCard(cardId: string, direction: "up" | "down") {
    const column = optimisticBoard.columns.find((column) => column.cardIds.includes(cardId));

    if (!column) {
      return;
    }

    const currentIndex = column.cardIds.indexOf(cardId);
    const toIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (toIndex < 0 || toIndex > column.cardIds.length - 1) {
      return;
    }

    const request: MoveCardRequest = { cardId, toColumnId: column.id, toIndex };

    startTransition(() => {
      applyOptimistic({ kind: "move", request });
      dispatchMutation({ kind: "move", request });
    });
  }

  function handleUpdateCard(cardId: string, notes: string, dueDate: string | null) {
    const request: UpdateCardRequest = { cardId, notes, dueDate };

    startTransition(() => {
      applyOptimistic({ kind: "update", request });
      dispatchMutation({ kind: "update", request });
    });
  }

  return (
    <div data-id={KANBAN_BOARD_TEST_IDS.board} className="space-y-3">
      <div className="flex flex-wrap gap-3.5">
        {optimisticBoard.columns.map((column) => {
          const cards = column.cardIds
            .map((cardId) => optimisticBoard.cardsById[cardId])
            .filter((card) => card !== undefined)
            .filter((card) => activeLabel === null || card.label === activeLabel);

          return (
            <KanbanColumn
              key={column.id}
              column={column}
              cards={cards}
              columns={optimisticBoard.columns}
              onDropCard={handleMoveCard}
              onMoveCard={handleMoveCard}
              onAddCard={handleAddCard}
              onDeleteCard={handleDeleteCard}
              onReorderCard={handleReorderCard}
              onOpenCard={setOpenCardId}
            />
          );
        })}
      </div>
      {actionState.status === "error" && (
        <p
          role="status"
          data-id={KANBAN_BOARD_TEST_IDS.status}
          className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-400"
        >
          {actionState.message}
        </p>
      )}
      <CardDetailModal
        key={openCardId ?? "none"}
        card={openCardId ? (optimisticBoard.cardsById[openCardId] ?? null) : null}
        onClose={() => setOpenCardId(null)}
        onSave={handleUpdateCard}
      />
    </div>
  );
}
