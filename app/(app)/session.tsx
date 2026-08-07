// ─── Session · Steps 1–2 — Ta mission du jour / Découverte ─────────────────
// Step 1: mission overview. Step 2: ayat discovery.
// No DB writes. No review item creation.
// Reads only from usePlan / useProgress / useDueReviews via getTodayProgramme.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useNavigation } from 'expo-router';

import { PremiumBackground } from '@/components/PremiumBackground';
import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess } from '@/utils/haptics';
import { getQuranAyahRange } from '@/core/quranContent';
import type { QuranAyahContent } from '@/core/quranContent';
import { usePassageAudio } from '@/hooks/usePassageAudio';
import { useQueryClient }    from '@tanstack/react-query';
import { useAuthStore }      from '@/store/authStore';
import { useZainlyPlusAccess } from '@/hooks/useZainlyPlusAccess';
import { usePlan }           from '@/hooks/usePlan';
import { useProgress }       from '@/hooks/useProgress';
import { useDueReviews }     from '@/hooks/useDueReviews';
import { useLocalDate, localDateStr as localDateStrPure } from '@/hooks/useLocalDate';
import { getTodayProgramme } from '@/core/dailyPlan';
import { chunkAyat, chunkTranslit } from '@/core/sessionChunking';
import { estimateDuration, chargeInfo } from '@/core/sessionWorkload';
import { AyatAudioControl } from '@/components/AyatAudioControl';
import { SessionProgressBar } from '@/components/SessionProgressBar';
import { DiscoveryScreen } from '@/components/session/DiscoveryScreen';
import { DecoupageScreen } from '@/components/session/DecoupageScreen';
import { completeSession }               from '@/db/progress';
import { createReviewItemsForAyatRange } from '@/db/reviewItems';
import { useSessionResultStore }         from '@/store/sessionResultStore';

// ─── constants ────────────────────────────────────────────────────────────────

const SW = Dimensions.get('window').width;
const PROGRESS_PCT           = 0.13; // Step 1 anchors at ~13%
const REPETITION_PROGRESS_PCT  = 0.60; // Step 4 anchors at ~60%
const RECITATION_PROGRESS_PCT  = 0.86; // Step 5 anchors at ~86%
const FINAL_TEST_PROGRESS_PCT  = 0.96; // Step 6 anchors at ~96%

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

// ─── Step 4 · Répétition guidée ───────────────────────────────────────────────

const MIN_REPS = 3;

type RepetitionScreenProps = {
  surahNumber: number;
  ayatNumber: number;
  ayat: QuranAyahContent | null;
  onBack: () => void;
  onNext: () => void;
};

