"use server";

import { addCard } from "@/lib/services/board";
import { getCurrentUser } from "@/lib/services/session";
import { addCardRequestSchema } from "@/schemas/board";
import { projectIdSchema } from "@/schemas/project";

import type { Board } from "@/schemas/board";

export interface AddCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function addCardAction(
  _previousState: AddCardActionState,
  projectId: unknown,
  request: unknown,
): Promise<AddCardActionState> {
  const user = await getCurrentUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to add a card." };
  }

  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsed = addCardRequestSchema.safeParse(request);

  if (!parsedProjectId.success) {
    return { status: "error", message: "Invalid project." };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid card.",
    };
  }

  try {
    const board = await addCard(parsedProjectId.data, parsed.data, user.uid);

    return { status: "success", board };
  } catch (error) {
    console.error("Failed to add card.", error);
    return {
      status: "error",
      message: "Could not add the card. Please try again.",
    };
  }
}
