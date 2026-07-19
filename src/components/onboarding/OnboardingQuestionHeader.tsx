import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, AccessibilityInfo,
} from 'react-native';
import { useOnboardingProgress } from '../../../app/onboarding-v2/_layout';

// ─── palette — identical tokens to the rest of Onboarding V2 (kept local,
// not imported from src/theme, to stay visually consistent with the
// existing narrative screens rather than the app's general theme) ─────────
const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.10)';
const GOLD_DARK           = '#9F7628';

interface OnboardingQuestionHeaderProps {
  /** 1-indexed current decision step (reassurance screens reuse the same
   *  number as the question that generated them — never a distinct step). */
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  /** Defaults to "Retour à l'écran précédent" — override only if a screen
   *  needs a more specific VoiceOver label. */
  backAccessibilityLabel?: string;
}

/**
 * Shared header for every questionnaire/reassurance screen of Onboarding V2:
 * a discreet back button + a horizontal progress rail. Deliberately the
 * single place that renders either, so their look and accessibility
 * behaviour never drift between screens.
 */
export default function OnboardingQuestionHeader({
  currentStep, totalSteps, onBack, backAccessibilityLabel,
}: OnboardingQuestionHeaderProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef     = useRef(true);
  const backLockedRef  = useRef(false);
  const localProgress  = useRef(new Animated.Value(0)).current;
  const sharedProgress = useOnboardingProgress();
  const fillRatio       = sharedProgress ?? localProgress;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  const ratio = totalSteps > 0
    ? Math.min(Math.max(currentStep, 0), totalSteps) / totalSteps
    : 0;

  useEffect(() => {
    if (reduceMotion) {
      fillRatio.setValue(ratio);
      return;
    }
    Animated.timing(fillRatio, {
      toValue: ratio, duration: 320,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, reduceMotion]);

  // ── blocks rapid double-taps on Back — a synchronous ref, not state,
  // so a second tap fired before the first re-render is still caught. ────
  function handleBack() {
    if (backLockedRef.current) return;
    backLockedRef.current = true;
    onBack();
    setTimeout(() => { backLockedRef.current = false; }, 600);
  }

  const fillWidthPct = fillRatio.interpolate({
    inputRange: [0, 1], outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.root}>
      <TouchableOpacity
        onPress={handleBack}
        activeOpacity={0.6}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel={backAccessibilityLabel ?? "Retour à l'écran précédent"}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.backChevron}>‹</Text>
      </TouchableOpacity>

      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Étape ${currentStep} sur ${totalSteps}`}
        accessibilityValue={{ min: 0, max: totalSteps, now: currentStep }}
      >
        <Animated.View style={[styles.fill, { width: fillWidthPct }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: 4,
    paddingBottom: 6,
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: -10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backChevron: {
    fontSize: 26,
    fontWeight: '600',
    color: SPLASH_GREEN,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: SPLASH_GREEN_FAINT,
    overflow: 'hidden',
    marginTop: 6,
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: GOLD_DARK,
  },
});
