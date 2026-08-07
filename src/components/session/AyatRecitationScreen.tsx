import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
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

import { AyatAudioControl } from '@/components/AyatAudioControl';
import { PremiumBackground } from '@/components/PremiumBackground';
import { SessionProgressBar } from '@/components/SessionProgressBar';
import type { QuranAyahContent } from '@/core/quranContent';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import {
  hapticLight,
  hapticMedium,
} from '@/utils/haptics';

const RECITATION_PROGRESS_PCT  = 0.86; // Step 5 anchors at ~86%

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

export function AyatRecitationScreen({
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
