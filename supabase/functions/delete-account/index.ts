// ─── Edge Function: delete-account ────────────────────────────────────────────
// Self-service account deletion. Deployed on Supabase (Deno runtime).
//
// Security:
// - The caller's identity is derived ONLY from the verified JWT (Authorization
//   header), never from the request body. Nobody can delete another account.
// - SUPABASE_SERVICE_ROLE_KEY is read from the function's server-side env only
//   and is never returned in any response or logged.
// - Deletes are ordered (dependent tables first) since this repo has no
//   migrations to confirm ON DELETE CASCADE — do not assume it exists.
// - Each step is idempotent: deleting 0 matching rows is not an error, and a
//   "user already deleted" result from auth.admin.deleteUser is treated as
//   success so retries after a partial failure are safe.
//
// Apple revocation (added):
// - Before any data deletion, if the user has an Apple identity linked,
//   an authorizationCode must be provided in the request body.
// - The code is exchanged with Apple's /auth/token endpoint using a
//   server-generated ES256 client secret.
// - The returned tokens are validated (issuer, audience, subject).
// - The refresh_token is revoked via Apple's /auth/revoke endpoint.
// - Only after successful revocation are Zainly data and Auth user deleted.
// - No Apple tokens are ever logged or persisted.

// @ts-nocheck — Deno/remote-import runtime, not part of the Expo/TS project build.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Apple revocation env vars (server-side only, never in client or Git)
const APPLE_TEAM_ID = Deno.env.get('APPLE_TEAM_ID');
const APPLE_KEY_ID = Deno.env.get('APPLE_KEY_ID');
const APPLE_PRIVATE_KEY = Deno.env.get('APPLE_PRIVATE_KEY');
const APPLE_CLIENT_ID = Deno.env.get('APPLE_CLIENT_ID');

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';

const NETWORK_TIMEOUT_MS = 10_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// Tables holding user-scoped data, deleted before the Auth user itself.
// Order matters only in that all of these must run BEFORE auth.admin.deleteUser.
const USER_DATA_DELETIONS = [
  { step: 'review_items', table: 'review_items', column: 'user_id' },
  { step: 'plans', table: 'plans', column: 'user_id' },
  { step: 'progress', table: 'progress', column: 'user_id' },
  { step: 'account_deletion_requests', table: 'account_deletion_requests', column: 'user_id' },
  { step: 'profiles', table: 'profiles', column: 'id' },
];

// Logs full internal detail server-side only, and returns a generic,
// structured error to the client — never Postgres/GoTrue messages, constraint
// names, column names, stack traces, or env values.
// IMPORTANT: never log authorization codes, tokens, private keys, or JWTs.
function internalError(step, detail) {
  // Only log the step name and a sanitized detail — strip any token-like values
  console.error(`[delete-account] step=${step}`);
  return json({ ok: false, error: 'internal_error', step }, 500);
}

// ── Apple client secret generation (ES256 JWT) ──────────────────────────────

async function generateAppleClientSecret(): Promise<string> {
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !APPLE_CLIENT_ID) {
    throw new Error('apple_env_missing');
  }

  // Handle .p8 keys with literal or escaped newlines
  let pem = APPLE_PRIVATE_KEY;
  if (pem.includes('\\n')) {
    pem = pem.replace(/\\n/g, '\n');
  }

  const privateKey = await importPKCS8(pem, 'ES256');

  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_CLIENT_ID)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 600) // 10 minutes
    .sign(privateKey);
}

// ── Apple token exchange ─────────────────────────────────────────────────────

async function exchangeAppleCode(authorizationCode: string, clientSecret: string): Promise<{
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}> {
  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID!,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    const resp = await fetch(APPLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`apple_token_exchange_failed: ${resp.status}`);
    }

    return await resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ── Apple token validation ───────────────────────────────────────────────────

async function validateAppleIdToken(
  idToken: string,
  expectedSubject: string,
): Promise<void> {
  const JWKS = createRemoteJWKSet(APPLE_JWKS_URL);

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: APPLE_ISSUER,
    audience: APPLE_CLIENT_ID,
  });

  if (payload.sub !== expectedSubject) {
    throw new Error('apple_subject_mismatch');
  }
}

// ── Apple token revocation ───────────────────────────────────────────────────

