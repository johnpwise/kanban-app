import { cookies } from "next/headers";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { DARK_MODE_COOKIE_KEY, parseDarkModeCookie } from "@/store/appStore";

import { APP_SHELL_TEST_IDS } from "./appShell.testIds";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kanban App",
  description: "Bootstrapped with the nextjs-stack-pack baseline.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const isDarkMode = parseDarkModeCookie(cookieStore.get(DARK_MODE_COOKIE_KEY)?.value);

  return (
    <html lang="en" className={isDarkMode ? "dark" : undefined}>
      <body
        data-id={APP_SHELL_TEST_IDS.shell}
        className="min-h-screen bg-linear-to-br from-slate-50 via-white to-indigo-50/60 text-slate-900 antialiased dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/40 dark:text-slate-100"
      >
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
          {children}
        </div>
      </body>
    </html>
  );
}
