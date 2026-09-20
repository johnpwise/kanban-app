"use client";

import type { DragEvent } from "react";

import AddCardForm from "@/components/add-card-form/AddCardForm";
import KanbanCard from "@/components/kanban-card/KanbanCard";

import type { Card, CardLabel, Column } from "@/schemas/board";

import { KANBAN_COLUMN_TEST_IDS } from "./KanbanColumn.testIds";

interface KanbanColumnProps {
  column: Column;
  cards: Card[];
  columns: Column[];
  onDropCard: (cardId: string, toColumnId: string) => void;
  onMoveCard: (cardId: string, toColumnId: string) => void;
  onAddCard: (columnId: string, title: string, label: CardLabel | null, prompt: string) => void;
  onDeleteCard: (cardId: string) => void;
  onReorderCard: (cardId: string, direction: "up" | "down") => void;
  onOpenCard: (cardId: string) => void;
}

export default function KanbanColumn({
  column,
  cards,
  columns,
  onDropCard,
  onMoveCard,
  onAddCard,
  onDeleteCard,
  onReorderCard,
  onOpenCard,
}: KanbanColumnProps) {
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const cardId = event.dataTransfer.getData("text/plain");

    if (cardId) {
      onDropCard(cardId, column.id);
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-id={KANBAN_COLUMN_TEST_IDS.column(column.id)}
      className="flex min-w-[260px] flex-1 flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 shadow-sm backdrop-blur transition-colors dark:border-slate-800 dark:bg-slate-900/40"
    >
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
        <span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden="true" />
        {column.title} <span className="text-slate-400 dark:text-slate-500">({cards.length})</span>
      </h2>
      <AddCardForm
        columnId={column.id}
        onAddCard={(title, label, prompt) => onAddCard(column.id, title, label, prompt)}
      />
      <div data-id={KANBAN_COLUMN_TEST_IDS.cardList(column.id)} className="flex flex-col gap-2.5">
        {cards.map((card) => {
          const cardIndex = column.cardIds.indexOf(card.id);

          return (
            <KanbanCard
              key={card.id}
              card={card}
              columns={columns}
              currentColumnId={column.id}
              onMove={(toColumnId) => onMoveCard(card.id, toColumnId)}
              onDelete={() => onDeleteCard(card.id)}
              onReorder={(direction) => onReorderCard(card.id, direction)}
              onOpenCard={() => onOpenCard(card.id)}
              canMoveUp={cardIndex > 0}
              canMoveDown={cardIndex < column.cardIds.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}
