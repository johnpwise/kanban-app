import { onDocumentCreated } from "firebase-functions/v2/firestore";

import { handleExecutionRequestCreated } from "./onExecutionRequestCreated";

/**
 * Region matches the project's single Firestore database (`kanban-app-fa4b7`, locationId
 * `europe-west2`, confirmed via read-only inspection) so the trigger is co-located with the data.
 */
export const dispatchAdaExecutionRequest = onDocumentCreated(
  {
    document: "executionRequests/{executionRequestId}",
    region: "europe-west2",
  },
  handleExecutionRequestCreated,
);
