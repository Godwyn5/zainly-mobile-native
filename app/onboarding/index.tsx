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

// ─── rhythm options (module-scope — never recreated) ─────────────────────────
const RHYTHM_OPTIONS = [
  { ayahs: 1,  label: '1 ayat / jour',  desc: 'Parfait pour commencer en douceur' },
  { ayahs: 2,  label: '2 ayats / jour', desc: 'Un rythme stable et durable' },
  { ayahs: 3,  label: '3 ayats / jour', desc: 'Un excellent équilibre' },
  { ayahs: 4,  label: '4 ayats / jour', desc: 'Tu progresses rapidement' },
  { ayahs: 5,  label: '5 ayats / jour', desc: 'Très engagé — résultats visibles' },
  { ayahs: 6,  label: '6 ayats / jour', desc: 'Niveau avancé — forte discipline' },
  { ayahs: 10, label: '10 ayats / jour', desc: 'Très ambitieux — à choisir seulement si tu peux tenir' },
];

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
  | 'rhythm'
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

// ─── SeriousQuestionnaire ─────────────────────────────────────────────────────
// Covers steps: startMode → startSurahPicker/customOrderPicker → knownSurahs → rhythm → planSummary → creating

type SeriousStep = 'startMode' | 'startSurahPicker' | 'customOrderPicker' | 'knownSurahs' | 'rhythm' | 'planSummary' | 'creating';

const TOTAL_SERIOUS_STEPS = 3; // mode, known, rhythm (pickers are sub-steps of mode)

