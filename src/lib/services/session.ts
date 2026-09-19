import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { auth } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRES_IN_MS = 1000 * 60 * 60 * 24 * 14;

export interface SessionUser {
  uid: string;
  email: string | null;
}

export async function createSessionCookie(idToken: string): Promise<void> {
  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_EXPIRES_IN_MS });
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_EXPIRES_IN_MS / 1000,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    const decoded = await auth.verifySessionCookie(sessionCookie, true);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
});
