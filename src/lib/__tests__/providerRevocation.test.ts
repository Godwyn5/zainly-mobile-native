/// <reference types="jest" />

// ─── providerRevocation.test.ts ──────────────────────────────────────────────
// Behavioral tests for provider revocation during account deletion.
// Tests cover: identity detection, Google re-auth + revoke, Apple proof
// collection, state/user verification, cancellation, mismatch, network errors,
// multi-provider ordering, and email-only unchanged path.

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockUser: {
  id: string;
  identities: { provider: string; identity_id: string }[] | null;
} | null = null;

jest.mock('@/db/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: mockUser },
        error: null,
      })),
    },
  },
}));

// Apple mock
const mockAppleSignInAsync = jest.fn();
const mockAppleIsAvailableAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...args: unknown[]) => mockAppleSignInAsync(...(args as [])),
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
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    signIn: (...args: unknown[]) => mockGoogleSignIn(...(args as [])),
    revokeAccess: (...args: unknown[]) => mockGoogleRevokeAccess(...(args as [])),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function setMockUser(identities: { provider: string; identity_id: string }[] | null) {
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
  // Default: getRandomValues returns predictable bytes for state generation
  mockGetRandomValues.mockImplementation((arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
  });
});

// ── detectSocialIdentities ───────────────────────────────────────────────────

describe('detectSocialIdentities', () => {
  test('1. email-only account returns empty array', () => {
    expect(detectSocialIdentities([{ provider: 'email', identity_id: 'email-123' }])).toEqual([]);
  });

  test('2. Google identity detected', () => {
    const result = detectSocialIdentities([{ provider: 'google', identity_id: 'google-123' }]);
    expect(result).toEqual([{ provider: 'google', identityId: 'google-123' }]);
  });

  test('3. Apple identity detected', () => {
    const result = detectSocialIdentities([{ provider: 'apple', identity_id: 'apple-123' }]);
    expect(result).toEqual([{ provider: 'apple', identityId: 'apple-123' }]);
  });

  test('4. multiple identities detected', () => {
    const result = detectSocialIdentities([
      { provider: 'email', identity_id: 'email-1' },
      { provider: 'google', identity_id: 'google-1' },
      { provider: 'apple', identity_id: 'apple-1' },
    ]);
    expect(result).toEqual([
      { provider: 'google', identityId: 'google-1' },
      { provider: 'apple', identityId: 'apple-1' },
    ]);
  });

  test('5. unknown provider ignored (not treated as social)', () => {
    const result = detectSocialIdentities([{ provider: 'github', identity_id: 'gh-1' }]);
    expect(result).toEqual([]);
  });

  test('null/undefined identities returns empty array', () => {
    expect(detectSocialIdentities(null)).toEqual([]);
    expect(detectSocialIdentities(undefined)).toEqual([]);
  });
});

// ── revokeGoogleAccess ───────────────────────────────────────────────────────

describe('revokeGoogleAccess', () => {
  test('6. matching Google account: re-auth + revoke succeeds', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(true);
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(1);
  });

  test('7. wrong Google account: no revoke, no deletion', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('wrong-google-id'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_mismatch');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('8. Google cancellation: no revoke, no deletion', async () => {
    mockGoogleSignIn.mockResolvedValue(googleCancelledResponse());
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('9. revokeAccess failure: no deletion proceeds', async () => {
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    mockGoogleRevokeAccess.mockRejectedValue(new Error('revoke failed'));
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('google_revoke_failed');
  });

  test('Google cancellation via error code: provider_reauth_cancelled', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED', message: 'cancelled' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
  });

  test('Play Services not available: provider_unavailable', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'PLAY_SERVICES_NOT_AVAILABLE', message: 'no play services' });
    const result = await revokeGoogleAccess('google-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_unavailable');
  });
});

// ── obtainAppleRevocationProof ───────────────────────────────────────────────

