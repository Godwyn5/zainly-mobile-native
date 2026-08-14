/// <reference types="jest" />

// ─── providerRevocation.test.ts ──────────────────────────────────────────────
// Behavioral tests for provider revocation during account deletion.
// Covers: identity detection (fail-closed), Google re-auth + revoke with
// separated error phases, Apple refreshAsync proof collection, state/user
// verification, cancellation, mismatch, network errors, multi-provider
// ordering, email-only path, retry saga, and signOutGoogle vs revokeAccess.

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockUser: {
  id: string;
  identities: { id: string; user_id: string; provider: string; identity_id: string }[] | null;
} | null = null;

jest.mock('@/db/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: mockUser },
        error: null,
      })),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}));

// Apple mock — refreshAsync replaces signInAsync
const mockAppleRefreshAsync = jest.fn();
const mockAppleIsAvailableAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  refreshAsync: (...args: unknown[]) => mockAppleRefreshAsync(...(args as [])),
  signInAsync: jest.fn(),
  isAvailableAsync: (...args: unknown[]) => mockAppleIsAvailableAsync(...(args as [])),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// expo-crypto mock
const mockGetRandomValues = jest.fn();
jest.mock('expo-crypto', () => ({
  getRandomValues: (...args: unknown[]) => mockGetRandomValues(...(args as [])),
  digestStringAsync: jest.fn(async () => 'mocked-hash'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  CryptoEncoding: { HEX: 'hex', BASE64: 'base64' },
}));

// Google mock
const mockGoogleSignIn = jest.fn();
const mockGoogleRevokeAccess = jest.fn(async () => null);
const mockGoogleHasPlayServices = jest.fn(async () => true);
const mockGoogleSignOut = jest.fn(async () => null);
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signIn: (...args: unknown[]) => mockGoogleSignIn(...(args as [])),
    revokeAccess: (...args: unknown[]) => mockGoogleRevokeAccess(...(args as [])),
    signOut: (...args: unknown[]) => mockGoogleSignOut(...(args as [])),
    hasPlayServices: (...args: unknown[]) => mockGoogleHasPlayServices(...(args as [])),
  },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
  isCancelledResponse: (response: { type: string }) => response.type === 'cancelled',
  isErrorWithCode: (error: unknown): error is { code: string; message: string } =>
    typeof error === 'object' && error !== null && 'code' in error,
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
}));

// React Native Platform mock
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

/* eslint-disable import/first */
import {
  detectSocialIdentities,
  revokeGoogleAccess,
  obtainAppleRevocationProof,
  prepareRevocationProofs,
} from '../providerRevocation';
/* eslint-enable import/first */

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeIdentity(provider: string, identity_id: string) {
  return { id: `id-${identity_id}`, user_id: 'user-123', provider, identity_id };
}

function setMockUser(identities: ReturnType<typeof makeIdentity>[] | null) {
  mockUser = { id: 'user-123', identities };
}

function googleSuccessResponse(userId: string) {
  return {
    type: 'success' as const,
    data: {
      user: { id: userId, name: 'Test', email: 'test@test.com', photo: null, familyName: null, givenName: null },
      scopes: [],
      idToken: 'mock-id-token',
      serverAuthCode: null,
    },
  };
}

function googleCancelledResponse() {
  return { type: 'cancelled' as const };
}

function appleCredential(opts: {
  user?: string;
  state?: string | null;
  authorizationCode?: string | null;
  identityToken?: string | null;
}) {
  return {
    user: opts.user ?? 'apple-user-123',
    state: opts.state ?? null,
    fullName: null,
    email: null,
    realUserStatus: 1,
    identityToken: opts.identityToken ?? 'mock-identity-token',
    authorizationCode: opts.authorizationCode !== undefined ? opts.authorizationCode : 'mock-auth-code',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  mockAppleIsAvailableAsync.mockResolvedValue(true);
  mockGoogleHasPlayServices.mockResolvedValue(true);
  mockGoogleRevokeAccess.mockResolvedValue(null);
  mockGetRandomValues.mockImplementation((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
  });
});

// ── detectSocialIdentities ───────────────────────────────────────────────────

