"use server";

import { addCard } from "@/lib/services/board";
import { addCardRequestSchema } from "@/schemas/board";

import type { Board } from "@/schemas/board";

export interface AddCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function addCardAction(
  _previousState: AddCardActionState,
  request: unknown,
): Promise<AddCardActionState> {
  const parsed = addCardRequestSchema.safeParse(request);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid card.",
    };
  }

  try {
    const board = await addCard(parsed.data);

    return { status: "success", board };
  } catch {
    return {
      status: "error",
      message: "Could not add the card. Please try again.",
    };
  }
}
