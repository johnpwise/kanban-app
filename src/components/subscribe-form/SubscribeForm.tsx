"use client";

import { useActionState } from "react";
import { CheckCircle2, Mail, Send, XCircle } from "lucide-react";

import { subscribeAction, type SubscribeActionState } from "@/actions/subscribe";

import { SUBSCRIBE_FORM_TEST_IDS } from "./SubscribeForm.testIds";

const initialState: SubscribeActionState = { status: "idle" };

export default function SubscribeForm() {
  const [state, formAction, isPending] = useActionState(subscribeAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Email
        </label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="email"
            name="email"
            type="email"
            required
            data-id={SUBSCRIBE_FORM_TEST_IDS.emailInput}
            placeholder="you@example.com"
            className="block w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
      </div>
      <button
        type="submit"
        disabled={isPending}
        data-id={SUBSCRIBE_FORM_TEST_IDS.submitButton}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {isPending ? "Subscribing…" : "Subscribe"}
      </button>
      {state.status !== "idle" && (
        <p
          role="status"
          data-id={SUBSCRIBE_FORM_TEST_IDS.status}
          className={
            state.status === "error"
              ? "flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400"
              : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {state.status === "error" ? (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          )}
          {state.message}
        </p>
      )}
    </form>
  );
}
