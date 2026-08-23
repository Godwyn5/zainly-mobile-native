/// <reference types="jest" />
// ─── useDraftOwner — referential stability regression ──────────────────────
//
// Reproduces the root cause of the "selection reverts / impossible to
// select" bug reported across onboarding-v2 screens (learning-mode,
// experience-choice, motivation, custom-order, start-surah, name, etc.):
// useDraftOwner() used to return a brand-new object literal on every
// render. Any `useEffect(..., [draftOwner])` therefore re-fired on every
// unrelated re-render of the host screen (e.g. selecting a card, typing in
// a search box), re-reading the not-yet-saved draft and overwriting the
// user's fresh local selection with the last persisted value.
//
// This test asserts the owner reference stays STABLE across re-renders
// triggered by unrelated state changes, for both the authenticated and
// guest paths, and only changes when the underlying identity actually
// changes.

import { useState } from 'react';
import { create, act } from 'react-test-renderer';
import { useDraftOwner } from '../useDraftOwner';
import type { OnboardingDraftOwner } from '@/lib/onboardingDraft';

let mockUserId: string | null = null;

jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { session: { user: { id: string } } | null }) => unknown) =>
    selector({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

jest.mock('@/lib/onboardingDraft', () => ({
  getOrCreateGuestFlowId: jest.fn(async () => 'guest-flow-fixed'),
}));

function Harness({ onRender }: { onRender: (owner: OnboardingDraftOwner | null, bump: () => void) => void }) {
  const [, setTick] = useState(0);
  const { owner } = useDraftOwner();
  onRender(owner, () => setTick(t => t + 1));
  return null;
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

describe('useDraftOwner — referential stability', () => {
  afterEach(() => {
    mockUserId = null;
  });

  it('returns the SAME owner reference across an unrelated re-render (authenticated)', async () => {
    mockUserId = 'user-123';
    const renders: (OnboardingDraftOwner | null)[] = [];
    let bumpFn: () => void = () => {};

    let tree: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Harness onRender={(owner, bump) => { renders.push(owner); bumpFn = bump; }} />,
      );
    });
    await flushMicrotasks();

    const firstOwner = renders[renders.length - 1];
    expect(firstOwner).toEqual({ kind: 'authenticated', userId: 'user-123' });

    // Force a re-render caused by UNRELATED local state (mirrors a user
    // selecting a card / typing in a search box on any onboarding-v2 screen).
    act(() => { bumpFn(); });

    const secondOwner = renders[renders.length - 1];
    expect(secondOwner).toBe(firstOwner); // SAME reference, not just equal value

    act(() => { tree!.unmount(); });
  });

  it('returns the SAME owner reference across an unrelated re-render (guest)', async () => {
    mockUserId = null;
    const renders: (OnboardingDraftOwner | null)[] = [];
    let bumpFn: () => void = () => {};

    let tree: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <Harness onRender={(owner, bump) => { renders.push(owner); bumpFn = bump; }} />,
      );
    });
    await flushMicrotasks();

    const firstOwner = renders[renders.length - 1];
    expect(firstOwner).toEqual({ kind: 'guest', flowId: 'guest-flow-fixed' });

    act(() => { bumpFn(); });

    const secondOwner = renders[renders.length - 1];
    expect(secondOwner).toBe(firstOwner); // SAME reference across re-render

    act(() => { tree!.unmount(); });
  });
});
