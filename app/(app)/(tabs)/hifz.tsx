// ─── Mon Hifz V2 – premium library ───────────────────────────────────────────
// Data sources (all read-only, no DB writes):
//   • useLearnedItems   → review_items (all learned ayats incl. mastered)
//   • useProgress       → total_memorized, streak, last_session_date
//   • getSurahName      → local bundled JSON (surah transliteration name)
//   • getQuranAyahRange → local bundled JSON (Arabic, transliteration, French)
//   • getAyatAudioUrl   → everyayah.com MP3 URL
//   • useAyatAudio      → existing playback hook

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, View, Animated, Easing, LayoutAnimation, UIManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors }  from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium, hapticSelection } from '@/utils/haptics';
import { useAuthStore }    from '@/store/authStore';
import { useProgress }     from '@/hooks/useProgress';
import { useLearnedItems } from '@/hooks/useLearnedItems';
import { useAyatAudio }    from '@/hooks/useAyatAudio';
import { REVIEW_OFFSETS }  from '@/db/reviewItems';
import { getQuranAyahRange, getSurahName } from '@/core/quranContent';
import { getAyatAudioUrl } from '@/core/quranAudio';
import type { QuranAyahContent } from '@/core/quranContent';

// Required Android prerequisite for the single LayoutAnimation.configureNext call in
// SurahCard.toggle(). Without this, configureNext is silently ignored on Android.
// Usage is scoped: only SurahCard.toggle() calls configureNext — no other setState
// fires in the same frame, so cross-component animation bleed is not a risk here.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Module-level audio registry ─────────────────────────────────────────────
// Prevents overlap between multiple AudioPlayBtn instances and the detail sheet.
// Each mounted player registers its stop() fn; calling stopAllHifzAudio() stops
// every currently-active player before a new one starts.

const _hifzAudioRegistry = new Set<() => void>();
function registerHifzAudio(stop: () => void) { _hifzAudioRegistry.add(stop); }
function unregisterHifzAudio(stop: () => void) { _hifzAudioRegistry.delete(stop); }
function stopAllHifzAudio(except?: () => void) {
  _hifzAudioRegistry.forEach(fn => { if (fn !== except) fn(); });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLD  = colors.gold;
const GREEN = colors.primary;
const REVIEW_CHIPS = REVIEW_OFFSETS.map((n: number) => `J+${n}`);

const SURAH_TOTAL: Record<number, number> = {
  1:7,2:286,3:200,4:176,5:120,6:165,7:206,8:75,9:129,10:109,11:123,12:111,
  13:43,14:52,15:99,16:128,17:111,18:110,19:98,20:135,21:112,22:78,23:118,
  24:64,25:77,26:227,27:93,28:88,29:69,30:60,31:34,32:30,33:73,34:54,35:45,
  36:83,37:182,38:88,39:75,40:85,41:54,42:53,43:89,44:59,45:37,46:35,47:38,
  48:29,49:18,50:45,51:60,52:49,53:62,54:55,55:78,56:96,57:29,58:22,59:24,
  60:13,61:14,62:11,63:11,64:18,65:12,66:12,67:30,68:52,69:52,70:44,71:28,
  72:28,73:20,74:56,75:40,76:31,77:50,78:40,79:46,80:42,81:29,82:19,83:36,
  84:25,85:22,86:17,87:19,88:26,89:30,90:20,91:15,92:21,93:11,94:8,95:8,
  96:19,97:5,98:8,99:8,100:11,101:11,102:8,103:3,104:9,105:5,106:4,107:7,
  108:3,109:6,110:3,111:5,112:4,113:5,114:6,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type LearnedRow = {
  id: string;
  surah_number: number;
  ayah: number;
  review_cycle: number;
  mastered: boolean;
  final_test_status: 'validated' | 'reinforce' | null;
  created_at: string;
};

type SurahGroup = {
  surahNumber: number;
  surahName:   string;
  ayahs:       LearnedRow[];
  total:       number;
  // pre-resolved content, keyed by ayah number
  contentMap:  Map<number, QuranAyahContent>;
};

type DetailTarget = {
  surahNumber: number;
  surahName:   string;
  ayahNumber:  number;
  // pre-resolved content passed from parent to eliminate sheet skeleton flash
  content:     QuranAyahContent | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffLabel(row: LearnedRow): string {
  if (row.mastered) return 'Maîtrisée';
  if (row.final_test_status === 'validated') return 'Fluide';
  if (row.final_test_status === 'reinforce') return 'À consolider';
  return 'En cours';
}

function diffColor(row: LearnedRow): string {
  if (row.mastered) return GOLD;
  if (row.final_test_status === 'validated') return colors.success;
  if (row.final_test_status === 'reinforce') return '#C17F3A';
  return GREEN;
}

function surahStatus(group: SurahGroup): 'mastered' | 'complete' | 'progress' {
  if (group.ayahs.every(a => a.mastered)) return 'mastered';
  if (group.ayahs.length >= group.total)  return 'complete';
  return 'progress';
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  } catch { return null; }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ w, h = 12, style }: { w: number | string; h?: number; style?: object }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.65] });
  return <Animated.View style={[{ width: w, height: h, borderRadius: 7, backgroundColor: colors.border, opacity }, style]} />;
}

// ─── Floating gold dot particles (hero background) ────────────────────────────

