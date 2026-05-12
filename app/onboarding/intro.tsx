import { useEffect, useRef, useState, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, StatusBar, Platform,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_400Regular } from '@expo-google-fonts/lora';
import { Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_500Medium } from '@expo-google-fonts/cinzel';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import * as Haptics from 'expo-haptics';
import { hapticLight, hapticMedium, hapticSuccess } from '@/utils/haptics';

// ─── tokens ─────────────────────────────────────────────────────────────────
const BG      = '#F8F4EA';   // warm ivory
const GREEN   = '#031A12';   // deep green — buttons, brand, borders
const TITLE_GREEN = '#0F4A36';  // visible title green — primary headings
const GOLD    = '#C6A15B';   // champagne gold
const MUTED   = '#7A6E61';   // warm grey
const SURF    = '#FFFFFF';
const BORDER  = 'rgba(3,26,18,0.10)';
const GOLD_BORDER = 'rgba(198,161,91,0.28)';

const F_BRAND  = 'Cinzel_500Medium';
const F_TITLE  = 'Lora_600SemiBold';
const F_BODY   = 'Lora_400Regular';
const F_ARABIC = 'Amiri_700Bold';

// ─── haptic config ───────────────────────────────────────────────────────────
const HAPTIC_EVERY_N_CHARS  = 4;
const HAPTIC_MIN_INTERVAL_MS = 85;

// ─── slide data ──────────────────────────────────────────────────────────────
interface Slide {
  id: number;
  eyebrow: string;
  title: string;
  body: string;
  accent?: string;
  isCta?: boolean;
}

const SLIDES: Slide[] = [
  {
    id: 1,
    eyebrow: 'Le défi du Hifz',
    title: 'Commencer est facile.\nContinuer est le vrai défi.',
    body: 'La plupart abandonnent non par manque de volonté, mais par manque de structure et de régularité.',
  },
  {
    id: 2,
    eyebrow: 'Ta solution',
    title: 'Un programme clair,\nchaque jour.',
    body: 'Zainly te donne un plan adapté à ton niveau — pas de surcharge, pas de flou.',
    accent: 'Structuré. Progressif. Sans effort superflu.',
  },
  {
    id: 3,
    eyebrow: 'Révisions intelligentes',
    title: 'Révise avant\nd\'oublier.',
    body: 'Zainly te rappelle les ayats au bon moment pour renforcer ta mémorisation durablement.',
    accent: 'Mémorise. Révise. Avance.',
  },
  {
    id: 4,
    eyebrow: 'Fait pour toi',
    title: 'Ton rythme.\nTon point de départ.\nTon Hifz.',
    body: 'Que tu commences de zéro ou que tu reprennes là où tu t\'es arrêté, Zainly s\'adapte à toi.',
    isCta: true,
  },
];

// ─── TypewriterText ───────────────────────────────────────────────────────────
// Renders text letter-by-letter. Exposes completeRef so parent can force-complete.
interface TypewriterProps {
  text: string;
  style: object | object[];
  slideKey: number;         // changes when slide changes → restart
  charDelay?: number;       // ms per character
  startDelay?: number;      // ms before first character
  enableHaptics?: boolean;
  onComplete?: () => void;
  completeRef?: React.MutableRefObject<(() => void) | null>;
}

const TypewriterText = memo(function TypewriterText({
  text, style, slideKey, charDelay = 18, startDelay = 0,
  enableHaptics = false, onComplete, completeRef,
}: TypewriterProps) {
  const [visible, setVisible] = useState(0);
  const intervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifiedRef    = useRef(false);   // guards onComplete — never fires during render
  const hapticCountRef = useRef(0);
  const lastHapticRef  = useRef(0);
  const mountedRef     = useRef(true);

  // force-complete: stop timers, jump to full text — onComplete fires via useEffect below
  const finish = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (timeoutRef.current)  { clearTimeout(timeoutRef.current);   timeoutRef.current  = null; }
    if (mountedRef.current)  { setVisible(text.length); }
  }, [text]);

  // expose finish() to parent
  useEffect(() => {
    if (completeRef) completeRef.current = finish;
  }, [completeRef, finish]);

  // reset on new slide / new text
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
          if (next >= text.length) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
          }
          return next;
        });
      }, charDelay);
    }, startDelay);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current)  { clearTimeout(timeoutRef.current);   timeoutRef.current  = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideKey, text]);

  // notify parent after render — never during render or inside a state updater
  useEffect(() => {
    if (text.length > 0 && visible >= text.length && !notifiedRef.current) {
      notifiedRef.current = true;
      onComplete?.();
    }
  }, [visible, text, onComplete]);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  return <Text style={style}>{text.slice(0, visible)}</Text>;
});

