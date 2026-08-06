import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function SessionProgressBar({ pct, label, phase: phaseLabel }: { pct: number; label: string; phase: string }) {
  const mountedRef = useRef(true);
  const fillAnim   = useRef(new Animated.Value(0)).current;
  const dotGlow    = useRef(new Animated.Value(0.5)).current;
  const dotLoop    = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const fill = Animated.timing(fillAnim, {
      toValue: pct, duration: 1000, delay: 300,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    fill.start(() => {
      if (!mountedRef.current) return;
      dotLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(dotGlow, { toValue: 1,   duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(dotGlow, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      dotLoop.current.start();
    });
    return () => {
      mountedRef.current = false;
      fill.stop();
      dotLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  const w = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={spb.wrap}>
      <View style={spb.labelRow}>
        <Text style={spb.label}>{label}</Text>
        <Text style={spb.pct}>{Math.round(pct * 100)}%</Text>
      </View>
      <View style={spb.track}>
        <Animated.View style={[spb.fill, { width: w }]}>
          <View style={spb.shimmer} />
        </Animated.View>
        {/* Dot position driven by JS (same driver as fillAnim), glow driven by native */}
        <Animated.View style={[spb.dotWrap, { left: w as unknown as number }]}>
          <Animated.View style={[spb.dot, {
            opacity: dotGlow,
            transform: [{ scale: dotGlow.interpolate({ inputRange: [0.5, 1], outputRange: [0.85, 1.15] }) }],
          }]} />
        </Animated.View>
      </View>
      <Text style={spb.phase}>{phaseLabel}</Text>
    </View>
  );
}

const spb = StyleSheet.create({
  wrap:     { marginBottom: spacing.md },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label:    { fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.6 },
  pct:      { fontSize: 11, fontWeight: '800', color: colors.gold },
  track:    { height: 8, backgroundColor: 'rgba(184,150,46,0.15)', borderRadius: 6, overflow: 'visible', position: 'relative' },
  fill:     { height: 8, borderRadius: 6, backgroundColor: colors.gold, overflow: 'hidden' },
  shimmer:  { position: 'absolute', top: 0, left: '20%', width: '40%', height: '100%', backgroundColor: 'rgba(255,255,255,0.30)', borderRadius: 6 },
  dotWrap:  { position: 'absolute', top: -3, marginLeft: -7 },
  dot:      { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, borderWidth: 2.5, borderColor: colors.background },
  phase:    { fontSize: 10, fontWeight: '600', color: colors.gold, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 5 },
});
