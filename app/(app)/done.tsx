// ─── Done screen — premium celebration ────────────────────────────────────────
// Reads session result from sessionResultStore (display only, zero DB writes).
// Layout: no scroll. SafeAreaView + fixed flex. Everything on one page.
// Animation sequence: flash → halo expand → seal spring → shine sweep →
//   fireworks burst → particles float → title → cards → CTA

import React, { useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, Animated, Easing,
  Platform, useWindowDimensions, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticSuccess, hapticLight, hapticMedium } from '@/utils/haptics';
import { useSessionResultStore } from '@/store/sessionResultStore';
import type { SessionDifficulty } from '@/db/progress';
import { REVIEW_OFFSETS } from '@/db/reviewItems';

// SW/SH: used only for particle/firework absolute positioning — never for layout
const { width: SW, height: SH } = Dimensions.get('window');

// ─── Particle config ─────────────────────────────────────────────────────────
// 32 particles: mix of gold circles, cream circles, small diamonds.
// Some launch from center-screen area (x 0.35–0.65) for burst effect.

type ParticleConfig = {
  x: number;       // 0–1 fraction of SW
  startY: number;  // 0–1 fraction of SH, starting position
  delay: number;
  duration: number;
  size: number;
  color: string;
  shape: 'circle' | 'diamond';
  rise: number;    // px to travel upward
};

// B18: 20 particles (was 31). Wide-spread (9) + center-burst (7) + secondary (4).
// Trimmed the densest part of the secondary spread. All use useNativeDriver:true.
// Visual quality preserved: wide edges + seal burst are the most perceptually
// impactful zones. Secondary spread adds depth but is least visible on mid-range.
const PARTICLES: ParticleConfig[] = [
  // wide spread — ambient float (9, kept all edge + far-side particles)
  { x: 0.06, startY: 0.88, delay:    0, duration: 3200, size: 5, color: '#D4AF37', shape: 'circle',  rise: 480 },
  { x: 0.14, startY: 0.82, delay:  220, duration: 3600, size: 3, color: '#E8D5A3', shape: 'diamond', rise: 520 },
  { x: 0.24, startY: 0.90, delay:  440, duration: 3000, size: 4, color: '#C9A227', shape: 'circle',  rise: 460 },
  { x: 0.76, startY: 0.87, delay:  330, duration: 3400, size: 4, color: '#C9A227', shape: 'circle',  rise: 470 },
  { x: 0.86, startY: 0.83, delay:  170, duration: 3700, size: 3, color: '#E8D5A3', shape: 'diamond', rise: 510 },
  { x: 0.92, startY: 0.89, delay:  560, duration: 3100, size: 5, color: '#D4AF37', shape: 'circle',  rise: 490 },
  { x: 0.18, startY: 0.92, delay:  640, duration: 2900, size: 6, color: '#F0E6C0', shape: 'circle',  rise: 530 },
  { x: 0.82, startY: 0.91, delay:  280, duration: 3200, size: 5, color: '#D4AF37', shape: 'circle',  rise: 500 },
  { x: 0.56, startY: 0.93, delay:  160, duration: 2800, size: 4, color: '#C9A227', shape: 'circle',  rise: 550 },
  // center burst — launch from seal area (7, kept intact — most impactful)
  { x: 0.38, startY: 0.34, delay:  850, duration: 2200, size: 5, color: '#D4AF37', shape: 'circle',  rise: 320 },
  { x: 0.42, startY: 0.30, delay:  900, duration: 2000, size: 4, color: '#F0E6C0', shape: 'circle',  rise: 290 },
  { x: 0.50, startY: 0.28, delay:  820, duration: 2400, size: 6, color: '#C9A227', shape: 'circle',  rise: 350 },
  { x: 0.58, startY: 0.32, delay:  870, duration: 2100, size: 4, color: '#D4AF37', shape: 'circle',  rise: 300 },
  { x: 0.62, startY: 0.36, delay:  940, duration: 2300, size: 5, color: '#E8D5A3', shape: 'diamond', rise: 330 },
  { x: 0.44, startY: 0.38, delay: 1000, duration: 1900, size: 3, color: '#F0E6C0', shape: 'diamond', rise: 280 },
  { x: 0.55, startY: 0.40, delay:  960, duration: 2500, size: 4, color: '#C9A227', shape: 'diamond', rise: 340 },
  // secondary spread (4, best-spread survivors for depth)
  { x: 0.10, startY: 0.70, delay:  480, duration: 3100, size: 4, color: '#D4AF37', shape: 'circle',  rise: 400 },
  { x: 0.90, startY: 0.74, delay:  740, duration: 3400, size: 3, color: '#E8D5A3', shape: 'diamond', rise: 430 },
  { x: 0.50, startY: 0.75, delay:  200, duration: 3000, size: 3, color: '#D4AF37', shape: 'diamond', rise: 440 },
  { x: 0.72, startY: 0.80, delay:  300, duration: 3500, size: 4, color: '#C9A227', shape: 'circle',  rise: 450 },
];

