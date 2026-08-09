/// <reference types="jest" />
import { completeSession } from '../progress';
import { createReviewItemsForAyatRange } from '../reviewItems';

// ─── Stateful Supabase mock ──────────────────────────────────────────────────
// The mock state lives inside the factory to satisfy jest.mock scoping rules.
// We expose control via (global as any).__mockState to set up failure scenarios.

interface ProgressRow {
  id: string;
  user_id: string;
  current_surah: number;
  current_ayah: number;
  ayah_per_day: number;
  streak: number;
  total_memorized: number;
  last_session_date: string | null;
  session_dates: string[];
  last_session_difficulty: number | null;
}

interface ReviewItemRow {
  id: string;
  user_id: string;
  surah_number: number;
  ayah: number;
  review_cycle: number;
  next_review: string;
  mastered: boolean;
  final_test_status: string | null;
  created_at: string;
}

const mockState = {
  progressRows: [] as ProgressRow[],
  reviewRows: [] as ReviewItemRow[],
  nextId: 1,
  todayOverride: null as string | null,
  nextUpdateFailsAfterApply: false,
};

function resetState() {
  mockState.progressRows = [];
  mockState.reviewRows = [];
  mockState.nextId = 1;
  mockState.todayOverride = null;
  mockState.nextUpdateFailsAfterApply = false;
}

