import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import {
  createExecutionRequest as createExecutionRequestInRepository,
  ExecutionCardNotFoundError,
  ExecutionNotAllowedError,
  ExecutionProjectNotFoundError,
} from "@/lib/repositories/firestoreExecutionRepository";

import type { RequestExecutionInput } from "@/schemas/execution";

export { ExecutionCardNotFoundError, ExecutionNotAllowedError, ExecutionProjectNotFoundError };

export async function requestExecution(input: RequestExecutionInput) {
  return createExecutionRequestInRepository(getFirebaseFirestore(), input);
}
