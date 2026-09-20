import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const firebaseAdminMocks = vi.hoisted(() => ({
  applicationDefault: vi.fn(() => ({ kind: "credential" })),
  cert: vi.fn(() => ({ kind: "service-account-credential" })),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ kind: "app" })),
  getAuth: vi.fn(() => ({
    kind: "auth",
    createSessionCookie: vi.fn(async () => "sdk-session-cookie"),
    verifySessionCookie: vi.fn(async () => ({ uid: "sdk-uid", email: "sdk-user@example.test" })),
  })),
  getFirestore: vi.fn(() => ({ kind: "admin-firestore" })),
  Firestore: vi.fn(function Firestore() {
    return { kind: "worker-firestore" };
  }),
}));

const joseMocks = vi.hoisted(() => ({
  decodeProtectedHeader: vi.fn(() => ({ kid: "test-kid" })),
  importX509: vi.fn(async () => ({ kind: "public-key" })),
  jwtVerify: vi.fn(async () => ({
    payload: { sub: "rest-uid", email: "rest-user@example.test", iat: 1_000 },
  })),
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
vi.mock("jose", () => joseMocks);

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

describe("createFirebaseSessionCookie", () => {
  const testPrivateKey = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
  const importKeySpy = vi.spyOn(crypto.subtle, "importKey");
  const signSpy = vi.spyOn(crypto.subtle, "sign");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    importKeySpy.mockResolvedValue({ kind: "crypto-key" } as unknown as CryptoKey);
    signSpy.mockResolvedValue(new TextEncoder().encode("signature").buffer);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should exchange a service-account JWT for an access token and call the Identity Toolkit REST API directly, bypassing firebase-admin's own token-fetch path", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: testPrivateKey,
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "test-access-token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sessionCookie: "rest-session-cookie" }),
        text: async () => "",
      });
    const { createFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const sessionCookie = await createFirebaseSessionCookie("id-token", 60_000);

    // Assert
    expect(sessionCookie).toBe("rest-session-cookie");
    expect(firebaseAdminMocks.getAuth).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://identitytoolkit.googleapis.com/v1/projects/worker-project:createSessionCookie",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-access-token" }),
      }),
    );
    const [, secondCallOptions] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(JSON.parse(secondCallOptions.body)).toEqual({ idToken: "id-token", validDuration: 60 });
  });

  it("should fall back to firebase-admin's createSessionCookie when no service-account secret is configured", async () => {
    // Arrange
    const { createFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const sessionCookie = await createFirebaseSessionCookie("id-token", 60_000);

    // Assert
    expect(sessionCookie).toBe("sdk-session-cookie");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should surface a clear error when Google rejects the access-token exchange", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: testPrivateKey,
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "invalid_grant",
    });
    const { createFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const createWithRejectedExchange = createFirebaseSessionCookie("id-token", 60_000);

    // Assert
    await expect(createWithRejectedExchange).rejects.toThrow(
      "Failed to fetch a Google OAuth2 access token: 400 invalid_grant",
    );
  });
});

describe("verifyFirebaseSessionCookie", () => {
  const testPrivateKey = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";
  const testCert = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
  const importKeySpy = vi.spyOn(crypto.subtle, "importKey");
  const signSpy = vi.spyOn(crypto.subtle, "sign");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    importKeySpy.mockResolvedValue({ kind: "crypto-key" } as unknown as CryptoKey);
    signSpy.mockResolvedValue(new TextEncoder().encode("signature").buffer);
    joseMocks.decodeProtectedHeader.mockReturnValue({ kid: "test-kid" });
    joseMocks.importX509.mockResolvedValue({ kind: "public-key" } as never);
    joseMocks.jwtVerify.mockResolvedValue({
      payload: { sub: "rest-uid", email: "rest-user@example.test", iat: 1_000 },
    } as never);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should verify a session cookie's signature with jose against Google's published cert and check for revocation, bypassing firebase-admin's own verifier", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: testPrivateKey,
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "cache-control": "public, max-age=21600" }),
        json: async () => ({ "test-kid": testCert }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "test-access-token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ users: [{ validSince: "500" }] }),
        text: async () => "",
      });
    const { verifyFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const user = await verifyFirebaseSessionCookie("session-cookie-jwt");

    // Assert
    expect(user).toEqual({ uid: "rest-uid", email: "rest-user@example.test" });
    expect(firebaseAdminMocks.getAuth).not.toHaveBeenCalled();
    expect(joseMocks.importX509).toHaveBeenCalledWith(testCert, "RS256");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.googleapis.com/identitytoolkit/v3/relyingparty/publicKeys",
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://identitytoolkit.googleapis.com/v1/projects/worker-project/accounts:lookup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("should fall back to firebase-admin's verifySessionCookie when no service-account secret is configured", async () => {
    // Arrange
    const { verifyFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const user = await verifyFirebaseSessionCookie("session-cookie-jwt");

    // Assert
    expect(user).toEqual({ uid: "sdk-uid", email: "sdk-user@example.test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should reject a session cookie issued before the account's validSince timestamp", async () => {
    // Arrange
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: "worker-project",
      client_email: "firebase-admin@example.test",
      private_key: testPrivateKey,
    });
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "cache-control": "public, max-age=21600" }),
        json: async () => ({ "test-kid": testCert }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "test-access-token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ users: [{ validSince: "2000" }] }),
        text: async () => "",
      });
    const { verifyFirebaseSessionCookie } = await import("@/lib/firebase/admin");

    // Act
    const verifyWithRevokedSession = verifyFirebaseSessionCookie("session-cookie-jwt");

    // Assert
    await expect(verifyWithRevokedSession).rejects.toThrow("Firebase session cookie has been revoked.");
  });
});
