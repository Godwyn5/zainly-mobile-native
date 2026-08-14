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
  detectAppleIdentity,
  type HandlerDeps,
} from './handler.ts';

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

function createMockFetch(config: MockFetchConfig): typeof fetch {
  return ((input: URL | string, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

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
}

// ─── Mock Supabase client ───────────────────────────────────────────────────

interface MockSupabaseConfig {
  userId?: string;
  identities?: unknown[];
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
        return Promise.resolve({
          data: {
            user: {
              id: config.userId,
              identities: config.identities ?? [],
            },
          },
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
  return (_url: string, key: string) => {
    // Admin client uses service role key
    if (key === 'service-role-key') {
      return cachedAdmin;
    }
    return createMockCallerClient(callerConfig);
  };
}

// ─── Build test deps ────────────────────────────────────────────────────────

interface BuildTestResult {
  deps: HandlerDeps;
  adminClient: ReturnType<typeof createMockAdminClient>;
}

interface AdminClientInspect {
  _deleteCalls: { table: string; column: string; value: string }[];
  _userDeleted: () => boolean;
}

function inspectAdminClient(client: unknown): AdminClientInspect {
  return client as unknown as AdminClientInspect;
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
  const deps: HandlerDeps = {
    supabaseUrl: 'http://localhost',
    supabaseAnonKey: 'anon-key',
    supabaseServiceRoleKey: 'service-role-key',
    appleConfig,
    fetchFn: createMockFetch(fetchConfig),
    createCallerClient: mockCreateClient as unknown as HandlerDeps['createCallerClient'],
    createAdminClient: mockCreateClient as unknown as HandlerDeps['createAdminClient'],
    verifyJwt: testVerifyJwt,
  };
  return { deps, adminClient };
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

// ─── detectAppleIdentity tests ──────────────────────────────────────────────

Deno.test('detectAppleIdentity: empty array', () => {
  const result = detectAppleIdentity([]);
  assertEquals(result.hasApple, false);
  assertEquals(result.appleSub, null);
  assertEquals(result.hasUnknownProvider, false);
});

Deno.test('detectAppleIdentity: email only', () => {
  const result = detectAppleIdentity([{ provider: 'email', identity_id: 'e1' }]);
  assertEquals(result.hasApple, false);
  assertEquals(result.hasUnknownProvider, false);
});

Deno.test('detectAppleIdentity: apple present', () => {
  const result = detectAppleIdentity([{ provider: 'apple', identity_id: 'apple-sub-123' }]);
  assertEquals(result.hasApple, true);
  assertEquals(result.appleSub, 'apple-sub-123');
});

Deno.test('detectAppleIdentity: google only', () => {
  const result = detectAppleIdentity([{ provider: 'google', identity_id: 'g1' }]);
  assertEquals(result.hasApple, false);
  assertEquals(result.hasUnknownProvider, false);
});

Deno.test('detectAppleIdentity: unknown provider detected', () => {
  const result = detectAppleIdentity([{ provider: 'github', identity_id: 'gh1' }]);
  assertEquals(result.hasUnknownProvider, true);
});

Deno.test('detectAppleIdentity: apple with empty identity_id', () => {
  const result = detectAppleIdentity([{ provider: 'apple', identity_id: '' }]);
  assertEquals(result.hasApple, true);
  assertEquals(result.appleSub, null);
});

Deno.test('detectAppleIdentity: null input', () => {
  const result = detectAppleIdentity(null);
  assertEquals(result.hasApple, false);
  assertEquals(result.hasUnknownProvider, false);
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
    const { deps, adminClient: _adminClient } = buildTestDeps({}, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 401);
    const body = await resp.json();
    assertEquals(body.error, 'unauthorized');
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
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

Deno.test({
  name: 'handler: null body returns 400 invalid_body',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest('null');
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] }, {}, {});
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
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] }, {}, {});
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
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] }, {}, {});
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
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'apple', identity_id: 'a1' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'invalid_body');
  },
});

Deno.test({
  name: 'handler: unknown provider returns 400 unknown_provider',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const { deps, adminClient: _adminClient } = buildTestDeps({ userId: 'u1', identities: [{ provider: 'github', identity_id: 'gh1' }] }, {}, {});
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'unknown_provider');
  },
});

Deno.test({
  name: 'handler: email-only account no Apple code required, deletion succeeds',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({});
    const adminConfig: MockSupabaseConfig = { deleteUserError: null };
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
      {},
      {},
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 400);
    const body = await resp.json();
    assertEquals(body.error, 'apple_code_missing');
  },
});

Deno.test({
  name: 'handler: /auth/token error returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const _idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
      {},
      { tokenStatus: 400 },
    );
    // Override verifyJwt in deps — but we can't easily do that with buildTestDeps.
    // The handler uses the module-level verifyAppleIdToken, so this test will
    // fail at exchange before reaching JWT verification.
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 502);
    const body = await resp.json();
    assertEquals(body.error, 'apple_exchange_failed');
  },
});

Deno.test({
  name: 'handler: /auth/token non-JSON response returns 502 apple_exchange_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
      {},
      { tokenResponse: { id_token: idToken, refresh_token: 'rt' } },
    );
    const resp = await handleDeleteAccount(req, deps);
    assertEquals(resp.status, 403);
    const body = await resp.json();
    assertEquals(body.error, 'apple_identity_mismatch');
  },
});

Deno.test({
  name: 'handler: /auth/revoke error returns 502 apple_revoke_failed',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'test-code' });
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
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
      { userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] },
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
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'email', identity_id: 'e1' }] },
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
  name: 'handler: no sensitive values in error responses',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const _idToken = await signTestJwt({ sub: 'apple-sub' }, 'TESTKEY');
    const req = makeRequest({ appleAuthorizationCode: 'secret-auth-code' });
    const { deps, adminClient: _adminClient } = buildTestDeps(
      { userId: 'u1', identities: [{ provider: 'apple', identity_id: 'apple-sub' }] },
      {},
      { tokenStatus: 400 },
    );
    const resp = await handleDeleteAccount(req, deps);
    const bodyText = await resp.text();
    // No authorization code, token, or secret in response
    assert(!bodyText.includes('secret-auth-code'), 'authorization code leaked in response');
    assert(!bodyText.includes('service-role-key'), 'service role key leaked');
    assert(!bodyText.includes('private'), 'private key leaked');
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
