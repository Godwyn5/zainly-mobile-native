// ─── Edge Function: delete-account — Apple revocation module ────────────────
// Extracted from index.ts for testability. All Apple API calls use an
// injected fetch. JWT verification uses an injected verify function.
// No tokens, codes, or secrets are logged or persisted.

import {
  SignJWT,
  importPKCS8,
} from 'https://esm.sh/jose@5.9.6';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AppleTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

export interface AppleRevocationConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  clientId: string;
}

export interface AppleRevocationDeps {
  fetchFn: typeof fetch;
  verifyJwt: (
    idToken: string,
    options: {
      issuer: string;
      audience: string;
      jwksUrl: string;
    },
  ) => Promise<{ sub: string }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_ISSUER = 'https://appleid.apple.com';
export const NETWORK_TIMEOUT_MS = 10_000;

// ─── Errors ─────────────────────────────────────────────────────────────────

export type AppleRevocationError =
  | 'apple_env_missing'
  | 'apple_client_secret_failed'
  | 'apple_exchange_failed'
  | 'apple_token_response_invalid'
  | 'apple_id_token_missing'
  | 'apple_refresh_token_missing'
  | 'apple_validation_failed'
  | 'apple_identity_mismatch'
  | 'apple_revoke_failed';

export class AppleRevocationException extends Error {
  constructor(public readonly code: AppleRevocationError) {
    super(code);
    this.name = 'AppleRevocationException';
  }
}

// ─── Client secret generation ───────────────────────────────────────────────

export async function generateAppleClientSecret(
  config: AppleRevocationConfig,
): Promise<string> {
  let pem = config.privateKeyPem;
  if (pem.includes('\\n')) {
    pem = pem.replace(/\\n/g, '\n');
  }

  const privateKey = await importPKCS8(pem, 'ES256');

  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(privateKey);
}

// ─── Token exchange ─────────────────────────────────────────────────────────

export async function exchangeAppleCode(
  authorizationCode: string,
  clientSecret: string,
  clientId: string,
  fetchFn: typeof fetch,
): Promise<AppleTokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    const resp = await fetchFn(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new AppleRevocationException('apple_exchange_failed');
    }

    let parsed: unknown;
    try {
      parsed = await resp.json();
    } catch {
      throw new AppleRevocationException('apple_token_response_invalid');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new AppleRevocationException('apple_token_response_invalid');
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.id_token !== 'string' || obj.id_token.length === 0) {
      throw new AppleRevocationException('apple_id_token_missing');
    }

    if (typeof obj.refresh_token !== 'string' || obj.refresh_token.length === 0) {
      throw new AppleRevocationException('apple_refresh_token_missing');
    }

    return {
      access_token: typeof obj.access_token === 'string' ? obj.access_token : '',
      refresh_token: obj.refresh_token,
      id_token: obj.id_token,
      token_type: typeof obj.token_type === 'string' ? obj.token_type : '',
      expires_in: typeof obj.expires_in === 'number' ? obj.expires_in : 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Token revocation ───────────────────────────────────────────────────────

export async function revokeAppleToken(
  refreshToken: string,
  clientSecret: string,
  clientId: string,
  fetchFn: typeof fetch,
): Promise<void> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    const resp = await fetchFn(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new AppleRevocationException('apple_revoke_failed');
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Full Apple revocation flow ─────────────────────────────────────────────

/**
 * Executes the ordered Apple revocation saga:
 * 1. Generate client secret
 * 2. Exchange authorization code
 * 3. Verify id_token presence (done in exchangeAppleCode)
 * 4. Verify refresh_token presence (done in exchangeAppleCode)
 * 5. Cryptographic verification of id_token (signature, issuer, audience, expiry)
 * 6. Verify sub against expected Apple identity
 * 7. Revoke refresh_token
 * 8. Confirm HTTP success
 *
 * Throws AppleRevocationException on any failure.
 */
export async function performAppleRevocation(
  authorizationCode: string,
  expectedAppleSub: string,
  config: AppleRevocationConfig,
  deps: AppleRevocationDeps,
): Promise<void> {
  // 1. Generate client secret
  let clientSecret: string;
  try {
    clientSecret = await generateAppleClientSecret(config);
  } catch {
    throw new AppleRevocationException('apple_client_secret_failed');
  }

  // 2-4. Exchange code + verify token presence
  const tokenResponse = await exchangeAppleCode(
    authorizationCode,
    clientSecret,
    config.clientId,
    deps.fetchFn,
  );

  // 5-6. Cryptographic verification of id_token
  let verifiedSub: string;
  try {
    const result = await deps.verifyJwt(tokenResponse.id_token, {
      issuer: APPLE_ISSUER,
      audience: config.clientId,
      jwksUrl: APPLE_JWKS_URL,
    });
    verifiedSub = result.sub;
  } catch (err) {
    if (err instanceof AppleRevocationException) throw err;
    throw new AppleRevocationException('apple_validation_failed');
  }

  // 6. Verify sub against expected Apple identity
  if (verifiedSub !== expectedAppleSub) {
    throw new AppleRevocationException('apple_identity_mismatch');
  }

  // 7. Revoke refresh_token
  await revokeAppleToken(
    tokenResponse.refresh_token,
    clientSecret,
    config.clientId,
    deps.fetchFn,
  );

  // 8. Success — tokens are out of scope, no persistence
}
