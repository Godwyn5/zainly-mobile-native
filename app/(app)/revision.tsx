// ─── Guided Reviews V1 ────────────────────────────────────────────────────────
// Route: /(app)/revision
// Phases: Intro → ReviewAyat → SelfEval → Transition → Summary
// No DB writes in this file. All writes via src/db/reviewItems.ts.
// Audio: reuses useAyatAudio. Stops on unmount.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Animated, Easing, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium, hapticSuccess, hapticWarning } from '@/utils/haptics';
import { useAuthStore }       from '@/store/authStore';
import { useDueReviewItems }  from '@/hooks/useDueReviewItems';
import { useLocalDate } from '@/hooks/useLocalDate';
import { advanceReviewItem } from '@/db/reviewItems';
import type { DueReviewItem } from '@/db/reviewItems';
import type { SessionDifficulty } from '@/db/progress';
import { getQuranAyahSync, getSurahName } from '@/core/quranContent';
import { getAyatAudioUrl } from '@/core/quranAudio';
import { useAyatAudio } from '@/hooks/useAyatAudio';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'intro' | 'review' | 'eval' | 'transition' | 'summary';

type EvalResult = {
  itemId:     string;
  difficulty: SessionDifficulty;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// localDateStr is now provided by useLocalDate() — see src/hooks/useLocalDate.ts

function nextReviewLabel(difficulty: SessionDifficulty, currentCycle: number): string {
  if (difficulty === 'hard' || difficulty === 'hesitant') return 'Demain';
  const nextCycle = currentCycle + 1;
  if (nextCycle >= 5) return 'Maîtrisé';
  const offsets = [1, 3, 7, 14, 30];
  return `J+${offsets[nextCycle]}`;
}

// ─── FadeSlide ────────────────────────────────────────────────────────────────
// Resets on key change to allow phase-transition re-entrance.

function FadeSlide({
  children, delay = 0, dy = 18,
}: { children: React.ReactNode; delay?: number; dy?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = Animated.timing(anim, {
      toValue: 1, duration: 440, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    t.start();
    return () => t.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={{
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }],
    }}>
      {children}
    </Animated.View>
  );
}

// ─── ProgressRail ─────────────────────────────────────────────────────────────

function ProgressRail({ total, current }: { total: number; current: number }) {
  const fillPct = total > 1 ? current / (total - 1) : 1;
  const dotAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(dotAnim, { toValue: 1.35, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.back(3)) }),
      Animated.timing(dotAnim, { toValue: 1.0,  duration: 180, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return (
    <View style={pr.wrap}>
      <View style={pr.track}>
        <Animated.View style={[pr.fill, { flex: fillPct }]} />
      </View>
      <View style={pr.dotsRow}>
        {Array.from({ length: total }).map((_, i) => {
          const isDone   = i < current;
          const isActive = i === current;
          return (
            <Animated.View
              key={i}
              style={[
                pr.dot,
                isDone   && pr.dotDone,
                isActive && pr.dotActive,
                isActive && { transform: [{ scale: dotAnim }] },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}
const pr = StyleSheet.create({
  wrap:    { marginBottom: spacing.md },
  track:   { height: 3, borderRadius: 2, backgroundColor: 'rgba(184,150,46,0.15)', marginBottom: 8, flexDirection: 'row' },
  fill:    { borderRadius: 2, backgroundColor: colors.gold, opacity: 0.75 },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  dot:     { width: 7, height: 7, borderRadius: 3.5, backgroundColor: 'rgba(184,150,46,0.20)' },
  dotDone: { backgroundColor: colors.gold, opacity: 0.55 },
  dotActive:{ width: 20, backgroundColor: colors.gold, borderRadius: 3.5 },
});

// ─── ZainlyEyeIcon ────────────────────────────────────────────────────────────
// Geometric icon: no emoji, no emoji library.
// Gold ring + deep green lens centre — represents "reveal / look inward".

function ZainlyEyeIcon() {
  return (
    <View style={eye.outer}>
      <View style={eye.ring}>
        <View style={eye.lens} />
      </View>
    </View>
  );
}
const eye = StyleSheet.create({
  outer: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(184,150,46,0.14)', alignItems: 'center', justifyContent: 'center' },
  ring:  { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  lens:  { width: 8,  height: 8,  borderRadius: 4, backgroundColor: colors.primary },
});

// ─── CheckmarkIcon ────────────────────────────────────────────────────────────

function CheckmarkIcon({ color, size = 11 }: { color: string; size?: number }) {
  return (
    <View style={[ci.wrap, { borderColor: color, width: size * 2.2, height: size * 2.2, borderRadius: size * 1.1 }]}>
      <Text style={[ci.mark, { color, fontSize: size }]}>✓</Text>
    </View>
  );
}
const ci = StyleSheet.create({
  wrap: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  mark: { fontWeight: '900' },
});

// ─── MethodCard (removed — inline steps used instead) ────────────────────────

const METHOD_STEPS = [
  { n: '1', text: 'Récite d\'abord sans regarder.' },
  { n: '2', text: 'Utilise l\'audio pour vérifier le rythme.' },
  { n: '3', text: 'Affiche l\'aide seulement si nécessaire.' },
  { n: '4', text: 'Évalue honnêtement.' },
];

// ─── PulseRing ────────────────────────────────────────────────────────────────
// Animated concentric ring — used behind the Transition seal.

function PulseRing({ size, color, delay = 0 }: { size: number; color: string; delay?: number }) {
  const scale   = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(scale,   { toValue: 1.5, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0,   duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(scale,   { toValue: 0.8, duration: 0, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
      ]),
    ]));
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size, height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ─── DiffBtn ──────────────────────────────────────────────────────────────────

function DiffBtn({
  label, sub, consequence, value, selected, onPress,
}: {
  label: string; sub: string; consequence: string;
  value: SessionDifficulty; selected: boolean; onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const accent =
    value === 'easy'     ? colors.success :
    value === 'hesitant' ? '#B8962E' :
    colors.danger;

  function pressIn()  { Animated.spring(scale, { toValue: 0.965, useNativeDriver: true, friction: 8, tension: 100 }).start(); }
  function pressOut() { Animated.spring(scale, { toValue: 1.000, useNativeDriver: true, friction: 8, tension: 100 }).start(); }

  return (
    <Animated.View style={{ transform: [{ scale }], marginBottom: 10 }}>
      <Pressable
        style={[
          dib.btn,
          selected && { borderColor: accent, backgroundColor: accent + '12', shadowColor: accent, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
        ]}
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
      >
        <View style={[dib.accentBar, { backgroundColor: accent }]} />
        <View style={{ flex: 1, paddingLeft: 10 }}>
          <Text style={[dib.label, selected && { color: accent }]}>{label}</Text>
          <Text style={dib.sub}>{sub}</Text>
          {selected && (
            <Text style={[dib.consequence, { color: accent }]}>{consequence}</Text>
          )}
        </View>
        {selected && <CheckmarkIcon color={accent} />}
      </Pressable>
    </Animated.View>
  );
}
const dib = StyleSheet.create({
  btn:         { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 14, overflow: 'hidden' },
  accentBar:   { width: 4, alignSelf: 'stretch', borderRadius: 2, marginRight: 4 },
  label:       { fontSize: 16, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  sub:         { fontSize: 12, color: colors.muted, lineHeight: 17 },
  consequence: { fontSize: 11, fontWeight: '700', lineHeight: 17, marginTop: 4 },
});

// ─── ReviewAudioBtn ───────────────────────────────────────────────────────────

function ReviewAudioBtn({ surahNumber, ayahNumber }: { surahNumber: number; ayahNumber: number }) {
  const url   = getAyatAudioUrl({ surahNumber, ayahNumber });
  const audio = useAyatAudio(url, () => {});
  const isEffective = audio.isPlaying || audio.isIntendingToPlay;

  useEffect(() => () => { audio.stop(); }, []);  // stop on unmount

  function handlePress() {
    hapticLight();
    if (audio.hasCompleted) { audio.replay(); return; }
    if (audio.isPlaying)    { audio.pause();  return; }
    if (audio.isPaused)     { audio.resume(); return; }
    audio.play();
  }

  const effectivePaused  = audio.isPaused;
  const btnLabel =
    audio.hasError     ? 'Réessayer' :
    effectivePaused    ? 'Reprendre' :
    isEffective        ? 'Pause' :
    audio.hasCompleted ? 'Réécouter l\'ayat' :
    'Écouter l\'ayat';

  return (
    <Pressable
      style={({ pressed }) => [aud.btn, isEffective && aud.btnActive, effectivePaused && aud.btnPaused, pressed && { opacity: 0.82 }]}
      onPress={handlePress}
    >
      <View style={aud.iconWrap}>
        {audio.isLoadingVisible ? (
          <View style={aud.spinner} />
        ) : isEffective ? (
          <View style={aud.barsRow}>
            <View style={aud.bar1} /><View style={aud.bar2} /><View style={aud.bar3} />
          </View>
        ) : (
          <View style={aud.triangle} />
        )}
      </View>
      <Text style={[aud.label, isEffective && { color: colors.primary }, effectivePaused && { color: colors.primary }]}>{btnLabel}</Text>
    </Pressable>
  );
}
const aud = StyleSheet.create({
  btn:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.goldSoft, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.38)', paddingHorizontal: 18, paddingVertical: 13, alignSelf: 'flex-start' },
  btnActive: { backgroundColor: 'rgba(22,48,38,0.06)', borderColor: colors.primary },
  btnPaused: { backgroundColor: 'rgba(22,48,38,0.04)', borderColor: 'rgba(22,48,38,0.35)' },
  iconWrap:  { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  spinner:   { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.gold, borderTopColor: 'transparent' },
  barsRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  bar1:      { width: 3, height: 9,  borderRadius: 2, backgroundColor: colors.primary },
  bar2:      { width: 3, height: 16, borderRadius: 2, backgroundColor: colors.primary },
  bar3:      { width: 3, height: 11, borderRadius: 2, backgroundColor: colors.primary },
  triangle:  { width: 0, height: 0, borderTopWidth: 6, borderTopColor: 'transparent', borderBottomWidth: 6, borderBottomColor: 'transparent', borderLeftWidth: 11, borderLeftColor: colors.gold, marginLeft: 2 },
  label:     { fontSize: 14, fontWeight: '700', color: colors.gold },
  sub:       { fontSize: 11, color: colors.muted, marginTop: 2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function RevisionScreen() {
  const user   = useAuthStore(s => s.user);
  const userId = user?.id;
  const qc     = useQueryClient();
  const today  = useLocalDate();

  // Fetch the due items batch — used only for the one-shot capture below.
  const { data: dueItems, isLoading, isError, refetch } = useDueReviewItems(userId);

  // ── frozen session batch ──────────────────────────────────────────────────
  // Once dueItems resolves (empty or not), we copy it into sessionItems and
  // never touch it again from query data. Any subsequent React Query refetch,
  // focus event, or invalidation cannot reorder or shrink the active session.
  const [sessionItems,      setSessionItems]      = useState<DueReviewItem[]>([]);
  const [hasCapturedBatch,  setHasCapturedBatch]  = useState(false);
  const [batchSize,         setBatchSize]         = useState(0);

  useEffect(() => {
    if (hasCapturedBatch) return;
    if (dueItems === undefined) return;
    setSessionItems(dueItems);
    setBatchSize(dueItems.length);
    setHasCapturedBatch(true);
  }, [dueItems, hasCapturedBatch]);

  // ── session state ──
  const [phase,          setPhase]          = useState<Phase>('intro');
  const [currentIndex,   setCurrentIndex]   = useState(0);
  const [helpShown,      setHelpShown]       = useState(false);
  const [selectedDiff,   setSelectedDiff]   = useState<SessionDifficulty | null>(null);
  const [lastDiff,       setLastDiff]       = useState<SessionDifficulty | null>(null);
  const [isSubmitting,   setIsSubmitting]   = useState(false);
  const [submitError,    setSubmitError]    = useState<string | null>(null);
  const [evalResults,    setEvalResults]    = useState<EvalResult[]>([]);
  const submittedIds = useRef<Set<string>>(new Set());

  const currentItem = sessionItems[currentIndex] ?? null;
  const isLastItem  = currentIndex === sessionItems.length - 1;

  // ── ayat content (sync, no flash) ──
  const ayatContent = useMemo(() => {
    if (!currentItem) return null;
    const res = getQuranAyahSync({
      surahNumber: currentItem.surah_number,
      fromAyah:    currentItem.ayah,
      toAyah:      currentItem.ayah,
    });
    if (!res.ok || res.ayahs.length === 0) return null;
    return res.ayahs[0];
  }, [currentItem]);

  const surahName = useMemo(
    () => currentItem ? (getSurahName(currentItem.surah_number) ?? `Sourate ${currentItem.surah_number}`) : '',
    [currentItem],
  );

  // ── phase transitions ──
  const goToPhase = useCallback((p: Phase) => { setPhase(p); }, []);

  function startSession() {
    hapticMedium();
    setCurrentIndex(0);
    setHelpShown(false);
    setSelectedDiff(null);
    setSubmitError(null);
    goToPhase('review');
  }

  function showHelp() {
    hapticLight();
    setHelpShown(true);
  }

  function selectDiff(d: SessionDifficulty) {
    hapticLight();
    setSelectedDiff(d);
  }

  async function submitEval() {
    if (!selectedDiff || !currentItem || isSubmitting) return;
    if (submittedIds.current.has(currentItem.id)) {
      advanceAfterEval(selectedDiff);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    hapticMedium();

    const { error } = await advanceReviewItem({
      itemId:     currentItem.id,
      difficulty: selectedDiff,
    });

    if (error) {
      setIsSubmitting(false);
      setSubmitError(error.message);
      hapticWarning();
      return;
    }

    submittedIds.current.add(currentItem.id);
    setEvalResults(prev => [...prev, { itemId: currentItem.id, difficulty: selectedDiff }]);

    // Invalidate immediately — marks stale, no active refetch mid-session.
    // Dashboard will see fresh counts when user navigates back.
    qc.invalidateQueries({ queryKey: ['dueReviews',     userId, today], refetchType: 'none' });
    qc.invalidateQueries({ queryKey: ['dueReviewItems', userId, today], refetchType: 'none' });
    qc.invalidateQueries({ queryKey: ['learnedItems',   userId],        refetchType: 'none' });

    hapticSuccess();
    advanceAfterEval(selectedDiff);
  }

  function advanceAfterEval(diff: SessionDifficulty) {
    setLastDiff(diff);
    setIsSubmitting(false);
    setSelectedDiff(null);
    setSubmitError(null);
    goToPhase('transition');
  }

  function nextItem() {
    hapticLight();
    if (isLastItem) {
      qc.invalidateQueries({ queryKey: ['dueReviews',     userId, today] });
      qc.invalidateQueries({ queryKey: ['dueReviewItems', userId, today] });
      qc.invalidateQueries({ queryKey: ['learnedItems',   userId] });
      goToPhase('summary');
    } else {
      setCurrentIndex(i => i + 1);
      setHelpShown(false);
      setSelectedDiff(null);
      setSubmitError(null);
      goToPhase('review');
    }
  }

  function goToSummary() {
    hapticLight();
    qc.invalidateQueries({ queryKey: ['dueReviews',     userId, today] });
    qc.invalidateQueries({ queryKey: ['dueReviewItems', userId, today] });
    qc.invalidateQueries({ queryKey: ['learnedItems',   userId] });
    goToPhase('summary');
  }

  // ── eval stats ──
  const evalStats = useMemo(() => ({
    easy:     evalResults.filter(r => r.difficulty === 'easy').length,
    hesitant: evalResults.filter(r => r.difficulty === 'hesitant').length,
    hard:     evalResults.filter(r => r.difficulty === 'hard').length,
    total:    evalResults.length,
  }), [evalResults]);

  // ── thresholds ──
  const isHeavyLoad = batchSize >= 6;

  // ─────────── LOADING ─────────────────────────────────────────────────────────

  if (isLoading || !hasCapturedBatch) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Animated.View style={s.loadingOrb} />
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={s.loadingText}>Zainly prépare tes révisions…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─────────── ERROR ───────────────────────────────────────────────────────────

  if (isError) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <View style={s.errorCard}>
            <View style={s.errorAccent} />
            <Text style={s.errorTitle}>Impossible de charger les révisions</Text>
            <Text style={s.errorSub}>Vérifie ta connexion puis réessaie.</Text>
            <Pressable style={s.retryBtn} onPress={() => { hapticLight(); refetch(); }}>
              <Text style={s.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ─────────── EMPTY ───────────────────────────────────────────────────────────

  if (sessionItems.length === 0 && phase === 'intro') {
    return (
      <SafeAreaView style={s.safe}>
        <Background />
        <View style={s.center}>
          <FadeSlide>
            <View style={s.emptyCard}>
              <View style={s.emptyGoldLine} />
              <Text style={s.emptyTitle}>Ton Hifz est à jour</Text>
              <Text style={s.emptySub}>
                Aucune révision due aujourd'hui.{'\n'}Tu peux avancer sereinement.
              </Text>
              <Pressable style={s.primaryBtn} onPress={() => { hapticLight(); router.replace('/(app)/(tabs)/'); }}>
                <Text style={s.primaryBtnText}>Retour à Aujourd'hui</Text>
              </Pressable>
            </View>
          </FadeSlide>
        </View>
      </SafeAreaView>
    );
  }

  // ─────────── PHASE: INTRO ────────────────────────────────────────────────────

  if (phase === 'intro') {
    const count  = sessionItems.length;
    const plural = count > 1 ? 's' : '';

    const headerLine = isHeavyLoad
      ? 'Zainly consolide ta base avant d\'avancer.'
      : 'Avant d\'ajouter du nouveau, Zainly protège ce que tu as déjà mémorisé.';

    const microCopy = isHeavyLoad
      ? 'Zainly réduit la charge aujourd\'hui pour éviter d\'ajouter du nouveau sur une base fragile.'
      : 'Ta charge est légère. On révise d\'abord, puis tu pourras avancer.';

    return (
      <SafeAreaView style={s.safe}>
        <Background />
        {/* Fixed single-screen layout — flex distributes space, no scroll needed */}
        <View style={s.introRoot}>

          <FadeSlide>
            <View style={s.pill}>
              <View style={s.pillDot} />
              <Text style={s.pillText}>RÉVISIONS DU JOUR</Text>
            </View>
          </FadeSlide>

          {/* Hero card */}
          <FadeSlide delay={80}>
            <View style={s.introHero}>
              <View style={s.introHeroGoldRail} />
              <Text style={s.introHeroLabel}>Aujourd'hui, tu consolides ton Hifz.</Text>
              <View style={s.introHeroRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.introHeroTitle}>{count} ayat{plural} à protéger.</Text>
                  <Text style={s.introHeroSub}>{headerLine}</Text>
                </View>
                <View style={s.introHeroBadge}>
                  <Text style={s.introHeroBadgeNum}>{count}</Text>
                  <Text style={s.introHeroBadgeLbl}>{count <= 3 ? '~5 min' : count <= 6 ? '~10 min' : '~15 min'}</Text>
                </View>
              </View>
            </View>
          </FadeSlide>

          {/* Compact inline method steps */}
          <FadeSlide delay={160}>
            <View style={s.introSteps}>
              {METHOD_STEPS.map((step, i) => (
                <View key={i} style={s.introStep}>
                  <View style={s.introStepNum}><Text style={s.introStepNumText}>{step.n}</Text></View>
                  <Text style={s.introStepText}>{step.text}</Text>
                </View>
              ))}
            </View>
          </FadeSlide>

          {/* Microcopy note */}
          <FadeSlide delay={230}>
            <View style={s.noteCard}>
              <View style={s.noteGoldBar} />
              <Text style={s.noteText}>{microCopy}</Text>
            </View>
          </FadeSlide>

          {/* CTAs — pushed to bottom */}
          <View style={{ flex: 1 }} />
          <FadeSlide delay={300}>
            <View style={s.introCta}>
              <Pressable
                style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                onPress={startSession}
              >
                <Text style={s.primaryBtnText}>Commencer la révision</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.6 }]}
                onPress={() => { hapticLight(); router.replace('/(app)/(tabs)/'); }}
              >
                <Text style={s.ghostBtnText}>Retour à Aujourd'hui</Text>
              </Pressable>
            </View>
          </FadeSlide>

        </View>
      </SafeAreaView>
    );
  }

  // ─────────── PHASE: REVIEW AYAT ──────────────────────────────────────────────

  if (phase === 'review') {
    if (!currentItem) { goToPhase('summary'); return null; }

    return (
      <SafeAreaView style={s.safe} key={`review-${currentIndex}`}>
        <Background />
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Progress rail */}
          <FadeSlide>
            <View style={s.progressHeader}>
              <ProgressRail total={sessionItems.length} current={currentIndex} />
              <Text style={s.progressLabel}>{currentIndex + 1} sur {sessionItems.length}</Text>
            </View>
          </FadeSlide>

          {/* Ayat identity chip */}
          <FadeSlide delay={60}>
            <View style={s.ayatIdentity}>
              <View style={s.ayatIdentityGold}>
                <View style={s.ayatIdentityDot} />
              </View>
              <View>
                <Text style={s.ayatIdentityName}>{surahName.toUpperCase()}</Text>
                <Text style={s.ayatIdentityNum}>Ayat {currentItem.ayah}</Text>
              </View>
            </View>
          </FadeSlide>

          {/* Coach instruction */}
          <FadeSlide delay={100}>
            <Text style={s.recallTitle}>Essaie de réciter cet ayat.</Text>
            <Text style={s.recallSub}>
              {helpShown
                ? 'Aide affichée. Lis une fois, puis essaie de réciter à nouveau sans regarder.'
                : 'Essaie d\'abord sans regarder. Ne cherche pas la vitesse — cherche la solidité.'}
            </Text>
          </FadeSlide>

          {/* Help card — hidden → revealed */}
          <FadeSlide delay={150}>
            {!helpShown ? (
              <Pressable
                style={({ pressed }) => [s.helpCard, pressed && { opacity: 0.78 }]}
                onPress={showHelp}
                accessibilityLabel="Afficher l'aide"
              >
                <ZainlyEyeIcon />
                <View style={{ flex: 1 }}>
                  <Text style={s.helpTitle}>Afficher l'aide</Text>
                  <Text style={s.helpSub}>Arabe · Translittération · Traduction</Text>
                </View>
                <View style={s.helpChevron}><Text style={s.helpChevronText}>›</Text></View>
              </Pressable>
            ) : (
              <View style={s.ayatCard}>
                <View style={s.ayatGoldRail} />
                <View style={{ flex: 1 }}>
                  <Text style={s.ayatArabic}>{ayatContent?.arabic ?? '—'}</Text>
                  {ayatContent?.transliteration ? (
                    <Text style={s.ayatTranslit}>{ayatContent.transliteration}</Text>
                  ) : null}
                  {ayatContent?.translationFr ? (
                    <View style={s.ayatTranslationWrap}>
                      <Text style={s.ayatTranslation}>{ayatContent.translationFr}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          </FadeSlide>

          {/* Audio control */}
          <FadeSlide delay={200}>
            <View style={s.audioRow}>
              <ReviewAudioBtn surahNumber={currentItem.surah_number} ayahNumber={currentItem.ayah} />
            </View>
          </FadeSlide>

          {/* Blocking cue when help not shown */}
          {!helpShown && (
            <FadeSlide delay={240}>
              <View style={s.recallHint}>
                <View style={s.recallHintDot} />
                <Text style={s.recallHintText}>Si tu bloques, affiche l'aide puis recommence.</Text>
              </View>
            </FadeSlide>
          )}

          {/* CTA */}
          <FadeSlide delay={280}>
            <View style={s.ctaArea}>
              <Pressable
                style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                onPress={() => { hapticLight(); goToPhase('eval'); }}
              >
                <Text style={s.primaryBtnText}>Je suis prêt à m'évaluer</Text>
              </Pressable>
            </View>
          </FadeSlide>

        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────── PHASE: SELF EVALUATION ──────────────────────────────────────────

  if (phase === 'eval') {
    return (
      <SafeAreaView style={s.safe} key={`eval-${currentIndex}`}>
        <Background />
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          <FadeSlide>
            <View style={s.progressHeader}>
              <ProgressRail total={sessionItems.length} current={currentIndex} />
              <Text style={s.progressLabel}>{currentIndex + 1} sur {sessionItems.length}</Text>
            </View>
          </FadeSlide>

          <FadeSlide delay={60}>
            <View style={s.pill}>
              <View style={s.pillDot} />
              <Text style={s.pillText}>AUTO-ÉVALUATION</Text>
            </View>
            <Text style={s.evalTitle}>Comment était ta récitation ?</Text>
            <Text style={s.evalSub}>
              Sois honnête. Zainly adaptera la prochaine révision selon ta réponse.
            </Text>
          </FadeSlide>

          <FadeSlide delay={120}>
            <View style={s.diffBtns}>
              <DiffBtn
                label="Facile"
                sub="Je l'ai récité avec fluidité."
                consequence="Zainly espacera la prochaine révision."
                value="easy"
                selected={selectedDiff === 'easy'}
                onPress={() => selectDiff('easy')}
              />
              <DiffBtn
                label="Hésitant"
                sub="Je l'ai récité, mais avec quelques blocages."
                consequence="Zainly la rapprochera pour l'ancrer."
                value="hesitant"
                selected={selectedDiff === 'hesitant'}
                onPress={() => selectDiff('hesitant')}
              />
              <DiffBtn
                label="Difficile"
                sub="J'ai eu besoin d'aide ou je ne l'ai pas retrouvé."
                consequence="Ce n'est pas un échec. Zainly la gardera proche."
                value="hard"
                selected={selectedDiff === 'hard'}
                onPress={() => selectDiff('hard')}
              />
            </View>
          </FadeSlide>

          {submitError ? (
            <FadeSlide>
              <View style={s.errorInline}>
                <Text style={s.errorInlineText}>{submitError}</Text>
              </View>
            </FadeSlide>
          ) : null}

          <FadeSlide delay={200}>
            <View style={s.ctaArea}>
              <Pressable
                style={({ pressed }) => [
                  s.primaryBtn,
                  (!selectedDiff || isSubmitting) && s.btnDisabled,
                  pressed && selectedDiff && !isSubmitting && s.btnPressed,
                ]}
                onPress={submitEval}
                disabled={!selectedDiff || isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={selectedDiff ? '#FFF' : colors.muted} size="small" />
                ) : (
                  <Text style={[s.primaryBtnText, !selectedDiff && { color: colors.muted }]}>
                    {selectedDiff ? 'Valider mon évaluation' : 'Choisis une évaluation'}
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { hapticLight(); goToPhase('review'); }}
              >
                <Text style={s.secondaryBtnText}>Revoir l'ayat</Text>
              </Pressable>
            </View>
          </FadeSlide>

        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─────────── PHASE: TRANSITION ───────────────────────────────────────────────

  if (phase === 'transition') {
    const diff  = lastDiff;
    const cycle = currentItem?.review_cycle ?? 0;

    const title =
      diff === 'easy'     ? 'Solide.' :
      diff === 'hesitant' ? 'À renforcer.' :
      'Noté.';

    const body =
      diff === 'easy'     ? 'Zainly espace la prochaine révision. Cet ayat devient plus ancré.' :
      diff === 'hesitant' ? 'Encore un peu fragile. On le reverra bientôt pour l\'ancrer.' :
      'Ce n\'est pas un échec. C\'est un signal : cet ayat doit rester proche.';

    // Seal accent — ring + glow tint. Checkmark always white on deep green bg.
    const sealAccent =
      diff === 'easy'     ? colors.success :
      diff === 'hesitant' ? colors.gold :
      'rgba(184,150,46,0.80)';

    const nextLabel = diff ? nextReviewLabel(diff, cycle) : '—';

    return (
      <SafeAreaView style={s.safe} key={`transition-${currentIndex}`}>
        <Background />
        {/* Layout: top area (seal+text+badge) centered, CTA pinned to bottom */}
        <View style={s.transRoot}>

          {/* center content */}
          <View style={s.transCenter}>

            {/* Seal */}
            <FadeSlide dy={12}>
              <View style={s.sealWrap}>
                <PulseRing size={120} color={sealAccent} delay={0} />
                <PulseRing size={120} color={sealAccent} delay={600} />
                {/* gold halo glow */}
                <View style={[s.sealHalo, { shadowColor: sealAccent }]} />
                <View style={[s.seal, { borderColor: sealAccent, shadowColor: sealAccent }]}>
                  {/* checkmark always white — legible on deep green */}
                  <Text style={s.sealCheck}>✓</Text>
                </View>
              </View>
            </FadeSlide>

            {/* Title + body */}
            <FadeSlide delay={140} dy={14}>
              <Text style={s.transTitle}>{title}</Text>
              <Text style={s.transBody}>{body}</Text>
            </FadeSlide>

            {/* Next review badge */}
            <FadeSlide delay={260} dy={10}>
              <View style={s.nextBadge}>
                <Text style={s.nextBadgeLabel}>PROCHAINE RÉVISION</Text>
                <Text style={[s.nextBadgeVal, { color: sealAccent }]}>{nextLabel}</Text>
              </View>
            </FadeSlide>

          </View>

          {/* CTA pinned to bottom — full-width via alignSelf stretch */}
          <FadeSlide delay={380} dy={8}>
            <View style={s.transCta}>
              {isLastItem ? (
                <Pressable
                  style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                  onPress={goToSummary}
                >
                  <Text style={s.primaryBtnText}>Voir le résumé</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                  onPress={nextItem}
                >
                  <Text style={s.primaryBtnText}>Ayat suivant</Text>
                </Pressable>
              )}
            </View>
          </FadeSlide>

        </View>
      </SafeAreaView>
    );
  }

  // ─────────── PHASE: SUMMARY ──────────────────────────────────────────────────

  if (phase === 'summary') {
    const reviewsDone = evalStats.total;

    // ── Correct canContinueToNewAyat logic ───────────────────────────────────────
    // All evaluations were easy, no hesitant/hard, light initial load (≤5)
    const allEasy            = evalStats.easy > 0 && evalStats.hesitant === 0 && evalStats.hard === 0;
    const hasHesitant        = evalStats.hesitant > 0;
    const hasHard            = evalStats.hard > 0;
    const hasRemaining       = isHeavyLoad;  // batchSize ≥6 → likely more due after this batch
    const canContinueToNewAyat = allEasy && !hasRemaining && batchSize <= 5;

    // ── Dynamic subtitle ──────────────────────────────────────────────────
    const summarySub =
      canContinueToNewAyat ? 'Ton Hifz du jour est consolidé.' :
      hasHard              ? 'Zainly garde cet ayat proche pour le renforcer.' :
      hasHesitant          ? 'Ton Hifz avance avec prudence.' :
      hasRemaining         ? 'Une partie du Hifz reste à consolider.' :
      'Ton Hifz du jour est consolidé.';

    // ── Coach message ─────────────────────────────────────────────────────
    const coachMsg =
      canContinueToNewAyat ? 'Ta base est protégée. Tu peux maintenant ajouter du nouveau.' :
      hasHard              ? 'Cet ayat mérite d\'être rapproché. Aujourd\'hui, la consolidation reste la priorité.' :
      hasHesitant          ? 'Certains ayats sont encore à renforcer. Zainly les rapprochera avant d\'ajouter trop de nouveau.' :
      hasRemaining         ? 'Il reste des révisions à consolider. Zainly protège ton Hifz avant d\'ajouter du nouveau.' :
      'Aujourd\'hui, la consolidation était la priorité. Ton Hifz est plus ancré.';

    return (
      <SafeAreaView style={s.safe}>
        <Background />
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Hero seal + title */}
          <FadeSlide>
            <View style={s.summaryHero}>
              <SummarySealIcon />
              <View style={{ flex: 1 }}>
                <Text style={s.summaryTitle}>Révisions terminées</Text>
                <Text style={s.summarySub}>{summarySub}</Text>
              </View>
            </View>
          </FadeSlide>

          {/* Stats */}
          <FadeSlide delay={90}>
            <View style={s.statsCard}>
              <View style={s.statsGoldRail} />
              <View style={s.statsRow}>
                <View style={s.statCell}>
                  <Text style={[s.statVal, { color: colors.primary }]}>{reviewsDone}</Text>
                  <Text style={s.statLbl}>Revus</Text>
                </View>
                <View style={s.statSep} />
                <View style={s.statCell}>
                  <Text style={[s.statVal, { color: colors.success }]}>{evalStats.easy}</Text>
                  <Text style={s.statLbl}>Faciles</Text>
                </View>
                <View style={s.statSep} />
                <View style={s.statCell}>
                  <Text style={[s.statVal, { color: colors.gold }]}>{evalStats.hesitant}</Text>
                  <Text style={s.statLbl}>Hésitants</Text>
                </View>
                <View style={s.statSep} />
                <View style={s.statCell}>
                  <Text style={[s.statVal, { color: evalStats.hard > 0 ? '#B42318' : colors.muted }]}>{evalStats.hard}</Text>
                  <Text style={s.statLbl}>Difficiles</Text>
                </View>
              </View>
            </View>
          </FadeSlide>

          {/* Coach card */}
          <FadeSlide delay={160}>
            <View style={s.coachCard}>
              <View style={s.coachGoldBar} />
              <View style={s.coachBody}>
                <Text style={s.coachPlan}>Planning ajusté.</Text>
                <Text style={s.coachMsg}>{coachMsg}</Text>
              </View>
            </View>
          </FadeSlide>

          {/* CTAs */}
          <FadeSlide delay={240}>
            <View style={s.ctaArea}>
              {canContinueToNewAyat ? (
                <>
                  <Pressable
                    style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                    onPress={() => { hapticMedium(); router.replace('/(app)/session'); }}
                  >
                    <Text style={s.primaryBtnText}>Continuer avec le nouvel ayat</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => { hapticLight(); router.replace('/(app)/(tabs)/'); }}
                  >
                    <Text style={s.secondaryBtnText}>Retour à Aujourd'hui</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable
                    style={({ pressed }) => [s.primaryBtn, pressed && s.btnPressed]}
                    onPress={() => { hapticMedium(); router.replace('/(app)/(tabs)/'); }}
                  >
                    <Text style={s.primaryBtnText}>Retour à Aujourd'hui</Text>
                  </Pressable>
                </>
              )}
            </View>
          </FadeSlide>

        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

// ─── SummarySealIcon ──────────────────────────────────────────────────────────
// Animated completion seal for the Summary hero row.

function SummarySealIcon() {
  const scale   = useRef(new Animated.Value(0.72)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(80),
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1.06, useNativeDriver: true, tension: 200, friction: 12 }),
        Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.spring(scale, { toValue: 1.00, useNativeDriver: true, tension: 180, friction: 14 }),
    ]).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.38] });

  return (
    <Animated.View style={[sumSeal.wrap, { opacity, transform: [{ scale }] }]}>
      <Animated.View style={[sumSeal.halo, { opacity: glowOpacity }]} />
      <View style={sumSeal.seal}>
        <Text style={sumSeal.check}>✓</Text>
      </View>
    </Animated.View>
  );
}
const sumSeal = StyleSheet.create({
  wrap:  { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  halo:  { position: 'absolute', width: 68, height: 68, borderRadius: 34, backgroundColor: colors.gold },
  seal:  { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, borderWidth: 2.5, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', shadowColor: colors.gold, shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  check: { fontSize: 24, color: '#FFF', fontWeight: '900', ...Platform.select({ android: { lineHeight: 30 } }) },
});

// ─── Background decorations ───────────────────────────────────────────────────

function Background() {
  const haloScale   = useRef(new Animated.Value(1)).current;
  const haloOpacity = useRef(new Animated.Value(0.10)).current;
  const goldScale   = useRef(new Animated.Value(1)).current;
  const goldOpacity = useRef(new Animated.Value(0.06)).current;

  useEffect(() => {
    const loop1 = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.07, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.17, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.00, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.10, duration: 5000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ]));
    const loop2 = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(goldScale,   { toValue: 1.12, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(goldOpacity, { toValue: 0.11, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(goldScale,   { toValue: 1.00, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(goldOpacity, { toValue: 0.06, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ]));
    loop1.start();
    loop2.start();
    return () => { loop1.stop(); loop2.stop(); };
  }, []);

  return (
    <>
      <Animated.View pointerEvents="none" style={[bgS.greenHalo, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
      <Animated.View pointerEvents="none" style={[bgS.goldHalo,  { transform: [{ scale: goldScale  }], opacity: goldOpacity }]} />
      <View pointerEvents="none" style={bgS.ornLine1} />
      <View pointerEvents="none" style={bgS.ornLine2} />
      <View pointerEvents="none" style={bgS.ornDot1} />
      <View pointerEvents="none" style={bgS.ornDot2} />
      <View pointerEvents="none" style={bgS.ornDot3} />
    </>
  );
}
const bgS = StyleSheet.create({
  greenHalo:{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(22,48,38,1)', zIndex: 0 },
  goldHalo: { position: 'absolute', top: 280, left: -120, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(184,150,46,1)', zIndex: 0 },
  ornLine1: { position: 'absolute', top: 160, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.12)', zIndex: 0 },
  ornLine2: { position: 'absolute', top: 500, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.08)', zIndex: 0 },
  ornDot1:  { position: 'absolute', top: 158, right: spacing.lg + 20, width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(184,150,46,0.30)', zIndex: 0 },
  ornDot2:  { position: 'absolute', top: 498, left: spacing.lg + 20, width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(184,150,46,0.22)', zIndex: 0 },
  ornDot3:  { position: 'absolute', top: 80,  left: spacing.lg + 60, width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(184,150,46,0.18)', zIndex: 0 },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.background },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll:  { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 56 },

  // loading
  loadingOrb:  { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(22,48,38,0.06)', marginBottom: 20 },
  loadingText: { marginTop: 14, fontSize: 14, color: colors.muted, textAlign: 'center' },

  // error
  errorCard:   { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center', gap: 10, overflow: 'hidden', width: '100%' },
  errorAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: colors.danger },
  errorTitle:  { fontSize: 17, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 8 },
  errorSub:    { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  retryBtn:    { marginTop: 6, paddingHorizontal: 24, paddingVertical: 11, borderRadius: 14, backgroundColor: colors.primary },
  retryText:   { color: '#FFF', fontWeight: '700', fontSize: 14 },

  // empty
  emptyCard:    { backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)', padding: spacing.lg, gap: 12, overflow: 'hidden', width: '100%', shadowColor: colors.gold, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  emptyGoldLine:{ height: 3, backgroundColor: colors.gold, borderRadius: 2, marginBottom: 4 },
  emptyTitle:   { fontSize: 20, fontWeight: '800', color: colors.primary },
  emptySub:     { fontSize: 14, color: colors.muted, lineHeight: 22 },

  // pill label (replaces "chip")
  pill:    { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(184,150,46,0.14)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(184,150,46,0.35)', marginBottom: 18 },
  pillDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 7 },
  pillText:{ fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: colors.gold },

  // intro layout (single-screen fixed, no scroll)
  introRoot:        { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },

  // intro hero
  introHero:         { backgroundColor: colors.primary, borderRadius: 22, padding: spacing.md, paddingTop: 16, marginBottom: 12, overflow: 'hidden' },
  introHeroGoldRail: { height: 3, backgroundColor: colors.gold, width: 36, borderRadius: 2, marginBottom: 10, opacity: 0.80 },
  introHeroLabel:    { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.45)', marginBottom: 6, textTransform: 'uppercase' },
  introHeroRow:      { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  introHeroTitle:    { fontSize: 22, fontWeight: '900', color: '#FFF', lineHeight: 30, marginBottom: 6 },
  introHeroSub:      { fontSize: 12, color: 'rgba(255,255,255,0.58)', lineHeight: 18 },
  introHeroBadge:    { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(184,150,46,0.35)', marginBottom: 4 },
  introHeroBadgeNum: { fontSize: 28, fontWeight: '900', color: colors.gold, lineHeight: 32 },
  introHeroBadgeLbl: { fontSize: 9, color: 'rgba(255,255,255,0.50)', fontWeight: '700', letterSpacing: 0.3, marginTop: 1 },

  // intro compact steps
  introSteps:       { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(184,150,46,0.25)', padding: 14, marginBottom: 10, gap: 8 },
  introStep:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  introStepNum:     { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(184,150,46,0.18)', alignItems: 'center', justifyContent: 'center' },
  introStepNumText: { fontSize: 10, fontWeight: '900', color: colors.gold },
  introStepText:    { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 18 },

  // intro CTA
  introCta: { gap: 10, paddingBottom: 4 },
  ghostBtn:     { height: 44, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, fontWeight: '600', color: colors.muted },

  // meta row
  metaRow:  { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  metaCell: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  metaVal:  { fontSize: 22, fontWeight: '900', color: colors.primary },
  metaLbl:  { fontSize: 10, color: colors.muted, fontWeight: '600', letterSpacing: 0.5, marginTop: 3 },
  metaSep:  { width: 1, backgroundColor: colors.border, marginVertical: 12 },

  // note card
  noteCard:   { flexDirection: 'row', backgroundColor: colors.goldSoft, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)', marginBottom: spacing.md, overflow: 'hidden' },
  noteGoldBar:{ width: 3, backgroundColor: colors.gold },
  noteText:   { flex: 1, fontSize: 13, color: colors.primary, lineHeight: 20, padding: spacing.md, fontStyle: 'italic' },

  // progress
  progressHeader: { marginBottom: 6 },
  progressLabel:  { fontSize: 11, fontWeight: '700', color: colors.muted, textAlign: 'right', letterSpacing: 0.3 },

  // ayat identity
  ayatIdentity:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  ayatIdentityGold: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(184,150,46,0.14)', borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.38)', alignItems: 'center', justifyContent: 'center' },
  ayatIdentityDot:  { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.gold },
  ayatIdentityName: { fontSize: 12, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  ayatIdentityNum:  { fontSize: 11, color: colors.muted, marginTop: 2 },

  // recall
  recallTitle: { fontSize: 24, fontWeight: '800', color: colors.primary, lineHeight: 32, marginBottom: 8 },
  recallSub:   { fontSize: 13, color: colors.muted, lineHeight: 21, marginBottom: spacing.md },

  // help card (unrevealed)
  helpCard:     { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.goldSoft, borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.42)', padding: spacing.md, marginBottom: spacing.md, shadowColor: colors.gold, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  helpTitle:    { fontSize: 15, fontWeight: '800', color: colors.primary, marginBottom: 3 },
  helpSub:      { fontSize: 12, color: colors.muted },
  helpChevron:  { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(184,150,46,0.18)', alignItems: 'center', justifyContent: 'center' },
  helpChevronText:{ fontSize: 18, color: colors.gold, lineHeight: 20, marginTop: Platform.OS === 'ios' ? -2 : 0 },

  // ayat card (revealed)
  ayatCard:            { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(184,150,46,0.30)', padding: spacing.lg, marginBottom: spacing.md, shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3, gap: 14 },
  ayatGoldRail:        { width: 3, borderRadius: 2, backgroundColor: colors.gold, opacity: 0.70 },
  ayatArabic:          { fontSize: Platform.OS === 'ios' ? 28 : 25, fontWeight: '700', color: colors.primary, textAlign: 'right', lineHeight: 46, marginBottom: 10, writingDirection: 'rtl' },
  ayatTranslit:        { fontSize: 14, color: colors.muted, lineHeight: 22, marginBottom: 8, fontStyle: 'italic' },
  ayatTranslationWrap: { borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.18)', paddingTop: 10, marginTop: 4 },
  ayatTranslation:     { fontSize: 13, color: colors.muted, lineHeight: 20 },

  // audio row
  audioRow: { marginBottom: spacing.md },

  // recall hint
  recallHint:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: spacing.md },
  recallHintDot:  { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(184,150,46,0.50)', marginTop: 7 },
  recallHintText: { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 19, fontStyle: 'italic' },

  // eval
  evalTitle: { fontSize: 24, fontWeight: '800', color: colors.primary, marginBottom: 8, lineHeight: 32 },
  evalSub:   { fontSize: 13, color: colors.muted, lineHeight: 21, marginBottom: spacing.md },
  diffBtns:  { marginBottom: spacing.sm },

  // error inline
  errorInline:     { backgroundColor: 'rgba(180,35,24,0.07)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(180,35,24,0.22)', padding: 12, marginBottom: spacing.sm },
  errorInlineText: { fontSize: 13, color: colors.danger, lineHeight: 18 },

  // transition layout: flex column, center content flex, CTA at bottom
  transRoot:   { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  transCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transCta:    { width: '100%' },
  sealWrap:    { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  sealHalo:    { position: 'absolute', width: 120, height: 120, borderRadius: 60, shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  seal:        { width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  sealCheck:   { fontSize: 32, fontWeight: '900', color: '#FFF', ...Platform.select({ android: { lineHeight: 40 } }) },
  transTitle:  { fontSize: 28, fontWeight: '900', color: colors.primary, textAlign: 'center', marginBottom: 12 },
  transBody:   { fontSize: 15, color: colors.muted, lineHeight: 24, textAlign: 'center', marginBottom: spacing.xl },
  nextBadge:   { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.32)', paddingVertical: 16, paddingHorizontal: 32, marginBottom: spacing.xl, alignItems: 'center', shadowColor: colors.gold, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  nextBadgeLabel:{ fontSize: 9, fontWeight: '900', letterSpacing: 2.2, color: colors.gold, marginBottom: 5 },
  nextBadgeVal:  { fontSize: 22, fontWeight: '900' },

  // summary
  summaryHero:  { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  summaryTitle: { fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 3 },
  summarySub:   { fontSize: 13, color: colors.muted, lineHeight: 19 },

  // coach card
  coachCard:    { flexDirection: 'row', backgroundColor: colors.goldSoft, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.32)', marginBottom: spacing.md, overflow: 'hidden', shadowColor: colors.gold, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  coachGoldBar: { width: 4, backgroundColor: colors.gold },
  coachBody:    { flex: 1, padding: spacing.md, gap: 5 },
  coachPlan:    { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: colors.gold },
  coachMsg:     { fontSize: 14, color: colors.primary, lineHeight: 22, fontStyle: 'italic' },

  statsCard:    { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  statsGoldRail:{ height: 3, backgroundColor: colors.gold, opacity: 0.60 },
  statsRow:     { flexDirection: 'row' },
  statCell:     { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statVal:      { fontSize: 24, fontWeight: '900', color: colors.primary, marginBottom: 2 },
  statLbl:      { fontSize: 10, color: colors.muted, fontWeight: '600' },
  statSep:      { width: 1, backgroundColor: colors.border, marginVertical: 12 },

  msgCard:     { flexDirection: 'row', backgroundColor: colors.goldSoft, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.32)', marginBottom: spacing.md, overflow: 'hidden' },
  msgAccentBar:{ width: 4, backgroundColor: colors.gold },
  msgText:     { flex: 1, fontSize: 14, color: colors.primary, lineHeight: 22, padding: spacing.md, fontStyle: 'italic' },

  moreCard: { backgroundColor: 'rgba(22,48,38,0.05)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(22,48,38,0.12)', padding: spacing.md, marginBottom: spacing.md },
  moreText: { fontSize: 13, color: colors.muted, lineHeight: 20 },

  // shared
  ctaArea:         { gap: 10, marginTop: spacing.sm },
  primaryBtn:      { backgroundColor: colors.primary, borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  primaryBtnText:  { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  secondaryBtn:    { borderRadius: 16, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryBtnText:{ fontSize: 15, fontWeight: '600', color: colors.primary },
  btnPressed:      { opacity: 0.80, transform: [{ scale: 0.977 }] },
  // disabled state: warm muted, not dead grey — still readable as a prompt
  btnDisabled:     { backgroundColor: colors.goldSoft, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.30)' },
});
