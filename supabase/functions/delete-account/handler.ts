// ─── Edge Function: delete-account — Handler module ─────────────────────────
// Testable handler extracted from index.ts. All external dependencies are
// injected for unit testing. The entry point (index.ts) wires production deps.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { jwtVerify, createRemoteJWKSet } from 'https://esm.sh/jose@5.9.6';
import {
  performAppleRevocation,
  AppleRevocationException,
  type AppleRevocationConfig,
  APPLE_JWKS_URL,
} from './apple_revocation.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HandlerDeps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  appleConfig: AppleRevocationConfig | null;
  fetchFn: typeof fetch;
  createCallerClient: (url: string, key: string) => SupabaseClient;
  createAdminClient: (url: string, key: string) => SupabaseClient;
  verifyJwt: (
    idToken: string,
    options: { issuer: string; audience: string; jwksUrl: string },
  ) => Promise<{ sub: string }>;
}

export interface HandlerResult {
  status: number;
  body: { ok: boolean; error?: string; step?: string };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ALLOWED_PROVIDERS = new Set(['email', 'google', 'apple']);
const MAX_BODY_SIZE = 16 * 1024; // 16 KB
const MAX_APPLE_CODE_LENGTH = 8192; // generous: Apple codes are short-lived and ~1-2 KB max

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const USER_DATA_DELETIONS = [
  { step: 'review_items', table: 'review_items', column: 'user_id' },
  { step: 'plans', table: 'plans', column: 'user_id' },
  { step: 'progress', table: 'progress', column: 'user_id' },
  { step: 'account_deletion_requests', table: 'account_deletion_requests', column: 'user_id' },
  { step: 'profiles', table: 'profiles', column: 'id' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(body: { ok: boolean; error?: string; step?: string }, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function internalError(step: string): Response {
  // Never log token values, secrets, or authorization codes
  console.error(`[delete-account] step=${step}`);
  return json({ ok: false, error: 'internal_error', step }, 500);
}

// ─── Body validation ────────────────────────────────────────────────────────

export function validateBody(raw: unknown): { ok: true; code?: string } | { ok: false; error: string } {
  // Reject null, arrays, primitives
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_body' };
  }

  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Reject unexpected properties
  for (const key of keys) {
    if (key !== 'appleAuthorizationCode') {
      return { ok: false, error: 'invalid_body' };
    }
  }

  // If appleAuthorizationCode is present, validate type and size
  if ('appleAuthorizationCode' in obj) {
    const code = obj.appleAuthorizationCode;
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_APPLE_CODE_LENGTH) {
      return { ok: false, error: 'invalid_body' };
    }
    return { ok: true, code };
  }

  return { ok: true };
}

// ─── Identity detection (Edge Function side) ───────────────────────────────

interface EdgeIdentity {
  provider: string;
  identity_id: string;
}

export function detectAppleIdentity(
  identities: unknown,
): { hasApple: boolean; appleSub: string | null; hasUnknownProvider: boolean } {
  if (!Array.isArray(identities) || identities.length === 0) {
    return { hasApple: false, appleSub: null, hasUnknownProvider: false };
  }

  let hasApple = false;
  let appleSub: string | null = null;
  let hasUnknownProvider = false;

  for (const entry of identities) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as EdgeIdentity;
    const provider = e.provider;

    if (!ALLOWED_PROVIDERS.has(provider)) {
      hasUnknownProvider = true;
    }

    if (provider === 'apple') {
      hasApple = true;
      appleSub = typeof e.identity_id === 'string' && e.identity_id.length > 0 ? e.identity_id : null;
    }
  }

  return { hasApple, appleSub, hasUnknownProvider };
}

// ─── JWT verification (production implementation) ───────────────────────────

const APPLE_JWKS = createRemoteJWKSet(new URL(APPLE_JWKS_URL));

export async function verifyAppleIdToken(
  idToken: string,
  options: { issuer: string; audience: string; jwksUrl: string },
): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: options.issuer,
    audience: options.audience,
  });

  if (typeof payload.sub !== 'string') {
    throw new Error('sub_missing');
  }

  return { sub: payload.sub };
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handleDeleteAccount(
  req: Request,
  deps: HandlerDeps,
): Promise<Response> {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed', step: 'method' }, 405);
    }

    // ── 1. Extract + verify the caller's JWT ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return json({ ok: false, error: 'unauthorized', step: 'auth' }, 401);
    }

    const callerClient = deps.createCallerClient(deps.supabaseUrl, deps.supabaseAnonKey);
    const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);

    if (userError || !userData?.user) {
      return json({ ok: false, error: 'unauthorized', step: 'auth' }, 401);
    }

    const userId = userData.user.id;

    // ── 2. Parse + validate request body ──
    const text = await req.text();
    if (text.length > MAX_BODY_SIZE) {
      return json({ ok: false, error: 'invalid_body', step: 'body' }, 400);
    }

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      return json({ ok: false, error: 'invalid_body', step: 'body' }, 400);
    }

    const bodyValidation = validateBody(parsed);
    if (!bodyValidation.ok) {
      return json({ ok: false, error: bodyValidation.error, step: 'body' }, 400);
    }

    // ── 3. Check identities for Apple + unknown providers ──
    const { hasApple, appleSub, hasUnknownProvider } = detectAppleIdentity(userData.user.identities);

    if (hasUnknownProvider) {
      return json({ ok: false, error: 'unknown_provider', step: 'identity' }, 400);
    }

    if (hasApple) {
      // Apple identity linked — require authorizationCode
      if (!bodyValidation.ok || !bodyValidation.code) {
        return json({ ok: false, error: 'apple_code_missing', step: 'apple_code' }, 400);
      }

      if (!appleSub) {
        return json({ ok: false, error: 'apple_identity_mismatch', step: 'apple_identity' }, 400);
      }

      if (!deps.appleConfig) {
        return internalError('apple_env');
      }

      // ── 3a-3h. Full Apple revocation saga ──
      try {
        await performAppleRevocation(
          bodyValidation.code,
          appleSub,
          deps.appleConfig,
          {
            fetchFn: deps.fetchFn,
            verifyJwt: deps.verifyJwt,
          },
        );
      } catch (err) {
        if (err instanceof AppleRevocationException) {
          const errorMap: Record<string, { error: string; status: number }> = {
            apple_client_secret_failed: { error: 'internal_error', status: 500 },
            apple_exchange_failed: { error: 'apple_exchange_failed', status: 502 },
            apple_token_response_invalid: { error: 'apple_exchange_failed', status: 502 },
            apple_id_token_missing: { error: 'apple_exchange_failed', status: 502 },
            apple_refresh_token_missing: { error: 'apple_exchange_failed', status: 502 },
            apple_validation_failed: { error: 'apple_validation_failed', status: 502 },
            apple_identity_mismatch: { error: 'apple_identity_mismatch', status: 403 },
            apple_revoke_failed: { error: 'apple_revoke_failed', status: 502 },
            apple_env_missing: { error: 'internal_error', status: 500 },
          };
          const mapped = errorMap[err.code] ?? { error: 'internal_error', status: 500 };
          return json({ ok: false, error: mapped.error, step: err.code }, mapped.status);
        }
        return internalError('apple_unexpected');
      }
    }

    // ── 4. Admin client — service_role key stays server-side only ──
    const admin = deps.createAdminClient(deps.supabaseUrl, deps.supabaseServiceRoleKey);

    // ── 5. Delete user-scoped data, in order, before touching Auth ──
    for (const { step, table, column } of USER_DATA_DELETIONS) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) {
        return internalError(step);
      }
    }

    // ── 6. Delete the Auth user itself (last, after all data is gone) ──
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      const status = deleteUserError.status;
      const msg = (deleteUserError.message ?? '').toLowerCase();
      const alreadyGone = status === 404 || msg.includes('not found') || msg.includes('does not exist');
      if (!alreadyGone) {
        return internalError('auth_delete_user');
      }
    }

    return json({ ok: true }, 200);
  } catch {
    return internalError('unexpected');
  }
}
