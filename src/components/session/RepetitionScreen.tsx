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

const REPETITION_PROGRESS_PCT = 0.60; // Step 4 anchors at ~60%

// ─── Step 4 · Répétition guidée ───────────────────────────────────────────────

const MIN_REPS = 3;

type RepetitionScreenProps = {
  surahNumber: number;
  ayatNumber: number;
  ayat: QuranAyahContent | null;
  onBack: () => void;
  onNext: () => void;
};

export function RepetitionScreen({ surahNumber, ayatNumber, ayat, onBack, onNext }: RepetitionScreenProps) {
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