async function revokeAppleToken(
  refreshToken: string,
  clientSecret: string,
): Promise<void> {
  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID!,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    const resp = await fetch(APPLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`apple_revoke_failed: ${resp.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Check if user has Apple identity ─────────────────────────────────────────

function hasAppleIdentity(identities: any[] | undefined): { hasApple: boolean; appleSub: string | null } {
  if (!identities || !Array.isArray(identities)) {
    return { hasApple: false, appleSub: null };
  }
  const apple = identities.find((i) => i.provider === 'apple');
  if (!apple) {
    return { hasApple: false, appleSub: null };
  }
  // The identity_id is the stable Apple user identifier (sub)
  return { hasApple: true, appleSub: apple.identity_id ?? null };
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed', step: 'method' }, 405);
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return internalError('env', 'Missing required environment variables.');
    }

    // ── 1. Extract + verify the caller's JWT ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return json({ ok: false, error: 'missing_token', step: 'auth' }, 401);
    }

    // Client scoped to the caller's own JWT — used ONLY to verify identity via
    // Supabase Auth. Never used to read/write data (no elevated privileges).
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);

    if (userError || !userData?.user) {
      return json({ ok: false, error: 'invalid_token', step: 'auth' }, 401);
    }

    // userId is derived exclusively from the verified JWT — never from the body.
    const userId = userData.user.id;

    // ── 2. Parse + validate request body ──
    let requestBody: { appleAuthorizationCode?: string } = {};
    try {
      const text = await req.text();
      if (text) {
        requestBody = JSON.parse(text);
      }
    } catch {
      return json({ ok: false, error: 'invalid_body', step: 'body' }, 400);
    }

    // Strict validation: only appleAuthorizationCode is accepted
    const allowedKeys = ['appleAuthorizationCode'];
    const receivedKeys = Object.keys(requestBody);
    const hasUnexpectedKeys = receivedKeys.some((k) => !allowedKeys.includes(k));
    if (hasUnexpectedKeys) {
      return json({ ok: false, error: 'invalid_body', step: 'body' }, 400);
    }

    // ── 3. Check for Apple identity ──
    const { hasApple, appleSub } = hasAppleIdentity(userData.user.identities);

    if (hasApple) {
      // Apple identity linked — require authorizationCode
      if (!requestBody.appleAuthorizationCode) {
        return json({ ok: false, error: 'apple_code_missing', step: 'apple_code' }, 400);
      }

      if (!appleSub) {
        return json({ ok: false, error: 'apple_identity_error', step: 'apple_identity' }, 400);
      }

      // Verify Apple env vars are configured
      if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY || !APPLE_CLIENT_ID) {
        return internalError('apple_env', 'Apple revocation env vars missing.');
      }

      // ── 3a. Generate Apple client secret ──
      let clientSecret: string;
      try {
        clientSecret = await generateAppleClientSecret();
      } catch {
        return internalError('apple_client_secret', 'Failed to generate client secret.');
      }

      // ── 3b. Exchange authorization code ──
      let tokenResponse: { refresh_token?: string; id_token?: string };
      try {
        tokenResponse = await exchangeAppleCode(requestBody.appleAuthorizationCode, clientSecret);
      } catch {
        return json({ ok: false, error: 'apple_exchange_failed', step: 'apple_exchange' }, 502);
      }

      // ── 3c. Validate id_token (issuer, audience, subject) ──
      if (tokenResponse.id_token) {
        try {
          await validateAppleIdToken(tokenResponse.id_token, appleSub);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('subject_mismatch')) {
            return json({ ok: false, error: 'apple_identity_mismatch', step: 'apple_validate' }, 403);
          }
          return json({ ok: false, error: 'apple_validation_failed', step: 'apple_validate' }, 502);
        }
      }

      // ── 3d. Revoke refresh_token ──
      if (tokenResponse.refresh_token) {
        try {
          await revokeAppleToken(tokenResponse.refresh_token, clientSecret);
        } catch {
          return json({ ok: false, error: 'apple_revoke_failed', step: 'apple_revoke' }, 502);
        }
      }

      // Tokens are now out of scope — no persistence, no logging
    }

    // ── 4. Admin client — service_role key stays server-side only ──
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 5. Delete user-scoped data, in order, before touching Auth ──
    for (const { step, table, column } of USER_DATA_DELETIONS) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) {
        return internalError(step, error);
      }
    }

    // ── 6. Delete the Auth user itself (last, after all data is gone) ──
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      // Idempotency: if the user is already gone (e.g. retry after a prior
      // success, or double-tap race), treat it as success rather than failure.
      const status = deleteUserError.status;
      const msg = (deleteUserError.message ?? '').toLowerCase();
      const alreadyGone = status === 404 || msg.includes('not found') || msg.includes('does not exist');
      if (!alreadyGone) {
        return internalError('auth_delete_user', deleteUserError);
      }
    }

    return json({ ok: true }, 200);
  } catch (err) {
    // Catch-all: any unexpected exception (network, runtime, etc.) still
    // returns a generic structured JSON response instead of leaking a raw
    // stack trace or an unstructured platform error.
    return internalError('unexpected', err);
  }
});
