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

import { PremiumBackground } from '@/components/PremiumBackground';
import { SessionProgressBar } from '@/components/SessionProgressBar';
import { getQuranAyahSync } from '@/core/quranContent';
import type { QuranAyahContent } from '@/core/quranContent';
import { getAyatAudioUrl } from '@/core/quranAudio';
import { useAyatAudio } from '@/hooks/useAyatAudio';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import {
  hapticLight,
  hapticMedium,
  hapticSelection,
} from '@/utils/haptics';

const DISCOVERY_PROGRESS_PCT = 0.28; // Step 2 anchors at ~28%

// ─── Step 2: Découverte de l'ayat ─────────────────────────────────────────────

interface DiscoveryScreenProps {
  surahNumber: number;
  surahName:   string;
  memStart:    number;
  memEnd:      number;
  onBack:      () => void;
  onNext:      (loadedAyat: QuranAyahContent | null) => void;
}

export function DiscoveryScreen({ surahNumber, surahName, memStart, onBack, onNext }: DiscoveryScreenProps) {
  const insets = useSafeAreaInsets();
  const mountedRef = useRef(true);

  // ── Quran content — synchronous (local bundled JSON, no network) ──
  const { ayat, contentError } = useMemo(() => {
    const result = getQuranAyahSync({ surahNumber, fromAyah: memStart, toAyah: memStart });
    if (result.ok && result.ayahs.length > 0) {
      return { ayat: result.ayahs[0], contentError: null };
    }
    return { ayat: null, contentError: result.ok ? 'Contenu introuvable.' : result.error };
  }, [surahNumber, memStart]);

  // ── listen gate ──
  const MIN_LISTENS = 3;
  const [listenCount, setListenCount] = useState(0);
  const unlocked = listenCount >= MIN_LISTENS;

  // ── audio ──
  const audioUrl = getAyatAudioUrl({ surahNumber, ayahNumber: memStart });
  const onAudioFinish = useCallback(() => {
    if (!mountedRef.current) return;
    setListenCount(prev => prev + 1);
    hapticLight();
    Animated.sequence([
      Animated.timing(countPulse, { toValue: 1.18, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(countPulse, { toValue: 1.00, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const audio = useAyatAudio(audioUrl, onAudioFinish);

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
  // animated bars for playing state (3 bars)
  const bar1Anim = useRef(new Animated.Value(0.4)).current;
  const bar2Anim = useRef(new Animated.Value(0.7)).current;
  const bar3Anim = useRef(new Animated.Value(0.5)).current;
  const barsLoop = useRef<Animated.CompositeAnimation | null>(null);

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
      barsLoop.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── animated bars: run while audio is playing ──
  useEffect(() => {
    if (audio.isPlaying) {
      barsLoop.current = Animated.loop(Animated.parallel([
        Animated.sequence([
          Animated.timing(bar1Anim, { toValue: 1.0, duration: 320, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar1Anim, { toValue: 0.3, duration: 320, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(bar2Anim, { toValue: 0.3, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar2Anim, { toValue: 1.0, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(bar3Anim, { toValue: 1.0, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar3Anim, { toValue: 0.4, duration: 290, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ]));
      barsLoop.current.start();
    } else {
      barsLoop.current?.stop();
      bar1Anim.setValue(0.4);
      bar2Anim.setValue(0.7);
      bar3Anim.setValue(0.5);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.isPlaying]);

  // Stop on unmount — prevents orphaned playback
  useEffect(() => () => { audio.stop(); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const onAudioPress = useCallback(() => {
    hapticMedium();
    if (audio.hasError)         { audio.reset(); audio.play(); }
    else if (audio.isPlaying)   { audio.pause();  }
    else if (audio.isPaused)    { audio.resume(); }
    else if (audio.hasCompleted){ audio.replay(); }
    else                        { audio.play();   }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.hasError, audio.isPlaying, audio.isPaused, audio.hasCompleted, audio.reset, audio.play, audio.pause, audio.resume, audio.replay]);

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
                <Text style={ds.loadingAyatText}>{contentError ?? 'Contenu introuvable.'}</Text>
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
                  style={({ pressed }) => [
                    ds.audioBtn,
                    (audio.isPlaying || audio.isIntendingToPlay) && ds.audioBtnPlaying,
                    audio.isPaused  && ds.audioBtnPaused,
                    pressed && !audio.isLoadingVisible && ds.audioBtnPressed,
                  ]}
                  onPress={onAudioPress}
                  accessibilityLabel={
                    audio.hasError ? "Réessayer"
                    : audio.isPaused ? 'Reprendre'
                    : (audio.isPlaying || audio.isIntendingToPlay) ? 'Pause'
                    : listenCount > 0 ? "Réécouter l'ayat"
                    : "Écouter l'ayat"
                  }
                >
                  <View style={ds.audioBtnInner}>
                    {audio.isLoadingVisible ? (
                      <View style={ds.audioBtnSpinner} />
                    ) : audio.isPaused ? (
                      <View style={ds.audioBtnPlayTriangle} />
                    ) : (audio.isPlaying || audio.isIntendingToPlay) ? (
                      <View style={ds.audioIcon}>
                        <Animated.View style={[ds.audioIconBar1, { transform: [{ scaleY: bar1Anim }] }]} />
                        <Animated.View style={[ds.audioIconBar2, { transform: [{ scaleY: bar2Anim }] }]} />
                        <Animated.View style={[ds.audioIconBar3, { transform: [{ scaleY: bar3Anim }] }]} />
                      </View>
                    ) : (
                      <View style={ds.audioBtnPlayTriangle} />
                    )}
                    <Text style={[
                      ds.audioBtnText,
                      (audio.isPlaying || audio.isIntendingToPlay) && ds.audioBtnTextPlaying,
                      audio.isPaused  && ds.audioBtnTextPaused,
                      audio.hasError  && ds.audioBtnTextError,
                    ]}>
                      {audio.hasError
                        ? "Réessayer"
                        : audio.isPaused
                          ? 'Reprendre'
                          : (audio.isPlaying || audio.isIntendingToPlay)
                            ? 'Pause'
                            : listenCount > 0
                              ? "Réécouter l'ayat"
                              : "Écouter l'ayat"}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>

              {/* error state */}
              {audio.hasError ? (
                <View style={ds.audioError}>
                  <Text style={ds.audioErrorText}>{audio.errorMessage}</Text>
                  <Pressable onPress={onAudioPress} style={ds.audioRetry}>
                    <Text style={ds.audioRetryText}>Réessayer</Text>
                  </Pressable>
                </View>
              ) : null}

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
      <View style={[ds.stickyBottom, { paddingBottom: Math.max(spacing.xl, insets.bottom + 16) }]}>
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

  // reciter label
  reciterLabel:     { fontSize: 10, color: colors.muted, textAlign: 'center', fontWeight: '500', letterSpacing: 0.5, opacity: 0.70 },

  // audio button states
  audioBtnPlaying:      { backgroundColor: 'rgba(22,48,38,0.10)', borderColor: colors.primary, borderWidth: 1.5 },
  audioBtnPaused:       { backgroundColor: 'rgba(22,48,38,0.05)', borderColor: 'rgba(22,48,38,0.40)', borderWidth: 1.5 },
  audioBtnTextPlaying:  { color: colors.primary },
  audioBtnTextPaused:   { color: colors.primary, opacity: 0.70 },
  audioBtnTextError:    { color: colors.danger, fontSize: 12 },
  audioBtnSpinner:      { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.primary, borderTopColor: 'transparent' },
  audioBtnPlayTriangle: { width: 0, height: 0, borderTopWidth: 6, borderTopColor: 'transparent', borderBottomWidth: 6, borderBottomColor: 'transparent', borderLeftWidth: 11, borderLeftColor: colors.primary, marginLeft: 2 },

  // audio error inline
  audioError:     { backgroundColor: 'rgba(184,150,46,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(184,150,46,0.22)', paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', gap: 6 },
  audioErrorText: { fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  audioRetry:     { paddingHorizontal: 12, paddingVertical: 4 },
  audioRetryText: { fontSize: 12, color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
});