// ─── visual blocks ────────────────────────────────────────────────────────────

function Slide1Visual() {
  return (
    <View style={vStyles.timelineWrap}>
      {[
        { label: 'Motivation', sub: 'Le départ est fort' },
        { label: 'Flou',       sub: 'Les bases manquent' },
        { label: 'Abandon',    sub: 'La régularité s\'effrite' },
      ].map((row, i) => (
        <View key={i} style={vStyles.timelineRow}>
          <View style={vStyles.timelineDotWrap}>
            <View style={[vStyles.timelineDot, i === 2 && vStyles.timelineDotMuted]} />
            {i < 2 && <View style={vStyles.timelineConnector} />}
          </View>
          <View style={vStyles.timelineText}>
            <Text style={[vStyles.timelineLabel, i === 2 && vStyles.timelineLabelMuted]}>{row.label}</Text>
            <Text style={vStyles.timelineSub}>{row.sub}</Text>
          </View>
        </View>
      ))}
      <View style={vStyles.interruptWrap}>
        <View style={vStyles.interruptLine} />
        <Text style={vStyles.interruptLabel}>Zainly change la trajectoire</Text>
        <View style={vStyles.interruptLine} />
      </View>
    </View>
  );
}

function Slide2Visual() {
  return (
    <View style={vStyles.card}>
      <View style={vStyles.cardHeader}>
        <Text style={vStyles.cardHeaderLabel}>Aujourd'hui</Text>
        <View style={vStyles.cardBadge}><Text style={vStyles.cardBadgeText}>En cours</Text></View>
      </View>
      <View style={vStyles.cardDivider} />
      {[
        { action: 'Mémoriser', value: '2 ayats' },
        { action: 'Réviser',   value: '1 sourate' },
        { action: 'Avancer',   value: 'rythme stable' },
      ].map((row, i) => (
        <View key={i} style={vStyles.cardRow}>
          <View style={vStyles.cardDot} />
          <Text style={vStyles.cardAction}>{row.action}</Text>
          <Text style={vStyles.cardValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Slide3Visual() {
  return (
    <View style={vStyles.srsWrap}>
      <Text style={vStyles.srsLabel}>Calendrier de révision</Text>
      <View style={vStyles.srsPills}>
        {['J+1', 'J+3', 'J+7', 'J+14'].map((d, i) => (
          <View key={i} style={[vStyles.srsPill, i < 2 && vStyles.srsPillActive]}>
            <Text style={[vStyles.srsPillText, i < 2 && vStyles.srsPillTextActive]}>{d}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Slide4Visual() {
  return (
    <View style={vStyles.capsulesWrap}>
      {[
        { label: 'Rythme',   sub: 'Adapté à ta vie' },
        { label: 'Départ',   sub: 'Là où tu en es' },
        { label: 'Objectif', sub: 'Ton Hifz personnel' },
      ].map((c, i) => (
        <View key={i} style={vStyles.capsule}>
          <View style={vStyles.capsuleCheck} />
          <View>
            <Text style={vStyles.capsuleLabel}>{c.label}</Text>
            <Text style={vStyles.capsuleSub}>{c.sub}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const VISUAL_COMPONENTS = [Slide1Visual, Slide2Visual, Slide3Visual, Slide4Visual];

// ─── main component ───────────────────────────────────────────────────────────
export default function OnboardingIntroScreen() {
  const { user, ready } = useAuthStore();
  const [index, setIndex]         = useState(0);
  // phase: 'revealing' = typewriter running, 'done' = all text shown
  const [revealPhase, setRevealPhase] = useState<'revealing' | 'done'>('revealing');
  const isTransitioning = useRef(false);

  // refs to force-complete typewriter instances
  const titleCompleteRef = useRef<(() => void) | null>(null);
  const bodyCompleteRef  = useRef<(() => void) | null>(null);

  const [fontsLoaded] = useFonts({
    Lora_600SemiBold,
    Lora_400Regular,
    Amiri_700Bold,
    Cinzel_500Medium,
  });

  // ── animated values ─────────────────────────────────────────────────────────
  const eyebrowO = useRef(new Animated.Value(0)).current;
  const contentO = useRef(new Animated.Value(0)).current;
  const contentY = useRef(new Animated.Value(14)).current;
  const accentO  = useRef(new Animated.Value(0)).current;
  const accentY  = useRef(new Animated.Value(8)).current;
  const visualO  = useRef(new Animated.Value(0)).current;
  const visualY  = useRef(new Animated.Value(10)).current;
  const btnO     = useRef(new Animated.Value(0)).current;
  const btnY     = useRef(new Animated.Value(10)).current;
  const brandO   = useRef(new Animated.Value(0)).current;

  const animateIn = useCallback(() => {
    eyebrowO.setValue(0);
    contentO.setValue(0);
    contentY.setValue(14);
    accentO.setValue(0);
    accentY.setValue(8);
    visualO.setValue(0);
    visualY.setValue(10);
    btnO.setValue(0);
    btnY.setValue(10);

    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(eyebrowO, { toValue: 1, duration: 180, delay: 0,   easing: E, useNativeDriver: true }),
      Animated.timing(contentO, { toValue: 1, duration: 260, delay: 50,  easing: E, useNativeDriver: true }),
      Animated.timing(contentY, { toValue: 0, duration: 260, delay: 50,  easing: E, useNativeDriver: true }),
      Animated.timing(btnO,     { toValue: 1, duration: 240, delay: 80,  easing: E, useNativeDriver: true }),
      Animated.timing(btnY,     { toValue: 0, duration: 240, delay: 80,  easing: E, useNativeDriver: true }),
    ]).start();
  }, [eyebrowO, contentO, contentY, btnO, btnY]);

  function animateAccentAndVisual() {
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(accentO, { toValue: 1, duration: 240, delay: 0,  easing: E, useNativeDriver: true }),
      Animated.timing(accentY, { toValue: 0, duration: 240, delay: 0,  easing: E, useNativeDriver: true }),
      Animated.timing(visualO, { toValue: 1, duration: 280, delay: 60, easing: E, useNativeDriver: true }),
      Animated.timing(visualY, { toValue: 0, duration: 280, delay: 60, easing: E, useNativeDriver: true }),
    ]).start();
  }

  // auth guard
  useEffect(() => {
    if (!ready) return;
    if (!user) { router.replace('/(auth)/login'); }
  }, [ready, user]);

  // brand fade on mount, then first slide animate in
  useEffect(() => {
    if (!fontsLoaded) return;
    Animated.timing(brandO, {
      toValue: 1, duration: 300,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => animateIn());
  }, [fontsLoaded, animateIn, brandO]);

  // when revealPhase turns 'done', animate accent + visual
  useEffect(() => {
    if (revealPhase === 'done') {
      animateAccentAndVisual();
    }
  }, [revealPhase]);

  async function markIntroSeen() {
    if (!user?.id) return;
    const key = `zainly:onboardingIntroSeen:${user.id}`;
    try { await AsyncStorage.setItem(key, 'true'); } catch (_) { /* non-fatal */ }
  }

  function handleCtaPress() {
    if (isTransitioning.current) return;

    // if reveal still running: complete all text immediately on first tap
    if (revealPhase === 'revealing') {
      hapticLight();
      titleCompleteRef.current?.();
      bodyCompleteRef.current?.();
      return;
    }

    // reveal done — advance or finish
    if (index < SLIDES.length - 1) {
      isTransitioning.current = true;
      hapticLight();

      const E = Easing.in(Easing.cubic);
      Animated.parallel([
        Animated.timing(eyebrowO, { toValue: 0, duration: 120, easing: E, useNativeDriver: true }),
        Animated.timing(contentO, { toValue: 0, duration: 150, easing: E, useNativeDriver: true }),
        Animated.timing(contentY, { toValue: -8, duration: 150, easing: E, useNativeDriver: true }),
        Animated.timing(accentO,  { toValue: 0, duration: 130, easing: E, useNativeDriver: true }),
        Animated.timing(accentY,  { toValue: -4, duration: 130, easing: E, useNativeDriver: true }),
        Animated.timing(visualO,  { toValue: 0, duration: 130, easing: E, useNativeDriver: true }),
        Animated.timing(btnO,     { toValue: 0, duration: 120, easing: E, useNativeDriver: true }),
      ]).start(() => {
        setRevealPhase('revealing');
        setIndex(i => i + 1);
        requestAnimationFrame(() => {
          animateIn();
          isTransitioning.current = false;
        });
      });
    } else {
      hapticSuccess();
      markIntroSeen().then(() => router.replace('/onboarding'));
    }
  }

  function skipAll() {
    if (isTransitioning.current) return;
    hapticMedium();
    markIntroSeen().then(() => router.replace('/onboarding'));
  }

  if (!fontsLoaded) {
    return <View style={styles.root}><StatusBar barStyle="dark-content" /></View>;
  }

  const slide  = SLIDES[index];
  const isLast = index === SLIDES.length - 1;
  const VisualBlock = VISUAL_COMPONENTS[index];

  // title typewriter: ~22ms/char, body at ~13ms/char after title
  const titleLen = slide.title.replace(/\n/g, '').length;
  const titleDuration = Math.min(titleLen * 22, 1400);
  const bodyDelay = titleDuration + 80;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />

      {/* ── top bar ── */}
      <View style={styles.topBar}>
        <Animated.View style={[styles.brandLockup, { opacity: brandO }]}>
          <Text style={styles.brandArabic}>زينلي</Text>
          <View style={styles.goldLine} />
          <Text style={styles.brandWord}>Zainly</Text>
        </Animated.View>
        {!isLast && (
          <TouchableOpacity onPress={skipAll} style={styles.skipBtn} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
            <Text style={styles.skipText}>Passer</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── content ── */}
      <View style={styles.content}>
        <Animated.Text style={[styles.eyebrow, { opacity: eyebrowO }]}>
          {slide.eyebrow}
        </Animated.Text>

        <Animated.View style={{ opacity: contentO, transform: [{ translateY: contentY }] }}>
          <TypewriterText
            key={`title-${index}`}
            text={slide.title}
            style={styles.title}
            slideKey={index}
            charDelay={22}
            startDelay={60}
            enableHaptics
            completeRef={titleCompleteRef}
          />
        </Animated.View>

        <Animated.View style={{ opacity: contentO, transform: [{ translateY: contentY }] }}>
          <TypewriterText
            key={`body-${index}`}
            text={slide.body}
            style={styles.body}
            slideKey={index}
            charDelay={13}
            startDelay={bodyDelay}
            onComplete={() => setRevealPhase('done')}
            completeRef={bodyCompleteRef}
          />
        </Animated.View>

        {slide.accent && (
          <Animated.Text style={[styles.accent, { opacity: accentO, transform: [{ translateY: accentY }] }]}>
            {slide.accent}
          </Animated.Text>
        )}

        <Animated.View style={{ opacity: visualO, transform: [{ translateY: visualY }], marginTop: 24 }}>
          <VisualBlock />
        </Animated.View>
      </View>

      {/* ── bottom ── */}
      <Animated.View style={[styles.bottom, { opacity: btnO, transform: [{ translateY: btnY }] }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <TouchableOpacity
          style={[styles.cta, isLast && styles.ctaLast]}
          onPress={handleCtaPress}
          activeOpacity={0.82}
        >
          <Text style={[styles.ctaText, isLast && styles.ctaTextLast]}>
            {isLast ? 'Créons ton programme' : revealPhase === 'revealing' ? 'Afficher tout' : 'Continuer'}
          </Text>
          {isLast && <Text style={styles.ctaArrow}> →</Text>}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── visual block styles ──────────────────────────────────────────────────────
const vStyles = StyleSheet.create({
  // slide 1 — timeline
  timelineWrap:      { marginTop: 20 },
  timelineRow:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  timelineDotWrap:   { width: 20, alignItems: 'center', marginTop: 4 },
  timelineDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  timelineDotMuted:  { backgroundColor: 'rgba(198,161,91,0.35)' },
  timelineConnector: { width: 1, height: 18, backgroundColor: 'rgba(198,161,91,0.3)', marginTop: 2 },
  timelineText:      { marginLeft: 12, paddingBottom: 12 },
  timelineLabel:     { fontSize: 13, fontWeight: '600', color: TITLE_GREEN, letterSpacing: 0.1 },
  timelineLabelMuted:{ color: MUTED },
  timelineSub:       { fontSize: 11, color: MUTED, marginTop: 1 },
  interruptWrap:     { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  interruptLine:     { flex: 1, height: 1, backgroundColor: GOLD, opacity: 0.5 },
  interruptLabel:    { fontSize: 11, fontWeight: '600', color: GOLD, letterSpacing: 0.3 },

  // slide 2 — card
  card: {
    backgroundColor: SURF,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(198,161,91,0.25)',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  cardHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardHeaderLabel: { fontSize: 13, fontWeight: '700', color: TITLE_GREEN, letterSpacing: 0.2 },
  cardBadge:       { backgroundColor: 'rgba(198,161,91,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  cardBadgeText:   { fontSize: 10, fontWeight: '700', color: GOLD, letterSpacing: 1 },
  cardDivider:     { height: 1, backgroundColor: 'rgba(3,26,18,0.07)', marginBottom: 10 },
  cardRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardDot:         { width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  cardAction:      { fontSize: 13, color: TITLE_GREEN, fontWeight: '600', flex: 1 },
  cardValue:       { fontSize: 13, color: MUTED },

  // slide 3 — SRS pills
  srsWrap:         { marginTop: 4 },
  srsLabel:        { fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 },
  srsPills:        { flexDirection: 'row', gap: 8 },
  srsPill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(3,26,18,0.15)',
    backgroundColor: 'transparent',
  },
  srsPillActive:   { backgroundColor: GOLD, borderColor: GOLD },
  srsPillText:     { fontSize: 12, fontWeight: '600', color: MUTED },
  srsPillTextActive: { color: SURF },

  // slide 4 — capsules
  capsulesWrap:   { gap: 10 },
  capsule: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: SURF, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(198,161,91,0.22)',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  capsuleCheck:   { width: 8, height: 8, borderRadius: 4, backgroundColor: GOLD },
  capsuleLabel:   { fontSize: 13, fontWeight: '700', color: TITLE_GREEN, letterSpacing: 0.1 },
  capsuleSub:     { fontSize: 11, color: MUTED, marginTop: 1 },
});

// ─── main styles ──────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
  },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandArabic: { fontFamily: F_ARABIC, fontSize: 18, color: GOLD, includeFontPadding: false, lineHeight: 22 },
  goldLine:    { width: 1, height: 14, backgroundColor: GOLD, opacity: 0.5 },
  brandWord:   { fontFamily: F_BRAND, fontSize: 13, color: GREEN, letterSpacing: 3 },
  skipBtn:     { paddingVertical: 4 },
  skipText:    { fontSize: 14, color: MUTED, fontWeight: '500' },

  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    paddingBottom: 12,
  },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 2.5,
    color: GOLD, textTransform: 'uppercase', marginBottom: 16,
  },
  title: {
    fontFamily: F_TITLE, fontSize: 34, color: TITLE_GREEN,
    lineHeight: 42, letterSpacing: -0.2, marginBottom: 18,
    minHeight: 90,
  },
  body: {
    fontFamily: F_BODY, fontSize: 15, color: MUTED,
    lineHeight: 25, letterSpacing: 0.1, maxWidth: 320, marginBottom: 4,
    minHeight: 50,
  },
  accent: {
    fontFamily: F_BODY, fontSize: 13, color: GOLD,
    lineHeight: 20, letterSpacing: 0.2, fontStyle: 'italic', marginBottom: 4,
  },

  bottom: {
    paddingHorizontal: 28,
    paddingBottom: Platform.OS === 'ios' ? 48 : 32,
    gap: 16,
  },
  dots: { flexDirection: 'row', gap: 7, alignSelf: 'center' },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(3,26,18,0.10)',
    borderWidth: 1, borderColor: 'rgba(3,26,18,0.18)',
  },
  dotActive: { backgroundColor: GREEN, borderColor: GREEN, width: 20, borderRadius: 3 },

  cta: {
    backgroundColor: SURF, borderWidth: 1, borderColor: GOLD_BORDER,
    borderRadius: 14, paddingVertical: 17,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  ctaLast:     { backgroundColor: GREEN, borderColor: GREEN },
  ctaText:     { fontSize: 16, fontWeight: '600', color: GREEN, letterSpacing: 0.1 },
  ctaTextLast: { color: BG },
  ctaArrow:    { fontSize: 16, fontWeight: '600', color: BG },
});
