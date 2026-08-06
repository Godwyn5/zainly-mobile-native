import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight } from '@/utils/haptics';
import { getAyatAudioUrl } from '@/core/quranAudio';
import { useAyatAudio } from '@/hooks/useAyatAudio';

// ─── Shared: AyatAudioControl ─────────────────────────────────────────────────
// Compact, premium audio button usable in Steps 3, 4, 5 compare.
// Does NOT increment any learning counter unless onCompleted is provided.

type AyatAudioControlProps = {
  surahNumber:  number;
  ayatNumber:   number;
  label?:       string;         // default: "Écouter l'ayat"
  onCompleted?: () => void;     // called after natural playback completion
  compact?:     boolean;        // tighter padding for inline use
};

export function AyatAudioControl({ surahNumber, ayatNumber, label, onCompleted, compact }: AyatAudioControlProps) {
  const url    = getAyatAudioUrl({ surahNumber, ayahNumber: ayatNumber });
  const onDone = useCallback(() => { if (onCompleted) onCompleted(); }, [onCompleted]);
  const audio  = useAyatAudio(url, onDone);

  const bar1 = useRef(new Animated.Value(0.4)).current;
  const bar2 = useRef(new Animated.Value(0.7)).current;
  const bar3 = useRef(new Animated.Value(0.5)).current;
  const barsLoop = useRef<Animated.CompositeAnimation | null>(null);
  const btnScale = useRef(new Animated.Value(1)).current;

  // Stop on unmount — prevents orphaned playback
  useEffect(() => () => { audio.stop(); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  useEffect(() => {
    if (audio.isPlaying) {
      barsLoop.current = Animated.loop(Animated.parallel([
        Animated.sequence([
          Animated.timing(bar1, { toValue: 1.0, duration: 330, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar1, { toValue: 0.3, duration: 330, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(bar2, { toValue: 0.3, duration: 270, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar2, { toValue: 1.0, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(bar3, { toValue: 1.0, duration: 410, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bar3, { toValue: 0.4, duration: 300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ]));
      barsLoop.current.start();
    } else {
      barsLoop.current?.stop();
      bar1.setValue(0.4);
      bar2.setValue(0.7);
      bar3.setValue(0.5);
    }
    return () => { barsLoop.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.isPlaying]);

  // Tap handler — routes through full state machine
  const handlePress = useCallback(() => {
    hapticLight();
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.93, duration: 80,  useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1.00, duration: 110, useNativeDriver: true }),
    ]).start();
    if (audio.hasError)         { audio.reset(); audio.play(); }
    else if (audio.isPlaying)   { audio.pause();  }
    else if (audio.isPaused)    { audio.resume(); }
    else if (audio.hasCompleted){ audio.replay(); }
    else                        { audio.play();   }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.hasError, audio.isPlaying, audio.isPaused, audio.hasCompleted, audio.reset, audio.play, audio.pause, audio.resume, audio.replay]);

  // Optimistic: treat tap as playing instantly
  const isEffectivePlaying = audio.isPlaying || audio.isIntendingToPlay;

  const btnLabel = audio.hasError
    ? "Réessayer"
    : audio.isPaused
      ? 'Reprendre'
      : isEffectivePlaying
        ? 'Pause'
        : label ?? "Écouter l'ayat";

  return (
    <View>
      <Animated.View style={{ transform: [{ scale: btnScale }] }}>
        <Pressable
          style={({ pressed }) => [
            aco.btn,
            compact && aco.btnCompact,
            audio.isPlaying && aco.btnPlaying,
            audio.isPaused  && aco.btnPaused,
            pressed && !audio.isLoadingVisible && aco.btnPressed,
          ]}
          onPress={handlePress}
          accessibilityLabel={btnLabel}
        >
          <View style={aco.inner}>
            {audio.isLoadingVisible ? (
              <View style={aco.spinner} />
            ) : audio.isPaused ? (
              <View style={aco.playTriangle} />
            ) : isEffectivePlaying ? (
              <View style={aco.icon}>
                <Animated.View style={[aco.bar1, { transform: [{ scaleY: bar1 }] }]} />
                <Animated.View style={[aco.bar2, { transform: [{ scaleY: bar2 }] }]} />
                <Animated.View style={[aco.bar3, { transform: [{ scaleY: bar3 }] }]} />
              </View>
            ) : (
              <View style={aco.playTriangle} />
            )}
            <Text style={[
              aco.label,
              isEffectivePlaying && aco.labelPlaying,
              audio.isPaused     && aco.labelPaused,
              audio.hasError     && aco.labelError,
            ]}>{btnLabel}</Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const aco = StyleSheet.create({
  btn:          { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(22,48,38,0.18)', paddingVertical: 9, paddingHorizontal: spacing.md, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  btnCompact:   { paddingVertical: 7, paddingHorizontal: 12 },
  btnPlaying:   { backgroundColor: 'rgba(22,48,38,0.07)', borderColor: colors.primary },
  btnPaused:    { backgroundColor: 'rgba(22,48,38,0.05)', borderColor: 'rgba(22,48,38,0.40)' },
  btnPressed:   { opacity: 0.80, transform: [{ scale: 0.97 }] },
  inner:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  icon:         { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  bar1:         { width: 2.5, height: 9,  borderRadius: 2, backgroundColor: colors.primary },
  bar2:         { width: 2.5, height: 16, borderRadius: 2, backgroundColor: colors.primary },
  bar3:         { width: 2.5, height: 11, borderRadius: 2, backgroundColor: colors.primary },
  label:        { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.3 },
  labelPlaying: { color: colors.primary, opacity: 0.85 },
  labelPaused:  { color: colors.primary, opacity: 0.70 },
  labelError:   { color: colors.danger, fontSize: 11 },
  spinner:      { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: colors.primary, borderTopColor: 'transparent' },
  playTriangle: { width: 0, height: 0, borderTopWidth: 5, borderTopColor: 'transparent', borderBottomWidth: 5, borderBottomColor: 'transparent', borderLeftWidth: 9, borderLeftColor: colors.primary, marginLeft: 2 },
});
