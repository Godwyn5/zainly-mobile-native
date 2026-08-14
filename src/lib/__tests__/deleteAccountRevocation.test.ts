/// <reference types="jest" />

// ─── deleteAccountRevocation.test.ts ─────────────────────────────────────────
// Source-inspection tests for the delete-account Edge Function's Apple
// revocation phase. Since no Deno runtime is available in this environment,
// these tests verify the source code's correctness by inspecting the actual
// TypeScript file content. They are NOT a substitute for runtime Edge testing.
//
// What is tested here:
// - Apple revocation phase exists BEFORE data deletion
// - jose library is imported and pinned
// - Server env vars are read (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID)
// - ES256 client secret generation with correct claims
// - Apple token exchange via /auth/token
// - id_token validation (issuer, audience, subject)
// - Token revocation via /auth/revoke
// - Network timeouts on Apple API calls
// - No token/secret/key values are logged
// - Body validation (only appleAuthorizationCode accepted)
// - Apple identity required when Apple-linked user
// - No Apple code required when no Apple identity
// - Data deletion happens AFTER revocation
// - Idempotent user deletion preserved
// - No userId accepted from body

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const edgeFunctionPath = path.resolve(
  process.cwd(),
  'supabase/functions/delete-account/index.ts',
);

const source = fs.readFileSync(edgeFunctionPath, 'utf-8');

