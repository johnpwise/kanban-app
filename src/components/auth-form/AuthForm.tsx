"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

import { establishSessionAction } from "@/actions/session";
import { auth } from "@/lib/firebase/client";

import { AUTH_FORM_TEST_IDS } from "./AuthForm.testIds";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
}

const ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/user-not-found": "No account found for that email.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/email-already-in-use": "An account already exists for that email.",
  "auth/weak-password": "Password must be at least 8 characters long.",
};

function describeAuthError(error: unknown): string {
  if (error instanceof FirebaseError && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }

  return "Something went wrong. Please try again.";
}

export default function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const emailInputId = useId();
  const passwordInputId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setIsSubmitting(true);

    try {
      const credential =
        mode === "sign-up"
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();
      const result = await establishSessionAction(idToken);

      if (result.status === "error") {
        setMessage(result.message);
        setIsSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(describeAuthError(error));
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-id={AUTH_FORM_TEST_IDS.form}
      className="space-y-4 rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/60"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={emailInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Email
        </label>
        <input
          id={emailInputId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          data-id={AUTH_FORM_TEST_IDS.emailInput}
          className="rounded-md border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={passwordInputId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Password
        </label>
        <input
          id={passwordInputId}
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-id={AUTH_FORM_TEST_IDS.passwordInput}
          className="rounded-md border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      {message ? (
        <p data-id={AUTH_FORM_TEST_IDS.error} className="text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isSubmitting}
        data-id={AUTH_FORM_TEST_IDS.submit}
        className="inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {mode === "sign-up" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
