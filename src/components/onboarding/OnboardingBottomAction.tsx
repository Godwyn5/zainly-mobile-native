import { useEffect, useRef } from 'react';
import { TouchableOpacity, Animated, StyleSheet } from 'react-native';

// ─── palette — identical tokens to the rest of Onboarding V2 ──────────────
const SPLASH_BEIGE      = '#F7F2E7';
const GOLD_DARK          = '#9F7628';
const CTA_INACTIVE_BG   = 'rgba(22,48,38,0.10)';
const CTA_INACTIVE_TEXT = 'rgba(22,48,38,0.42)';

interface OnboardingBottomActionProps {
  label: string;
  /** True while no valid selection exists yet — question screens only.
   *  Reassurance screens never pass this (always enabled). */
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}

/**
 * Shared bottom CTA for every questionnaire/reassurance screen of
 * Onboarding V2: same gold/inactive colour language, same disabled-state
 * handling, and a synchronous ref guard against rapid double taps — so no
 * screen needs to reimplement any of this on its own.
 */
export default function OnboardingBottomAction({
  label, disabled = false, onPress, accessibilityLabel,
}: OnboardingBottomActionProps) {
  const pressedRef = useRef(false);
  const ctaActive  = useRef(new Animated.Value(disabled ? 0 : 1)).current;

  // Colour transition on disabled ↔ enabled.
  useEffect(() => {
    Animated.timing(ctaActive, {
      toValue: disabled ? 0 : 1, duration: 200,
      useNativeDriver: false,
    }).start();
  }, [disabled, ctaActive]);

  function handlePress() {
    if (disabled || pressedRef.current) return;
    pressedRef.current = true;
    onPress();
    setTimeout(() => { pressedRef.current = false; }, 600);
  }

  const bg = ctaActive.interpolate({ inputRange: [0, 1], outputRange: [CTA_INACTIVE_BG, GOLD_DARK] });
  const textColor = ctaActive.interpolate({ inputRange: [0, 1], outputRange: [CTA_INACTIVE_TEXT, SPLASH_BEIGE] });

  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? (disabled ? `${label}, désactivé` : label)}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Animated.View style={[styles.cta, { backgroundColor: bg }]}>
        <Animated.Text style={[styles.ctaText, { color: textColor }]}>{label}</Animated.Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cta: {
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
