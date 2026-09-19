import { LogOut } from "lucide-react";

import { signOutAction } from "@/actions/session";

import { AUTH_STATUS_TEST_IDS } from "./AuthStatus.testIds";

interface AuthStatusProps {
  email: string;
}

export default function AuthStatus({ email }: AuthStatusProps) {
  return (
    <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
      <p data-id={AUTH_STATUS_TEST_IDS.email} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        Signed in as {email}
      </p>
      <form action={signOutAction}>
        <button
          type="submit"
          data-id={AUTH_STATUS_TEST_IDS.signOutButton}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </section>
  );
}
