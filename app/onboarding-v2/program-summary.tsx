import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Animated, Easing, StatusBar, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { hapticLight } from '@/utils/haptics';
import { useAuthStore } from '@/store/authStore';
import {
  readOnboardingDraftForOwner,
  draftKeyForOwner,
  type LearningMode,
  type OnboardingDraftOwner,
} from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import { computePlan, isPlanError, PlanResult } from '@/core/planEngine';
import {
  buildPlanInputFromDraft, isPlanValidationError, routeForOnboardingStep,
  PENDING_SIGNUP_USER_ID,
} from '@/lib/onboardingPlanValidation';
import {
  savePendingOnboardingPlan, saveActiveOnboardingAuthFlow, setSessionAuthFlowId,
  saveGuestDraftHandoff, claimGuestDraftWithHandoff,
} from '@/lib/pendingOnboardingPlan';
import { orchestrateAuthedFinalize } from '@/lib/programSummaryOrchestration';
import { createSubmissionLock } from '@/lib/submissionLock';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, PROGRAM_SUMMARY_BACK_TARGET,
} from '@/lib/onboardingQuestionnaire';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';
const GOLD_DARK    = '#9F7628';
const CARD_CREAM   = '#FFFDF7';
const CARD_BORDER  = 'rgba(22,48,38,0.10)';

const LEARNING_MODE_LABEL: Record<LearningMode, string> = {
  recommended:  'Parcours recommandé',
  start_surah:  'Sourate de départ personnalisée',
  custom_order: 'Ordre personnalisé',
};

interface SummaryCard {
  key: string;
  label: string;
  value: string;
}

