import { useEffect, useRef, useState, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
  Animated, Easing, ScrollView, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { usePlan } from '@/hooks/usePlan';
import * as Haptics from 'expo-haptics';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_400Regular } from '@expo-google-fonts/lora';


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

type PersonalStep = 'motivation' | 'obstacle' | 'summary' | 'questionnaire';

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
  const w = useRef(new Animated.Value(step === 1 ? 0.5 : 1)).current;
  return (
    <View style={s.progressTrack}>
      <Animated.View style={[s.progressFill, { flex: w }]} />
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

// ─── QuestionnairePlaceholder ─────────────────────────────────────────────────
function QuestionnairePlaceholder() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const yAnim    = useRef(new Animated.Value(16)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(yAnim,    { toValue: 0, duration: 320, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[s.phRoot, { opacity: fadeAnim, transform: [{ translateY: yAnim }] }]}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <View style={s.phContent}>
        <Text style={s.phEyebrow}>TON PROGRAMME</Text>
        <Text style={s.phTitle}>{'Créons ton\nprogramme.'}</Text>
        <Text style={s.phSub}>
          {'La prochaine étape servira à choisir ton rythme, ton point de départ et ce que tu connais déjà.'}
        </Text>
        <View style={s.phCard}>
          <View style={s.phCardRow}><View style={s.phDot} /><Text style={s.phCardText}>Rythme quotidien</Text></View>
          <View style={s.phCardRow}><View style={s.phDot} /><Text style={s.phCardText}>Point de départ</Text></View>
          <View style={s.phCardRow}><View style={s.phDot} /><Text style={s.phCardText}>Sourates déjà connues</Text></View>
        </View>
      </View>
      <View style={s.ctaWrap}>
        <TouchableOpacity style={[s.ctaBtn, s.ctaBtnDim]} activeOpacity={0.7} onPress={() => {}}>
          <Text style={s.ctaBtnText}>Étape suivante en préparation</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
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
    if (personalDone) { setPersonalStep('questionnaire'); }
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
    setPersonalStep('summary');
  }
  function handleSummaryContinue() {
    setPersonalDone(true);
    setPersonalStep('questionnaire');
  }

  // ── loading / gate ──
  if (isLoading || plan || !introSeen) {
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

  if (personalStep === 'summary') {
    return <SummaryScreen onContinue={handleSummaryContinue} />;
  }

  return <QuestionnairePlaceholder />;
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

  // questionnaire placeholder
  phRoot:     { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'ios' ? 64 : 44 },
  phContent:  { flex: 1, paddingHorizontal: 28 },
  phEyebrow:  { fontSize: 10, fontWeight: '700', letterSpacing: 2.5, color: GOLD, textTransform: 'uppercase', marginBottom: 14 },
  phTitle:    { fontFamily: F_TITLE, fontSize: 36, color: TITLE, lineHeight: 46, letterSpacing: -0.3, marginBottom: 14 },
  phSub:      { fontFamily: F_BODY, fontSize: 15, color: MUTED, lineHeight: 24, marginBottom: 28 },
  phCard: {
    backgroundColor: SURF, borderRadius: 16, borderWidth: 1,
    borderColor: GOLD_B, paddingHorizontal: 20, paddingVertical: 18, gap: 12,
  },
  phCardRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  phCardText: { fontFamily: F_BODY, fontSize: 14, color: TITLE },
});
