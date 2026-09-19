"use server";

import { updateCard } from "@/lib/services/board";
import { updateCardRequestSchema } from "@/schemas/board";

import type { Board } from "@/schemas/board";

export interface UpdateCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function updateCardAction(
  _previousState: UpdateCardActionState,
  request: unknown,
): Promise<UpdateCardActionState> {
  const parsed = updateCardRequestSchema.safeParse(request);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid update request.",
    };
  }

  try {
    const board = await updateCard(parsed.data);

    return { status: "success", board };
  } catch {
    return {
      status: "error",
      message: "Could not update the card. Please try again.",
    };
  }
}
