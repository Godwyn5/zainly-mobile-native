/// <reference types="jest" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  savePendingOnboardingPlan,
  readPendingOnboardingPlan,
  hasValidPendingOnboardingPlan,
  clearPendingOnboardingPlan,
  type PendingPlanInput,
} from '../pendingOnboardingPlan';

// Mock AsyncStorage — jest.mock calls are hoisted by babel-jest above imports
jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
      setItem: jest.fn((key: string, value: string) => {
        store[key] = value;
        return Promise.resolve();
      }),
      removeItem: jest.fn((key: string) => {
        delete store[key];
        return Promise.resolve();
      }),
      multiRemove: jest.fn((keys: string[]) => {
        for (const k of keys) delete store[k];
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = {};
        return Promise.resolve();
      }),
      getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
    },
  };
});

const STORAGE_KEY = 'zainly:onboardingV2:pendingPlan';

const validInput: PendingPlanInput = {
  firstName: 'Ahmed',
  learningMode: 'recommended',
  knownSurahs: [1, 114],
  startingSurah: null,
  customSurahOrder: [],
  continueWithRest: false,
  notificationPreference: 'enabled',
  discoverySource: 'tiktok',
  experienceChoice: 'unlimited',
};

beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  return (AsyncStorage.clear as jest.Mock)();
});

// ─── savePendingOnboardingPlan ──────────────────────────────────────────────

describe('savePendingOnboardingPlan', () => {
  it('persists a valid payload and returns ok', async () => {
    const result = await savePendingOnboardingPlan(validInput);
    expect(result.ok).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      expect.any(String),
    );
  });

  it('the stored payload includes version=1 and a valid createdAt ISO string', async () => {
    await savePendingOnboardingPlan(validInput);
    const raw = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1] as string;
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(typeof parsed.createdAt).toBe('string');
    expect(new Date(parsed.createdAt).getTime()).not.toBeNaN();
  });

  it('preserves all input fields in the stored payload', async () => {
    await savePendingOnboardingPlan(validInput);
    const raw = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1] as string;
    const parsed = JSON.parse(raw);
    expect(parsed.firstName).toBe('Ahmed');
    expect(parsed.learningMode).toBe('recommended');
    expect(parsed.knownSurahs).toEqual([1, 114]);
    expect(parsed.notificationPreference).toBe('enabled');
    expect(parsed.discoverySource).toBe('tiktok');
    expect(parsed.experienceChoice).toBe('unlimited');
  });
});

// ─── readPendingOnboardingPlan — valid payload ──────────────────────────────

describe('readPendingOnboardingPlan — valid payload', () => {
  it('returns the payload when valid and not expired', async () => {
    await savePendingOnboardingPlan(validInput);
    const payload = await readPendingOnboardingPlan();
    expect(payload).not.toBeNull();
    expect(payload!.firstName).toBe('Ahmed');
    expect(payload!.learningMode).toBe('recommended');
    expect(payload!.version).toBe(1);
  });
});

// ─── readPendingOnboardingPlan — invalid payload ────────────────────────────

describe('readPendingOnboardingPlan — invalid payload', () => {
  it('returns null and clears when the payload is not valid JSON', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not-json{{{');
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('returns null and clears when version is wrong', async () => {
    const bad = { ...validInput, version: 999, createdAt: new Date().toISOString() };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
  });

  it('returns null and clears when learningMode is invalid', async () => {
    const bad = {
      ...validInput,
      version: 1,
      createdAt: new Date().toISOString(),
      learningMode: 'invalid_mode',
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
  });

  it('returns null and clears when knownSurahs is not an array', async () => {
    const bad = {
      ...validInput,
      version: 1,
      createdAt: new Date().toISOString(),
      knownSurahs: 'not-an-array',
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
  });

  it('returns null and clears when continueWithRest is not a boolean', async () => {
    const bad = {
      ...validInput,
      version: 1,
      createdAt: new Date().toISOString(),
      continueWithRest: 'yes',
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
  });

  it('returns null when nothing is stored', async () => {
    const payload = await readPendingOnboardingPlan();
    expect(payload).toBeNull();
  });
});

// ─── readPendingOnboardingPlan — TTL ────────────────────────────────────────

describe('readPendingOnboardingPlan — TTL', () => {
  it('returns payload when createdAt is within 72h', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const payload = { ...validInput, version: 1 as const, createdAt: recent };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const result = await readPendingOnboardingPlan();
    expect(result).not.toBeNull();
    expect(result!.firstName).toBe('Ahmed');
  });

  it('returns null and clears when createdAt is older than 72h', async () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString(); // 73h ago
    const payload = { ...validInput, version: 1 as const, createdAt: old };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const result = await readPendingOnboardingPlan();
    expect(result).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('returns null and clears when createdAt is corrupted', async () => {
    const bad = { ...validInput, version: 1 as const, createdAt: 'not-a-date' };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
    const result = await readPendingOnboardingPlan();
    expect(result).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

// ─── hasValidPendingOnboardingPlan ──────────────────────────────────────────

describe('hasValidPendingOnboardingPlan', () => {
  it('returns true when a valid pending plan exists', async () => {
    await savePendingOnboardingPlan(validInput);
    expect(await hasValidPendingOnboardingPlan()).toBe(true);
  });

  it('returns false when no pending plan exists', async () => {
    expect(await hasValidPendingOnboardingPlan()).toBe(false);
  });

  it('returns false when the pending plan is expired', async () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString();
    const payload = { ...validInput, version: 1 as const, createdAt: old };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    expect(await hasValidPendingOnboardingPlan()).toBe(false);
  });
});

// ─── clearPendingOnboardingPlan ─────────────────────────────────────────────

describe('clearPendingOnboardingPlan', () => {
  it('removes the stored payload', async () => {
    await savePendingOnboardingPlan(validInput);
    expect(await hasValidPendingOnboardingPlan()).toBe(true);
    await clearPendingOnboardingPlan();
    expect(await hasValidPendingOnboardingPlan()).toBe(false);
  });

  it('does not throw when called with no stored payload', async () => {
    await expect(clearPendingOnboardingPlan()).resolves.toBeUndefined();
  });
});
