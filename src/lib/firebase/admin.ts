import "server-only";

import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
  });

export const firestore = getFirestore(app);
