import { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { useProfile }  from '@/hooks/useProfile';
import { usePlan } from '@/hooks/usePlan';
import { useProgress } from '@/hooks/useProgress';
import { useDueReviews } from '@/hooks/useDueReviews';
import { getTodayProgramme } from '@/core/dailyPlan';
import { Screen } from '@/components/ui/Screen';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight } from '@/utils/haptics';

const SW = Dimensions.get('window').width;

// ─── helpers ──────────────────────────────────────────────────────────────────

function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function frenchDate(): string {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function estimatedDuration(ayatCount: number, hasReviews: boolean): string {
  if (ayatCount <= 2)      return hasReviews ? '~8 min' : '~5 min';
  if (ayatCount <= 5)      return hasReviews ? '~12 min' : '~8 min';
  return hasReviews ? '~20 min' : '~15 min';
}

function chargeLabel(ayatCount: number, reviewCount: number): { label: string; level: 'light' | 'normal' | 'intense' } {
  if (reviewCount >= 5 || ayatCount >= 6) return { label: 'Intense',  level: 'intense' };
  if (reviewCount > 0  || ayatCount >= 3) return { label: 'Normale',  level: 'normal'  };
  return                                         { label: 'Légère',   level: 'light'   };
}

// ─── FloatingDots ─────────────────────────────────────────────────────────────

const DOT_CONFIG = [
  { size: 5,  top: 90,  left: SW * 0.08, color: 'rgba(184,150,46,0.35)' },
  { size: 4,  top: 160, left: SW * 0.82, color: 'rgba(184,150,46,0.28)' },
  { size: 6,  top: 280, left: SW * 0.12, color: 'rgba(22,48,38,0.18)'   },
  { size: 3,  top: 370, left: SW * 0.75, color: 'rgba(184,150,46,0.22)' },
  { size: 5,  top: 500, left: SW * 0.88, color: 'rgba(22,48,38,0.14)'   },
  { size: 4,  top: 620, left: SW * 0.06, color: 'rgba(184,150,46,0.30)' },
  { size: 3,  top: 740, left: SW * 0.70, color: 'rgba(184,150,46,0.20)' },
  { size: 5,  top: 860, left: SW * 0.20, color: 'rgba(22,48,38,0.12)'   },
] as const;

function FloatingDots({ anims }: { anims: Animated.Value[] }) {
  return (
    <>
      {DOT_CONFIG.map((d, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: d.top,
              left: d.left,
              width: d.size,
              height: d.size,
              borderRadius: d.size / 2,
              backgroundColor: d.color,
              zIndex: 0,
            },
            {
              opacity: anims[i],
              transform: [{
                translateY: anims[i].interpolate({
                  inputRange: [0.4, 1],
                  outputRange: [6, 0],
                  extrapolate: 'clamp',
                }),
              }],
            },
          ]}
        />
      ))}
    </>
  );
}

// ─── AnimatedProgressBar ──────────────────────────────────────────────────────

function AnimatedProgressBar({ progress }: { progress: number }) {
  const mountedRef  = useRef(true);
  const fillAnim    = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(-1)).current;
  const shimmerLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const pct = Math.min(Math.max(progress, 0), 1);

    const fill = Animated.timing(fillAnim, {
      toValue: pct, duration: 1100, delay: 400,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    fill.start(() => {
      if (!mountedRef.current) return;
      shimmerLoop.current = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1, duration: 1600,
          easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        })
      );
      shimmerLoop.current.start();
    });

    return () => {
      mountedRef.current = false;
      fill.stop();
      shimmerLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const width       = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const shimmerLeft = shimmerAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-40%', '140%'] });

  return (
    <View style={pb.track}>
      <Animated.View style={[pb.fill, { width }]}>
        <Animated.View style={[pb.shimmer, { left: shimmerLeft }]} />
      </Animated.View>
    </View>
  );
}

const pb = StyleSheet.create({
  track:   { height: 10, backgroundColor: 'rgba(184,150,46,0.15)', borderRadius: 8, overflow: 'hidden' },
  fill:    { height: 10, borderRadius: 8, backgroundColor: colors.gold, overflow: 'hidden', position: 'relative' },
  shimmer: {
    position: 'absolute', top: 0, width: '40%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 8,
  },
});

// ─── DashboardSkeleton ────────────────────────────────────────────────────────

function DashboardSkeleton() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const op = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  function Line({ w, h = 11 }: { w: `${number}%` | number; h?: number }) {
    return <View style={[s.skeletonLine, { width: w, height: h }]} />;
  }

  return (
    <View style={s.skeletonWrap}>
      {/* hero card */}
      <Animated.View style={[s.skeletonHero, { opacity: op }]}>
        <Line w="55%" h={13} />
        <Line w="80%" h={10} />
        <Line w="40%" h={10} />
      </Animated.View>
      {/* info card 1 */}
      <Animated.View style={[s.skeletonCard, { opacity: op }]}>
        <Line w="45%" h={10} />
        <Line w="70%" h={10} />
      </Animated.View>
      {/* info card 2 */}
      <Animated.View style={[s.skeletonCard, { opacity: op }]}>
        <Line w="35%" h={10} />
        <Line w="60%" h={10} />
      </Animated.View>
      {/* CTA button shape */}
      <Animated.View style={[s.skeletonCta, { opacity: op }]} />
    </View>
  );
}

