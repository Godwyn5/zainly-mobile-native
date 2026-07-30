import { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// NOTE — Uses expo-glass-effect for authentic Liquid Glass material (UIGlassEffect).
// On iOS 26+ this renders the real Liquid Glass with refraction and specular highlights.
// On iOS <26 and Android, it gracefully degrades to a standard blur effect.
// Requires a dev client rebuild that includes expo-glass-effect.

// ─── constants ────────────────────────────────────────────────────────────────

const H_MARGIN  = 16;  // Horizontal margin for floating bar
const TAB_COUNT = 3;
const BAR_H     = 52;  // Target height for premium floating bar
const BUBBLE_H  = 40;  // Capsule height (slightly smaller than references)
const BOTTOM_GAP = 8;  // Breathing space above safe area

// Zainly palette — neutral glass material with Zainly green for active state.
const ZAINLY_GREEN = '#163026';
const TAB_INACTIVE_COLOR = 'rgba(255,255,255,0.65)';
const TAB_ACTIVE_COLOR   = ZAINLY_GREEN;

function makeDims(sw: number) {
  const barWidth = sw - H_MARGIN * 2;
  const TAB_W    = barWidth / TAB_COUNT;
  const BUBBLE_W = TAB_W - 14;  // More breathing room for capsule
  const bubbleTargetX = (idx: number) => idx * TAB_W + 7;
  return { TAB_W, BUBBLE_W, bubbleTargetX };
}

const TABS = [
  { name: 'index',  label: "Aujourd'hui" },
  { name: 'hifz',   label: 'Mon Hifz'    },
  { name: 'profile', label: 'Profil'      },
] as const;

// ─── Outline Icons ────────────────────────────────────────────────────────────
// All drawn with View primitives. Stroke weight: 1.5px for SF Symbols fidelity.

function IconCalendarOutline({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.calBody, { borderColor: color }]}>
        <View style={[ic.calHeader, { backgroundColor: color }]} />
        <View style={ic.calDots}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[ic.calDot, { backgroundColor: color }]} />
          ))}
        </View>
      </View>
      <View style={[ic.knob, { backgroundColor: color, left: '28%' }]} />
      <View style={[ic.knob, { backgroundColor: color, right: '28%' }]} />
    </View>
  );
}

function IconBookOpenOutline({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.bookPage, { borderColor: color, left: 1, borderRightWidth: 0,
        borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }]} />
      <View style={[ic.bookPage, { borderColor: color, right: 1, borderLeftWidth: 0,
        borderTopRightRadius: 3, borderBottomRightRadius: 3 }]} />
      <View style={[ic.bookSpine, { backgroundColor: color }]} />
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLine, { backgroundColor: color, top: `${t * 100}%`, left: '8%', width: '35%' }]} />
      ))}
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLine, { backgroundColor: color, top: `${t * 100}%`, right: '8%', width: '35%' }]} />
      ))}
    </View>
  );
}

function IconPersonOutline({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.personHead, { borderColor: color }]} />
      <View style={[ic.personShoulder, { borderColor: color }]} />
    </View>
  );
}

// ─── Filled Icons ─────────────────────────────────────────────────────────────
// Same geometry as outline but filled for active state.

function IconCalendarFilled({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.calBodyFilled, { backgroundColor: color }]}>
        <View style={ic.calHeaderFilled} />
        <View style={ic.calDots}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={ic.calDotFilled} />
          ))}
        </View>
      </View>
      <View style={[ic.knobFilled, { left: '28%' }]} />
      <View style={[ic.knobFilled, { right: '28%' }]} />
    </View>
  );
}

function IconBookOpenFilled({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.bookPageFilled, { backgroundColor: color, left: 1,
        borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }]} />
      <View style={[ic.bookPageFilled, { backgroundColor: color, right: 1,
        borderTopRightRadius: 3, borderBottomRightRadius: 3 }]} />
      <View style={[ic.bookSpineFilled, { backgroundColor: color }]} />
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLineFilled, { top: `${t * 100}%`, left: '8%', width: '35%' }]} />
      ))}
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLineFilled, { top: `${t * 100}%`, right: '8%', width: '35%' }]} />
      ))}
    </View>
  );
}

function IconPersonFilled({ color }: { color: string }) {
  return (
    <View style={ic.root}>
      <View style={[ic.personHeadFilled, { backgroundColor: color }]} />
      <View style={[ic.personShoulderFilled, { backgroundColor: color }]} />
    </View>
  );
}

