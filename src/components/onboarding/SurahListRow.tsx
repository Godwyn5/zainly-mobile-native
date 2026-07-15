import { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { SurahEntry } from '@/core/planEngine';

// ─── Onboarding V2 surah row — shared by known-surahs / start-surah /
// custom-order. Visual language matches OnboardingChoiceCard (same palette,
// same restraint), but stays compact since these lists render 114 rows.
// Faithful functional port of SurahRow (app/onboarding/index.tsx), adapted
// to the premium onboarding-v2 look — no business logic invented here.

const SPLASH_GREEN       = '#163026';
const SPLASH_GREEN_FAINT = 'rgba(22,48,38,0.06)';
const SPLASH_GOLD        = '#B8975B';
const MUTED              = '#7C7365';
const BORDER             = 'rgba(22,48,38,0.10)';

interface SurahListRowProps {
  entry: SurahEntry;
  selected: boolean;
  orderIndex?: number;
  onPress: (surah: number) => void;
  disabled?: boolean;
  disabledLabel?: string;
}

const SurahListRow = memo(function SurahListRow({
  entry, selected, orderIndex, onPress, disabled, disabledLabel,
}: SurahListRowProps) {
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(pressScale, {
      toValue: selected ? 0.985 : 1, friction: 7, tension: 90, useNativeDriver: true,
    }).start();
  }, [selected, pressScale]);

  return (
    <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      <TouchableOpacity
        activeOpacity={disabled ? 1 : 0.8}
        onPress={() => { if (disabled) return; onPress(entry.surah); }}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: !!disabled }}
        accessibilityLabel={`${entry.name}, sourate ${entry.surah}, ${entry.ayahs} ayats${disabledLabel ? `, ${disabledLabel}` : ''}`}
        style={[styles.row, selected && styles.rowSelected, disabled && styles.rowDisabled]}
      >
        {orderIndex != null ? (
          <View style={styles.orderBadge}>
            <Text style={styles.orderBadgeText}>{orderIndex}</Text>
          </View>
        ) : (
          <View style={[styles.check, selected && styles.checkSelected]}>
            {selected && <Text style={styles.checkMark}>✓</Text>}
          </View>
        )}
        <View style={styles.textWrap}>
          <Text style={[styles.name, selected && styles.nameSelected, disabled && styles.nameDisabled]}>
            {entry.name}
          </Text>
          <Text style={styles.meta}>
            {disabledLabel ?? `Sourate ${entry.surah} · ${entry.ayahs} ayats`}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default SurahListRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: SPLASH_GOLD,
    backgroundColor: SPLASH_GREEN_FAINT,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: SPLASH_GOLD,
    backgroundColor: SPLASH_GOLD,
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  orderBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: SPLASH_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  textWrap: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: SPLASH_GREEN,
  },
  nameSelected: {
    color: SPLASH_GREEN,
  },
  nameDisabled: {
    color: MUTED,
  },
  meta: {
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
  },
});
