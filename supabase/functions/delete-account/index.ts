// ─── Edge Function: delete-account — Entry point ────────────────────────────
// Minimal Deno.serve wrapper. All logic is in handler.ts for testability.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.3';
import { handleDeleteAccount, verifyAppleIdToken, type HandlerDeps } from './handler.ts';

export function serveDeleteAccount(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('[delete-account] missing required env vars');
    return Promise.resolve(
      new Response(
        JSON.stringify({ ok: false, error: 'internal_error' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
  }

  const appleTeamId = Deno.env.get('APPLE_TEAM_ID');
  const appleKeyId = Deno.env.get('APPLE_KEY_ID');
  const applePrivateKey = Deno.env.get('APPLE_PRIVATE_KEY');
  const appleClientId = Deno.env.get('APPLE_CLIENT_ID');

  const appleConfig =
    appleTeamId && appleKeyId && applePrivateKey && appleClientId
      ? {
          teamId: appleTeamId,
          keyId: appleKeyId,
          privateKeyPem: applePrivateKey,
          clientId: appleClientId,
        }
      : null;

  const deps: HandlerDeps = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
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
}

Deno.serve((req: Request) => serveDeleteAccount(req));