// ─── program-summary — the payoff screen. Every card below is built only
// from real computePlan() output or real draft answers — never invented,
// never shown if the backing data isn't actually available (e.g. no
// "révisions préparées" card exists because computePlan() does not produce
// a revision schedule; adding one here would be a fabricated number). ─────
export default function OnboardingProgramSummaryScreen() {
  const { session } = useAuthStore();
  const queryClient = useQueryClient();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [ready, setReady] = useState(false);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [learningMode, setLearningMode] = useState<LearningMode | null>(null);
  const [knownCount, setKnownCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const submissionLock = useRef(createSubmissionLock());
  const currentOwnerKeyRef = useRef<string | null>(null);
  const draftOwnerRef = useRef<OnboardingDraftOwner | null>(null);

  // ── Compute draft owner ──
  const { owner: draftOwner, sourceGuestFlowId } = useDraftOwner();
  const ownerKey = draftOwner ? draftKeyForOwner(draftOwner) : null;
  draftOwnerRef.current = draftOwner;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => { if (mountedRef.current) setReduceMotion(v); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    currentOwnerKeyRef.current = ownerKey;

    // Clear owner-derived state immediately on owner change so stale
    // data from a previous owner is never visible.
    setPlanResult(null);
    setLearningMode(null);
    setKnownCount(0);
    setReady(false);

    if (!ownerKey) {
      setReady(true);
      return () => { active = false; };
    }

    const owner = draftOwnerRef.current;
    if (!owner) {
      setReady(true);
      return () => { active = false; };
    }

    void (async () => {
      const draft = await readOnboardingDraftForOwner(owner);
      if (!active) return;
      if (currentOwnerKeyRef.current !== ownerKey) return;

      if (!draft) {
        router.replace('/onboarding-v2/known-surahs');
        return;
      }
      const validation = buildPlanInputFromDraft(draft, PENDING_SIGNUP_USER_ID);
      if (isPlanValidationError(validation)) {
        router.replace(routeForOnboardingStep(validation.missingStep));
        return;
      }
      const result = computePlan(validation.planInput);
      if (isPlanError(result)) {
        router.replace('/onboarding-v2/discovery-source');
        return;
      }
      setPlanResult(result);
      setLearningMode(draft.learningMode);
      setKnownCount(draft.knownSurahs.length);
      setReady(true);
    })();

    return () => { active = false; };
  }, [ownerKey]);

  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY        = useRef(new Animated.Value(12)).current;
  const cardsOpacity  = useRef(new Animated.Value(0)).current;
  const cardsY        = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (!ready) return;
    if (reduceMotion) {
      titleOpacity.setValue(1); titleY.setValue(0);
      cardsOpacity.setValue(1); cardsY.setValue(0);
      return;
    }
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 300, easing: E, useNativeDriver: true }),
      Animated.timing(titleY,       { toValue: 0, duration: 300, easing: E, useNativeDriver: true }),
      Animated.timing(cardsOpacity, { toValue: 1, duration: 280, delay: 140, easing: E, useNativeDriver: true }),
      Animated.timing(cardsY,       { toValue: 0, duration: 280, delay: 140, easing: E, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, reduceMotion]);

  function handleBack() {
    router.replace(PROGRAM_SUMMARY_BACK_TARGET);
  }

  async function handleContinue() {
    if (!submissionLock.current.acquire()) return;
    setSaveError(null);
    hapticLight();

    // The lock is released only on recoverable failures. After successful
    // navigation, the lock is intentionally NOT released — the screen
    // unmounts and the ref is garbage-collected, destroying the lock
    // naturally. This prevents a second call from firing between
    // router.replace() and the actual unmount.
    //
    // If navigation itself throws, the catch block releases the lock so
    // the user can retry.
    let navigated = false;

    try {
      // Re-read the full draft for this owner — the draft is the source of
      // truth for this write, it just isn't durable past this exact point.
      if (!draftOwner) {
        setSaveError("Ton programme n'a pas pu être préparé. Reviens en arrière et réessaie.");
        return;
      }
      const draft = await readOnboardingDraftForOwner(draftOwner);
      if (!draft || !draft.learningMode) {
        setSaveError("Ton programme n'a pas pu être préparé. Reviens en arrière et réessaie.");
        return;
      }

      // ── Authenticated user path — finalize directly, no signup needed ──
      // An authenticated user without a plan reached V2 from the dashboard
      // CTA. The draft is in AsyncStorage under the user's key, so
      // finalizeOnboardingV2Plan reads it directly (no pending payload,
      // no authHandoff, no flowId required).
      const authedUserId = session?.user?.id;
      if (authedUserId) {
        // ── Claim the guest draft for this authenticated user ──────────
        // The claim is authorized ONLY when a CompletedAuthProofV1 exists
        // in AsyncStorage, proving that a Supabase authentication result
        // confirmed this exact user for this exact onboarding transaction.
        // The proof is created by runOnboardingTransition() after successful
        // auth — never before. It is read internally by
        // claimGuestDraftWithHandoff from its own AsyncStorage key, never
        // passed from the caller.
        //
        // A direct Google/Apple/email login without onboarding context
        // invalidates stale onboarding authorization → no proof → no claim.
        //
        // sourceGuestFlowId from useDraftOwner provides the guest draft
        // flowId to claim, but does NOT authorize the claim itself.
        if (sourceGuestFlowId) {
          const claimResult = await claimGuestDraftWithHandoff(
            authedUserId,
            sourceGuestFlowId,
            () => useAuthStore.getState().session?.user?.id,
          );
          if (!claimResult.ok) {
            setSaveError('Une erreur est survenue. Redémarre l\'onboarding.');
            return;
          }
        }

        const result = await orchestrateAuthedFinalize(
          queryClient,
          authedUserId,
          {
            getSessionUserId: () => useAuthStore.getState().session?.user?.id,
            invalidateNonCritical: (qc, uid) => {
              qc.invalidateQueries({ queryKey: ['dueReviews', uid] });
              qc.invalidateQueries({ queryKey: ['profile', uid] });
              qc.invalidateQueries({ queryKey: ['pendingOnboarding', uid] });
            },
          },
        );

        switch (result.status) {
          case 'finalize_failed':
            setSaveError(result.message ?? 'Impossible de créer ton programme. Réessaie.');
            return;
          case 'session_changed':
            return;
          case 'superseded':
            return;
          case 'handoff_failed':
            setSaveError("Ton programme est enregistré mais n'a pas pu être chargé. Réessaie.");
            return;
          case 'draft_owner_mismatch':
            setSaveError('Une erreur est survenue. Redémarre l\'onboarding.');
            return;
          case 'navigate':
          case 'navigate_clear_failed':
            // Draft is cleared by orchestrateAuthedFinalize — no need to clear here.
            try {
              router.replace('/(app)/(tabs)');
              navigated = true;
            } catch {
              setSaveError('Erreur de navigation. Réessaie.');
            }
            return;
        }
      }

      // ── Pre-auth path — save pending plan, navigate to signup ──
      // From this exact moment, the program must survive an app kill or a
      // Supabase email-confirmation detour — durably save it BEFORE leaving
      // for signup, never before this validated point.
      const saved = await savePendingOnboardingPlan({
        firstName: draft.firstName,
        learningMode: draft.learningMode,
        knownSurahs: draft.knownSurahs,
        startingSurah: draft.startingSurah,
        customSurahOrder: draft.customSurahOrder,
        continueWithRest: draft.continueWithRest,
        notificationPreference: draft.notificationPreference,
        discoverySource: draft.discoverySource,
      });

      if (!saved.ok) {
        setSaveError('Impossible d’enregistrer ton programme pour le moment. Réessaie.');
        return;
      }

      // Real signup/login flow — the only place a real userId can be
      // produced. onboardingFinalize.ts recomputes + persists the identical
      // plan right after a real session exists (from the draft if it is
      // still alive, otherwise from the payload just saved above), then
      // routes to the real, auth-protected dashboard.
      // Persist the active auth flow marker to AsyncStorage so the claim
      // can succeed after a cold start (app killed between here and auth).
      // Also set the in-memory session var as same-session fast path.
      await saveActiveOnboardingAuthFlow(saved.flowId);
      setSessionAuthFlowId(saved.flowId);
      // Write the guest-draft handoff envelope — binds the pending plan
      // transactionFlowId to the exact guest draft flowId. This is the
      // durable proof that the current authentication originated from
      // this specific guest onboarding parcours. Without it, a stale
      // guest flowId cannot authorize a draft claim after auth.
      if (sourceGuestFlowId) {
        await saveGuestDraftHandoff(saved.flowId, sourceGuestFlowId);
      }
      // flowId is passed explicitly so each auth route can supply it as
      // proof of the originating parcours — prevents a Welcome login from
      // claiming a pending payload.
      try {
        router.push(`/(auth)/signup-methods?context=onboarding&flowId=${encodeURIComponent(saved.flowId)}`);
        navigated = true;
      } catch {
        setSaveError('Erreur de navigation. Réessaie.');
      }
    } finally {
      // Only release the lock if we did NOT navigate. After successful
      // navigation, the screen unmounts and the lock is destroyed with
      // the ref — no second call can fire.
      if (!navigated) {
        submissionLock.current.release();
      }
    }
  }

  if (!ready || !planResult) {
    return <View style={styles.root} />;
  }

  const { computed, planPayload } = planResult;

  const cards: SummaryCard[] = [];
  cards.push({
    key: 'start',
    label: 'Point de départ',
    value: computed.startAyah > 1
      ? `${computed.firstSurahName}, à partir du verset ${computed.startAyah}`
      : computed.firstSurahName,
  });
  if (learningMode) {
    cards.push({ key: 'mode', label: 'Mode choisi', value: LEARNING_MODE_LABEL[learningMode] });
  }
  if (knownCount > 0) {
    cards.push({
      key: 'known',
      label: 'Sourates déjà connues',
      value: `${knownCount} sourate${knownCount > 1 ? 's' : ''}`,
    });
  }
  cards.push({ key: 'pace', label: 'Rythme quotidien', value: planPayload.pace_label });
  cards.push({
    key: 'first_session',
    label: 'Première séance',
    value: `${planPayload.ayah_per_day} ayat de ${computed.firstSurahName}`,
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>

          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('program_summary')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Animated.Text
              style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}
            >
              Ton programme est prêt.
            </Animated.Text>
            <Animated.Text style={[styles.subtitle, { opacity: titleOpacity }]}>
              Tu peux maintenant commencer ton Hifz avec un parcours construit à partir de tes réponses.
            </Animated.Text>

            <Animated.View style={[styles.cardsList, { opacity: cardsOpacity, transform: [{ translateY: cardsY }] }]}>
              {cards.map(card => (
                <View key={card.key} style={styles.card}>
                  <Text style={styles.cardLabel}>{card.label}</Text>
                  <Text style={styles.cardValue}>{card.value}</Text>
                </View>
              ))}
            </Animated.View>
          </ScrollView>

          <View style={styles.ctaOuter}>
            {saveError && <Text style={styles.saveError}>{saveError}</Text>}
            <OnboardingBottomAction label="Commencer mon Hifz" onPress={handleContinue} />
          </View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BEIGE },
  safe: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 24, paddingBottom: 10 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingVertical: 12 },

  title: {
    fontSize: 23, fontWeight: '700', color: SPLASH_GREEN,
    textAlign: 'center', lineHeight: 30, marginBottom: 8,
  },
  subtitle: {
    fontSize: 14.5, color: SPLASH_GREEN, opacity: 0.65,
    textAlign: 'center', lineHeight: 21, marginBottom: 26, paddingHorizontal: 6,
  },

  cardsList: { gap: 10 },
  card: {
    backgroundColor: CARD_CREAM, borderRadius: 14,
    borderWidth: 1, borderColor: CARD_BORDER,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  cardLabel: { fontSize: 11.5, color: SPLASH_GREEN, opacity: 0.55, marginBottom: 4, fontWeight: '600' },
  cardValue: { fontSize: 15, color: GOLD_DARK, fontWeight: '700' },

  ctaOuter: { width: '100%', paddingTop: 16 },
  saveError: {
    fontSize: 13, color: '#B91C1C', textAlign: 'center',
    lineHeight: 18, marginBottom: 10,
  },
});
