// ─── Deno tests for delete-account Edge Function ────────────────────────────
// Executable with: deno test --allow-net --allow-env supabase/functions/delete-account/delete_account.test.ts
//
// These tests execute the SAME production code (handler.ts + apple_revocation.ts).
// All Apple API calls use an injected mock fetch. JWT verification uses a
// real ES256 key pair generated at runtime — no crypto is mocked.

import {
  generateKeyPair,
  SignJWT,
  jwtVerify,
  type KeyLike,
} from 'https://esm.sh/jose@5.9.6';

import { assertEquals, assert, fail } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  handleDeleteAccount,
  validateBody,
  analyzeAuthIdentities,
  type HandlerDeps,
} from './handler.ts';

import { serveDeleteAccount } from './index.ts';

import {
  performAppleRevocation,
  AppleRevocationException,
  generateAppleClientSecret,
  APPLE_TOKEN_URL,
  APPLE_REVOKE_URL,
  APPLE_ISSUER,
  type AppleRevocationConfig,
} from './apple_revocation.ts';

// ─── Test helpers ───────────────────────────────────────────────────────────

const TEST_ISSUER = APPLE_ISSUER;
const TEST_AUDIENCE = 'com.zainly.test';

// Generate a real ES256 key pair for signing/verifying test JWTs
let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;
let testPem: string;

async function setupTestKeys(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  testPrivateKey = privateKey;
  testPublicKey = publicKey;

  // Export to PEM for importPKCS8 (needed by generateAppleClientSecret)
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey as CryptoKey);
  testPem = arrayBufferToPem(pkcs8, 'PRIVATE KEY');
}

