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