// ─── Particle component ───────────────────────────────────────────────────────

function Particle({ cfg }: { cfg: ParticleConfig }) {
  const anim = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(cfg.delay),
        Animated.parallel([
          Animated.timing(anim, { toValue: 1, duration: cfg.duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(fade, { toValue: 1,   duration: 350,                        useNativeDriver: true }),
            Animated.timing(fade, { toValue: 0.9, duration: cfg.duration - 750,         useNativeDriver: true }),
            Animated.timing(fade, { toValue: 0,   duration: 400,                        useNativeDriver: true }),
          ]),
        ]),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPx   = cfg.startY * SH;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [startPx, startPx - cfg.rise] });
  const drift      = anim.interpolate({ inputRange: [0, 0.25, 0.6, 1], outputRange: [0, 7, -6, 4] });
  const sz = cfg.size;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cfg.x * SW - sz / 2,
        top: 0,
        opacity: fade,
        transform: [
          { translateY },
          { translateX: drift },
          ...(cfg.shape === 'diamond' ? [{ rotate: '45deg' }] : []),
        ],
      }}
    >
      <View style={{ width: sz, height: sz, borderRadius: cfg.shape === 'circle' ? sz / 2 : 1, backgroundColor: cfg.color }} />
    </Animated.View>
  );
}

// ─── Firework burst: outer ring + inner ring + dot spray ─────────────────────

type FireworkProps = { delay: number; cx: number; cy: number; size: number; color: string; loopGap: number };

