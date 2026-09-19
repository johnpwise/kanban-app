import Link from "next/link";
import { redirect } from "next/navigation";

import AuthForm from "@/components/auth-form/AuthForm";
import { getCurrentUser } from "@/lib/services/session";

export default async function SignInPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Sign in</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Welcome back to the kanban app.</p>
      </header>

      <AuthForm mode="sign-in" />

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Create one
        </Link>
      </p>
    </main>
  );
}
