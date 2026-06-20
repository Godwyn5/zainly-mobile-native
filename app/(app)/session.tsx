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
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { PremiumBackground } from '@/components/PremiumBackground';
import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium, hapticSelection } from '@/utils/haptics';
import { getQuranAyahRange } from '@/core/quranContent';
import type { QuranAyahContent } from '@/core/quranContent';
import { useAuthStore }      from '@/store/authStore';
import { usePlan }           from '@/hooks/usePlan';
import { useProgress }       from '@/hooks/useProgress';
import { useDueReviews }     from '@/hooks/useDueReviews';
import { getTodayProgramme } from '@/core/dailyPlan';

// ─── constants ────────────────────────────────────────────────────────────────

const SW = Dimensions.get('window').width;
const PROGRESS_PCT           = 0.13; // Step 1 anchors at ~13%
const DISCOVERY_PROGRESS_PCT = 0.28; // Step 2 anchors at ~28%
const DECOUPAGE_PROGRESS_PCT   = 0.44; // Step 3 anchors at ~44%
const REPETITION_PROGRESS_PCT  = 0.60; // Step 4 anchors at ~60%
const RECITATION_PROGRESS_PCT  = 0.86; // Step 5 anchors at ~86%
const FINAL_TEST_PROGRESS_PCT  = 0.96; // Step 6 anchors at ~96%

// ─── helpers ──────────────────────────────────────────────────────────────────

function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function estimateDuration(ayatCount: number, hasReviews: boolean): string {
  if (ayatCount <= 2) return hasReviews ? '~8 min' : '~5 min';
  if (ayatCount <= 5) return hasReviews ? '~12 min' : '~8 min';
  return hasReviews ? '~20 min' : '~15 min';
}

// ─── Découpage chunking helper ────────────────────────────────────────────────

function chunkAyat(arabic: string): string[] {
  if (!arabic || !arabic.trim()) return [];
  const words = arabic.trim().split(/\s+/).filter(w => w.length > 0);
  const n = words.length;
  if (n === 0) return [];
  if (n <= 3) {
    // 1 word per chunk
    return words;
  }
  if (n <= 6) {
    // chunks of 2
    const out: string[] = [];
    for (let i = 0; i < n; i += 2) {
      out.push(words.slice(i, i + 2).join(' '));
    }
    return out;
  }
  // 7+ words: chunks of 3 (last chunk may be 1–3 words)
  const out: string[] = [];
  for (let i = 0; i < n; i += 3) {
    out.push(words.slice(i, i + 3).join(' '));
  }
  return out;
}

// Safe transliteration word-split mapping — only attempt if word counts match exactly
function chunkTranslit(translit: string | null | undefined, arabicChunks: string[]): string[] | null {
  if (!translit || !translit.trim()) return null;
  const tWords = translit.trim().split(/\s+/).filter(w => w.length > 0);
  const aWords = arabicChunks.flatMap(c => c.split(/\s+/));
  if (tWords.length !== aWords.length) return null; // counts differ — skip safely
  // Rebuild transliteration chunks matching arabic chunk word counts
  const result: string[] = [];
  let idx = 0;
  for (const chunk of arabicChunks) {
    const wc = chunk.split(/\s+/).length;
    result.push(tWords.slice(idx, idx + wc).join(' '));
    idx += wc;
  }
  return result;
}

