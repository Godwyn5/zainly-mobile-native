// ─── useAyatAudio ─────────────────────────────────────────────────────────────
// Manages playback of a single Quran ayah audio file.
//
// Rules enforced by this hook:
//  - onFinish is called at most once per natural playback completion.
//  - No state updates after unmount.
//  - No overlapping playback (play() while already playing → seek to 0 + replay).
//  - Player is fully removed on unmount.
//  - When url changes the player source is replaced and state resets.
//  - pause() pauses in-place; resume() continues from where it left off.
//  - isLoadingVisible is debounced — only true after 300 ms of loading to avoid
//    short-lived flashes for fast-starting audio.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

export type AyatAudioState = {
  // ── raw native state ──
  isLoading:          boolean;  // native player buffering
  isLoadingVisible:   boolean;  // debounced 300ms — safe to show spinner
  isPlaying:          boolean;
  isPaused:           boolean;
  hasCompleted:       boolean;  // natural finish fired
  isIntendingToPlay:  boolean;  // optimistic: tap registered before native confirms
  hasError:           boolean;
  errorMessage:       string | null;
  // ── derived convenience ──
  isIdle:             boolean;  // !playing && !paused && !completed && !loading && !error
  isPreparing:        boolean;  // loading but intending to play
  // ── actions ──
  play:    () => void;  // from idle/completed/error: replace if needed, then play
  replay:  () => void;  // from completed: seekTo(0) → play; falls back to replace if seek fails
  pause:   () => void;
  resume:  () => void;
  stop:    () => void;
  reset:   () => void;
  preload: () => void;
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
  const mountedRef         = useRef(true);
  const finishFiredRef     = useRef(false);
  const loadTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparedUrlRef     = useRef<string | null>(null);  // URL currently loaded into native player
  const intendingTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading,         setIsLoading]         = useState(false);
  const [isLoadingVisible,  setIsLoadingVisible]  = useState(false);
  const [isPlaying,         setIsPlaying]         = useState(false);
  const [isPaused,          setIsPaused]          = useState(false);
  const [hasCompleted,      setHasCompleted]      = useState(false);
  const [isIntendingToPlay, setIsIntendingToPlay] = useState(false);
  const [hasError,          setHasError]          = useState(false);
  const [errorMessage,      setErrorMessage]      = useState<string | null>(null);

  const playerRef = useRef(createAudioPlayer(null));
  const status    = useAudioPlayerStatus(playerRef.current);

  // ── debounced loading visibility ──
  const setLoadingWithDelay = useCallback((loading: boolean) => {
    if (loadTimerRef.current) {
      clearTimeout(loadTimerRef.current);
      loadTimerRef.current = null;
    }
    if (!loading) {
      setIsLoadingVisible(false);
    } else {
      loadTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setIsLoadingVisible(true);
      }, 300);
    }
  }, []);

  // ── react to url changes ──
  useEffect(() => {
    finishFiredRef.current = false;
    if (intendingTimerRef.current) { clearTimeout(intendingTimerRef.current); intendingTimerRef.current = null; }
    if (mountedRef.current) {
      setIsLoading(false);
      setLoadingWithDelay(false);
      setIsPlaying(false);
      setIsPaused(false);
      setHasCompleted(false);
      setIsIntendingToPlay(false);
      setHasError(false);
      setErrorMessage(null);
    }
    try {
      playerRef.current.replace({ uri: url });
      playerRef.current.pause();
      preparedUrlRef.current = url;
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);  // setLoadingWithDelay is stable (useCallback [])

  // ── react to status changes ──
  useEffect(() => {
    if (!mountedRef.current) return;

    const loading = !status.isLoaded && !status.didJustFinish;
    setIsLoading(loading && !hasError);
    setLoadingWithDelay(loading && !hasError);
    setIsPlaying(status.playing);

    if (status.didJustFinish && !finishFiredRef.current) {
      finishFiredRef.current = true;
      // Clear preparedUrlRef: player is at EOF — next play() must replace/seek
      preparedUrlRef.current = null;
      if (mountedRef.current) {
        setIsPlaying(false);
        setIsPaused(false);
        setIsLoading(false);
        setLoadingWithDelay(false);
        setIsIntendingToPlay(false);
        setHasCompleted(true);
        onFinish();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.isLoaded, status.playing, status.didJustFinish, status.isBuffering]);

  // ── cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      if (intendingTimerRef.current) clearTimeout(intendingTimerRef.current);
      try { playerRef.current.remove(); } catch { /* ignore */ }
    };
  }, []);

  // ── play (from beginning) ──
  const play = useCallback(() => {
    if (!mountedRef.current) return;

    // Optimistic intent: show playing state immediately on tap
    if (intendingTimerRef.current) clearTimeout(intendingTimerRef.current);
    setIsIntendingToPlay(true);
    // Clear after 2s safety net — native status will override sooner in normal cases
    intendingTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setIsIntendingToPlay(false);
    }, 2000);

    setHasError(false);
    setErrorMessage(null);
    setIsPaused(false);
    setHasCompleted(false);
    finishFiredRef.current = false;

    try {
      if (status.playing) {
        // Already playing — seek to beginning and replay (used when re-tapping during play)
        playerRef.current.seekTo(0).then(() => {
          if (mountedRef.current) playerRef.current.play();
        }).catch(() => {
          if (mountedRef.current) playerRef.current.play();
        });
      } else if (preparedUrlRef.current === url) {
        // URL already loaded into player (via preload/url-change) AND player not at EOF
        // Fast path: play directly, no replace needed
        playerRef.current.play();
      } else {
        // Either never loaded or at EOF (preparedUrlRef cleared on completion)
        // Must replace source to reset native player position to 0
        playerRef.current.replace({ uri: url });
        preparedUrlRef.current = url;
        setTimeout(() => {
          if (mountedRef.current) {
            try { playerRef.current.play(); } catch { /* ignore */ }
          }
        }, 80);
      }
      setIsLoading(true);
      setLoadingWithDelay(true);
      setIsPlaying(false);
    } catch {
      if (mountedRef.current) {
        setIsLoading(false);
        setLoadingWithDelay(false);
        setIsPlaying(false);
        setIsIntendingToPlay(false);
        if (intendingTimerRef.current) { clearTimeout(intendingTimerRef.current); intendingTimerRef.current = null; }
        setHasError(true);
        setErrorMessage("Audio indisponible pour l'instant. Réessaie.");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, status.playing, setLoadingWithDelay]);

  // ── pause (in-place — resumes from same position) ──
  const pause = useCallback(() => {
    if (!mountedRef.current) return;
    if (intendingTimerRef.current) { clearTimeout(intendingTimerRef.current); intendingTimerRef.current = null; }
    try { playerRef.current.pause(); } catch { /* ignore */ }
    if (mountedRef.current) {
      setIsPlaying(false);
      setIsIntendingToPlay(false);
      setIsPaused(true);
      setIsLoading(false);
      setLoadingWithDelay(false);
    }
  }, [setLoadingWithDelay]);

  // ── resume (from paused position) ──
  const resume = useCallback(() => {
    if (!mountedRef.current) return;
    setIsPaused(false);
    setIsPlaying(true);
    try { playerRef.current.play(); } catch { /* ignore */ }
  }, []);

  // ── stop (pause + full state reset — next play() starts from beginning) ──
  const stop = useCallback(() => {
    if (!mountedRef.current) return;
    if (intendingTimerRef.current) { clearTimeout(intendingTimerRef.current); intendingTimerRef.current = null; }
    // Clear preparedUrlRef so next play() forces a replace (clean start)
    preparedUrlRef.current = null;
    try { playerRef.current.pause(); } catch { /* ignore */ }
    if (mountedRef.current) {
      setIsPlaying(false);
      setIsIntendingToPlay(false);
      setIsPaused(false);
      setHasCompleted(false);
      setIsLoading(false);
      setLoadingWithDelay(false);
    }
  }, [setLoadingWithDelay]);

  // ── preload ──
  // Silently buffers the audio file so the first play() call starts instantly.
  // Does NOT autoplay, does NOT change visible state, does NOT fire onFinish.
  const preload = useCallback(() => {
    if (!mountedRef.current) return;
    if (preparedUrlRef.current === url) return;  // already prepared — no-op
    try {
      playerRef.current.replace({ uri: url });
      playerRef.current.pause();
      preparedUrlRef.current = url;
    } catch { /* ignore — player may not be ready yet */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── reset (used after error — clears error state, allows retry via play()) ──
  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    stop();
    finishFiredRef.current = false;
    setHasError(false);
    setErrorMessage(null);
  }, [stop]);

  // ── replay ──
  // Restarts from beginning after natural completion.
  // Prefers seekTo(0) on the existing player (no network round-trip).
  // Falls back to replace({uri}) if seekTo fails or player is removed.
  const replay = useCallback(() => {
    if (!mountedRef.current) return;

    // Optimistic intent
    if (intendingTimerRef.current) clearTimeout(intendingTimerRef.current);
    setIsIntendingToPlay(true);
    intendingTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setIsIntendingToPlay(false);
    }, 2000);

    setHasError(false);
    setErrorMessage(null);
    setIsPaused(false);
    setHasCompleted(false);
    finishFiredRef.current = false;
    setIsLoading(true);
    setLoadingWithDelay(true);
    setIsPlaying(false);

    try {
      // seekTo(0) is the fastest path — no source reload, no network
      playerRef.current.seekTo(0)
        .then(() => {
          if (!mountedRef.current) return;
          preparedUrlRef.current = url;
          playerRef.current.play();
        })
        .catch(() => {
          // seekTo failed — fall back to replace+play
          if (!mountedRef.current) return;
          try {
            playerRef.current.replace({ uri: url });
            preparedUrlRef.current = url;
            setTimeout(() => {
              if (mountedRef.current) {
                try { playerRef.current.play(); } catch { /* ignore */ }
              }
            }, 80);
          } catch { /* ignore */ }
        });
    } catch {
      // Synchronous failure — fall back to full replace path
      if (!mountedRef.current) return;
      try {
        playerRef.current.replace({ uri: url });
        preparedUrlRef.current = url;
        setTimeout(() => {
          if (mountedRef.current) {
            try { playerRef.current.play(); } catch { /* ignore */ }
          }
        }, 80);
      } catch {
        setIsLoading(false);
        setLoadingWithDelay(false);
        setIsIntendingToPlay(false);
        if (intendingTimerRef.current) { clearTimeout(intendingTimerRef.current); intendingTimerRef.current = null; }
        setHasError(true);
        setErrorMessage("Audio indisponible pour l'instant. Réessaie.");
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, setLoadingWithDelay]);

  const isIdle     = !isPlaying && !isPaused && !hasCompleted && !isLoading && !hasError;
  const isPreparing = isLoading && isIntendingToPlay;

  return {
    isLoading,
    isLoadingVisible,
    isPlaying,
    isPaused,
    hasCompleted,
    isIntendingToPlay,
    hasError,
    errorMessage,
    isIdle,
    isPreparing,
    play,
    replay,
    pause,
    resume,
    stop,
    reset,
    preload,
  };

  // ── State machine summary ──────────────────────────────────────────────────
  // idle:       !isPlaying && !isPaused && !hasCompleted && !isLoading && !hasError
  // preparing:  isLoading (isLoadingVisible after 300ms debounce)
  //             isIntendingToPlay = true immediately on tap (optimistic)
  // playing:    isPlaying
  // paused:     isPaused
  // completed:  hasCompleted (natural finish — preparedUrlRef cleared)
  // error:      hasError
  //
  // play()  from idle/completed/error: replace source if needed, seekTo(0) if playing
  // pause() from playing:              in-place pause, sets isPaused
  // resume()from paused:               continue from same position
  // stop()  from any:                  full reset, clears preparedUrlRef
  // replay: hasCompleted → tap → play() → preparedUrlRef=null → replace path → instant
}