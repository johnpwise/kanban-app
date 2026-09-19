import { beforeEach, describe, expect, it, vi } from "vitest";

const firebaseAdminMocks = vi.hoisted(() => ({
  applicationDefault: vi.fn(() => ({ kind: "credential" })),
  cert: vi.fn(() => ({ kind: "service-account-credential" })),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ kind: "app" })),
  getAuth: vi.fn(() => ({ kind: "auth" })),
  getFirestore: vi.fn(() => ({ kind: "admin-firestore" })),
  Firestore: vi.fn(function Firestore() {
    return { kind: "worker-firestore" };
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/app", () => ({
  applicationDefault: firebaseAdminMocks.applicationDefault,
  cert: firebaseAdminMocks.cert,
  getApps: firebaseAdminMocks.getApps,
  initializeApp: firebaseAdminMocks.initializeApp,
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: firebaseAdminMocks.getAuth,
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: firebaseAdminMocks.getFirestore,
}));
vi.mock("@google-cloud/firestore", () => ({
  Firestore: firebaseAdminMocks.Firestore,
}));

describe("Firebase Admin clients", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  });

  it("should defer Firebase Admin initialization until a client is requested", async () => {
    // Arrange

    // Act
    await import("@/lib/firebase/admin");

    // Assert
    expect(firebaseAdminMocks.applicationDefault).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.initializeApp).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.getAuth).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.getFirestore).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.Firestore).not.toHaveBeenCalled();
  });

  it("should initialize and reuse the Auth client on demand", async () => {
    // Arrange
    const { getFirebaseAuth } = await import("@/lib/firebase/admin");

    // Act
    const firstClient = getFirebaseAuth();
    const secondClient = getFirebaseAuth();

    // Assert
    expect(firstClient).toBe(secondClient);
    expect(firebaseAdminMocks.initializeApp).toHaveBeenCalledTimes(1);
    expect(firebaseAdminMocks.getAuth).toHaveBeenCalledTimes(1);
  });

  it("should use an inline service-account secret when running without a credential file", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: "private-key",
    });
    const { getFirebaseAuth } = await import("@/lib/firebase/admin");

    // Act
    getFirebaseAuth();

    // Assert
    expect(firebaseAdminMocks.cert).toHaveBeenCalledWith({
      projectId: "worker-project",
      clientEmail: "firebase-admin@example.test",
      privateKey: "private-key",
    });
    expect(firebaseAdminMocks.applicationDefault).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ credential: { kind: "service-account-credential" } }),
    );
  });

  it("should reject an invalid inline service-account secret without exposing its value", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "not-json";
    const { getFirebaseAuth } = await import("@/lib/firebase/admin");

    // Act
    const initializeWithInvalidSecret = () => getFirebaseAuth();

    // Assert
    expect(initializeWithInvalidSecret).toThrow(
      "FIREBASE_SERVICE_ACCOUNT_JSON must be a valid Firebase service-account JSON object.",
    );
    expect(firebaseAdminMocks.cert).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.applicationDefault).not.toHaveBeenCalled();
  });

  it("should use Firebase Admin Firestore for application-default credentials", async () => {
    // Arrange
    const { getFirebaseFirestore } = await import("@/lib/firebase/admin");

    // Act
    const firstClient = getFirebaseFirestore();
    const secondClient = getFirebaseFirestore();

    // Assert
    expect(firstClient).toBe(secondClient);
    expect(firebaseAdminMocks.getFirestore).toHaveBeenCalledTimes(1);
    expect(firebaseAdminMocks.getFirestore).toHaveBeenCalledWith({ kind: "app" });
    expect(firebaseAdminMocks.Firestore).not.toHaveBeenCalled();
  });

  it("should use an uncompressed REST transport for the Worker secret", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: "private-key",
    });
    const { getFirebaseFirestore } = await import("@/lib/firebase/admin");

    // Act
    getFirebaseFirestore();

    // Assert
    expect(firebaseAdminMocks.getFirestore).not.toHaveBeenCalled();
    expect(firebaseAdminMocks.Firestore).toHaveBeenCalledTimes(1);
    expect(firebaseAdminMocks.Firestore).toHaveBeenCalledWith(
      expect.objectContaining({
        preferRest: true,
        customHeaders: { "accept-encoding": "identity" },
        projectId: "worker-project",
        credentials: {
          client_email: "firebase-admin@example.test",
          private_key: "private-key",
        },
      }),
    );
  });
});
