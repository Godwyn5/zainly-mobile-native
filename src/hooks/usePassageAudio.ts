// ─── usePassageAudio ──────────────────────────────────────────────────────────
// Plays a sequence of ayat audio files one by one, in order.
// No overlapping. Stops and cleans up on unmount or when ayatNumbers changes.
//
// Rules:
//  - Only one player instance alive at a time.
//  - Moving to the next ayat in the sequence happens only on natural completion.
//  - Stopping (stop()) immediately pauses & removes the player, resets state.
//  - onAllFinished is called once when the last ayat completes naturally.
//  - No state updates after unmount.
//  - No DB writes, no navigation, no microphone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getAyatAudioUrl } from '@/core/quranAudio';

export type PassageAudioState = {
  isPlaying:         boolean;
  isLoading:         boolean;
  hasError:          boolean;
  errorMessage:      string | null;
  currentAyatIndex:  number;   // 0-based index into ayatNumbers
  totalAyats:        number;
  play:              () => void;
  stop:              () => void;
};

/**
 * @param surahNumber  Surah number (1–114)
 * @param ayatNumbers  Ordered list of ayah numbers to play
 * @param onAllFinished Called once after the last ayah finishes naturally
 */
export function usePassageAudio(
  surahNumber:  number,
  ayatNumbers:  number[],
  onAllFinished?: () => void,
): PassageAudioState {
  const mountedRef      = useRef(true);
  const playingRef      = useRef(false);   // are we in an active playback session?
  const currentIdxRef   = useRef(0);       // current position in ayatNumbers
  const didJustFinishRef = useRef(false);  // guard double-fire

  const [isPlaying,        setIsPlaying]        = useState(false);
  const [isLoading,        setIsLoading]        = useState(false);
  const [hasError,         setHasError]         = useState(false);
  const [errorMessage,     setErrorMessage]     = useState<string | null>(null);
  const [currentAyatIndex, setCurrentAyatIndex] = useState(0);

  // Single persistent player instance
  const playerRef = useRef(createAudioPlayer(null));

  // Status subscription
  const status = useAudioPlayerStatus(playerRef.current);

  // ── cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playingRef.current = false;
      try { playerRef.current.remove(); } catch { /* ignore */ }
    };
  }, []);

  // ── reset when ayatNumbers reference changes (new passage / restart) ──
  useEffect(() => {
    playingRef.current = false;
    currentIdxRef.current = 0;
    didJustFinishRef.current = false;
    if (mountedRef.current) {
      setIsPlaying(false);
      setIsLoading(false);
      setHasError(false);
      setErrorMessage(null);
      setCurrentAyatIndex(0);
    }
    try {
      playerRef.current.pause();
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ayatNumbers]);

  // ── internal: load and play ayat at index ──
  const playAtIndex = useCallback((idx: number) => {
    if (!mountedRef.current || !playingRef.current) return;
    if (idx >= ayatNumbers.length) return;

    const ayahNumber = ayatNumbers[idx];
    if (!ayahNumber) return;

    const url = getAyatAudioUrl({ surahNumber, ayahNumber });
    didJustFinishRef.current = false;

    if (mountedRef.current) {
      currentIdxRef.current = idx;
      setCurrentAyatIndex(idx);
      setIsLoading(true);
      setIsPlaying(false);
      setHasError(false);
      setErrorMessage(null);
    }

    try {
      playerRef.current.replace({ uri: url });
      setTimeout(() => {
        if (mountedRef.current && playingRef.current) {
          try { playerRef.current.play(); } catch { /* ignore */ }
        }
      }, 80);
    } catch {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsPlaying(false);
        setHasError(true);
        setErrorMessage("Audio indisponible pour l'instant. Réessaie.");
        playingRef.current = false;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahNumber, ayatNumbers]);

  // ── react to player status changes ──
  useEffect(() => {
    if (!mountedRef.current || !playingRef.current) return;

    if (status.isLoaded && status.playing && !didJustFinishRef.current) {
      setIsLoading(false);
      setIsPlaying(true);
    }

    if (!status.isLoaded && !status.playing && !status.didJustFinish) {
      // still buffering
      setIsLoading(true);
    }

    if (status.didJustFinish && !didJustFinishRef.current) {
      didJustFinishRef.current = true;
      if (!mountedRef.current) return;

      setIsPlaying(false);

      const nextIdx = currentIdxRef.current + 1;
      if (nextIdx < ayatNumbers.length) {
        // play next ayat
        setTimeout(() => {
          if (mountedRef.current && playingRef.current) {
            playAtIndex(nextIdx);
          }
        }, 300); // brief gap between ayats
      } else {
        // all done
        setIsLoading(false);
        playingRef.current = false;
        if (onAllFinished) onAllFinished();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isLoaded, status.playing, status.didJustFinish, status.isBuffering]);

  // ── play ──
  const play = useCallback(() => {
    if (!mountedRef.current) return;
    if (ayatNumbers.length === 0) return;

    setHasError(false);
    setErrorMessage(null);
    playingRef.current = true;
    currentIdxRef.current = 0;
    setCurrentAyatIndex(0);

    playAtIndex(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ayatNumbers, playAtIndex]);

  // ── stop ──
  const stop = useCallback(() => {
    playingRef.current = false;
    try { playerRef.current.pause(); } catch { /* ignore */ }
    if (mountedRef.current) {
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, []);

  return {
    isPlaying,
    isLoading,
    hasError,
    errorMessage,
    currentAyatIndex,
    totalAyats: ayatNumbers.length,
    play,
    stop,
  };
}
