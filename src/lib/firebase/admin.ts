import "server-only";

import { Firestore } from "@google-cloud/firestore";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import type { App } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";

let firebaseApp: App | undefined;
let firebaseAuth: Auth | undefined;
let firebaseFirestore: Firestore | undefined;

const invalidServiceAccountMessage =
  "FIREBASE_SERVICE_ACCOUNT_JSON must be a valid Firebase service-account JSON object.";

interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function getFirebaseServiceAccount(): FirebaseServiceAccount | undefined {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    return undefined;
  }

  let serviceAccount: unknown;

  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error(invalidServiceAccountMessage);
  }

  if (!serviceAccount || typeof serviceAccount !== "object") {
    throw new Error(invalidServiceAccountMessage);
  }

  const {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  } = serviceAccount as Record<string, unknown>;

  if (
    typeof projectId !== "string" ||
    typeof clientEmail !== "string" ||
    typeof privateKey !== "string" ||
    !projectId ||
    !clientEmail ||
    !privateKey
  ) {
    throw new Error(invalidServiceAccountMessage);
  }

  return { projectId, clientEmail, privateKey };
}

function getFirebaseApp(): App {
  if (firebaseApp) {
    return firebaseApp;
  }

  const existingApp = getApps()[0];

  if (existingApp) {
    firebaseApp = existingApp;
    return firebaseApp;
  }

  const serviceAccount = getFirebaseServiceAccount();

  firebaseApp = initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    projectId:
      serviceAccount?.projectId ?? process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
  });

  return firebaseApp;
}

export function getFirebaseAuth(): Auth {
  firebaseAuth ??= getAuth(getFirebaseApp());
  return firebaseAuth;
}

export function getFirebaseFirestore(): Firestore {
  if (firebaseFirestore) {
    return firebaseFirestore;
  }

  const serviceAccount = getFirebaseServiceAccount();

  firebaseFirestore = serviceAccount
    ? new Firestore({
        preferRest: true,
        // Cloudflare's Node stream shim cannot decode the REST client's gzip pipeline.
        customHeaders: { "accept-encoding": "identity" },
        projectId: serviceAccount.projectId,
        credentials: {
          client_email: serviceAccount.clientEmail,
          private_key: serviceAccount.privateKey,
        },
      })
    : getFirestore(getFirebaseApp());
  return firebaseFirestore;
}
