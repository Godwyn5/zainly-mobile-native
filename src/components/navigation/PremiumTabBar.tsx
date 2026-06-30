import { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors } from '@/theme/colors';
import { hapticSelection } from '@/utils/haptics';

// ─── constants ────────────────────────────────────────────────────────────────

const H_MARGIN  = 20;
const TAB_COUNT = 4;
const BAR_H     = 64;
const BUBBLE_H  = 48;

function makeDims(sw: number) {
  const BAR_WIDTH    = sw - H_MARGIN * 2;
  const TAB_W        = BAR_WIDTH / TAB_COUNT;
  const BUBBLE_W     = TAB_W - 10;
  const BUBBLE_MIN_X = 5;
  const BUBBLE_MAX_X = (TAB_COUNT - 1) * TAB_W + 5;
  const bubbleTargetX = (idx: number) => idx * TAB_W + 5;
  return { BAR_WIDTH, TAB_W, BUBBLE_W, BUBBLE_MIN_X, BUBBLE_MAX_X, bubbleTargetX };
}

const TABS = [
  { name: 'index',       label: "Aujourd'hui" },
  { name: 'hifz',       label: 'Mon Hifz'    },
  { name: 'progression', label: 'Progression' },
  { name: 'profile',    label: 'Profil'      },
] as const;

// ─── Refined Line Icons ────────────────────────────────────────────────────────
// All drawn with View primitives. Stroke weight: 1.7–2px.

function IconCalendar({ color }: { color: string }) {
  // Clean calendar outline: rounded rect body + header bar + 2×2 dot grid
  return (
    <View style={ic.root}>
      {/* outer rect */}
      <View style={[ic.calBody, { borderColor: color }]}>
        {/* header fill bar */}
        <View style={[ic.calHeader, { backgroundColor: color }]} />
        {/* 4 day dots: 2 rows × 2 cols */}
        <View style={ic.calDots}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[ic.calDot, { backgroundColor: color }]} />
          ))}
        </View>
      </View>
      {/* two binding knobs at top */}
      <View style={[ic.knob, { backgroundColor: color, left: '28%' }]} />
      <View style={[ic.knob, { backgroundColor: color, right: '28%' }]} />
    </View>
  );
}

function IconBookOpen({ color }: { color: string }) {
  // Open book: left page + spine + right page + binding curve
  return (
    <View style={ic.root}>
      {/* left page */}
      <View style={[ic.bookPage, { borderColor: color, left: 1, borderRightWidth: 0,
        borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }]} />
      {/* right page */}
      <View style={[ic.bookPage, { borderColor: color, right: 1, borderLeftWidth: 0,
        borderTopRightRadius: 3, borderBottomRightRadius: 3 }]} />
      {/* spine */}
      <View style={[ic.bookSpine, { backgroundColor: color }]} />
      {/* 2 content lines on left */}
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLine, { backgroundColor: color, top: `${t * 100}%`, left: '8%', width: '35%' }]} />
      ))}
      {/* 2 content lines on right */}
      {[0.32, 0.54].map((t, i) => (
        <View key={i} style={[ic.bookLine, { backgroundColor: color, top: `${t * 100}%`, right: '8%', width: '35%' }]} />
      ))}
    </View>
  );
}

function IconPerson({ color }: { color: string }) {
  // Head + shoulders, clean proportions
  return (
    <View style={ic.root}>
      {/* head */}
      <View style={[ic.personHead, { borderColor: color }]} />
      {/* shoulder arc */}
      <View style={[ic.personShoulder, { borderColor: color }]} />
    </View>
  );
}

function IconChart({ color }: { color: string }) {
  // Three ascending bars (left short, mid medium, right tall)
  return (
    <View style={ic.root}>
      {/* baseline */}
      <View style={[ic.chartBase, { backgroundColor: color }]} />
      {/* bar 1 — short */}
      <View style={[ic.chartBar, { backgroundColor: color, height: 7,  left: '10%' }]} />
      {/* bar 2 — medium */}
      <View style={[ic.chartBar, { backgroundColor: color, height: 11, left: '42%' }]} />
      {/* bar 3 — tall */}
      <View style={[ic.chartBar, { backgroundColor: color, height: 15, right: '10%' }]} />
    </View>
  );
}

