import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  user: User | null;
  ready: boolean; // true once initial session check is done
  setSession: (session: Session | null) => void;
  setReady: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  ready: false,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  setReady: () => set({ ready: true }),
}));
