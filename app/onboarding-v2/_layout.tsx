import { Stack } from 'expo-router';
import { createContext, useContext, useRef } from 'react';
import { Animated } from 'react-native';

// ─── Shared progress animation value — survives route changes ─────────────
// By keeping the Animated.Value at the layout level, the progress bar never
// resets to 0 when navigating between screens. Each screen animates from the
// current value to its target, producing smooth forward/backward motion.
const OnboardingProgressContext = createContext<Animated.Value | null>(null);

export function useOnboardingProgress() {
  return useContext(OnboardingProgressContext);
}

// ─── Onboarding V2 stack — uses a subtle fade transition for smooth
// navigation between screens. The content animations within each screen
// handle their own entrance choreography, working with this base transition
// instead of competing against it. ───────────────────────────────────────
export default function OnboardingV2Layout() {
  const progressValue = useRef(new Animated.Value(0)).current;

  return (
    <OnboardingProgressContext.Provider value={progressValue}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          animationDuration: 200,
          contentStyle: { backgroundColor: '#F7F2E7' },
        }}
      />
    </OnboardingProgressContext.Provider>
  );
}
