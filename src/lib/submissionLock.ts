// ─── createSubmissionLock ──────────────────────────────────────────────────
// A synchronous ref-based lock that prevents double-submission in React
// components. The lock is acquired synchronously (before any await), so two
// synchronous calls cannot both pass the guard — the first sets the ref to
// true before the second reads it.
//
// The lock is released:
//   - on error (so the user can retry)
//   - on success (after navigation, so a back-navigation doesn't re-trigger)
// It is NOT released between finalize, handoff, pending-clear, and navigation
// — the entire async chain holds the lock until it completes or throws.

export interface SubmissionLock {
  /** Returns true if the lock was acquired, false if already held. */
  acquire: () => boolean;
  /** Releases the lock. Safe to call multiple times. */
  release: () => void;
  /** True while the lock is held. */
  isLocked: () => boolean;
}

export function createSubmissionLock(): SubmissionLock {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    isLocked() {
      return locked;
    },
  };
}
