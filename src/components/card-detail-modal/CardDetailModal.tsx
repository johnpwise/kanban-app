"use client";

import { useEffect, useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { Calendar, Check, X } from "lucide-react";

import type { Card } from "@/schemas/board";

import { CARD_DETAIL_MODAL_TEST_IDS } from "./CardDetailModal.testIds";

interface CardDetailModalProps {
  card: Card | null;
  onClose: () => void;
  onSave: (cardId: string, notes: string, dueDate: string | null) => void;
}

export default function CardDetailModal({ card, onClose, onSave }: CardDetailModalProps) {
  const [notes, setNotes] = useState(() => card?.notes ?? "");
  const [dueDate, setDueDate] = useState(() => card?.dueDate ?? "");
  const notesInputId = useId();
  const dueDateInputId = useId();

  useEffect(() => {
    if (!card) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [card, onClose]);

  if (!card) {
    return null;
  }

  function handleSave() {
    if (!card) {
      return;
    }

    onSave(card.id, notes, dueDate === "" ? null : dueDate);
    onClose();
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${notesInputId}-title`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
        data-id={CARD_DETAIL_MODAL_TEST_IDS.dialog}
        className="w-full max-w-md space-y-5 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id={`${notesInputId}-title`} className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              {card.title}
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              Created {new Date(card.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={notesInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Notes
          </label>
          <textarea
            id={notesInputId}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            data-id={CARD_DETAIL_MODAL_TEST_IDS.notesInput}
            rows={4}
            className="rounded-lg border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={dueDateInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Due date
          </label>
          <input
            id={dueDateInputId}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            data-id={CARD_DETAIL_MODAL_TEST_IDS.dueDateInput}
            className="rounded-lg border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-800 dark:[color-scheme:dark]"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            data-id={CARD_DETAIL_MODAL_TEST_IDS.cancelButton}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            data-id={CARD_DETAIL_MODAL_TEST_IDS.saveButton}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
