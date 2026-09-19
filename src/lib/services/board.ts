import "server-only";

import { firestore } from "@/lib/firebase/admin";
import {
  addCard as addCardInRepository,
  deleteCard as deleteCardInRepository,
  getProjectBoard,
  moveCard as moveCardInRepository,
  updateCard as updateCardInRepository,
} from "@/lib/repositories/firestoreBoardRepository";

import type { AddCardRequest, DeleteCardRequest, MoveCardRequest, UpdateCardRequest } from "@/schemas/board";

export async function getBoard(projectId: string) {
  return getProjectBoard(firestore, projectId);
}

export async function moveCard(projectId: string, request: MoveCardRequest) {
  return moveCardInRepository(firestore, projectId, request);
}

export async function addCard(projectId: string, request: AddCardRequest) {
  return addCardInRepository(firestore, projectId, request);
}

export async function deleteCard(projectId: string, request: DeleteCardRequest) {
  return deleteCardInRepository(firestore, projectId, request);
}

export async function updateCard(projectId: string, request: UpdateCardRequest) {
  return updateCardInRepository(firestore, projectId, request);
}
