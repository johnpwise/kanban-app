"use server";

import { redirect } from "next/navigation";

import { clearSession, createSessionCookie } from "@/lib/services/session";
import { idTokenSchema } from "@/schemas/auth";

export interface EstablishSessionActionState {
  status: "idle" | "error";
  message?: string;
}

export async function establishSessionAction(idToken: unknown): Promise<EstablishSessionActionState> {
  const parsed = idTokenSchema.safeParse(idToken);

  if (!parsed.success) {
    return { status: "error", message: "Sign-in failed. Please try again." };
  }

  try {
    await createSessionCookie(parsed.data);
  } catch (error) {
    console.error("Failed to establish session.", error);
    return { status: "error", message: "Sign-in failed. Please try again." };
  }

  return { status: "idle" };
}

export async function signOutAction(): Promise<void> {
  await clearSession();
  redirect("/sign-in");
}
