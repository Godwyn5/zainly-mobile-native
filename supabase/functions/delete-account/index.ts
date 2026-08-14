// ─── Edge Function: delete-account — Entry point ────────────────────────────
// Minimal Deno.serve wrapper. All logic is in handler.ts for testability.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { handleDeleteAccount, verifyAppleIdToken, type HandlerDeps } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const APPLE_TEAM_ID = Deno.env.get('APPLE_TEAM_ID');
const APPLE_KEY_ID = Deno.env.get('APPLE_KEY_ID');
const APPLE_PRIVATE_KEY = Deno.env.get('APPLE_PRIVATE_KEY');
const APPLE_CLIENT_ID = Deno.env.get('APPLE_CLIENT_ID');

const appleConfig =
  APPLE_TEAM_ID && APPLE_KEY_ID && APPLE_PRIVATE_KEY && APPLE_CLIENT_ID
    ? {
        teamId: APPLE_TEAM_ID,
        keyId: APPLE_KEY_ID,
        privateKeyPem: APPLE_PRIVATE_KEY,
        clientId: APPLE_CLIENT_ID,
      }
    : null;

Deno.serve((req: Request) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'internal_error', step: 'env' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const deps: HandlerDeps = {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    appleConfig,
    fetchFn: globalThis.fetch,
    createCallerClient: (url: string, key: string) => createClient(url, key),
    createAdminClient: (url: string, key: string) =>
      createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    verifyJwt: verifyAppleIdToken,
  };

  return handleDeleteAccount(req, deps);
});
