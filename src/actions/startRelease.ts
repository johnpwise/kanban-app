"use server";

import { requestRelease } from "@/lib/services/release";
import { getCurrentUser } from "@/lib/services/session";
import { releaseVersionSchema } from "@/schemas/release";

export interface StartReleaseActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/**
 * The explicit release-request control-plane boundary: an authenticated caller supplies only
 * `version` — `repository`/`sourceBranch`/`sourceRevision`/`releaseBranch`/`commitSha` are never
 * caller-trusted, resolved instead inside the `ada-release-controller` Cloud Run Job from this
 * app's own separately-configured trust boundary.
 */
export async function startReleaseAction(
  _previousState: StartReleaseActionState,
  version: unknown,
): Promise<StartReleaseActionState> {
  const user = await getCurrentUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to start a release." };
  }

  const parsedVersion = releaseVersionSchema.safeParse(version);

  if (!parsedVersion.success) {
    return { status: "error", message: "Enter a valid version, e.g. 1.2.3." };
  }

  try {
    await requestRelease({ version: parsedVersion.data, requestedBy: user.uid });
    return { status: "success" };
  } catch (error) {
    console.error("Failed to start a release.", error);
    return { status: "error", message: "Could not start the release. Please try again." };
  }
}