// shared icon styles (computed once)
const IC_SIZE = 22;  // Increased for SF Symbols fidelity
const LABEL_SIZE = 10;  // Increased for premium feel
const ic = StyleSheet.create({
  root: {
    width: IC_SIZE, height: IC_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  // calendar outline
  calBody: {
    position: 'absolute', top: 2, left: 0, right: 0, bottom: 0,
    borderWidth: 1.5, borderRadius: 4,
    overflow: 'hidden',
  },
  calHeader: {
    height: 5, width: '100%', opacity: 0.25,
  },
  calDots: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 3, paddingTop: 3,
    gap: 3,
  },
  calDot: {
    width: 3, height: 3, borderRadius: 1.5, opacity: 0.8,
  },
  knob: {
    position: 'absolute', top: 0,
    width: 2, height: 5,
    borderRadius: 1,
  },
  // calendar filled
  calBodyFilled: {
    position: 'absolute', top: 2, left: 0, right: 0, bottom: 0,
    borderRadius: 4,
    overflow: 'hidden',
  },
  calHeaderFilled: {
    height: 5, width: '100%', backgroundColor: 'rgba(255,255,255,0.25)',
  },
  calDotFilled: {
    width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.8)',
  },
  knobFilled: {
    position: 'absolute', top: 0,
    width: 2, height: 5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  // book outline
  bookPage: {
    position: 'absolute', top: 1, bottom: 1,
    width: IC_SIZE * 0.44,
    borderWidth: 1.5,
  },
  bookSpine: {
    position: 'absolute', top: 1, bottom: 1,
    width: 1.5, alignSelf: 'center',
  },
  bookLine: {
    position: 'absolute',
    height: 1.5, borderRadius: 1, opacity: 0.55,
  },
  // book filled
  bookPageFilled: {
    position: 'absolute', top: 1, bottom: 1,
    width: IC_SIZE * 0.44,
  },
  bookSpineFilled: {
    position: 'absolute', top: 1, bottom: 1,
    width: 1.5, alignSelf: 'center',
  },
  bookLineFilled: {
    position: 'absolute',
    height: 1.5, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.55)',
  },
  // person outline
  personHead: {
    position: 'absolute', top: 0,
    width: IC_SIZE * 0.38, height: IC_SIZE * 0.38,
    borderRadius: IC_SIZE * 0.19,
    borderWidth: 1.5,
    alignSelf: 'center',
  },
  personShoulder: {
    position: 'absolute', bottom: 0,
    left: IC_SIZE * 0.06, right: IC_SIZE * 0.06,
    height: IC_SIZE * 0.35,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderBottomLeftRadius: IC_SIZE * 0.34,
    borderBottomRightRadius: IC_SIZE * 0.34,
  },
  // person filled
  personHeadFilled: {
    position: 'absolute', top: 0,
    width: IC_SIZE * 0.38, height: IC_SIZE * 0.38,
    borderRadius: IC_SIZE * 0.19,
    alignSelf: 'center',
  },
  personShoulderFilled: {
    position: 'absolute', bottom: 0,
    left: IC_SIZE * 0.06, right: IC_SIZE * 0.06,
    height: IC_SIZE * 0.35,
    borderTopWidth: 0,
    borderBottomLeftRadius: IC_SIZE * 0.34,
    borderBottomRightRadius: IC_SIZE * 0.34,
  },
});

// ─── Tab item content (icon + label) ───────────────────────────────────────────

