// ─── PremiumBackground ────────────────────────────────────────────────────────
// Reusable animated background: organic halos + floating gold particles.
// All animations use opacity / scale / translateY — native-driver safe.
// No width/left/top/bottom animated. Very low opacity — never obtrusive.

import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;

// ── particle config — 8 tiny gold/green dots spread across full screen ────────
const PARTICLES = [
  { x: SW * 0.07, y: SH * 0.11, r: 3,   color: 'rgba(184,150,46,0.32)', delay: 0    },
  { x: SW * 0.84, y: SH * 0.17, r: 2.5, color: 'rgba(184,150,46,0.24)', delay: 600  },
  { x: SW * 0.12, y: SH * 0.34, r: 4,   color: 'rgba(22,48,38,0.14)',   delay: 1200 },
  { x: SW * 0.76, y: SH * 0.42, r: 2,   color: 'rgba(184,150,46,0.20)', delay: 300  },
  { x: SW * 0.90, y: SH * 0.58, r: 3,   color: 'rgba(22,48,38,0.10)',   delay: 900  },
  { x: SW * 0.06, y: SH * 0.66, r: 2.5, color: 'rgba(184,150,46,0.26)', delay: 1500 },
  { x: SW * 0.70, y: SH * 0.78, r: 2,   color: 'rgba(184,150,46,0.18)', delay: 450  },
  { x: SW * 0.22, y: SH * 0.88, r: 3.5, color: 'rgba(22,48,38,0.09)',   delay: 750  },
] as const;

// ── halo config — 3 large organic blobs ──────────────────────────────────────
const HALOS = [
  { x: -SW * 0.22, y: -SH * 0.06, size: SW * 0.90, color: 'rgba(22,48,38,0.07)',   scaleFrom: 0.96, scaleTo: 1.04, dur: 7200, delay: 0    },
  { x: SW * 0.30,  y: SH * 0.28,  size: SW * 0.75, color: 'rgba(184,150,46,0.055)', scaleFrom: 1.02, scaleTo: 0.97, dur: 9000, delay: 2400 },
  { x: -SW * 0.10, y: SH * 0.62,  size: SW * 0.80, color: 'rgba(22,48,38,0.055)',  scaleFrom: 0.98, scaleTo: 1.03, dur: 8200, delay: 1200 },
] as const;

type ParticleProps = {
  x: number; y: number; r: number; color: string; delay: number;
  anim: Animated.Value;
};

function Particle({ x, y, r, color, anim }: ParticleProps) {
  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [5, -5],
    extrapolate: 'clamp',
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: x - r,
          top: y - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: color,
          opacity: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1, 0.4] }),
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

type HaloProps = {
  x: number; y: number; size: number; color: string;
  anim: Animated.Value;
};

function Halo({ x, y, size, color, anim }: HaloProps) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.halo,
        {
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
          transform: [{ scale: anim }],
        },
      ]}
    />
  );
}

export function PremiumBackground() {
  const mountedRef = useRef(true);

  // one anim per particle
  const particleAnims = useRef(
    PARTICLES.map(() => new Animated.Value(0))
  ).current;
  const particleLoops = useRef<Animated.CompositeAnimation[]>([]);

  // one anim per halo
  const haloAnims = useRef(
    HALOS.map((h) => new Animated.Value(h.scaleFrom))
  ).current;
  const haloLoops = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    mountedRef.current = true;

    // start particle float loops
    PARTICLES.forEach((p, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(particleAnims[i], {
            toValue: 1, duration: 3200 + i * 200,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(particleAnims[i], {
            toValue: 0, duration: 3200 + i * 200,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ])
      );
      particleLoops.current[i] = loop;
      loop.start();
    });

    // start halo breathe loops
    HALOS.forEach((h, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.delay(h.delay),
          Animated.timing(haloAnims[i], {
            toValue: h.scaleTo, duration: h.dur,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(haloAnims[i], {
            toValue: h.scaleFrom, duration: h.dur,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ])
      );
      haloLoops.current[i] = loop;
      loop.start();
    });

    return () => {
      mountedRef.current = false;
      particleLoops.current.forEach(l => l.stop());
      haloLoops.current.forEach(l => l.stop());
    };
  }, []);

  return (
    <View style={styles.root} pointerEvents="none">
      {HALOS.map((h, i) => (
        <Halo key={i} {...h} anim={haloAnims[i]} />
      ))}
      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} anim={particleAnims[i]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  halo:     { position: 'absolute' },
  particle: { position: 'absolute' },
});
