import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { PremiumBackground } from '@/components/PremiumBackground';
import { SessionProgressBar } from '@/components/SessionProgressBar';
import type { QuranAyahContent } from '@/core/quranContent';
import { completeSession } from '@/db/progress';
import { createReviewItemsForAyatRange } from '@/db/reviewItems';
import { localDateStr as localDateStrPure } from '@/hooks/useLocalDate';
import { usePassageAudio } from '@/hooks/usePassageAudio';
import { useSessionResultStore } from '@/store/sessionResultStore';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import {
  hapticLight,
  hapticMedium,
  hapticSelection,
  hapticSuccess,
} from '@/utils/haptics';

const FINAL_TEST_PROGRESS_PCT  = 0.96; // Step 6 anchors at ~96%

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

export function FinalTestScreen({ surahNumber, allAyats, currentAyatIndex, memStart, memEnd, surahName, userId, ayahPerDay, sessionFinishesSurah, nextSurah, hasZainlyPlus, onBack, onComplete, onRestartPassage }: FinalTestScreenProps) {
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
