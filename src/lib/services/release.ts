import "server-only";

import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { createReleaseRequest } from "@/lib/repositories/firestoreReleaseRequestRepository";

import type { RequestReleaseInput } from "@/schemas/release";

export async function requestRelease(input: RequestReleaseInput) {
  return createReleaseRequest(getFirebaseFirestore(), input);
}