describe('obtainAppleRevocationProof', () => {
  test('11. matching user + valid state + code: success', async () => {
    // The state is generated internally; we need to capture it from signInAsync call
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: 'fresh-code' });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authorizationCode).toBe('fresh-code');
    }
  });

  test('12. wrong Apple user: apple_user_mismatch', async () => {
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'wrong-apple-user', state: opts.state, authorizationCode: 'code' });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_user_mismatch');
  });

  test('13. wrong state: apple_state_mismatch', async () => {
    mockAppleSignInAsync.mockResolvedValue(
      appleCredential({ user: 'apple-user-123', state: 'wrong-state', authorizationCode: 'code' }),
    );
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_state_mismatch');
  });

  test('14. null authorizationCode: apple_code_missing', async () => {
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-user-123', state: opts.state, authorizationCode: null });
    });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('apple_code_missing');
  });

  test('15. Apple cancellation: provider_reauth_cancelled', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    const result = await obtainAppleRevocationProof('apple-user-123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
  });

  test('16. network error: network reason', async () => {
    mockAppleSignInAsync.mockRejectedValue(new Error('Network error'));
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
});

// ── prepareRevocationProofs (full orchestration) ────────────────────────────

describe('prepareRevocationProofs', () => {
  test('1. email-only account: no revocation needed, empty proof', async () => {
    setMockUser([{ provider: 'email', identity_id: 'email-1' }]);
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proof.appleAuthorizationCode).toBeUndefined();
    }
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
  });

  test('17. Google + Apple: deterministic order (Apple proof first, then Google revoke)', async () => {
    setMockUser([
      { provider: 'google', identity_id: 'google-123' },
      { provider: 'apple', identity_id: 'apple-123' },
    ]);

    const callOrder: string[] = [];
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
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
    setMockUser([{ provider: 'google', identity_id: 'google-123' }]);
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('google-123'));
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proof.appleAuthorizationCode).toBeUndefined();
    }
    expect(mockGoogleRevokeAccess).toHaveBeenCalledTimes(1);
  });

  test('Apple only: proof collected, no Google revoke', async () => {
    setMockUser([{ provider: 'apple', identity_id: 'apple-123' }]);
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proof.appleAuthorizationCode).toBe('apple-code');
    }
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google mismatch: no deletion, no Apple proof collected after', async () => {
    setMockUser([
      { provider: 'apple', identity_id: 'apple-123' },
      { provider: 'google', identity_id: 'google-123' },
    ]);
    // Apple succeeds first
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
      return appleCredential({ user: 'apple-123', state: opts.state, authorizationCode: 'apple-code' });
    });
    // Google mismatch
    mockGoogleSignIn.mockResolvedValue(googleSuccessResponse('wrong-google'));

    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_mismatch');
  });

  test('Apple cancellation: no Google revoke, no deletion', async () => {
    setMockUser([{ provider: 'apple', identity_id: 'apple-123' }]);
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    const result = await prepareRevocationProofs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('provider_reauth_cancelled');
    expect(mockGoogleRevokeAccess).not.toHaveBeenCalled();
  });

  test('Google revoke fails after Apple proof: no deletion', async () => {
    setMockUser([
      { provider: 'apple', identity_id: 'apple-123' },
      { provider: 'google', identity_id: 'google-123' },
    ]);
    mockAppleSignInAsync.mockImplementation(async (opts: { state: string }) => {
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
});

// ── signOutGoogle vs revokeAccess separation ─────────────────────────────────

describe('10. simple logout uses signOut, not revokeAccess', () => {
  test('signOutGoogle in socialAuth.ts does not call revokeAccess', () => {
    // Inspect the source to verify signOutGoogle only calls signOut, not revokeAccess
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const socialAuthSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/socialAuth.ts'),
      'utf-8',
    );

    // Find the signOutGoogle function body
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

    // Find the revokeGoogleAccess function body
    const match = revocationSource.match(/export async function revokeGoogleAccess[\s\S]*?^}/m);
    expect(match).not.toBeNull();
    if (match) {
      const fnBody = match[0];
      expect(fnBody).toContain('GoogleSignin.revokeAccess');
      expect(fnBody).not.toContain('GoogleSignin.signOut');
    }
  });
});
