import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, AccessibilityInfo } from 'react-native';

// ─── palette — identical tokens to the rest of Onboarding V2 ──────────────
const SPLASH_GREEN = '#163026';
const GOLD_DARK     = '#9F7628';
const CARD_CREAM   = '#FFFDF7';

const CARD_BORDER          = 'rgba(22,48,38,0.10)';
const CARD_BORDER_EMPHASIZED = 'rgba(159,118,40,0.35)';
const CARD_BG_SELECTED     = 'rgba(159,118,40,0.08)';
const DOT_BORDER           = 'rgba(22,48,38,0.18)';

interface OnboardingChoiceCardProps {
  title: string;
  /** Optional supporting line under the title (used by learning-mode and
   *  experience-choice; motivation's cards are title-only). */
  description?: string;
  /** e.g. "Recommandé" — rendered only when provided, never implied by
   *  selection state. */
  badge?: string;
  /** Permanent visual priority (bigger border/soft shadow), independent of
   *  selection — used for the one card of a set that IS the recommended
   *  option (learning-mode's first card, experience-choice's first card). */
  emphasized?: boolean;
  selected: boolean;
  onPress: () => void;
  /** Defaults to the title, optionally suffixed with selection state. */
  accessibilityLabel?: string;
}

/**
 * Shared premium answer card for every questionnaire screen of
 * Onboarding V2 (motivation / learning-mode / experience-choice). A single
 * place for the "normal vs selected vs emphasized" visual language, so it
 * never drifts between screens.
 */
export default function OnboardingChoiceCard({
  title, description, badge, emphasized, selected, onPress, accessibilityLabel,
}: OnboardingChoiceCardProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: selected ? 0.985 : 1,
      friction: 8, tension: 90, useNativeDriver: true,
    }).start();
  }, [selected, reduceMotion, scale]);

  return (
    <Animated.View style={{ transform: reduceMotion ? [] : [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[
          styles.card,
          emphasized && styles.cardEmphasized,
          selected && styles.cardSelected,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel ?? `${title}${selected ? ', sélectionné' : ''}`}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <View style={styles.headerRow}>
          <View style={styles.textCol}>
            {badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            )}
            <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
            {description && <Text style={styles.description}>{description}</Text>}
          </View>

          <View style={[styles.dot, selected && styles.dotSelected]}>
            {selected && <View style={styles.dotInner} />}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_CREAM,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  cardEmphasized: {
    borderWidth: 1.4,
    borderColor: CARD_BORDER_EMPHASIZED,
    shadowColor: GOLD_DARK,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardSelected: {
    backgroundColor: CARD_BG_SELECTED,
    borderColor: GOLD_DARK,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  textCol: { flex: 1 },

  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(159,118,40,0.12)',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: GOLD_DARK,
    letterSpacing: 0.3,
  },

  title: {
    fontSize: 15.5,
    fontWeight: '600',
    color: SPLASH_GREEN,
  },
  titleSelected: {
    color: GOLD_DARK,
  },
  description: {
    fontSize: 13,
    color: SPLASH_GREEN,
    opacity: 0.6,
    marginTop: 4,
    lineHeight: 18,
  },

  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: DOT_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  dotSelected: {
    borderColor: GOLD_DARK,
  },
  dotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GOLD_DARK,
  },
});
