import { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
  Animated, Easing, ScrollView, FlatList, StatusBar, TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { usePlan } from '@/hooks/usePlan';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_400Regular } from '@expo-google-fonts/lora';
import { hapticLight, hapticMedium, hapticSelection, hapticSuccess, hapticWarning, hapticError } from '@/utils/haptics';
import {
  ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH,
  computePlan, isPlanError,
  type PlanMode, type SurahEntry,
} from '@/core/planEngine';
import { upsertPlan } from '@/db/plans';
import { upsertProgress } from '@/db/progress';


// ─── palette ──────────────────────────────────────────────────────────────────
const BG         = '#F8F4EA';
const GREEN      = '#031A12';
const TITLE      = '#0F4A36';
const GOLD       = '#C6A15B';
const MUTED      = '#7A6E61';
const SURF       = '#FFFFFF';
const BORDER     = 'rgba(3,26,18,0.10)';
const GOLD_B     = 'rgba(198,161,91,0.30)';

const F_TITLE    = 'Lora_600SemiBold';
const F_BODY     = 'Lora_400Regular';

// ─── haptic throttle ────────────────────────────────────────────────────────
const HAPTIC_EVERY_N_CHARS   = 4;
const HAPTIC_MIN_INTERVAL_MS = 85;

// ─── Daily ayat goal — Zainly Free always starts at 1 ayat / day ─────────────
// Future Zainly+ may expose this as a user setting, but it is not user-facing in
// onboarding for now. Do NOT delete this constant or the DB field it maps to.
const DEFAULT_DAILY_AYAT_GOAL = 1;

// ─── storage key ──────────────────────────────────────────────────────────────
const personalKey = (uid: string) => `zainly:onboardingPersonalAnswers:${uid}`;

// ─── data ─────────────────────────────────────────────────────────────────────
interface Option { id: string; label: string; sub: string; }

const MOTIVATION_OPTIONS: Option[] = [
  { id: 'allah',   label: 'Me rapprocher d\'Allah',           sub: 'Avancer dans mon Hifz avec sincérité et régularité.' },
  { id: 'resume',  label: 'Reprendre sérieusement le Hifz',   sub: 'Revenir à une vraie structure après avoir arrêté.' },
  { id: 'habit',   label: 'Créer une habitude quotidienne',    sub: 'Faire un petit pas chaque jour, sans pression inutile.' },
  { id: 'forget',  label: 'Ne plus oublier ce que j\'apprends',sub: 'Renforcer mes acquis avec des révisions régulières.' },
  { id: 'goal',    label: 'Atteindre un objectif précis',      sub: 'Me préparer pour une sourate, un juz ou un objectif personnel.' },
];

const OBSTACLE_OPTIONS: Option[] = [
  { id: 'start',   label: 'Je ne savais pas par où commencer', sub: 'Trop de sourates, trop de choix, pas de chemin clair.' },
  { id: 'forgot',  label: 'Je mémorisais puis j\'oubliais',    sub: 'Sans révision structurée, les acquis disparaissaient.' },
  { id: 'regular', label: 'Je manquais de régularité',         sub: 'Je commençais motivé, puis je perdais le rythme.' },
  { id: 'fast',    label: 'Je voulais aller trop vite',        sub: 'Le rythme était trop lourd pour tenir longtemps.' },
  { id: 'method',  label: 'Je n\'avais pas de méthode claire', sub: 'Je mémorisais sans vraie stratégie ni suivi.' },
];

// Juz Amma = surahs 78–114 in canonical numbering
const JUZ_AMMA_SURAH_NUMS = ZAINLY_ORDER
  .filter(s => s.surah >= 78 && s.surah <= 114)
  .map(s => s.surah);

type PersonalStep =
  | 'motivation' | 'obstacle' | 'summaryPersonal'
  | 'startMode'
  | 'startSurahPicker'
  | 'customOrderPicker'
  | 'knownSurahs'
  | 'planSummary'
  | 'creating';

// ─── TypewriterText ──────────────────────────────────────────────────────────
interface TWProps {
  text: string; style: object | object[];
  stepKey: string; charDelay?: number; startDelay?: number;
  enableHaptics?: boolean;
  onComplete?: () => void;
  completeRef?: React.MutableRefObject<(() => void) | null>;
}
const TypewriterText = memo(function TypewriterText({
  text, style, stepKey, charDelay = 20, startDelay = 0,
  enableHaptics = false, onComplete, completeRef,
}: TWProps) {
  const [visible, setVisible] = useState(0);
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifiedRef    = useRef(false);
  const mountedRef     = useRef(true);
  const hapticCountRef = useRef(0);
  const lastHapticRef  = useRef(0);

  const finish = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (timeoutRef.current)  { clearTimeout(timeoutRef.current);   timeoutRef.current  = null; }
    if (mountedRef.current)  setVisible(text.length);
  }, [text]);

  useEffect(() => { if (completeRef) completeRef.current = finish; }, [completeRef, finish]);

  useEffect(() => {
    notifiedRef.current    = false;
    hapticCountRef.current = 0;
    setVisible(0);
    if (!text.length) return;
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      intervalRef.current = setInterval(() => {
        if (!mountedRef.current) { clearInterval(intervalRef.current!); return; }
        setVisible(v => {
          const next = v + 1;
          if (enableHaptics) {
            hapticCountRef.current += 1;
            const now = Date.now();
            if (
              hapticCountRef.current % HAPTIC_EVERY_N_CHARS === 0 &&
              now - lastHapticRef.current >= HAPTIC_MIN_INTERVAL_MS
            ) {
              lastHapticRef.current = now;
              Haptics.selectionAsync().catch(() => {});
            }
          }
          if (next >= text.length) { clearInterval(intervalRef.current!); intervalRef.current = null; }
          return next;
        });
      }, charDelay);
    }, startDelay);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current)  { clearTimeout(timeoutRef.current);   timeoutRef.current  = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, text]);

  useEffect(() => {
    if (text.length > 0 && visible >= text.length && !notifiedRef.current) {
      notifiedRef.current = true;
      onComplete?.();
    }
  }, [visible, text, onComplete]);

  useEffect(() => () => { mountedRef.current = false; }, []);

  return <Text style={style}>{text.slice(0, visible)}</Text>;
});

// ─── ChoiceCard ───────────────────────────────────────────────────────────────
interface CardProps { option: Option; selected: boolean; onPress: (id: string) => void; delay: number; }
const ChoiceCard = memo(function ChoiceCard({ option, selected, onPress, delay }: CardProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const selScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacityAnim, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, delay, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Animated.spring(selScale, {
      toValue: selected ? 0.975 : 1,
      friction: 7, tension: 80, useNativeDriver: true,
    }).start();
  }, [selected, selScale]);

  return (
    <Animated.View style={{ opacity: opacityAnim, transform: [{ scale: scaleAnim }, { scale: selScale }] }}>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => onPress(option.id)}
        style={[s.card, selected && s.cardSelected]}
      >
        <View style={s.cardInner}>
          <View style={[s.cardDot, selected && s.cardDotSelected]} />
          <View style={s.cardText}>
            <Text style={[s.cardLabel, selected && s.cardLabelSelected]}>{option.label}</Text>
            <Text style={s.cardSub}>{option.sub}</Text>
          </View>
        </View>
        {selected && <View style={s.cardCheck}><Text style={s.cardCheckText}>✓</Text></View>}
      </TouchableOpacity>
    </Animated.View>
  );
});

// ─── ProgressBar ─────────────────────────────────────────────────────────────
function ProgressBar({ step }: { step: 1 | 2 }) {
  const pct = step === 1 ? '50%' : '100%';
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: pct }]} />
    </View>
  );
}

