import { NextResponse } from "next/server";

import { getBoard } from "@/lib/services/board";

export async function GET() {
  const board = await getBoard();

  return NextResponse.json(board);
}