describe('delete-account Edge Function — Apple revocation source inspection', () => {
  // ── Structure: revocation before deletion ──

  test('Apple revocation phase exists before data deletion', () => {
    const applePhaseIndex = source.indexOf('Check for Apple identity');
    const dataDeletionIndex = source.indexOf('Delete user-scoped data');
    expect(applePhaseIndex).toBeGreaterThan(-1);
    expect(dataDeletionIndex).toBeGreaterThan(-1);
    expect(applePhaseIndex).toBeLessThan(dataDeletionIndex);
  });

  // ── jose library pinned ──

  test('jose library imported and pinned to a version', () => {
    expect(source).toMatch(/from 'https:\/\/esm\.sh\/jose@\d+\.\d+\.\d+'/);
  });

  test('SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet imported from jose', () => {
    expect(source).toContain('SignJWT');
    expect(source).toContain('importPKCS8');
    expect(source).toContain('jwtVerify');
    expect(source).toContain('createRemoteJWKSet');
  });

  // ── Server env vars ──

  test('Apple env vars read from Deno.env', () => {
    expect(source).toContain("Deno.env.get('APPLE_TEAM_ID')");
    expect(source).toContain("Deno.env.get('APPLE_KEY_ID')");
    expect(source).toContain("Deno.env.get('APPLE_PRIVATE_KEY')");
    expect(source).toContain("Deno.env.get('APPLE_CLIENT_ID')");
  });

  // ── ES256 client secret ──

  test('Client secret uses ES256 algorithm', () => {
    expect(source).toContain("'ES256'");
    expect(source).toContain('importPKCS8');
  });

  test('Client secret has correct JWT claims (kid, iss, sub, aud, iat, exp)', () => {
    expect(source).toContain('setProtectedHeader');
    expect(source).toContain('kid: APPLE_KEY_ID');
    expect(source).toContain('setIssuer(APPLE_TEAM_ID)');
    expect(source).toContain('setSubject(APPLE_CLIENT_ID)');
    expect(source).toContain('setAudience(APPLE_ISSUER)');
    expect(source).toContain('setIssuedAt');
    expect(source).toContain('setExpirationTime');
  });

  test('Client secret has short expiration (<= 600 seconds)', () => {
    expect(source).toMatch(/setExpirationTime\(now \+ \d+\)/);
    const match = source.match(/setExpirationTime\(now \+ (\d+)\)/);
    expect(match).not.toBeNull();
    if (match) {
      const expSeconds = parseInt(match[1], 10);
      expect(expSeconds).toBeLessThanOrEqual(600);
    }
  });

  // ── .p8 key handling ──

  test('Handles .p8 keys with escaped newlines', () => {
    expect(source).toContain("\\\\n");
    expect(source).toContain('replace(/\\\\n/g');
  });

  // ── Apple token exchange ──

  test('Token exchange uses Apple /auth/token endpoint', () => {
    expect(source).toContain('https://appleid.apple.com/auth/token');
    expect(source).toContain('grant_type');
    expect(source).toContain('authorization_code');
  });

  // ── id_token validation ──

  test('id_token validated with issuer, audience, and subject', () => {
    expect(source).toContain('jwtVerify');
    expect(source).toContain('issuer: APPLE_ISSUER');
    expect(source).toContain('audience: APPLE_CLIENT_ID');
    expect(source).toContain('payload.sub !== expectedSubject');
  });

  test('Subject mismatch produces apple_identity_mismatch error', () => {
    expect(source).toContain('apple_subject_mismatch');
    expect(source).toContain('apple_identity_mismatch');
  });

  // ── Token revocation ──

  test('Refresh token revoked via Apple /auth/revoke endpoint', () => {
    expect(source).toContain('https://appleid.apple.com/auth/revoke');
    expect(source).toContain('token_type_hint');
    expect(source).toContain('refresh_token');
  });

  // ── Network timeouts ──

  test('Network timeouts on Apple API calls', () => {
    expect(source).toContain('AbortController');
    expect(source).toContain('setTimeout');
    expect(source).toContain('NETWORK_TIMEOUT_MS');
    // At least 2 AbortController instances (exchange + revoke)
    const abortCount = (source.match(/new AbortController/g) || []).length;
    expect(abortCount).toBeGreaterThanOrEqual(2);
  });

  // ── No token logging ──

  test('internalError does not log token values', () => {
    // The internalError function should only log the step name, not the detail
    const internalErrorMatch = source.match(/function internalError\(step, detail\)[\s\S]*?return json\(/);
    expect(internalErrorMatch).not.toBeNull();
    if (internalErrorMatch) {
      const fnBody = internalErrorMatch[0];
      // Should NOT contain detail in the console.error
      expect(fnBody).not.toMatch(/console\.error.*detail/);
    }
  });

  test('No console.log of authorizationCode, tokens, or private keys', () => {
    // Check that no console.log or console.error contains these sensitive values
    const lines = source.split('\n');
    for (const line of lines) {
      if (line.includes('console.')) {
        expect(line).not.toMatch(/authorizationCode/i);
        expect(line).not.toMatch(/access_token/i);
        expect(line).not.toMatch(/refresh_token/i);
        expect(line).not.toMatch(/id_token/i);
        expect(line).not.toMatch(/private_key/i);
        expect(line).not.toMatch(/clientSecret/i);
        expect(line).not.toMatch(/APPLE_PRIVATE_KEY/i);
      }
    }
  });

  // ── Body validation ──

  test('Body validation: only appleAuthorizationCode accepted', () => {
    expect(source).toContain('allowedKeys');
    expect(source).toContain('appleAuthorizationCode');
    expect(source).toContain('hasUnexpectedKeys');
  });

  test('Invalid body returns 400 before any mutation', () => {
    expect(source).toContain("'invalid_body'");
    const invalidBodyIndex = source.indexOf("'invalid_body'");
    const dataDeletionIndex = source.indexOf('Delete user-scoped data');
    expect(invalidBodyIndex).toBeLessThan(dataDeletionIndex);
  });

  // ── Apple identity checks ──

  test('Apple identity without code returns apple_code_missing before deletion', () => {
    expect(source).toContain("'apple_code_missing'");
    const codeMissingIndex = source.indexOf("'apple_code_missing'");
    const dataDeletionIndex = source.indexOf('Delete user-scoped data');
    expect(codeMissingIndex).toBeLessThan(dataDeletionIndex);
  });

  test('Account without Apple identity does not require Apple code', () => {
    // The hasApple check should gate the code requirement
    expect(source).toContain('hasAppleIdentity');
    expect(source).toMatch(/if \(hasApple\)/);
  });

  // ── Data deletion after revocation ──

  test('Data deletion happens after Apple revocation phase', () => {
    const revokeIndex = source.lastIndexOf('apple_revoke');
    const dataDeletionIndex = source.indexOf('Delete user-scoped data');
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(dataDeletionIndex).toBeGreaterThan(revokeIndex);
  });

  test('Auth user deletion is last (after all data)', () => {
    // The for-of loop that iterates USER_DATA_DELETIONS is the data deletion step
    const dataDeletionLoop = source.indexOf('for (const { step, table, column } of USER_DATA_DELETIONS)');
    // Use lastIndexOf to find the actual admin.deleteUser call, not comments
    const authDeleteIndex = source.lastIndexOf('auth.admin.deleteUser');
    expect(authDeleteIndex).toBeGreaterThan(dataDeletionLoop);
  });

  // ── Idempotency preserved ──

  test('Idempotent user deletion preserved (already gone = success)', () => {
    expect(source).toContain('alreadyGone');
    expect(source).toContain('not found');
    expect(source).toContain('does not exist');
  });

  // ── No userId from body ──

  test('userId derived from JWT only, never from body', () => {
    expect(source).toContain('userData.user.id');
    expect(source).toContain('never from the body');
    // The body should not be parsed for userId
    expect(source).not.toMatch(/body.*userId/i);
    expect(source).not.toMatch(/body.*user_id/i);
  });

  // ── Error responses don't leak internals ──

  test('Error responses use generic error codes, not raw Apple messages', () => {
    expect(source).toContain("'apple_exchange_failed'");
    expect(source).toContain("'apple_revoke_failed'");
    expect(source).toContain("'apple_identity_mismatch'");
    // Should NOT return raw error messages from Apple
    expect(source).not.toMatch(/error\.message.*apple/i);
  });

  // ── CORS preserved ──

  test('CORS headers preserved', () => {
    expect(source).toContain('Access-Control-Allow-Origin');
    expect(source).toContain('OPTIONS');
  });

  // ── JWT verification preserved ──

  test('JWT verification preserved (caller identity from Authorization header)', () => {
    expect(source).toContain('Authorization');
    expect(source).toContain('callerClient.auth.getUser');
  });

  // ── service_role key stays server-side ──

  test('service_role key used only for admin client, never returned', () => {
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('autoRefreshToken: false');
    expect(source).toContain('persistSession: false');
  });
});
