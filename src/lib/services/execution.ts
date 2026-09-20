import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { createExecutionRequest as createExecutionRequestInRepository } from "@/lib/repositories/firestoreExecutionRepository";

import type { RequestExecutionInput } from "@/schemas/execution";

export async function requestExecution(input: RequestExecutionInput) {
  return createExecutionRequestInRepository(getFirebaseFirestore(), input);
}
