"use server";

import { moveCard } from "@/lib/services/board";
import { moveCardRequestSchema } from "@/schemas/board";

import type { Board } from "@/schemas/board";

export interface MoveCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function moveCardAction(
  _previousState: MoveCardActionState,
  request: unknown,
): Promise<MoveCardActionState> {
  const parsed = moveCardRequestSchema.safeParse(request);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid move request.",
    };
  }

  try {
    const board = await moveCard(parsed.data);

    return { status: "success", board };
  } catch {
    return {
      status: "error",
      message: "Could not move the card. Please try again.",
    };
  }
}
