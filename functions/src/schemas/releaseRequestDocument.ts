import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

/**
 * Plain `MAJOR.MINOR.PATCH` only, re-expressed here (not imported) since `functions/` is a
 * standalone deployable with its own `node_modules` — same convention already noted by
 * `executor/src/schemas/releaseIntentDocument.ts`'s `releaseVersionSchema`.
 */
const releaseVersionSchema = z
  .string()
  .trim()
  .regex(
    /^\d+\.\d+\.\d+$/,
    "Version must be plain MAJOR.MINOR.PATCH, with no leading v, prerelease suffix, or build metadata.",
  );

/** Shape of a `releaseRequests/{releaseRequestId}` Firestore document's data. */
export const releaseRequestDocumentSchema = z.object({
  releaseRequestId: z.string().min(1),
  version: releaseVersionSchema,
  requestedBy: z.string().min(1),
  requestedAt: z.instanceof(Timestamp),
});

export type ReleaseRequestDocument = z.infer<typeof releaseRequestDocumentSchema>;
