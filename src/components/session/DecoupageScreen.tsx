import React, {
  useCallback,
  useEffect,
  useMemo,
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
import {
  chunkAyat,
  chunkTranslit,
} from '@/core/sessionChunking';
import type { QuranAyahContent } from '@/core/quranContent';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import {
  hapticLight,
  hapticMedium,
  hapticSelection,
} from '@/utils/haptics';

const DECOUPAGE_PROGRESS_PCT = 0.44; // Step 3 anchors at ~44%

// ─── Step 3: Découpage (focus mode) ──────────────────────────────────────────

interface DecoupageScreenProps {
  surahNumber: number;
  ayatNumber:  number;
  ayat:        QuranAyahContent | null;
  onBack:      () => void;
  onNext:      () => void;
}

export function DecoupageScreen({ surahNumber, ayatNumber, ayat, onBack, onNext }: DecoupageScreenProps) {
  const insets = useSafeAreaInsets();
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

    return () => {
      mountedRef.current = false;
      activeGlowLoop.current?.stop();
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

              {/* ── Audio button — full ayat, no listen counter ── */}
              <AyatAudioControl
                surahNumber={surahNumber}
                ayatNumber={ayatNumber}
                label="Écouter l'ayat complet"
              />

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
      <View style={[dec.stickyBottom, { paddingBottom: Math.max(spacing.xl, insets.bottom + 16) }]}>
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
