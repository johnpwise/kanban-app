import { NextResponse } from "next/server";

import { getBoard } from "@/lib/services/board";
import { projectIdSchema } from "@/schemas/project";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const parsedProjectId = projectIdSchema.safeParse((await params).projectId);

  if (!parsedProjectId.success) {
    return errorResponse(400, "INVALID_PROJECT_ID", "The project id is invalid.");
  }

  try {
    const board = await getBoard(parsedProjectId.data);

    if (!board) {
      return errorResponse(404, "PROJECT_NOT_FOUND", "The project was not found.");
    }

    return NextResponse.json(board);
  } catch (error) {
    console.error("Failed to read project board.", error);
    return errorResponse(500, "BOARD_READ_FAILED", "Could not load the board.");
  }
}
