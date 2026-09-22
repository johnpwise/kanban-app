"use client";

import type { ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { Bug, Calendar, ChevronDown, ChevronUp, NotebookText, Sparkles, Trash2, Wrench } from "lucide-react";

import type { Card, CardLabel, Column } from "@/schemas/board";

import { KANBAN_CARD_TEST_IDS } from "./KanbanCard.testIds";

const LABEL_STYLES: Record<CardLabel, string> = {
  bug: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  feature: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  chore: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const LABEL_ICONS: Record<CardLabel, typeof Bug> = {
  bug: Bug,
  feature: Sparkles,
  chore: Wrench,
};

interface KanbanCardProps {
  card: Card;
  columns: Column[];
  currentColumnId: string;
  onMove: (toColumnId: string) => void;
  onDelete: () => void;
  onReorder: (direction: "up" | "down") => void;
  onOpenCard: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export default function KanbanCard({
  card,
  columns,
  currentColumnId,
  onMove,
  onDelete,
  onReorder,
  onOpenCard,
  canMoveUp,
  canMoveDown,
}: KanbanCardProps) {
  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData("text/plain", card.id);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleMoveChange(event: ChangeEvent<HTMLSelectElement>) {
    const toColumnId = event.target.value;

    if (toColumnId !== currentColumnId) {
      onMove(toColumnId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenCard();
    }
  }

  const LabelIcon = card.label ? LABEL_ICONS[card.label] : null;

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={onOpenCard}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Open details for ${card.title}`}
      data-id={KANBAN_CARD_TEST_IDS.card(card.id)}
      className="cursor-pointer space-y-2.5 rounded-xl border border-slate-200/70 bg-white p-3.5 text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-800/80 dark:hover:border-indigo-900"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-800 dark:text-slate-100">{card.title}</p>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onReorder("up")}
            disabled={!canMoveUp}
            data-id={KANBAN_CARD_TEST_IDS.moveUpButton(card.id)}
            aria-label={`Move ${card.title} up`}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onReorder("down")}
            disabled={!canMoveDown}
            data-id={KANBAN_CARD_TEST_IDS.moveDownButton(card.id)}
            aria-label={`Move ${card.title} down`}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            data-id={KANBAN_CARD_TEST_IDS.deleteButton(card.id)}
            aria-label={`Delete ${card.title}`}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:text-slate-500 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {(card.label || card.dueDate || card.notes) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {card.label && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_STYLES[card.label]}`}
            >
              {LabelIcon && <LabelIcon className="h-3 w-3" aria-hidden="true" />}
              {card.label}
            </span>
          )}
          {card.dueDate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              {new Date(card.dueDate).toLocaleDateString(undefined, { timeZone: "UTC" })}
            </span>
          )}
          {card.notes && (
            <span
              className="inline-flex items-center text-slate-400 dark:text-slate-500"
              aria-label="Has notes"
            >
              <NotebookText className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        Move to
        <select
          value={currentColumnId}
          onChange={handleMoveChange}
          data-id={KANBAN_CARD_TEST_IDS.moveSelect(card.id)}
          className="rounded-md border-slate-300 py-0.5 pl-2 text-xs dark:border-slate-600 dark:bg-slate-900"
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