function RepetitionScreen({ surahNumber, ayatNumber, ayat, onBack, onNext }: RepetitionScreenProps) {
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);

  // ── chunks ──
  const chunks = useMemo(() => {
    if (!ayat?.arabic) return [];
    return chunkAyat(ayat.arabic);
  }, [ayat?.arabic]);

  const translitChunks = useMemo(() => {
    if (!ayat?.transliteration || chunks.length === 0) return null;
    return chunkTranslit(ayat.transliteration, chunks);
  }, [ayat?.transliteration, chunks]);

  const total = chunks.length;

  // ── state ──
  const [focusIdx,      setFocusIdx]      = useState(0);
  const [repeatCounts,  setRepeatCounts]  = useState<number[]>(() => Array(Math.max(total, 1)).fill(0));
  const [unlockedCount, setUnlockedCount] = useState(1); // how many chunks are reachable

  // guards
  const isTransitioning  = useRef(false);
  const isCooldown       = useRef(false);
  const [cooldownActive, setCooldownActive] = useState(false); // drives UI only

  // derived
  const repCount    = repeatCounts[focusIdx] ?? 0;
  const isAnchored  = repCount >= MIN_REPS;
  const allAnchored = total > 0 && repeatCounts.slice(0, total).every(c => c >= MIN_REPS);
  const isFinalChunk = focusIdx === total - 1;
  const isAtFrontier = focusIdx === unlockedCount - 1;

  // ── animation refs ──
  const mountAnim     = useRef(new Animated.Value(0)).current;
  const cardAnim      = useRef(new Animated.Value(0)).current;
  const repAreaAnim   = useRef(new Animated.Value(0)).current;
  const guideAnim     = useRef(new Animated.Value(0)).current;
  const ctaShine      = useRef(new Animated.Value(-1)).current;
  const ctaShineLoop  = useRef<Animated.CompositeAnimation | null>(null);
  const activeGlow    = useRef(new Animated.Value(0.5)).current;
  const activeGlowLoop= useRef<Animated.CompositeAnimation | null>(null);
  // per-chunk slide/fade
  const focusSlide    = useRef(new Animated.Value(0)).current;
  const focusOpacity  = useRef(new Animated.Value(1)).current;
  // pill unlock anims
  const pillAnims     = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;
  // repeat button cooldown scale
  const repBtnScale   = useRef(new Animated.Value(1)).current;
  // single pop anim for the newest filled pearl
  const pearlPopAnim  = useRef(new Animated.Value(1)).current;

  // ── screen entrance ──
  useEffect(() => {
    mountedRef.current = true;

    Animated.stagger(70, [
      Animated.timing(mountAnim,   { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim,    { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(repAreaAnim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(guideAnim,   { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // pill 0 unlocked
    pillAnims[0].setValue(1);

    activeGlowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(activeGlow, { toValue: 1.0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(activeGlow, { toValue: 0.5, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    activeGlowLoop.current.start();

    return () => {
      mountedRef.current = false;
      activeGlowLoop.current?.stop();
      ctaShineLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CTA shine when all anchored ──
  useEffect(() => {
    if (!allAnchored) return;
    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2600),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();
    return () => ctaShineLoop.current?.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnchored]);

  // ── chunk transition ──
  const navigateTo = useCallback((targetIdx: number, direction: 1 | -1) => {
    if (isTransitioning.current) return;
    if (targetIdx < 0 || targetIdx >= total) return;
    if (targetIdx === focusIdx) return;
    isTransitioning.current = true;

    const outSlide = direction === 1 ? -22 : 22;
    const inSlide  = direction === 1 ?  26 : -26;

    Animated.parallel([
      Animated.timing(focusOpacity, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(focusSlide,   { toValue: outSlide, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) { isTransitioning.current = false; return; }
      setFocusIdx(targetIdx);
      focusSlide.setValue(inSlide);
      focusOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(focusOpacity, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(focusSlide,   { toValue: 0, duration: 270, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => { isTransitioning.current = false; });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, total, repeatCounts]);

  // ── pill tap ──
  const handlePillPress = useCallback((i: number) => {
    if (i >= unlockedCount) return;
    if (i === focusIdx) return;
    hapticSelection();
    navigateTo(i, i > focusIdx ? 1 : -1);
  }, [focusIdx, unlockedCount, navigateTo]);

  // ── repeat tap ──
  const handleRepeat = useCallback(() => {
    if (isCooldown.current) return;
    const cur = repeatCounts[focusIdx] ?? 0;
    if (cur >= MIN_REPS) return; // already anchored, no-op on rep button

    hapticSelection();
    isCooldown.current = true;
    setCooldownActive(true);

    const nextRep = cur + 1;
    setRepeatCounts(prev => {
      const next = [...prev];
      next[focusIdx] = nextRep;
      return next;
    });

    // pop the newly filled pearl
    pearlPopAnim.setValue(0.5);
    Animated.spring(pearlPopAnim, {
      toValue: 1, useNativeDriver: true,
      damping: 12, stiffness: 220,
    }).start();

    // button micro press
    Animated.sequence([
      Animated.timing(repBtnScale, { toValue: 0.95, duration: 90, useNativeDriver: true }),
      Animated.timing(repBtnScale, { toValue: 1.00, duration: 130, useNativeDriver: true }),
    ]).start();

    // if this fills the last pearl → anchored
    if (nextRep >= MIN_REPS) {
      hapticMedium();
    }

    // anti-spam cooldown 750ms
    setTimeout(() => {
      if (!mountedRef.current) return;
      isCooldown.current = false;
      setCooldownActive(false);
    }, 750);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, repeatCounts]);

  // ── CTA press ──
  const handleCta = useCallback(() => {
    if (allAnchored) { hapticMedium(); onNext(); return; }
    if (isTransitioning.current) return;
    hapticSelection();

    if (!isAtFrontier) {
      // reviewing: jump to frontier
      navigateTo(unlockedCount - 1, 1);
      return;
    }

    if (!isAnchored) return; // must finish current chunk first

    // advance to next chunk
    const nextIdx = focusIdx + 1;
    if (nextIdx >= total) return;
    const newUnlocked = nextIdx + 1;
    setUnlockedCount(prev => Math.max(prev, newUnlocked));
    setRepeatCounts(prev => {
      if (prev.length > nextIdx) return prev;
      const next = [...prev];
      while (next.length <= nextIdx) next.push(0);
      return next;
    });
    if (nextIdx < 12) {
      pillAnims[nextIdx].setValue(0);
      Animated.timing(pillAnims[nextIdx], { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    navigateTo(nextIdx, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, total, allAnchored, isAnchored, isAtFrontier, unlockedCount, onNext, navigateTo]);

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  // ── CTA label ──
  const ctaLabel = allAnchored
    ? 'Continuer vers le rappel avec aide →'
    : !isAtFrontier
      ? 'Reprendre là où j\'étais →'
      : !isAnchored
        ? '' // hidden — rep button is primary action
        : isFinalChunk
          ? 'Continuer vers le rappel avec aide →'
          : 'Passer au morceau suivant →';

  // ── guide message ──
  const guideMsg = allAnchored
    ? 'Parfait. Tous les morceaux sont ancrés.'
    : repCount === 0
      ? 'Répète doucement. Ne cherche pas la vitesse.'
      : repCount === 1
        ? 'Encore. Le rythme commence à rentrer.'
        : repCount === 2
          ? 'Une dernière fois pour ancrer ce morceau.'
          : 'Bien. Ce morceau est prêt pour le rappel.';

  // ── active chunk data ──
  const activeChunk  = chunks[focusIdx] ?? '';
  const activeTChunk = translitChunks?.[focusIdx] ?? null;
  const showFullTranslitFallback = !translitChunks && !!ayat?.transliteration;

  return (
    <SafeAreaView style={rep.safe}>
      <PremiumBackground />
      <View style={rep.halo}    pointerEvents="none" />
      <View style={rep.ornLine} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={rep.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── HEADER ── */}
        <Animated.View style={[rep.header, {
          opacity: mountAnim,
          transform: [{ translateY: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Pressable style={rep.backBtn} onPress={() => { hapticLight(); onBack(); }} hitSlop={12}>
            <Text style={rep.backBtnText}>←</Text>
          </Pressable>
          <View style={rep.headerChip}>
            <View style={rep.headerChipDot} />
            <Text style={rep.headerChipText}>ÉTAPE 4 · RÉPÉTITION GUIDÉE</Text>
          </View>
          <Text style={rep.headerTitle}>Ancre l'ayat</Text>
          <Text style={rep.headerSub}>Répète chaque morceau jusqu'à ce qu'il devienne familier.</Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: mountAnim }}>
          <SessionProgressBar
            pct={REPETITION_PROGRESS_PCT}
            label="Étape 4 · Répétition guidée"
            phase="Ancrage"
          />
        </Animated.View>

        {/* ── FOCUS CARD ── */}
        {chunks.length === 0 ? (
          <View style={rep.fallbackCard}>
            <Text style={rep.fallbackText}>L'ayat n'a pas pu être chargé.</Text>
          </View>
        ) : (
          <Animated.View style={[rep.focusCardWrap, {
            opacity: cardAnim,
            transform: [
              { translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              { scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) },
            ],
          }]}>
            {/* breathing glow shell */}
            <Animated.View style={[rep.focusGlowShell, { opacity: activeGlow }]} />

            <Animated.View style={[rep.focusCard, {
              opacity: focusOpacity,
              transform: [{ translateY: focusSlide }],
            }]}>
              {/* ── card header row ── */}
              <View style={rep.cardTopRow}>
                <View style={rep.chunkBadge}>
                  <Text style={rep.chunkBadgeText}>
                    MORCEAU {focusIdx + 1}{total > 1 ? ` SUR ${total}` : ''}
                  </Text>
                </View>
                {/* mini pills */}
                {total > 1 && (
                  <View style={rep.miniNav}>
                    {Array.from({ length: total }).map((_, i) => {
                      const isActive   = i === focusIdx;
                      const isUnlocked = i < unlockedCount;
                      const isAnchoredPill = (repeatCounts[i] ?? 0) >= MIN_REPS;
                      return (
                        <Pressable
                          key={i}
                          style={({ pressed }) => [
                            rep.miniPill,
                            isActive      && rep.miniPillActive,
                            !isActive && isUnlocked && !isAnchoredPill && rep.miniPillUnlocked,
                            !isActive && isAnchoredPill && rep.miniPillAnchored,
                            !isUnlocked   && rep.miniPillLocked,
                            pressed && isUnlocked && !isActive && rep.miniPillPressed,
                          ]}
                          onPress={() => handlePillPress(i)}
                          disabled={!isUnlocked}
                          accessibilityLabel={`Morceau ${i + 1}`}
                          hitSlop={6}
                        >
                          <Text style={[
                            rep.miniPillText,
                            isActive      && rep.miniPillTextActive,
                            !isActive && isUnlocked && !isAnchoredPill && rep.miniPillTextUnlocked,
                            !isActive && isAnchoredPill && rep.miniPillTextAnchored,
                            !isUnlocked   && rep.miniPillTextLocked,
                          ]}>
                            {isAnchoredPill && !isActive ? '✓' : i + 1}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>

              <View style={rep.divider} />

              {/* ── Arabic chunk ── */}
              <Text style={rep.arabicText} textBreakStrategy="simple">
                {activeChunk || '—'}
              </Text>

              {/* ── Transliteration ── */}
              {activeTChunk ? (
                <Text style={rep.translitText}>{activeTChunk}</Text>
              ) : showFullTranslitFallback ? (
                <View style={rep.translitFallbackWrap}>
                  <Text style={rep.translitFallbackLabel}>Translittération de l'ayat</Text>
                  <Text style={rep.translitText}>{ayat!.transliteration}</Text>
                </View>
              ) : null}

              <View style={rep.divider} />

              {/* ── Sens de l'ayat ── */}
              {ayat?.translationFr ? (
                <View style={rep.sensWrap}>
                  <Text style={rep.sensLabel}>SENS DE L'AYAT</Text>
                  <Text style={rep.sensText}>{ayat.translationFr}</Text>
                </View>
              ) : null}

              <View style={rep.subDivider} />

              {/* ── Audio button — full ayat, no listen counter ── */}
              <AyatAudioControl
                surahNumber={surahNumber}
                ayatNumber={ayatNumber}
                label="Écouter l'ayat"
              />

            </Animated.View>
          </Animated.View>
        )}

        {/* ── REPETITION AREA ── */}
        <Animated.View style={[rep.repArea, {
          opacity: repAreaAnim,
          transform: [{ translateY: repAreaAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }]}>
          {/* instruction row */}
          <View style={rep.repHeaderRow}>
            <Text style={rep.repInstruction}>Répète ce morceau 3 fois</Text>
            <Text style={rep.repMicro}>À voix basse ou haute.</Text>
          </View>

          {/* pearls row — keyed on focusIdx+repCount to force correct remount */}
          <View
            key={`pearls-${focusIdx}-${repCount}`}
            style={rep.pearlsRow}
          >
            {Array.from({ length: MIN_REPS }).map((_, pi) => {
              const filled = pi < repCount;
              const isNewest = filled && pi === repCount - 1;
              return isNewest ? (
                <Animated.View
                  key={pi}
                  style={[rep.pearl, rep.pearlFilled, { transform: [{ scale: pearlPopAnim }] }]}
                />
              ) : (
                <View key={pi} style={[rep.pearl, filled && rep.pearlFilled]} />
              );
            })}
          </View>

          {/* anchored badge */}
          {isAnchored ? (
            <View style={rep.anchorBadge}>
              <Text style={rep.anchorBadgeText}>Morceau ancré ✓</Text>
            </View>
          ) : null}

          {/* repeat button — only shown when not yet anchored */}
          {!isAnchored ? (
            <Animated.View style={{ transform: [{ scale: repBtnScale }] }}>
              <Pressable
                style={({ pressed }) => [
                  rep.repBtn,
                  cooldownActive && rep.repBtnCooldown,
                  pressed && !cooldownActive && rep.repBtnPressed,
                ]}
                onPress={handleRepeat}
                disabled={cooldownActive}
                accessibilityLabel="J'ai répété une fois"
              >
                <Text style={[rep.repBtnText, cooldownActive && rep.repBtnTextCooldown]}>
                  {cooldownActive ? 'Respire…' : 'J\'ai répété une fois'}
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </Animated.View>

        {/* ── COMPACT GUIDE LINE ── */}
        <Animated.View style={[rep.guideLine, {
          opacity: guideAnim,
          transform: [{ translateY: guideAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        }]}>
          <View style={rep.guideAccent} />
          <Text style={[rep.guideText, allAnchored && rep.guideTextDone]}>
            {guideMsg}
          </Text>
        </Animated.View>

        <View style={{ height: 86 }} />
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <View style={[rep.stickyBottom, { paddingBottom: Math.max(spacing.xl, insets.bottom + 16) }]}>
        {/* main CTA — only shown when chunk is anchored or navigating */}
        {(isAnchored || !isAtFrontier || allAnchored) ? (
          <Pressable
            style={({ pressed }) => [
              rep.cta,
              allAnchored && rep.ctaUnlocked,
              pressed && rep.ctaPressed,
            ]}
            onPress={handleCta}
          >
            <Text style={rep.ctaText}>{ctaLabel}</Text>
            {allAnchored ? (
              <Animated.View pointerEvents="none" style={[rep.ctaShine, { left: ctaShineX }]} />
            ) : null}
          </Pressable>
        ) : (
          // subtle progress hint when not yet anchored and at frontier
          <View style={rep.ctaHint}>
            <Text style={rep.ctaHintText}>
              {MIN_REPS - repCount} répétition{MIN_REPS - repCount > 1 ? 's' : ''} restante{MIN_REPS - repCount > 1 ? 's' : ''} pour ancrer ce morceau
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const rep = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: 4, paddingBottom: 0 },

  // ── background ──
  halo:    { position: 'absolute', top: -70, right: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(22,48,38,0.09)', zIndex: 0 },
  ornLine: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.09)', zIndex: 0 },

  // ── header ──
  header:        { marginBottom: 6 },
  backBtn:       { marginBottom: 5, alignSelf: 'flex-start' },
  backBtnText:   { fontSize: 22, color: colors.muted, fontWeight: '300', lineHeight: 24 },
  headerChip:    { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.22)', marginBottom: 4 },
  headerChipDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.primary, marginRight: 5 },
  headerChipText:{ fontSize: 10, fontWeight: '700', color: colors.primary, letterSpacing: 1.4 },
  headerTitle:   { fontSize: 19, fontWeight: '800', color: colors.primary, marginBottom: 1 },
  headerSub:     { fontSize: 12, color: colors.muted, lineHeight: 18 },

  // ── focus card ──
  focusCardWrap:  { position: 'relative', marginBottom: 8 },
  focusGlowShell: { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: 28, borderWidth: 2, borderColor: colors.gold, zIndex: 0 },
  focusCard:      {
    backgroundColor: '#FEFCF5',
    borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.35)',
    paddingHorizontal: spacing.lg, paddingTop: 13, paddingBottom: 11,
    shadowColor: colors.gold, shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    zIndex: 1,
  },

  // card header
  cardTopRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  chunkBadge:  { backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.20)' },
  chunkBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },

  // mini pill nav
  miniNav:           { flexDirection: 'row', gap: 5, alignItems: 'center' },
  miniPill:          { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(184,150,46,0.07)', borderWidth: 1, borderColor: 'rgba(184,150,46,0.20)' },
  miniPillActive:    { backgroundColor: colors.primary, borderColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.30, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  miniPillUnlocked:  { backgroundColor: '#FEFCF5', borderColor: 'rgba(184,150,46,0.45)' },
  miniPillAnchored:  { backgroundColor: 'rgba(45,106,79,0.10)', borderColor: 'rgba(45,106,79,0.40)' },
  miniPillLocked:    { opacity: 0.38 },
  miniPillPressed:   { opacity: 0.60, transform: [{ scale: 0.88 }] },
  miniPillText:      { fontSize: 10, fontWeight: '800', color: colors.muted },
  miniPillTextActive:   { color: '#FFFFFF' },
  miniPillTextUnlocked: { color: colors.gold },
  miniPillTextAnchored: { color: colors.success, fontSize: 9 },
  miniPillTextLocked:   { color: 'rgba(184,150,46,0.40)' },

  // dividers
  divider:    { height: 1, backgroundColor: 'rgba(184,150,46,0.16)', marginVertical: 8 },
  subDivider: { height: 1, backgroundColor: 'rgba(184,150,46,0.09)', marginVertical: 7 },

  // arabic
  arabicText: { fontSize: 30, color: colors.primary, textAlign: 'right', lineHeight: 50, fontWeight: '600', writingDirection: 'rtl', letterSpacing: 1.4, marginBottom: 4 },

  // transliteration
  translitText:         { fontSize: 13, fontWeight: '500', color: colors.muted, lineHeight: 20, fontStyle: 'italic', marginBottom: 3 },
  translitFallbackWrap: { marginBottom: 3 },
  translitFallbackLabel:{ fontSize: 9, fontWeight: '700', color: colors.gold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 3 },

  // sens
  sensWrap:  { marginBottom: 2 },
  sensLabel: { fontSize: 9, fontWeight: '700', color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 3 },
  sensText:  { fontSize: 12, color: colors.muted, lineHeight: 19, fontStyle: 'italic' },

  // audio button
  audioBtn:        { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.16)', paddingVertical: 9, paddingHorizontal: spacing.md, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  audioBtnPressed: { opacity: 0.80, transform: [{ scale: 0.97 }] },
  audioBtnInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  audioIcon:       { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  audioBar1:       { width: 2.5, height: 9,  borderRadius: 2, backgroundColor: colors.primary },
  audioBar2:       { width: 2.5, height: 16, borderRadius: 2, backgroundColor: colors.primary },
  audioBar3:       { width: 2.5, height: 11, borderRadius: 2, backgroundColor: colors.primary },
  audioBtnText:    { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.3 },

  // fallback
  fallbackCard: { backgroundColor: colors.surface, borderRadius: 18, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, alignItems: 'center' },
  fallbackText: { fontSize: 13, color: colors.muted, fontStyle: 'italic', textAlign: 'center' },

  // ── repetition area ──
  repArea:      { backgroundColor: '#FEFCF5', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(184,150,46,0.22)', paddingHorizontal: spacing.lg, paddingVertical: 12, marginBottom: 8, shadowColor: colors.gold, shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  repHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  repInstruction:{ fontSize: 14, fontWeight: '700', color: colors.primary, letterSpacing: 0.2 },
  repMicro:     { fontSize: 10, color: colors.muted, fontStyle: 'italic' },

  // pearls
  pearlsRow: { flexDirection: 'row', gap: 10, marginBottom: 10, justifyContent: 'center' },
  pearl:       { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.35)', backgroundColor: 'rgba(184,150,46,0.06)' },
  pearlFilled: { backgroundColor: colors.gold, borderColor: colors.gold, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 5, shadowOffset: { width: 0, height: 1 }, elevation: 2 },

  // anchor badge
  anchorBadge:     { alignSelf: 'center', marginBottom: 10, backgroundColor: 'rgba(45,106,79,0.10)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(45,106,79,0.30)' },
  anchorBadgeText: { fontSize: 12, fontWeight: '800', color: colors.success, letterSpacing: 0.4 },

  // repeat button (primary action when not anchored)
  repBtn:           { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 13, alignItems: 'center', shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  repBtnCooldown:   { backgroundColor: 'rgba(22,48,38,0.55)' },
  repBtnPressed:    { opacity: 0.82, transform: [{ scale: 0.975 }] },
  repBtnText:       { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  repBtnTextCooldown: { color: 'rgba(255,255,255,0.65)' },

  // repeat extra (secondary, ghost)
  repeatExtraBtn:     { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(22,48,38,0.18)', backgroundColor: 'rgba(22,48,38,0.04)' },
  repeatExtraBtnText: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.2 },

  // ── guide line ──
  guideLine:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  guideAccent:  { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.primary, opacity: 0.55 },
  guideText:    { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 18, fontStyle: 'italic' },
  guideTextDone:{ color: colors.primary, fontWeight: '600', fontStyle: 'normal' },

  // ── sticky CTA ──
  stickyBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.14)', paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.xl },
  cta:          { backgroundColor: colors.primary, borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: colors.primary, shadowOpacity: 0.38, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  ctaUnlocked:  { shadowOpacity: 0.50 },
  ctaPressed:   { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:      { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  ctaShine:     { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ skewX: '-20deg' }] },
  ctaHint:      { alignItems: 'center', paddingVertical: 14 },
  ctaHintText:  { fontSize: 12, color: colors.muted, fontStyle: 'italic', letterSpacing: 0.2 },
});


// ─── Step 5 · Récitation de l'ayat actuel ────────────────────────────────────

type AyatRecitationMode = 'recite' | 'compare';

type AyatRecitationScreenProps = {
  surahNumber:       number;
  ayat:              QuranAyahContent | null;
  ayatNumber:        number;
  totalAyatsToday:   number;
  surahName:         string;
  isLastAyat:        boolean;
  onBack:            () => void;
  onNextAyat:        () => void; // move to next ayat's discovery
  onFinalTest:       () => void; // move to Step 6
};

function AyatRecitationScreen({
  surahNumber, ayat, ayatNumber, totalAyatsToday, surahName, isLastAyat, onBack, onNextAyat, onFinalTest,
}: AyatRecitationScreenProps) {
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);

  // ── mode ──
  const [mode, setMode]                   = useState<AyatRecitationMode>('recite');
  const [canContinue, setCanContinue]     = useState(false);
  const isTransitioning                   = useRef(false);
  const guardTimer                        = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── animation refs ──
  const mountAnim      = useRef(new Animated.Value(0)).current;
  const cardAnim       = useRef(new Animated.Value(0)).current;
  const guideAnim      = useRef(new Animated.Value(0)).current;
  const ctaAnim        = useRef(new Animated.Value(0)).current;
  const ctaShine       = useRef(new Animated.Value(-1)).current;
  const ctaShineLoop   = useRef<Animated.CompositeAnimation | null>(null);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentSlide   = useRef(new Animated.Value(0)).current;
  const glowAnim       = useRef(new Animated.Value(0.5)).current;
  const glowLoop       = useRef<Animated.CompositeAnimation | null>(null);

  // ── entrance ──
  useEffect(() => {
    mountedRef.current = true;

    Animated.stagger(70, [
      Animated.timing(mountAnim, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim,  { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(guideAnim, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(ctaAnim,   { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    glowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1.0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.5, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.current.start();

    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2800),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();

    // initial guard for recite mode (~6.5s)
    guardTimer.current = setTimeout(() => {
      if (mountedRef.current) setCanContinue(true);
    }, 6500);

    return () => {
      mountedRef.current = false;
      glowLoop.current?.stop();
      ctaShineLoop.current?.stop();
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── guard timer resets on mode change ──
  useEffect(() => {
    setCanContinue(false);
    if (guardTimer.current) clearTimeout(guardTimer.current);
    // compare mode unlocks faster — user is just checking
    const delay = mode === 'recite' ? 6500 : 1200;
    guardTimer.current = setTimeout(() => {
      if (mountedRef.current) setCanContinue(true);
    }, delay);
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  }, [mode]);

  // ── recite → compare transition ──
  const handleReciteCta = useCallback(() => {
    if (!canContinue || isTransitioning.current) return;
    isTransitioning.current = true;
    hapticMedium();
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentSlide,   { toValue: -18, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) { isTransitioning.current = false; return; }
      setMode('compare');
      contentSlide.setValue(20);
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(contentSlide,   { toValue: 0,  duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => { isTransitioning.current = false; });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canContinue]);

  // ── compare → next ayat or final test ──
  const handleCompareCta = useCallback(() => {
    if (!canContinue || isTransitioning.current) return;
    isTransitioning.current = true;
    hapticMedium();
    if (isLastAyat) {
      onFinalTest();
    } else {
      onNextAyat();
    }
  }, [canContinue, isLastAyat, onFinalTest, onNextAyat]);

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  // compute 1-based index within today's range
  const ayatIndexLabel = `Ayat ${ayatNumber}`;

  return (
    <SafeAreaView style={ar.safe}>
      <PremiumBackground />
      <View style={ar.halo} pointerEvents="none" />
      <View style={ar.ornLine} pointerEvents="none" />

      <ScrollView contentContainerStyle={ar.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <Animated.View style={[ar.header, {
          opacity: mountAnim,
          transform: [{ translateY: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Pressable style={ar.backBtn} onPress={() => { hapticLight(); onBack(); }} hitSlop={12}>
            <Text style={ar.backBtnText}>←</Text>
          </Pressable>
          <View style={ar.headerChip}>
            <View style={ar.headerChipDot} />
            <Text style={ar.headerChipText}>
              {mode === 'recite' ? 'ÉTAPE 5 · RÉCITATION' : 'ÉTAPE 5 · COMPARAISON'}
            </Text>
          </View>
          <Text style={ar.headerTitle}>
            {mode === 'recite' ? 'Récite cet ayat' : 'Compare avec ta récitation'}
          </Text>
          <Text style={ar.headerSub}>
            {mode === 'recite'
              ? 'Essaie de le retrouver sans regarder.'
              : 'Regarde si tu as oublié, inversé ou hésité.'}
          </Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: mountAnim }}>
          <SessionProgressBar
            pct={RECITATION_PROGRESS_PCT}
            label="Étape 5 · Récitation"
            phase="Rappel"
          />
        </Animated.View>

        {/* ── CONTEXT CHIP ── */}
        <Animated.View style={[ar.contextRow, { opacity: cardAnim }]}>
          {surahName ? <Text style={ar.contextSurah}>{surahName}</Text> : null}
          <View style={ar.contextBadge}>
            <Text style={ar.contextBadgeText}>
              {totalAyatsToday === 1 ? ayatIndexLabel : `${ayatIndexLabel} sur ${totalAyatsToday}`}
            </Text>
          </View>
        </Animated.View>

        {/* ── MAIN CARD ── */}
        <Animated.View style={[ar.cardWrap, {
          opacity: cardAnim,
          transform: [
            { translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) },
          ],
        }]}>
          <View style={ar.card}>

            {/* mode badge */}
            <View style={[ar.modeBadge, mode === 'compare' && ar.modeBadgeCompare]}>
              <Text style={[ar.modeBadgeText, mode === 'compare' && ar.modeBadgeTextCompare]}>
                {mode === 'recite' ? 'SANS AIDE' : 'RÉVÉLATION'}
              </Text>
            </View>

            {/* animated content area */}
            <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}>
              {mode === 'recite' ? (
                /* ── RECITE MODE ── */
                <View>
                  <Text style={ar.modeInstruction}>
                    Cache les aides.{'\n'}Récite cet ayat sans regarder.
                  </Text>

                  {/* hidden-memory card */}
                  <Animated.View style={[ar.hiddenCard, {
                    opacity: glowAnim.interpolate({ inputRange: [0.5, 1.0], outputRange: [0.85, 1.0] }),
                  }]}>
                    <View style={ar.hiddenGlow} />
                    <Text style={ar.hiddenDots}>•  •  •</Text>
                    <Text style={ar.hiddenCaption}>Récite l'ayat de mémoire</Text>
                    <Text style={ar.hiddenHint}>Prends ton temps. Ne cherche pas la vitesse.</Text>
                  </Animated.View>
                </View>
              ) : (
                /* ── COMPARE MODE ── */
                <View>
                  <Text style={ar.modeInstruction}>
                    Regarde si tu as oublié, inversé ou hésité.
                  </Text>

                  {ayat ? (
                    <View style={ar.revealBlock}>
                      {/* Arabic */}
                      {ayat.arabic ? (
                        <Text style={ar.revealArabic} textBreakStrategy="simple">
                          {ayat.arabic}
                        </Text>
                      ) : null}

                      {/* transliteration */}
                      {ayat.transliteration ? (
                        <View style={ar.revealDivider}>
                          <Text style={ar.revealTranslit}>{ayat.transliteration}</Text>
                        </View>
                      ) : null}

                      {/* translation */}
                      {ayat.translationFr ? (
                        <View style={ar.revealDivider}>
                          <Text style={ar.revealLabel}>SENS DE L'AYAT</Text>
                          <Text style={ar.revealTranslation}>{ayat.translationFr}</Text>
                        </View>
                      ) : null}

                      {/* audio — compare mode only, no listen counter */}
                      <View style={ar.revealAudioRow}>
                        <AyatAudioControl
                          surahNumber={surahNumber}
                          ayatNumber={ayatNumber}
                          label="Réécouter l'ayat"
                          compact
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={ar.fallbackText}>Contenu non disponible.</Text>
                  )}
                </View>
              )}
            </Animated.View>

          </View>
        </Animated.View>

        {/* ── GUIDE LINE ── */}
        <Animated.View style={[ar.guideLine, {
          opacity: guideAnim,
          transform: [{ translateY: guideAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        }]}>
          <View style={ar.guideAccent} />
          <Text style={ar.guideText}>
            {mode === 'recite'
              ? 'Prends ton temps. Essaie de retrouver l\'ayat complet.'
              : 'Réponds honnêtement. C\'est pour renforcer ta mémorisation.'}
          </Text>
        </Animated.View>

        <View style={{ height: 86 }} />
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <Animated.View style={[ar.stickyBottom, {
        opacity: ctaAnim,
        transform: [{ translateY: ctaAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        paddingBottom: Math.max(spacing.xl, insets.bottom + 16),
      }]}>
        <Pressable
          style={({ pressed }) => [
            ar.cta,
            canContinue ? ar.ctaActive : ar.ctaLocked,
            pressed && canContinue && ar.ctaPressed,
          ]}
          onPress={mode === 'recite' ? handleReciteCta : handleCompareCta}
        >
          <Text style={[ar.ctaText, !canContinue && ar.ctaTextLocked]}>
            {mode === 'recite'
              ? (canContinue ? 'J\'ai récité l\'ayat →' : 'Récite maintenant…')
              : (canContinue
                  ? (isLastAyat ? 'Continuer vers le test final →' : 'Passer à l\'ayat suivant →')
                  : 'J\'ai comparé…')}
          </Text>
          {canContinue ? (
            <Animated.View pointerEvents="none" style={[ar.ctaShine, { left: ctaShineX }]} />
          ) : null}
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const ar = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  scroll:  { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 20 },
  halo:    { position: 'absolute', top: -50, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(22,48,38,0.07)', zIndex: 0 },
  ornLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: 'rgba(184,150,46,0.18)', zIndex: 0 },

  // header
  backBtn:        { alignSelf: 'flex-start', marginBottom: 6, paddingVertical: 2 },
  backBtnText:    { fontSize: 20, color: colors.primary, fontWeight: '300' },
  header:         { marginBottom: 12 },
  headerChip:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(184,150,46,0.13)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)', marginBottom: 8 },
  headerChipDot:  { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  headerChipText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 1.4 },
  headerTitle:    { fontSize: 24, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  headerSub:      { fontSize: 13, color: colors.muted, lineHeight: 20 },

  // context row
  contextRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  contextSurah:      { fontSize: 12, color: colors.muted, fontWeight: '600' },
  contextBadge:      { backgroundColor: 'rgba(22,48,38,0.08)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(22,48,38,0.15)' },
  contextBadgeText:  { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.6 },

  // card
  cardWrap:  { marginBottom: 10 },
  card:      { backgroundColor: '#FEFCF7', borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)', paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 16, shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },

  // mode badge
  modeBadge:            { alignSelf: 'flex-start', backgroundColor: 'rgba(22,48,38,0.08)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.16)', marginBottom: 12 },
  modeBadgeCompare:     { backgroundColor: 'rgba(45,106,79,0.10)', borderColor: 'rgba(45,106,79,0.28)' },
  modeBadgeText:        { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  modeBadgeTextCompare: { color: colors.success },

  // mode instruction
  modeInstruction: { fontSize: 13, color: colors.muted, lineHeight: 20, fontStyle: 'italic', marginBottom: 14 },

  // hidden-memory card
  hiddenCard:    { backgroundColor: 'rgba(22,48,38,0.04)', borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.10)', alignItems: 'center', paddingVertical: 32, marginBottom: 8, overflow: 'hidden' },
  hiddenGlow:    { position: 'absolute', top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(45,106,79,0.08)' },
  hiddenDots:    { fontSize: 28, color: colors.primary, opacity: 0.30, letterSpacing: 6, marginBottom: 10 },
  hiddenCaption: { fontSize: 13, color: colors.primary, fontWeight: '700', marginBottom: 6 },
  hiddenHint:    { fontSize: 11, color: colors.muted, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 16 },

  // reveal block (compare mode)
  revealBlock:      { gap: 0 },
  revealArabic:     { fontSize: 22, color: colors.primary, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl', lineHeight: 38, marginBottom: 10 },
  revealDivider:    { borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.14)', paddingTop: 10, marginTop: 4, marginBottom: 4 },
  revealTranslit:   { fontSize: 13, color: colors.muted, lineHeight: 20, fontStyle: 'italic' },
  revealLabel:      { fontSize: 9, fontWeight: '800', color: colors.gold, letterSpacing: 1.4, marginBottom: 4, textTransform: 'uppercase' },
  revealTranslation:{ fontSize: 12, color: colors.muted, lineHeight: 18, fontStyle: 'italic' },
  revealAudioRow:   { marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.12)', paddingTop: 10 },
  fallbackText:     { fontSize: 13, color: colors.muted, fontStyle: 'italic' },

  // guide line
  guideLine:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  guideAccent: { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.primary, opacity: 0.50 },
  guideText:   { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 18, fontStyle: 'italic' },

  // sticky CTA
  stickyBottom:  { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.14)', paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.xl },
  cta:           { borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  ctaActive:     { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.38 },
  ctaLocked:     { backgroundColor: 'rgba(22,48,38,0.30)', shadowColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  ctaPressed:    { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:       { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  ctaTextLocked: { color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  ctaShine:      { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ skewX: '-20deg' }] },
});

// ─── Step 6 · Rappel sans aide ─────────────────────────────────────────────────

type FinalTestMode = 'recite' | 'compare' | 'evaluate';
type DifficultyLevel = 'easy' | 'hesitant' | 'hard';

type FinalTestScreenProps = {
  surahNumber:          number;
  allAyats:             QuranAyahContent[];
  currentAyatIndex:     number;
  memStart:             number;
  memEnd:               number;
  surahName:            string;
  userId:               string;
  ayahPerDay:           number;
  sessionFinishesSurah: boolean;
  nextSurah:            number | null;
  hasZainlyPlus:        boolean;
  onBack:               () => void;
  onComplete:           (difficulty: DifficultyLevel) => void;
  onRestartPassage:     () => void;
};

function FinalTestScreen({ surahNumber, allAyats, currentAyatIndex, memStart, memEnd, surahName, userId, ayahPerDay, sessionFinishesSurah, nextSurah, hasZainlyPlus, onBack, onComplete, onRestartPassage }: FinalTestScreenProps) {
  // ── BUG-001 / BUG-002 fix ──
  // Convention: current_ayah = last completed ayah in current_surah (0 = none yet).
  // If this session finishes the surah AND a next surah exists in the plan order,
  // progression advances to nextSurah at ayah 0. Otherwise it stays on the same
  // surah with current_ayah = memEnd (never memEnd + 1 — that was BUG-001).
  const advancesToNextSurah = sessionFinishesSurah && nextSurah != null;
  const newCurrentSurah     = advancesToNextSurah ? nextSurah! : surahNumber;
  const newCurrentAyah      = advancesToNextSurah ? 0 : memEnd;
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const mountedRef = useRef(true);

  // Cumulative recall target: only ayats up to and including the current ayat index.
  // allAyats holds the full session range (fetched memStart..memEnd).
  // We slice to currentAyatIndex + 1 so future ayats are never tested early.
  const cumulativeRecallAyats = allAyats.length > 0
    ? allAyats.slice(0, currentAyatIndex + 1)
    : [];
  // Safe fallback: if slice is empty (race / load failure), treat as single.
  const recallAyats  = cumulativeRecallAyats.length > 0 ? cumulativeRecallAyats : allAyats.slice(0, 1);
  const isSingleAyat = recallAyats.length <= 1;

  const totalAyats = Math.max(recallAyats.length, 1);

  // ── mode ──
  const [mode, setMode]                         = useState<FinalTestMode>('recite');
  const [canContinue, setCanContinue]           = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel | null>(null);
  const isTransitioning                         = useRef(false);
  const guardTimer                              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompleting                            = useRef(false);
  const isRestarting                            = useRef(false);
  const progressValidated                       = useRef(false); // guard: completeSession already succeeded

  // validation UI state
  const [isValidating, setIsValidating]         = useState(false);
  const [validationError, setValidationError]   = useState<string | null>(null);
  const setResult                               = useSessionResultStore(s => s.setResult);

  // ── BUG-009 guard ──
  // A pending completeSession/createReviewItemsForAyatRange write must not be
  // abandonable via navigation: leaving mid-write and re-entering the session
  // would remount this screen with a fresh isCompleting ref, and for Zainly+
  // users (allowMultipleToday=true bypasses the daily guard) that could create
  // a second real write — double total_memorized, double review_items. Block
  // both the Android hardware back button and the iOS swipe-back gesture for
  // the duration of the pending validation only; both re-enable automatically
  // once isValidating goes back to false (success navigates away anyway).
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !isValidating });
  }, [isValidating, navigation]);

  useEffect(() => {
    if (!isValidating) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [isValidating]);

  // ── passage audio (finalCompare only) ──
  const passageAyatNumbers = useMemo(
    () => recallAyats.map(a => a.ayahNumber ?? 0).filter(n => n > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recallAyats.length, surahNumber],
  );
  const passage = usePassageAudio(surahNumber, passageAyatNumbers);

  // stop passage audio when navigating away from compare
  useEffect(() => {
    if (mode !== 'compare') passage.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── restart confirmation state ──
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const confirmAnim = useRef(new Animated.Value(0)).current;

  // ── animation refs ──
  const mountAnim      = useRef(new Animated.Value(0)).current;
  const cardAnim       = useRef(new Animated.Value(0)).current;
  const guideAnim      = useRef(new Animated.Value(0)).current;
  const ctaAnim        = useRef(new Animated.Value(0)).current;
  const ctaShine       = useRef(new Animated.Value(-1)).current;
  const ctaShineLoop   = useRef<Animated.CompositeAnimation | null>(null);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentSlide   = useRef(new Animated.Value(0)).current;
  const glowAnim       = useRef(new Animated.Value(0.5)).current;
  const glowLoop       = useRef<Animated.CompositeAnimation | null>(null);
  // evaluation card press scales
  const evalScales = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;

  // ── entrance ──
  useEffect(() => {
    mountedRef.current = true;

    Animated.stagger(70, [
      Animated.timing(mountAnim, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim,  { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(guideAnim, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(ctaAnim,   { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    glowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1.0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.5, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.current.start();

    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2800),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();

    // initial guard: 8–10s depending on ayat count
    const delay = totalAyats > 2 ? 10000 : 8000;
    guardTimer.current = setTimeout(() => {
      if (mountedRef.current) setCanContinue(true);
    }, delay);

    return () => {
      mountedRef.current = false;
      glowLoop.current?.stop();
      ctaShineLoop.current?.stop();
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── guard timer resets on mode change ──
  useEffect(() => {
    setCanContinue(false);
    if (guardTimer.current) clearTimeout(guardTimer.current);
    let delay = 0;
    if (mode === 'recite') {
      delay = totalAyats > 2 ? 10000 : 8000;
    } else if (mode === 'compare') {
      delay = 1500;
    } else {
      delay = 0; // evaluate: immediately enabled after selection
    }
    if (delay > 0) {
      guardTimer.current = setTimeout(() => {
        if (mountedRef.current) setCanContinue(true);
      }, delay);
    }
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── smooth mode transition helper ──
  const transitionTo = useCallback((next: FinalTestMode) => {
    if (isTransitioning.current) return;
    isTransitioning.current = true;
    Animated.parallel([
      Animated.timing(contentOpacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentSlide,   { toValue: -18, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) { isTransitioning.current = false; return; }
      setMode(next);
      contentSlide.setValue(20);
      Animated.parallel([
        Animated.timing(contentOpacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(contentSlide,   { toValue: 0,  duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => { isTransitioning.current = false; });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReciteCta = useCallback(() => {
    if (!canContinue || isTransitioning.current) return;
    hapticMedium();
    transitionTo('compare');
  }, [canContinue, transitionTo]);

  const handleCompareCta = useCallback(() => {
    if (!canContinue || isTransitioning.current) return;
    hapticMedium();
    transitionTo('evaluate');
  }, [canContinue, transitionTo]);

  const handleEvalSelect = useCallback((level: DifficultyLevel, idx: number) => {
    hapticSelection();
    setSelectedDifficulty(level);
    setCanContinue(true);
    // hide confirm panel when difficulty changes
    setShowRestartConfirm(false);
    confirmAnim.setValue(0);
    // micro-press animation
    Animated.sequence([
      Animated.timing(evalScales[idx], { toValue: 0.96, duration: 90, useNativeDriver: true }),
      Animated.timing(evalScales[idx], { toValue: 1.00, duration: 130, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalScales]);

  const openRestartConfirm = useCallback(() => {
    if (isRestarting.current) return;
    hapticMedium();
    setShowRestartConfirm(true);
    Animated.timing(confirmAnim, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelRestart = useCallback(() => {
    hapticLight();
    Animated.timing(confirmAnim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setShowRestartConfirm(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmRestart = useCallback(() => {
    if (isRestarting.current) return;
    isRestarting.current = true;
    hapticMedium();
    onRestartPassage();
  }, [onRestartPassage]);

  const handleValidate = useCallback(async () => {
    if (!selectedDifficulty || isCompleting.current) return;
    isCompleting.current = true;
    setIsValidating(true);
    setValidationError(null);
    hapticMedium();

    const newAyatCount = memEnd - memStart + 1;

    // ── Step 1: completeSession (skip if already succeeded on a prior retry) ──
    // hasZainlyPlus here is entitlement-backed (see useZainlyPlusAccess in SessionScreen).
    if (!progressValidated.current) {
      const { error: sessionError } = await completeSession({
        userId,
        currentSurah:       newCurrentSurah,
        newCurrentAyah,
        ayahPerDay,
        newAyatCount,
        difficulty:         selectedDifficulty,
        allowMultipleToday: hasZainlyPlus,
      });

      // Component may have unmounted while this await was pending (e.g. the
      // user forced navigation away). Refs (isCompleting/progressValidated)
      // still need updating so a remounted instance behaves correctly, but
      // React state must not be touched on an unmounted component.
      if (!mountedRef.current) {
        if (!sessionError) progressValidated.current = true;
        isCompleting.current = false;
        return;
      }

      if (sessionError) {
        if (sessionError.message.includes('déjà validée')) {
          // Free user hit the daily guard — do NOT proceed to review_items.
          // For Zainly+ allowMultipleToday=true so this branch never fires.
          setIsValidating(false);
          setValidationError('Tu as déjà validé un apprentissage aujourd\'hui. Reviens demain ou passe à Zainly+.');
          isCompleting.current = false;
          return;
        }
        // Any other error (network, DB) — surface it.
        setIsValidating(false);
        setValidationError('Impossible de valider pour l\'instant. Réessaie.');
        isCompleting.current = false;
        return;
      }
      progressValidated.current = true;
    }

    // ── Step 2: createReviewItemsForAyatRange ──
    const { error: reviewError } = await createReviewItemsForAyatRange({
      userId,
      surahNumber,
      fromAyah: memStart,
      toAyah:   memEnd,
      difficulty: selectedDifficulty,
    });

    if (!mountedRef.current) {
      isCompleting.current = false;
      return;
    }

    if (reviewError) {
      // Session is saved but reviews failed — tell the truth
      setIsValidating(false);
      setValidationError('Ta session est enregistrée, mais les révisions n’ont pas pu être préparées. Réessaie.');
      isCompleting.current = false;
      return;
    }

    // ── Step 3: invalidate stale queries so Dashboard + Mon Hifz update immediately ──
    const today = localDateStrPure();
    void queryClient.invalidateQueries({ queryKey: ['progress',     userId] });
    void queryClient.invalidateQueries({ queryKey: ['dueReviews',   userId, today] });
    void queryClient.invalidateQueries({ queryKey: ['learnedItems', userId] });

    // ── Step 4: store display data ──
    setResult({
      surahName,
      surahNumber,
      fromAyah:         memStart,
      toAyah:           memEnd,
      newAyatCount,
      reviewsCompleted: 0,
      difficulty:       selectedDifficulty,
      streak:           0,
      completedAt:      new Date().toISOString(),
    });

    // ── Step 4: navigate ──
    hapticSuccess();
    onComplete(selectedDifficulty);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDifficulty, userId, surahNumber, newCurrentSurah, newCurrentAyah, ayahPerDay, memStart, memEnd, surahName, setResult, onComplete]);

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  // Build a cross-surah-safe cumulative range label.
  // surahNumber is always present on QuranAyahContent (non-optional field).
  const cumulativeRangeLabel = (() => {
    if (recallAyats.length === 0) return `Ayat ${memStart}`;
    if (recallAyats.length === 1) {
      const n = recallAyats[0].ayahNumber;
      return n > 0 ? `Ayat ${n}` : `Ayat ${memStart}`;
    }
    // Check whether all ayats belong to the same surah.
    const firstSurah = recallAyats[0].surahNumber;
    const sameSurah  = recallAyats.every(a => a.surahNumber === firstSurah);
    if (sameSurah) {
      const first = recallAyats[0].ayahNumber;
      const last  = recallAyats[recallAyats.length - 1].ayahNumber;
      return (first > 0 && last > 0)
        ? `Ayats ${first} à ${last}`
        : `${recallAyats.length} ayats appris dans cette session`;
    }
    // Multiple surahs — avoid misleading "Ayats X à Y" across surah boundary.
    return `${recallAyats.length} ayats appris dans cette session`;
  })();

  // ayatRangeLabel stays as a summary for the context chip (full session range).
  const ayatRangeLabel = memStart === memEnd
    ? `Ayat ${memStart}`
    : `Ayats ${memStart} à ${memEnd}`;

  const EVAL_OPTIONS: { level: DifficultyLevel; label: string; subtitle: string }[] = [
    { level: 'easy',     label: 'Facile',     subtitle: 'Je l\'ai récité sans blocage.' },
    { level: 'hesitant', label: 'Hésitant',   subtitle: 'J\'ai hésité ou dû réfléchir.' },
    { level: 'hard',     label: 'Difficile',  subtitle: 'J\'ai oublié ou mélangé des passages.' },
  ];

  return (
    <SafeAreaView style={ft.safe}>
      <PremiumBackground />
      <View style={ft.halo} pointerEvents="none" />
      <View style={ft.ornLine} pointerEvents="none" />

      <ScrollView contentContainerStyle={ft.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <Animated.View style={[ft.header, {
          opacity: mountAnim,
          transform: [{ translateY: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }]}>
          <Pressable style={ft.backBtn} onPress={() => { if (isValidating) return; hapticLight(); onBack(); }} hitSlop={12} disabled={isValidating}>
            <Text style={ft.backBtnText}>←</Text>
          </Pressable>
          <View style={ft.headerChip}>
            <View style={ft.headerChipDot} />
            <Text style={ft.headerChipText}>
              {mode === 'evaluate' ? 'ÉTAPE 6 · ÉVALUATION' : 'ÉTAPE 6 · RAPPEL SANS AIDE'}
            </Text>
          </View>
          <Text style={ft.headerTitle}>
            {mode === 'recite'
              ? (isSingleAyat ? 'Récite l\'ayat' : 'Récite le passage')
              : mode === 'compare'
                ? (isSingleAyat ? 'Compare ton ayat' : 'Compare ton passage')
                : 'Évalue ta récitation'}
          </Text>
          <Text style={ft.headerSub}>
            {mode === 'recite'
              ? (isSingleAyat
                  ? 'Récite l\'ayat appris dans cette session, sans aide.'
                  : 'Enchaîne les ayats appris dans cette session.')
              : mode === 'compare'
                ? (isSingleAyat
                    ? 'Vérifie si tu as bien récité l\'ayat correctement.'
                    : 'Vérifie si tu as oublié un mot, inversé ou hésité dans l\'enchaînement.')
                : 'Réponds honnêtement. Zainly utilisera cette difficulté pour protéger tes révisions.'}
          </Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: mountAnim }}>
          <SessionProgressBar
            pct={FINAL_TEST_PROGRESS_PCT}
            label="Étape 6 · Rappel sans aide"
            phase="Validation"
          />
        </Animated.View>

        {/* ── CONTEXT CHIP ── */}
        <Animated.View style={[ft.contextRow, { opacity: cardAnim }]}>
          {surahName ? <Text style={ft.contextSurah}>{surahName}</Text> : null}
          <View style={ft.contextBadge}>
            <Text style={ft.contextBadgeText}>{ayatRangeLabel}</Text>
          </View>
        </Animated.View>

        {/* ── MAIN CARD ── */}
        <Animated.View style={[ft.cardWrap, {
          opacity: cardAnim,
          transform: [
            { translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) },
          ],
        }]}>
          <View style={ft.card}>

            {/* mode badge */}
            <View style={[
              ft.modeBadge,
              mode === 'compare'  && ft.modeBadgeCompare,
              mode === 'evaluate' && ft.modeBadgeEval,
            ]}>
              <Text style={[
                ft.modeBadgeText,
                mode === 'compare'  && ft.modeBadgeTextCompare,
                mode === 'evaluate' && ft.modeBadgeTextEval,
              ]}>
                {mode === 'recite' ? 'SANS AIDE' : mode === 'compare' ? 'RÉVÉLATION' : 'AUTO-ÉVALUATION'}
              </Text>
            </View>

            {/* animated content */}
            <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentSlide }] }}>

              {mode === 'recite' ? (
                /* ── FINAL RECITE ── */
                <View>
                  <Text style={ft.modeInstruction}>
                    {isSingleAyat
                      ? 'Récite maintenant l\'ayat appris dans cette session.'
                      : 'Récite maintenant tous les ayats appris dans cette session, dans l\'ordre.'}
                  </Text>
                  <Animated.View style={[ft.hiddenCard, {
                    opacity: glowAnim.interpolate({ inputRange: [0.5, 1.0], outputRange: [0.85, 1.0] }),
                  }]}>
                    <View style={ft.hiddenGlow} />
                    <Text style={ft.hiddenDots}>•  •  •</Text>
                    <Text style={ft.hiddenCaption}>{isSingleAyat ? 'Récite l\'ayat complet' : 'Récite le passage complet'}</Text>
                    <Text style={ft.hiddenRange}>{cumulativeRangeLabel}</Text>
                  </Animated.View>
                </View>

              ) : mode === 'compare' ? (
                /* ── FINAL COMPARE ── */
                <View>
                  <Text style={ft.modeInstruction}>
                    {isSingleAyat
                      ? 'Vérifie si tu as bien récité l\'ayat, mot pour mot.'
                      : 'Vérifie si tu as oublié un mot ou hésité dans l\'enchaînement.'}
                  </Text>

                  {/* ── passage audio control ── */}
                  {passageAyatNumbers.length > 0 ? (
                    <View style={ft.passageAudioWrap}>
                      {(() => {
                        const passageEffectivePlaying = passage.isPlaying || passage.isIntendingToPlay;
                        const passageLabel = passage.hasError
                          ? 'Réessayer'
                          : passageEffectivePlaying
                            ? (passage.isPlaying
                                ? (isSingleAyat ? 'Arrêter la lecture' : `Arrêter (${passage.currentAyatIndex + 1}/${passage.totalAyats})`)
                                : (isSingleAyat ? 'Arrêter la lecture' : 'Arrêter la lecture'))
                            : (isSingleAyat ? 'Écouter l\'ayat' : 'Écouter le passage');
                        return (
                          <Pressable
                            style={({ pressed }) => [
                              ft.passageAudioBtn,
                              passageEffectivePlaying && ft.passageAudioBtnPlaying,
                              pressed && !passage.isLoadingVisible && ft.passageAudioBtnPressed,
                            ]}
                            onPress={() => {
                              hapticLight();
                              if (passageEffectivePlaying) { passage.stop(); }
                              else { passage.play(); }
                            }}
                            accessibilityLabel={passageLabel}
                          >
                            <View style={ft.passageAudioInner}>
                              {passage.isLoadingVisible ? (
                                <View style={ft.passageAudioSpinner} />
                              ) : passageEffectivePlaying ? (
                                <View style={ft.passageAudioIcon}>
                                  <View style={ft.passageAudioBar1} />
                                  <View style={ft.passageAudioBar2} />
                                  <View style={ft.passageAudioBar3} />
                                </View>
                              ) : (
                                <View style={ft.passageAudioPlayTriangle} />
                              )}
                              <Text style={ft.passageAudioLabel}>{passageLabel}</Text>
                            </View>
                          </Pressable>
                        );
                      })()}
                      {passage.hasError ? (
                        <View style={ft.passageAudioError}>
                          <Text style={ft.passageAudioErrorText}>{passage.errorMessage}</Text>
                          <Pressable onPress={() => { hapticLight(); passage.play(); }} style={ft.passageAudioRetry} hitSlop={8}>
                            <Text style={ft.passageAudioRetryText}>Réessayer</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {recallAyats.length > 0 ? recallAyats.map((a, idx) => (
                    <View key={a.ayahNumber ?? idx} style={ft.compareAyatBlock}>
                      <View style={ft.compareAyatHeader}>
                        <Text style={ft.compareAyatNum}>Ayat {a.ayahNumber ?? (memStart + idx)}</Text>
                      </View>
                      {a.arabic ? (
                        <Text style={ft.compareArabic} textBreakStrategy="simple">{a.arabic}</Text>
                      ) : null}
                      {a.transliteration ? (
                        <Text style={ft.compareTranslit}>{a.transliteration}</Text>
                      ) : null}
                      {a.translationFr ? (
                        <View style={ft.compareDivider}>
                          <Text style={ft.compareLabel}>SENS</Text>
                          <Text style={ft.compareTranslation}>{a.translationFr}</Text>
                        </View>
                      ) : null}
                    </View>
                  )) : (
                    <Text style={ft.fallbackText}>Contenu non disponible.</Text>
                  )}
                </View>

              ) : (
                /* ── FINAL EVALUATE ── */
                <View style={ft.evalList}>
                  {EVAL_OPTIONS.map((opt, idx) => {
                    const selected = selectedDifficulty === opt.level;
                    return (
                      <Animated.View key={opt.level} style={[{ transform: [{ scale: evalScales[idx] }] }]}>
                        <Pressable
                          style={[ft.evalCard, selected && ft.evalCardSelected]}
                          onPress={() => handleEvalSelect(opt.level, idx)}
                        >
                          <View style={[ft.evalDot, selected && ft.evalDotSelected]} />
                          <View style={ft.evalBody}>
                            <Text style={[ft.evalLabel, selected && ft.evalLabelSelected]}>
                              {opt.label}
                            </Text>
                            <Text style={ft.evalSubtitle}>{opt.subtitle}</Text>
                            {selected && opt.level === 'hard' ? (
                              <Text style={ft.evalHint}>On peut reprendre le passage pour l'ancrer vraiment.</Text>
                            ) : null}
                          </View>
                          {selected ? <Text style={ft.evalCheck}>✓</Text> : null}
                        </Pressable>
                      </Animated.View>
                    );
                  })}
                </View>
              )}

            </Animated.View>
          </View>
        </Animated.View>

        {/* ── GUIDE LINE (recite + compare only) ── */}
        {mode !== 'evaluate' ? (
          <Animated.View style={[ft.guideLine, {
            opacity: guideAnim,
            transform: [{ translateY: guideAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
          }]}>
            <View style={ft.guideAccent} />
            <Text style={ft.guideText}>
              {mode === 'recite'
                ? (isSingleAyat ? 'Récite l\'ayat sans t\'arrêter.' : 'Récite l\'enchaînement complet, sans t\'arrêter.')
                : 'Prends le temps de vérifier chaque ayat.'}
            </Text>
          </Animated.View>
        ) : null}

        <View style={{ height: 160 }} />
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <Animated.View style={[ft.stickyBottom, {
        opacity: ctaAnim,
        transform: [{ translateY: ctaAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        paddingBottom: Math.max(spacing.xl, insets.bottom + 16),
      }]}>
        {mode === 'evaluate' ? (
          <View>
            {/* ── RESTART CONFIRMATION PANEL ── */}
            {showRestartConfirm ? (
              <Animated.View style={[ft.confirmPanel, {
                opacity: confirmAnim,
                transform: [{ translateY: confirmAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
              }]}>
                <View style={ft.confirmAccent} />
                <View style={ft.confirmBody}>
                  <Text style={ft.confirmTitle}>Reprendre le passage ?</Text>
                  <Text style={ft.confirmDesc}>Tu vas recommencer depuis le premier ayat. Rien ne sera validé pour l'instant.</Text>
                  <View style={ft.confirmActions}>
                    <Pressable style={ft.confirmCancel} onPress={cancelRestart}>
                      <Text style={ft.confirmCancelText}>Annuler</Text>
                    </Pressable>
                    <Pressable style={ft.confirmOk} onPress={confirmRestart}>
                      <Text style={ft.confirmOkText}>Oui, reprendre</Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>
            ) : (
              <View>
                {/* inline validation error */}
                {validationError ? (
                  <View style={ft.validationError}>
                    <Text style={ft.validationErrorText}>{validationError}</Text>
                  </View>
                ) : null}

                {/* helper text */}
                {!validationError && selectedDifficulty === 'hesitant' ? (
                  <Text style={ft.helperText}>Tu peux valider, ou reprendre le passage pour le consolider.</Text>
                ) : !validationError && selectedDifficulty === 'hard' ? (
                  <Text style={ft.helperText}>Si c'était difficile, le meilleur choix est de reprendre le passage avant de valider.</Text>
                ) : null}

                {/* PRIMARY CTA */}
                <Pressable
                  style={({ pressed }) => [
                    ft.cta,
                    selectedDifficulty && !isValidating
                      ? (selectedDifficulty === 'hard' ? ft.ctaRestart : ft.ctaActive)
                      : ft.ctaLocked,
                    pressed && !!selectedDifficulty && !isValidating && ft.ctaPressed,
                  ]}
                  disabled={!selectedDifficulty || isValidating}
                  onPress={() => {
                    if (!selectedDifficulty || isValidating) return;
                    if (selectedDifficulty === 'hard') {
                      openRestartConfirm();
                    } else {
                      handleValidate();
                    }
                  }}
                >
                  <Text style={[ft.ctaText, (!selectedDifficulty || isValidating) && ft.ctaTextLocked]}>
                    {isValidating
                      ? 'Validation en cours…'
                      : selectedDifficulty === 'hard'
                        ? 'Reprendre depuis le début →'
                        : selectedDifficulty
                          ? 'Valider ma session →'
                          : 'Choisis une difficulté…'}
                  </Text>
                  {selectedDifficulty && !isValidating ? (
                    <Animated.View pointerEvents="none" style={[ft.ctaShine, { left: ctaShineX }]} />
                  ) : null}
                </Pressable>

                {/* SECONDARY ACTION */}
                {!isValidating && selectedDifficulty === 'hard' ? (
                  <Pressable style={ft.secondaryCta} onPress={handleValidate} disabled={isValidating}>
                    <Text style={ft.secondaryCtaText}>Valider quand même</Text>
                  </Pressable>
                ) : !isValidating && selectedDifficulty === 'hesitant' ? (
                  <Pressable style={ft.secondaryCta} onPress={openRestartConfirm}>
                    <Text style={ft.secondaryCtaText}>Reprendre depuis le début</Text>
                  </Pressable>
                ) : !isValidating && selectedDifficulty === 'easy' ? (
                  <Pressable style={ft.secondaryCtaDiscreet} onPress={openRestartConfirm}>
                    <Text style={ft.secondaryCtaDiscreetText}>Reprendre depuis le début</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              ft.cta,
              canContinue ? ft.ctaActive : ft.ctaLocked,
              pressed && canContinue && ft.ctaPressed,
            ]}
            onPress={mode === 'recite' ? handleReciteCta : handleCompareCta}
          >
            <Text style={[ft.ctaText, !canContinue && ft.ctaTextLocked]}>
              {mode === 'recite'
                ? (canContinue
                    ? (isSingleAyat ? 'J\'ai récité l\'ayat →' : 'J\'ai récité le passage →')
                    : (isSingleAyat ? 'Récite l\'ayat…' : 'Récite le passage…'))
                : (canContinue ? 'J\'ai comparé →' : 'Vérifie le passage…')}
            </Text>
            {canContinue ? (
              <Animated.View pointerEvents="none" style={[ft.ctaShine, { left: ctaShineX }]} />
            ) : null}
          </Pressable>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const ft = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  scroll:  { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 20 },
  halo:    { position: 'absolute', top: -50, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(22,48,38,0.07)', zIndex: 0 },
  ornLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: 'rgba(184,150,46,0.18)', zIndex: 0 },

  // header
  backBtn:        { alignSelf: 'flex-start', marginBottom: 6, paddingVertical: 2 },
  backBtnText:    { fontSize: 20, color: colors.primary, fontWeight: '300' },
  header:         { marginBottom: 12 },
  headerChip:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(184,150,46,0.13)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)', marginBottom: 8 },
  headerChipDot:  { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  headerChipText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 1.4 },
  headerTitle:    { fontSize: 24, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  headerSub:      { fontSize: 13, color: colors.muted, lineHeight: 20 },

  // context row
  contextRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  contextSurah:      { fontSize: 12, color: colors.muted, fontWeight: '600' },
  contextBadge:      { backgroundColor: 'rgba(22,48,38,0.08)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(22,48,38,0.15)' },
  contextBadgeText:  { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.6 },

  // card
  cardWrap:  { marginBottom: 10 },
  card:      { backgroundColor: '#FEFCF7', borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)', paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 16, shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },

  // mode badge
  modeBadge:           { alignSelf: 'flex-start', backgroundColor: 'rgba(22,48,38,0.08)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.16)', marginBottom: 12 },
  modeBadgeCompare:    { backgroundColor: 'rgba(45,106,79,0.10)', borderColor: 'rgba(45,106,79,0.28)' },
  modeBadgeEval:       { backgroundColor: 'rgba(184,150,46,0.12)', borderColor: 'rgba(184,150,46,0.32)' },
  modeBadgeText:       { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  modeBadgeTextCompare:{ color: colors.success },
  modeBadgeTextEval:   { color: colors.gold },

  // mode instruction
  modeInstruction: { fontSize: 13, color: colors.muted, lineHeight: 20, fontStyle: 'italic', marginBottom: 14 },

  // hidden card
  hiddenCard:    { backgroundColor: 'rgba(22,48,38,0.04)', borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.10)', alignItems: 'center', paddingVertical: 32, marginBottom: 8, overflow: 'hidden' },
  hiddenGlow:    { position: 'absolute', top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(45,106,79,0.08)' },
  hiddenDots:    { fontSize: 28, color: colors.primary, opacity: 0.30, letterSpacing: 6, marginBottom: 10 },
  hiddenCaption: { fontSize: 13, color: colors.primary, fontWeight: '700', marginBottom: 4 },
  hiddenRange:   { fontSize: 11, color: colors.muted, fontStyle: 'italic' },

  // compare view
  compareAyatBlock:  { borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.14)', paddingTop: 12, marginTop: 8 },
  compareAyatHeader: { marginBottom: 6 },
  compareAyatNum:    { fontSize: 10, fontWeight: '800', color: colors.gold, letterSpacing: 1.2, textTransform: 'uppercase' },
  compareArabic:     { fontSize: 20, color: colors.primary, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl', lineHeight: 34, marginBottom: 6 },
  compareTranslit:   { fontSize: 12, color: colors.muted, lineHeight: 19, fontStyle: 'italic', marginBottom: 4 },
  compareDivider:    { borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.10)', paddingTop: 6, marginTop: 4 },
  compareLabel:      { fontSize: 9, fontWeight: '800', color: colors.gold, letterSpacing: 1.2, marginBottom: 3, textTransform: 'uppercase' },
  compareTranslation:{ fontSize: 12, color: colors.muted, lineHeight: 18, fontStyle: 'italic' },
  fallbackText:      { fontSize: 13, color: colors.muted, fontStyle: 'italic' },

  // evaluation cards
  evalList:         { gap: 10 },
  evalCard:         { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(22,48,38,0.04)', borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.12)', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  evalCardSelected: { backgroundColor: 'rgba(22,48,38,0.10)', borderColor: colors.primary },
  evalDot:          { width: 12, height: 12, borderRadius: 6, backgroundColor: 'rgba(22,48,38,0.20)', borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.25)' },
  evalDotSelected:  { backgroundColor: colors.primary, borderColor: colors.primary },
  evalBody:         { flex: 1 },
  evalLabel:        { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  evalLabelSelected:{ color: colors.primary },
  evalSubtitle:     { fontSize: 12, color: colors.muted, lineHeight: 18 },
  evalCheck:        { fontSize: 16, color: colors.success, fontWeight: '800' },
  evalHint:         { fontSize: 11, color: colors.muted, lineHeight: 16, fontStyle: 'italic', marginTop: 4 },

  // guide line
  guideLine:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  guideAccent: { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.primary, opacity: 0.50 },
  guideText:   { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 18, fontStyle: 'italic' },

  // sticky CTA
  stickyBottom:  { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.14)', paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.xl },
  cta:           { borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  ctaActive:     { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.38 },
  ctaRestart:    { backgroundColor: 'rgba(22,48,38,0.80)', shadowColor: colors.primary, shadowOpacity: 0.25 },
  ctaLocked:     { backgroundColor: 'rgba(22,48,38,0.30)', shadowColor: 'transparent', shadowOpacity: 0, elevation: 0 },
  ctaPressed:    { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:       { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
  ctaTextLocked: { color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  ctaShine:      { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.10)', transform: [{ skewX: '-20deg' }] },

  // inline validation error
  validationError:     { backgroundColor: 'rgba(180,35,24,0.07)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(180,35,24,0.20)', paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
  validationErrorText: { fontSize: 12, color: '#B42318', lineHeight: 18, textAlign: 'center' },

  // helper text above secondary action
  helperText:               { fontSize: 11, color: colors.muted, lineHeight: 17, fontStyle: 'italic', textAlign: 'center', marginBottom: 8 },

  // secondary CTA — clearly visible (hesitant restart / hard validate-anyway)
  secondaryCta:             { marginTop: 8, alignItems: 'center', paddingVertical: 8 },
  secondaryCtaText:         { fontSize: 13, color: colors.primary, fontWeight: '700', textDecorationLine: 'underline', letterSpacing: 0.2 },

  // secondary CTA — discreet (easy restart)
  secondaryCtaDiscreet:     { marginTop: 6, alignItems: 'center', paddingVertical: 6 },
  secondaryCtaDiscreetText: { fontSize: 12, color: colors.muted, fontWeight: '500', textDecorationLine: 'underline' },

  // inline restart confirmation panel
  confirmPanel:   { flexDirection: 'row', backgroundColor: '#F3EDD8', borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.20)', overflow: 'hidden', marginBottom: 4, shadowColor: colors.primary, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  confirmAccent:  { width: 4, backgroundColor: colors.primary, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 },
  confirmBody:    { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  confirmTitle:   { fontSize: 14, fontWeight: '800', color: colors.primary, marginBottom: 4 },
  confirmDesc:    { fontSize: 12, color: colors.muted, lineHeight: 18, marginBottom: 10 },
  confirmActions: { flexDirection: 'row', gap: 8 },
  confirmCancel:  { flex: 1, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.22)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(22,48,38,0.05)' },
  confirmCancelText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  confirmOk:      { flex: 1, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  confirmOkText:  { fontSize: 13, color: '#FFF', fontWeight: '800' },

  // passage audio control (finalCompare)
  passageAudioWrap:      { marginBottom: 14, borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.30)', backgroundColor: '#FEFCF5', shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  passageAudioBtn:       { paddingHorizontal: spacing.lg, paddingVertical: 14 },
  passageAudioBtnPlaying:{ backgroundColor: 'rgba(22,48,38,0.06)' },
  passageAudioBtnPressed:{ opacity: 0.80 },
  passageAudioInner:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passageAudioIcon:      { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18 },
  passageAudioBar1:      { width: 3, height: 10, borderRadius: 2, backgroundColor: colors.primary },
  passageAudioBar2:      { width: 3, height: 18, borderRadius: 2, backgroundColor: colors.primary },
  passageAudioBar3:      { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.primary },
  passageAudioSpinner:      { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.gold, borderTopColor: 'transparent' },
  passageAudioPlayTriangle: { width: 0, height: 0, borderTopWidth: 6, borderTopColor: 'transparent', borderBottomWidth: 6, borderBottomColor: 'transparent', borderLeftWidth: 11, borderLeftColor: colors.primary, marginLeft: 2 },
  passageAudioLabel:     { fontSize: 14, fontWeight: '800', color: colors.primary, letterSpacing: 0.3 },
  passageAudioSub:       { fontSize: 10, color: colors.muted, marginTop: 2, letterSpacing: 0.3 },
  passageAudioError:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg, paddingBottom: 10 },
  passageAudioErrorText: { flex: 1, fontSize: 11, color: colors.muted },
  passageAudioRetry:     { paddingHorizontal: 10, paddingVertical: 3 },
  passageAudioRetryText: { fontSize: 11, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
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
