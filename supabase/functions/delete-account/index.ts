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

// @ts-nocheck — Deno/remote-import runtime, not part of the Expo/TS project build.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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
function internalError(step, detail) {
  console.error(`[delete-account] step=${step}`, detail);
  return json({ ok: false, error: 'internal_error', step }, 500);
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

    // ── 2. Admin client — service_role key stays server-side only ──
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 3. Delete user-scoped data, in order, before touching Auth ──
    for (const { step, table, column } of USER_DATA_DELETIONS) {
      const { error } = await admin.from(table).delete().eq(column, userId);
      if (error) {
        return internalError(step, error);
      }
    }

    // ── 4. Delete the Auth user itself (last, after all data is gone) ──
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
