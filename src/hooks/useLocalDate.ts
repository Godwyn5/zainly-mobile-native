import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

// ─── Pure temporal logic (exported for testing) ──────────────────────────────

/**
 * Returns the local civil date as a stable `YYYY-MM-DD` string.
 * Uses getFullYear/getMonth/getDate (local timezone) — never passes through UTC.
 */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Calculates the number of milliseconds until the next local midnight
 * (i.e. the start of the day after `from`).
 *
 * Pure function — no side effects, no timers. Deterministic for a given input.
 */
export function msUntilNextMidnight(from: Date = new Date()): number {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - from.getTime();
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Maintains the current local civil date (`YYYY-MM-DD`) as React state.
 *
 * Refreshes automatically when:
 * - The app returns to the foreground (AppState 'active').
 * - Midnight passes while the app is in the foreground (setTimeout).
 *
 * The timer is rescheduled after each refresh. No state update occurs
 * if the date string hasn't changed (e.g. same-day foreground return).
 *
 * Cleanup: both the timer and the AppState subscription are removed on unmount.
 */
export function useLocalDate(): string {
  const [today, setToday] = useState<string>(() => localDateStr());

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const next = localDateStr();
      setToday((prev) => (prev === next ? prev : next));
      scheduleNextMidnight();
    };

    const scheduleNextMidnight = () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      const ms = msUntilNextMidnight();
      // Guard against negative or absurdly large values.
      if (ms > 0 && ms < 24 * 60 * 60 * 1000) {
        timerId = setTimeout(refresh, ms);
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        refresh();
      }
    };

    // Schedule the initial midnight timer.
    scheduleNextMidnight();

    // Listen for app foreground transitions.
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      subscription.remove();
    };
  }, []);

  return today;
}
