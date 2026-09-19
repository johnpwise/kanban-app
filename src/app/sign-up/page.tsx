import Link from "next/link";
import { redirect } from "next/navigation";

import AuthForm from "@/components/auth-form/AuthForm";
import { getCurrentUser } from "@/lib/services/session";

export default async function SignUpPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Create an account</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Sign up to start using the kanban app.</p>
      </header>

      <AuthForm mode="sign-up" />

      <p className="text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </main>
  );
}