type PDot = { x: number; y: number; delay: number; dur: number; r: number };
const DOTS: PDot[] = [
  { x:0.07, y:0.22, delay:0,    dur:4200, r:3.5 },
  { x:0.88, y:0.10, delay:600,  dur:3800, r:2.5 },
  { x:0.14, y:0.62, delay:1100, dur:4500, r:4.5 },
  { x:0.82, y:0.48, delay:300,  dur:4000, r:2.5 },
  { x:0.52, y:0.07, delay:800,  dur:3600, r:3.5 },
  { x:0.91, y:0.78, delay:1500, dur:4800, r:2.5 },
  { x:0.32, y:0.88, delay:450,  dur:3900, r:4   },
  { x:0.64, y:0.32, delay:1200, dur:4300, r:2.5 },
];

function FloatDot({ d }: { d: PDot }) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(d.delay),
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(rise, { toValue: 1, duration: d.dur, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.timing(fade, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 0,   useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ty = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -24] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: `${d.x * 100}%`, top: `${d.y * 100}%`,
      width: d.r * 2, height: d.r * 2, borderRadius: d.r,
      backgroundColor: 'rgba(184,150,46,0.28)', opacity: fade,
      transform: [{ translateY: ty }],
    }} />
  );
}

// ─── AudioPlayBtn – compact inline circle button ──────────────────────────────
// Used in AyatRow and LastAyatCard. Simple play/pause toggle (no label).

function AudioPlayBtn({
  surahNumber, ayahNumber, size = 32, autoPlay = false,
}: { surahNumber: number; ayahNumber: number; size?: number; autoPlay?: boolean }) {
  const url    = getAyatAudioUrl({ surahNumber, ayahNumber });
  const onDone = useCallback(() => {}, []);
  const audio  = useAyatAudio(url, onDone);

  const scale = useRef(new Animated.Value(1)).current;

  // Register stop fn in the module registry on mount; unregister on unmount.
  useEffect(() => {
    registerHifzAudio(audio.stop);
    if (autoPlay) { stopAllHifzAudio(audio.stop); audio.play(); }
    return () => {
      unregisterHifzAudio(audio.stop);
      audio.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = () => {
    hapticLight();
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 90,  useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 120, useNativeDriver: true }),
    ]).start();
    if (audio.isPlaying)        { audio.pause();  }
    else if (audio.isPaused)    { audio.resume(); }
    else if (audio.hasError)    { audio.reset(); audio.play(); }
    else if (audio.hasCompleted){
      stopAllHifzAudio(audio.stop);
      audio.replay();
    } else {
      stopAllHifzAudio(audio.stop);
      audio.play();
    }
  };

  const isEffectivePlaying = audio.isPlaying || audio.isIntendingToPlay;
  // Only show spinner when the user has intentionally started audio — prevents
  // the static partial-border circle appearing on mount due to replace() briefly
  // setting isLoaded=false in the native player before the user taps anything.
  const showSpinner = audio.isLoadingVisible && (audio.isIntendingToPlay || audio.isPlaying || audio.isPaused);

  const bg     = isEffectivePlaying ? 'rgba(184,150,46,0.18)'
    : audio.isPaused               ? 'rgba(22,48,38,0.07)'
    : 'rgba(22,48,38,0.07)';
  const border = isEffectivePlaying ? GOLD
    : audio.isPaused               ? GREEN + 'AA'
    : 'rgba(22,48,38,0.18)';
  const iconColor = audio.hasError ? colors.danger : GREEN;

  return (
    <Pressable onPress={handlePress} hitSlop={10}>
      <Animated.View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 1.5, borderColor: border,
        backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
        transform: [{ scale }],
      }}>
        {showSpinner ? (
          <ActivityIndicator size="small" color={GREEN} style={{ width: 12, height: 12 }} />
        ) : isEffectivePlaying ? (
          <View style={{ flexDirection: 'row', gap: 2.5 }}>
            <View style={{ width: 2.5, height: 10, borderRadius: 1.5, backgroundColor: GOLD }} />
            <View style={{ width: 2.5, height: 10, borderRadius: 1.5, backgroundColor: GOLD }} />
          </View>
        ) : (
          // idle / paused / completed / error → all show clean play triangle
          <View style={{
            width: 0, height: 0,
            borderTopWidth: 5,    borderTopColor: 'transparent',
            borderBottomWidth: 5, borderBottomColor: 'transparent',
            borderLeftWidth: 9,   borderLeftColor: iconColor,
            marginLeft: 2,
          }} />
        )}
      </Animated.View>
    </Pressable>
  );
}

// ─── LazyAudioPlayBtn — perf guard ─────────────────────────────────────────────
// AudioPlayBtn mounts a real native audio player (useAyatAudio → createAudioPlayer)
// on mount. Rendering one per ayat row is fine for a handful of rows, but a large
// surah (e.g. Al-Baqara, 286 ayats) mounts 286 native players at once when its
// card is opened, even though the user only ever plays one at a time.
// This wrapper shows a static idle icon (identical to AudioPlayBtn's resting
// state) and only mounts the real AudioPlayBtn — and its native player — on the
// user's first tap, then plays immediately.
function LazyAudioPlayBtn({
  surahNumber, ayahNumber, size = 32,
}: { surahNumber: number; ayahNumber: number; size?: number }) {
  const [activated, setActivated] = useState(false);

  if (activated) {
    return <AudioPlayBtn surahNumber={surahNumber} ayahNumber={ayahNumber} size={size} autoPlay />;
  }

  return (
    <Pressable onPress={() => { hapticLight(); setActivated(true); }} hitSlop={10}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.18)',
        backgroundColor: 'rgba(22,48,38,0.07)', alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{
          width: 0, height: 0,
          borderTopWidth: 5,    borderTopColor: 'transparent',
          borderBottomWidth: 5, borderBottomColor: 'transparent',
          borderLeftWidth: 9,   borderLeftColor: GREEN,
          marginLeft: 2,
        }} />
      </View>
    </Pressable>
  );
}

