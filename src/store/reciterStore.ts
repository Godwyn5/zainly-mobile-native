// ─── reciterStore.ts ──────────────────────────────────────────────────────────
// Persists the user's chosen reciter across app restarts via AsyncStorage.
// Default is always Al-Husary (free). Premium reciters require Zainly+.
//
// Usage:
//   const { reciterId, setReciter } = useReciterStore();
//   const url = getAyatAudioUrl({ surahNumber, ayahNumber, reciter: reciterId });

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_RECITER, type ReciterId } from '@/core/reciters';

type ReciterState = {
  reciterId:  ReciterId;
  setReciter: (id: ReciterId) => void;
};

export const useReciterStore = create<ReciterState>()(
  persist(
    (set) => ({
      reciterId:  DEFAULT_RECITER,
      setReciter: (id) => set({ reciterId: id }),
    }),
    {
      name:    '@zainly/reciter_id',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