function TabContent({
  idx, label, isActive,
}: {
  idx: number;
  label: string;
  isActive: boolean;
}) {
  const activeColor = TAB_ACTIVE_COLOR;
  const inactiveColor = TAB_INACTIVE_COLOR;
  
  return (
    <View style={t.itemInner}>
      {idx === 0 && (
        isActive ? <IconCalendarFilled color={activeColor} /> : <IconCalendarOutline color={inactiveColor} />
      )}
      {idx === 1 && (
        isActive ? <IconBookOpenFilled color={activeColor} /> : <IconBookOpenOutline color={inactiveColor} />
      )}
      {idx === 2 && (
        isActive ? <IconPersonFilled color={activeColor} /> : <IconPersonOutline color={inactiveColor} />
      )}
      <Text 
        style={[t.label, isActive ? t.labelActive : t.labelInactive]} 
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── PremiumTabBar ─────────────────────────────────────────────────────────────

export function PremiumTabBar({ state, navigation }: BottomTabBarProps) {
  const insets      = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const { TAB_W, BUBBLE_W, bubbleTargetX } = makeDims(sw);
  const visibleRoutes = state.routes;
  const safeIdx     = Math.min(state.index, TABS.length - 1);

  // ── animation refs ────────────────────────────────────────────────────────

  // Single source of truth: bubble left-edge translateX
  const bubbleX     = useRef(new Animated.Value(bubbleTargetX(safeIdx))).current;
  const barEntrance = useRef(new Animated.Value(0)).current;
  const prevIdxRef  = useRef(safeIdx);

  // B11: re-snap bubble to active slot when screen width changes (rotation / split-screen)
  useEffect(() => {
    bubbleX.setValue(bubbleTargetX(safeIdx));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TAB_W, safeIdx]);

  // ── tab-to-tab bubble transition ──────────────────────────────────────────
  // Premium smooth transition — 280ms for refined feel, cubic easing for
  // natural fluid motion without bounce or gadget-like behavior.
  const timingTo = useCallback((targetX: number) => {
    Animated.timing(bubbleX, {
      toValue: targetX,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bubbleX]);

  // ── mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    Animated.timing(barEntrance, {
      toValue: 1, duration: 400,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── sync bubble to active route (tap / programmatic nav) ──────────────────

  useEffect(() => {
    if (prevIdxRef.current === safeIdx) return;
    prevIdxRef.current = safeIdx;
    timingTo(bubbleTargetX(safeIdx));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx]);

  // ── tap handler ───────────────────────────────────────────────────────────

  const handlePress = useCallback((routeName: string, tabIdx: number, isFocused: boolean) => {
    // No haptic/vibration feedback on tab bar taps — navigation + animation only.
    // taps use fast timing — feels crisper than spring for point-to-point jumps
    timingTo(bubbleTargetX(tabIdx));
    if (!isFocused) {
      navigation.navigate(routeName, undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  // ── render ────────────────────────────────────────────────────────────────

  const bottomInset = Math.max(insets.bottom, 8);

  const barTranslateY = barEntrance.interpolate({
    inputRange: [0, 1], outputRange: [80, 0],
  });

  return (
    <Animated.View
      style={[
        t.wrapper,
        {
          bottom: bottomInset + BOTTOM_GAP,
          opacity: barEntrance,
          transform: [{ translateY: barTranslateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={t.barShadow}>
        <View style={t.bar}>

          {/* Liquid Glass material — authentic UIGlassEffect via expo-glass-effect */}
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            isInteractive={false}
          />

          {/* sliding active capsule — neutral glass, same material as bar */}
          <Animated.View
            pointerEvents="none"
            style={[
              t.bubble,
              { width: BUBBLE_W, transform: [{ translateX: bubbleX }] },
            ]}
          >
            <GlassView
              style={StyleSheet.absoluteFill}
              glassEffectStyle="regular"
              isInteractive={false}
            />
          </Animated.View>

          {/* three items with outline/filled icons */}
          {TABS.map((tab, i) => {
            const route = visibleRoutes[i];
            if (!route) return null;
            const isActive = i === safeIdx;
            return (
              <Pressable
                key={tab.name}
                style={[t.tabItem, { width: TAB_W }]}
                onPress={() => handlePress(route.name, i, isActive)}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: isActive }}
              >
                <TabContent
                  idx={i}
                  label={tab.label}
                  isActive={isActive}
                />
              </Pressable>
            );
          })}

        </View>
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const t = StyleSheet.create({

  wrapper: {
    position: 'absolute',
    left: H_MARGIN,
    right: H_MARGIN,
    height: BAR_H,
    zIndex: 100,
  },

  // Very subtle shadow to suggest floating without being dramatic
  barShadow: {
    flex: 1,
    borderRadius: 26,  // Half of BAR_H for pill shape
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },

  // Main floating bar — neutral Liquid Glass material
  bar: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 26,
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },

  // ── tab slot ── width applied inline (depends on measured screen width)
  tabItem: {
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── content inside each tab slot ──
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,  // Pixel-perfect spacing between icon and label
  },
  label: {
    fontSize: LABEL_SIZE,
    letterSpacing: 0.1,
  },
  labelInactive: {
    fontWeight: '500',
    color: TAB_INACTIVE_COLOR,
  },
  labelActive: {
    fontWeight: '600',
    color: TAB_ACTIVE_COLOR,
  },

  // ── active capsule ── neutral glass, same material as bar, no border
  bubble: {
    position: 'absolute',
    top: (BAR_H - BUBBLE_H) / 2,
    left: 0,
    height: BUBBLE_H,
    borderRadius: BUBBLE_H / 2,
    overflow: 'hidden',
  },
});