// ─── AyatRow – compact row inside an expanded surah ───────────────────────────

const AyatRow = React.memo(function AyatRow({
  row, surahName, content, onPress, delay, animate = true,
}: {
  row:       LearnedRow;
  surahName: string;
  content:   QuranAyahContent | null;
  onPress:   (t: DetailTarget) => void;
  delay:     number;
  animate?:  boolean;
}) {
  const anim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    // Beyond the stagger cap (see SurahCard), skip the entrance animation
    // entirely — avoids scheduling hundreds of concurrent/long-delayed
    // Animated.timing calls when a heavily-memorized surah is opened.
    if (!animate) return;
    Animated.timing(anim, {
      toValue: 1, duration: 260, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Content is pre-resolved by HifzScreen — no per-row async needed.
  const arabic = content?.arabic ?? null;

  const dc = diffColor(row);
  const dl = diffLabel(row);

  return (
    <Animated.View style={{
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
    }}>
      {/* Row is a plain View — AudioPlayBtn must be a sibling Pressable, not nested
          inside the detail-open Pressable, to avoid touch interception on RN. */}
      <View style={sr.ayatRow}>
        {/* Tappable area: badge + text + chevron → opens detail sheet */}
        <Pressable
          style={sr.ayatRowTap}
          onPress={() => {
            hapticLight();
            onPress({ surahNumber: row.surah_number, surahName, ayahNumber: row.ayah, content });
          }}
        >
          {/* Ayat number badge */}
          <View style={sr.ayatNumBadge}>
            <Text style={sr.ayatNumText}>{row.ayah}</Text>
          </View>

          {/* Arabic preview + status */}
          <View style={sr.ayatMid}>
            {arabic ? (
              <Text style={sr.arabicPreview} numberOfLines={1} allowFontScaling={false}>{arabic}</Text>
            ) : (
              <Skeleton w={140} h={13} />
            )}
            <View style={[sr.statusPill, { borderColor: dc + '50', backgroundColor: dc + '14' }]}>
              <View style={[sr.statusDot, { backgroundColor: dc }]} />
              <Text style={[sr.statusText, { color: dc }]}>{dl}</Text>
            </View>
          </View>

          {/* Chevron */}
          <View style={sr.chevronWrap}>
            <View style={sr.chev1} />
            <View style={sr.chev2} />
          </View>
        </Pressable>

        {/* Play button — sibling, not nested, so its Pressable fires correctly */}
        <LazyAudioPlayBtn surahNumber={row.surah_number} ayahNumber={row.ayah} size={30} />
      </View>
    </Animated.View>
  );
});

// ─── SurahCard – accordion ────────────────────────────────────────────────────

// Above this many rows, per-row entrance stagger is skipped (see AyatRow).
const ROW_STAGGER_LIMIT = 20;

const SurahCard = React.memo(function SurahCard({
  group, onAyatPress, entranceDelay, isOpen, onToggle,
}: {
  group:         SurahGroup;
  onAyatPress:   (t: DetailTarget) => void;
  entranceDelay: number;
  isOpen:        boolean;
  onToggle:      (surahNumber: number) => void;
}) {
  const open = isOpen;
  const chevRot = useRef(new Animated.Value(0)).current;
  const anim    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 340, delay: entranceDelay,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    hapticSelection();
    LayoutAnimation.configureNext({
      duration: 280,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'spring',        springDamping: 0.8 },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    Animated.timing(chevRot, {
      toValue: open ? 0 : 1, duration: 240,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
    onToggle(group.surahNumber);
  };

  const count   = group.ayahs.length;
  const total   = group.total;
  const fillPct = Math.min((count / total) * 100, 100);
  const status  = surahStatus(group);

  const statusLabel = status === 'mastered' ? 'Maîtrisée' : status === 'complete' ? 'Terminée' : 'En cours';
  const statusColor = status === 'mastered' ? GOLD : status === 'complete' ? colors.success : GREEN;
  const accentColor = status === 'mastered' ? GOLD : status === 'complete' ? colors.success : GREEN;

  const chevDeg = chevRot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <Animated.View style={[sc.card, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    }]}>
      <View style={[sc.accentBar, { backgroundColor: accentColor }]} />

      <View style={{ flex: 1 }}>
        <Pressable style={sc.header} onPress={toggle}>
          <View style={{ flex: 1 }}>
            <View style={sc.headerTop}>
              <Text style={sc.surahName}>{group.surahName}</Text>
              <View style={[sc.statusBadge, { borderColor: statusColor + '50', backgroundColor: statusColor + '14' }]}>
                <View style={[sc.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[sc.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>

            <View style={sc.progressRow}>
              <View style={sc.barBg}>
                <View style={[sc.barFill, { width: `${fillPct}%` as `${number}%`, backgroundColor: accentColor }]} />
              </View>
              <Text style={sc.countLabel}>
                {count === total ? `${count} ayats` : `${count} / ${total}`}
              </Text>
            </View>
          </View>

          <Animated.View style={[sc.chevWrap, { transform: [{ rotate: chevDeg }] }]}>
            <View style={sc.chevLine1} />
            <View style={sc.chevLine2} />
          </Animated.View>
        </Pressable>

        {open && (
          <View style={sc.ayatList}>
            <View style={sc.divider} />
            {group.ayahs.map((row, idx) => (
              <AyatRow
                key={row.id}
                row={row}
                surahName={group.surahName}
                content={group.contentMap.get(row.ayah) ?? null}
                onPress={onAyatPress}
                delay={idx < ROW_STAGGER_LIMIT ? idx * 40 : 0}
                animate={idx < ROW_STAGGER_LIMIT}
              />
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
});

// ─── AyatDetailSheet ──────────────────────────────────────────────────────────
// Content is passed in pre-resolved — no skeleton flash for text.
// Audio is prepared after sheet opens — no blocking on network.

function AyatDetailSheet({ target, onClose }: { target: DetailTarget; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(80)).current;
  const fadeV  = useRef(new Animated.Value(0)).current;

  const url    = getAyatAudioUrl({ surahNumber: target.surahNumber, ayahNumber: target.ayahNumber });
  const onDone = useCallback(() => {}, []);
  const audio  = useAyatAudio(url, onDone);

  // Stop all list AudioPlayBtn players when the sheet opens.
  useEffect(() => {
    stopAllHifzAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sheet entrance animation — starts immediately on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeV,  { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(slideY, { toValue: 0, tension: 160,  friction: 22, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop audio on unmount
  useEffect(() => () => { audio.stop(); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const close = () => { audio.stop(); onClose(); };

  // ── audio button state ──
  // State machine: idle | intending | playing | paused | completed | error
  // Labels use optimistic intent — no 'Préparation…' as main button text.
  // Spinner appears only inside the icon circle when isLoadingVisible is true.

  const isEffectivelyPlaying = audio.isPlaying || audio.isIntendingToPlay;

  const audioLabel = audio.hasError
    ? "Réessayer"
    : audio.isPaused
      ? "Reprendre"
      : isEffectivelyPlaying
        ? "Pause"
        : "Réécouter l'ayat";

  const audioBtnBg  = isEffectivelyPlaying ? 'rgba(184,150,46,0.10)' : 'rgba(22,48,38,0.06)';
  const audioBtnBrd = isEffectivelyPlaying ? GOLD
    : audio.hasError ? colors.danger + '66'
    : audio.isPaused ? GREEN + 'AA'
    : colors.border;
  const audioBtnClr = isEffectivelyPlaying ? GOLD
    : audio.hasError ? colors.danger
    : GREEN;

  const handleAudioPress = () => {
    hapticLight();
    if (audio.hasError)          { audio.reset();  audio.play(); }
    else if (audio.isPlaying)    { audio.pause();  }
    else if (audio.isPaused)     { audio.resume(); }
    else                         { audio.play();   } // idle, completed, or intending
  };

  const content = target.content;

  return (
    <Modal transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[ds.overlay, { opacity: fadeV }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Animated.View style={[ds.sheet, { transform: [{ translateY: slideY }], paddingBottom: Math.max(44, insets.bottom + 24) }]}>

          {/* Handle */}
          <View style={ds.handle} />

          {/* Header */}
          <View style={ds.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={ds.sheetSurah}>{target.surahName}</Text>
              <Text style={ds.sheetAyatNum}>Ayat {target.ayahNumber}</Text>
            </View>
            <Pressable style={ds.closeBtn} onPress={close} hitSlop={14}>
              <View style={ds.closeCross1} />
              <View style={ds.closeCross2} />
            </Pressable>
          </View>

          <View style={ds.sep} />

          {/* Content – pre-resolved, no skeleton flash */}
          {content ? (
            <>
              <Text style={ds.arabic} allowFontScaling={false}>{content.arabic}</Text>
              {content.transliteration ? <Text style={ds.translit}>{content.transliteration}</Text> : null}
              {content.translationFr   ? <Text style={ds.transl}>{content.translationFr}</Text>     : null}
            </>
          ) : (
            <View style={{ gap: 10, marginVertical: 18 }}>
              <Skeleton w="100%" h={30} />
              <Skeleton w="80%"  h={14} />
              <Skeleton w="90%"  h={13} />
            </View>
          )}

          <View style={ds.sep} />

          {/* Audio button */}
          <Pressable
            style={[ds.audioBtn, { borderColor: audioBtnBrd, backgroundColor: audioBtnBg }]}
            onPress={handleAudioPress}
          >
            <View style={[ds.audioIconCircle, { borderColor: audioBtnClr }]}>
              {audio.isLoadingVisible ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: GREEN, borderTopColor: 'transparent' }} />
              ) : isEffectivelyPlaying ? (
                <View style={{ flexDirection: 'row', gap: 3 }}>
                  <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: GOLD }} />
                  <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: GOLD }} />
                </View>
              ) : audio.isPaused ? (
                <View style={{
                  width: 0, height: 0,
                  borderTopWidth: 6,    borderTopColor: 'transparent',
                  borderBottomWidth: 6, borderBottomColor: 'transparent',
                  borderLeftWidth: 11,  borderLeftColor: GREEN,
                  marginLeft: 2,
                }} />
              ) : (
                <View style={{
                  width: 0, height: 0,
                  borderTopWidth: 6,    borderTopColor: 'transparent',
                  borderBottomWidth: 6, borderBottomColor: 'transparent',
                  borderLeftWidth: 11,  borderLeftColor: audio.hasError ? colors.danger : GREEN,
                  marginLeft: 2,
                }} />
              )}
            </View>
            <Text style={[ds.audioLbl, { color: audioBtnClr }]}>{audioLabel}</Text>
          </Pressable>

        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── HeroCard ─────────────────────────────────────────────────────────────────

function HeroCard({
  totalAyats, surahCount, lastDate, anim,
}: {
  totalAyats: number; surahCount: number; lastDate: string | null; anim: Animated.Value;
}) {
  const phrase = totalAyats === 0   ? 'Commence ta première session.'
    : totalAyats === 1 ? 'Ton Hifz a commencé. Continue.'
    : totalAyats < 10  ? 'Chaque ayat est une lumière gardée.'
    : 'Tu construis quelque chose de grand.';

  return (
    <Animated.View style={[hc.card, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
    }]}>
      <View style={hc.halo1} />
      <View style={hc.halo2} />
      {DOTS.map((d, i) => <FloatDot key={i} d={d} />)}

      <View style={hc.statsRow}>
        <View style={hc.statBlock}>
          <Text style={hc.statNum}>{totalAyats}</Text>
          <Text style={hc.statLbl}>{totalAyats === 1 ? 'ayat mémorisé' : 'ayats mémorisés'}</Text>
        </View>
        <View style={hc.statSep} />
        <View style={hc.statBlock}>
          <Text style={hc.statNum}>{surahCount}</Text>
          <Text style={hc.statLbl}>{surahCount === 1 ? 'sourate' : 'sourates'}</Text>
        </View>
        {lastDate && (
          <>
            <View style={hc.statSep} />
            <View style={hc.statBlock}>
              <Text style={hc.statNum}>{fmtDate(lastDate) ?? '—'}</Text>
              <Text style={hc.statLbl}>Dernière session</Text>
            </View>
          </>
        )}
      </View>

      <Text style={hc.phrase}>{phrase}</Text>
    </Animated.View>
  );
}

// ─── LastAyatCard ─────────────────────────────────────────────────────────────

function LastAyatCard({
  row, surahName, onPress, anim,
}: {
  row:       LearnedRow;
  surahName: string;
  onPress:   (t: DetailTarget) => void;
  anim:      Animated.Value;
}) {
  const [content, setContent] = useState<QuranAyahContent | null>(null);
  useEffect(() => {
    getQuranAyahRange({ surahNumber: row.surah_number, fromAyah: row.ayah, toAyah: row.ayah })
      .then(r => { if (r.ok && r.ayahs[0]) setContent(r.ayahs[0]); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.surah_number, row.ayah]);

  const dc = diffColor(row);
  const dl = diffLabel(row);

  return (
    <Animated.View style={[la.wrap, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    }]}>
      <Text style={g.sectionLabel}>DERNIER AYAT APPRIS</Text>
      <Pressable
        style={la.card}
        onPress={() => { hapticMedium(); onPress({ surahNumber: row.surah_number, surahName, ayahNumber: row.ayah, content }); }}
      >
        <View style={la.accentBar} />
        <View style={la.body}>
          <View style={la.topRow}>
            <View style={{ flex: 1 }}>
              <Text style={la.surahName}>{surahName}</Text>
              <Text style={la.ayatRef}>Ayat {row.ayah}</Text>
            </View>
            <View style={[la.badge, { borderColor: dc + '55', backgroundColor: dc + '14' }]}>
              <View style={[la.badgeDot, { backgroundColor: dc }]} />
              <Text style={[la.badgeText, { color: dc }]}>{dl}</Text>
            </View>
          </View>
          <Text style={la.hint}>Appuie pour lire et réécouter</Text>
        </View>
        <View style={la.playWrap}>
          <AudioPlayBtn surahNumber={row.surah_number} ayahNumber={row.ayah} size={38} />
        </View>
        <View style={la.chevWrap}>
          <View style={la.chev1} />
          <View style={la.chev2} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── ReviewCard ───────────────────────────────────────────────────────────────

function ReviewCard({ isSingle, anim }: { isSingle: boolean; anim: Animated.Value }) {
  return (
    <Animated.View style={[rv.wrap, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
    }]}>
      <Text style={g.sectionLabel}>RÉVISIONS À VENIR</Text>
      <View style={rv.card}>
        <View style={rv.accentBar} />
        <View style={rv.body}>
          <Text style={rv.sub}>
            {isSingle ? 'Ton ayat sera revu selon ce calendrier.' : 'Tes ayats seront revus selon ce calendrier.'}
          </Text>
          <View style={rv.chips}>
            {REVIEW_CHIPS.map(c => (
              <View key={c} style={rv.chip}>
                <Text style={rv.chipText}>{c}</Text>
              </View>
            ))}
          </View>
          <Text style={rv.note}>Zainly adapte automatiquement selon ta récitation.</Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ anim }: { anim: Animated.Value }) {
  return (
    <Animated.View style={[em.wrap, {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
    }]}>
      <View style={em.halo} />
      <View style={em.haloInner} />
      <Text style={em.arabic} allowFontScaling={false}>﷽</Text>
      <Text style={em.title}>Ton Hifz commence avec{'\n'}ton premier ayat.</Text>
      <Text style={em.sub}>Chaque session validée laisse{'\n'}une trace permanente ici.</Text>
    </Animated.View>
  );
}

// ─── HifzScreen ───────────────────────────────────────────────────────────────

export default function HifzScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s: { user: { id?: string } | null }) => s.user?.id);

  const { data: progress, isLoading: pLoading, isError: pError, isFetched: pFetched, refetch: pRefetch } = useProgress(userId);
  const { data: items,    isLoading: iLoading, isError: iError,  isFetched: iFetched, refetch: iRefetch } = useLearnedItems(userId);

  const isLoading = pLoading || iLoading;
  const isError   = pError   || iError;
  const hasFetchedOnce = pFetched && iFetched;
  const isInitialLoading = (pLoading && !pFetched) || (iLoading && !iFetched);
  const refetch   = () => { pRefetch(); iRefetch(); };

  // ── detail modal ──
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const openDetail  = useCallback((t: DetailTarget) => { setDetail(t); }, []);
  const closeDetail = useCallback(() => setDetail(null), []);

  // ── single-open accordion ──
  // Only one SurahCard expanded at a time. Bounds the worst-case number of
  // simultaneously rendered AyatRow instances (and LayoutAnimation cost) to
  // the size of a single surah instead of the sum of every opened surah.
  const [expandedSurah, setExpandedSurah] = useState<number | null>(null);
  const toggleSurah = useCallback((surahNumber: number) => {
    setExpandedSurah(prev => prev === surahNumber ? null : surahNumber);
  }, []);

  // ── B21: stop all audio when leaving this tab ──
  useFocusEffect(
    useCallback(() => {
      return () => { stopAllHifzAudio(); };
    }, [])
  );

  // ── entrance animations ──
  const a0 = useRef(new Animated.Value(0)).current;
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;
  const a4 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) return;
    Animated.stagger(70, [
      Animated.timing(a0, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a1, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a2, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a3, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(a4, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── safe bottom padding ──
  const scrollPb = 64 + Math.max(insets.bottom, 8) + 28;

  // ── derived data ──
  const totalMemorized = progress?.total_memorized ?? 0;
  const lastDate       = progress?.last_session_date ?? null;

  const { baseGroups, latestRow, latestSurahName } = useMemo(() => {
    if (!items || items.length === 0) {
      return { baseGroups: [], latestRow: null, latestSurahName: null };
    }
    const map = new Map<number, LearnedRow[]>();
    for (const row of items as LearnedRow[]) {
      if (!map.has(row.surah_number)) map.set(row.surah_number, []);
      map.get(row.surah_number)!.push(row);
    }
    const groups: SurahGroup[] = Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sn, rows]) => ({
        surahNumber: sn,
        surahName:   getSurahName(sn) ?? `Sourate ${sn}`,
        ayahs:       rows.sort((a, b) => a.ayah - b.ayah),
        total:       SURAH_TOTAL[sn] ?? rows.length,
        contentMap:  new Map<number, QuranAyahContent>(),
      }));
    const latest = (items as LearnedRow[])[0] ?? null;
    return {
      baseGroups:      groups,
      latestRow:       latest,
      latestSurahName: latest ? (getSurahName(latest.surah_number) ?? `Sourate ${latest.surah_number}`) : null,
    };
  }, [items]);

  // B19: resolve all Quran content once per surah (not per row).
  // getQuranAyahRange resolves from local bundled JSON — effectively sync.
  // We store filled groups in state so AyatRow receives content already resolved.
  const [surahGroups, setSurahGroups] = useState<SurahGroup[]>([]);
  useEffect(() => {
    if (baseGroups.length === 0) { setSurahGroups([]); return; }
    let cancelled = false;
    Promise.all(
      baseGroups.map(async group => {
        const ayahNums = group.ayahs.map(r => r.ayah);
        const fromAyah = Math.min(...ayahNums);
        const toAyah   = Math.max(...ayahNums);
        const result   = await getQuranAyahRange({ surahNumber: group.surahNumber, fromAyah, toAyah });
        const cMap = new Map<number, QuranAyahContent>();
        if (result.ok) {
          for (const ayah of result.ayahs) { cMap.set(ayah.ayahNumber, ayah); }
        }
        return { ...group, contentMap: cMap };
      })
    ).then(resolved => {
      if (!cancelled) setSurahGroups(resolved);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseGroups]);

  const surahCount = surahGroups.length;
  const isSingle   = totalMemorized <= 1;

  // ── initial loading state ──
  // Only show a minimal loading indicator during the very first fetch.
  // Once queries have fetched at least once (isFetched), we can render
  // EmptyState or content directly without any skeleton flash.
  // This prevents the Dashboard Skeleton from ever appearing in Mon Hifz.
  // isInitialLoading handles the case where userId is undefined (hooks disabled):
  // - userId undefined → hooks don't execute → isInitialLoading=false → render EmptyState
  // - userId defined, first fetch → isInitialLoading=true → show spinner
  // - userId defined, fetched → isInitialLoading=false → render content
  if (isInitialLoading) {
    return (
      <SafeAreaView style={g.safe}>
        <View style={g.centeredFill}>
          <ActivityIndicator color={GREEN} />
        </View>
      </SafeAreaView>
    );
  }

  // ── error ──
  if (isError) {
    return (
      <SafeAreaView style={g.safe}>
        <View style={g.centeredFill}>
          <Text style={g.errorTitle}>Impossible de charger</Text>
          <Text style={g.errorSub}>Vérifie ta connexion.</Text>
          <Pressable style={g.retryBtn} onPress={() => { hapticLight(); refetch(); }}>
            <Text style={g.retryTxt}>Réessayer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isEmpty = totalMemorized === 0 && surahGroups.length === 0;

  return (
    <SafeAreaView style={g.safe}>
      <ScrollView
        style={g.scroll}
        contentContainerStyle={[g.content, { paddingBottom: scrollPb }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Page header */}
        <Animated.View style={[g.header, {
          opacity: a0,
          transform: [{ translateY: a0.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        }]}>
          <Text style={g.eyebrow}>MON HIFZ</Text>
          <Text style={g.pageTitle}>Bibliothèque</Text>
          <Text style={g.pageSub}>Ce que tu as bâti, session après session.</Text>
        </Animated.View>

        {/* Hero */}
        <HeroCard totalAyats={totalMemorized} surahCount={surahCount} lastDate={lastDate} anim={a1} />

        {/* Empty state */}
        {isEmpty && <EmptyState anim={a2} />}

        {/* Last ayat card */}
        {latestRow && latestSurahName && (
          <LastAyatCard row={latestRow} surahName={latestSurahName} onPress={openDetail} anim={a2} />
        )}

        {/* Reviews */}
        {!isEmpty && <ReviewCard isSingle={isSingle} anim={a3} />}

        {/* Surah accordion library */}
        {surahGroups.length > 0 && (
          <Animated.View style={{
            opacity: a4,
            transform: [{ translateY: a4.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }}>
            <Text style={[g.sectionLabel, { marginTop: 4 }]}>MES SOURATES</Text>
            {surahGroups.map((group, idx) => (
              <SurahCard
                key={group.surahNumber}
                group={group}
                onAyatPress={openDetail}
                entranceDelay={idx * 60}
                isOpen={expandedSurah === group.surahNumber}
                onToggle={toggleSurah}
              />
            ))}
          </Animated.View>
        )}
      </ScrollView>

      {/* Detail sheet */}
      {detail && <AyatDetailSheet target={detail} onClose={closeDetail} />}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const g = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  scroll:      { flex: 1 },
  content:     { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  centeredFill:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 14 },
  header:      { marginBottom: spacing.lg },
  eyebrow:     { fontSize: 9, fontWeight: '800', letterSpacing: 3, color: GOLD, marginBottom: 6 },
  pageTitle:   { fontSize: 28, fontWeight: '900', color: GREEN, letterSpacing: -0.5, marginBottom: 3 },
  pageSub:     { fontSize: 13, color: colors.muted, lineHeight: 19 },
  sectionLabel:{ fontSize: 9, fontWeight: '800', letterSpacing: 2.5, color: colors.muted, marginBottom: 10 },
  errorTitle:  { fontSize: 17, fontWeight: '700', color: GREEN, textAlign: 'center' },
  errorSub:    { fontSize: 13, color: colors.muted, textAlign: 'center' },
  retryBtn:    { paddingHorizontal: 28, paddingVertical: 11, borderRadius: 14, borderWidth: 1.5, borderColor: GREEN, backgroundColor: 'rgba(22,48,38,0.05)' },
  retryTxt:    { fontSize: 14, fontWeight: '700', color: GREEN },
});

const hc = StyleSheet.create({
  card: {
    backgroundColor: GREEN, borderRadius: 24,
    paddingHorizontal: spacing.lg, paddingVertical: 24,
    marginBottom: spacing.lg, overflow: 'hidden',
    shadowColor: GREEN, shadowOpacity: 0.30, shadowRadius: 20, shadowOffset: { width: 0, height: 7 }, elevation: 10,
  },
  halo1: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(184,150,46,0.12)', top: -70, right: -55 },
  halo2: { position: 'absolute', width: 160, height: 160, borderRadius: 80,  backgroundColor: 'rgba(184,150,46,0.08)', bottom: -45, left: -35 },
  statsRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  statBlock: { flex: 1, alignItems: 'center' },
  statSep:   { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.12)' },
  statNum:   { fontSize: 22, fontWeight: '900', color: GOLD, letterSpacing: -0.5, lineHeight: 27 },
  statLbl:   { fontSize: 9.5, color: 'rgba(255,255,255,0.50)', marginTop: 2, letterSpacing: 0.2, textAlign: 'center' },
  phrase:    { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', textAlign: 'center', marginTop: 4, lineHeight: 17 },
});

const la = StyleSheet.create({
  wrap:     { marginBottom: spacing.md },
  card: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  accentBar: { width: 4, alignSelf: 'stretch', backgroundColor: GOLD },
  body:      { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  topRow:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  surahName: { fontSize: 16, fontWeight: '800', color: GREEN, letterSpacing: -0.2, marginBottom: 1 },
  ayatRef:   { fontSize: 12, color: colors.muted },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8, marginTop: 1 },
  badgeDot:  { width: 5, height: 5, borderRadius: 2.5 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  hint:      { fontSize: 10.5, color: colors.muted, fontStyle: 'italic' },
  playWrap:  { paddingRight: 10, paddingLeft: 4 },
  chevWrap:  { width: 22, alignItems: 'center', justifyContent: 'center', paddingRight: 10 },
  chev1: { position: 'absolute', width: 7, height: 1.5, backgroundColor: colors.muted, transform: [{ rotate: '45deg' }, { translateY: -2.5 }] },
  chev2: { position: 'absolute', width: 7, height: 1.5, backgroundColor: colors.muted, transform: [{ rotate: '-45deg' }, { translateY: 2.5 }] },
});

const rv = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  card: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  accentBar: { width: 4, backgroundColor: GOLD },
  body:      { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  sub:       { fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: 10 },
  chips:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chip:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(184,150,46,0.40)', backgroundColor: 'rgba(184,150,46,0.08)' },
  chipText:  { fontSize: 11, fontWeight: '700', color: GOLD, letterSpacing: 0.5 },
  note:      { fontSize: 10, color: colors.muted, fontStyle: 'italic', lineHeight: 15 },
});

const sc = StyleSheet.create({
  card: {
    flexDirection: 'row', backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    marginBottom: spacing.sm,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  accentBar:   { width: 4 },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
  headerTop:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  surahName:   { fontSize: 15, fontWeight: '800', color: GREEN, letterSpacing: -0.2, flex: 1, marginRight: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  statusDot:   { width: 5, height: 5, borderRadius: 2.5 },
  statusLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barBg:       { flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  barFill:     { height: 4, borderRadius: 3 },
  countLabel:  { fontSize: 10, color: colors.muted, fontWeight: '700', minWidth: 44, textAlign: 'right' },
  chevWrap:    { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  chevLine1:   { position: 'absolute', width: 8, height: 1.5, backgroundColor: colors.muted, borderRadius: 1, transform: [{ rotate: '45deg'  }, { translateY: -2.5 }] },
  chevLine2:   { position: 'absolute', width: 8, height: 1.5, backgroundColor: colors.muted, borderRadius: 1, transform: [{ rotate: '-45deg' }, { translateY: 2.5  }] },
  divider:     { height: 1, backgroundColor: colors.border, marginHorizontal: 14 },
  ayatList:    { paddingBottom: 8 },
});

const sr = StyleSheet.create({
  ayatRow:      { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 10, paddingVertical: 0 },
  ayatRowTap:   { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, paddingRight: 6 },
  ayatNumBadge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.18)', backgroundColor: 'rgba(22,48,38,0.05)', alignItems: 'center', justifyContent: 'center' },
  ayatNumText:  { fontSize: 11, fontWeight: '800', color: GREEN },
  ayatMid:      { flex: 1, gap: 4 },
  arabicPreview:{ fontSize: 14, color: GREEN, textAlign: 'right', writingDirection: 'rtl', lineHeight: 20, fontWeight: '500' },
  statusPill:   { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2 },
  statusDot:    { width: 4, height: 4, borderRadius: 2 },
  statusText:   { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.2 },
  chevronWrap:  { width: 18, alignItems: 'center', justifyContent: 'center' },
  chev1:        { position: 'absolute', width: 6, height: 1.5, backgroundColor: colors.muted, borderRadius: 1, transform: [{ rotate: '45deg'  }, { translateY: -2 }] },
  chev2:        { position: 'absolute', width: 6, height: 1.5, backgroundColor: colors.muted, borderRadius: 1, transform: [{ rotate: '-45deg' }, { translateY: 2  }] },
});

const ds = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg, paddingTop: 12,
    borderTopWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.20, shadowRadius: 28, shadowOffset: { width: 0, height: -6 }, elevation: 24,
  },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 18 },
  sheetHeader:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  sheetSurah:   { fontSize: 19, fontWeight: '900', color: GREEN, letterSpacing: -0.3 },
  sheetAyatNum: { fontSize: 12, color: colors.muted, marginTop: 3 },
  closeBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  closeCross1:  { position: 'absolute', width: 14, height: 1.5, backgroundColor: colors.muted, transform: [{ rotate: '45deg'  }] },
  closeCross2:  { position: 'absolute', width: 14, height: 1.5, backgroundColor: colors.muted, transform: [{ rotate: '-45deg' }] },
  sep:          { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  arabic:       { fontSize: 26, color: GREEN, textAlign: 'right', lineHeight: 46, fontWeight: '600', marginBottom: 8 },
  translit:     { fontSize: 13, color: colors.muted, fontStyle: 'italic', lineHeight: 20, marginBottom: 6 },
  transl:       { fontSize: 13, color: colors.text, lineHeight: 20 },
  audioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, marginTop: 2,
  },
  audioIconCircle: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  audioLbl:     { flex: 1, fontSize: 14, fontWeight: '700' },
});

const em = StyleSheet.create({
  wrap:      { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xl, gap: 14 },
  halo:      { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 1.5, borderColor: 'rgba(184,150,46,0.20)', backgroundColor: 'rgba(184,150,46,0.05)' },
  haloInner: { position: 'absolute', width: 180, height: 180, borderRadius: 90,  borderWidth: 1,   borderColor: 'rgba(184,150,46,0.14)', backgroundColor: 'rgba(184,150,46,0.04)' },
  arabic:    { fontSize: 52, color: GOLD, ...Platform.select({ android: { lineHeight: 70 } }) },
  title:     { fontSize: 19, fontWeight: '800', color: GREEN, textAlign: 'center', lineHeight: 27, letterSpacing: -0.2 },
  sub:       { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});