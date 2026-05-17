// ─── sessionResultStore.ts ────────────────────────────────────────────────────
// Lightweight Zustand store to pass session completion data to the done screen.
// Set result at session completion, read in done screen, clear on return.

import { create } from 'zustand';
import type { SessionDifficulty } from '@/db/progress';

export type SessionResult = {
  surahName: string;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
  newAyatCount: number;
  reviewsCompleted: number;
  difficulty: SessionDifficulty;
  streak: number;
  nextReviewLabel?: string;
  completedAt: string;
};

interface SessionResultState {
  result: SessionResult | null;
  setResult: (result: SessionResult) => void;
  clearResult: () => void;
}

export const useSessionResultStore = create<SessionResultState>((set) => ({
  result: null,
  setResult: (result) => set({ result }),
  clearResult: () => set({ result: null }),
}));
