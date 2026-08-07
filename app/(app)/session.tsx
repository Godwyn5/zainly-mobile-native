// ─── Session · Steps 1–2 — Ta mission du jour / Découverte ─────────────────
// Step 1: mission overview. Step 2: ayat discovery.
// No DB writes. No review item creation.
// Reads only from usePlan / useProgress / useDueReviews via getTodayProgramme.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { PremiumBackground } from '@/components/PremiumBackground';
import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { getQuranAyahRange } from '@/core/quranContent';
import type { QuranAyahContent } from '@/core/quranContent';
import { useAuthStore }      from '@/store/authStore';
import { useZainlyPlusAccess } from '@/hooks/useZainlyPlusAccess';
import { usePlan }           from '@/hooks/usePlan';
import { useProgress }       from '@/hooks/useProgress';
import { useDueReviews }     from '@/hooks/useDueReviews';
import { useLocalDate } from '@/hooks/useLocalDate';
import { getTodayProgramme } from '@/core/dailyPlan';
import { estimateDuration, chargeInfo } from '@/core/sessionWorkload';
import { SessionProgressBar } from '@/components/SessionProgressBar';
import { DiscoveryScreen } from '@/components/session/DiscoveryScreen';
import { DecoupageScreen } from '@/components/session/DecoupageScreen';
import { RepetitionScreen } from '@/components/session/RepetitionScreen';
import { AyatRecitationScreen } from '@/components/session/AyatRecitationScreen';
import { FinalTestScreen } from '@/components/session/FinalTestScreen';

// ─── constants ────────────────────────────────────────────────────────────────

const SW = Dimensions.get('window').width;
const PROGRESS_PCT           = 0.13; // Step 1 anchors at ~13%

// ─── helpers ──────────────────────────────────────────────────────────────────

// localDateStr is now provided by useLocalDate() — see src/hooks/useLocalDate.ts

// ─── sub-components ───────────────────────────────────────────────────────────

// ─── 2×2 Method cards ─────────────────────────────────────────────────────────

type MethodState = 'active' | 'completed' | 'locked';

const METHOD_STEPS = [
  { num: '1', title: 'Découvre', body: 'Lis, écoute, comprends.',          accent: colors.primary },
  { num: '2', title: 'Découpe',  body: 'Morceau par morceau.',            accent: colors.gold    },
  { num: '3', title: 'Répète',   body: 'Ancre l\'ayat avec guidage.',     accent: colors.primary },
  { num: '4', title: 'Récite',   body: 'Cache les aides puis évalue.',    accent: colors.gold    },
] as const;

// Step 1 is active by default on the mission screen (no session started yet)
const STEP_STATES: MethodState[] = ['active', 'locked', 'locked', 'locked'];

