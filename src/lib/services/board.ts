import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  addCard as addCardInRepository,
  deleteCard as deleteCardInRepository,
  getProjectBoard,
  moveCard as moveCardInRepository,
  updateCard as updateCardInRepository,
} from "@/lib/repositories/firestoreBoardRepository";

import type { AddCardRequest, DeleteCardRequest, MoveCardRequest, UpdateCardRequest } from "@/schemas/board";

export async function getBoard(projectId: string) {
  return getProjectBoard(getFirebaseFirestore(), projectId);
}

export async function moveCard(projectId: string, request: MoveCardRequest) {
  return moveCardInRepository(getFirebaseFirestore(), projectId, request);
}

export async function addCard(projectId: string, request: AddCardRequest) {
  return addCardInRepository(getFirebaseFirestore(), projectId, request);
}

export async function deleteCard(projectId: string, request: DeleteCardRequest) {
  return deleteCardInRepository(getFirebaseFirestore(), projectId, request);
}

export async function updateCard(projectId: string, request: UpdateCardRequest) {
  return updateCardInRepository(getFirebaseFirestore(), projectId, request);
}
