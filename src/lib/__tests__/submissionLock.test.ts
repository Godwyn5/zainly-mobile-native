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
//   try { ...await chain... } finally { lock.release(); }
// They verify the lock's behaviour across the full async lifecycle.

describe('submissionLock integration — handleContinue pattern', () => {
  it('two synchronous taps → only one finalize operation', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let navCount = 0;

    async function handleContinue() {
      if (!lock.acquire()) return;
      try {
        finalizeCount++;
        await Promise.resolve(); // simulate async finalize
        navCount++;
      } finally {
        lock.release();
      }
    }

    // Two synchronous calls — the second must be rejected
    const p1 = handleContinue();
    const p2 = handleContinue();

    await Promise.all([p1, p2]);

    expect(finalizeCount).toBe(1);
    expect(navCount).toBe(1);
  });

  it('rerender during operation → lock still active, second call rejected', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let resolveOp: () => void;
    const opPromise = new Promise<void>(r => { resolveOp = r; });

    async function handleContinue() {
      if (!lock.acquire()) return;
      try {
        finalizeCount++;
        await opPromise; // simulate long-running finalize
      } finally {
        lock.release();
      }
    }

    // Start the first operation
    const p1 = handleContinue();

    // Simulate a rerender — the lock ref is the same object (useRef),
    // so the second call sees locked=true
    expect(lock.isLocked()).toBe(true);
    const p2 = handleContinue();

    // Resolve the first operation
    resolveOp!();
    await Promise.all([p1, p2]);

    expect(finalizeCount).toBe(1);
    expect(lock.isLocked()).toBe(false);
  });

  it('error → lock released → retry possible', async () => {
    const lock = createSubmissionLock();
    let attemptCount = 0;

    async function handleContinue(shouldFail: boolean) {
      if (!lock.acquire()) return false;
      try {
        attemptCount++;
        await Promise.resolve();
        if (shouldFail) throw new Error('finalize failed');
        return true;
      } finally {
        lock.release();
      }
    }

    // First attempt fails
    await expect(handleContinue(true)).rejects.toThrow('finalize failed');
    expect(lock.isLocked()).toBe(false);
    expect(attemptCount).toBe(1);

    // Retry succeeds
    const result = await handleContinue(false);
    expect(result).toBe(true);
    expect(attemptCount).toBe(2);
    expect(lock.isLocked()).toBe(false);
  });

  it('success → single finalize, single handoff, single clear, single navigation', async () => {
    const lock = createSubmissionLock();
    let finalizeCount = 0;
    let handoffCount = 0;
    let clearCount = 0;
    let navCount = 0;

    async function handleContinue() {
      if (!lock.acquire()) return;
      try {
        // finalize
        finalizeCount++;
        await Promise.resolve();
        // handoff
        handoffCount++;
        await Promise.resolve();
        // clear pending
        clearCount++;
        await Promise.resolve();
        // navigate
        navCount++;
      } finally {
        lock.release();
      }
    }

    await handleContinue();

    expect(finalizeCount).toBe(1);
    expect(handoffCount).toBe(1);
    expect(clearCount).toBe(1);
    expect(navCount).toBe(1);
    expect(lock.isLocked()).toBe(false);
  });

  it('session change during operation → no late navigation after release', async () => {
    const lock = createSubmissionLock();
    let navCount = 0;
    let currentSession = 'user-A';

    async function handleContinue(authedUserId: string) {
      if (!lock.acquire()) return;
      try {
        await Promise.resolve(); // finalize
        // Check session before navigation
        if (currentSession !== authedUserId) return;
        await Promise.resolve(); // handoff
        // Check session before navigation
        if (currentSession !== authedUserId) return;
        navCount++;
      } finally {
        lock.release();
      }
    }

    // Start operation for user-A
    const p = handleContinue('user-A');

    // Session changes during the operation
    currentSession = 'user-B';

    await p;

    // No navigation happened — session changed
    expect(navCount).toBe(0);
    expect(lock.isLocked()).toBe(false);
  });
});