function MethodCards({ anims }: { anims: Animated.Value[] }) {
  return (
    <View style={mc.grid}>
      {METHOD_STEPS.map((step, i) => {
        const state = STEP_STATES[i];
        const isActive    = state === 'active';
        const isCompleted = state === 'completed';
        const isLocked    = state === 'locked';
        const isRightCard = i % 2 === 1; // Second card in each row

        const cardBorder  = isActive    ? 'rgba(184,150,46,0.55)'
                          : isCompleted ? 'rgba(45,106,79,0.40)'
                          :               'rgba(184,150,46,0.14)';
        const cardBg      = isActive    ? '#FEFCF5'
                          : isCompleted ? 'rgba(45,106,79,0.05)'
                          :               colors.surface;
        const badgeBg     = isActive    ? (step.accent === colors.gold ? 'rgba(184,150,46,0.18)' : 'rgba(22,48,38,0.12)')
                          : isCompleted ? 'rgba(45,106,79,0.12)'
                          :               'rgba(184,150,46,0.07)';
        const numColor    = isLocked    ? colors.disabled
                          : isCompleted ? colors.success
                          :               step.accent;
        const titleColor  = isLocked    ? colors.disabled : colors.primary;
        const bodyColor   = isLocked    ? colors.disabled : colors.muted;

        return (
          <Animated.View
            key={step.num}
            style={[
              mc.card,
              { borderColor: cardBorder, backgroundColor: cardBg },
              !isRightCard && mc.cardMarginRight,
              i < 2 && mc.cardMarginBottom,
              isActive && mc.cardActive,
              isCompleted && mc.cardCompleted,
              isLocked && mc.cardLocked,
              {
                opacity: anims[i],
                transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}
          >
            <View style={[mc.numBadge, { backgroundColor: badgeBg }]}>
              {isCompleted
                ? <Text style={mc.checkMark}>✓</Text>
                : <Text style={[mc.num, { color: numColor }]}>{step.num}</Text>
              }
            </View>
            <Text style={[mc.title, { color: titleColor }]}>{step.title}</Text>
            <Text style={[mc.body,  { color: bodyColor  }]}>{step.body}</Text>
            {isActive && <View style={mc.activeGlowDot} />}
          </Animated.View>
        );
      })}
    </View>
  );
}
const mc = StyleSheet.create({
  grid:          { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  card:          {
    width: (SW - spacing.lg * 2 - spacing.sm) / 2,
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)',
    padding: spacing.md,
    shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  cardMarginRight: { marginRight: spacing.sm },
  cardMarginBottom: { marginBottom: spacing.sm },
  cardActive:    {
    shadowColor: colors.gold, shadowOpacity: 0.22, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  cardCompleted: {
    shadowColor: colors.success, shadowOpacity: 0.12, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardLocked:    { opacity: 0.52 },
  numBadge:  { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  num:       { fontSize: 14, fontWeight: '900' },
  checkMark: { fontSize: 15, fontWeight: '900', color: colors.success },
  title:     { fontSize: 14, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  body:      { fontSize: 12, color: colors.muted, lineHeight: 18 },
  activeGlowDot: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.gold, opacity: 0.7,
  },
});

// ─── section ornament ─────────────────────────────────────────────────────────

function SectionOrnament() {
  return (
    <View style={so.row} pointerEvents="none">
      <View style={so.dot} /><View style={so.line} /><View style={so.dot} /><View style={so.line} /><View style={so.dot} />
    </View>
  );
}
const so = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md, gap: 8 },
  dot:  { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(184,150,46,0.45)' },
  line: { width: 24, height: 1, backgroundColor: 'rgba(184,150,46,0.28)' },
});

// ─── State screens ────────────────────────────────────────────────────────────

function StaticScreen({ title, body, cta, onCta }: { title: string; body: string; cta: string; onCta: () => void }) {
  return (
    <SafeAreaView style={ss.safe}>
      <View style={ss.inner}>
        <View style={ss.card}>
          <View style={ss.dot} />
          <Text style={ss.title}>{title}</Text>
          <Text style={ss.body}>{body}</Text>
        </View>
        <Pressable style={ss.btn} onPress={onCta}>
          <Text style={ss.btnLabel}>{cta}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const ss = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  card:  { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' },
  dot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold, marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary, textAlign: 'center', marginBottom: spacing.sm },
  body:  { fontSize: 14, color: colors.muted, lineHeight: 22, textAlign: 'center' },
  btn:   { backgroundColor: colors.primary, borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
});

// ─── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen() {
  const dotAnim = useRef(new Animated.Value(0.3)).current;
  const loop    = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    loop.current = Animated.loop(Animated.sequence([
      Animated.timing(dotAnim, { toValue: 1,   duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(dotAnim, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.current.start();
    return () => loop.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scaleX   = dotAnim.interpolate({ inputRange: [0.3, 1], outputRange: [0.30, 1.0] });
  const shiftX   = dotAnim.interpolate({ inputRange: [0.3, 1], outputRange: [-49, 0] });

  return (
    <SafeAreaView style={ls.safe}>
      <View style={ls.inner}>
        <Animated.View style={[ls.dot, { opacity: dotAnim, transform: [{ scale: dotAnim.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1.2] }) }] }]} />
        <Text style={ls.text}>Préparation de ta session…</Text>
        <View style={ls.barTrack}>
          <Animated.View style={[ls.barFill, { transform: [{ scaleX }, { translateX: shiftX }] }]} />
        </View>
      </View>
    </SafeAreaView>
  );
}
const ls = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: colors.background },
  inner:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  dot:      { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, marginBottom: spacing.lg },
  text:     { fontSize: 15, color: colors.muted, fontWeight: '600', marginBottom: spacing.lg },
  barTrack: { width: 140, height: 4, backgroundColor: 'rgba(184,150,46,0.15)', borderRadius: 4, overflow: 'hidden' },
  barFill:  { width: 140, height: 4, backgroundColor: colors.gold, borderRadius: 4 },
});

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function SessionScreen() {
  const insets = useSafeAreaInsets();
  const user   = useAuthStore(s => s.user);
  const userId = user?.id;
  const today  = useLocalDate();

  const plan     = usePlan(userId);
  const progress = useProgress(userId);
  const reviews  = useDueReviews(userId);
  // Source of truth: RevenueCat 'zainly_plus' entitlement, with profile.is_premium as fallback.
  const { hasZainlyPlus, isLoading: isZainlyPlusLoading } = useZainlyPlusAccess(userId);

  const isLoading = plan.isLoading || progress.isLoading || reviews.isLoading || isZainlyPlusLoading;

  const prog = useMemo(() => getTodayProgramme({
    plan:                plan.data    ?? null,
    progress:            progress.data ?? null,
    dueReviewCount:      reviews.data  ?? 0,
    today,
    // Free users are capped at 1 new ayat per day; Zainly+ follows their plan pace.
    effectiveAyahPerDay: hasZainlyPlus ? undefined : 1,
  }), [plan.data, progress.data, reviews.data, today, hasZainlyPlus]);

  // ── internal phase + ayat index ──
  const [phase, setPhase] = useState<'mission' | 'discovery' | 'decoupage' | 'repetition' | 'ayatRecitation' | 'finalTest'>('mission');
  // ayat loaded from discovery, passed through steps 3-5
  const [discoveredAyat, setDiscoveredAyat] = useState<QuranAyahContent | null>(null);
  // per-ayat index within today session
  const [currentAyatIndex, setCurrentAyatIndex] = useState(0);
  // all ayats loaded for final test
  const [allTodayAyats, setAllTodayAyats] = useState<QuranAyahContent[]>([]);


  // ── animation refs ──
  const mountedRef  = useRef(true);
  const headerAnim  = useRef(new Animated.Value(0)).current;
  const progBarAnim = useRef(new Animated.Value(0)).current;
  const missionAnim = useRef(new Animated.Value(0)).current;
  const coachAnim   = useRef(new Animated.Value(0)).current;
  const ctaGlow     = useRef(new Animated.Value(0.25)).current;
  const ctaShine    = useRef(new Animated.Value(-1)).current;
  const haloScale   = useRef(new Animated.Value(1)).current;
  const haloOpacity = useRef(new Animated.Value(0.13)).current;
  const heroGlow    = useRef(new Animated.Value(0.07)).current;
  const goldLineW   = useRef(new Animated.Value(0)).current;
  const methodAnims = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const haloLoop    = useRef<Animated.CompositeAnimation | null>(null);
  const ctaGlowLoop = useRef<Animated.CompositeAnimation | null>(null);
  const ctaShineLoop= useRef<Animated.CompositeAnimation | null>(null);
  const heroGlowLoop= useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    // staggered entrance
    const entrance = Animated.stagger(90, [
      Animated.timing(headerAnim,  { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(progBarAnim, { toValue: 1, duration: 440, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(missionAnim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ...methodAnims.map(a => Animated.timing(a, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
      Animated.timing(coachAnim,   { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    entrance.start();

    // gold line grow in header
    Animated.timing(goldLineW, {
      toValue: 1, duration: 900, delay: 400,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();

    return () => {
      mountedRef.current = false;
      entrance.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── mission-intro decorative loops (halo, hero glow, CTA breathing/shine) ──
  // SessionScreen never unmounts across phase transitions (phases 2-6 are
  // early-returned sibling components below), so without this guard these
  // loops would keep animating in the background for the whole session,
  // compounding with each phase's own animation loops. Only relevant while
  // the 'mission' intro screen is actually rendered.
  useEffect(() => {
    if (phase !== 'mission') return;

    // halo pulse
    haloLoop.current = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.08, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.22, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.00, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.13, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ]));
    haloLoop.current.start();

    // hero inner glow
    heroGlowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(heroGlow, { toValue: 0.17, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(heroGlow, { toValue: 0.07, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    heroGlowLoop.current.start();

    // CTA breathing glow
    ctaGlowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaGlow, { toValue: 0.72, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(ctaGlow, { toValue: 0.25, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    ctaGlowLoop.current.start();

    // CTA gold shine sweep
    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2400),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();

    return () => {
      haloLoop.current?.stop();
      heroGlowLoop.current?.stop();
      ctaGlowLoop.current?.stop();
      ctaShineLoop.current?.stop();
    };
  }, [phase]);

  const goBack = useCallback(() => {
    hapticLight();
    router.back();
  }, []);

  const goDashboard = useCallback(() => {
    router.replace('/(app)/(tabs)/');
  }, []);

  const isAdvancing = useRef(false);
  const onCta = useCallback(() => {
    if (isAdvancing.current) return;
    isAdvancing.current = true;
    hapticLight();
    setPhase('discovery');
    // reset after render cycle so it can fire again if user navigates back to mission
    setTimeout(() => { isAdvancing.current = false; }, 600);
  }, []);

  // ── derived values used in phase renders ──
  // Computed before early returns so that hooks below (useCallback) are
  // always called in the same order.  The null-coalescing defaults (?? 1,
  // ?? memStart) are safe: when prog.memStart / prog.memEnd are null the
  // early returns below prevent these values from being used in any
  // meaningful render path.
  const memStart          = prog.memStart ?? 1;
  const memEnd            = prog.memEnd   ?? memStart;
  const totalAyatsToday   = memEnd - memStart + 1;
  const currentAyatNumber = memStart + currentAyatIndex;
  const isLastAyat        = currentAyatIndex >= totalAyatsToday - 1;

  // ── helper: advance to next ayat (reset per-ayat state) ──
  const goNextAyat = useCallback(() => {
    hapticMedium();
    setDiscoveredAyat(null);
    setCurrentAyatIndex(prev => prev + 1);
    setPhase('discovery');
  }, []);

  // ── helper: restart the whole learning passage from ayat 1 ──
  const restartLearningPassage = useCallback(() => {
    hapticMedium();
    setCurrentAyatIndex(0);
    setDiscoveredAyat(null);
    setAllTodayAyats([]);
    setPhase('discovery');
  }, []);

  // ── helper: load all today ayats for final test ──
  const goFinalTest = useCallback(() => {
    hapticMedium();
    if (prog.currentSurah == null) { setPhase('finalTest'); return; }
    getQuranAyahRange({ surahNumber: prog.currentSurah, fromAyah: memStart, toAyah: memEnd })
      .then(result => {
        if (result.ok) setAllTodayAyats(result.ayahs);
        setPhase('finalTest');
      })
      .catch(() => setPhase('finalTest'));
  }, [prog.currentSurah, memStart, memEnd]);

  // ── loading ──
  if (isLoading) return <LoadingScreen />;

  // ── no plan / no progress ──
  if (!plan.data || !progress.data) {
    return (
      <StaticScreen
        title="Ton programme n'est pas prêt."
        body="Configure ton programme Zainly avant de commencer une session."
        cta="Retour au Dashboard"
        onCta={goDashboard}
      />
    );
  }

  // ── session already done today (free users only — Zainly+ can continue) ──
  if (!hasZainlyPlus && prog.sessionDoneToday) {
    return (
      <StaticScreen
        title="Session déjà terminée aujourd'hui."
        body="Reviens demain, Zainly préparera la suite."
        cta="Retour au Dashboard"
        onCta={goDashboard}
      />
    );
  }

  // ── invalid programme data ──
  if (!prog.currentSurah || prog.memStart == null || prog.memEnd == null || prog.todayAyatCount === 0) {
    return (
      <StaticScreen
        title="Impossible de préparer cette session."
        body="Les données de ton programme sont manquantes. Retourne au tableau de bord."
        cta="Retour au Dashboard"
        onCta={goDashboard}
      />
    );
  }

  // ── discovery step 2 ──
  if (phase === 'discovery') {
    return (
      <DiscoveryScreen
        surahNumber={prog.currentSurah!}
        surahName={prog.surahName ?? ''}
        memStart={currentAyatNumber}
        memEnd={currentAyatNumber}
        onBack={() => { setPhase('mission'); }}
        onNext={(loadedAyat) => { setDiscoveredAyat(loadedAyat); setPhase('decoupage'); }}
      />
    );
  }

  // ── decoupage step 3 ──
  if (phase === 'decoupage') {
    return (
      <DecoupageScreen
        surahNumber={prog.currentSurah!}
        ayatNumber={currentAyatNumber}
        ayat={discoveredAyat}
        onBack={() => { setPhase('discovery'); }}
        onNext={() => { setPhase('repetition'); }}
      />
    );
  }

  // ── repetition step 4 ──
  if (phase === 'repetition') {
    return (
      <RepetitionScreen
        surahNumber={prog.currentSurah!}
        ayatNumber={currentAyatNumber}
        ayat={discoveredAyat}
        onBack={() => { setPhase('decoupage'); }}
        onNext={() => { setPhase('ayatRecitation'); }}
      />
    );
  }

  // ── ayat recitation step 5 ──
  if (phase === 'ayatRecitation') {
    return (
      <AyatRecitationScreen
        surahNumber={prog.currentSurah!}
        ayat={discoveredAyat}
        ayatNumber={currentAyatNumber}
        totalAyatsToday={totalAyatsToday}
        surahName={prog.surahName ?? ''}
        isLastAyat={isLastAyat}
        onBack={() => { setPhase('repetition'); }}
        onNextAyat={goNextAyat}
        onFinalTest={goFinalTest}
      />
    );
  }

  // ── final test step 6 ──
  if (phase === 'finalTest') {
    return (
      <FinalTestScreen
        surahNumber={prog.currentSurah!}
        allAyats={allTodayAyats}
        currentAyatIndex={currentAyatIndex}
        memStart={memStart}
        memEnd={memEnd}
        surahName={prog.surahName ?? ''}
        userId={userId!}
        ayahPerDay={prog.ayahPerDay ?? 1}
        sessionFinishesSurah={prog.sessionFinishesSurah}
        nextSurah={prog.nextSurah}
        hasZainlyPlus={hasZainlyPlus}
        onBack={() => { setPhase('ayatRecitation'); }}
        onComplete={() => { router.replace('/(app)/done'); }}
        onRestartPassage={restartLearningPassage}
      />
    );
  }

  const ayatLabel = (prog.memStart ?? 1) === (prog.memEnd ?? 1)
    ? `Ayat ${prog.memStart ?? 1}`
    : `Ayats ${prog.memStart ?? 1}–${prog.memEnd ?? 1}`;

  const dur    = estimateDuration(prog.todayAyatCount, prog.dueReviewCount > 0);
  const charge = chargeInfo(prog.todayAyatCount, prog.dueReviewCount);

  const chargeBg    = charge.level === 'intense' ? 'rgba(22,48,38,0.09)'   : charge.level === 'normal'  ? 'rgba(184,150,46,0.11)' : 'rgba(45,106,79,0.08)';
  const chargeBdr   = charge.level === 'intense' ? 'rgba(22,48,38,0.22)'   : charge.level === 'normal'  ? 'rgba(184,150,46,0.30)' : 'rgba(45,106,79,0.22)';
  const chargeTxt   = charge.level === 'intense' ? colors.primary           : charge.level === 'normal'  ? colors.gold             : colors.success;
  const chargeDotBg = chargeTxt;

  function fade(anim: Animated.Value, dy = 16) {
    return {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }],
    };
  }

  const goldLineInterp = goldLineW.interpolate({ inputRange: [0, 1], outputRange: [0, 48] });
  const ctaShineX      = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — mission phase
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe}>

      {/* ── BACKGROUND ───────────────────────────────────────────── */}
      <PremiumBackground />
      {/* dot-grid ornament top-right */}
      <View style={s.dotGrid} pointerEvents="none">
        {Array.from({ length: 18 }).map((_, i) => <View key={i} style={s.gridDot} />)}
      </View>
      {/* pulsing green blob — hero zone depth */}
      <Animated.View pointerEvents="none" style={[s.blobTopRight, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
      {/* thin gold ornament lines */}
      <View style={s.ornLine1}  pointerEvents="none" />
      <View style={s.ornLine2}  pointerEvents="none" />

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* ── HEADER ──────────────────────────────────────────────── */}
        <Animated.View style={[s.header, fade(headerAnim, 22)]}>
          {/* hero inner glow */}
          <Animated.View pointerEvents="none" style={[s.heroGlow, { opacity: heroGlow }]} />
          {/* Arabic watermark */}
          <Text style={s.watermark} accessibilityElementsHidden>م</Text>
          {/* corner dots */}
          <View style={s.heroDotTL} pointerEvents="none" />
          <View style={s.heroDotBR} pointerEvents="none" />

          {/* back button */}
          <Pressable style={s.backBtn} onPress={goBack} hitSlop={12}>
            <Text style={s.backBtnText}>←</Text>
          </Pressable>

          {/* top row */}
          <View style={s.headerTopRow}>
            <View style={s.headerChip}>
              <View style={s.headerChipDot} />
              <Text style={s.headerChipText}>Préparation</Text>
            </View>
          </View>

          <Text style={s.headerTitle}>Session guidée</Text>
          <Text style={s.headerSub}>{prog.surahName ?? '—'} · {ayatLabel}</Text>
          <Animated.View style={[s.goldLine, { width: goldLineInterp }]} />
        </Animated.View>

        {/* ── PROGRESS INDICATOR ──────────────────────────────────── */}
        <Animated.View style={[s.progressSection, fade(progBarAnim)]}>
          <SessionProgressBar
            pct={PROGRESS_PCT}
            label="Étape 1 · Ta mission du jour"
            phase="Préparation"
          />
        </Animated.View>

        {/* ── MISSION CARD ────────────────────────────────────────── */}
        <Animated.View style={[s.missionCardWrap, fade(missionAnim)]}>
          {/* gold glow border behind card */}
          <View style={s.missionGlowBorder} />
          <View style={s.missionCard}>
            {/* top row: eyebrow + charge chip */}
            <View style={s.missionTopRow}>
              <Text style={s.eyebrow}>TA MISSION DU JOUR</Text>
              <View style={[s.chargeChip, { backgroundColor: chargeBg, borderColor: chargeBdr }]}>
                <View style={[s.chargeDot, { backgroundColor: chargeDotBg }]} />
                <Text style={[s.chargeLabel, { color: chargeTxt }]} numberOfLines={1}>{charge.label}</Text>
              </View>
            </View>

            {/* surah name — hero element */}
            <Text style={s.surahName}>{prog.surahName ?? '—'}</Text>
            <Text style={s.ayatRange}>{ayatLabel}</Text>

            <View style={s.missionDivider} />

            {/* mission statement */}
            <Text style={s.missionStatement}>
              Aujourd'hui, Zainly te guide pas à pas.{'\n'}Concentre-toi <Text style={s.missionEmphasis}>seulement</Text> sur cette petite étape.
            </Text>

            <View style={s.missionDivider} />

            {/* mini stats row */}
            <View style={s.miniStats}>
              <View style={s.miniStat}>
                <Text style={s.miniStatValue}>{prog.todayAyatCount}</Text>
                <Text style={s.miniStatLabel}>Nouveaux</Text>
              </View>
              <View style={s.miniStatDivider} />
              <View style={s.miniStat}>
                <Text style={[s.miniStatValue, prog.dueReviewCount === 0 && s.miniStatZero]}>{prog.dueReviewCount}</Text>
                <Text style={s.miniStatLabel}>Révisions</Text>
              </View>
              <View style={s.miniStatDivider} />
              <View style={s.miniStat}>
                <Text style={s.miniStatValue}>{dur}</Text>
                <Text style={s.miniStatLabel}>{prog.dueReviewCount > 0 ? 'avec révisions' : 'estimée'}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        <SectionOrnament />

        {/* ── MÉTHODE ZAINLY 2×2 ──────────────────────────────────── */}
        <View style={s.methodSection}>
          <Text style={s.methodTitle}>Méthode Zainly</Text>
          <Text style={s.methodSub}>Écoute, découpe, répète, puis récite de mémoire.</Text>
          <MethodCards anims={methodAnims} />
        </View>

        <SectionOrnament />

        {/* ── COACH NOTE ──────────────────────────────────────────── */}
        <Animated.View style={[fade(coachAnim)]}>
          <View style={s.coachCard}>
            <View style={s.coachBorder} />
            <View style={s.coachInner}>
              <View style={s.coachTitleRow}>
                <Text style={s.coachQuote}>"</Text>
                <Text style={s.coachEyebrow}>COMMENT ÇA VA SE PASSER ?</Text>
              </View>
              <Text style={s.coachText}>
                Zainly ne te laisse pas seul devant le texte.{'\n'}Tu vas écouter, découper, répéter puis réciter de mémoire.
              </Text>
              <View style={s.coachFooter}>
                <View style={s.coachFooterLine} />
                <Text style={s.coachFooterText}>Une seule action à la fois.</Text>
              </View>
              {/* floating gold dot ornament */}
              <View style={s.coachFloatDot} pointerEvents="none" />
            </View>
          </View>
        </Animated.View>

        {/* bottom padding for sticky CTA */}
        <View style={{ height: 130 }} />

      </ScrollView>

      {/* ── STICKY CTA ──────────────────────────────────────────────── */}
      <View style={[s.stickyBottom, { paddingBottom: Math.max(spacing.xl, insets.bottom + 16) }]}>
        <View style={s.ctaWrap}>
          <Animated.View style={[s.ctaGlow, { opacity: ctaGlow }]} />
          <Pressable
            style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
            onPress={onCta}
          >
            <Text style={s.ctaText}>Commencer doucement →</Text>
            <Animated.View pointerEvents="none" style={[s.ctaShine, { left: ctaShineX }]} />
          </Pressable>
        </View>
      </View>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

  safe:   { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: 0, paddingBottom: 20 },

  // ── background ──
  dotGrid:     { position: 'absolute', top: 55, right: 0, width: SW * 0.44, height: 190, flexDirection: 'row', flexWrap: 'wrap', gap: 14, padding: 10, zIndex: 0 },
  gridDot:     { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(184,150,46,0.18)' },
  blobTopRight:{ position: 'absolute', top: -80, right: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(22,48,38,0.13)', zIndex: 0 },
  ornLine1:    { position: 'absolute', top: 195, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.11)', zIndex: 0 },
  ornLine2:    { position: 'absolute', top: 530, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.09)', zIndex: 0 },

  // ── header (full-width green hero) ──
  header: {
    backgroundColor: colors.primary,
    marginHorizontal: -spacing.lg,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 28,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 0,
    borderColor: 'rgba(184,150,46,0.20)',
  },
  heroGlow: {
    position: 'absolute', top: -60, left: -60, width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(184,150,46,1)', zIndex: 0,
  },
  watermark: {
    position: 'absolute', right: 14, bottom: -8,
    fontSize: 110, color: 'rgba(255,255,255,0.08)', fontWeight: '700', lineHeight: 120,
  },
  heroDotTL: { position: 'absolute', top: 14, left: 14, width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(184,150,46,0.55)' },
  heroDotBR: { position: 'absolute', bottom: 16, right: 80, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(184,150,46,0.38)' },

  backBtn:     { flexDirection: 'row', alignItems: 'center', marginBottom: 14, alignSelf: 'flex-start', zIndex: 2 },
  backBtnText: { fontSize: 22, color: 'rgba(255,255,255,0.75)', fontWeight: '300', lineHeight: 24 },

  headerTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  headerChip:   { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(184,150,46,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.35)' },
  headerChipDot:{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  headerChipText:{ fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 1.2 },

  headerTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', marginBottom: 5, zIndex: 1 },
  headerSub:   { fontSize: 14, color: 'rgba(255,255,255,0.60)', marginBottom: spacing.sm },
  goldLine:    { height: 3, backgroundColor: colors.gold, borderRadius: 2, marginTop: 4 },

  // ── progress section ──
  progressSection: { marginBottom: spacing.md },

  // ── mission card ──
  missionCardWrap: { position: 'relative', marginBottom: spacing.md },
  missionGlowBorder: {
    position: 'absolute', top: 3, left: -3, right: -3, bottom: 0,
    borderRadius: 26, backgroundColor: 'rgba(184,150,46,0.16)', zIndex: 0,
  },
  missionCard: {
    backgroundColor: '#FEFCF5',
    borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.32)',
    paddingHorizontal: spacing.lg, paddingVertical: 20,
    shadowColor: colors.gold, shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    zIndex: 1,
  },
  missionTopRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  eyebrow:          { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: colors.gold, textTransform: 'uppercase' },
  chargeChip:       { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, gap: 5, flexShrink: 0 },
  chargeDot:        { width: 5, height: 5, borderRadius: 2.5, flexShrink: 0 },
  chargeLabel:      { fontSize: 10, fontWeight: '800', flexShrink: 0 },
  surahName:        { fontSize: 28, fontWeight: '900', color: colors.primary, marginBottom: 4 },
  ayatRange:        { fontSize: 15, fontWeight: '600', color: colors.muted, marginBottom: spacing.sm },
  missionDivider:   { height: 1, backgroundColor: 'rgba(184,150,46,0.20)', marginVertical: spacing.sm },
  missionStatement: { fontSize: 14, color: colors.muted, lineHeight: 23 },
  missionEmphasis:  { fontWeight: '700', color: colors.primary, fontStyle: 'italic' },
  miniStats:        { flexDirection: 'row', alignItems: 'center' },
  miniStat:         { flex: 1, alignItems: 'center', paddingVertical: 4 },
  miniStatValue:    { fontSize: 20, fontWeight: '900', color: colors.primary, marginBottom: 2 },
  miniStatZero:     { color: colors.disabled },
  miniStatLabel:    { fontSize: 9, color: colors.muted, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  miniStatDivider:  { width: 1, height: 36, backgroundColor: 'rgba(184,150,46,0.20)' },

  // ── method section ──
  methodSection: { marginBottom: spacing.sm },
  methodTitle:   { fontSize: 18, fontWeight: '800', color: colors.primary, marginBottom: 5 },
  methodSub:     { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: spacing.md },

  // ── coach card ──
  coachCard: {
    flexDirection: 'row',
    backgroundColor: '#FBF6E9',
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.24)',
    marginBottom: spacing.md, overflow: 'hidden',
    shadowColor: colors.gold, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  coachBorder:    { width: 5, backgroundColor: colors.gold, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  coachInner:     { flex: 1, padding: spacing.lg },
  coachTitleRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  coachQuote:     { fontSize: 28, color: colors.gold, lineHeight: 30, marginRight: 5, fontWeight: '700' },
  coachEyebrow:   { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: colors.gold, textTransform: 'uppercase', flex: 1 },
  coachText:      { fontSize: 14, color: colors.primary, lineHeight: 24, fontStyle: 'italic', marginBottom: spacing.sm },
  coachFooter:    { flexDirection: 'row', alignItems: 'center' },
  coachFooterLine:{ width: 16, height: 1, backgroundColor: colors.gold, opacity: 0.55, marginRight: 7 },
  coachFooterText:{ fontSize: 12, color: colors.muted, fontStyle: 'italic', flex: 1, lineHeight: 17 },
  coachFloatDot:  { position: 'absolute', right: 14, top: 14, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(184,150,46,0.45)' },

  // ── sticky CTA ──
  stickyBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: colors.background,
    borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.15)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  ctaWrap: { position: 'relative' },
  ctaGlow: {
    position: 'absolute', top: -10, left: 8, right: 8, bottom: -10,
    borderRadius: 24, backgroundColor: colors.primary, zIndex: 0,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 16, height: 58,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', zIndex: 1,
    shadowColor: colors.primary, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  ctaPressed: { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:    { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  ctaShine:   { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.11)', transform: [{ skewX: '-20deg' }] },
});