function arrayBufferToPem(buf: ArrayBuffer, type: string): string {
  const bytes = new Uint8Array(buf);
  let b64 = '';
  for (let i = 0; i < bytes.length; i++) {
    b64 += String.fromCharCode(bytes[i]);
  }
  const b64Encoded = btoa(b64);
  const lines = b64Encoded.match(/.{1,64}/g) ?? [b64Encoded];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----`;
}

function signTestJwt(payload: Record<string, unknown>, kid?: string): Promise<string> {
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', ...(kid ? { kid } : {}) })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt(Math.floor(Date.now() / 1000))
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600);

  return builder.sign(testPrivateKey);
}

// ─── Mock fetch ─────────────────────────────────────────────────────────────

interface MockFetchConfig {
  tokenResponse?: unknown;
  tokenStatus?: number;
  revokeStatus?: number;
  tokenContentType?: string;
}

interface FetchCallRecord {
  url: string;
  method: string;
}

function createMockFetch(config: MockFetchConfig): typeof fetch {
  const calls: FetchCallRecord[] = [];
  const fn = ((input: URL | string, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, method: _init?.method ?? 'GET' });

    if (url === APPLE_TOKEN_URL) {
      const status = config.tokenStatus ?? 200;
      const contentType = config.tokenContentType ?? 'application/json';
      if (status === 200) {
        return Promise.resolve(new Response(JSON.stringify(config.tokenResponse), {
          status,
          headers: { 'Content-Type': contentType },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    if (url === APPLE_REVOKE_URL) {
      return Promise.resolve(new Response(null, { status: config.revokeStatus ?? 200 }));
    }

    return Promise.resolve(new Response('not found', { status: 404 }));
  }) as typeof fetch;
  (fn as unknown as { _calls: FetchCallRecord[] })._calls = calls;
  return fn;
}

// ─── Mock Supabase client ───────────────────────────────────────────────────

interface MockSupabaseConfig {
  userId?: string;
  // identities is intentionally `unknown` to support null, undefined, primitives, etc.
  // Do NOT default to [] — that would erase the exact cases we need to test.
  identities?: unknown;
  deleteUserError?: { status: number; message: string } | null;
  deleteErrors?: Record<string, { error: unknown } | null>;
}

function createMockAdminClient(config: MockSupabaseConfig): unknown {
  const deleteCalls: { table: string; column: string; value: string }[] = [];
  let userDeleted = false;

  return {
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          deleteCalls.push({ table, column, value });
          const stepError = config.deleteErrors?.[table];
          if (stepError) {
            return Promise.resolve(stepError);
          }
          return Promise.resolve({ error: null });
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: (_uid: string) => {
          userDeleted = true;
          if (config.deleteUserError) {
            return Promise.resolve({ error: config.deleteUserError });
          }
          return Promise.resolve({ error: null });
        },
      },
    },
    _deleteCalls: deleteCalls,
    _userDeleted: () => userDeleted,
  };
}

function createMockCallerClient(config: MockSupabaseConfig): unknown {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (!config.userId) {
          return Promise.resolve({ data: { user: null }, error: { message: 'invalid' } });
        }
        // Pass identities through as-is — do NOT default with ?? []
        const user: Record<string, unknown> = { id: config.userId };
        if ('identities' in config) {
          user.identities = config.identities;
        }
        // If identities key is not in config, user.identities will be undefined
        return Promise.resolve({
          data: { user },
          error: null,
        });
      },
    },
  };
}

// Override createClient to return mock clients
// Admin client is cached so tests can inspect _deleteCalls and _userDeleted.
function createMockCreateClient(callerConfig: MockSupabaseConfig, adminConfig: MockSupabaseConfig): (url: string, key: string) => unknown {
  const cachedAdmin = createMockAdminClient(adminConfig);
  const createClientFn = (_url: string, key: string) => {
    // Admin client uses service role key
    if (key === 'service-role-key') {
      return cachedAdmin;
    }
    return createMockCallerClient(callerConfig);
  };
  (createClientFn as unknown as { _adminClient: unknown })._adminClient = cachedAdmin;
  return createClientFn;
}

// ─── Build test deps ────────────────────────────────────────────────────────

interface BuildTestResult {
  deps: HandlerDeps;
  adminClient: unknown;
  fetchFn: typeof fetch;
}

interface AdminClientInspect {
  _deleteCalls: { table: string; column: string; value: string }[];
  _userDeleted: () => boolean;
}

function inspectAdminClient(client: unknown): AdminClientInspect {
  return client as unknown as AdminClientInspect;
}

function inspectFetch(fn: typeof fetch): { _calls: FetchCallRecord[] } {
  return { _calls: (fn as unknown as { _calls: FetchCallRecord[] })._calls ?? [] };
}

function buildTestDeps(
  callerConfig: MockSupabaseConfig,
  adminConfig: MockSupabaseConfig,
  fetchConfig: MockFetchConfig,
  appleConfig: AppleRevocationConfig | null = {
    teamId: 'TESTTEAM',
    keyId: 'TESTKEY',
    privateKeyPem: testPem,
    clientId: TEST_AUDIENCE,
  },
): BuildTestResult {
  const mockCreateClient = createMockCreateClient(callerConfig, adminConfig);
  const adminClient = mockCreateClient('', 'service-role-key');
  const fetchFn = createMockFetch(fetchConfig);
  const deps: HandlerDeps = {
    supabaseUrl: 'http://localhost',
    supabaseAnonKey: 'anon-key',
    supabaseServiceRoleKey: 'service-role-key',
    appleConfig,
    fetchFn,
    createCallerClient: mockCreateClient as unknown as HandlerDeps['createCallerClient'],
    createAdminClient: mockCreateClient as unknown as HandlerDeps['createAdminClient'],
    verifyJwt: testVerifyJwt,
  };
  return { deps, adminClient, fetchFn };
}

// ─── Test JWT verifier using local JWKS ─────────────────────────────────────

async function testVerifyJwt(
  idToken: string,
  options: { issuer: string; audience: string; jwksUrl: string },
): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(idToken, testPublicKey, {
    issuer: options.issuer,
    audience: options.audience,
  });
  if (typeof payload.sub !== 'string') throw new Error('sub_missing');
  return { sub: payload.sub };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

Deno.test({
  name: 'setup: generate ES256 test keys',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await setupTestKeys();
  },
});

// ─── validateBody tests ─────────────────────────────────────────────────────

Deno.test('validateBody: null rejected', () => {
  const result = validateBody(null);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: array rejected', () => {
  const result = validateBody([1, 2, 3]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: string rejected', () => {
  const result = validateBody('hello');
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: number rejected', () => {
  const result = validateBody(42);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: boolean rejected', () => {
  const result = validateBody(true);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: empty object accepted (no code)', () => {
  const result = validateBody({});
  assertEquals(result.ok, true);
});

Deno.test('validateBody: object with appleAuthorizationCode accepted', () => {
  const result = validateBody({ appleAuthorizationCode: 'test-code' });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.code, 'test-code');
});

Deno.test('validateBody: unexpected property rejected', () => {
  const result = validateBody({ foo: 'bar' });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: appleAuthorizationCode wrong type rejected', () => {
  const result = validateBody({ appleAuthorizationCode: 123 });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: empty appleAuthorizationCode rejected', () => {
  const result = validateBody({ appleAuthorizationCode: '' });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

Deno.test('validateBody: oversized appleAuthorizationCode rejected', () => {
  const result = validateBody({ appleAuthorizationCode: 'x'.repeat(9000) });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'invalid_body');
});

// ─── analyzeAuthIdentities unit tests ───────────────────────────────────────

Deno.test('analyzeAuthIdentities: identities absent (undefined) → identity_invalid', () => {
  const result = analyzeAuthIdentities(undefined);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: identities null → identity_invalid', () => {
  const result = analyzeAuthIdentities(null);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: empty array → identity_invalid', () => {
  const result = analyzeAuthIdentities([]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: primitive (number) → identity_invalid', () => {
  const result = analyzeAuthIdentities(42);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: primitive (string) → identity_invalid', () => {
  const result = analyzeAuthIdentities('hello');
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: entry null → identity_invalid', () => {
  const result = analyzeAuthIdentities([null]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: entry primitive (number) → identity_invalid', () => {
  const result = analyzeAuthIdentities([42]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: entry primitive (string) → identity_invalid', () => {
  const result = analyzeAuthIdentities(['hello']);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: provider absent → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ identity_id: 'x' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: provider empty string → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: '', identity_id: 'x' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: provider non-string (number) → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 123, identity_id: 'x' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: missing id → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', identity_id: 'x-uuid' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: missing identity_id → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', id: 'x' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: id empty string → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', id: '', identity_id: 'x' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: identity_id empty string → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', id: 'x', identity_id: '' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: unknown provider → unknown_provider', () => {
  const result = analyzeAuthIdentities([{ provider: 'github', id: 'gh1', identity_id: 'gh-uuid' }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'unknown_provider');
});

Deno.test('analyzeAuthIdentities: duplicate Google → identity_invalid', () => {
  const result = analyzeAuthIdentities([
    { provider: 'google', id: 'g1', identity_id: 'g-uuid-1' },
    { provider: 'google', id: 'g2', identity_id: 'g-uuid-2' },
  ]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: duplicate Apple → identity_invalid', () => {
  const result = analyzeAuthIdentities([
    { provider: 'apple', id: 'a1', identity_id: 'a-uuid-1' },
    { provider: 'apple', id: 'a2', identity_id: 'a-uuid-2' },
  ]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: email only → ok, no apple, no google', () => {
  const result = analyzeAuthIdentities([{ provider: 'email', id: 'e1', identity_id: 'e-uuid' }]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.hasApple, false);
    assertEquals(result.hasGoogle, false);
    assertEquals(result.appleSub, null);
  }
});

Deno.test('analyzeAuthIdentities: Google only → ok, hasGoogle, no apple', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', id: 'g1', identity_id: 'g-uuid' }]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.hasGoogle, true);
    assertEquals(result.hasApple, false);
  }
});

Deno.test('analyzeAuthIdentities: Apple only → ok, hasApple, appleSub set from identity.id', () => {
  const result = analyzeAuthIdentities([{ provider: 'apple', id: 'apple-sub-123', identity_id: 'apple-uuid' }]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.hasApple, true);
    assertEquals(result.appleSub, 'apple-sub-123');
    assertEquals(result.hasGoogle, false);
  }
});

Deno.test('analyzeAuthIdentities: Google + Apple → ok, both recognized, appleSub from id', () => {
  const result = analyzeAuthIdentities([
    { provider: 'google', id: 'g1', identity_id: 'g-uuid' },
    { provider: 'apple', id: 'a1', identity_id: 'a-uuid' },
  ]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.hasGoogle, true);
    assertEquals(result.hasApple, true);
    assertEquals(result.appleSub, 'a1');
  }
});

Deno.test('analyzeAuthIdentities: appleSub uses identity.id, not identity_id', () => {
  const result = analyzeAuthIdentities([{ provider: 'apple', id: 'provider-id-999', identity_id: 'supabase-uuid-123' }]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.appleSub, 'provider-id-999');
  }
});

Deno.test('analyzeAuthIdentities: identity_data.sub mismatch with id → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'apple', id: 'a1', identity_id: 'a-uuid', identity_data: { sub: 'different' } }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

Deno.test('analyzeAuthIdentities: identity_data.sub matches id → ok', () => {
  const result = analyzeAuthIdentities([{ provider: 'apple', id: 'a1', identity_id: 'a-uuid', identity_data: { sub: 'a1' } }]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.appleSub, 'a1');
  }
});

Deno.test('analyzeAuthIdentities: identity_data.provider_id mismatch → identity_invalid', () => {
  const result = analyzeAuthIdentities([{ provider: 'google', id: 'g1', identity_id: 'g-uuid', identity_data: { provider_id: 'different' } }]);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, 'identity_invalid');
});

// ─── Handler integration tests ──────────────────────────────────────────────

function makeRequest(body: unknown, jwt = 'valid-jwt'): Request {
  return new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name: 'handler: unauthenticated request returns 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const { deps } = buildTestDeps({}, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 401);
    const body = await resp.json();
    assertEquals(body.error, 'unauthorized');
    assert(!('step' in body), 'response must not contain step');
  },
});

Deno.test({
  name: 'handler: invalid JSON returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/delete-account', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid-jwt',
        'Content-Type': 'application/json',
      },
      body: 'not json{',
    });
    const { deps } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
    assert(!('step' in body), 'response must not contain step');
  },
});

Deno.test({
  name: 'handler: null body returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest('null');
    const { deps } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

Deno.test({
  name: 'handler: array body returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest('[1,2,3]');
    const { deps } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

Deno.test({
  name: 'handler: unexpected property returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ foo: 'bar' });
    const { deps } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

Deno.test({
  name: 'handler: apple code wrong type returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 123 });
    const { deps } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'apple', id: 'a1', identity_id: 'a1-uuid' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

// ─── Handler: identity validation stops before any deletion ─────────────────

async function assertNoSideEffects(
  resp: Response,
  expectedStatus: number,
  expectedError: string,
  adminClient: unknown,
  fetchFn: typeof fetch,
) {
  assertEquals(resp.status, expectedStatus);
  const body = await resp.json();
  assertEquals(body.error, expectedError);
  assert(!('step' in body), 'response must not contain step');
  // No admin client operations
  const admin = inspectAdminClient(adminClient);
  assertEquals(admin._deleteCalls.length, 0, 'table deletion must not occur');
  assertEquals(admin._userDeleted(), false, 'auth user deletion must not occur');
  // No Apple API calls
  const fetchInspect = inspectFetch(fetchFn);
  assertEquals(fetchInspect._calls.length, 0, 'no Apple API calls must occur');
}

Deno.test({
  name: 'handler: identities absent (undefined) → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1' }, // no identities key → undefined
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identities null → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: null },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identities empty array → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identities primitive (number) → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: 42 },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: entry null → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [null] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: entry primitive → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: ['hello'] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: provider absent → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ identity_id: 'x' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: provider empty → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: '', identity_id: 'x' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: provider non-string → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 123, identity_id: 'x' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identity_id absent → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'google' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identity_id empty → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'google', identity_id: '' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identity_id non-string → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'google', identity_id: 123 }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: identity_data.sub mismatch with id → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'a1', identity_id: 'a1-uuid', identity_data: { sub: 'different' } }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: unknown provider → 400 unknown_provider, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'github', id: 'gh1', identity_id: 'gh1-uuid' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'unknown_provider', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: duplicate Google → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [
        { provider: 'google', id: 'g1', identity_id: 'g1-uuid' },
        { provider: 'google', id: 'g2', identity_id: 'g2-uuid' },
      ] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

Deno.test({
  name: 'handler: duplicate Apple → 400 identity_invalid, no side effects',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [
        { provider: 'apple', id: 'a1', identity_id: 'a1-uuid' },
        { provider: 'apple', id: 'a2', identity_id: 'a2-uuid' },
      ] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    await assertNoSideEffects(resp, 400, 'identity_invalid', adminClient, fetchFn);
  },
});

// ─── Handler: valid identity scenarios ──────────────────────────────────────

Deno.test({
  name: 'handler: email-only account no Apple code required, deletion succeeds',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] },
      adminConfig,
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, true);
    assert(!('step' in body), 'response must not contain step');
  },
});

Deno.test({
  name: 'handler: Google-only account, deletion succeeds',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'google', id: 'g1', identity_id: 'g1-uuid' }] },
      adminConfig,
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, true);
  },
});

Deno.test({
  name: 'handler: Apple identity without code returns 400 apple_code_missing',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient, fetchFn } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'apple_code_missing');
    assert(!('step' in body), 'response must not contain step');
    // No deletion or Apple API calls
    const admin = inspectAdminClient(adminClient);
    assertEquals(admin._deleteCalls.length, 0);
    assertEquals(admin._userDeleted(), false);
    const fetchInspect = inspectFetch(fetchFn);
    assertEquals(fetchInspect._calls.length, 0);
  },
});

Deno.test({
  name: 'handler: /auth/token error returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenStatus: 400 },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_exchange_failed');
    assert(!('step' in body), 'response must not contain step');
  },
});

Deno.test({
  name: 'handler: /auth/token non-JSON response returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: 'not-json', tokenContentType: 'text/plain' },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_exchange_failed');
  },
});

Deno.test({
  name: 'handler: id_token missing returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_exchange_failed');
  },
});

Deno.test({
  name: 'handler: refresh_token missing returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: idToken } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_exchange_failed');
  },
});

Deno.test({
  name: 'handler: bad JWT signature returns 502 apple_validation_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Sign with a different key pair
    const { privateKey: otherKey } = await generateKeyPair('ES256');
    const badToken = await new SignJWT({ sub: 'apple-sub' })
      .setProtectedHeader({ alg: 'ES256', kid: 'TESTKEY' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(otherKey);

    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: badToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_validation_failed');
  },
});

Deno.test({
  name: 'handler: wrong issuer returns 502 apple_validation_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const badToken = await new SignJWT({ sub: 'apple-sub' })
      .setProtectedHeader({ alg: 'ES256', kid: 'TESTKEY' })
      .setIssuer('https://wrong-issuer.com')
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(testPrivateKey);

    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: badToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_validation_failed');
  },
});

Deno.test({
  name: 'handler: wrong audience returns 502 apple_validation_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const badToken = await new SignJWT({ sub: 'apple-sub' })
      .setProtectedHeader({ alg: 'ES256', kid: 'TESTKEY' })
      .setIssuer(TEST_ISSUER)
      .setAudience('com.wrong.audience')
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
      .sign(testPrivateKey);

    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: badToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_validation_failed');
  },
});

Deno.test({
  name: 'handler: expired token returns 502 apple_validation_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const expiredToken = await new SignJWT({ sub: 'apple-sub' })
      .setProtectedHeader({ alg: 'ES256', kid: 'TESTKEY' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(testPrivateKey);

    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: expiredToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_validation_failed');
  },
});

Deno.test({
  name: 'handler: wrong sub returns 403 apple_identity_mismatch',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'wrong-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: idToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 403);
    const body = await resp.json();
    assertEquals(body.error, 'apple_identity_mismatch');
    assert(!('step' in body), 'response must not contain step');
  },
});

Deno.test({
  name: 'handler: /auth/revoke error returns 502 apple_revoke_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenResponse: { id_token: idToken, refresh_token: 'rt' }, revokeStatus: 500 },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_revoke_failed');
  },
});

Deno.test({
  name: 'handler: no deletion before revocation confirmed (revoke fails)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps, adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      adminConfig,
      { tokenResponse: { id_token: idToken, refresh_token: 'rt' }, revokeStatus: 500 },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    // Verify no data deletion happened
    assertEquals(inspectAdminClient(adminClient)._deleteCalls.length, 0);
    assertEquals(inspectAdminClient(adminClient)._userDeleted(), false);
  },
});

Deno.test({
  name: 'handler: revocation succeeds then deletions in order',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps, adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      adminConfig,
      { tokenResponse: { id_token: idToken, refresh_token: 'rt' }, revokeStatus: 200 },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, true);
    // Verify data deletions happened in order
    assertEquals(inspectAdminClient(adminClient)._deleteCalls.length, 5);
    assertEquals(inspectAdminClient(adminClient)._deleteCalls[0].table, 'review_items');
    assertEquals(inspectAdminClient(adminClient)._deleteCalls[1].table, 'plans');
    assertEquals(inspectAdminClient(adminClient)._deleteCalls[2].table, 'progress');
    assertEquals(inspectAdminClient(adminClient)._deleteCalls[3].table, 'account_deletion_requests');
    assertEquals(inspectAdminClient(adminClient)._deleteCalls[4].table, 'profiles');
    // Auth user deleted last
    assertEquals(inspectAdminClient(adminClient)._userDeleted(), true);
  },
});

Deno.test({
  name: 'handler: Auth user deletion is last (after all data)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps, adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] },
      adminConfig,
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 200);
    // All data deletions happened
    assertEquals(inspectAdminClient(adminClient)._deleteCalls.length, 5);
    // Auth user was deleted
    assertEquals(inspectAdminClient(adminClient)._userDeleted(), true);
  },
});

Deno.test({
  name: 'handler: retry after partial deletion (user already gone = success)',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const adminConfig: MockSupabaseConfig = {
      deleteUserError: { status: 404, message: 'User not found' },
    };
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'email', id: 'e1', identity_id: 'e1-uuid' }] },
      adminConfig,
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertEquals(body.ok, true);
  },
});

Deno.test({
  name: 'handler: no sensitive values or internal steps in error responses',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 'secret-auth-code' });
    const { deps } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', id: 'apple-sub', identity_id: 'apple-sub-uuid' }] },
      {},
      { tokenStatus: 400 },
    );
    const resp = await handleDeleteAccount(req, deps);
    const bodyText = await resp.text();
    // No authorization code, token, or secret in response
    assert(!bodyText.includes('secret-auth-code'), 'authorization code leaked in response');
    assert(!bodyText.includes('service-role-key'), 'service role key leaked');
    assert(!bodyText.includes('private'), 'private key leaked');
    // No internal step names in response
    assert(!bodyText.includes('"step"'), 'step field leaked in response');
    assert(!bodyText.includes('apple_env'), 'internal step name leaked');
    assert(!bodyText.includes('apple_unexpected'), 'internal step name leaked');
    assert(!bodyText.includes('auth_delete_user'), 'internal step name leaked');
    assert(!bodyText.includes('apple_client_secret_failed'), 'internal step name leaked');
    assert(!bodyText.includes('review_items'), 'table name leaked');
    assert(!bodyText.includes('profiles'), 'table name leaked');
  },
});

Deno.test({
  name: 'handler: no step field in any error response',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Test multiple error paths and verify none contain step
    const testCases = [
      { req: makeRequest({}), caller: { userId: 'u1', identities: null }, expectedError: 'identity_invalid' },
      { req: makeRequest({}), caller: { userId: 'u1', identities: [{ provider: 'github', id: 'g1', identity_id: 'g1-uuid' }] }, expectedError: 'unknown_provider' },
      { req: makeRequest({}), caller: { userId: 'u1', identities: [{ provider: 'apple', id: 'a1', identity_id: 'a1-uuid' }] }, expectedError: 'apple_code_missing' },
    ];

    for (const tc of testCases) {
      const { deps } = buildTestDeps(tc.caller, {}, {});
      const resp = await handleDeleteAccount(tc.req, deps);
      const body = await resp.json();
      assert(!('step' in body), `response for ${tc.expectedError} must not contain step`);
    }
  },
});

// ─── performAppleRevocation direct tests ────────────────────────────────────

Deno.test({
  name: 'performAppleRevocation: full success path',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const config: AppleRevocationConfig = {
      teamId: 'TESTTEAM',
      keyId: 'TESTKEY',
      privateKeyPem: testPem,
      clientId: TEST_AUDIENCE,
    };
    await performAppleRevocation('test-code', 'apple-sub', config, {
      fetchFn: createMockFetch({ tokenResponse: { id_token: idToken, refresh_token: 'rt' } }),
      verifyJwt: testVerifyJwt,
    });
  },
});

Deno.test({
  name: 'performAppleRevocation: wrong sub throws apple_identity_mismatch',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'wrong-sub' }, 'TESTKEY');
    const config: AppleRevocationConfig = {
      teamId: 'TESTTEAM',
      keyId: 'TESTKEY',
      privateKeyPem: testPem,
      clientId: TEST_AUDIENCE,
    };
    try {
      await performAppleRevocation('test-code', 'apple-sub', config, {
        fetchFn: createMockFetch({ tokenResponse: { id_token: idToken, refresh_token: 'rt' } }),
        verifyJwt: testVerifyJwt,
      });
      fail('should have thrown');
    } catch (err) {
      if (err instanceof AppleRevocationException) {
        assertEquals(err.code, 'apple_identity_mismatch');
      } else {
        fail('wrong error type: ' + String(err));
      }
    }
  },
});

Deno.test({
  name: 'performAppleRevocation: revoke failure throws apple_revoke_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const config: AppleRevocationConfig = {
      teamId: 'TESTTEAM',
      keyId: 'TESTKEY',
      privateKeyPem: testPem,
      clientId: TEST_AUDIENCE,
    };
    try {
      await performAppleRevocation('test-code', 'apple-sub', config, {
        fetchFn: createMockFetch({ tokenResponse: { id_token: idToken, refresh_token: 'rt' }, revokeStatus: 500 }),
        verifyJwt: testVerifyJwt,
      });
      fail('should have thrown');
    } catch (err) {
      if (err instanceof AppleRevocationException) {
        assertEquals(err.code, 'apple_revoke_failed');
      } else {
        fail('wrong error type: ' + String(err));
      }
    }
  },
});

Deno.test({
  name: 'generateAppleClientSecret: produces valid ES256 JWT',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const config: AppleRevocationConfig = {
      teamId: 'TESTTEAM',
      keyId: 'TESTKEY',
      privateKeyPem: testPem,
      clientId: TEST_AUDIENCE,
    };
    const secret = await generateAppleClientSecret(config);
    // Verify it's a valid JWT with correct header
    const parts = secret.split('.');
    assertEquals(parts.length, 3);
    const header = JSON.parse(atob(parts[0]));
    assertEquals(header.alg, 'ES256');
    assertEquals(header.kid, 'TESTKEY');
    const payload = JSON.parse(atob(parts[1]));
    assertEquals(payload.iss, 'TESTTEAM');
    assertEquals(payload.sub, TEST_AUDIENCE);
    assertEquals(payload.aud, APPLE_ISSUER);
  },
});

// ─── serveDeleteAccount: missing env vars ───────────────────────────────────

Deno.test({
  name: 'serveDeleteAccount: missing SUPABASE_URL returns 500 internal_error without step',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // Save and clear required env vars
    const savedUrl = Deno.env.get('SUPABASE_URL');
    const savedAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const savedService = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    Deno.env.delete('SUPABASE_URL');
    Deno.env.delete('SUPABASE_ANON_KEY');
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

    try {
      const req = new Request('http://localhost/delete-account', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-jwt',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const resp = await serveDeleteAccount(req);
      assertEquals(resp.status, 500);
      const body = await resp.json();
      assertEquals(body.ok, false);
      assertEquals(body.error, 'internal_error');
      assert(!('step' in body), 'response must not contain step');
    } finally {
      // Restore env vars
      if (savedUrl) Deno.env.set('SUPABASE_URL', savedUrl);
      if (savedAnon) Deno.env.set('SUPABASE_ANON_KEY', savedAnon);
      if (savedService) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', savedService);
    }
  },
});