function today(): string {
  if (mockState.todayOverride) return mockState.todayOverride;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

jest.mock('../client', () => {
  function applyFilters(rows: any[], filters: any[]): any[] {
    let result = rows;
    for (const f of filters) {
      if (f.op === 'gte') {
        result = result.filter((r: any) => r[f.column] >= f.value);
      } else if (f.op === 'lte') {
        result = result.filter((r: any) => r[f.column] <= f.value);
      } else if (f.op === 'lt') {
        result = result.filter((r: any) => r[f.column] < f.value);
      } else {
        result = result.filter((r: any) => r[f.column] === f.value);
      }
    }
    return result;
  }

  function executeProgress(q: any): { data: any; error: any } {
    const state = (global as any).__mockState;

    if (q._update) {
      let rows = applyFilters(state.progressRows, q._filters);
      if (q._order) {
        rows.sort((a: any, b: any) =>
          q._order.ascending
            ? (a[q._order.column] > b[q._order.column] ? 1 : -1)
            : (a[q._order.column] < b[q._order.column] ? 1 : -1)
        );
      }
      if (q._limit) rows = rows.slice(0, q._limit);

      if (rows.length === 0) {
        return { data: null, error: { message: 'No rows matched' } };
      }

      const target = rows[0];
      const shouldFailAfterApply = state.nextUpdateFailsAfterApply;
      state.nextUpdateFailsAfterApply = false;

      Object.assign(target, q._update);

      if (shouldFailAfterApply) {
        return { data: null, error: { message: 'Network request failed (timeout)' } };
      }

      if (q._select) {
        return { data: { ...target }, error: null };
      }
      return { data: null, error: null };
    }

    if (q._insert) {
      const rowsToInsert = Array.isArray(q._insert) ? q._insert : [q._insert];
      for (const r of rowsToInsert) {
        state.progressRows.push({ ...r, id: `row-${state.nextId++}` });
      }
      return { data: null, error: null };
    }

    let rows = applyFilters(state.progressRows, q._filters);
    if (q._order) {
      rows.sort((a: any, b: any) =>
        q._order.ascending
          ? (a[q._order.column] > b[q._order.column] ? 1 : -1)
          : (a[q._order.column] < b[q._order.column] ? 1 : -1)
      );
    }
    if (q._limit) rows = rows.slice(0, q._limit);

    if (q._select && q._maybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  function executeReviewItems(q: any): { data: any; error: any } {
    const state = (global as any).__mockState;

    if (q._insert) {
      const rowsToInsert = Array.isArray(q._insert) ? q._insert : [q._insert];
      for (const r of rowsToInsert) {
        state.reviewRows.push({
          ...r,
          id: `rev-${state.nextId++}`,
          created_at: new Date().toISOString(),
        });
      }
      return { data: null, error: null };
    }

    let rows = applyFilters(state.reviewRows, q._filters);
    if (q._order) {
      rows.sort((a: any, b: any) =>
        q._order.ascending
          ? (a[q._order.column] > b[q._order.column] ? 1 : -1)
          : (a[q._order.column] < b[q._order.column] ? 1 : -1)
      );
    }
    if (q._limit) rows = rows.slice(0, q._limit);

    if (q._maybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null };
  }

  function buildChain(table: string) {
    let query: any = {
      _table: table,
      _filters: [] as { column: string; value: any; op?: string }[],
      _order: null as { column: string; ascending: boolean } | null,
      _limit: null as number | null,
      _maybeSingle: false,
      _select: null as string | null,
      _update: null as any,
      _insert: null as any,
    };

    const chain: any = {
      from: (t: string) => { query._table = t; return chain; },
      select: (cols: string) => { query._select = cols; return chain; },
      eq: (col: string, val: any) => { query._filters.push({ column: col, value: val }); return chain; },
      gte: (col: string, val: any) => { query._filters.push({ column: col, value: val, op: 'gte' }); return chain; },
      lte: (col: string, val: any) => { query._filters.push({ column: col, value: val, op: 'lte' }); return chain; },
      lt: (col: string, val: any) => { query._filters.push({ column: col, value: val, op: 'lt' }); return chain; },
      order: (col: string, opts: { ascending: boolean }) => { query._order = { column: col, ascending: opts.ascending }; return chain; },
      limit: (n: number) => { query._limit = n; return chain; },
      maybeSingle: () => { query._maybeSingle = true; return chain; },
      update: (payload: any) => { query._update = payload; return chain; },
      insert: (rows: any) => { query._insert = rows; return chain; },
    };

    chain.then = function (resolve: (v: any) => void, reject: (e: any) => void) {
      setTimeout(() => {
        try {
          let result: { data: any; error: any };
          if (query._table === 'progress') {
            result = executeProgress(query);
          } else if (query._table === 'review_items') {
            result = executeReviewItems(query);
          } else {
            result = { data: null, error: null };
          }
          resolve(result);
        } catch (e) {
          reject(e);
        }
      }, 0);
    };

    return chain;
  }

  return {
    supabase: {
      from: (table: string) => buildChain(table),
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  (global as any).__mockState = mockState;
});

function seedProgress(overrides: Partial<ProgressRow> = {}): ProgressRow {
  const row: ProgressRow = {
    id: `row-${mockState.nextId++}`,
    user_id: 'user-1',
    current_surah: 1,
    current_ayah: 0,
    ayah_per_day: 3,
    streak: 0,
    total_memorized: 0,
    last_session_date: null,
    session_dates: [],
    last_session_difficulty: null,
    ...overrides,
  };
  mockState.progressRows.push(row);
  return row;
}

function getProgress(): ProgressRow | undefined {
  return mockState.progressRows.find((r) => r.user_id === 'user-1');
}

function getReviewItems(): ReviewItemRow[] {
  return mockState.reviewRows.filter((r) => r.user_id === 'user-1');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('completeSession idempotency', () => {
  beforeEach(() => {
    resetState();
  });

  // Scenario 1: normal first call succeeds.
  describe('Scenario 1 — normal first call succeeds', () => {
    it('Free user: first call applies once', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      const result = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result.error).toBeNull();

      const prog = getProgress()!;
      expect(prog.current_ayah).toBe(3);
      expect(prog.total_memorized).toBe(3);
      expect(prog.streak).toBe(1);
      expect(prog.last_session_date).toBe(today());
      expect(prog.session_dates).toEqual([today()]);
    });
  });

  // Scenario 2: server applies write, client gets error, then retry.
  describe('Scenario 2 — write applied, response lost, then retry', () => {
    it('Free user: retry returns success, no double mutation', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      mockState.nextUpdateFailsAfterApply = true;

      const result1 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result1.error).not.toBeNull();

      const progAfterFirst = getProgress()!;
      expect(progAfterFirst.current_ayah).toBe(3);
      expect(progAfterFirst.total_memorized).toBe(3);
      expect(progAfterFirst.last_session_date).toBe(today());

      const result2 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result2.error).toBeNull();

      const progAfterRetry = getProgress()!;
      expect(progAfterRetry.current_ayah).toBe(3);
      expect(progAfterRetry.total_memorized).toBe(3); // NOT 6
      expect(progAfterRetry.streak).toBe(1); // NOT 2
      expect(progAfterRetry.session_dates).toEqual([today()]); // NOT [today, today]
    });

    it('Zainly+ user: retry returns success, no double mutation', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      mockState.nextUpdateFailsAfterApply = true;

      const result1 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(result1.error).not.toBeNull();

      const progAfterFirst = getProgress()!;
      expect(progAfterFirst.current_ayah).toBe(3);
      expect(progAfterFirst.total_memorized).toBe(3);

      const result2 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(result2.error).toBeNull();

      const progAfterRetry = getProgress()!;
      expect(progAfterRetry.current_ayah).toBe(3);
      expect(progAfterRetry.total_memorized).toBe(3); // NOT 6
      expect(progAfterRetry.streak).toBe(1); // NOT 2
    });

    it('Session finishing surah: retry returns success, no double mutation', async () => {
      seedProgress({ current_surah: 1, current_ayah: 4, last_session_date: null, streak: 2, total_memorized: 4 });

      mockState.nextUpdateFailsAfterApply = true;

      const result1 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 7,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result1.error).not.toBeNull();

      const progAfterFirst = getProgress()!;
      expect(progAfterFirst.current_ayah).toBe(7);
      expect(progAfterFirst.total_memorized).toBe(7);

      const result2 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 7,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result2.error).toBeNull();

      const progAfterRetry = getProgress()!;
      expect(progAfterRetry.current_ayah).toBe(7);
      expect(progAfterRetry.total_memorized).toBe(7); // NOT 10
      expect(progAfterRetry.streak).toBe(1); // gap (last_session_date was null) → reset to 1
    });
  });

  // Scenario 3: progress succeeds, review creation fails, then retry.
  describe('Scenario 3 — progress saved, review creation fails, then retry', () => {
    it('Free user: progress idempotent on retry, reviews created once', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      const result1 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result1.error).toBeNull();
      expect(getProgress()!.total_memorized).toBe(3);

      const result2 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(result2.error).toBeNull();
      expect(getProgress()!.total_memorized).toBe(3); // NOT 6

      const reviewResult = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult.error).toBeNull();
      expect(getReviewItems().length).toBe(3);

      const reviewResult2 = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult2.error).toBeNull();
      expect(getReviewItems().length).toBe(3); // NOT 6
    });

    it('Zainly+ user: progress idempotent on retry, reviews created once', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      const result1 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(result1.error).toBeNull();

      const result2 = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(result2.error).toBeNull();
      expect(getProgress()!.total_memorized).toBe(3); // NOT 6
      expect(getProgress()!.streak).toBe(1); // NOT 2

      const reviewResult = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult.error).toBeNull();
      expect(getReviewItems().length).toBe(3);

      const reviewResult2 = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult2.error).toBeNull();
      expect(getReviewItems().length).toBe(3); // NOT 6
    });
  });

  // Scenario 4: Full retry flow simulating FinalTestScreen handleValidate.
  describe('Scenario 4 — full retry flow (progress + reviews)', () => {
    it('Free user: write applied + response lost, retry completes full flow', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      mockState.nextUpdateFailsAfterApply = true;

      const step1Result = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(step1Result.error).not.toBeNull();

      expect(getProgress()!.current_ayah).toBe(3);
      expect(getProgress()!.total_memorized).toBe(3);

      const retryResult = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: false,
      });

      expect(retryResult.error).toBeNull();
      expect(getProgress()!.total_memorized).toBe(3);
      expect(getProgress()!.streak).toBe(1);
      expect(getProgress()!.session_dates).toEqual([today()]);

      const reviewResult = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult.error).toBeNull();
      expect(getReviewItems().length).toBe(3);
    });

    it('Zainly+ user: write applied + response lost, retry completes full flow', async () => {
      seedProgress({ current_surah: 1, current_ayah: 0, last_session_date: null, streak: 0, total_memorized: 0 });

      mockState.nextUpdateFailsAfterApply = true;

      const step1Result = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(step1Result.error).not.toBeNull();
      expect(getProgress()!.total_memorized).toBe(3);

      const retryResult = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 3,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(retryResult.error).toBeNull();
      expect(getProgress()!.total_memorized).toBe(3); // NOT 6
      expect(getProgress()!.streak).toBe(1); // NOT 2

      const reviewResult = await createReviewItemsForAyatRange({
        userId: 'user-1',
        surahNumber: 1,
        fromAyah: 1,
        toAyah: 3,
        difficulty: 'easy',
      });

      expect(reviewResult.error).toBeNull();
      expect(getReviewItems().length).toBe(3);
    });
  });

  // Edge case: Zainly+ genuine second session same day should still work.
  describe('Edge case — Zainly+ genuine second session (not a retry)', () => {
    it('Different current_ayah target → not idempotent, applies normally', async () => {
      seedProgress({ current_surah: 1, current_ayah: 3, last_session_date: today(), streak: 1, total_memorized: 3, session_dates: [today()] });

      const result = await completeSession({
        userId: 'user-1',
        currentSurah: 1,
        newCurrentAyah: 6,
        ayahPerDay: 3,
        newAyatCount: 3,
        difficulty: 'easy',
        allowMultipleToday: true,
      });

      expect(result.error).toBeNull();
      const prog = getProgress()!;
      expect(prog.current_ayah).toBe(6);
      expect(prog.total_memorized).toBe(6); // 3 + 3
      expect(prog.streak).toBe(1); // unchanged (same day)
      expect(prog.session_dates).toEqual([today()]); // no duplicate
    });
  });
});