type ChargeLevel = 'light' | 'normal' | 'intense';
function chargeInfo(ayatCount: number, reviewCount: number): { label: string; level: ChargeLevel } {
  if (reviewCount >= 5 || ayatCount >= 6) return { label: 'Intense', level: 'intense' };
  if (reviewCount > 0  || ayatCount >= 3) return { label: 'Normale', level: 'normal'  };
  return                                         { label: 'Légère',  level: 'light'   };
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SessionProgressBar({ pct, label, phase: phaseLabel }: { pct: number; label: string; phase: string }) {
  const mountedRef = useRef(true);
  const fillAnim   = useRef(new Animated.Value(0)).current;
  const dotGlow    = useRef(new Animated.Value(0.5)).current;
  const dotLoop    = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const fill = Animated.timing(fillAnim, {
      toValue: pct, duration: 1000, delay: 300,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    fill.start(() => {
      if (!mountedRef.current) return;
      dotLoop.current = Animated.loop(Animated.sequence([
        Animated.timing(dotGlow, { toValue: 1,   duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(dotGlow, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
      dotLoop.current.start();
    });
    return () => {
      mountedRef.current = false;
      fill.stop();
      dotLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  const w = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={spb.wrap}>
      <View style={spb.labelRow}>
        <Text style={spb.label}>{label}</Text>
        <Text style={spb.pct}>{Math.round(pct * 100)}%</Text>
      </View>
      <View style={spb.track}>
        <Animated.View style={[spb.fill, { width: w }]}>
          <View style={spb.shimmer} />
        </Animated.View>
        {/* Dot position driven by JS (same driver as fillAnim), glow driven by native */}
        <Animated.View style={[spb.dotWrap, { left: w as unknown as number }]}>
          <Animated.View style={[spb.dot, {
            opacity: dotGlow,
            transform: [{ scale: dotGlow.interpolate({ inputRange: [0.5, 1], outputRange: [0.85, 1.15] }) }],
          }]} />
        </Animated.View>
      </View>
      <Text style={spb.phase}>{phaseLabel}</Text>
    </View>
  );
}
const spb = StyleSheet.create({
  wrap:     { marginBottom: spacing.md },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label:    { fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 0.6 },
  pct:      { fontSize: 11, fontWeight: '800', color: colors.gold },
  track:    { height: 8, backgroundColor: 'rgba(184,150,46,0.15)', borderRadius: 6, overflow: 'visible', position: 'relative' },
  fill:     { height: 8, borderRadius: 6, backgroundColor: colors.gold, overflow: 'hidden' },
  shimmer:  { position: 'absolute', top: 0, left: '20%', width: '40%', height: '100%', backgroundColor: 'rgba(255,255,255,0.30)', borderRadius: 6 },
  dotWrap:  { position: 'absolute', top: -3, marginLeft: -7 },
  dot:      { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.gold, borderWidth: 2.5, borderColor: colors.background },
  phase:    { fontSize: 10, fontWeight: '600', color: colors.gold, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 5 },
});

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
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  card:          {
    width: (SW - spacing.lg * 2 - spacing.sm) / 2,
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)',
    padding: spacing.md,
    shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
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

// ─── Step 2: Découverte de l'ayat ─────────────────────────────────────────────

interface DiscoveryScreenProps {
  surahNumber: number;
  surahName:   string;
  memStart:    number;
  memEnd:      number;
  onBack:      () => void;
  onNext:      (loadedAyat: QuranAyahContent | null) => void;
}

function DiscoveryScreen({ surahNumber, surahName, memStart, onBack, onNext }: DiscoveryScreenProps) {
  const mountedRef = useRef(true);

  // ── Quran content ──
  const [ayat, setAyat] = useState<QuranAyahContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    getQuranAyahRange({ surahNumber, fromAyah: memStart, toAyah: memStart })
      .then(result => {
        if (!mountedRef.current) return;
        if (result.ok && result.ayahs.length > 0) {
          setAyat(result.ayahs[0]);
        } else {
          setContentError(!result.ok ? result.error : 'Contenu introuvable.');
        }
      })
      .catch(() => {
        if (mountedRef.current) setContentError('Impossible de charger l\'ayat.');
      });
    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahNumber, memStart]);

  // ── listen gate ──
  const MIN_LISTENS = 3;
  const [listenCount, setListenCount] = useState(0);
  const unlocked = listenCount >= MIN_LISTENS;

  // ── animation refs ──
  const screenAnim  = useRef(new Animated.Value(0)).current;
  const cardAnim    = useRef(new Animated.Value(0)).current;
  const arabicAnim  = useRef(new Animated.Value(0)).current;
  const transAnim   = useRef(new Animated.Value(0)).current;
  const translAnim  = useRef(new Animated.Value(0)).current;
  const ctaShine    = useRef(new Animated.Value(-1)).current;
  const ctaShineLoop= useRef<Animated.CompositeAnimation | null>(null);
  const audioPulse  = useRef(new Animated.Value(1)).current;
  const audioPulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const haloScale   = useRef(new Animated.Value(1)).current;
  const haloOpacity = useRef(new Animated.Value(0.10)).current;
  const haloLoop    = useRef<Animated.CompositeAnimation | null>(null);
  const countPulse  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mountedRef.current = true;

    // staggered entrance
    Animated.stagger(90, [
      Animated.timing(screenAnim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim,   { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(arabicAnim, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(transAnim,  { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translAnim, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // halo breathing
    haloLoop.current = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.09, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.20, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(haloScale,   { toValue: 1.00, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(haloOpacity, { toValue: 0.10, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ]));
    haloLoop.current.start();

    // audio button subtle pulse
    audioPulseLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(audioPulse, { toValue: 1.04, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(audioPulse, { toValue: 1.00, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    audioPulseLoop.current.start();

    // CTA shine sweep
    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2600),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();

    return () => {
      mountedRef.current = false;
      haloLoop.current?.stop();
      audioPulseLoop.current?.stop();
      ctaShineLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAudioPress = useCallback(() => {
    hapticMedium();
    setListenCount(prev => prev + 1);
    Animated.sequence([
      Animated.timing(countPulse, { toValue: 1.18, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(countPulse, { toValue: 1.00, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctaLabel = !unlocked
    ? (listenCount === 0 ? 'Écoute 3 fois pour continuer' : listenCount === MIN_LISTENS - 1 ? 'Encore 1 écoute' : `Encore ${MIN_LISTENS - listenCount} écoutes`)
    : 'Continuer vers le découpage →';

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  return (
    <SafeAreaView style={ds.safe}>
      {/* background */}
      <PremiumBackground />
      <Animated.View pointerEvents="none" style={[ds.halo, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
      <View style={ds.ornLine} pointerEvents="none" />

      <ScrollView contentContainerStyle={ds.scroll} showsVerticalScrollIndicator={false}>

        {/* ── HEADER ── */}
        <Animated.View style={[ds.header, {
          opacity: screenAnim,
          transform: [{ translateY: screenAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        }]}>
          {/* back button */}
          <Pressable style={ds.backBtn} onPress={() => { hapticLight(); onBack(); }} hitSlop={12}>
            <Text style={ds.backBtnText}>←</Text>
          </Pressable>

          <View style={ds.headerChip}>
            <View style={ds.headerChipDot} />
            <Text style={ds.headerChipText}>DÉCOUVERTE</Text>
          </View>
          <Text style={ds.headerTitle}>Découverte de l'ayat</Text>
          <Text style={ds.headerSub}>Lis doucement. Écoute 3 fois. Ne cherche pas encore à retenir.</Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: screenAnim }}>
          <SessionProgressBar
            pct={DISCOVERY_PROGRESS_PCT}
            label="Étape 2 · Découverte de l'ayat"
            phase="Lecture"
          />
        </Animated.View>

        {/* ── AYAT CARD ── */}
        <Animated.View style={[ds.ayatCardWrap, {
          opacity: cardAnim,
          transform: [
            { translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale:       cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) },
          ],
        }]}>
          {/* glow border behind */}
          <View style={ds.ayatGlowBorder} />
          <View style={ds.ayatCard}>

            {/* top row: badge + ayat counter */}
            <View style={ds.ayatCardTopRow}>
              <View style={ds.premiereBadge}>
                <Text style={ds.premiereBadgeText}>Première découverte</Text>
              </View>
              <View style={ds.ayatCounter}>
                <Text style={ds.ayatCounterText}>Ayat {memStart}</Text>
              </View>
            </View>

            <View style={ds.ayatDivider} />

            {/* Arabic text — visually dominant */}
            {contentError ? (
              <View style={ds.errorWrap}>
                <Text style={ds.errorText}>{contentError}</Text>
              </View>
            ) : ayat ? (
              <>
                <Animated.Text
                  style={[ds.arabicText, { opacity: arabicAnim }]}
                  textBreakStrategy="simple"
                >
                  {ayat.arabic}
                </Animated.Text>

                {ayat.transliteration ? (
                  <>
                    <View style={ds.ayatSubDivider} />
                    <Animated.Text style={[ds.translitText, { opacity: transAnim }]}>
                      {ayat.transliteration}
                    </Animated.Text>
                  </>
                ) : null}

                {ayat.translationFr ? (
                  <>
                    <View style={ds.ayatSubDivider} />
                    <Animated.Text style={[ds.translationText, { opacity: translAnim }]}>
                      {ayat.translationFr}
                    </Animated.Text>
                  </>
                ) : null}
              </>
            ) : (
              <View style={ds.loadingAyat}>
                <Text style={ds.loadingAyatText}>Chargement…</Text>
              </View>
            )}

            <View style={ds.ayatDivider} />

            {/* Audio section — listen gate */}
            <View style={ds.audioSection}>
              {/* counter / badge row */}
              <Animated.View style={[ds.listenCountRow, { transform: [{ scale: countPulse }] }]}>
                {unlocked ? (
                  <View style={ds.minBadge}>
                    <View style={ds.minBadgeDot} />
                    <Text style={ds.minBadgeText}>Minimum atteint</Text>
                  </View>
                ) : (
                  <View style={ds.listenCounter}>
                    <Text style={ds.listenCounterText}>Écoute {listenCount}/{MIN_LISTENS}</Text>
                  </View>
                )}
              </Animated.View>

              {/* audio button */}
              <Animated.View style={{ transform: [{ scale: audioPulse }] }}>
                <Pressable
                  style={({ pressed }) => [ds.audioBtn, pressed && ds.audioBtnPressed]}
                  onPress={onAudioPress}
                  accessibilityLabel={unlocked ? "Réécouter l'ayat" : "Écouter l'ayat"}
                >
                  <View style={ds.audioBtnInner}>
                    <View style={ds.audioIcon}>
                      <View style={ds.audioIconBar1} />
                      <View style={ds.audioIconBar2} />
                      <View style={ds.audioIconBar3} />
                    </View>
                    <Text style={ds.audioBtnText}>
                      {unlocked ? "Réécouter l'ayat" : "Écouter l'ayat"}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>

              {/* helper text after unlock */}
              {unlocked ? (
                <Text style={ds.listenHelper}>Tu peux réécouter autant que nécessaire.</Text>
              ) : null}
            </View>

          </View>
        </Animated.View>

        <View style={{ height: 8 }} />

        {/* ── COACH NOTE ── */}
        <Animated.View style={[ds.coachCard, { opacity: translAnim }]}>
          <View style={ds.coachBorder} />
          <View style={ds.coachInner}>
            <View style={ds.coachTitleRow}>
              <Text style={ds.coachQuote}>"</Text>
              <Text style={ds.coachEyebrow}>CONSEIL DE ZAINLY</Text>
            </View>
            <Text style={ds.coachText}>
              Observe simplement l'ayat.{'\n'}Tu vas le découper ensuite, morceau par morceau.
            </Text>
          </View>
          <View style={ds.coachFloatDot} pointerEvents="none" />
        </Animated.View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <View style={ds.stickyBottom}>
        <View style={ds.ctaWrap}>
          <Pressable
            style={({ pressed }) => [ds.cta, !unlocked && ds.ctaLocked, unlocked && pressed && ds.ctaPressed]}
            onPress={() => { if (!unlocked) return; hapticSelection(); onNext(ayat); }}
            accessibilityState={{ disabled: !unlocked }}
          >
            <Text style={[ds.ctaText, !unlocked && ds.ctaLockedText]}>{ctaLabel}</Text>
            {unlocked ? <Animated.View pointerEvents="none" style={[ds.ctaShine, { left: ctaShineX }]} /> : null}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
const ds = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.background },
  scroll:       { paddingHorizontal: spacing.lg, paddingTop: 4, paddingBottom: 0 },

  // background
  halo:         { position: 'absolute', top: -70, right: -90, width: 320, height: 320, borderRadius: 160, backgroundColor: 'rgba(22,48,38,0.11)', zIndex: 0 },
  ornLine:      { position: 'absolute', top: 200, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.10)', zIndex: 0 },

  // header
  header:       { marginBottom: spacing.sm },
  backBtn:      { marginBottom: 8, alignSelf: 'flex-start' },
  backBtnText:  { fontSize: 22, color: colors.muted, fontWeight: '300', lineHeight: 24 },
  headerChip:   { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(184,150,46,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)', marginBottom: 6 },
  headerChipDot:{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  headerChipText:{ fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 1.4 },
  headerTitle:  { fontSize: 20, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  headerSub:    { fontSize: 13, color: colors.muted },

  // ayat card
  ayatCardWrap: { position: 'relative', marginBottom: spacing.md },
  ayatGlowBorder:{ position: 'absolute', top: 4, left: -3, right: -3, bottom: 0, borderRadius: 28, backgroundColor: 'rgba(184,150,46,0.13)', zIndex: 0 },
  ayatCard:     {
    backgroundColor: '#FEFCF5',
    borderRadius: 26, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.30)',
    paddingHorizontal: spacing.lg, paddingVertical: 12,
    shadowColor: colors.gold, shadowOpacity: 0.13, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    zIndex: 1,
  },
  ayatCardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  premiereBadge:  { backgroundColor: 'rgba(184,150,46,0.13)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.30)' },
  premiereBadgeText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 0.6 },
  ayatCounter:    { backgroundColor: 'rgba(22,48,38,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.20)' },
  ayatCounterText:{ fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 0.4 },

  ayatDivider:    { height: 1, backgroundColor: 'rgba(184,150,46,0.18)', marginVertical: 10 },
  ayatSubDivider: { height: 1, backgroundColor: 'rgba(184,150,46,0.10)', marginVertical: 6 },

  // Arabic text — sacred reading card hierarchy
  arabicText:   {
    fontSize: 32, color: colors.primary, textAlign: 'right',
    lineHeight: 56, fontWeight: '600',
    writingDirection: 'rtl',
    letterSpacing: 1.5,
    marginVertical: 4,
  },
  translitText: { fontSize: 15, fontWeight: '600', color: colors.primary, lineHeight: 28, textAlign: 'left', fontStyle: 'italic' },
  translationText: { fontSize: 13, color: colors.muted, lineHeight: 22, textAlign: 'left' },

  // loading / error
  loadingAyat:    { paddingVertical: spacing.lg, alignItems: 'center' },
  loadingAyatText:{ fontSize: 13, color: colors.muted, fontStyle: 'italic' },
  errorWrap:      { paddingVertical: spacing.md },
  errorText:      { fontSize: 13, color: colors.danger, lineHeight: 20 },

  // audio button
  audioBtn: {
    backgroundColor: colors.surface,
    borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.32)',
    paddingVertical: 11, paddingHorizontal: spacing.lg,
    shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  audioBtnPressed: { opacity: 0.80, transform: [{ scale: 0.975 }] },
  audioBtnInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  audioIcon:       { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18 },
  audioIconBar1:   { width: 3, height: 10, borderRadius: 2, backgroundColor: colors.primary },
  audioIconBar2:   { width: 3, height: 18, borderRadius: 2, backgroundColor: colors.primary },
  audioIconBar3:   { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.primary },
  audioBtnText:    { fontSize: 14, fontWeight: '700', color: colors.primary, letterSpacing: 0.3 },

  // coach card
  coachCard:     { flexDirection: 'row', backgroundColor: '#FBF6E9', borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)', overflow: 'hidden', shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2, position: 'relative' },
  coachBorder:   { width: 5, backgroundColor: colors.gold, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  coachInner:    { flex: 1, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  coachTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  coachQuote:    { fontSize: 24, color: colors.gold, lineHeight: 26, marginRight: 5, fontWeight: '700' },
  coachEyebrow:  { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: colors.gold, textTransform: 'uppercase', flex: 1 },
  coachText:     { fontSize: 14, color: colors.primary, lineHeight: 24, fontStyle: 'italic' },
  coachFloatDot: { position: 'absolute', right: 14, top: 14, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(184,150,46,0.40)' },

  // sticky CTA
  stickyBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.15)', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  ctaWrap:      { position: 'relative' },
  cta:          { backgroundColor: colors.primary, borderRadius: 16, height: 58, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: colors.primary, shadowOpacity: 0.40, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  ctaPressed:   { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:      { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  ctaShine:     { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.11)', transform: [{ skewX: '-20deg' }] },
  ctaLocked:    { backgroundColor: 'rgba(22,48,38,0.20)', shadowOpacity: 0 },
  ctaLockedText:{ color: 'rgba(22,48,38,0.55)', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },

  // audio gate
  audioSection:     { gap: 8 },
  listenCountRow:   { alignItems: 'center', marginBottom: 2 },
  listenCounter:    { backgroundColor: 'rgba(184,150,46,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)' },
  listenCounterText:{ fontSize: 11, fontWeight: '700', color: colors.gold, letterSpacing: 0.8 },
  minBadge:         { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.22)', gap: 5 },
  minBadgeDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  minBadgeText:     { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.6 },
  listenHelper:     { fontSize: 12, color: colors.muted, textAlign: 'center', fontStyle: 'italic', marginTop: 2 },
});

// ─── Step 3: Découpage (focus mode) ──────────────────────────────────────────

interface DecoupageScreenProps {
  surahNumber: number;
  ayatNumber:  number;
  ayat:        QuranAyahContent | null;
  onBack:      () => void;
  onNext:      () => void;
}

function DecoupageScreen({ ayatNumber, ayat, onBack, onNext }: DecoupageScreenProps) {
  const mountedRef = useRef(true);

  // ── compute chunks once ──
  const chunks = useMemo(() => {
    if (!ayat?.arabic) return [];
    return chunkAyat(ayat.arabic);
  }, [ayat?.arabic]);

  const translitChunks = useMemo(() => {
    if (!ayat?.transliteration || chunks.length === 0) return null;
    return chunkTranslit(ayat.transliteration, chunks);
  }, [ayat?.transliteration, chunks]);

  // ── focus state — one chunk at a time ──
  const [focusIdx,    setFocusIdx]    = useState(0);
  const [visitedCount,setVisitedCount]= useState(1); // chunk 0 auto-visited
  const total        = chunks.length;
  const allVisited   = total > 0 && visitedCount >= total;
  // guard rapid taps during transition
  const isTransitioning = useRef(false);

  // ── animation refs ──
  const mountAnim    = useRef(new Animated.Value(0)).current;
  const refCardAnim  = useRef(new Animated.Value(0)).current;
  const focusCardAnim= useRef(new Animated.Value(0)).current;
  const coachAnim    = useRef(new Animated.Value(0)).current;
  const ctaShine     = useRef(new Animated.Value(-1)).current;
  const ctaShineLoop = useRef<Animated.CompositeAnimation | null>(null);
  const activeGlow   = useRef(new Animated.Value(0.5)).current;
  const activeGlowLoop = useRef<Animated.CompositeAnimation | null>(null);
  const audioPulse   = useRef(new Animated.Value(1)).current;
  const audioPulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  // pill fill anims — one per chunk (0=locked/empty, 1=visited fill)
  const pillAnims    = useRef(Array.from({ length: 12 }, () => new Animated.Value(0))).current;
  // per-transition: out then in
  const focusSlide   = useRef(new Animated.Value(0)).current;
  const focusOpacity = useRef(new Animated.Value(1)).current;

  // ── screen entrance ──
  useEffect(() => {
    mountedRef.current = true;

    Animated.stagger(80, [
      Animated.timing(mountAnim,     { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(refCardAnim,   { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(focusCardAnim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(coachAnim,     { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    // first pill unlock
    Animated.timing(pillAnims[0], { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

    // breathing gold glow on focus card
    activeGlowLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(activeGlow, { toValue: 1.0,  duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(activeGlow, { toValue: 0.5,  duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    activeGlowLoop.current.start();

    // audio button subtle pulse
    audioPulseLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(audioPulse, { toValue: 1.04, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(audioPulse, { toValue: 1.00, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    audioPulseLoop.current.start();

    return () => {
      mountedRef.current = false;
      activeGlowLoop.current?.stop();
      audioPulseLoop.current?.stop();
      ctaShineLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── CTA shine when all visited ──
  useEffect(() => {
    if (!allVisited) return;
    ctaShineLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(ctaShine, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.delay(2600),
      Animated.timing(ctaShine, { toValue: -1, duration: 0, useNativeDriver: false }),
    ]));
    ctaShineLoop.current.start();
    return () => { ctaShineLoop.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVisited]);

  // ── core chunk navigator (direction-aware, transition-guarded) ──
  const navigateTo = useCallback((targetIdx: number, direction: 1 | -1) => {
    if (isTransitioning.current) return;
    if (targetIdx < 0 || targetIdx >= total) return;
    if (targetIdx === focusIdx) return; // already here
    isTransitioning.current = true;

    const outSlide = direction === 1 ? -22 : 22;
    const inSlide  = direction === 1 ?  26 : -26;

    Animated.parallel([
      Animated.timing(focusOpacity, { toValue: 0, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(focusSlide,   { toValue: outSlide, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (!mountedRef.current) { isTransitioning.current = false; return; }
      setFocusIdx(targetIdx);
      focusSlide.setValue(inSlide);
      focusOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(focusOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(focusSlide,   { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(() => { isTransitioning.current = false; });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, total]);

  // ── tap a navigator pill ──
  const handlePillPress = useCallback((i: number) => {
    if (i >= visitedCount) return; // locked
    if (i === focusIdx) return;    // already active
    hapticSelection();
    const dir: 1 | -1 = i > focusIdx ? 1 : -1;
    navigateTo(i, dir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, visitedCount, navigateTo]);

  // ── CTA press ──
  const goNext = useCallback(() => {
    if (allVisited) { hapticMedium(); onNext(); return; }
    if (isTransitioning.current) return;
    hapticSelection();

    const isAtFrontierNow = focusIdx === visitedCount - 1;

    if (!isAtFrontierNow) {
      // User is reviewing: jump forward to the frontier chunk
      const frontier = visitedCount - 1;
      if (frontier < 0 || frontier >= total) return;
      navigateTo(frontier, 1);
      return;
    }

    // At the frontier: advance to the next unvisited chunk
    const nextIdx = focusIdx + 1;
    if (nextIdx >= total) return;
    const newCount = nextIdx + 1;
    setVisitedCount(prev => Math.max(prev, newCount));
    // unlock pill with fade-in
    if (nextIdx < 12) {
      Animated.timing(pillAnims[nextIdx], { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    navigateTo(nextIdx, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, visitedCount, total, allVisited, onNext, navigateTo]);

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

  // CTA label logic:
  //  • all visited → final navigation label
  //  • focusIdx is the frontier (last unlocked) and it is the last chunk → terminer
  //  • focusIdx is the frontier but not last chunk → j'ai vu
  //  • focusIdx < frontier (reviewing earlier chunk) → continuer
  const isAtFrontier = focusIdx === visitedCount - 1;
  const ctaLabel = allVisited
    ? 'Continuer vers la répétition →'
    : !isAtFrontier
      ? 'Continuer le découpage →'
      : focusIdx === total - 1
        ? 'Terminer le découpage →'
        : 'J\'ai vu ce morceau →';

  // ── active chunk data ──
  const activeChunk  = chunks[focusIdx] ?? '';
  const activeTChunk = translitChunks?.[focusIdx] ?? null;
  // fallback: show full translit with label when chunk-level not safe
  const showFullTranslitFallback = !translitChunks && !!ayat?.transliteration;

  return (
    <SafeAreaView style={dec.safe}>
      <PremiumBackground />
      <View style={dec.halo} pointerEvents="none" />
      <View style={dec.ornLine} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={dec.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── HEADER ── */}
        <Animated.View style={[dec.header, {
          opacity: mountAnim,
          transform: [{ translateY: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        }]}>
          <Pressable style={dec.backBtn} onPress={() => { hapticLight(); onBack(); }} hitSlop={12}>
            <Text style={dec.backBtnText}>←</Text>
          </Pressable>
          <View style={dec.headerChip}>
            <View style={dec.headerChipDot} />
            <Text style={dec.headerChipText}>ÉTAPE 3 · DÉCOUPAGE</Text>
          </View>
          <Text style={dec.headerTitle}>Découpe l'ayat</Text>
          <Text style={dec.headerSub}>Un morceau à la fois. Lis, écoute, avance.</Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: mountAnim }}>
          <SessionProgressBar
            pct={DECOUPAGE_PROGRESS_PCT}
            label="Étape 3 · Découpage"
            phase="Morceaux"
          />
        </Animated.View>

        {/* ── COMPACT REFERENCE CARD ── */}
        <Animated.View style={[dec.refCardWrap, {
          opacity: refCardAnim,
          transform: [
            { translateY: refCardAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            { scale:      refCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) },
          ],
        }]}>
          <View style={dec.refCard}>
            {/* top badges row */}
            <View style={dec.refTopRow}>
              <View style={dec.refBadge}>
                <Text style={dec.refBadgeText}>L'AYAT COMPLET</Text>
              </View>
              <View style={dec.refNumBadge}>
                <Text style={dec.refNumText}>Ayat {ayatNumber}</Text>
              </View>
            </View>

            {ayat?.arabic ? (
              <>
                <Text style={dec.refArabic} textBreakStrategy="simple">
                  {ayat.arabic}
                </Text>
                {ayat.transliteration ? (
                  <Text style={dec.refTranslit} numberOfLines={2}>
                    {ayat.transliteration}
                  </Text>
                ) : null}
                {ayat.translationFr ? (
                  <Text style={dec.refTranslation} numberOfLines={2}>
                    {ayat.translationFr}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={dec.refFallback}>Contenu indisponible.</Text>
            )}
          </View>
        </Animated.View>


        {/* ── FOCUS CHUNK CARD ── */}
        {chunks.length === 0 ? (
          <View style={dec.focusFallback}>
            <Text style={dec.focusFallbackText}>L'ayat n'a pas pu être découpé.</Text>
          </View>
        ) : (
          <Animated.View style={[dec.focusCardWrap, {
            opacity:   focusCardAnim,
            transform: [{ translateY: focusCardAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
                        { scale: focusCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.0] }) }],
          }]}>
            {/* breathing gold glow shell */}
            <Animated.View style={[dec.focusGlowShell, { opacity: activeGlow }]} />

            <Animated.View style={[dec.focusCard, {
              opacity:   focusOpacity,
              transform: [{ translateY: focusSlide }],
            }]}>
              {/* ── focus card header: label left + mini pill nav right ── */}
              <View style={dec.focusTopRow}>
                {/* left: morceau label */}
                <View style={dec.focusLabelBadge}>
                  <Text style={dec.focusLabelText}>
                    MORCEAU {focusIdx + 1}{total > 1 ? ` SUR ${total}` : ''}
                  </Text>
                </View>

                {/* right: mini pills (hidden for single-chunk ayats) */}
                {total > 1 ? (
                  <View style={dec.miniNav}>
                    {Array.from({ length: total }).map((_, i) => {
                      const isActive  = i === focusIdx;
                      const isVisited = i < visitedCount;
                      return (
                        <Pressable
                          key={i}
                          style={({ pressed }) => [
                            dec.miniPill,
                            isActive   && dec.miniPillActive,
                            !isActive && isVisited  && dec.miniPillVisited,
                            !isVisited && dec.miniPillLocked,
                            pressed && isVisited && !isActive && dec.miniPillPressed,
                          ]}
                          onPress={() => handlePillPress(i)}
                          disabled={!isVisited}
                          accessibilityLabel={`Morceau ${i + 1}`}
                          hitSlop={6}
                        >
                          <Text style={[
                            dec.miniPillText,
                            isActive  && dec.miniPillTextActive,
                            !isActive && isVisited  && dec.miniPillTextVisited,
                            !isVisited && dec.miniPillTextLocked,
                          ]}>
                            {i + 1}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : allVisited ? (
                  <View style={dec.focusDoneBadge}>
                    <Text style={dec.focusDoneText}>✓ Tous vus</Text>
                  </View>
                ) : null}
              </View>

              <View style={dec.focusDivider} />

              {/* ── Arabic chunk — star of the card ── */}
              <Text style={dec.focusArabic} textBreakStrategy="simple">
                {activeChunk || '—'}
              </Text>

              {/* ── Transliteration: chunk-level if safe, full fallback otherwise ── */}
              {activeTChunk ? (
                <Text style={dec.focusTranslit}>{activeTChunk}</Text>
              ) : showFullTranslitFallback ? (
                <View style={dec.focusTranslitFallbackWrap}>
                  <Text style={dec.focusTranslitFallbackLabel}>Translittération de l'ayat</Text>
                  <Text style={dec.focusTranslit}>{ayat!.transliteration}</Text>
                </View>
              ) : null}

              <View style={dec.focusDivider} />

              {/* ── Sens de l'ayat (full translation, always) ── */}
              {ayat?.translationFr ? (
                <View style={dec.sensWrap}>
                  <Text style={dec.sensLabel}>SENS DE L'AYAT</Text>
                  <Text style={dec.sensText}>{ayat.translationFr}</Text>
                </View>
              ) : null}

              <View style={dec.focusSubDivider} />

              {/* ── Audio button ── */}
              <Animated.View style={{ transform: [{ scale: audioPulse }] }}>
                <Pressable
                  style={({ pressed }) => [dec.audioBtn, pressed && dec.audioBtnPressed]}
                  onPress={() => { hapticMedium(); }}
                  accessibilityLabel="Écouter l'ayat"
                >
                  <View style={dec.audioBtnInner}>
                    <View style={dec.audioIcon}>
                      <View style={dec.audioBar1} />
                      <View style={dec.audioBar2} />
                      <View style={dec.audioBar3} />
                    </View>
                    <Text style={dec.audioBtnText}>Écouter l'ayat</Text>
                  </View>
                </Pressable>
              </Animated.View>

            </Animated.View>
          </Animated.View>
        )}


        {/* ── COMPACT GUIDE LINE ── */}
        <Animated.View style={[dec.guideLine, {
          opacity: coachAnim,
          transform: [{ translateY: coachAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        }]}>
          <View style={dec.guideAccent} />
          <Text style={[dec.guideText, allVisited && dec.guideTextDone]}>
            {allVisited
              ? 'Parfait — tous les morceaux sont vus. Continue.'
              : 'Lis ce morceau doucement. Aide-toi de l\u2019audio et de la translittération.'}
          </Text>
        </Animated.View>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* ── STICKY CTA ── */}
      <View style={dec.stickyBottom}>
        <Pressable
          style={({ pressed }) => [
            dec.cta,
            allVisited && dec.ctaUnlocked,
            pressed && dec.ctaPressed,
          ]}
          onPress={goNext}
        >
          <Text style={dec.ctaText}>{ctaLabel}</Text>
          {allVisited ? (
            <Animated.View pointerEvents="none" style={[dec.ctaShine, { left: ctaShineX }]} />
          ) : null}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const dec = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: 4, paddingBottom: 0 },

  // ── background ──
  halo:    { position: 'absolute', top: -70, right: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(22,48,38,0.10)', zIndex: 0 },
  ornLine: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, height: 1, backgroundColor: 'rgba(184,150,46,0.10)', zIndex: 0 },

  // ── header ──
  header:        { marginBottom: 6 },
  backBtn:       { marginBottom: 5, alignSelf: 'flex-start' },
  backBtnText:   { fontSize: 22, color: colors.muted, fontWeight: '300', lineHeight: 24 },
  headerChip:    { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.22)', marginBottom: 4 },
  headerChipDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.primary, marginRight: 5 },
  headerChipText:{ fontSize: 10, fontWeight: '700', color: colors.primary, letterSpacing: 1.4 },
  headerTitle:   { fontSize: 19, fontWeight: '800', color: colors.primary, marginBottom: 1 },
  headerSub:     { fontSize: 12, color: colors.muted, lineHeight: 18 },

  // ── compact reference card ──
  refCardWrap: { marginBottom: 6 },
  refCard:     {
    backgroundColor: '#FEFCF5',
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(184,150,46,0.25)',
    paddingHorizontal: spacing.md, paddingVertical: 8,
    shadowColor: colors.gold, shadowOpacity: 0.07, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  refTopRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  refBadge:     { backgroundColor: 'rgba(22,48,38,0.08)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(22,48,38,0.15)' },
  refBadgeText: { fontSize: 8, fontWeight: '700', color: colors.primary, letterSpacing: 1.2, textTransform: 'uppercase' },
  refNumBadge:  { backgroundColor: 'rgba(184,150,46,0.12)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(184,150,46,0.28)' },
  refNumText:   { fontSize: 9, fontWeight: '800', color: colors.gold, letterSpacing: 0.4 },
  refArabic:    { fontSize: 17, color: colors.primary, textAlign: 'right', lineHeight: 29, fontWeight: '600', writingDirection: 'rtl', letterSpacing: 1.0, marginBottom: 3 },
  refTranslit:  { fontSize: 10, color: colors.muted, fontStyle: 'italic', lineHeight: 15, marginBottom: 2 },
  refTranslation:{ fontSize: 10, color: colors.disabled, lineHeight: 15 },
  refFallback:  { fontSize: 12, color: colors.muted, fontStyle: 'italic' },

  // ── mini pill nav (inside focus card header) ──
  miniNav:          { flexDirection: 'row', gap: 5, alignItems: 'center' },
  miniPill:         {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(184,150,46,0.08)',
    borderWidth: 1, borderColor: 'rgba(184,150,46,0.25)',
  },
  miniPillActive:   {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  miniPillVisited:  { backgroundColor: '#FEFCF5', borderColor: 'rgba(22,48,38,0.30)' },
  miniPillLocked:   { backgroundColor: 'rgba(184,150,46,0.04)', borderColor: 'rgba(184,150,46,0.12)', opacity: 0.45 },
  miniPillPressed:  { opacity: 0.60, transform: [{ scale: 0.88 }] },
  miniPillText:     { fontSize: 10, fontWeight: '800', color: colors.muted },
  miniPillTextActive:  { color: '#FFFFFF' },
  miniPillTextVisited: { color: colors.primary },
  miniPillTextLocked:  { color: 'rgba(184,150,46,0.45)' },

  // ── focus chunk card ──
  focusCardWrap:   { position: 'relative', marginBottom: 8 },
  focusGlowShell:  {
    position: 'absolute', top: -3, left: -3, right: -3, bottom: -3,
    borderRadius: 28, borderWidth: 2.5, borderColor: colors.gold, zIndex: 0,
  },
  focusCard:       {
    backgroundColor: '#FEFCF5',
    borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.38)',
    paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 12,
    shadowColor: colors.gold, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 5 }, elevation: 5,
    zIndex: 1,
  },
  focusTopRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  focusLabelBadge: { backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.20)' },
  focusLabelText:  { fontSize: 10, fontWeight: '800', color: colors.primary, letterSpacing: 1.2 },
  focusDoneBadge:  { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(45,106,79,0.10)', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(45,106,79,0.25)' },
  focusDoneText:   { fontSize: 9, fontWeight: '800', color: colors.success, letterSpacing: 0.5 },
  focusDivider:    { height: 1, backgroundColor: 'rgba(184,150,46,0.18)', marginVertical: 8 },
  focusSubDivider: { height: 1, backgroundColor: 'rgba(184,150,46,0.10)', marginVertical: 7 },

  // Arabic chunk — dominant
  focusArabic:  {
    fontSize: 32, color: colors.primary, textAlign: 'right',
    lineHeight: 52, fontWeight: '600', writingDirection: 'rtl',
    letterSpacing: 1.5, marginBottom: 4,
  },

  // Transliteration
  focusTranslit:              { fontSize: 13, fontWeight: '500', color: colors.muted, lineHeight: 21, fontStyle: 'italic', marginBottom: 3 },
  focusTranslitFallbackWrap:  { marginBottom: 4 },
  focusTranslitFallbackLabel: { fontSize: 9, fontWeight: '700', color: colors.gold, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 3 },

  // Sens de l'ayat
  sensWrap:  { marginBottom: 2 },
  sensLabel: { fontSize: 9, fontWeight: '700', color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 3 },
  sensText:  { fontSize: 12, color: colors.muted, lineHeight: 20, fontStyle: 'italic' },

  // Audio button
  audioBtn:        {
    backgroundColor: colors.surface,
    borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.18)',
    paddingVertical: 9, paddingHorizontal: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  audioBtnPressed: { opacity: 0.80, transform: [{ scale: 0.97 }] },
  audioBtnInner:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  audioIcon:       { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  audioBar1:       { width: 2.5, height: 9,  borderRadius: 2, backgroundColor: colors.primary },
  audioBar2:       { width: 2.5, height: 16, borderRadius: 2, backgroundColor: colors.primary },
  audioBar3:       { width: 2.5, height: 11, borderRadius: 2, backgroundColor: colors.primary },
  audioBtnText:    { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.3 },

  // fallback
  focusFallback:     { backgroundColor: colors.surface, borderRadius: 18, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, alignItems: 'center' },
  focusFallbackText: { fontSize: 13, color: colors.muted, fontStyle: 'italic', textAlign: 'center' },

  // ── compact guide line ──
  guideLine:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  guideAccent:  { width: 3, height: 28, borderRadius: 2, backgroundColor: colors.primary, opacity: 0.60 },
  guideText:    { flex: 1, fontSize: 12, color: colors.muted, lineHeight: 19, fontStyle: 'italic' },
  guideTextDone:{ color: colors.primary, fontWeight: '600', fontStyle: 'normal' },

  // ── sticky CTA ──
  stickyBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: 'rgba(184,150,46,0.15)', paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.xl },
  cta:          { backgroundColor: colors.primary, borderRadius: 16, height: 58, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: colors.primary, shadowOpacity: 0.40, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  ctaUnlocked:  { shadowOpacity: 0.50 },
  ctaPressed:   { opacity: 0.82, transform: [{ scale: 0.975 }] },
  ctaText:      { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  ctaShine:     { position: 'absolute', top: 0, width: '35%', height: '100%', backgroundColor: 'rgba(255,255,255,0.11)', transform: [{ skewX: '-20deg' }] },
});

// ─── Step 4 · Répétition guidée ───────────────────────────────────────────────

const MIN_REPS = 3;

type RepetitionScreenProps = {
  ayatNumber: number;
  ayat: QuranAyahContent | null;
  onBack: () => void;
  onNext: () => void;
};

function RepetitionScreen({ ayatNumber, ayat, onBack, onNext }: RepetitionScreenProps) {
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
  const audioPulse    = useRef(new Animated.Value(1)).current;
  const audioPulseLoop= useRef<Animated.CompositeAnimation | null>(null);
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

    audioPulseLoop.current = Animated.loop(Animated.sequence([
      Animated.timing(audioPulse, { toValue: 1.03, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(audioPulse, { toValue: 1.00, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    audioPulseLoop.current.start();

    return () => {
      mountedRef.current = false;
      activeGlowLoop.current?.stop();
      audioPulseLoop.current?.stop();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

              {/* ── Audio button ── */}
              <Animated.View style={{ transform: [{ scale: audioPulse }] }}>
                <Pressable
                  style={({ pressed }) => [rep.audioBtn, pressed && rep.audioBtnPressed]}
                  onPress={() => hapticMedium()}
                  accessibilityLabel="Écouter l'ayat"
                >
                  <View style={rep.audioBtnInner}>
                    <View style={rep.audioIcon}>
                      <View style={rep.audioBar1} />
                      <View style={rep.audioBar2} />
                      <View style={rep.audioBar3} />
                    </View>
                    <Text style={rep.audioBtnText}>Écouter l'ayat</Text>
                  </View>
                </Pressable>
              </Animated.View>

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
      <View style={rep.stickyBottom}>
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
  ayat, ayatNumber, totalAyatsToday, surahName, isLastAyat, onBack, onNextAyat, onFinalTest,
}: AyatRecitationScreenProps) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const ayatLabel = totalAyatsToday === 1
    ? `Ayat ${ayatNumber}`
    : `Ayat ${ayatNumber - (ayatNumber - 1) + (ayatNumber - ayatNumber) + 1} sur ${totalAyatsToday}`;

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

// ─── Step 6 · Test final global ────────────────────────────────────────────────

type FinalTestMode = 'recite' | 'compare' | 'evaluate';
type DifficultyLevel = 'easy' | 'hesitant' | 'hard';

type FinalTestScreenProps = {
  allAyats:          QuranAyahContent[];
  memStart:          number;
  memEnd:            number;
  surahName:         string;
  onBack:            () => void;
  onComplete:        (difficulty: DifficultyLevel) => void;
  onRestartPassage:  () => void;
};

function FinalTestScreen({ allAyats, memStart, memEnd, surahName, onBack, onComplete, onRestartPassage }: FinalTestScreenProps) {
  const mountedRef = useRef(true);

  const totalAyats = Math.max(allAyats.length, memEnd - memStart + 1);

  // ── mode ──
  const [mode, setMode]                         = useState<FinalTestMode>('recite');
  const [canContinue, setCanContinue]           = useState(false);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLevel | null>(null);
  const isTransitioning                         = useRef(false);
  const guardTimer                              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompleting                            = useRef(false);
  const isRestarting                            = useRef(false);

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

  const handleValidate = useCallback(() => {
    if (!selectedDifficulty || isCompleting.current) return;
    isCompleting.current = true;
    hapticMedium();
    onComplete(selectedDifficulty);
  }, [selectedDifficulty, onComplete]);

  const ctaShineX = ctaShine.interpolate({ inputRange: [-1, 1], outputRange: ['-60%', '160%'] });

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
          <Pressable style={ft.backBtn} onPress={() => { hapticLight(); onBack(); }} hitSlop={12}>
            <Text style={ft.backBtnText}>←</Text>
          </Pressable>
          <View style={ft.headerChip}>
            <View style={ft.headerChipDot} />
            <Text style={ft.headerChipText}>
              {mode === 'evaluate' ? 'ÉTAPE 6 · ÉVALUATION' : 'ÉTAPE 6 · TEST FINAL'}
            </Text>
          </View>
          <Text style={ft.headerTitle}>
            {mode === 'recite'   ? 'Récite tout le passage' :
             mode === 'compare'  ? 'Compare ton passage'    :
                                   'Évalue ta récitation'}
          </Text>
          <Text style={ft.headerSub}>
            {mode === 'recite'
              ? 'Enchaîne tous les ayats appris aujourd\'hui.'
              : mode === 'compare'
                ? 'Vérifie si tu as oublié un mot, inversé ou hésité dans l\'enchaînement.'
                : 'Réponds honnêtement. Zainly utilisera cette difficulté pour protéger tes révisions.'}
          </Text>
        </Animated.View>

        {/* ── PROGRESS BAR ── */}
        <Animated.View style={{ opacity: mountAnim }}>
          <SessionProgressBar
            pct={FINAL_TEST_PROGRESS_PCT}
            label="Étape 6 · Test final"
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
                    Récite maintenant tous les ayats appris aujourd'hui, dans l'ordre.
                  </Text>
                  <Animated.View style={[ft.hiddenCard, {
                    opacity: glowAnim.interpolate({ inputRange: [0.5, 1.0], outputRange: [0.85, 1.0] }),
                  }]}>
                    <View style={ft.hiddenGlow} />
                    <Text style={ft.hiddenDots}>•  •  •</Text>
                    <Text style={ft.hiddenCaption}>Récite le passage complet</Text>
                    <Text style={ft.hiddenRange}>{ayatRangeLabel}</Text>
                  </Animated.View>
                </View>

              ) : mode === 'compare' ? (
                /* ── FINAL COMPARE ── */
                <View>
                  <Text style={ft.modeInstruction}>
                    Vérifie si tu as oublié un mot, inversé un passage ou hésité dans l'enchaînement.
                  </Text>
                  {allAyats.length > 0 ? allAyats.map((a, idx) => (
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
                ? 'Récite l\'enchaînement complet, sans t\'arrêter.'
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
                {/* helper text for hesitant */}
                {selectedDifficulty === 'hesitant' ? (
                  <Text style={ft.helperText}>Tu peux valider, ou reprendre le passage pour le consolider.</Text>
                ) : selectedDifficulty === 'hard' ? (
                  <Text style={ft.helperText}>Si c'était difficile, le meilleur choix est de reprendre le passage avant de valider.</Text>
                ) : null}

                {/* PRIMARY CTA */}
                <Pressable
                  style={({ pressed }) => [
                    ft.cta,
                    selectedDifficulty ? (selectedDifficulty === 'hard' ? ft.ctaRestart : ft.ctaActive) : ft.ctaLocked,
                    pressed && !!selectedDifficulty && ft.ctaPressed,
                  ]}
                  onPress={() => {
                    if (!selectedDifficulty) return;
                    if (selectedDifficulty === 'hard') {
                      openRestartConfirm();
                    } else {
                      handleValidate();
                    }
                  }}
                >
                  <Text style={[ft.ctaText, !selectedDifficulty && ft.ctaTextLocked]}>
                    {selectedDifficulty === 'hard'
                      ? 'Reprendre depuis le début →'
                      : selectedDifficulty
                        ? 'Préparer la validation →'
                        : 'Choisis une difficulté…'}
                  </Text>
                  {selectedDifficulty ? (
                    <Animated.View pointerEvents="none" style={[ft.ctaShine, { left: ctaShineX }]} />
                  ) : null}
                </Pressable>

                {/* SECONDARY ACTION */}
                {selectedDifficulty === 'hard' ? (
                  <Pressable style={ft.secondaryCta} onPress={handleValidate}>
                    <Text style={ft.secondaryCtaText}>Préparer la validation quand même</Text>
                  </Pressable>
                ) : selectedDifficulty === 'hesitant' ? (
                  <Pressable style={ft.secondaryCta} onPress={openRestartConfirm}>
                    <Text style={ft.secondaryCtaText}>Reprendre depuis le début</Text>
                  </Pressable>
                ) : selectedDifficulty === 'easy' ? (
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
                ? (canContinue ? 'J\'ai récité le passage →' : 'Récite tout le passage…')
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
});

// ─── Validation placeholder ────────────────────────────────────────────────────

function ValidationPlaceholderScreen({ difficulty, onQuit }: { difficulty: DifficultyLevel | null; onQuit: () => void }) {
  const mountedRef = useRef(true);
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const cardAnim   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    mountedRef.current = true;
    Animated.stagger(120, [
      Animated.timing(fadeAnim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    return () => { mountedRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diffLabel = difficulty === 'easy' ? 'Facile' : difficulty === 'hesitant' ? 'Hésitant' : difficulty === 'hard' ? 'Difficile' : null;

  return (
    <SafeAreaView style={vp.safe}>
      <PremiumBackground />
      <View style={vp.halo} pointerEvents="none" />

      <ScrollView contentContainerStyle={vp.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View style={[vp.header, {
          opacity: fadeAnim,
          transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        }]}>
          <View style={vp.headerChip}>
            <View style={vp.headerChipDot} />
            <Text style={vp.headerChipText}>VALIDATION FINALE</Text>
          </View>
          <Text style={vp.headerTitle}>Validation prête</Text>
          <Text style={vp.headerSub}>
            La prochaine étape branchera la validation réelle de la session et les révisions intelligentes.
          </Text>
        </Animated.View>

        <Animated.View style={[vp.card, {
          opacity: cardAnim,
          transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }]}>
          <View style={vp.cardAccent} />
          <View style={vp.cardBody}>
            <Text style={vp.cardTitle}>Session terminée</Text>
            <Text style={vp.cardDesc}>
              Tu as parcouru toutes les étapes de ta session Zainly.{'\n'}La connexion DB sera ajoutée dans la prochaine étape.
            </Text>
            {diffLabel ? (
              <View style={vp.diffChip}>
                <Text style={vp.diffChipText}>Difficulté : {diffLabel}</Text>
              </View>
            ) : null}
          </View>
        </Animated.View>

        <SectionOrnament />

        <Animated.View style={[vp.noteCard, { opacity: cardAnim }]}>
          <View style={vp.noteBorder} />
          <View style={vp.noteInner}>
            <Text style={vp.noteQuote}>"</Text>
            <Text style={vp.noteText}>
              La validation réelle de la session et les révisions intelligentes arrivent prochainement.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      <View style={vp.stickyBottom}>
        <Pressable style={vp.ctaQuit} onPress={() => { hapticLight(); onQuit(); }}>
          <Text style={vp.ctaQuitLabel}>Retour au tableau de bord</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const vp = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  scroll:         { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: 160 },
  halo:           { position: 'absolute', top: -60, right: -80, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(22,48,38,0.07)', zIndex: 0 },
  header:         { marginBottom: spacing.lg },
  headerChip:     { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(184,150,46,0.14)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(184,150,46,0.30)', marginBottom: spacing.sm },
  headerChipDot:  { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.gold, marginRight: 5 },
  headerChipText: { fontSize: 10, fontWeight: '700', color: colors.gold, letterSpacing: 1.4 },
  headerTitle:    { fontSize: 26, fontWeight: '800', color: colors.primary, marginBottom: spacing.sm },
  headerSub:      { fontSize: 14, color: colors.muted, lineHeight: 22 },
  card:           { flexDirection: 'row', backgroundColor: colors.goldSoft, borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.30)', marginBottom: spacing.md, overflow: 'hidden', shadowColor: colors.gold, shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  cardAccent:     { width: 5, backgroundColor: colors.gold, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  cardBody:       { flex: 1, padding: spacing.lg },
  cardTitle:      { fontSize: 18, fontWeight: '800', color: colors.primary, marginBottom: 6 },
  cardDesc:       { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: spacing.sm },
  diffChip:       { alignSelf: 'flex-start', backgroundColor: 'rgba(22,48,38,0.10)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(22,48,38,0.20)' },
  diffChipText:   { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.6 },
  noteCard:       { flexDirection: 'row', backgroundColor: '#FBF6E9', borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.22)', overflow: 'hidden', shadowColor: colors.gold, shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  noteBorder:     { width: 5, backgroundColor: colors.gold, borderTopLeftRadius: 22, borderBottomLeftRadius: 22 },
  noteInner:      { flex: 1, padding: spacing.lg, flexDirection: 'row', alignItems: 'flex-start' },
  noteQuote:      { fontSize: 28, color: colors.gold, lineHeight: 30, marginRight: 6, fontWeight: '700' },
  noteText:       { flex: 1, fontSize: 13, color: colors.primary, lineHeight: 22, fontStyle: 'italic' },
  stickyBottom:   { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl },
  ctaQuit:        { backgroundColor: colors.primary, borderRadius: 16, height: 56, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 5 },
  ctaQuitLabel:   { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
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
  const user   = useAuthStore(s => s.user);
  const userId = user?.id;
  const today  = useMemo(() => localDateStr(), []);

  const plan     = usePlan(userId);
  const progress = useProgress(userId);
  const reviews  = useDueReviews(userId);

  const isLoading = plan.isLoading || progress.isLoading || reviews.isLoading;

  const prog = useMemo(() => getTodayProgramme({
    plan:           plan.data    ?? null,
    progress:       progress.data ?? null,
    dueReviewCount: reviews.data  ?? 0,
    today,
  }), [plan.data, progress.data, reviews.data, today]);

  // ── internal phase + ayat index ──
  const [phase, setPhase] = useState<'mission' | 'discovery' | 'decoupage' | 'repetition' | 'ayatRecitation' | 'finalTest' | 'validationPlaceholder'>('mission');
  // ayat loaded from discovery, passed through steps 3-5
  const [discoveredAyat, setDiscoveredAyat] = useState<QuranAyahContent | null>(null);
  // per-ayat index within today session
  const [currentAyatIndex, setCurrentAyatIndex] = useState(0);
  // all ayats loaded for final test
  const [allTodayAyats, setAllTodayAyats] = useState<QuranAyahContent[]>([]);
  // difficulty selected in Step 6 evaluation
  const [lastDifficulty, setLastDifficulty] = useState<DifficultyLevel | null>(null);

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
      mountedRef.current = false;
      entrance.stop();
      haloLoop.current?.stop();
      heroGlowLoop.current?.stop();
      ctaGlowLoop.current?.stop();
      ctaShineLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = useCallback(() => {
    hapticLight();
    router.back();
  }, []);

  const goDashboard = useCallback(() => {
    router.replace('/(app)/(tabs)/');
  }, []);

  const onCta = useCallback(() => {
    hapticLight();
    setPhase('discovery');
  }, []);

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

  // ── session already done today ──
  if (prog.sessionDoneToday) {
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

  // ── derived values used in phase renders ──
  const memStart        = prog.memStart ?? 1;
  const memEnd          = prog.memEnd   ?? memStart;
  const totalAyatsToday = memEnd - memStart + 1;
  const currentAyatNumber = memStart + currentAyatIndex;
  const isLastAyat      = currentAyatIndex >= totalAyatsToday - 1;

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
    setLastDifficulty(null);
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
        allAyats={allTodayAyats}
        memStart={memStart}
        memEnd={memEnd}
        surahName={prog.surahName ?? ''}
        onBack={() => { setPhase('ayatRecitation'); }}
        onComplete={(difficulty) => { setLastDifficulty(difficulty); setPhase('validationPlaceholder'); }}
        onRestartPassage={restartLearningPassage}
      />
    );
  }

  // ── validation placeholder ──
  if (phase === 'validationPlaceholder') {
    return (
      <ValidationPlaceholderScreen
        difficulty={lastDifficulty}
        onQuit={goDashboard}
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
      <View style={s.stickyBottom}>
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
