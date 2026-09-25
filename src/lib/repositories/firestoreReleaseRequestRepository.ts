import { Timestamp } from "firebase-admin/firestore";

import { requestReleaseInputSchema } from "@/schemas/release";

import type { Firestore } from "firebase-admin/firestore";
import type { RequestReleaseInput } from "@/schemas/release";

interface ReleaseRequestDocument {
  releaseRequestId: string;
  version: string;
  requestedBy: string;
  requestedAt: Timestamp;
}

export interface CreateReleaseRequestResult {
  releaseRequestId: string;
}

/**
 * Durably records a thin, explicit release request: `version` only, plus the server-verified
 * `requestedBy` — never `repository`/`sourceBranch`/`sourceRevision`, which stay trusted
 * configuration resolved later, inside the `ada-release-controller` Cloud Run Job
 * (`executor/src/releaseControllerMain.ts`), never anything a caller of this repository could
 * influence. The document embeds its own id (`releaseRequestId` matching the document id) so
 * `launchReleaseStart.ts` can perform the same id/body-match defensive check
 * `launchExecutionRun.ts` already performs for `executionRuns/{id}`.
 */
export async function createReleaseRequest(
  firestore: Firestore,
  input: RequestReleaseInput,
): Promise<CreateReleaseRequestResult> {
  const { version, requestedBy } = requestReleaseInputSchema.parse(input);
  const releaseRequestReference = firestore.collection("releaseRequests").doc();

  await releaseRequestReference.create({
    releaseRequestId: releaseRequestReference.id,
    version,
    requestedBy,
    requestedAt: Timestamp.now(),
  } satisfies ReleaseRequestDocument);

  return { releaseRequestId: releaseRequestReference.id };
}