// ─── QuestionScreen ──────────────────────────────────────────────────────────
interface QProps {
  step: 1 | 2;
  title: string; subtitle: string;
  options: Option[];
  selected: string | null;
  onSelect: (id: string) => void;
  onContinue: () => void;
}
function QuestionScreen({ step, title, subtitle, options, selected, onSelect, onContinue }: QProps) {
  const pageAnim   = useRef(new Animated.Value(0)).current;
  const pageY      = useRef(new Animated.Value(18)).current;
  const ctaAnim    = useRef(new Animated.Value(0)).current;
  const ctaY       = useRef(new Animated.Value(10)).current;
  const titleDone  = useRef(false);
  const subtitleDone = useRef(false);
  const titleCompleteRef = useRef<(() => void) | null>(null);
  const subtitleCompleteRef = useRef<(() => void) | null>(null);
  const [textRevealPhase, setTextRevealPhase] = useState<'title' | 'subtitle' | 'done'>('title');

  const stepKey = `q${step}`;
  const titleDelay = 80;
  const subtitleDelay = 0;
  const titleCharDelay = Math.min(22, Math.round(1200 / Math.max(title.length, 1)));
  const subtitleCharDelay = Math.min(12, Math.round(900 / Math.max(subtitle.length, 1)));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pageAnim, { toValue: 1, duration: 300, delay: 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pageY,    { toValue: 0, duration: 300, delay: 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (textRevealPhase === 'done') {
      Animated.parallel([
        Animated.timing(ctaAnim, { toValue: 1, duration: 240, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(ctaY,    { toValue: 0, duration: 240, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    }
  }, [textRevealPhase, ctaAnim, ctaY]);

  const handleTitleComplete = useCallback(() => {
    if (!titleDone.current) { titleDone.current = true; setTextRevealPhase('subtitle'); }
  }, []);
  const handleSubtitleComplete = useCallback(() => {
    if (!subtitleDone.current) { subtitleDone.current = true; setTextRevealPhase('done'); }
  }, []);

  function handleCtaTap() {
    if (textRevealPhase !== 'done') {
      titleCompleteRef.current?.();
      subtitleCompleteRef.current?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }
    if (!selected) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onContinue();
  }

  function handleSelect(id: string) {
    Haptics.selectionAsync();
    onSelect(id);
  }

  const ctaLabel = selected || textRevealPhase !== 'done' ? 'Continuer' : 'Choisir une option';

  return (
    <Animated.View style={[s.qRoot, { opacity: pageAnim, transform: [{ translateY: pageY }] }]}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />

      {/* progress */}
      <View style={s.progressRow}>
        <ProgressBar step={step} />
        <Text style={s.progressLabel}>Étape {step} sur 2</Text>
      </View>

      <ScrollView style={s.qScroll} contentContainerStyle={s.qScrollContent} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={s.qHeader}>
          <Text style={s.qEyebrow}>POUR TOI</Text>
          <TypewriterText
            text={title}
            style={s.qTitle}
            stepKey={stepKey + '-title'}
            charDelay={titleCharDelay}
            startDelay={titleDelay}
            enableHaptics
            onComplete={handleTitleComplete}
            completeRef={titleCompleteRef}
          />
          <TypewriterText
            text={textRevealPhase !== 'title' ? subtitle : ''}
            style={s.qSubtitle}
            stepKey={stepKey + '-sub-' + (textRevealPhase !== 'title' ? '1' : '0')}
            charDelay={subtitleCharDelay}
            startDelay={subtitleDelay}
            onComplete={handleSubtitleComplete}
            completeRef={subtitleCompleteRef}
          />
        </View>

        {/* options */}
        <View style={s.qOptions}>
          {options.map((opt, i) => (
            <ChoiceCard
              key={opt.id}
              option={opt}
              selected={selected === opt.id}
              onPress={handleSelect}
              delay={80 + i * 55}
            />
          ))}
        </View>
      </ScrollView>

      {/* CTA */}
      <Animated.View style={[s.ctaWrap, { opacity: ctaAnim, transform: [{ translateY: ctaY }] }]}>
        <TouchableOpacity
          style={[s.ctaBtn, (!selected && textRevealPhase === 'done') && s.ctaBtnDim]}
          onPress={handleCtaTap}
          activeOpacity={0.85}
        >
          <Text style={s.ctaBtnText}>{ctaLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

// ─── SummaryScreen ────────────────────────────────────────────────────────────
function SummaryScreen({ onContinue }: { onContinue: () => void }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const yAnim    = useRef(new Animated.Value(20)).current;
  const ctaAnim  = useRef(new Animated.Value(0)).current;
  const titleDoneRef = useRef(false);
  const subDoneRef   = useRef(false);
  const [phase, setPhase] = useState<'title' | 'sub' | 'done'>('title');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(yAnim,    { toValue: 0, duration: 320, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === 'done') {
      Animated.timing(ctaAnim, { toValue: 1, duration: 260, delay: 100, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [phase, ctaAnim]);

  const handleTitleDone = useCallback(() => { if (!titleDoneRef.current) { titleDoneRef.current = true; setPhase('sub'); } }, []);
  const handleSubDone   = useCallback(() => { if (!subDoneRef.current)   { subDoneRef.current   = true; setPhase('done'); } }, []);

  return (
    <Animated.View style={[s.summaryRoot, { opacity: fadeAnim, transform: [{ translateY: yAnim }] }]}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <View style={s.summaryContent}>
        <View style={s.summaryGoldLine} />
        <TypewriterText
          text="Parfait."
          style={s.summaryTitle}
          stepKey="summary-title"
          charDelay={40}
          startDelay={200}
          onComplete={handleTitleDone}
        />
        <TypewriterText
          text={phase !== 'title' ? 'Zainly a compris ton intention et ce qui t\'a freiné.\nMaintenant, créons ton programme.' : ''}
          style={s.summarySub}
          stepKey={'summary-sub-' + (phase !== 'title' ? '1' : '0')}
          charDelay={10}
          startDelay={80}
          onComplete={handleSubDone}
        />
        <View style={s.summaryAccentRow}>
          <View style={s.summaryDot} />
          <Text style={s.summaryAccent}>Ton Hifz commence ici.</Text>
        </View>
      </View>
      <Animated.View style={[s.ctaWrap, { opacity: ctaAnim }]}>
        <TouchableOpacity
          style={s.ctaBtn}
          onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onContinue(); }}
          activeOpacity={0.85}
        >
          <Text style={s.ctaBtnText}>Continuer</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

// ─── CreatingPlanScreen ───────────────────────────────────────────────────────

const MIN_CREATING_VISIBLE_MS = 6000;   // minimum time before 100% can appear
const SUCCESS_PROGRESS_MS     = 1000;   // duration of 92 → 100 animation
const POST_SUCCESS_PAUSE_MS   = 1000;   // pause at 100% before navigation

// Stage targets + per-stage durations — total to 92% ≈ 6000ms
const CREATING_STAGES: { label: string; target: number; duration: number }[] = [
  { label: 'Analyse de tes réponses…',          target: 14, duration: 1200 },
  { label: 'Organisation de ton parcours…',     target: 36, duration: 1500 },
  { label: 'Préparation des révisions…',        target: 64, duration: 1600 },
  { label: 'Ouverture de ton tableau de bord…', target: 92, duration: 1700 },
];

const CHECKLIST_LABELS = [
  'Réponses analysées',
  'Ordre personnalisé',
  'Révisions préparées',
  'Tableau de bord prêt',
];

// thresholds at which each checklist item becomes checked (match stage targets)
const CHECKLIST_THRESHOLDS = [14, 36, 64, 100];
// thresholds at which each checklist item becomes active
const ACTIVE_THRESHOLDS    = [0, 14, 36, 64];

interface CreatingProps { backendDone: boolean; onFinished: () => void; }

function CreatingPlanScreen({ backendDone, onFinished }: CreatingProps) {
  const mountedRef      = useRef(true);
  const progressAnim    = useRef(new Animated.Value(0)).current;
  const brandAnim       = useRef(new Animated.Value(0)).current;
  const titleAnim       = useRef(new Animated.Value(0)).current;
  const statusOpacity   = useRef(new Animated.Value(1)).current;

  const [displayedPercent, setDisplayedPercent] = useState(0);
  const [statusLabel, setStatusLabel]           = useState(CREATING_STAGES[0].label);
  const prevStatusRef   = useRef(CREATING_STAGES[0].label);
  const stageTimers     = useRef<ReturnType<typeof setTimeout>[]>([]);  
  const holdLoopRef     = useRef<Animated.CompositeAnimation | null>(null);
  const finishedRef     = useRef(false);   // call onFinished only once

  // These two refs let the hold-pulse callback check latest state without
  // re-creating the animation effect.
  const backendDoneRef  = useRef(backendDone);
  const stagedDoneRef   = useRef(false);   // true once 92% staged animation finishes
  useEffect(() => { backendDoneRef.current = backendDone; }, [backendDone]);

  // ── progress listener → displayedPercent ──
  useEffect(() => {
    const id = progressAnim.addListener(({ value }) => {
      if (mountedRef.current) setDisplayedPercent(Math.round(value));
    });
    return () => progressAnim.removeListener(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── crossfade status label ──
  const crossfadeStatus = useCallback((next: string) => {
    if (!mountedRef.current || next === prevStatusRef.current) return;
    prevStatusRef.current = next;
    Animated.timing(statusOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      if (!mountedRef.current) return;
      setStatusLabel(next);
      Animated.timing(statusOpacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
  }, [statusOpacity]);

  // ── complete: stop hold-pulse, go to 100, pause, call onFinished ──
  const runCompletion = useCallback(() => {
    if (!mountedRef.current || finishedRef.current) return;
    holdLoopRef.current?.stop();
    holdLoopRef.current = null;
    progressAnim.stopAnimation();
    crossfadeStatus('Programme prêt.');
    Animated.timing(progressAnim, {
      toValue: 100,
      duration: SUCCESS_PROGRESS_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      if (!mountedRef.current || finishedRef.current) return;
      setTimeout(() => {
        if (!mountedRef.current || finishedRef.current) return;
        finishedRef.current = true;
        onFinished();
      }, POST_SUCCESS_PAUSE_MS);
    });
  }, [crossfadeStatus, onFinished, progressAnim, statusOpacity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── staged local progress animation ──
  useEffect(() => {
    mountedRef.current = true;

    // entrance
    Animated.stagger(110, [
      Animated.spring(brandAnim, { toValue: 1, friction: 7, tension: 58, useNativeDriver: true }),
      Animated.timing(titleAnim, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // Schedule stages — each delay is the cumulative sum of previous durations
    let accumulated = 0;
    CREATING_STAGES.forEach((stage, idx) => {
      const delay = accumulated;
      accumulated += stage.duration;
      const t = setTimeout(() => {
        if (!mountedRef.current) return;
        crossfadeStatus(stage.label);
        Animated.timing(progressAnim, {
          toValue: stage.target,
          duration: stage.duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (!finished || !mountedRef.current) return;
          if (idx !== CREATING_STAGES.length - 1) return;
          // Reached 92 — mark staged done
          stagedDoneRef.current = true;
          // If backend already finished, go straight to completion
          if (backendDoneRef.current) { runCompletion(); return; }
          // Otherwise hold/pulse until backendDone effect fires
          const holdLoop = Animated.loop(
            Animated.sequence([
              Animated.timing(progressAnim, { toValue: 90, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
              Animated.timing(progressAnim, { toValue: 92, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
            ])
          );
          holdLoopRef.current = holdLoop;
          holdLoop.start();
        });
      }, delay);
      stageTimers.current.push(t);
    });

    return () => {
      mountedRef.current = false;
      stageTimers.current.forEach(clearTimeout);
      stageTimers.current = [];
      holdLoopRef.current?.stop();
      progressAnim.stopAnimation();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── when backendDone flips true: complete only if staged animation already finished ──
  useEffect(() => {
    if (!backendDone) return;
    // Staged animation not done yet — its callback will call runCompletion when it finishes
    if (!stagedDoneRef.current) return;
    runCompletion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendDone]);

  const brandScale   = brandAnim.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const titleTranslY = titleAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const barWidth     = progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: BG }}
      contentContainerStyle={s.creatingRoot}
      scrollEnabled={false}
    >
      <StatusBar barStyle="dark-content" backgroundColor={BG} />

      {/* brand */}
      <Animated.View style={{ opacity: brandAnim, transform: [{ scale: brandScale }], alignItems: 'center', marginBottom: 28 }}>
        <View style={s.creatingBrand}>
          <Text style={s.creatingBrandText}>Z</Text>
        </View>
        <Text style={s.creatingWordmark}>ZAINLY</Text>
      </Animated.View>

      {/* title */}
      <Animated.Text style={[s.creatingTitle, { opacity: titleAnim, transform: [{ translateY: titleTranslY }] }]}>
        {'Ton programme\nse construit.'}
      </Animated.Text>

      {/* percent */}
      <Text style={s.creatingPercent}>{displayedPercent}%</Text>

      {/* progress bar */}
      <View style={s.creatingBarTrack}>
        <Animated.View style={[s.creatingBarFill, { width: barWidth }]} />
      </View>

      {/* status text */}
      <Animated.Text style={[s.creatingStatus, { opacity: statusOpacity }]}>
        {statusLabel}
      </Animated.Text>

      {/* checklist */}
      <View style={s.creatingChecklist}>
        {CHECKLIST_LABELS.map((label, i) => {
          const checked = displayedPercent >= CHECKLIST_THRESHOLDS[i];
          const active  = displayedPercent >= ACTIVE_THRESHOLDS[i] && !checked;
          return (
            <View key={label} style={[
              s.creatingCheckItem,
              checked && s.creatingCheckItemDone,
              active  && s.creatingCheckItemActive,
            ]}>
              <View style={[s.creatingCheckDot, checked && s.creatingCheckDotDone]}>
                {checked && <Text style={s.creatingCheckMark}>✓</Text>}
                {active  && !checked && <View style={s.creatingActiveDot} />}
              </View>
              <Text style={[s.creatingCheckLabel, checked && s.creatingCheckLabelDone, active && s.creatingCheckLabelActive]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* note */}
      <Text style={s.creatingNote}>Cela ne prend que quelques secondes.</Text>
    </ScrollView>
  );
}

// ─── SeriousQuestionnaire ─────────────────────────────────────────────────────
// Covers steps: startMode → startSurahPicker/customOrderPicker → knownSurahs → planSummary → creating

type SeriousStep = 'startMode' | 'startSurahPicker' | 'customOrderPicker' | 'knownSurahs' | 'planSummary' | 'creating';

const TOTAL_SERIOUS_STEPS = 2; // mode (+ optional picker sub-step), known surahs

function seriousStepIndex(step: SeriousStep): number {
  if (step === 'startMode' || step === 'startSurahPicker' || step === 'customOrderPicker') return 1;
  if (step === 'knownSurahs' || step === 'planSummary' || step === 'creating') return 2;
  return 1;
}

// ── Reusable SeriousProgressBar ──
function SeriousProgressBar({ current, total }: { current: number; total: number }) {
  const pct = `${Math.max(0, Math.min(1, current / total)) * 100}%` as `${number}%`;
  return (
    <View style={s.progressRow}>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: pct }]} />
      </View>
      <Text style={s.progressLabel}>Étape {current} sur {total}</Text>
    </View>
  );
}

// ── PageShell: wraps any serious step with fade+slide entrance+exit ──
function PageShell({ children, stepKey }: { children: React.ReactNode; stepKey: string }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const yAnim    = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    fadeAnim.setValue(0);
    yAnim.setValue(20);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay: 20, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(yAnim,    { toValue: 0, duration: 300, delay: 20, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  return (
    <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim, transform: [{ translateY: yAnim }] }]}>
      {children}
    </Animated.View>
  );
}

// ── ModeCard: richer card for start mode ──
interface ModeCardProps {
  id: PlanMode;
  label: string;
  desc: string;
  helper: string;
  selected: boolean;
  onPress: (id: PlanMode) => void;
  delay: number;
  recommended?: boolean;
}
function ModeCard({ id, label, desc, helper, selected, onPress, delay, recommended }: ModeCardProps) {
  const opacAnim  = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacAnim,  { toValue: 1, duration: 300, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, delay, friction: 8, tension: 60, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Animated.spring(pressScale, { toValue: selected ? 0.975 : 1, friction: 7, tension: 80, useNativeDriver: true }).start();
  }, [selected, pressScale]);

  return (
    <Animated.View style={{ opacity: opacAnim, transform: [{ scale: scaleAnim }, { scale: pressScale }] }}>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={() => { hapticSelection(); onPress(id); }}
        style={[s.modeCard, selected && s.modeCardSelected]}
      >
        <View style={s.modeCardHeader}>
          <View style={[s.modeDot, selected && s.modeDotSelected]} />
          <Text style={[s.modeLabel, selected && s.modeLabelSelected]}>{label}</Text>
          {recommended && !selected && <View style={s.modeBadge}><Text style={s.modeBadgeText}>Recommandé</Text></View>}
          {selected && <View style={s.modeCheck}><Text style={s.modeCheckText}>✓</Text></View>}
        </View>
        <Text style={s.modeDesc}>{desc}</Text>
        <View style={s.modeHelperRow}>
          <Text style={s.modeHelper}>{helper}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── SurahRow: used in both pickers ──
interface SurahRowProps {
  entry: SurahEntry;
  selected: boolean;
  orderIndex?: number;
  onPress: (surah: number) => void;
  delay: number;
  disabled?: boolean;
  disabledLabel?: string;
}
const SurahRow = memo(function SurahRow({ entry, selected, orderIndex, onPress, delay, disabled, disabledLabel }: SurahRowProps) {
  const opacAnim   = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacAnim, { toValue: 1, duration: 220, delay: Math.min(delay, 400), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    Animated.spring(pressScale, { toValue: selected ? 0.982 : 1, friction: 7, tension: 90, useNativeDriver: true }).start();
  }, [selected, pressScale]);
  return (
    <Animated.View style={{ opacity: opacAnim, transform: [{ scale: pressScale }] }}>
      <TouchableOpacity
        activeOpacity={disabled ? 1 : 0.8}
        onPress={() => { if (disabled) return; hapticSelection(); onPress(entry.surah); }}
        style={[s.surahRow, selected && s.surahRowSelected, disabled && s.surahRowDisabled]}
      >
        <View style={s.surahLeft}>
          {orderIndex != null
            ? <View style={s.orderBadge}><Text style={s.orderBadgeText}>{orderIndex}</Text></View>
            : <View style={[s.surahCheck, selected && s.surahCheckSelected]}>
                {selected && <Text style={s.surahCheckMark}>✓</Text>}
              </View>
          }
          <View style={{ flex: 1 }}>
            <Text style={[s.surahName, selected && s.surahNameSelected, disabled && s.surahNameDisabled]}>{entry.name}</Text>
            <Text style={s.surahMeta}>
              {disabledLabel ?? `Sourate ${entry.surah} · ${entry.ayahs} ayats`}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ── Main SeriousQuestionnaire ──
interface SQProps {
  step: SeriousStep;
  userId: string;
  onStepChange: (s: PersonalStep) => void;
}
function SeriousQuestionnaire({ step, userId, onStepChange }: SQProps) {
  const queryClient = useQueryClient();

  const [planMode,         setPlanMode]         = useState<PlanMode>('recommended');
  const [startingSurah,    setStartingSurah]    = useState<number | null>(null);
  const [customOrder,      setCustomOrder]      = useState<number[]>([]);
  const [continueWithRest, setContinueWithRest] = useState<boolean>(true);
  const [knownSurahs,      setKnownSurahs]      = useState<number[]>([]);
  const ayahPerDay = DEFAULT_DAILY_AYAT_GOAL;
  const [surahSearch,      setSurahSearch]      = useState('');
  const [submitError,          setSubmitError]          = useState<string | null>(null);
  const [creationBackendDone,  setCreationBackendDone]  = useState(false);
  const isCreatingRef = useRef(false);

  const allKnownSelected = knownSurahs.length === ZAINLY_ORDER.length;

  function pickStartingSurah(surahNum: number) {
    setStartingSurah(surahNum);
    // Remove the newly chosen starting surah from knownSurahs to prevent contradiction
    setKnownSurahs(prev => prev.filter(n => n !== surahNum));
  }

  function toggleKnown(surahNum: number) {
    // Starting surah must never be added to knownSurahs
    if (planMode === 'start_surah' && surahNum === startingSurah) return;
    hapticSelection();
    setKnownSurahs(prev =>
      prev.includes(surahNum) ? prev.filter(n => n !== surahNum) : [...prev, surahNum]
    );
  }
  function selectJuzAmma() {
    hapticSelection();
    setKnownSurahs(prev => {
      const merged = new Set([...prev, ...JUZ_AMMA_SURAH_NUMS]);
      return [...merged];
    });
  }
  function clearKnown() {
    hapticSelection();
    setKnownSurahs([]);
  }

  function toggleCustom(surahNum: number) {
    hapticSelection();
    setCustomOrder(prev =>
      prev.includes(surahNum) ? prev.filter(n => n !== surahNum) : [...prev, surahNum]
    );
  }

  function applyQuickOrder(type: 'juzAmma' | 'reset') {
    hapticSelection();
    if (type === 'juzAmma') {
      const juzAmmaInOrder = ZAINLY_ORDER.filter(s => s.surah >= 78 && s.surah <= 114).map(s => s.surah);
      setCustomOrder(juzAmmaInOrder);
    } else {
      setCustomOrder([]);
    }
  }

  const normalizedSearch = surahSearch.trim().toLowerCase();
  const filteredSurahs = useMemo(() => {
    if (!normalizedSearch) return ZAINLY_ORDER;
    return ZAINLY_ORDER.filter(s =>
      s.name.toLowerCase().includes(normalizedSearch) ||
      String(s.surah).includes(normalizedSearch)
    );
  }, [normalizedSearch]);

  async function handleCreatePlan() {
    if (isCreatingRef.current) return;   // guard duplicate taps
    isCreatingRef.current = true;
    setSubmitError(null);
    setCreationBackendDone(false);
    hapticMedium();
    onStepChange('creating');

    // yield one frame so creating screen mounts before synchronous computePlan
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

    // Invariant: knownSurahs must never include the startingSurah
    const sanitizedKnown = planMode === 'start_surah' && startingSurah != null
      ? knownSurahs.filter(n => n !== startingSurah)
      : knownSurahs;

    const result = computePlan({
      userId,
      planMode,
      knownSurahs: sanitizedKnown,
      startingSurah: planMode === 'start_surah' ? startingSurah : null,
      customSurahOrder: planMode === 'custom_order' ? customOrder : undefined,
      continueWithRest: planMode === 'custom_order' ? continueWithRest : undefined,
      ayahPerDay,
    });

    if (isPlanError(result)) {
      isCreatingRef.current = false;
      setSubmitError(result.error);
      onStepChange('planSummary');
      hapticError();
      return;
    }

    try {
      await upsertPlan(userId, result.planPayload);
      await upsertProgress(userId, result.progressPayload);
      // Do NOT invalidate queries here — doing so would refetch plan, trigger the
      // routing guard, and navigate before the animation finishes.
      // Invalidation happens inside onFinished, right before router.replace.
      hapticSuccess();
      setCreationBackendDone(true);
    } catch {
      isCreatingRef.current = false;
      setCreationBackendDone(false);
      setSubmitError('Impossible de créer ton programme pour le moment. Réessaie dans un instant.');
      onStepChange('planSummary');
      hapticError();
    }
  }

  // Preview computed result for summary screen (no DB write)
  const previewResult = useMemo(() => {
    if (step !== 'planSummary') return null;
    // Invariant: knownSurahs must never include the startingSurah
    const sanitizedKnown = planMode === 'start_surah' && startingSurah != null
      ? knownSurahs.filter(n => n !== startingSurah)
      : knownSurahs;
    return computePlan({
      userId,
      planMode,
      knownSurahs: sanitizedKnown,
      startingSurah: planMode === 'start_surah' ? startingSurah : null,
      customSurahOrder: planMode === 'custom_order' ? customOrder : undefined,
      continueWithRest: planMode === 'custom_order' ? continueWithRest : undefined,
      ayahPerDay,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, userId, planMode, knownSurahs, startingSurah, customOrder, continueWithRest, ayahPerDay]);

  // ── Step: startMode ──
  if (step === 'startMode') {
    return (
      <PageShell stepKey="startMode">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 54 : 36 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <SeriousProgressBar current={seriousStepIndex('startMode')} total={TOTAL_SERIOUS_STEPS} />
          <ScrollView style={s.qScroll} contentContainerStyle={s.qScrollContent} showsVerticalScrollIndicator={false}>
            <View style={s.qHeader}>
              <Text style={s.qEyebrow}>TON PROGRAMME</Text>
              <Text style={s.qTitle}>{'Comment veux-tu\ncommencer ton Hifz ?'}</Text>
              <Text style={s.qSubtitle}>{'Choisis la façon dont tu veux construire ton programme. Zainly organisera ensuite tes sessions jour après jour.'}</Text>
            </View>
            <View style={[s.qOptions, { gap: 12 }]}>
              <ModeCard id="recommended" delay={80} recommended
                label="Recommandé par Zainly"
                desc="Le parcours le plus simple. Zainly commence par des sourates accessibles, puis augmente progressivement la difficulté."
                helper="Idéal si tu veux être guidé sans tout organiser toi-même."
                selected={planMode === 'recommended'} onPress={setPlanMode} />
              <ModeCard id="start_surah" delay={150}
                label="Choisir ma sourate de départ"
                desc="Commence par une sourate précise, puis laisse Zainly organiser la suite."
                helper="Idéal si tu sais déjà par où tu veux commencer."
                selected={planMode === 'start_surah'} onPress={setPlanMode} />
              <ModeCard id="custom_order" delay={220}
                label="Liberté totale"
                desc="Choisis les sourates que tu veux mémoriser et l'ordre exact dans lequel tu veux les travailler."
                helper="Zainly suivra ton ordre personnalisé, puis ajoutera les révisions nécessaires."
                selected={planMode === 'custom_order'} onPress={setPlanMode} />
            </View>
          </ScrollView>
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.85}
              onPress={() => {
                hapticLight();
                if (planMode === 'start_surah') { onStepChange('startSurahPicker'); }
                else if (planMode === 'custom_order') { onStepChange('customOrderPicker'); }
                else { onStepChange('knownSurahs'); }
              }}>
              <Text style={s.ctaBtnText}>Continuer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PageShell>
    );
  }

  // ── Step: startSurahPicker ──
  if (step === 'startSurahPicker') {
    return (
      <PageShell stepKey="startSurahPicker">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 54 : 36 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <SeriousProgressBar current={1} total={TOTAL_SERIOUS_STEPS} />
          <View style={[s.qHeader, { paddingHorizontal: 24, marginBottom: 8 }]}>
            <Text style={s.qEyebrow}>POINT DE DÉPART</Text>
            <Text style={[s.qTitle, { fontSize: 24, minHeight: 0 }]}>{'Par quelle sourate veux-tu commencer ?'}</Text>
            <Text style={[s.qSubtitle, { minHeight: 0 }]}>{'Choisis ton point de départ. Zainly construira ensuite le reste du programme.'}</Text>
            <View style={s.searchWrap}>
              <TextInput
                style={s.searchInput}
                placeholder="Rechercher une sourate…"
                placeholderTextColor={MUTED}
                value={surahSearch}
                onChangeText={setSurahSearch}
              />
            </View>
          </View>
          <FlatList
            style={s.qScroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            data={filteredSurahs}
            keyExtractor={(item) => String(item.surah)}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews={true}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <SurahRow
                entry={item}
                selected={startingSurah === item.surah}
                onPress={pickStartingSurah}
                delay={0}
              />
            )}
          />
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); setSurahSearch(''); onStepChange('startMode'); }}>
              <Text style={s.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.ctaBtn, !startingSurah && s.ctaBtnDim]}
              activeOpacity={0.85}
              onPress={() => {
                if (!startingSurah) { hapticWarning(); return; }
                hapticLight();
                setSurahSearch('');
                onStepChange('knownSurahs');
              }}>
              <Text style={s.ctaBtnText}>Continuer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PageShell>
    );
  }

  // ── Step: customOrderPicker ──
  if (step === 'customOrderPicker') {
    return (
      <PageShell stepKey="customOrderPicker">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 54 : 36 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <SeriousProgressBar current={1} total={TOTAL_SERIOUS_STEPS} />
          <View style={[s.qHeader, { paddingHorizontal: 24, marginBottom: 8 }]}>
            <Text style={s.qEyebrow}>ORDRE PERSONNALISÉ</Text>
            <Text style={[s.qTitle, { fontSize: 24, minHeight: 0 }]}>{'Choisis ton ordre.'}</Text>
            <Text style={[s.qSubtitle, { minHeight: 0, marginBottom: 10 }]}>{"Sélectionne les sourates dans l'ordre où tu veux les mémoriser."}</Text>

            {/* ── Quick helpers (optional, no auto-navigation) ── */}
            <View style={s.quickHelpersWrap}>
              <Text style={s.quickHelpersLabel}>Démarrer depuis</Text>
              <View style={s.quickChipsRow}>
                <TouchableOpacity style={s.quickChip} activeOpacity={0.75} onPress={() => applyQuickOrder('juzAmma')}>
                  <Text style={s.quickChipText}>Juz Amma</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.quickChip, s.quickChipReset]} activeOpacity={0.75} onPress={() => applyQuickOrder('reset')}>
                  <Text style={[s.quickChipText, s.quickChipResetText]}>Réinitialiser</Text>
                </TouchableOpacity>
              </View>
            </View>

            {customOrder.length === 0 && (
              <Text style={s.warningText}>Sélectionne au moins une sourate pour continuer.</Text>
            )}

            {/* ── Continue with rest toggle ── */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => { hapticSelection(); setContinueWithRest(v => !v); }}
              style={[s.continueRestCard, continueWithRest && s.continueRestCardActive]}
            >
              <View style={s.continueRestRow}>
                <View style={s.continueRestCheck}>
                  {continueWithRest && <Text style={s.continueRestCheckMark}>✓</Text>}
                </View>
                <View style={s.continueRestTextWrap}>
                  <Text style={[s.continueRestTitle, continueWithRest && s.continueRestTitleActive]}>
                    Continuer ensuite avec le reste du Coran
                  </Text>
                  <Text style={s.continueRestDesc}>
                    {continueWithRest
                      ? 'Zainly commencera par ton ordre, puis continuera avec les autres sourates.'
                      : 'Ton programme sera limité aux sourates sélectionnées. Tu pourras en ajouter plus tard.'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={s.searchWrap}>
              <TextInput
                style={s.searchInput}
                placeholder="Rechercher une sourate…"
                placeholderTextColor={MUTED}
                value={surahSearch}
                onChangeText={setSurahSearch}
              />
            </View>
          </View>
          <FlatList
            style={s.qScroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            data={filteredSurahs}
            keyExtractor={(item) => String(item.surah)}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews={true}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const orderIdx = customOrder.indexOf(item.surah);
              return (
                <SurahRow
                  entry={item}
                  selected={orderIdx !== -1}
                  orderIndex={orderIdx !== -1 ? orderIdx + 1 : undefined}
                  onPress={toggleCustom}
                  delay={0}
                />
              );
            }}
          />
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); setSurahSearch(''); onStepChange('startMode'); }}>
              <Text style={s.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.ctaBtn, customOrder.length === 0 && s.ctaBtnDim]}
              activeOpacity={0.85}
              onPress={() => {
                if (customOrder.length === 0) { hapticWarning(); return; }
                hapticLight();
                setSurahSearch('');
                onStepChange('knownSurahs');
              }}>
              <Text style={s.ctaBtnText}>Continuer ({customOrder.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PageShell>
    );
  }

  // ── Step: knownSurahs ──
  if (step === 'knownSurahs') {
    const prevStep: PersonalStep = planMode === 'start_surah' ? 'startSurahPicker'
      : planMode === 'custom_order' ? 'customOrderPicker' : 'startMode';
    return (
      <PageShell stepKey="knownSurahs">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 54 : 36 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <SeriousProgressBar current={2} total={TOTAL_SERIOUS_STEPS} />
          <View style={[s.qHeader, { paddingHorizontal: 24, marginBottom: 8 }]}>
            <Text style={s.qEyebrow}>ACQUIS</Text>
            <Text style={[s.qTitle, { fontSize: 24, minHeight: 0 }]}>{'Quelles sourates maîtrises-tu déjà ?'}</Text>
            <Text style={[s.qSubtitle, { minHeight: 0, marginBottom: 8 }]}>{'Coche uniquement les sourates que tu sais déjà réciter correctement.'}</Text>
            <View style={s.warningCard}>
              <Text style={s.warningCardText}>{'Ne coche pas les sourates que tu veux apprendre. Coche seulement celles que tu maîtrises déjà.'}</Text>
            </View>
            <View style={s.knownQuickRow}>
              <TouchableOpacity style={s.quickBtn} onPress={clearKnown}>
                <Text style={[s.quickBtnText, knownSurahs.length === 0 && s.quickBtnActive]}>Aucune</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.quickBtn} onPress={selectJuzAmma}>
                <Text style={[s.quickBtnText, JUZ_AMMA_SURAH_NUMS.every(n => knownSurahs.includes(n)) && s.quickBtnActive]}>Juz Amma (78–114)</Text>
              </TouchableOpacity>
            </View>
            {allKnownSelected && (
              <Text style={s.warningText}>{'Tu as indiqué maîtriser toutes les sourates. Choisis au moins une sourate à travailler.'}</Text>
            )}
            {knownSurahs.length > 0 && !allKnownSelected && (
              <View style={s.selectedCountChip}>
                <Text style={s.selectedCountText}>{knownSurahs.length} sourate{knownSurahs.length > 1 ? 's' : ''} sélectionnée{knownSurahs.length > 1 ? 's' : ''}</Text>
              </View>
            )}
          </View>
          <FlatList
            style={s.qScroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
            data={ZAINLY_ORDER}
            keyExtractor={(item) => String(item.surah)}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews={true}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isStarting = planMode === 'start_surah' && item.surah === startingSurah;
              return (
                <SurahRow
                  entry={item}
                  selected={knownSurahs.includes(item.surah)}
                  onPress={toggleKnown}
                  delay={0}
                  disabled={isStarting}
                  disabledLabel={isStarting ? 'Sourate de départ' : undefined}
                />
              );
            }}
          />
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); onStepChange(prevStep); }}>
              <Text style={s.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.ctaBtn, allKnownSelected && s.ctaBtnDim]}
              activeOpacity={0.85}
              onPress={() => {
                if (allKnownSelected) { hapticWarning(); return; }
                hapticLight();
                onStepChange('planSummary');
              }}>
              <Text style={s.ctaBtnText}>
                {knownSurahs.length > 0 ? `Continuer (${knownSurahs.length} connues)` : 'Continuer'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </PageShell>
    );
  }

  // ── Step: planSummary ──
  if (step === 'planSummary') {
    const modeLabel = planMode === 'recommended' ? 'Recommandé par Zainly'
      : planMode === 'start_surah' ? 'Sourate de départ choisie'
      : 'Ordre personnalisé';

    const startLabel = planMode === 'start_surah' && startingSurah
      ? (ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[startingSurah]]?.name ?? '—')
      : planMode === 'recommended' ? 'Choisie par Zainly'
      : customOrder.length > 0
        ? (ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[customOrder[0]]]?.name ?? '—')
        : '—';

    const previewOk               = previewResult && !isPlanError(previewResult);
    const estimateRange            = previewOk ? previewResult!.computed.estimateRange : null;
    const computedEstimate         = estimateRange ? estimateRange.label : null;
    const actualFirstName          = previewOk ? previewResult!.computed.firstSurahName : startLabel;
    const skipped                  = previewOk ? previewResult!.computed.skippedKnownSurahs : [];
    const selectedCustomCount      = previewOk ? previewResult!.computed.selectedCustomCount : customOrder.length;
    const previewContinueWithRest  = previewOk ? previewResult!.computed.continueWithRest : continueWithRest;
    const startSurahWasSkipped     = planMode === 'start_surah' && startingSurah != null
      && skipped.includes(startingSurah);
    return (
      <PageShell stepKey="planSummary">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 64 : 48 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <ScrollView style={s.qScroll} contentContainerStyle={s.qScrollContent} showsVerticalScrollIndicator={false}>
            <Text style={s.qEyebrow}>RÉCAPITULATIF</Text>
            <Text style={s.qTitle}>{'Ton programme\nest prêt.'}</Text>
            <Text style={[s.qSubtitle, { marginBottom: 24 }]}>{'Vérifie tes choix avant de créer ton parcours.'}</Text>

            {startSurahWasSkipped && (
              <View style={s.warningCard}>
                <Text style={s.warningCardText}>{'Cette sourate est marquée comme déjà maîtrisée. Zainly commencera à la prochaine sourate disponible.'}</Text>
              </View>
            )}

            {submitError && (
              <View style={s.errorCard}>
                <Text style={s.errorText}>{submitError}</Text>
              </View>
            )}

            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Mode</Text>
                <Text style={s.summaryRowValue}>{modeLabel}</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Sourate de départ</Text>
                <Text style={s.summaryRowValue}>{actualFirstName}</Text>
              </View>
              {planMode === 'custom_order' && (
                <>
                  <View style={s.summaryDivider} />
                  <View style={s.summaryRow}>
                    <Text style={s.summaryRowLabel}>Sourates choisies</Text>
                    <Text style={s.summaryRowValue}>{selectedCustomCount} sourate{selectedCustomCount > 1 ? 's' : ''}</Text>
                  </View>
                </>
              )}
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Sourates connues</Text>
                <Text style={s.summaryRowValue}>{knownSurahs.length > 0 ? `${knownSurahs.length} sourate${knownSurahs.length > 1 ? 's' : ''}` : 'Aucune'}</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Mission quotidienne</Text>
                <Text style={s.summaryRowValue}>Avance ayat par ayat, chaque jour.</Text>
              </View>
              {planMode === 'custom_order' && (
                <>
                  <View style={s.summaryDivider} />
                  <View style={s.summaryRow}>
                    <Text style={s.summaryRowLabel}>Suite du programme</Text>
                    <Text style={s.summaryRowValue}>
                      {previewContinueWithRest ? 'Reste du Coran' : 'Sourates choisies uniquement'}
                    </Text>
                  </View>
                </>
              )}
              {computedEstimate && <>
                <View style={s.summaryDivider} />
                <View style={s.summaryRow}>
                  <Text style={s.summaryRowLabel}>Durée estimée</Text>
                  <Text style={s.summaryRowValue}>{computedEstimate}</Text>
                </View>
              </>}
            </View>
            {computedEstimate && estimateRange && (
              <View style={s.estimateHelperWrap}>
                <Text style={s.estimateHelperLine}>
                  {planMode === 'custom_order' && previewContinueWithRest
                    ? 'Estimation pour mémoriser le Coran restant, en commençant par ton ordre personnalisé.'
                    : planMode === 'custom_order'
                    ? 'Estimation pour terminer ton ordre personnalisé.'
                    : 'Estimation pour mémoriser le Coran restant, à raison d\'un ayat par jour.'}
                </Text>
                <Text style={s.estimateHelperLine}>{'La fourchette tient compte des révisions et des semaines plus lentes.'}</Text>
              </View>
            )}
          </ScrollView>
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); onStepChange('knownSurahs'); }}>
              <Text style={s.backBtnText}>← Modifier mes réponses</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.85} onPress={handleCreatePlan}>
              <Text style={s.ctaBtnText}>Créer mon programme</Text>
            </TouchableOpacity>
          </View>
        </View>
      </PageShell>
    );
  }

  // ── Step: creating ──
  return (
    <CreatingPlanScreen
      backendDone={creationBackendDone}
      onFinished={async () => {
        isCreatingRef.current = false;
        // Invalidate now — after animation completes — so the plan guard
        // does not fire mid-animation and steal navigation.
        await queryClient.invalidateQueries({ queryKey: ['plan', userId] });
        await queryClient.invalidateQueries({ queryKey: ['progress', userId] });
        router.replace('/(app)/(tabs)');
      }}
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { user, ready } = useAuthStore();
  const { data: plan, isLoading: planLoading } = usePlan(user?.id);
  const [introSeen, setIntroSeen]           = useState<boolean | null>(null);
  const [personalDone, setPersonalDone]     = useState<boolean | null>(null);
  const [personalStep, setPersonalStep]     = useState<PersonalStep>('motivation');
  const [motivation, setMotivation]         = useState<string | null>(null);
  const [obstacle, setObstacle]             = useState<string | null>(null);

  const [fontsLoaded] = useFonts({ Lora_600SemiBold, Lora_400Regular });
  const seriousStartedRef = useRef(false);

  // ── read AsyncStorage ──
  useEffect(() => {
    if (!user?.id) return;
    const introKey = `zainly:onboardingIntroSeen:${user.id}`;
    AsyncStorage.getItem(introKey)
      .then(val => setIntroSeen(val === 'true'))
      .catch(() => setIntroSeen(false));
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(personalKey(user.id))
      .then(val => setPersonalDone(val !== null))
      .catch(() => setPersonalDone(false));
  }, [user?.id]);

  const isLoading = !ready || !fontsLoaded || planLoading
    || (!!user?.id && introSeen === null)
    || (!!user?.id && personalDone === null);

  // ── routing guard (authenticated users only) ──
  useEffect(() => {
    if (!ready || !user) return;
    if (isLoading) return;
    // Do not redirect while the creation animation is running —
    // CreatingPlanScreen.onFinished() is the only navigation path after creation.
    if (plan && personalStep !== 'creating') { router.replace('/(app)/(tabs)'); return; }
    if (!introSeen) { router.replace('/onboarding/intro'); return; }
    if (personalDone && !seriousStartedRef.current) {
      seriousStartedRef.current = true;
      setPersonalStep('startMode');
    }
  }, [ready, user, isLoading, plan, introSeen, personalDone, personalStep]);

  // ── save personal answers ──
  async function savePersonalAnswers(motivationId: string, obstacleId: string) {
    if (!user?.id) return;
    const mOpt = MOTIVATION_OPTIONS.find(o => o.id === motivationId);
    const bOpt = OBSTACLE_OPTIONS.find(o => o.id === obstacleId);
    const payload = JSON.stringify({
      motivationReason: motivationId,
      motivationLabel:  mOpt?.label ?? '',
      mainObstacle:     obstacleId,
      obstacleLabel:    bOpt?.label ?? '',
      completedAt:      new Date().toISOString(),
    });
    await AsyncStorage.setItem(personalKey(user.id), payload).catch(() => {});
  }

  function handleMotivationContinue() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPersonalStep('obstacle');
  }
  function handleObstacleContinue() {
    if (!motivation || !obstacle) return;
    savePersonalAnswers(motivation, obstacle);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPersonalStep('summaryPersonal');
  }
  function handleSummaryContinue() {
    setPersonalDone(true);
    setPersonalStep('startMode');
  }

  if (ready && !user) { return null; }

  // ── loading / gate ──
  // Exclude creating step from the plan-exists short-circuit so the animation
  // can finish before onFinished navigates.
  if (!user || isLoading || (plan && personalStep !== 'creating') || !introSeen) {
    return (
      <View style={s.loading}>
        <Text style={s.loadingDot}>·</Text>
        <Text style={s.loadingText}>Préparation de ton programme…</Text>
      </View>
    );
  }

  if (personalStep === 'motivation') {
    return (
      <QuestionScreen
        step={1}
        title="Pourquoi veux-tu mémoriser ?"
        subtitle="Ton intention aidera Zainly à t'accompagner avec plus de sens."
        options={MOTIVATION_OPTIONS}
        selected={motivation}
        onSelect={setMotivation}
        onContinue={handleMotivationContinue}
      />
    );
  }

  if (personalStep === 'obstacle') {
    return (
      <QuestionScreen
        step={2}
        title="Qu'est-ce qui t'a le plus bloqué ?"
        subtitle="Zainly va construire ton programme autour de ce qui t'a freiné."
        options={OBSTACLE_OPTIONS}
        selected={obstacle}
        onSelect={setObstacle}
        onContinue={handleObstacleContinue}
      />
    );
  }

  if (personalStep === 'summaryPersonal') {
    return <SummaryScreen onContinue={handleSummaryContinue} />;
  }

  return (
    <SeriousQuestionnaire
      step={personalStep as SeriousStep}
      userId={user.id}
      onStepChange={setPersonalStep}
    />
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // loading
  loading:     { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingDot:  { fontSize: 28, color: GOLD },
  loadingText: { fontSize: 14, color: MUTED, letterSpacing: 0.2 },

  // question root
  qRoot:        { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'ios' ? 54 : 36 },
  qScroll:      { flex: 1 },
  qScrollContent:{ paddingHorizontal: 24, paddingBottom: 16 },
  qHeader:      { marginBottom: 24 },

  // progress
  progressRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 20, gap: 12 },
  progressTrack:{ flex: 1, height: 3, backgroundColor: 'rgba(3,26,18,0.10)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: GOLD, borderRadius: 2 },
  progressLabel:{ fontSize: 11, color: MUTED, fontWeight: '600', letterSpacing: 0.5 },

  // question header
  qEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 2.5, color: GOLD, textTransform: 'uppercase', marginBottom: 14 },
  qTitle:   { fontFamily: F_TITLE, fontSize: 28, color: TITLE, lineHeight: 38, letterSpacing: -0.2, marginBottom: 12, minHeight: 76 },
  qSubtitle:{ fontFamily: F_BODY,  fontSize: 14, color: MUTED, lineHeight: 22, marginBottom: 4, minHeight: 44 },

  // options
  qOptions: { gap: 10, paddingBottom: 8 },

  // choice card
  card: {
    backgroundColor: SURF, borderRadius: 16,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cardSelected:     { borderColor: GOLD, backgroundColor: 'rgba(198,161,91,0.06)' },
  cardInner:        { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 12 },
  cardDot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: BORDER, marginTop: 5 },
  cardDotSelected:  { backgroundColor: GOLD },
  cardText:         { flex: 1 },
  cardLabel:        { fontFamily: F_BODY, fontSize: 14, fontWeight: '600', color: TITLE, lineHeight: 20, marginBottom: 3 },
  cardLabelSelected:{ color: GREEN },
  cardSub:          { fontFamily: F_BODY, fontSize: 12, color: MUTED, lineHeight: 18 },
  cardCheck:        { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  cardCheckText:    { fontSize: 12, color: SURF, fontWeight: '700' },

  // cta
  ctaWrap:    { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 44 : 28, paddingTop: 12 },
  ctaBtn:     { backgroundColor: GREEN, borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  ctaBtnDim:  { opacity: 0.5 },
  ctaBtnText: { fontFamily: F_BODY, fontSize: 16, fontWeight: '700', color: BG, letterSpacing: 0.2 },

  // summary
  summaryRoot:    { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'ios' ? 80 : 60 },
  summaryContent: { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  summaryGoldLine:{ width: 32, height: 2, backgroundColor: GOLD, borderRadius: 1, marginBottom: 28, opacity: 0.7 },
  summaryTitle:   { fontFamily: F_TITLE, fontSize: 52, color: TITLE, lineHeight: 62, letterSpacing: -0.5, marginBottom: 24, minHeight: 64 },
  summarySub:     { fontFamily: F_BODY, fontSize: 16, color: MUTED, lineHeight: 26, marginBottom: 32, minHeight: 52 },
  summaryAccentRow:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  summaryAccent:  { fontFamily: F_BODY, fontSize: 13, color: GOLD, fontStyle: 'italic', letterSpacing: 0.2 },

  // ── mode cards ──
  modeCard: {
    backgroundColor: SURF, borderRadius: 16,
    borderWidth: 1.5, borderColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 0,
  },
  modeCardSelected:  { borderColor: GOLD, backgroundColor: 'rgba(198,161,91,0.06)' },
  modeCardHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  modeDot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: BORDER },
  modeDotSelected:   { backgroundColor: GOLD },
  modeLabel:         { fontFamily: F_BODY, fontSize: 15, fontWeight: '700', color: TITLE, flex: 1 },
  modeLabelSelected: { color: GREEN },
  modeCheck:         { width: 22, height: 22, borderRadius: 11, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  modeCheckText:     { fontSize: 12, color: SURF, fontWeight: '700' },
  modeDesc:          { fontFamily: F_BODY, fontSize: 13, color: MUTED, lineHeight: 19, marginBottom: 8, paddingLeft: 18 },
  modeHelperRow:     { paddingLeft: 18, paddingVertical: 6, borderLeftWidth: 2, borderLeftColor: GOLD_B, marginLeft: 2 },
  modeHelper:        { fontFamily: F_BODY, fontSize: 12, color: GOLD, lineHeight: 17, fontStyle: 'italic' },

  // ── surah rows ──
  surahRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: 12, marginBottom: 4,
    backgroundColor: SURF, borderWidth: 1, borderColor: BORDER,
  },
  surahRowSelected:  { borderColor: GOLD, backgroundColor: 'rgba(198,161,91,0.06)' },
  surahRowDisabled:  { opacity: 0.45, backgroundColor: 'rgba(0,0,0,0.02)' },
  surahLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  surahCheck:        { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  surahCheckSelected:{ borderColor: GOLD, backgroundColor: GOLD },
  surahCheckMark:    { fontSize: 11, color: SURF, fontWeight: '700' },
  surahName:         { fontFamily: F_BODY, fontSize: 13, fontWeight: '600', color: TITLE },
  surahNameSelected: { color: GREEN },
  surahNameDisabled: { color: MUTED },
  surahMeta:         { fontFamily: F_BODY, fontSize: 11, color: MUTED },
  orderBadge:        { width: 24, height: 24, borderRadius: 12, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  orderBadgeText:    { fontSize: 11, fontWeight: '700', color: SURF },

  // ── search ──
  searchWrap:        { marginTop: 10, marginBottom: 4 },
  searchInput: {
    backgroundColor: SURF, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 14, paddingVertical: 9,
    fontFamily: F_BODY, fontSize: 13, color: GREEN,
  },

  // ── known surahs quick buttons ──
  warningCard:       { backgroundColor: 'rgba(198,161,91,0.10)', borderRadius: 10, borderWidth: 1, borderColor: GOLD_B, padding: 12, marginBottom: 10 },
  warningCardText:   { fontFamily: F_BODY, fontSize: 12, color: TITLE, lineHeight: 18 },
  warningText:       { fontFamily: F_BODY, fontSize: 12, color: '#B42318', lineHeight: 18, marginTop: 6 },
  knownQuickRow:     { flexDirection: 'row', gap: 10, marginBottom: 6, marginTop: 4 },
  quickBtn:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, backgroundColor: SURF },
  quickBtnText:      { fontFamily: F_BODY, fontSize: 12, color: MUTED, fontWeight: '600' },
  quickBtnActive:    { color: GOLD },


  // ── plan summary card ──
  summaryCard: {
    backgroundColor: SURF, borderRadius: 16,
    borderWidth: 1, borderColor: GOLD_B,
    paddingHorizontal: 20, paddingVertical: 6, marginBottom: 20,
  },
  summaryRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  summaryRowLabel: { fontFamily: F_BODY, fontSize: 13, color: MUTED, fontWeight: '600' },
  summaryRowValue: { fontFamily: F_BODY, fontSize: 13, color: TITLE, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  summaryDivider:  { height: 1, backgroundColor: BORDER },

  // ── error card ──
  errorCard:  { backgroundColor: 'rgba(180,35,24,0.07)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(180,35,24,0.20)', padding: 12, marginBottom: 16 },
  errorText:  { fontFamily: F_BODY, fontSize: 13, color: '#B42318', lineHeight: 19 },

  // ── back button ──
  backBtn:     { paddingVertical: 10, alignItems: 'center', marginBottom: 6 },
  backBtnText: { fontFamily: F_BODY, fontSize: 13, color: MUTED, letterSpacing: 0.1 },

  // ── mode badge (Recommandé) ──
  modeBadge:     { backgroundColor: 'rgba(198,161,91,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  modeBadgeText: { fontFamily: F_BODY, fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 0.5 },

  // ── custom order quick helpers ──
  quickHelpersWrap:  { marginBottom: 10 },
  quickHelpersLabel: { fontFamily: F_BODY, fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
  quickChipsRow:     { flexDirection: 'row', gap: 8, paddingRight: 8 },
  quickChip: {
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: SURF,
  },
  quickChipText:      { fontFamily: F_BODY, fontSize: 12, color: TITLE, fontWeight: '600' },
  quickChipReset:     { borderColor: 'rgba(180,35,24,0.25)', backgroundColor: 'rgba(180,35,24,0.05)' },
  quickChipResetText: { color: '#B42318' },

  // ── selected count chip (knownSurahs) ──
  selectedCountChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(198,161,91,0.15)',
    borderRadius: 20, borderWidth: 1, borderColor: GOLD_B,
    paddingHorizontal: 12, paddingVertical: 4, marginTop: 6,
  },
  selectedCountText: { fontFamily: F_BODY, fontSize: 11, fontWeight: '700', color: GOLD },

  // ── estimate helper text ──
  estimateHelperWrap: { paddingHorizontal: 4, marginBottom: 20, gap: 4 },
  estimateHelperLine: { fontFamily: F_BODY, fontSize: 11, color: MUTED, lineHeight: 17 },

  // ── creating plan screen ──
  creatingRoot: {
    flexGrow: 1, backgroundColor: BG,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingVertical: 40,
  },
  creatingBrand: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  creatingBrandText: {
    fontFamily: F_TITLE, fontSize: 26, color: GOLD, lineHeight: 32,
  },
  creatingWordmark: {
    fontFamily: F_BODY, fontSize: 11, color: TITLE,
    textAlign: 'center', letterSpacing: 3, opacity: 0.6,
  },
  creatingTitle: {
    fontFamily: F_TITLE, fontSize: 24, color: TITLE,
    textAlign: 'center', lineHeight: 34, marginTop: 20, marginBottom: 24,
  },
  creatingPercent: {
    fontFamily: F_TITLE, fontSize: 42, color: GOLD,
    letterSpacing: -1, marginBottom: 10,
  },
  creatingBarTrack: {
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: GOLD_B, marginBottom: 14, overflow: 'hidden',
  },
  creatingBarFill: {
    height: 6, borderRadius: 3, backgroundColor: GOLD,
  },
  creatingStatus: {
    fontFamily: F_BODY, fontSize: 12, color: MUTED,
    letterSpacing: 0.3, marginBottom: 28, textAlign: 'center',
  },
  creatingChecklist: {
    width: '100%', gap: 8, marginBottom: 28,
  },
  creatingCheckItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: SURF, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: BORDER, opacity: 0.45,
  },
  creatingCheckItemActive: {
    opacity: 1, borderColor: GOLD_B,
  },
  creatingCheckItemDone: {
    opacity: 1, borderColor: 'rgba(198,161,91,0.5)',
    backgroundColor: 'rgba(198,161,91,0.06)',
  },
  creatingCheckDot: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 1.5, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BG,
  },
  creatingCheckDotDone: {
    borderColor: GOLD, backgroundColor: 'rgba(198,161,91,0.15)',
  },
  creatingCheckMark:  { fontSize: 12, color: GOLD, fontWeight: '700', lineHeight: 15 },
  creatingActiveDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  creatingCheckLabel: {
    fontFamily: F_BODY, fontSize: 13, color: MUTED, flex: 1,
  },
  creatingCheckLabelActive: { color: TITLE },
  creatingCheckLabelDone:   { color: TITLE, fontWeight: '600' },
  creatingNote: {
    fontFamily: F_BODY, fontSize: 11, color: 'rgba(122,110,97,0.50)',
    letterSpacing: 0.2, textAlign: 'center',
  },

  // ── continue with rest toggle card ──
  continueRestCard: {
    borderRadius: 12, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: SURF, padding: 14, marginBottom: 10,
  },
  continueRestCardActive: {
    borderColor: GREEN, backgroundColor: 'rgba(3,26,18,0.04)',
  },
  continueRestRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  continueRestCheck: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: BORDER,
    backgroundColor: BG, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  continueRestCheckMark: { fontSize: 13, color: GREEN, fontWeight: '700', lineHeight: 16 },
  continueRestTextWrap:  { flex: 1 },
  continueRestTitle:     { fontFamily: F_BODY, fontSize: 13, color: MUTED, fontWeight: '600', marginBottom: 3 },
  continueRestTitleActive: { color: TITLE },
  continueRestDesc:      { fontFamily: F_BODY, fontSize: 11, color: MUTED, lineHeight: 17 },
});
