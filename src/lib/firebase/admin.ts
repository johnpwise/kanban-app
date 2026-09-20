import "server-only";

import { Firestore } from "@google-cloud/firestore";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

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

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";

function base64UrlEncode(data: string | ArrayBuffer): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importServiceAccountPrivateKey(privateKey: string): Promise<CryptoKey> {
  const pemBody = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (char) => char.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Mints a Google OAuth2 access token from a service account by signing a JWT-bearer
 * assertion with WebCrypto and exchanging it directly over `fetch`. `firebase-admin`'s
 * own credential path (google-auth-library -> gtoken) relies on Node's `crypto`/`gaxios`
 * stack, which silently fails to produce an access token under Cloudflare Workers'
 * `nodejs_compat` layer.
 */
async function fetchGoogleAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const key = await importServiceAccountPrivateKey(serviceAccount.privateKey);
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsignedToken = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(
    JSON.stringify({
      iss: serviceAccount.clientEmail,
      scope: IDENTITY_TOOLKIT_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept-encoding": "identity",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch a Google OAuth2 access token: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token?: unknown };

  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Google OAuth2 token response did not include an access_token.");
  }

  return data.access_token;
}

/**
 * Creates a Firebase session cookie over a direct REST call instead of
 * `getFirebaseAuth().createSessionCookie()`. See `fetchGoogleAccessToken` for why.
 */
export async function createFirebaseSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
  const serviceAccount = getFirebaseServiceAccount();

  if (!serviceAccount) {
    return getFirebaseAuth().createSessionCookie(idToken, { expiresIn: expiresInMs });
  }

  const accessToken = await fetchGoogleAccessToken(serviceAccount);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${serviceAccount.projectId}:createSessionCookie`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-encoding": "identity",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        idToken,
        validDuration: Math.floor(expiresInMs / 1000),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create Firebase session cookie: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { sessionCookie?: unknown };

  if (typeof data.sessionCookie !== "string" || !data.sessionCookie) {
    throw new Error("createSessionCookie response did not include a sessionCookie.");
  }

  return data.sessionCookie;
}

const SESSION_COOKIE_CERTS_URL = "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys";
const SESSION_COOKIE_ISSUER_PREFIX = "https://session.firebase.google.com/";

let cachedSessionCookieCerts: { certs: Record<string, string>; expiresAt: number } | undefined;

async function getSessionCookieCerts(): Promise<Record<string, string>> {
  if (cachedSessionCookieCerts && cachedSessionCookieCerts.expiresAt > Date.now()) {
    return cachedSessionCookieCerts.certs;
  }

  const response = await fetch(SESSION_COOKIE_CERTS_URL, {
    headers: { "accept-encoding": "identity" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch session cookie certs: ${response.status} ${await response.text()}`);
  }

  const certs = (await response.json()) as Record<string, string>;
  const maxAgeSeconds = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
  cachedSessionCookieCerts = { certs, expiresAt: Date.now() + maxAgeSeconds * 1000 };

  return certs;
}

/**
 * Mirrors `verifySessionCookie(cookie, /* checkRevoked *\/ true)`: fetches the user's
 * `validSince` timestamp and rejects cookies issued before it.
 */
async function assertSessionCookieNotRevoked(
  serviceAccount: FirebaseServiceAccount,
  uid: string,
  issuedAtSeconds: number,
): Promise<void> {
  const accessToken = await fetchGoogleAccessToken(serviceAccount);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${serviceAccount.projectId}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-encoding": "identity",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ localId: [uid] }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to look up account for revocation check: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { users?: Array<{ validSince?: string }> };
  const validSinceSeconds = Number(data.users?.[0]?.validSince ?? 0);

  if (validSinceSeconds > 0 && issuedAtSeconds < validSinceSeconds) {
    throw new Error("Firebase session cookie has been revoked.");
  }
}

export interface VerifiedSessionUser {
  uid: string;
  email: string | null;
}

/**
 * Verifies a Firebase session cookie over direct REST + WebCrypto calls instead of
 * `getFirebaseAuth().verifySessionCookie()`, which depends on the same Node
 * `crypto`/`jsonwebtoken` stack that breaks under Cloudflare Workers (see
 * `fetchGoogleAccessToken`). Uses `jose`, a WebCrypto-native JWT library, to verify the
 * RS256 signature against Google's published session-cookie certificate.
 */
export async function verifyFirebaseSessionCookie(sessionCookie: string): Promise<VerifiedSessionUser> {
  const serviceAccount = getFirebaseServiceAccount();

  if (!serviceAccount) {
    const decoded = await getFirebaseAuth().verifySessionCookie(sessionCookie, true);
    return { uid: decoded.uid, email: decoded.email ?? null };
  }

  const { kid } = decodeProtectedHeader(sessionCookie);

  if (!kid) {
    throw new Error("Session cookie is missing a key id.");
  }

  const certs = await getSessionCookieCerts();
  const cert = certs[kid];

  if (!cert) {
    throw new Error("Session cookie was signed with an unrecognized key.");
  }

  const publicKey = await importX509(cert, "RS256");
  const { payload } = await jwtVerify(sessionCookie, publicKey, {
    issuer: `${SESSION_COOKIE_ISSUER_PREFIX}${serviceAccount.projectId}`,
    audience: serviceAccount.projectId,
  });

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Session cookie is missing a subject claim.");
  }

  await assertSessionCookieNotRevoked(serviceAccount, payload.sub, payload.iat ?? 0);

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  };
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
