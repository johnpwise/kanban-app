import "firebase-admin/auth";
import "firebase-admin/firestore";

import { v1 as firestoreApi } from "@google-cloud/firestore-api";
import * as firestoreGax from "google-gax/fallback";

import { prepareFirestoreProtobufTypes } from "../src/lib/firebase/firestoreProtobufs";

const firestoreClientOptions = {
  fallback: true,
  projectId: "startup-protobuf-preparation",
} as const;
const firestoreApiClient = new firestoreApi.FirestoreClient(firestoreClientOptions);
// Firestore uses both its generated client's gax dependency and the version it imports directly.
// Prepare both protobuf roots while Worker startup evaluation is still permitted.
type FirestoreApiGax = ConstructorParameters<typeof firestoreApi.FirestoreClient>[1];
const workerFirestoreApiClient = new firestoreApi.FirestoreClient(
  firestoreClientOptions,
  firestoreGax as unknown as FirestoreApiGax,
);
const getProtobufRoot = (client: firestoreApi.FirestoreClient) =>
  Reflect.get(client, "_protos") as Parameters<typeof prepareFirestoreProtobufTypes>[0];

Reflect.set(
  globalThis,
  Symbol.for("kanban.firestoreProtobufTypesPrepared"),
  prepareFirestoreProtobufTypes(getProtobufRoot(firestoreApiClient)) +
    prepareFirestoreProtobufTypes(getProtobufRoot(workerFirestoreApiClient)),
);

export { default } from "vinext/server/fetch-handler";
export * from "vinext/server/fetch-handler";
