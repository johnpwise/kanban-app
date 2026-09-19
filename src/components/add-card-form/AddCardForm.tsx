"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";

import type { CardLabel } from "@/schemas/board";

import { ADD_CARD_FORM_TEST_IDS } from "./AddCardForm.testIds";

interface AddCardFormProps {
  columnId: string;
  onAddCard: (title: string, label: CardLabel | null) => void;
}

export default function AddCardForm({ columnId, onAddCard }: AddCardFormProps) {
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState<CardLabel | "">("");
  const titleInputId = useId();
  const labelSelectId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    onAddCard(trimmedTitle, label === "" ? null : label);
    setTitle("");
    setLabel("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-id={ADD_CARD_FORM_TEST_IDS.form(columnId)}
      className="flex flex-wrap items-end gap-2 border-b border-slate-200/70 pb-3 dark:border-slate-800"
    >
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={titleInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
          New card title
        </label>
        <input
          id={titleInputId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          data-id={ADD_CARD_FORM_TEST_IDS.titleInput(columnId)}
          className="rounded-md border-slate-300 px-2 py-1 text-xs shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
          placeholder="Card title"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={labelSelectId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Label
        </label>
        <select
          id={labelSelectId}
          value={label}
          onChange={(event) => setLabel(event.target.value as CardLabel | "")}
          data-id={ADD_CARD_FORM_TEST_IDS.labelSelect(columnId)}
          className="rounded-md border-slate-300 py-1 pl-2 text-xs dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">No label</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature</option>
          <option value="chore">Chore</option>
        </select>
      </div>
      <button
        type="submit"
        data-id={ADD_CARD_FORM_TEST_IDS.submit(columnId)}
        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add card
      </button>
    </form>
  );
}
