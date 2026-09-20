import { Timestamp } from "firebase-admin/firestore";

import { executionRequestSchema, requestExecutionInputSchema } from "@/schemas/execution";

import type { Firestore } from "firebase-admin/firestore";
import type { ExecutionStatus } from "@/schemas/board";
import type { ExecutionRequest, RequestExecutionInput } from "@/schemas/execution";

interface ProjectDocument {
  repository: string;
  defaultBranch: string;
}

interface CardDocument {
  title: string;
  prompt: string;
  executionStatus: ExecutionStatus;
}

interface ExecutionRequestDocument {
  projectId: string;
  cardId: string;
  title: string;
  prompt: string;
  repository: string;
  baseBranch: string;
  requestedBy: string;
  requestedAt: Timestamp;
}

export class ExecutionProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project "${projectId}" was not found.`);
    this.name = "ExecutionProjectNotFoundError";
  }
}

export class ExecutionCardNotFoundError extends Error {
  constructor(projectId: string, cardId: string) {
    super(`Card "${cardId}" was not found in project "${projectId}".`);
    this.name = "ExecutionCardNotFoundError";
  }
}

export class ExecutionNotAllowedError extends Error {
  constructor(cardId: string, currentStatus: ExecutionStatus) {
    super(`Card "${cardId}" cannot be queued for execution because its status is "${currentStatus}".`);
    this.name = "ExecutionNotAllowedError";
  }
}

export async function createExecutionRequest(
  firestore: Firestore,
  input: RequestExecutionInput,
): Promise<ExecutionRequest> {
  const { projectId, cardId, requestedBy } = requestExecutionInputSchema.parse(input);
  const projectReference = firestore.collection("projects").doc(projectId);
  const cardReference = projectReference.collection("cards").doc(cardId);
  const executionRequestReference = firestore.collection("executionRequests").doc();

  return firestore.runTransaction(async (transaction) => {
    const [projectSnapshot, cardSnapshot] = await transaction.getAll(projectReference, cardReference);

    if (!projectSnapshot.exists) {
      throw new ExecutionProjectNotFoundError(projectId);
    }
    if (!cardSnapshot.exists) {
      throw new ExecutionCardNotFoundError(projectId, cardId);
    }

    const project = projectSnapshot.data() as ProjectDocument;
    const card = cardSnapshot.data() as CardDocument;

    if (card.executionStatus !== "not_started") {
      throw new ExecutionNotAllowedError(cardId, card.executionStatus);
    }

    const requestedAt = Timestamp.now();

    transaction.create(executionRequestReference, {
      projectId,
      cardId,
      title: card.title,
      prompt: card.prompt,
      repository: project.repository,
      baseBranch: project.defaultBranch,
      requestedBy,
      requestedAt,
    } satisfies ExecutionRequestDocument);

    transaction.update(cardReference, {
      executionStatus: "queued" satisfies ExecutionStatus,
      updatedAt: requestedAt,
    });

    return executionRequestSchema.parse({
      id: executionRequestReference.id,
      projectId,
      cardId,
      title: card.title,
      prompt: card.prompt,
      repository: project.repository,
      baseBranch: project.defaultBranch,
      requestedBy,
      requestedAt: requestedAt.toDate().toISOString(),
    });
  });
}
