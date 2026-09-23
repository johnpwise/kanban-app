import { createSign } from "node:crypto";
import { z } from "zod";

/** Buffer against clock skew between this process and GitHub's servers. */
const JWT_CLOCK_SKEW_SECONDS = 60;
/** Comfortably under GitHub's 10-minute (600s) maximum App JWT lifetime. */
const JWT_EXPIRY_SECONDS = 480;

const githubAppCredentialEnvSchema = z.object({
  ADA_GITHUB_APP_ID: z.string().trim().min(1),
  ADA_GITHUB_APP_PRIVATE_KEY: z.string().trim().min(1),
  ADA_GITHUB_APP_INSTALLATION_ID: z.string().trim().min(1),
});

export type MintGithubDeliveryCredentialOutcome =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; reason: "config_invalid" }
  | { ok: false; reason: "jwt_signing_failed" }
  | { ok: false; reason: "token_exchange_failed"; httpStatus?: number }
  | { ok: false; reason: "token_exchange_network_error" };

export interface MintGithubDeliveryCredentialParams {
  /** The immutable, already-validated `owner/repo` identity to scope the minted token to. */
  repository: string;
  env: Record<string, string | undefined>;
  now: () => number;
  fetchImpl: typeof fetch;
}

/** `env`/`now`/`fetchImpl` are bound once at composition time (see `main.ts`); `repository` is passed per call, since it is only known once `deliveryPush`'s composed step runs. */
export type MintGithubDeliveryCredential = (request: { repository: string }) => Promise<MintGithubDeliveryCredentialOutcome>;

/**
 * GitHub's installation access-token API expects a bare repository name (the owner is already
 * fixed by the installation), not `owner/repo`.
 */
function repositoryNameOnly(repository: string): string {
  return repository.split("/").at(-1) ?? repository;
}

function base64UrlEncode(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");
}

/** Env vars commonly carry multi-line PEMs with literal `\n` escapes rather than real newlines. */
function normalizePrivateKey(rawKey: string): string {
  return rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
}

/**
 * Signs a short-lived GitHub App JWT (RS256) identifying this App to the token-exchange endpoint.
 * Returns `null` on any signing failure (e.g. a malformed private key) rather than throwing, so the
 * caller can report a safe typed outcome.
 */
function signGithubAppJwt(params: { appId: string; privateKey: string; now: () => number }): string | null {
  const nowSeconds = Math.floor(params.now() / 1000);
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedPayload = base64UrlEncode(
    JSON.stringify({
      iat: nowSeconds - JWT_CLOCK_SKEW_SECONDS,
      exp: nowSeconds + JWT_EXPIRY_SECONDS,
      iss: params.appId,
    }),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(normalizePrivateKey(params.privateKey));
    return `${signingInput}.${base64UrlEncode(signature)}`;
  } catch {
    return null;
  }
}

/**
 * Mints a short-lived GitHub App installation access token, scoped only to `repository` via the
 * token-exchange request body — never the App's full installation, which could span other
 * repositories. Reads only its own `ADA_GITHUB_APP_*` env vars — a distinct namespace from Codex's
 * `CODEX_*` vars in `codexProviderConfig.ts` — so this credential can never collide with, or be
 * pulled into, the coding-agent child-process env. Never logs the private key, the signed JWT, the
 * minted token, or any response body: failures carry only a safe `httpStatus`.
 */
export async function mintGithubDeliveryCredential({
  repository,
  env,
  now,
  fetchImpl,
}: MintGithubDeliveryCredentialParams): Promise<MintGithubDeliveryCredentialOutcome> {
  const parsed = githubAppCredentialEnvSchema.safeParse({
    ADA_GITHUB_APP_ID: env.ADA_GITHUB_APP_ID,
    ADA_GITHUB_APP_PRIVATE_KEY: env.ADA_GITHUB_APP_PRIVATE_KEY,
    ADA_GITHUB_APP_INSTALLATION_ID: env.ADA_GITHUB_APP_INSTALLATION_ID,
  });
  if (!parsed.success) {
    return { ok: false, reason: "config_invalid" };
  }

  const jwt = signGithubAppJwt({
    appId: parsed.data.ADA_GITHUB_APP_ID,
    privateKey: parsed.data.ADA_GITHUB_APP_PRIVATE_KEY,
    now,
  });
  if (jwt === null) {
    return { ok: false, reason: "jwt_signing_failed" };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/app/installations/${parsed.data.ADA_GITHUB_APP_INSTALLATION_ID}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repositories: [repositoryNameOnly(repository)] }),
      },
    );
  } catch {
    return { ok: false, reason: "token_exchange_network_error" };
  }

  if (!response.ok) {
    return { ok: false, reason: "token_exchange_failed", httpStatus: response.status };
  }

  try {
    const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof body.token !== "string" || typeof body.expires_at !== "string") {
      return { ok: false, reason: "token_exchange_failed", httpStatus: response.status };
    }
    return { ok: true, token: body.token, expiresAt: body.expires_at };
  } catch {
    return { ok: false, reason: "token_exchange_network_error" };
  }
}
