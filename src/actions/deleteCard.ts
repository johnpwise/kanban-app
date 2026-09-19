"use server";

import { deleteCard } from "@/lib/services/board";
import { deleteCardRequestSchema } from "@/schemas/board";

import type { Board } from "@/schemas/board";

export interface DeleteCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function deleteCardAction(
  _previousState: DeleteCardActionState,
  request: unknown,
): Promise<DeleteCardActionState> {
  const parsed = deleteCardRequestSchema.safeParse(request);

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid delete request.",
    };
  }

  try {
    const board = await deleteCard(parsed.data);

    return { status: "success", board };
  } catch {
    return {
      status: "error",
      message: "Could not delete the card. Please try again.",
    };
  }
}