describe('detectSocialIdentities', () => {
  test('email-only account returns ok with empty identities', () => {
    const result = detectSocialIdentities([makeIdentity('email', 'email-123')]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identities).toEqual([]);
  });

  test('Google identity detected', () => {
    const result = detectSocialIdentities([makeIdentity('google', 'google-123')]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identities).toEqual([{ provider: 'google', identityId: 'google-123' }]);
  });

  test('Apple identity detected', () => {
    const result = detectSocialIdentities([makeIdentity('apple', 'apple-123')]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identities).toEqual([{ provider: 'apple', identityId: 'apple-123' }]);
  });

  test('Google + Apple detected together', () => {
    const result = detectSocialIdentities([
      makeIdentity('email', 'email-1'),
      makeIdentity('google', 'google-1'),
      makeIdentity('apple', 'apple-1'),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identities).toEqual([
        { provider: 'google', identityId: 'google-1' },
        { provider: 'apple', identityId: 'apple-1' },
      ]);
    }
  });

  test('unknown provider returns fail-closed unknown_provider', () => {
    const result = detectSocialIdentities([makeIdentity('github', 'gh-1')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_provider');
  });

  test('null identities returns identity_invalid', () => {
    const result = detectSocialIdentities(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('undefined identities returns identity_invalid', () => {
    const result = detectSocialIdentities(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('empty array returns identity_invalid', () => {
    const result = detectSocialIdentities([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('malformed identity (missing provider) returns identity_invalid', () => {
    const result = detectSocialIdentities([{ identity_id: 'x' } as unknown as ReturnType<typeof makeIdentity>]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('malformed identity (missing identity_id) returns identity_invalid', () => {
    const result = detectSocialIdentities([{ provider: 'google' } as unknown as ReturnType<typeof makeIdentity>]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('Google with empty identity_id returns identity_invalid', () => {
    const result = detectSocialIdentities([makeIdentity('google', '')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('Apple with empty identity_id returns identity_invalid', () => {
    const result = detectSocialIdentities([makeIdentity('apple', '')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });
});

// ── revokeGoogleAccess ───────────────────────────────────────────────────────

describe('revokeGoogleAccess', () => {
  test('matching Google account: re-auth + revoke succeeds', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(true);
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(1);
  });

  test('wrong Google account: provider_mismatch, no revoke', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('wrong-google-id'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_mismatch');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google cancellation (response): provider_reauth_cancelled, no revoke', async () => {
    mockGoogleSignIn.mockResolvedValue(googleCancelledResponse());
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google auth failure (error code): google_reauth_failed, no revoke', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_REQUIRED', message: 'sign in required' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_reauth_failed');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google cancellation (error code): provider_reauth_cancelled, no revoke', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED', message: 'cancelled' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Play Services not available: provider_unavailable, no revoke', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'PLAY_SERVICES_NOT_AVAILABLE', message: 'no play services' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_unavailable');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('revokeAccess failure: google_revoke_failed (distinct from auth failure)', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockRejectedValue(new Error('revoke failed'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_revoke_failed');
  });

  test('revokeAccess failure with error code: google_revoke_failed', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockRejectedValue({ code: 'UNKNOWN', message: 'revoke error' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_revoke_failed');
  });

  test('Google auth non-success response: google_reauth_failed, no revoke', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'error' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_reauth_failed');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google auth returns no user ID: google_reauth_failed', async () => {
    mockGoogleSignIn.mockResolvedValue({
      type: 'success',
      data: { user: { id: '', name: '', email: '', photo: null, familyName: null, givenName: null }, scopes: [], idToken: '', serverAuthCode: null },
    });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_reauth_failed');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });
});

// ── obtainAppleRevocationProof (refreshAsync) ────────────────────────────────

describe('obtainAppleRevocationProof', () => {
  test('matching user + valid state + code: success', async () => {
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: 'fresh-code' });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.authorizationCode).toBe('fresh-code');
    // Verify refreshAsync was called with user and state
    expect(mockAppleRefreshAsync).toHaveBeenCalledWith({
      user: 'apple-user-123',
      state: expect.any(String),
    });
  });

  test('wrong Apple user: apple_user_mismatch', async () => {
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'wrong-apple-user', state: opts.state, authorizationCode: 'code' });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_user_mismatch');
  });

  test('wrong state: apple_state_mismatch', async () => {
    mockAppleRefreshAsync.mockResolvedValue(
      appleCredential({ user: 'apple-user-123', state: 'wrong-state', authorizationCode: 'code' }),
    );
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_state_mismatch');
  });

  test('null authorizationCode: apple_code_missing', async () => {
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: null });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_code_missing');
  });

  test('empty authorizationCode: apple_code_missing', async () => {
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: '' });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_code_missing');
  });

  test('Apple cancellation: provider_reauth_cancelled, no mutation', async () => {
    mockAppleRefreshAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
  });

  test('network error: network reason', async () => {
    mockAppleRefreshAsync.mockRejectedValue(new Error('Network error'));
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network');
  });

  test('Apple not available: provider_unavailable', async () => {
    mockAppleIsAvailableAsync.mockResolvedValue(false);
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_unavailable');
  });

  test('refreshAsync called with user and state', async () => {
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: 'code' });
    });
    await obtainAppleRevocationProof('apple-user-123');
    expect(mockAppleRefreshAsync).toHaveBeenCalledTimes(1);
    const callArg = mockAppleRefreshAsync.mock.calls[0][0];
    expect(callArg.user).toBe('apple-user-123');
    expect(typeof callArg.state).toBe('string');
    expect(callArg.state.length).toBeGreaterThan(0);
  });
});

// ── prepareRevocationProofs (full orchestration) ────────────────────────────

describe('prepareRevocationProofs', () => {
  test('email-only account: no revocation needed, empty proof', async () => {
    setMockUser([makeIdentity('email', 'email-1')]);
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proof.appleAuthorizationCode).toBeUndefined();
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
    expect(mockAppleRefreshAsync).not.toHaveBeenCalled();
  });

  test('Google + Apple: deterministic order (Apple proof first, then Google revoke)', async () => {
    setMockUser([
      makeIdentity('google', 'google-123'),
      makeIdentity('apple', 'apple-123'),
    ]);

    const callOrder: string[] = [];
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      callOrder.push('apple');
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    mockGoogleSignIn.mockImplementation(async () => {
      callOrder.push('google');
      return googleSuccessResponse('google-123');
    });

    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    expect(callOrder).toEqual(['apple', 'google']);
  });

  test('Google only: revoke succeeds, no Apple proof', async () => {
    setMockUser([makeIdentity('google', 'google-123')]);
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proof.appleAuthorizationCode).toBeUndefined();
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(1);
  });

  test('Apple only: proof collected, no Google revoke', async () => {
    setMockUser([makeIdentity('apple', 'apple-123')]);
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proof.appleAuthorizationCode).toBe('apple-code');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google mismatch: no deletion, Apple proof collected before mismatch', async () => {
    setMockUser([
      makeIdentity('apple', 'apple-123'),
      makeIdentity('google', 'google-123'),
    ]);
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('wrong-google'));

    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_mismatch');
  });

  test('Apple cancellation: no Google revoke, no deletion', async () => {
    setMockUser([makeIdentity('apple', 'apple-123')]);
    mockAppleRefreshAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google revoke fails after Apple proof: no deletion', async () => {
    setMockUser([
      makeIdentity('apple', 'apple-123'),
      makeIdentity('google', 'google-123'),
    ]);
    mockAppleRefreshAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockRejectedValue(new Error('revoke failed'));

    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_revoke_failed');
  });

  test('getUser error: unknown reason', async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { supabase } = require('@/db/client');
    /* eslint-enable @typescript-eslint/no-require-imports */
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'expired' } });
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown');
  });

  test('identities null: identity_invalid', async () => {
    setMockUser(null);
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('identities empty: identity_invalid', async () => {
    setMockUser([]);
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('identity_invalid');
  });

  test('unknown provider: unknown_provider', async () => {
    setMockUser([makeIdentity('github', 'gh-1')]);
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_provider');
  });

  test('Google auth failure distinct from revoke failure', async () => {
    setMockUser([makeIdentity('google', 'google-123')]);
    mockGoogleSignIn.mockRejectedValue(new Error('auth failed'));
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_reauth_failed');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });
});

// ── Retry saga: Google revoke succeeds, then Edge fails, then retry ─────────

describe('retry saga: Google revoke + Edge failure + retry', () => {
  test('first attempt: Google revokes, then a new auth+revoke on retry', async () => {
    setMockUser([makeIdentity('google', 'google-123')]);

    // First attempt: Google auth + revoke succeed
    mockGoogleSignIn.mockResolvedValueOnce(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockResolvedValueOnce(null);

    const first = await prepareRevocationProofs();
    expect(first.ok).toBe(true);

    // Simulate Edge Function failure (caller would retry)
    // Second attempt: new Google auth + new revoke
    mockGoogleSignIn.mockResolvedValueOnce(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockResolvedValueOnce(null);

    const second = await prepareRevocationProofs();
    expect(second.ok).toBe(true);

    // Verify two separate auth + revoke cycles
    expect(mockGoogleSignIn).toHaveBeenCalledTimes(2);
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(2);
  });
});

// ── signOutGoogle calls signOut, never revokeAccess ─────────────────────────

describe('signOutGoogle calls signOut, never revokeAccess', () => {
  test('signOutGoogle in socialAuth.ts calls GoogleSignin.signOut, not revokeAccess', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const socialAuthSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/socialAuth.ts'),
      'utf-8',
    );

    const match = socialAuthSource.match(/export async function signOutGoogle[\s\S]*?^}/m);
    expect(match).not.toBeNull();
    if (match) {
      const fnBody = match[0];
      expect(fnBody).toContain('GoogleSignin.signOut');
      expect(fnBody).not.toContain('revokeAccess');
    }
  });

  test('revokeGoogleAccess in providerRevocation.ts calls revokeAccess, not signOut', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const revocationSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/providerRevocation.ts'),
      'utf-8',
    );

    const match = revocationSource.match(/export async function revokeGoogleAccess[\s\S]*?^}/m);
    expect(match).not.toBeNull();
    if (match) {
      const fnBody = match[0];
      expect(fnBody).toContain('GoogleSignin.revokeAccess');
      expect(fnBody).not.toContain('GoogleSignin.signOut');
    }
  });
});
