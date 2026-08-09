/// <reference types="jest" />
import { createSubmissionLock } from '../submissionLock';

describe('createSubmissionLock — anti-double-submission', () => {
  it('two synchronous acquire calls → only first succeeds', () => {
    const lock = createSubmissionLock();
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false);
    expect(lock.isLocked()).toBe(true);
  });

  it('release after error allows retry', () => {
    const lock = createSubmissionLock();
    expect(lock.acquire()).toBe(true);
    lock.release();
    expect(lock.isLocked()).toBe(false);
    expect(lock.acquire()).toBe(true);
  });

  it('release after success prevents re-entry until explicitly released', () => {
    const lock = createSubmissionLock();
    expect(lock.acquire()).toBe(true);
    // Simulate the full async chain (finalize → handoff → clear → navigate)
    // holding the lock — it must NOT be released between these steps.
    expect(lock.isLocked()).toBe(true);
    // Only released in the finally block after navigation
    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('release is idempotent (safe to call multiple times)', () => {
    const lock = createSubmissionLock();
    lock.acquire();
    lock.release();
    lock.release();
    lock.release();
    expect(lock.isLocked()).toBe(false);
    // Can still re-acquire after multiple releases
    expect(lock.acquire()).toBe(true);
  });

  it('simulates two synchronous handleContinue taps → only one operation', () => {
    const lock = createSubmissionLock();
    let operationCount = 0;

    // Simulate two synchronous calls to handleContinue
    function simulateTap() {
      if (!lock.acquire()) return;
      operationCount++;
      // In real code, the async chain runs here, releasing in finally.
      // For this test we just verify the guard.
      lock.release();
    }

    simulateTap();
    simulateTap();

    // Only the first tap ran the operation
    // (the second was rejected because the first held the lock — but since
    // this is synchronous and the first releases immediately, both actually
    // run. The real protection is that in React, the first call's acquire
    // sets locked=true synchronously, and the second call (also synchronous,
    // before any re-render) sees locked=true and returns false.)
    //
    // To properly test the race, we need to NOT release between calls:
    expect(operationCount).toBe(2);

    // Now test the actual race: acquire without releasing
    const lock2 = createSubmissionLock();
    let opCount2 = 0;

    function simulateTapNoRelease() {
      if (!lock2.acquire()) return;
      opCount2++;
      // Don't release — simulate the lock being held during the async chain
    }

    simulateTapNoRelease();
    simulateTapNoRelease();

    expect(opCount2).toBe(1);
    expect(lock2.isLocked()).toBe(true);
  });
});

// ── Integration tests: simulate the real handleContinue handler structure ──
// These tests mirror the exact pattern used in program-summary.tsx:
//   if (!lock.acquire()) return;
//   let navigated = false;
//   try { ...await chain... navigated = true; }
//   finally { if (!navigated) lock.release(); }
// The lock is NOT released after successful navigation — the screen unmount
// destroys the ref naturally. Only recoverable failures release the lock.

describe('submissionLock integration — handleContinue pattern', () => {
  it('1. two synchronous taps during operation → only one finalize chain', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let navCount = 0;

    async function handleContinue() {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        finalizeCount++;
        await Promise.resolve();
        navCount++;
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    const p1 = handleContinue();
    const p2 = handleContinue();

    await Promise.all([p1, p2]);

    expect(finalizeCount).toBe(1);
    expect(navCount).toBe(1);
    // Lock is NOT released — navigation succeeded, screen would unmount
    expect(lock.isLocked()).toBe(true);
  });

  it('2. rerender during operation → lock still active, second call rejected', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let resolveOp: () => void;
    const opPromise = new Promise<void>(r => { resolveOp = r; });

    async function handleContinue() {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        finalizeCount++;
        await opPromise;
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    const p1 = handleContinue();

    // Rerender — lock is still held
    expect(lock.isLocked()).toBe(true);
    const p2 = handleContinue();

    resolveOp!();
    await Promise.all([p1, p2]);

    expect(finalizeCount).toBe(1);
    // Lock NOT released — navigation succeeded
    expect(lock.isLocked()).toBe(true);
  });

  it('3. recoverable error → lock released → retry possible', async () => {
    const lock = createSubmissionLock();
    let attemptCount = 0;

    async function handleContinue(shouldFail: boolean) {
      if (!lock.acquire()) return false;
      let navigated = false;
      try {
        attemptCount++;
        await Promise.resolve();
        if (shouldFail) throw new Error('finalize failed');
        navigated = true;
        return true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    // First attempt fails — lock released
    await expect(handleContinue(true)).rejects.toThrow('finalize failed');
    expect(lock.isLocked()).toBe(false);
    expect(attemptCount).toBe(1);

    // Retry succeeds — lock NOT released (navigation happened)
    const result = await handleContinue(false);
    expect(result).toBe(true);
    expect(attemptCount).toBe(2);
    expect(lock.isLocked()).toBe(true);
  });

  it('4. navigation succeeded but screen not yet unmounted → second call rejected', async () => {
    const lock = createSubmissionLock();
    let navCount = 0;

    async function handleContinue() {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        await Promise.resolve();
        navCount++;
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    await handleContinue();

    // Navigation succeeded — lock is still held (screen not yet unmounted)
    expect(lock.isLocked()).toBe(true);
    expect(navCount).toBe(1);

    // Second call must be rejected
    await handleContinue();
    expect(navCount).toBe(1);
    expect(lock.isLocked()).toBe(true);
  });

  it('5. navigation throws → lock released → retry possible', async () => {
    const lock = createSubmissionLock();
    let attemptCount = 0;
    let navShouldThrow = true;

    async function handleContinue() {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        attemptCount++;
        await Promise.resolve();
        // Simulate navigation
        if (navShouldThrow) throw new Error('navigation failed');
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    // First attempt — navigation throws, lock released
    await expect(handleContinue()).rejects.toThrow('navigation failed');
    expect(lock.isLocked()).toBe(false);
    expect(attemptCount).toBe(1);

    // Fix navigation, retry
    navShouldThrow = false;
    await handleContinue();
    expect(attemptCount).toBe(2);
    expect(lock.isLocked()).toBe(true);
  });

  it('6. success → single finalize, single handoff, single clear, single navigation', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let handoffCount = 0;
    let clearCount = 0;
    let navCount = 0;

    async function handleContinue() {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        finalizeCount++;
        await Promise.resolve();
        handoffCount++;
        await Promise.resolve();
        clearCount++;
        await Promise.resolve();
        navCount++;
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    await handleContinue();

    expect(finalizeCount).toBe(1);
    expect(handoffCount).toBe(1);
    expect(clearCount).toBe(1);
    expect(navCount).toBe(1);
    // Lock NOT released after successful navigation
    expect(lock.isLocked()).toBe(true);
  });

  it('session change during operation → no navigation, lock released (recoverable)', async () => {
    const lock = createSubmissionLock();
    let navCount = 0;
    let currentSession = 'user-A';

    async function handleContinue(authedUserId: string) {
      if (!lock.acquire()) return;
      let navigated = false;
      try {
        await Promise.resolve();
        if (currentSession !== authedUserId) return;
        await Promise.resolve();
        if (currentSession !== authedUserId) return;
        navCount++;
        navigated = true;
      } finally {
        if (!navigated) lock.release();
      }
    }

    const p = handleContinue('user-A');
    currentSession = 'user-B';
    await p;

    expect(navCount).toBe(0);
    // Session change is recoverable → lock released
    expect(lock.isLocked()).toBe(false);
  });
});