// ─── TodayScreen ──────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const user   = useAuthStore((s) => s.user);
  const userId = user?.id;
  const today  = localDateStr();

  const plan     = usePlan(userId);
  const progress = useProgress(userId);
  const reviews  = useDueReviews(userId);
  // TODO Zainly+: replace profile.is_premium with entitlement-backed access from RevenueCat/Supabase.
  const { data: profileData } = useProfile(userId);
  const hasZainlyPlus = profileData?.is_premium === true;

  const isLoading = plan.isLoading || progress.isLoading || reviews.isLoading;
  const hasError  = plan.isError   || progress.isError   || reviews.isError;
  const hasNoPlan = !plan.data || !progress.data;

  // ── animation refs ──
  const mountedRef   = useRef(true);
  const heroAnim     = useRef(new Animated.Value(0)).current;
  const card1Anim    = useRef(new Animated.Value(0)).current;
  const card2Anim    = useRef(new Animated.Value(0)).current;
  const card3Anim    = useRef(new Animated.Value(0)).current;
  const card4Anim    = useRef(new Animated.Value(0)).current;
  const card5Anim    = useRef(new Animated.Value(0)).current;
  const statsAnim    = useRef(new Animated.Value(0)).current;
  const goldLineAnim = useRef(new Animated.Value(0)).current;
  const ctaGlowAnim  = useRef(new Animated.Value(0.25)).current;
  const ctaShineAnim = useRef(new Animated.Value(-1)).current;
  const ctaGlowLoop  = useRef<Animated.CompositeAnimation | null>(null);
  const ctaShineLoop = useRef<Animated.CompositeAnimation | null>(null);
  const isPushing    = useRef(false);
  const haloScale    = useRef(new Animated.Value(1)).current;
  const haloOpacity  = useRef(new Animated.Value(0.14)).current;
  const haloLoop     = useRef<Animated.CompositeAnimation | null>(null);
  const heroGlowAnim = useRef(new Animated.Value(0.08)).current;
  const heroGlowLoop = useRef<Animated.CompositeAnimation | null>(null);
  // 8 floating dot pulse anims (staggered)
  const dotAnims = useRef(
    Array.from({ length: 8 }, () => new Animated.Value(0.4))
  ).current;
  const dotLoops = useRef<Array<Animated.CompositeAnimation | null>>(
    Array.from({ length: 8 }, () => null)
  );

  useEffect(() => {
    mountedRef.current = true;

    // staggered entrance
    const seq = Animated.stagger(100, [
      Animated.timing(heroAnim,  { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card1Anim, { toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card2Anim, { toValue: 1, duration: 430, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card3Anim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card4Anim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(statsAnim, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(card5Anim, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    seq.start();

    // hero gold line grow
    const goldLine = Animated.timing(goldLineAnim, {
      toValue: 1, duration: 900, delay: 350,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    goldLine.start();

    // CTA breathing glow — more visible
    ctaGlowLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaGlowAnim, { toValue: 0.75, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(ctaGlowAnim, { toValue: 0.25, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    ctaGlowLoop.current.start();

    // CTA gold shine sweep
    ctaShineLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaShineAnim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.delay(2200),
        Animated.timing(ctaShineAnim, { toValue: -1, duration: 0, useNativeDriver: false }),
      ])
    );
    ctaShineLoop.current.start();

    // background halo scale + opacity pulse
    haloLoop.current = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(haloScale,   { toValue: 1.08, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(haloOpacity, { toValue: 0.22, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(haloScale,   { toValue: 1.0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(haloOpacity, { toValue: 0.14, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ])
    );
    haloLoop.current.start();

    // hero inner glow pulse
    heroGlowLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(heroGlowAnim, { toValue: 0.18, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(heroGlowAnim, { toValue: 0.08, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    heroGlowLoop.current.start();

    // floating dots — staggered pulse
    dotAnims.forEach((anim, i) => {
      const delay = i * 350;
      dotLoops.current[i] = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1,   duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0.4, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      dotLoops.current[i]!.start();
    });

    return () => {
      mountedRef.current = false;
      seq.stop();
      goldLine.stop();
      ctaGlowLoop.current?.stop();
      ctaShineLoop.current?.stop();
      haloLoop.current?.stop();
      heroGlowLoop.current?.stop();
      dotLoops.current.forEach(l => l?.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fadeStyle(anim: Animated.Value, dy = 16) {
    return {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }],
    };
  }

  // Derive prog before any early return so hooks order is stable
  const prog = useMemo(() => getTodayProgramme({
    plan:               plan.data ?? null,
    progress:           progress.data ?? null,
    dueReviewCount:     reviews.data ?? 0,
    today,
    // Free users are capped at 1 new ayat per day; Zainly+ follows their plan pace.
    effectiveAyahPerDay: hasZainlyPlus ? undefined : 1,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plan.data, progress.data, reviews.data, today, hasZainlyPlus]);

  const progressPct = prog.surahTotalAyats > 0
    ? Math.min(prog.currentAyah / prog.surahTotalAyats, 1)
    : 0;

  function refetchAll() {
    plan.refetch();
    progress.refetch();
    reviews.refetch();
  }

  // ── loading state ──
  if (isLoading) {
    return (
      <SafeAreaView style={s.centered}>
        <DashboardSkeleton />
      </SafeAreaView>
    );
  }

  // ── error state ──
  if (hasError) {
    return (
      <SafeAreaView style={s.centered}>
        <View style={s.stateCard}>
          <EmptyState
            title="Impossible de charger ton programme"
            description="Vérifie ta connexion puis réessaie."
            buttonLabel="Réessayer"
            onPress={refetchAll}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── no plan state ──
  if (hasNoPlan) {
    return (
      <SafeAreaView style={s.centered}>
        <View style={s.stateCard}>
          <EmptyState
            title="Créons ton programme."
            description="Réponds à quelques questions pour que Zainly prépare ton parcours personnalisé."
            buttonLabel="Créer mon programme"
            onPress={() => router.replace('/onboarding')}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── "Zainly prépare la suite" text ──
  const suiteText = (() => {
    if (prog.sessionFinishesSurah && prog.nextSurahName)
      return `Après cette sourate, Zainly te guidera vers ${prog.nextSurahName}.`;
    if (prog.remainingAfterSession > 0)
      return `Après aujourd'hui, il te restera ${prog.remainingAfterSession} ayat${prog.remainingAfterSession > 1 ? 's' : ''} dans ${prog.surahName ?? 'cette sourate'}.`;
    if (!prog.nextSurahName)
      return "Ton ordre actuel arrive à sa fin. Zainly gardera tes révisions organisées.";
    return `Zainly te préparera la prochaine étape avec ${prog.nextSurahName}.`;
  });

  // ── derived display values ──
  const memLabel = (() => {
    if (prog.surahExhausted && prog.nextSurahName) return prog.nextSurahName;
    if (prog.surahName && prog.memStart != null && prog.memEnd != null) {
      return prog.memStart === prog.memEnd
        ? `${prog.surahName} — ayat ${prog.memStart}`
        : `${prog.surahName} — ayats ${prog.memStart} à ${prog.memEnd}`;
    }
    return prog.surahName ?? '—';
  })();

  const coachText = (() => {
    if (prog.dueReviewCount >= 6)
      return "Aujourd'hui, la priorité est la consolidation. Ajouter du nouveau maintenant risquerait de fragiliser ton Hifz.";
    if (prog.dueReviewCount >= 2)
      return "Ta charge est légère aujourd'hui. On révise d'abord, puis tu pourras avancer.";
    if (prog.dueReviewCount === 1)
      return "Avant d'ajouter du nouveau, Zainly protège ce que tu as déjà mémorisé.";
    if (prog.sessionDoneToday)
      return "Tu as terminé ta session du jour. Reviens demain pour continuer avec régularité.";
    return "Aujourd'hui, ton Hifz est à jour. Concentre-toi sur ta nouvelle mémorisation.";
  })();

  const nextStepText = (() => {
    if (prog.surahExhausted) {
      return prog.nextSurahName
        ? `Tu passes bientôt à ${prog.nextSurahName}.`
        : "Ton ordre actuel est terminé. Zainly préparera la suite.";
    }
    if (prog.sessionFinishesSurah && prog.nextSurahName)
      return `Tu peux terminer cette sourate aujourd'hui. Prochaine : ${prog.nextSurahName}.`;
    if (prog.remainingAfterSession > 0)
      return `Il te restera ${prog.remainingAfterSession} ayat${prog.remainingAfterSession > 1 ? 's' : ''} dans ${prog.surahName ?? 'cette sourate'}.`;
    return "Zainly préparera la suite de ton programme.";
  })();

  const durLabel  = estimatedDuration(prog.todayAyatCount, prog.dueReviewCount > 0);
  const charge    = chargeLabel(prog.todayAyatCount, prog.dueReviewCount);
  const goldLineW = goldLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 52] });
  const ctaShineX = ctaShineAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  return (
    <Screen>

      {/* ══ BACKGROUND LAYER ══════════════════════════════════════ */}

      {/* full-height wash zones */}
      <View style={s.washTop}    pointerEvents="none" />
      <View style={s.washMid}    pointerEvents="none" />
      <View style={s.washBot}    pointerEvents="none" />

      {/* dot-grid decorative pattern (top-right quadrant) */}
      <View style={s.dotGrid} pointerEvents="none">
        {Array.from({ length: 20 }).map((_, i) => (
          <View key={i} style={s.gridDot} />
        ))}
      </View>

      {/* large green blob top-right – pulsing halo */}
      <Animated.View
        pointerEvents="none"
        style={[
          s.blobTopRight,
          { transform: [{ scale: haloScale }], opacity: haloOpacity },
        ]}
      />
      {/* large green blob mid-left */}
      <View style={s.blobMidLeft} pointerEvents="none" />
      {/* green blob bottom-right */}
      <View style={s.blobBotRight} pointerEvents="none" />
      {/* gold halo around session card zone */}
      <View style={s.goldHaloSession} pointerEvents="none" />
      {/* gold halo near progress card */}
      <View style={s.goldHaloProgress} pointerEvents="none" />
      {/* thin gold ornament lines */}
      <View style={s.ornamentLine1} pointerEvents="none" />
      <View style={s.ornamentLine2} pointerEvents="none" />
      {/* floating dots */}
      <FloatingDots anims={dotAnims} />

      {/* ══ 1. HERO ═══════════════════════════════════════════════ */}
      <Animated.View style={[s.hero, fadeStyle(heroAnim, 22)]}>
        {/* inner hero glow circle */}
        <Animated.View
          pointerEvents="none"
          style={[s.heroInnerGlow, { opacity: heroGlowAnim }]}
        />
        {/* large Arabic watermark — more visible */}
        <Text style={s.heroWatermark} accessibilityElementsHidden>ب</Text>
        {/* small gold corner dots */}
        <View style={s.heroDotTL} pointerEvents="none" />
        <View style={s.heroDotBR} pointerEvents="none" />

        {/* "Aujourd'hui" chip */}
        <View style={s.heroChip}>
          <View style={s.heroChipDot} />
          <Text style={s.heroChipText}>Aujourd'hui</Text>
        </View>

        <View style={s.heroTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.heroGreeting}>Assalamu alaykoum,</Text>
            <Text style={s.heroTagline}>{"Avance avec\nconstance."}</Text>
          </View>
          {/* Streak badge with glow ring */}
          <View style={s.streakWrap}>
            <View style={s.streakGlowRing} />
            <View style={s.streakBadge}>
              <Text style={s.streakFire}>🔥</Text>
              <Text style={s.streakCount}>{prog.streak}</Text>
              <Text style={s.streakUnit}>jour{prog.streak !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        </View>

        <Text style={s.heroDate}>{frenchDate()}</Text>
        <Animated.View style={[s.heroGoldLine, { width: goldLineW }]} />
      </Animated.View>

      {/* ══ 2. SESSION CARD ══════════════════════════════════════ */}
      <Animated.View style={[fadeStyle(card1Anim), s.sessionCardWrap]}>
        {/* gold glow border behind card */}
        <View style={s.cardGlowBorder} />
        <View style={s.sessionCard}>
          {/* session ready ribbon */}
          <View style={s.sessionRibbon}>
            <View style={s.sessionRibbonDot} />
            <Text style={s.sessionRibbonText}>
              {prog.sessionDoneToday ? 'Session complétée aujourd\'hui' : 'Ton plan du jour est prêt'}
            </Text>
          </View>
          <Text style={s.cardEyebrow}>TA SESSION DU JOUR</Text>
          <View style={s.sessionCardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>
                {prog.dueReviewCount >= 6
                  ? 'Journée consolidation'
                  : prog.dueReviewCount >= 2
                    ? `${prog.dueReviewCount} ayats à consolider`
                    : prog.dueReviewCount === 1
                      ? '1 ayat à consolider'
                      : prog.sessionDoneToday
                        ? 'Session terminée'
                        : 'Prête à commencer'}
              </Text>
              <Text style={s.cardSubtitle}>
                {prog.dueReviewCount >= 6
                  ? 'Zainly recommande de consolider avant d’avancer.'
                  : prog.dueReviewCount > 0
                    ? 'Zainly protège d’abord ce que tu as mémorisé.'
                    : 'Zainly te guide étape par étape.'}
              </Text>
            </View>
            {/* Charge chip with pulse dot */}
            <View style={[
              s.chargeChip,
              charge.level === 'light'   && s.chargeLight,
              charge.level === 'normal'  && s.chargeNormal,
              charge.level === 'intense' && s.chargeIntense,
            ]}>
              <View style={[
                s.chargeDot,
                charge.level === 'light'   && s.chargeDotLight,
                charge.level === 'normal'  && s.chargeDotNormal,
                charge.level === 'intense' && s.chargeDotIntense,
              ]} />
              <Text style={s.chargeChipValue}>{charge.label}</Text>
            </View>
          </View>

          {/* session composition mini-bar */}
          <View style={s.compBar}>
            {prog.dueReviewCount > 0 && (
              <View style={[s.compSegment, s.compSegmentGreen]}>
                <Text style={s.compSegLabel}>RÉVISIONS</Text>
                <Text style={s.compSegValue}>{prog.dueReviewCount}</Text>
              </View>
            )}
            {prog.todayAyatCount > 0 && (
              <View style={[s.compSegment, s.compSegmentGold]}>
                <Text style={s.compSegLabel}>NOUVEAUX</Text>
                <Text style={[s.compSegValue, s.compSegValueGold]}>{prog.todayAyatCount}</Text>
              </View>
            )}
            <View style={[s.compSegment, s.compSegmentLast]}>
              <Text style={s.compSegLabel}>DURÉE</Text>
              <Text style={s.compSegValue}>{durLabel}</Text>
            </View>
          </View>

          <View style={s.sessionDivider} />

          {/* Timeline */}
          <View style={s.timeline}>
            {/* Step 1: Révisions */}
            <View style={s.tlRow}>
              <View style={s.tlLeft}>
                <View style={[
                  s.tlDot,
                  prog.dueReviewCount > 0 ? s.tlDotGold : s.tlDotMuted,
                  prog.dueReviewCount > 0 && s.tlDotActive,
                ]} />
                <View style={s.tlLine} />
              </View>
              <View style={s.tlContent}>
                <Text style={s.tlLabel}>RÉVISIONS</Text>
                <Text style={[s.tlValue, prog.dueReviewCount === 0 && s.tlMuted]}>
                  {prog.dueReviewCount > 0
                    ? `${prog.dueReviewCount} ayat${prog.dueReviewCount > 1 ? 's' : ''} à revoir`
                    : "Aucune révision aujourd'hui"}
                </Text>
              </View>
            </View>

            {/* Step 2: Mémorisation */}
            <View style={s.tlRow}>
              <View style={s.tlLeft}>
                <View style={[
                  s.tlDot,
                  prog.sessionDoneToday ? s.tlDotMuted : s.tlDotGreen,
                  !prog.sessionDoneToday && s.tlDotActive,
                ]} />
                <View style={s.tlLine} />
              </View>
              <View style={s.tlContent}>
                <Text style={s.tlLabel}>NOUVELLE MÉMORISATION</Text>
                {prog.sessionDoneToday ? (
                  <Text style={[s.tlValue, s.tlMuted]}>Session du jour terminée</Text>
                ) : prog.surahExhausted ? (
                  <Text style={s.tlValue}>
                    {prog.nextSurahName ? `Passage à ${prog.nextSurahName}` : 'Sourate terminée'}
                  </Text>
                ) : (
                  <Text style={s.tlValue}>{memLabel}</Text>
                )}
              </View>
            </View>

            {/* Step 3: Durée */}
            <View style={[s.tlRow, s.tlRowLast]}>
              <View style={s.tlLeft}>
                <View style={[s.tlDot, prog.sessionDoneToday ? s.tlDotMuted : s.tlDotBorder]} />
              </View>
              <View style={s.tlContent}>
                <Text style={s.tlLabel}>DURÉE ESTIMÉE</Text>
                <Text style={[s.tlValue, prog.sessionDoneToday && s.tlMuted]}>
                  {prog.sessionDoneToday ? '—' : durLabel}
                </Text>
              </View>
            </View>
          </View>

          <View style={s.sessionDivider} />

          {/* CTA — four cases:
               A) 0 due → new session (or done-today)
               B) 1 due → review (also allowed after sessionDoneToday)
               C) 2–5 due → review
               D) 6+ due → review (consolidation day) */}
          {prog.dueReviewCount === 0 && prog.sessionDoneToday ? (
            <View style={s.ctaDone}>
              <Text style={s.ctaDoneText}>Session terminée aujourd'hui ✓</Text>
            </View>
          ) : (
            <View style={s.ctaWrap}>
              <Animated.View style={[s.ctaGlow, { opacity: ctaGlowAnim }]} />
              <Pressable
                style={({ pressed }) => [s.cta, pressed && s.ctaPressed]}
                onPress={() => {
                  if (isPushing.current) return;
                  isPushing.current = true;
                  hapticLight();
                  if (prog.dueReviewCount > 0) {
                    router.push('/(app)/revision');
                  } else {
                    router.push('/(app)/session');
                  }
                  setTimeout(() => { isPushing.current = false; }, 1000);
                }}
              >
                <Text style={s.ctaText}>
                  {prog.dueReviewCount >= 6
                    ? 'Consolider mon Hifz →'
                    : prog.dueReviewCount >= 2
                      ? 'Commencer mes révisions →'
                      : prog.dueReviewCount === 1
                        ? 'Réviser maintenant →'
                        : 'Commencer la session →'}
                </Text>
                <Animated.View
                  pointerEvents="none"
                  style={[s.ctaShine, { left: ctaShineX }]}
                />
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>

      {/* ══ 3. SURAH PROGRESS CARD ════════════════════════════════ */}
      {!prog.surahExhausted && prog.currentSurah != null && prog.surahTotalAyats > 0 && (
        <Animated.View style={fadeStyle(card2Anim)}>
          <View style={s.progressCard}>
            <Text style={s.cardEyebrow}>DANS CETTE SOURATE</Text>
            <View style={s.progressCardHeader}>
              <Text style={s.cardTitle}>{prog.surahName ?? '—'}</Text>
              <View style={s.pctBadge}>
                <Text style={s.pctBadgeText}>{Math.round(progressPct * 100)}%</Text>
              </View>
            </View>
            <Text style={s.progressPath}>Chemin dans la sourate</Text>
            <View style={s.barWrap}>
              <AnimatedProgressBar progress={progressPct} />
            </View>
            {/* milestone dots under bar */}
            <View style={s.milestoneRow}>
              {[0.25, 0.5, 0.75, 1].map((m) => (
                <View
                  key={m}
                  style={[
                    s.milestoneDot,
                    progressPct >= m && s.milestoneDotActive,
                  ]}
                />
              ))}
            </View>
            <View style={s.progressFooter}>
              <Text style={s.progressFraction}>
                Prochaine session : ayat {prog.memStart ?? prog.currentAyah + 1}
              </Text>
              <Text style={s.progressHelper}>
                {prog.sessionFinishesSurah
                  ? `Tu peux terminer ${prog.surahName ?? 'cette sourate'} aujourd'hui.`
                  : `Il restera ${prog.remainingAfterSession} ayat${prog.remainingAfterSession > 1 ? 's' : ''} après ta session.`
                }
              </Text>
            </View>
          </View>
        </Animated.View>
      )}

      {/* section connector strip */}
      <View style={s.sectionConnector} pointerEvents="none" />

      {/* ══ 4. COACH CARD ════════════════════════════════════════ */}
      <Animated.View style={fadeStyle(card3Anim)}>
        <View style={s.coachCard}>
          <View style={s.coachBorder} />
          <View style={s.coachInner}>
            <View style={s.coachTitleRow}>
              <Text style={s.coachQuoteMark}>“</Text>
              <Text style={s.cardEyebrow}>POURQUOI AUJOURD'HUI ?</Text>
            </View>
            <Text style={s.coachText}>{coachText}</Text>
            <View style={s.coachFooterRow}>
              <View style={s.coachFooterLine} />
              <Text style={s.coachFooterText}>Zainly ajuste ton effort pour protéger ta régularité.</Text>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* gold ornament between coach and stats */}
      <View style={s.sectionOrnament} pointerEvents="none">
        <View style={s.ornDot} />
        <View style={s.ornLineShort} />
        <View style={s.ornDot} />
        <View style={s.ornLineShort} />
        <View style={s.ornDot} />
      </View>

      {/* ══ 5. STATS ROW ════════════════════════════════════════ */}
      {/* gold connector line behind stats */}
      <View style={s.statsConnector} pointerEvents="none" />
      <Animated.View style={[s.statsRow, fadeStyle(statsAnim)]}>
        <View style={s.statCard}>
          <View style={s.statTopDot} />
          <Text style={s.statValue}>{prog.totalMemorized}</Text>
          <Text style={s.statLabel}>{"Ayats\nmémorisés"}</Text>
        </View>
        <View style={s.statCard}>
          <View style={s.statTopDot} />
          <Text style={s.statValue}>{prog.streak}</Text>
          <Text style={s.statLabel}>{"Jours\nde série"}</Text>
        </View>
        <View style={[s.statCard, s.statCardLast]}>
          <View style={s.statTopDot} />
          <Text style={s.statValue}>{prog.ayahPerDay}</Text>
          <Text style={s.statLabel}>{"Ayats\npar jour"}</Text>
        </View>
      </Animated.View>

      {/* ══ 6. NEXT STEP CARD ════════════════════════════════════ */}
      <Animated.View style={fadeStyle(card4Anim)}>
        <View style={s.nextCard}>
          <View style={s.nextCardAccent} />
          <View style={s.nextCardBody}>
            <View style={s.nextChip}>
              <View style={s.nextChipDot} />
              <Text style={s.nextChipText}>Après ta session</Text>
            </View>
            <Text style={s.nextText}>{nextStepText}</Text>
          </View>
        </View>
      </Animated.View>

      {/* ══ 7. ZAINLY PRÉPARE LA SUITE ═══════════════════════════ */}
      <Animated.View style={fadeStyle(card5Anim)}>
        <View style={s.suiteCard}>
          <View style={s.suiteHeader}>
            <View style={s.suiteDot} />
            <Text style={s.suiteEyebrow}>ZAINLY PRÉPARE LA SUITE</Text>
          </View>
          <Text style={s.suiteText}>{suiteText()}</Text>
          <View style={s.suiteChips}>
            <View style={s.suiteChip}>
              <Text style={s.suiteChipText}>✓ Révisions suivies</Text>
            </View>
            <View style={s.suiteChip}>
              <Text style={s.suiteChipText}>✓ Rythme adapté</Text>
            </View>
          </View>
        </View>
      </Animated.View>

    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

  // ── states ──
  centered: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg,
  },
  skeletonWrap: { width: '100%', gap: 14, paddingHorizontal: 4 },
  skeletonHero: { height: 130, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: 10 },
  skeletonCard: { height: 72, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 8 },
  skeletonCta:  { height: 58, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  skeletonLine: { borderRadius: 6, backgroundColor: 'rgba(184,150,46,0.18)' },
  stateCard: {
    width: '100%', backgroundColor: colors.surface,
    borderRadius: 22, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
    shadowColor: colors.primary, shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },

  // ── background wash zones ──
  washTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 320,
    backgroundColor: 'rgba(22,48,38,0.055)', zIndex: 0,
  },
  washMid: {
    position: 'absolute', top: 280, left: 0, right: 0, height: 300,
    backgroundColor: 'rgba(184,150,46,0.045)', zIndex: 0,
  },
  washBot: {
    position: 'absolute', top: 700, left: 0, right: 0, height: 400,
    backgroundColor: 'rgba(22,48,38,0.04)', zIndex: 0,
  },
  // ── dot-grid pattern ──
  dotGrid: {
    position: 'absolute', top: 60, right: 0,
    width: SW * 0.45, height: 200,
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 14, padding: 10, zIndex: 0,
  },
  gridDot: {
    width: 3, height: 3, borderRadius: 1.5,
    backgroundColor: 'rgba(184,150,46,0.18)',
  },
  // ── section connectors ──
  sectionConnector: {
    height: 1, marginHorizontal: spacing.lg, marginBottom: spacing.md,
    backgroundColor: 'rgba(184,150,46,0.18)',
  },
  statsConnector: {
    position: 'absolute', height: 1,
    left: spacing.lg * 2, right: spacing.lg * 2,
    backgroundColor: 'rgba(184,150,46,0.25)', zIndex: 0,
  },
  // ── background blobs & ornaments ──
  blobTopRight: {
    position: 'absolute', top: -80, right: -90,
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(22,48,38,0.13)',
    zIndex: 0,
  },
  blobMidLeft: {
    position: 'absolute', top: 340, left: -110,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: 'rgba(22,48,38,0.09)',
    zIndex: 0,
  },
  blobBotRight: {
    position: 'absolute', top: 720, right: -80,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(22,48,38,0.07)',
    zIndex: 0,
  },
  goldHaloSession: {
    position: 'absolute', top: 195, left: -30,
    width: SW + 60, height: 240, borderRadius: 120,
    backgroundColor: 'rgba(184,150,46,0.07)',
    zIndex: 0,
  },
  goldHaloProgress: {
    position: 'absolute', top: 530, right: -40,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(184,150,46,0.06)',
    zIndex: 0,
  },
  ornamentLine1: {
    position: 'absolute', top: 185, left: spacing.lg, right: spacing.lg,
    height: 1, backgroundColor: 'rgba(184,150,46,0.12)', zIndex: 0,
  },
  ornamentLine2: {
    position: 'absolute', top: 510, left: spacing.lg, right: spacing.lg,
    height: 1, backgroundColor: 'rgba(184,150,46,0.10)', zIndex: 0,
  },
  sessionCardWrap: { marginTop: -20 },
  cardGlowBorder: {
    position: 'absolute',
    top: 3, left: -3, right: -3, bottom: 0,
    borderRadius: 24,
    backgroundColor: 'rgba(184,150,46,0.18)',
    zIndex: 0,
  },

  // ── hero ──
  hero: {
    backgroundColor: colors.primary,
    // full-bleed: break out of Screen's paddingHorizontal (spacing.lg = 24)
    // and eliminate the Screen's paddingTop gap above hero
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.md,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 30,
    marginBottom: 0,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22,
    shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
    borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 0,
    borderColor: 'rgba(184,150,46,0.22)',
  },
  heroInnerGlow: {
    position: 'absolute', top: -60, left: -60,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(184,150,46,1)',
    zIndex: 0,
  },
  heroWatermark: {
    position: 'absolute', right: 10, bottom: -10,
    fontSize: 120, color: 'rgba(255,255,255,0.09)',
    fontWeight: '700', lineHeight: 130,
  },
  heroDotTL: {
    position: 'absolute', top: 14, left: 14,
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: 'rgba(184,150,46,0.55)',
  },
  heroDotBR: {
    position: 'absolute', bottom: 14, right: 90,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(184,150,46,0.40)',
  },
  heroChip: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(184,150,46,0.18)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.35)',
    marginBottom: 12,
  },
  heroChipDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: colors.gold, marginRight: 5,
  },
  heroChipText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 0.8 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  heroGreeting: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 5, fontWeight: '500' },
  heroTagline: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', lineHeight: 32 },
  streakWrap: { position: 'relative', marginLeft: spacing.sm },
  streakGlowRing: {
    position: 'absolute', top: -5, left: -5, right: -5, bottom: -5,
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.45)',
  },
  streakBadge: {
    backgroundColor: 'rgba(184,150,46,0.22)',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.45)',
    alignItems: 'center', minWidth: 62,
  },
  streakFire:  { fontSize: 18, lineHeight: 22 },
  streakCount: { fontSize: 22, fontWeight: '900', color: colors.gold, lineHeight: 26 },
  streakUnit:  { fontSize: 10, color: 'rgba(184,150,46,0.85)', fontWeight: '700', letterSpacing: 0.4 },
  heroDate: {
    fontSize: 12, color: 'rgba(255,255,255,0.4)',
    textTransform: 'capitalize', marginBottom: spacing.sm,
  },
  heroGoldLine: { height: 3, backgroundColor: colors.gold, borderRadius: 2, marginTop: 4 },

  // ── shared card base ──
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.08,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  progressCard: {
    backgroundColor: '#FEFCF5',
    borderRadius: 22, borderWidth: 1, borderColor: 'rgba(184,150,46,0.25)',
    padding: spacing.lg, marginBottom: spacing.md,
    shadowColor: colors.gold, shadowOpacity: 0.10,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.35)',
    paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 14,
    marginBottom: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.10,
    shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 5,
    zIndex: 1,
  },
  cardEyebrow: {
    fontSize: 9, fontWeight: '700', letterSpacing: 2,
    color: colors.gold, marginBottom: 5, textTransform: 'uppercase',
  },
  cardTitle:    { fontSize: 20, fontWeight: '700', color: colors.primary, marginBottom: 3 },
  cardSubtitle: { fontSize: 13, color: colors.muted, lineHeight: 19 },

  // ── session ribbon ──
  sessionRibbon: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(22,48,38,0.06)',
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3,
    marginBottom: 8,
    alignSelf: 'flex-start',
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.12)',
  },
  sessionRibbonDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary, marginRight: 6, opacity: 0.7,
  },
  sessionRibbonText: { fontSize: 11, fontWeight: '600', color: colors.primary, opacity: 0.8 },

  // ── session card header ──
  sessionCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  chargeChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5,
    marginLeft: spacing.sm, borderWidth: 1, gap: 5,
  },
  chargeDot: { width: 5, height: 5, borderRadius: 2.5 },
  chargeDotLight:   { backgroundColor: colors.success  },
  chargeDotNormal:  { backgroundColor: colors.gold     },
  chargeDotIntense: { backgroundColor: colors.primary  },
  chargeLight:   { backgroundColor: 'rgba(45,106,79,0.08)',  borderColor: 'rgba(45,106,79,0.25)'  },
  chargeNormal:  { backgroundColor: 'rgba(184,150,46,0.10)', borderColor: 'rgba(184,150,46,0.30)' },
  chargeIntense: { backgroundColor: 'rgba(22,48,38,0.08)',   borderColor: 'rgba(22,48,38,0.22)'   },
  chargeChipLabel: { fontSize: 10, fontWeight: '600', color: colors.muted },
  chargeChipValue: { fontSize: 10, fontWeight: '800', color: colors.primary },

  // ── session composition mini-bar ──
  compBar: {
    flexDirection: 'row', marginBottom: 4,
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.border,
  },
  compSegment: {
    flex: 1, alignItems: 'center', paddingVertical: 5,
    backgroundColor: colors.surfaceMuted,
    borderRightWidth: 1, borderRightColor: colors.border,
  },
  compSegmentGreen: { backgroundColor: 'rgba(22,48,38,0.06)' },
  compSegmentGold:  { backgroundColor: 'rgba(184,150,46,0.09)' },
  compSegmentLast:  { borderRightWidth: 0 },
  compSegLabel: { fontSize: 8, fontWeight: '700', letterSpacing: 1.1, color: colors.muted, textTransform: 'uppercase', marginBottom: 1 },
  compSegValue: { fontSize: 12, fontWeight: '800', color: colors.primary },
  compSegValueGold: { color: colors.gold },

  sessionDivider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },

  // ── timeline ──
  timeline: { paddingLeft: 2 },
  tlRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 0 },
  tlRowLast: { marginBottom: 0 },
  tlLeft: { width: 24, alignItems: 'center', paddingTop: 3 },
  tlDot: { width: 12, height: 12, borderRadius: 6, zIndex: 1 },
  tlDotGold:   { backgroundColor: colors.gold },
  tlDotGreen:  { backgroundColor: colors.primary },
  tlDotMuted:  { backgroundColor: colors.disabled },
  tlDotBorder: { backgroundColor: colors.border, borderWidth: 2, borderColor: colors.gold },
  tlDotActive: {
    shadowColor: colors.gold, shadowOpacity: 0.6,
    shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 3,
  },
  tlLine: {
    width: 2, flex: 1, backgroundColor: 'rgba(184,150,46,0.2)',
    marginTop: 2, marginBottom: 0, minHeight: 22,
  },
  tlContent: { flex: 1, paddingLeft: spacing.sm, paddingBottom: 10 },
  tlLabel: {
    fontSize: 9, fontWeight: '700', letterSpacing: 1.6,
    color: colors.muted, textTransform: 'uppercase', marginBottom: 2,
  },
  tlValue: { fontSize: 14, fontWeight: '600', color: colors.primary, lineHeight: 20 },
  tlMuted: { color: colors.muted },

  // ── CTA ──
  ctaWrap: { position: 'relative', marginTop: 0 },
  ctaGlow: {
    position: 'absolute', top: -10, left: 6, right: 6, bottom: -10,
    borderRadius: 24,
    backgroundColor: colors.primary,
    zIndex: 0,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 1,
    shadowColor: colors.primary, shadowOpacity: 0.45,
    shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  ctaShine: {
    position: 'absolute', top: 0, width: '35%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    transform: [{ skewX: '-20deg' }],
  },
  ctaPressed: { opacity: 0.80, transform: [{ scale: 0.975 }] },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  ctaDone: {
    borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: colors.border,
  },
  ctaDoneText: { fontSize: 15, fontWeight: '600', color: colors.muted },

  // ── surah progress ──
  progressCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  pctBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.4)',
    shadowColor: colors.gold, shadowOpacity: 0.2, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  pctBadgeText: { fontSize: 14, fontWeight: '800', color: colors.gold },
  progressPath: {
    fontSize: 10, color: colors.muted, letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: spacing.sm,
  },
  barWrap: { marginBottom: spacing.sm },
  milestoneRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: spacing.sm },
  milestoneDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.border,
  },
  milestoneDotActive: { backgroundColor: colors.gold },
  progressFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressFraction: { fontSize: 13, fontWeight: '700', color: colors.primary },
  progressHelper:   { fontSize: 12, color: colors.muted, lineHeight: 17, flex: 1, textAlign: 'right', marginLeft: 8 },

  // ── coach card ──
  coachFooterRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  coachFooterLine: { width: 18, height: 1, backgroundColor: colors.gold, opacity: 0.6, marginRight: 8 },
  coachFooterText: { fontSize: 11, color: colors.muted, fontStyle: 'italic', flex: 1, lineHeight: 16 },

  coachCard: {
    flexDirection: 'row',
    backgroundColor: '#FBF6E9',
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.25)',
    marginBottom: spacing.md, overflow: 'hidden',
    shadowColor: colors.gold, shadowOpacity: 0.12,
    shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  coachBorder: { width: 5, backgroundColor: colors.gold, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  coachInner:  { flex: 1, padding: spacing.lg },
  coachTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  coachQuoteMark: { fontSize: 26, color: colors.gold, lineHeight: 28, marginRight: 4, fontWeight: '700' },
  coachText:   { fontSize: 14, color: colors.primary, lineHeight: 24, fontStyle: 'italic' },
  coachFooterDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: colors.gold, marginTop: spacing.sm, opacity: 0.6,
  },

  // ── Zainly suite card ──
  suiteCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 22, borderWidth: 1, borderColor: 'rgba(22,48,38,0.12)',
    padding: spacing.lg, marginBottom: spacing.lg,
    shadowColor: colors.primary, shadowOpacity: 0.06,
    shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  suiteHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  suiteDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.gold, marginRight: 7,
  },
  suiteEyebrow: {
    fontSize: 9, fontWeight: '700', letterSpacing: 2,
    color: colors.gold, textTransform: 'uppercase',
  },
  suiteText: { fontSize: 14, color: colors.primary, lineHeight: 22, marginBottom: spacing.md },
  suiteChips: { flexDirection: 'row', gap: 8 },
  suiteChip: {
    backgroundColor: 'rgba(22,48,38,0.07)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(22,48,38,0.14)',
  },
  suiteChipText: { fontSize: 11, fontWeight: '600', color: colors.primarySoft },
  // section ornament
  sectionOrnament: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', marginBottom: spacing.md,
    gap: 8,
  },
  ornDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(184,150,46,0.45)' },
  ornLineShort: { width: 28, height: 1, backgroundColor: 'rgba(184,150,46,0.3)' },

  // ── stats row ──
  statsRow: {
    flexDirection: 'row', gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1, backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: 'rgba(184,150,46,0.22)',
    padding: spacing.md, alignItems: 'center',
    shadowColor: colors.gold, shadowOpacity: 0.12,
    shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  statCardLast: {},
  statTopDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.gold, marginBottom: spacing.sm,
    opacity: 0.75,
  },
  statValue: { fontSize: 24, fontWeight: '900', color: colors.primary, marginBottom: 3 },
  statLabel: { fontSize: 10, color: colors.muted, fontWeight: '600', letterSpacing: 0.3, textAlign: 'center', lineHeight: 14 },

  // ── next step card ──
  nextCard: {
    flexDirection: 'row', alignItems: 'stretch',
    backgroundColor: colors.goldSoft,
    borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.30)',
    marginBottom: spacing.md, overflow: 'hidden',
    shadowColor: colors.gold, shadowOpacity: 0.14,
    shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  nextCardAccent: {
    width: 5, backgroundColor: colors.gold,
    borderTopLeftRadius: 22, borderBottomLeftRadius: 22,
  },
  nextCardBody: { flex: 1, padding: spacing.lg },
  nextChip: {
    flexDirection: 'row', alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(184,150,46,0.15)',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.3)',
    marginBottom: spacing.sm,
  },
  nextChipDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: colors.gold, marginRight: 5,
  },
  nextChipText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 0.8 },
  nextText: { fontSize: 14, color: colors.primary, lineHeight: 22 },
});