function seriousStepIndex(step: SeriousStep): number {
  if (step === 'startMode' || step === 'startSurahPicker' || step === 'customOrderPicker') return 1;
  if (step === 'knownSurahs') return 2;
  if (step === 'rhythm' || step === 'planSummary' || step === 'creating') return 3;
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
}
const SurahRow = memo(function SurahRow({ entry, selected, orderIndex, onPress, delay }: SurahRowProps) {
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
        activeOpacity={0.8}
        onPress={() => { hapticSelection(); onPress(entry.surah); }}
        style={[s.surahRow, selected && s.surahRowSelected]}
      >
        <View style={s.surahLeft}>
          {orderIndex != null
            ? <View style={s.orderBadge}><Text style={s.orderBadgeText}>{orderIndex}</Text></View>
            : <View style={[s.surahCheck, selected && s.surahCheckSelected]}>
                {selected && <Text style={s.surahCheckMark}>✓</Text>}
              </View>
          }
          <View style={{ flex: 1 }}>
            <Text style={[s.surahName, selected && s.surahNameSelected]}>{entry.name}</Text>
            <Text style={s.surahMeta}>Sourate {entry.surah} · {entry.ayahs} ayats</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ── RhythmCard ──
interface RhythmCardProps { ayahs: number; label: string; desc: string; selected: boolean; onPress: (n: number) => void; delay: number; recommended?: boolean; }
const RhythmCard = memo(function RhythmCard({ ayahs, label, desc, selected, onPress, delay, recommended }: RhythmCardProps) {
  const opacAnim   = useRef(new Animated.Value(0)).current;
  const scaleAnim  = useRef(new Animated.Value(0.96)).current;
  const pressScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacAnim,  { toValue: 1, duration: 280, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
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
        onPress={() => { hapticSelection(); onPress(ayahs); }}
        style={[s.card, selected && s.cardSelected]}
      >
        <View style={s.cardInner}>
          <View style={[s.cardDot, selected && s.cardDotSelected]} />
          <View style={s.cardText}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={[s.cardLabel, selected && s.cardLabelSelected]}>{label}</Text>
              {recommended && <View style={s.rhythmBadge}><Text style={s.rhythmBadgeText}>Recommandé</Text></View>}
            </View>
            <Text style={s.cardSub}>{desc}</Text>
          </View>
        </View>
        {selected && <View style={s.cardCheck}><Text style={s.cardCheckText}>✓</Text></View>}
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
  const [knownSurahs,      setKnownSurahs]      = useState<number[]>([]);
  const [ayahPerDay,       setAyahPerDay]       = useState<number>(2);
  const [surahSearch,      setSurahSearch]      = useState('');
  const [submitError,      setSubmitError]      = useState<string | null>(null);

  const allKnownSelected = knownSurahs.length === ZAINLY_ORDER.length;

  function toggleKnown(surahNum: number) {
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
    setSubmitError(null);
    hapticMedium();
    onStepChange('creating');

    const result = computePlan({
      userId,
      planMode,
      knownSurahs,
      startingSurah: planMode === 'start_surah' ? startingSurah : null,
      customSurahOrder: planMode === 'custom_order' ? customOrder : undefined,
      ayahPerDay,
    });

    if (isPlanError(result)) {
      setSubmitError(result.error);
      onStepChange('planSummary');
      hapticError();
      return;
    }

    try {
      await upsertPlan(userId, result.planPayload);
      await upsertProgress(userId, result.progressPayload);
      await queryClient.invalidateQueries({ queryKey: ['plan', userId] });
      await queryClient.invalidateQueries({ queryKey: ['progress', userId] });
      hapticSuccess();
      router.replace('/(app)/(tabs)');
    } catch {
      setSubmitError('Impossible de créer ton programme pour le moment. Réessaie dans un instant.');
      onStepChange('planSummary');
      hapticError();
    }
  }

  // Preview computed result for summary screen (no DB write)
  const previewResult = useMemo(() => {
    if (step !== 'planSummary') return null;
    return computePlan({
      userId,
      planMode,
      knownSurahs,
      startingSurah: planMode === 'start_surah' ? startingSurah : null,
      customSurahOrder: planMode === 'custom_order' ? customOrder : undefined,
      ayahPerDay,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, userId, planMode, knownSurahs, startingSurah, customOrder, ayahPerDay]);

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
                onPress={setStartingSurah}
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
            renderItem={({ item }) => (
              <SurahRow
                entry={item}
                selected={knownSurahs.includes(item.surah)}
                onPress={toggleKnown}
                delay={0}
              />
            )}
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
                onStepChange('rhythm');
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

  // ── Step: rhythm ──
  if (step === 'rhythm') {
    return (
      <PageShell stepKey="rhythm">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 54 : 36 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <SeriousProgressBar current={3} total={TOTAL_SERIOUS_STEPS} />
          <ScrollView style={s.qScroll} contentContainerStyle={s.qScrollContent} showsVerticalScrollIndicator={false}>
            <View style={s.qHeader}>
              <Text style={s.qEyebrow}>RYTHME</Text>
              <Text style={s.qTitle}>{'Quel rythme veux-tu suivre ?'}</Text>
              <Text style={s.qSubtitle}>{'Choisis une quantité que tu peux tenir régulièrement. La régularité est plus importante que la vitesse.'}</Text>
            </View>
            <View style={s.qOptions}>
              {RHYTHM_OPTIONS.map((opt, i) => (
                <RhythmCard key={opt.ayahs} ayahs={opt.ayahs} label={opt.label} desc={opt.desc}
                  selected={ayahPerDay === opt.ayahs}
                  recommended={opt.ayahs === 2 || opt.ayahs === 3}
                  onPress={setAyahPerDay}
                  delay={60 + i * 45} />
              ))}
            </View>
          </ScrollView>
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); onStepChange('knownSurahs'); }}>
              <Text style={s.backBtnText}>← Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ctaBtn} activeOpacity={0.85}
              onPress={() => { hapticLight(); onStepChange('planSummary'); }}>
              <Text style={s.ctaBtnText}>Continuer</Text>
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
      : 'Liberté totale';

    const startLabel = planMode === 'start_surah' && startingSurah
      ? (ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[startingSurah]]?.name ?? '—')
      : planMode === 'recommended' ? 'Choisie par Zainly'
      : customOrder.length > 0
        ? (ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[customOrder[0]]]?.name ?? '—')
        : '—';

    const previewOk          = previewResult && !isPlanError(previewResult);
    const estimateRange       = previewOk ? previewResult!.computed.estimateRange : null;
    const computedEstimate    = estimateRange ? estimateRange.label : null;
    const actualFirstName     = previewOk ? previewResult!.computed.firstSurahName : startLabel;
    const skipped             = previewOk ? previewResult!.computed.skippedKnownSurahs : [];
    const startSurahWasSkipped = planMode === 'start_surah' && startingSurah != null
      && skipped.includes(startingSurah);
    const showHighPaceWarning = ayahPerDay >= 7;

    return (
      <PageShell stepKey="planSummary">
        <View style={[s.qRoot, { paddingTop: Platform.OS === 'ios' ? 64 : 48 }]}>
          <StatusBar barStyle="dark-content" backgroundColor={BG} />
          <ScrollView style={s.qScroll} contentContainerStyle={s.qScrollContent} showsVerticalScrollIndicator={false}>
            <Text style={s.qEyebrow}>RÉCAPITULATIF</Text>
            <Text style={s.qTitle}>{'Ton programme\nest prêt.'}</Text>
            <Text style={[s.qSubtitle, { marginBottom: 24 }]}>{'Vérifie tes choix avant de créer ton parcours.'}</Text>

            {showHighPaceWarning && (
              <View style={s.ambitiousCard}>
                <Text style={s.ambitiousTitle}>Rythme très ambitieux</Text>
                <Text style={s.ambitiousText}>{'Ce rythme peut fonctionner si tu as déjà une routine solide. Les révisions deviendront plus importantes avec le temps.'}</Text>
              </View>
            )}

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
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Sourates connues</Text>
                <Text style={s.summaryRowValue}>{knownSurahs.length > 0 ? `${knownSurahs.length} sourate${knownSurahs.length > 1 ? 's' : ''}` : 'Aucune'}</Text>
              </View>
              <View style={s.summaryDivider} />
              <View style={s.summaryRow}>
                <Text style={s.summaryRowLabel}>Rythme</Text>
                <Text style={s.summaryRowValue}>{ayahPerDay} ayat{ayahPerDay > 1 ? 's' : ''} / jour</Text>
              </View>
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
                  {planMode === 'custom_order'
                    ? 'Estimation pour terminer ton ordre personnalisé.'
                    : 'Estimation pour mémoriser le Coran restant, selon ton rythme actuel.'}
                </Text>
                <Text style={s.estimateHelperLine}>{'La fourchette tient compte des révisions et des semaines plus lentes.'}</Text>
              </View>
            )}
          </ScrollView>
          <View style={s.ctaWrap}>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.8}
              onPress={() => { hapticLight(); onStepChange('rhythm'); }}>
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
    <View style={s.loading}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <Text style={s.loadingDot}>·</Text>
      <Text style={s.loadingText}>Création de ton programme…</Text>
    </View>
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

  // ── routing guard ──
  useEffect(() => {
    if (!ready) return;
    if (!user) { router.replace('/(auth)/login'); return; }
    if (isLoading) return;
    if (plan) { router.replace('/(app)/(tabs)'); return; }
    if (!introSeen) { router.replace('/onboarding/intro'); return; }
    if (personalDone && !seriousStartedRef.current) {
      seriousStartedRef.current = true;
      setPersonalStep('startMode');
    }
  }, [ready, user, isLoading, plan, introSeen, personalDone]);

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

  // ── loading / gate ──
  if (!user || isLoading || plan || !introSeen) {
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
  surahLeft:         { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  surahCheck:        { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  surahCheckSelected:{ borderColor: GOLD, backgroundColor: GOLD },
  surahCheckMark:    { fontSize: 11, color: SURF, fontWeight: '700' },
  surahName:         { fontFamily: F_BODY, fontSize: 13, fontWeight: '600', color: TITLE },
  surahNameSelected: { color: GREEN },
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

  // ── rhythm badge (Recommandé) ──
  rhythmBadge:     { backgroundColor: 'rgba(198,161,91,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  rhythmBadgeText: { fontFamily: F_BODY, fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 0.5 },

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

  // ── ambitious pace card ──
  ambitiousCard: {
    backgroundColor: 'rgba(198,161,91,0.08)',
    borderRadius: 10, borderWidth: 1, borderColor: GOLD_B,
    padding: 14, marginBottom: 12,
  },
  ambitiousTitle: { fontFamily: F_BODY, fontSize: 12, fontWeight: '700', color: TITLE, marginBottom: 4 },
  ambitiousText:  { fontFamily: F_BODY, fontSize: 12, color: MUTED, lineHeight: 18 },

  // ── estimate helper text ──
  estimateHelperWrap: { paddingHorizontal: 4, marginBottom: 20, gap: 4 },
  estimateHelperLine: { fontFamily: F_BODY, fontSize: 11, color: MUTED, lineHeight: 17 },
});
