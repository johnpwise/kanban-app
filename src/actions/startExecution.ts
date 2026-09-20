"use server";

import { getBoard } from "@/lib/services/board";
import {
  ExecutionCardNotFoundError,
  ExecutionNotAllowedError,
  ExecutionProjectNotFoundError,
  requestExecution,
} from "@/lib/services/execution";
import { getCurrentUser } from "@/lib/services/session";
import { cardIdSchema } from "@/schemas/execution";
import { projectIdSchema } from "@/schemas/project";

import type { Board } from "@/schemas/board";

export interface StartExecutionActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function startExecutionAction(
  _previousState: StartExecutionActionState,
  projectId: unknown,
  cardId: unknown,
): Promise<StartExecutionActionState> {
  const user = await getCurrentUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to start ADA work." };
  }

  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsedCardId = cardIdSchema.safeParse(cardId);

  if (!parsedProjectId.success) {
    return { status: "error", message: "Invalid project." };
  }

  if (!parsedCardId.success) {
    return { status: "error", message: "Invalid card." };
  }

  try {
    await requestExecution({
      projectId: parsedProjectId.data,
      cardId: parsedCardId.data,
      requestedBy: user.uid,
    });

    const board = await getBoard(parsedProjectId.data);

    if (!board) {
      console.error("Board not found immediately after starting ADA work.", {
        projectId: parsedProjectId.data,
      });
      return { status: "error", message: "Could not start ADA work. Please try again." };
    }

    return { status: "success", board };
  } catch (error) {
    if (error instanceof ExecutionProjectNotFoundError || error instanceof ExecutionCardNotFoundError) {
      return { status: "error", message: "This card is no longer available." };
    }

    if (error instanceof ExecutionNotAllowedError) {
      return { status: "error", message: "ADA work has already been started for this card." };
    }

    console.error("Failed to start ADA work.", error);
    return {
      status: "error",
      message: "Could not start ADA work. Please try again.",
    };
  }
}