// shared icon styles (computed once)
const IC_SIZE = 20;
// label font must shrink for 4 tabs
const LABEL_SIZE = 8;
const ic = StyleSheet.create({
  root: {
    width: IC_SIZE, height: IC_SIZE,
    alignItems: 'center', justifyContent: 'center',
  },
  // chart
  chartBase: {
    position: 'absolute', bottom: 1, left: '8%', right: '8%',
    height: 1.7, borderRadius: 1,
  },
  chartBar: {
    position: 'absolute', bottom: 3,
    width: '18%', borderRadius: 2,
  },
  // calendar
  calBody: {
    position: 'absolute', top: 2, left: 0, right: 0, bottom: 0,
    borderWidth: 1.7, borderRadius: 4,
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
  // book
  bookPage: {
    position: 'absolute', top: 1, bottom: 1,
    width: IC_SIZE * 0.44,
    borderWidth: 1.7,
  },
  bookSpine: {
    position: 'absolute', top: 1, bottom: 1,
    width: 1.7, alignSelf: 'center',
  },
  bookLine: {
    position: 'absolute',
    height: 1.5, borderRadius: 1, opacity: 0.55,
  },
  // person
  personHead: {
    position: 'absolute', top: 0,
    width: IC_SIZE * 0.38, height: IC_SIZE * 0.38,
    borderRadius: IC_SIZE * 0.19,
    borderWidth: 1.7,
    alignSelf: 'center',
  },
  personShoulder: {
    position: 'absolute', bottom: 0,
    left: IC_SIZE * 0.06, right: IC_SIZE * 0.06,
    height: IC_SIZE * 0.35,
    borderWidth: 1.7,
    borderTopWidth: 0,
    borderBottomLeftRadius: IC_SIZE * 0.34,
    borderBottomRightRadius: IC_SIZE * 0.34,
  },
});

// ─── Tab item content (shared between base and lens layers) ───────────────────

function TabContent({
  idx, label, color, labelStyle,
}: {
  idx: number;
  label: string;
  color: string;
  labelStyle: object;
}) {
  return (
    <View style={t.itemInner}>
      {idx === 0 && <IconCalendar  color={color} />}
      {idx === 1 && <IconBookOpen  color={color} />}
      {idx === 2 && <IconChart     color={color} />}
      {idx === 3 && <IconPerson    color={color} />}
      <Text style={[t.label, labelStyle]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ─── PremiumTabBar ─────────────────────────────────────────────────────────────

export function PremiumTabBar({ state, navigation }: BottomTabBarProps) {
  const insets      = useSafeAreaInsets();
  const { width: sw } = useWindowDimensions();
  const { BAR_WIDTH, TAB_W, BUBBLE_W, BUBBLE_MIN_X, BUBBLE_MAX_X, bubbleTargetX } = makeDims(sw);
  const visibleRoutes = state.routes;
  const safeIdx     = Math.min(state.index, TABS.length - 1);

  // ── animation refs ────────────────────────────────────────────────────────

  // Single source of truth: bubble left-edge translateX
  const bubbleX     = useRef(new Animated.Value(bubbleTargetX(safeIdx))).current;
  const bubbleScale = useRef(new Animated.Value(1)).current;
  const glowPulse   = useRef(new Animated.Value(0.3)).current;
  const glowLoop    = useRef<Animated.CompositeAnimation | null>(null);
  const barEntrance = useRef(new Animated.Value(0)).current;

  // ── drag refs (never setState, no re-renders during drag) ─────────────────
  const bubbleXVal    = useRef(bubbleTargetX(safeIdx)); // JS mirror of bubbleX
  const isDragging    = useRef(false);
  const dragStartX    = useRef(0);
  const prevIdxRef    = useRef(safeIdx);

  // track bubbleX in a non-animated JS value for PanResponder math
  useEffect(() => {
    const id = bubbleX.addListener(({ value }) => { bubbleXVal.current = value; });
    return () => bubbleX.removeListener(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // B11: re-snap bubble to active slot when screen width changes (rotation / split-screen)
  useEffect(() => {
    if (isDragging.current) return;
    const target = bubbleTargetX(safeIdx);
    bubbleX.setValue(target);
    bubbleXVal.current = target;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TAB_W, safeIdx]);

  // ── magnetic spring snap ──────────────────────────────────────────────────

  const springTo = useCallback((targetX: number, restoreScale = true) => {
    Animated.spring(bubbleX, {
      toValue: targetX,
      tension: 170,
      friction: 22,
      useNativeDriver: true,
    }).start();
    if (restoreScale) {
      Animated.spring(bubbleScale, {
        toValue: 1,
        tension: 200,
        friction: 22,
        useNativeDriver: true,
      }).start();
    }
  }, [bubbleX, bubbleScale]);

  const timingTo = useCallback((targetX: number) => {
    Animated.parallel([
      Animated.timing(bubbleX, {
        toValue: targetX,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bubbleScale, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [bubbleX, bubbleScale]);

  // ── mount ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    Animated.timing(barEntrance, {
      toValue: 1, duration: 400,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();

    glowLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, {
          toValue: 0.6, duration: 2600,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
        Animated.timing(glowPulse, {
          toValue: 0.3, duration: 2600,
          easing: Easing.inOut(Easing.sin), useNativeDriver: true,
        }),
      ])
    );
    glowLoop.current.start();

    return () => { glowLoop.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── sync bubble to active route (tap / programmatic nav) ──────────────────

  useEffect(() => {
    if (isDragging.current) return;
    if (prevIdxRef.current === safeIdx) return;
    prevIdxRef.current = safeIdx;

    // programmatic nav: use timing so it's crisp, not wobbly
    timingTo(bubbleTargetX(safeIdx));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeIdx]);

  // ── PanResponder ──────────────────────────────────────────────────────────

  // All closures inside PanResponder only touch mutable refs — safe in useRef.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 6 && Math.abs(gs.dx) > Math.abs(gs.dy),

      onPanResponderGrant: () => {
        isDragging.current = true;
        // stop any in-flight spring so drag is immediately attached
        bubbleX.stopAnimation();
        bubbleScale.stopAnimation();
        dragStartX.current = bubbleXVal.current;
        Animated.spring(bubbleScale, {
          toValue: 1.02, tension: 260, friction: 18, useNativeDriver: true,
        }).start();
      },

      onPanResponderMove: (_, gs) => {
        const next = Math.max(BUBBLE_MIN_X, Math.min(BUBBLE_MAX_X, dragStartX.current + gs.dx));
        bubbleX.setValue(next);
      },

      onPanResponderRelease: (_, gs) => {
        isDragging.current = false;

        const cx = bubbleXVal.current;
        const bubbleCenter = cx + BUBBLE_W / 2;

        // nearest tab by position
        let targetIdx = Math.round((bubbleCenter - TAB_W / 2) / TAB_W);

        // velocity kick: lower threshold for natural swipe feel
        if (Math.abs(gs.vx) > 0.35) {
          const approxCurrent = Math.round((cx - BUBBLE_MIN_X) / TAB_W);
          targetIdx = approxCurrent + (gs.vx < 0 ? -1 : 1);
        }

        targetIdx = Math.max(0, Math.min(TAB_COUNT - 1, targetIdx));

        // fast magnetic spring to slot
        springTo(bubbleTargetX(targetIdx), true);

        if (targetIdx !== prevIdxRef.current) {
          hapticSelection();
          prevIdxRef.current = targetIdx;
          const route = visibleRoutes[targetIdx];
          if (route) navigation.navigate(route.name, undefined);
        }
      },

      onPanResponderTerminate: () => {
        isDragging.current = false;
        springTo(bubbleTargetX(prevIdxRef.current), true);
      },
    })
  ).current;

  // ── tap handler ───────────────────────────────────────────────────────────

  const handlePress = useCallback((routeName: string, tabIdx: number, isFocused: boolean) => {
    hapticSelection();
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

  // The lens counter-translation: bubble moves right by bubbleX,
  // so the active strip inside moves left by -bubbleX to stay fixed in world coords.
  // We offset by -BUBBLE_MIN_X so the strip aligns at idx=0.
  const lensStripX = bubbleX.interpolate({
    inputRange: [BUBBLE_MIN_X, BUBBLE_MAX_X],
    outputRange: [-BUBBLE_MIN_X, -BUBBLE_MAX_X],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        t.wrapper,
        {
          bottom: bottomInset + 8,
          opacity: barEntrance,
          transform: [{ translateY: barTranslateY }],
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={t.pill} {...panResponder.panHandlers}>

        {/* ── BASE LAYER: inactive tab items ─────────────────────────── */}
        {TABS.map((tab, i) => {
          const route = visibleRoutes[i];
          if (!route) return null;
          return (
            <Pressable
              key={tab.name}
              style={[t.tabItem, { width: TAB_W }]}
              onPress={() => handlePress(route.name, i, i === safeIdx)}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: i === safeIdx }}
            >
              <TabContent
                idx={i}
                label={tab.label}
                color={colors.tabInactive}
                labelStyle={t.labelInactive}
              />
            </Pressable>
          );
        })}

        {/* ── BUBBLE LAYER: glass capsule with lens reveal ────────────── */}
        <Animated.View
          pointerEvents="none"
          style={[
            t.bubble,
            {
              width: BUBBLE_W,
              transform: [
                { translateX: bubbleX },
                { scale: bubbleScale },
              ],
            },
          ]}
        >
          {/* glass background layers */}
          <View style={t.bubbleGlass} />
          <Animated.View style={[t.bubbleGlow, { opacity: glowPulse }]} />
          <View style={t.bubbleShine} />

          {/* ── LENS ACTIVE STRIP (counter-translated) ── */}
          {/*
            Width = full BAR_WIDTH so all tabs are rendered;
            translateX offsets strip so the right tab is visible through bubble.
            At idx=0: strip at -5 (BUBBLE_MIN_X = 5, so left=0 of strip aligns with bubble left=5)
            The strip is positioned so tab[i] center = (i * TAB_W + TAB_W/2),
            bubble left edge = bubbleTargetX(i) = i*TAB_W+5,
            so we need to shift strip by -bubbleX to keep world coords stable.
          */}
          <Animated.View
            style={[
              t.lensStrip,
              { width: BAR_WIDTH, transform: [{ translateX: lensStripX }] },
            ]}
          >
            {TABS.map((tab, i) => (
              <View key={tab.name} style={[t.tabItem, { width: TAB_W }]}>
                <TabContent
                  idx={i}
                  label={tab.label}
                  color={colors.primary}
                  labelStyle={t.labelActive}
                />
              </View>
            ))}
            {/* gold accent dot centered under current active label */}
            <View style={[t.lensActiveDot, { left: BUBBLE_W / 2 - 2 }]} />
          </Animated.View>
        </Animated.View>

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

  pill: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(184,150,46,0.18)',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 7 },
    elevation: 14,
  },

  // ── tab slot (used by both base and lens strip) ── width applied inline
  tabItem: {
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── content inside each tab slot ──
  itemInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontSize: LABEL_SIZE,
    letterSpacing: 0.1,
  },
  labelInactive: {
    fontWeight: '500',
    color: colors.tabInactive,
    opacity: 0.75,
  },
  labelActive: {
    fontWeight: '700',
    color: colors.primary,
  },

  // ── glass bubble ──
  bubble: {
    position: 'absolute',
    top: (BAR_H - BUBBLE_H) / 2,
    left: 0,
    height: BUBBLE_H,
    borderRadius: 999,
    overflow: 'hidden',
  },
  bubbleGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1.5,
    borderColor: 'rgba(184,150,46,0.26)',
    ...Platform.select({ android: { elevation: 3 } }),
  },
  bubbleGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    backgroundColor: 'rgba(22,48,38,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(184,150,46,0.22)',
  },
  bubbleShine: {
    position: 'absolute',
    top: 5, left: '20%',
    width: '60%', height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.50)',
  },

  // ── active lens strip (full bar width, rendered inside bubble) ──
  lensStrip: {
    position: 'absolute',
    top: -(BAR_H - BUBBLE_H) / 2,  // cancel bubble's vertical centering offset
    left: 0,
    height: BAR_H,
    flexDirection: 'row',
  },

  // gold dot — centered at bubble mid, pinned at bottom of strip
  lensActiveDot: {
    position: 'absolute',
    bottom: (BAR_H - BUBBLE_H) / 2 + 3,
    width: 4, height: 4,
    borderRadius: 2,
    backgroundColor: colors.gold,
    opacity: 0.85,
  },
});