function FireworkBurst({ delay, cx, cy, size, color, loopGap }: FireworkProps) {
  const outerScale   = useRef(new Animated.Value(0)).current;
  const outerOpacity = useRef(new Animated.Value(0)).current;
  const innerScale   = useRef(new Animated.Value(0)).current;
  const innerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const seq = (sc: Animated.Value, op: Animated.Value, scTarget: number, dur: number) =>
      Animated.parallel([
        Animated.timing(sc, { toValue: scTarget, duration: dur, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(op, { toValue: 0.55, duration: dur * 0.18, useNativeDriver: true }),
          Animated.timing(op, { toValue: 0,    duration: dur * 0.82, useNativeDriver: true }),
        ]),
      ]);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          seq(outerScale, outerOpacity, 1, 1100),
          seq(innerScale, innerOpacity, 0.65, 800),
        ]),
        Animated.parallel([
          Animated.timing(outerScale,   { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(outerOpacity, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(innerScale,   { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(innerOpacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(loopGap),
      ])
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const half = size / 2;

  return (
    <>
      {/* outer ring */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - half, top: cy - half,
          width: size, height: size, borderRadius: half,
          borderWidth: 1.5, borderColor: color,
          opacity: outerOpacity, transform: [{ scale: outerScale }],
        }}
      />
      {/* inner ring */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - half * 0.6, top: cy - half * 0.6,
          width: size * 0.6, height: size * 0.6, borderRadius: half * 0.6,
          borderWidth: 1, borderColor: color,
          opacity: innerOpacity, transform: [{ scale: innerScale }],
        }}
      />
    </>
  );
}

// ─── Seal shine sweep ─────────────────────────────────────────────────────────

function SealShine({ sealSize, trigger }: { sealSize: number; trigger: Animated.Value }) {
  const shineX = trigger.interpolate({
    inputRange: [0, 1],
    outputRange: [-sealSize * 0.8, sealSize * 1.4],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        width: sealSize * 0.35,
        backgroundColor: 'rgba(255,255,255,0.18)',
        transform: [{ translateX: shineX }, { skewX: '-18deg' }],
        borderRadius: 4,
      }}
    />
  );
}

// ─── Difficulty copy ──────────────────────────────────────────────────────────

function difficultyContent(d: SessionDifficulty | null | undefined, isSingle: boolean): { title: string; body: string; accent: string } {
  if (d === 'easy')     return { title: 'Récitation fluide',       body: isSingle ? "Continue comme ça. Cet ayat commence à bien s'ancrer."     : "Continue comme ça. Le passage commence à bien s'ancrer.",  accent: colors.success };
  if (d === 'hesitant') return { title: 'À consolider',            body: isSingle ? 'Cet ayat mérite une révision proche.'                    : 'Ce passage mérite une révision proche.',                   accent: colors.gold    };
  if (d === 'hard')     return { title: 'Effort validé',           body: isSingle ? 'Cet ayat reste fragile, mais il est enregistré pour être retravaillé.' : 'Ce passage reste fragile, mais il est enregistré pour être retravaillé.', accent: '#A0652A' };
  return                       { title: 'Progression enregistrée', body: 'Zainly préparera la suite de ton apprentissage.',           accent: colors.primary };
}

const CHIPS = REVIEW_OFFSETS.map((n: number) => `J+${n}`);

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function DoneScreen() {
  const { height: WH } = useWindowDimensions();
  // isCompact: phones shorter than 780pt (iPhone SE, older Android mid-range)
  const isCompact = WH < 780;
  const result = useSessionResultStore(s => s.result);

  // ── animation refs ──
  const flashOpacity  = useRef(new Animated.Value(0)).current;
  const haloScale     = useRef(new Animated.Value(0.3)).current;
  const haloOpacity   = useRef(new Animated.Value(0)).current;
  const halo2Scale    = useRef(new Animated.Value(0.5)).current;
  const halo2Opacity  = useRef(new Animated.Value(0)).current;
  const sealScale     = useRef(new Animated.Value(0)).current;
  const sealOpacity   = useRef(new Animated.Value(0)).current;
  const shineAnim     = useRef(new Animated.Value(0)).current;
  const sealGlow      = useRef(new Animated.Value(0.40)).current;
  const titleAnim     = useRef(new Animated.Value(0)).current;
  const cardAnim      = useRef(new Animated.Value(0)).current;
  const hifzAnim      = useRef(new Animated.Value(0)).current;
  const ctaAnim       = useRef(new Animated.Value(0)).current;
  const primaryScale  = useRef(new Animated.Value(1)).current;
  const secondScale   = useRef(new Animated.Value(1)).current;
  const breathLoop    = useRef<Animated.CompositeAnimation | null>(null);
  const glowLoop      = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    // Stage 0: immediate golden flash
    Animated.sequence([
      Animated.timing(flashOpacity, { toValue: 0.18, duration: 160, useNativeDriver: true }),
      Animated.timing(flashOpacity, { toValue: 0,    duration: 500, useNativeDriver: true }),
    ]).start();

    // Stage 1: halo expands
    Animated.parallel([
      Animated.timing(haloScale,   { toValue: 1, duration: 750, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(haloOpacity, { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(halo2Scale,  { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(halo2Opacity,{ toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Stage 2: seal springs in at 300ms
    const t0 = setTimeout(() => {
      Animated.spring(sealScale, { toValue: 1, friction: 4.5, tension: 120, useNativeDriver: true }).start();
      Animated.timing(sealOpacity, { toValue: 1, duration: 80, useNativeDriver: true }).start();
    }, 300);

    // Stage 3: shine sweep across seal at 650ms
    const t1 = setTimeout(() => {
      Animated.timing(shineAnim, { toValue: 1, duration: 480, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
    }, 650);

    // Stage 4: haptic + content cascade
    const t2 = setTimeout(() => { hapticSuccess(); }, 400);
    const t3 = setTimeout(() => {
      Animated.stagger(90, [
        Animated.timing(titleAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(cardAnim,  { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(hifzAnim,  { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(ctaAnim,   { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }, 800);

    // Stage 5: breathing glow on seal after entrance
    const t4 = setTimeout(() => {
      breathLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(sealScale, { toValue: 1.048, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sealScale, { toValue: 1.000, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      breathLoop.current.start();

      glowLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(sealGlow, { toValue: 0.65, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sealGlow, { toValue: 0.40, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      glowLoop.current.start();
    }, 1600);

    return () => {
      clearTimeout(t0); clearTimeout(t1); clearTimeout(t2);
      clearTimeout(t3); clearTimeout(t4);
      breathLoop.current?.stop();
      glowLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── derived display ──
  const ayatCount   = result ? (result.newAyatCount > 0 ? result.newAyatCount : result.toAyah - result.fromAyah + 1) : 0;
  const isSingleAyat = ayatCount <= 1;
  const ayatLabel   = isSingleAyat ? "1 ayat mémorisé aujourd'hui" : `${ayatCount} ayats mémorisés aujourd'hui`;
  const rangeLabel  = result
    ? result.fromAyah === result.toAyah
      ? `${result.surahName} · Ayat ${result.fromAyah}`
      : `${result.surahName} · Ayats ${result.fromAyah} à ${result.toAyah}`
    : null;
  const diff = difficultyContent(result?.difficulty, isSingleAyat);

  // ── fireworks — deterministic positions around seal ──
  // SafeAreaView handles actual insets; use a fixed top estimate for firework Y.
  // 44 covers notched iPhones, 28 covers standard Android/older iPhones.
  const fireworks = useMemo((): FireworkProps[] => {
    const safeTopEst = Platform.OS === 'ios' ? 44 : 28;
    const sealCY     = safeTopEst + 8 + (isCompact ? 148 : HALO1_SIZE) / 2;
    return [
      { delay:    0, cx: SW * 0.50, cy: sealCY,      size: 130, color: 'rgba(212,175,55,0.60)', loopGap: 2800 },
      { delay:  600, cx: SW * 0.22, cy: sealCY + 20, size: 100, color: 'rgba(184,150,46,0.45)', loopGap: 3200 },
      { delay: 1100, cx: SW * 0.78, cy: sealCY + 10, size: 110, color: 'rgba(240,220,160,0.50)', loopGap: 3000 },
      { delay: 1600, cx: SW * 0.38, cy: sealCY - 30, size:  80, color: 'rgba(212,175,55,0.35)', loopGap: 3600 },
      { delay: 2000, cx: SW * 0.64, cy: sealCY - 20, size:  90, color: 'rgba(200,162,40,0.40)', loopGap: 3400 },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompact]);

  const slide = (anim: Animated.Value, dist = 16) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dist, 0] }) }],
  });

  const onPrimaryPress = () => { hapticMedium(); router.replace('/(app)/(tabs)/'); };
  const onHifzPress    = () => { hapticLight();  router.replace('/(app)/(tabs)/hifz'); };

  // responsive sizing — compact phones get reduced dimensions
  const sealSz   = isCompact ? 82  : SEAL_SIZE;
  const halo1Sz  = isCompact ? 148 : HALO1_SIZE;
  const halo2Sz  = isCompact ? 116 : HALO2_SIZE;
  const glowSz   = sealSz + 32;
  const sealZoneH = halo1Sz + 4;

  return (
    // SafeAreaView handles top/bottom safe insets; overflow hidden kills any bounce/scroll
    <SafeAreaView style={s.safeArea}>
      {/* ── Lock to exact window height — zero overflow possible ── */}
      <View style={[s.root, { height: WH, overflow: 'hidden' }]}>

        {/* ── ABSOLUTE LAYER: particles (never affect layout) ── */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {PARTICLES.map((cfg, i) => <Particle key={i} cfg={cfg} />)}
        </View>

        {/* ── ABSOLUTE LAYER: golden flash ── */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#D4AF37', opacity: flashOpacity }]}
        />

        {/* ── ABSOLUTE LAYER: firework rings ── */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {fireworks.map((fw, i) => <FireworkBurst key={i} {...fw} />)}
        </View>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* CONTENT COLUMN — all layout lives here, clips to WH            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <View style={[s.column, { paddingHorizontal: spacing.lg }]}>

          {/* SEAL ZONE */}
          <View style={[s.sealZone, { height: sealZoneH, marginTop: isCompact ? 4 : 8 }]}>
            <Animated.View style={[
              s.haloOuter,
              { width: halo1Sz, height: halo1Sz, borderRadius: halo1Sz / 2 },
              { opacity: haloOpacity, transform: [{ scale: haloScale }] },
            ]} />
            <Animated.View style={[
              s.haloInner,
              { width: halo2Sz, height: halo2Sz, borderRadius: halo2Sz / 2 },
              { opacity: halo2Opacity, transform: [{ scale: halo2Scale }] },
            ]} />
            <Animated.View style={[s.seal, { width: sealSz, height: sealSz, opacity: sealOpacity, transform: [{ scale: sealScale }] }]}>
              <Animated.View style={[s.sealGlowRing, { width: glowSz, height: glowSz, borderRadius: glowSz / 2, opacity: sealGlow }]} />
              <View style={[s.sealRing, { width: sealSz, height: sealSz, borderRadius: sealSz / 2 }]}>
                <View style={[s.sealCore, { width: sealSz - 18, height: sealSz - 18, borderRadius: (sealSz - 18) / 2 }]}>
                  <Text style={[s.sealCheck, { fontSize: isCompact ? 32 : 38 }, Platform.OS === 'android' && { lineHeight: isCompact ? 40 : 46 }]} allowFontScaling={false}>✓</Text>
                </View>
                <View style={[s.sealShineClip, { borderRadius: sealSz / 2 }]} pointerEvents="none">
                  <SealShine sealSize={sealSz} trigger={shineAnim} />
                </View>
              </View>
            </Animated.View>
          </View>

          {/* TITLE */}
          <Animated.View style={[s.titleBlock, { marginTop: isCompact ? 2 : 6, marginBottom: isCompact ? 8 : 12 }, slide(titleAnim, 14)]}>
            <Text style={s.badgeLabel}>SESSION COMPLÈTE</Text>
            <Text style={[s.title, isCompact && { fontSize: 22, marginBottom: 1 }]}>Session validée</Text>
            <Text style={[s.subtitle, isCompact && { lineHeight: 16 }]}>Chaque session construit ton Hifz.</Text>
          </Animated.View>

          {/* CARDS — shrink if needed, never grow past natural size */}
          <View style={s.cardsZone}>

            {/* result card */}
            <Animated.View style={[s.card, isCompact && s.cardCompact, slide(cardAnim)]}>
              {result ? (
                <>
                  <View style={[s.cardHeader, isCompact && { marginBottom: 5 }]}>
                    <View style={s.cardDot} />
                    <Text style={s.cardHeaderText}>CE QUE TU AS APPRIS</Text>
                  </View>
                  <View style={s.cardBodyRow}>
                    <View style={s.cardBodyLeft}>
                      <Text style={[s.ayatCountLabel, isCompact && { fontSize: 15 }]}>{ayatLabel}</Text>
                      {rangeLabel ? <Text style={s.rangeLabel}>{rangeLabel}</Text> : null}
                    </View>
                    <View style={[s.diffBadge, { borderColor: diff.accent + '55', backgroundColor: diff.accent + '12' }]}>
                      <View style={[s.diffBadgeDot, { backgroundColor: diff.accent }]} />
                      <Text style={[s.diffBadgeText, { color: diff.accent }]}>{diff.title}</Text>
                    </View>
                  </View>
                  <Text style={[s.diffBody, isCompact && { lineHeight: 15 }]}>{diff.body}</Text>
                </>
              ) : (
                <Text style={s.fallbackText}>Session terminée.{'\n'}Retourne à Aujourd'hui pour continuer.</Text>
              )}
            </Animated.View>

            {/* hifz card */}
            {result ? (
              <Animated.View style={[s.hifzCard, slide(hifzAnim)]}>
                <View style={s.hifzAccent} />
                <View style={[s.hifzBody, isCompact && { paddingVertical: 7 }]}>
                  <Text style={[s.hifzConfirm, isCompact && { lineHeight: 16 }]}>{isSingleAyat ? 'Ton ayat appris est dans ' : 'Tes ayats appris sont dans '}<Text style={s.hifzBold}>Mon Hifz</Text>.</Text>
                  <Text style={[s.hifzSub, isCompact && { lineHeight: 14, marginBottom: 4 }]}>{isSingleAyat ? 'Tu pourras le retrouver depuis cette page.' : 'Tu pourras les retrouver depuis cette page.'}</Text>
                  <View style={[s.hifzDivider, isCompact && { marginBottom: 4 }]} />
                  <Text style={[s.revLabel, isCompact && { marginBottom: 4 }]}>Tes prochaines révisions sont préparées.</Text>
                  <View style={s.chipRow}>
                    {CHIPS.map(c => (
                      <View key={c} style={[s.chip, isCompact && s.chipCompact]}>
                        <Text style={s.chipText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Animated.View>
            ) : null}

          </View>{/* /cardsZone */}

          {/* SPACER — absorbs leftover space, pushes CTA down */}
          <View style={s.spacer} />

          {/* CTA — always at bottom, always visible */}
          <Animated.View style={[s.ctaArea, slide(ctaAnim, 12)]}>
            <Animated.View style={{ transform: [{ scale: primaryScale }] }}>
              <Pressable
                style={({ pressed }) => [s.ctaPrimary, isCompact && s.ctaPrimaryCompact, pressed && s.ctaPressed]}
                onPress={onPrimaryPress}
                onPressIn={() => Animated.spring(primaryScale, { toValue: 0.96, useNativeDriver: true, friction: 7 }).start()}
                onPressOut={() => Animated.spring(primaryScale, { toValue: 1.00, useNativeDriver: true, friction: 7 }).start()}
              >
                <Text style={s.ctaPrimaryText}>Retour à Aujourd'hui</Text>
              </Pressable>
            </Animated.View>

            <Animated.View style={{ transform: [{ scale: secondScale }] }}>
              <Pressable
                style={({ pressed }) => [s.ctaSecondary, isCompact && s.ctaSecondaryCompact, pressed && s.ctaSecondaryPressed]}
                onPress={onHifzPress}
                onPressIn={() => Animated.spring(secondScale, { toValue: 0.96, useNativeDriver: true, friction: 7 }).start()}
                onPressOut={() => Animated.spring(secondScale, { toValue: 1.00, useNativeDriver: true, friction: 7 }).start()}
              >
                <Text style={s.ctaSecondaryText}>Voir mon Hifz</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

        </View>{/* /column */}
      </View>{/* /root */}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Sizes defined as constants; responsive overrides applied inline via isCompact.

const SEAL_SIZE   = 96;
const HALO1_SIZE  = 172;
const HALO2_SIZE  = 136;

const s = StyleSheet.create({
  // ── SafeAreaView wrapper ──────────────────────────────────────────────────
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── root: EXACTLY window height, overflow hidden kills any scroll ─────────
  root: {
    // height set inline to WH — this is the key no-scroll guarantee
    backgroundColor: colors.background,
    // overflow: 'hidden' set inline
  },

  // ── full-screen column — all layout lives here ────────────────────────────
  column: {
    flex: 1,
    flexDirection: 'column',
  },

  // ── seal zone (height set inline, responsive) ─────────────────────────────
  sealZone: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    // height set inline
  },
  haloOuter: {
    position: 'absolute',
    // width/height/borderRadius set inline
    borderWidth: 1.5, borderColor: 'rgba(212,175,55,0.35)',
    backgroundColor: 'rgba(184,150,46,0.07)',
  },
  haloInner: {
    position: 'absolute',
    // width/height/borderRadius set inline
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
    backgroundColor: 'rgba(184,150,46,0.05)',
  },
  seal: {
    // width/height set inline
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.gold, shadowOpacity: 0.50,
    shadowRadius: 28, shadowOffset: { width: 0, height: 8 }, elevation: 14,
  },
  sealGlowRing: {
    position: 'absolute',
    // width/height/borderRadius/opacity set inline
    backgroundColor: 'rgba(212,175,55,0.18)',
  },
  sealRing: {
    // width/height/borderRadius set inline
    borderWidth: 3.5, borderColor: colors.gold,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.gold, shadowOpacity: 0.40,
    shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  sealCore: {
    // width/height/borderRadius set inline
    backgroundColor: 'rgba(184,150,46,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  sealCheck: {
    color: colors.gold, fontWeight: '700',
    // fontSize + lineHeight set inline
  },
  sealShineClip: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    // borderRadius set inline
    overflow: 'hidden',
  },

  // ── title block ───────────────────────────────────────────────────────────
  titleBlock: {
    alignItems: 'center',
    // marginTop/marginBottom set inline (responsive)
  },
  badgeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 2.8, color: colors.gold, marginBottom: 5 },
  title:      { fontSize: 26, fontWeight: '800', color: colors.primary, textAlign: 'center', letterSpacing: -0.3, marginBottom: 3 },
  subtitle:   { fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 18, fontStyle: 'italic' },

  // ── cards zone: flexShrink so cards compress before CTA is pushed away ────
  cardsZone: {
    flexShrink: 1,
  },

  // ── result card ───────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardCompact: { paddingVertical: 9, marginBottom: 6 },

  cardHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardDot:        { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold },
  cardHeaderText: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: colors.gold },
  cardBodyRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 },
  cardBodyLeft:   { flex: 1 },

  ayatCountLabel: { fontSize: 17, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  rangeLabel:     { fontSize: 12, color: colors.muted },

  diffBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  diffBadgeDot:  { width: 5, height: 5, borderRadius: 2.5 },
  diffBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  diffBody:      { fontSize: 12, color: colors.muted, lineHeight: 17 },

  // ── hifz card ─────────────────────────────────────────────────────────────
  hifzCard: {
    flexDirection: 'row',
    backgroundColor: colors.goldSoft,
    borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)',
    overflow: 'hidden',
    shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  hifzAccent: { width: 4, backgroundColor: colors.gold },
  hifzBody:   { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  hifzConfirm:{ fontSize: 12, fontWeight: '600', color: colors.primary, lineHeight: 18, marginBottom: 1 },
  hifzBold:   { fontWeight: '800' },
  hifzSub:    { fontSize: 11, color: colors.muted, lineHeight: 16, marginBottom: 6 },
  hifzDivider:{ height: 1, backgroundColor: 'rgba(184,150,46,0.18)', marginBottom: 6 },
  revLabel:   { fontSize: 11, color: colors.muted, fontStyle: 'italic', marginBottom: 5 },
  chipRow:    { flexDirection: 'row', gap: 4 },
  chip:        { paddingHorizontal: 8,  paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(184,150,46,0.40)', backgroundColor: 'rgba(184,150,46,0.08)' },
  chipCompact: { paddingHorizontal: 6,  paddingVertical: 2 },
  chipText:    { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 0.4 },

  // fallback
  fallbackText: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  // ── spacer: distributes leftover space but capped so CTA stays near cards ──
  spacer: { flex: 1, minHeight: 8, maxHeight: 32 },

  // ── CTA ───────────────────────────────────────────────────────────────────
  ctaArea:             { gap: 8, paddingBottom: 8 },
  ctaPrimary:          { width: '100%', backgroundColor: colors.primary, borderRadius: 16, height: 54,
                         alignItems: 'center', justifyContent: 'center',
                         shadowColor: colors.primary, shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  ctaPrimaryCompact:   { height: 48 },
  ctaPressed:          { opacity: 0.88 },
  ctaPrimaryText:      { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  ctaSecondary:        { width: '100%', borderRadius: 16, height: 46, alignItems: 'center', justifyContent: 'center',
                         borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.28)', backgroundColor: 'rgba(22,48,38,0.04)' },
  ctaSecondaryCompact: { height: 40 },
  ctaSecondaryPressed: { opacity: 0.72 },
  ctaSecondaryText:    { color: colors.primary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
});


