// ─── useAyatAudio ─────────────────────────────────────────────────────────────
// Manages playback of a single Quran ayah audio file.
//
// Rules enforced by this hook:
//  - onFinish is called at most once per natural playback completion.
//  - No state updates after unmount.
//  - No overlapping playback (play() while already playing → seek to 0 + replay).
//  - Player is fully removed on unmount.
//  - When url changes the player source is replaced and state resets.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export type AyatAudioState = {
  isLoading:  boolean;
  isPlaying:  boolean;
  hasError:   boolean;
  errorMessage: string | null;
  play:  () => void;
  stop:  () => void;
  reset: () => void;
};

/**
 * @param url       Direct MP3 URL for the ayah.
 * @param onFinish  Called once when playback completes naturally.
 *                  NOT called on stop() / error / unmount.
 */
export function useAyatAudio(
  url: string,
  onFinish: () => void,
): AyatAudioState {
  const mountedRef     = useRef(true);
  const finishFiredRef = useRef(false); // guard: fire onFinish exactly once per play

  // ── local UI state ──
  const [isLoading,    setIsLoading]    = useState(false);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [hasError,     setHasError]     = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── player ──
  // createAudioPlayer gives us full lifecycle control.
  // We hold it in a ref so it survives re-renders.
  const playerRef = useRef(createAudioPlayer(null));

  // ── status hook for the player ──
  const status = useAudioPlayerStatus(playerRef.current);

  // ── react to url changes: replace source + reset state ──
  useEffect(() => {
    finishFiredRef.current = false;
    if (mountedRef.current) {
      setIsLoading(false);
      setIsPlaying(false);
      setHasError(false);
      setErrorMessage(null);
    }
    // replace the source so the player is primed for the new ayah
    try {
      playerRef.current.replace({ uri: url });
      // pause immediately after replace so it doesn't auto-play
      playerRef.current.pause();
    } catch {
      // source replacement errors surface via status; ignore here
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── react to status changes ──
  useEffect(() => {
    if (!mountedRef.current) return;

    // Update loading / playing state from status
    const loading = !status.isLoaded && !status.didJustFinish;
    setIsLoading(loading && !hasError);
    setIsPlaying(status.playing);

    // Natural completion
    if (status.didJustFinish && !finishFiredRef.current) {
      finishFiredRef.current = true;
      if (mountedRef.current) {
        setIsPlaying(false);
        setIsLoading(false);
        onFinish();
      }
    }
  // We intentionally exclude `onFinish` from deps to avoid stale-closure issues;
  // callers should wrap it in useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isLoaded, status.playing, status.didJustFinish, status.isBuffering]);

  // ── cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        playerRef.current.remove();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  // ── play ──
  const play = useCallback(() => {
    if (!mountedRef.current) return;
    setHasError(false);
    setErrorMessage(null);
    finishFiredRef.current = false;

    try {
      // If already playing seek to start and continue; otherwise just play.
      if (status.playing) {
        playerRef.current.seekTo(0).then(() => {
          if (mountedRef.current) playerRef.current.play();
        }).catch(() => {
          if (mountedRef.current) playerRef.current.play();
        });
      } else {
        // Replace source fresh to ensure we play from beginning after a previous finish
        playerRef.current.replace({ uri: url });
        // Small delay to let the replace settle before playing
        setTimeout(() => {
          if (mountedRef.current) {
            try { playerRef.current.play(); } catch { /* ignore */ }
          }
        }, 80);
      }
      setIsLoading(true);
      setIsPlaying(false);
    } catch {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsPlaying(false);
        setHasError(true);
        setErrorMessage("Audio indisponible pour l'instant. Réessaie.");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, status.playing]);

  // ── stop ──
  const stop = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      playerRef.current.pause();
    } catch { /* ignore */ }
    if (mountedRef.current) {
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, []);

  // ── reset ──
  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    stop();
    finishFiredRef.current = false;
    setHasError(false);
    setErrorMessage(null);
  }, [stop]);

  return {
    isLoading,
    isPlaying,
    hasError,
    errorMessage,
    play,
    stop,
    reset,
  };
}
