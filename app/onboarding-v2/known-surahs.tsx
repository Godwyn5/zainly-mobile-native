import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight, hapticSelection, hapticWarning } from '@/utils/haptics';
import { readOnboardingDraftForOwner, updateOnboardingDraftForOwner, LearningMode } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import {
  TOTAL_ONBOARDING_PHASES, phaseStepNumber, knownSurahsBackTarget,
} from '@/lib/onboardingQuestionnaire';
import {
  buildPlanInputFromDraft, isPlanValidationError, routeForOnboardingStep,
} from '@/lib/onboardingPlanValidation';
import { ZAINLY_ORDER } from '@/core/planEngine';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';
import SurahListRow from '@/components/onboarding/SurahListRow';

// ─── Common question, reached by all 3 learning modes ─────────────────────
// Faithful port of the historical 'knownSurahs' step (app/onboarding/
// index.tsx) into the onboarding-v2 visual language. Same invariants:
// the starting surah (start_surah mode) can never be marked as known, and
// marking every single surah as known is rejected (nothing left to learn).

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';
const MUTED        = '#7C7365';
const WARNING_TEXT  = '#7A2A18';

const JUZ_AMMA_SURAH_NUMS = ZAINLY_ORDER
  .filter(s => s.surah >= 78 && s.surah <= 114)
  .map(s => s.surah);

export default function OnboardingKnownSurahsScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [learningMode, setLearningMode] = useState<LearningMode | null>(null);
  const [startingSurah, setStartingSurah] = useState<number | null>(null);
  const [knownSurahs, setKnownSurahs] = useState<number[]>([]);

  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) { router.replace('/onboarding-v2/name'); return; }
      if (!draft.learningMode) { router.replace('/onboarding-v2/learning-mode'); return; }
      if (draft.learningMode === 'start_surah' && draft.startingSurah == null) {
        router.replace('/onboarding-v2/start-surah');
        return;
      }
      if (draft.learningMode === 'custom_order' && draft.customSurahOrder.length === 0) {
        router.replace('/onboarding-v2/custom-order');
        return;
      }
      setLearningMode(draft.learningMode);
      setStartingSurah(draft.startingSurah);
      setKnownSurahs(draft.knownSurahs);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  const allKnownSelected = knownSurahs.length === ZAINLY_ORDER.length;
  const juzAmmaFullySelected = JUZ_AMMA_SURAH_NUMS.every(n => knownSurahs.includes(n));

  function toggleKnown(surahNum: number) {
    if (learningMode === 'start_surah' && surahNum === startingSurah) return;
    hapticSelection();
    setKnownSurahs(prev =>
      prev.includes(surahNum) ? prev.filter(n => n !== surahNum) : [...prev, surahNum]
    );
  }

  function selectJuzAmma() {
    hapticSelection();
    setKnownSurahs(prev => {
      const merged = new Set([...prev, ...JUZ_AMMA_SURAH_NUMS]);
      return [...merged];
    });
  }

  function clearKnown() {
    hapticSelection();
    setKnownSurahs([]);
  }

  function handleBack() {
    router.replace(knownSurahsBackTarget(learningMode));
  }

  const renderItem = useCallback(({ item }: { item: typeof ZAINLY_ORDER[number] }) => {
    const isStarting = learningMode === 'start_surah' && item.surah === startingSurah;
    return (
      <SurahListRow
        entry={item}
        selected={knownSurahs.includes(item.surah)}
        onPress={toggleKnown}
        disabled={isStarting}
        disabledLabel={isStarting ? 'Sourate de départ' : undefined}
      />
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningMode, startingSurah, knownSurahs]);

  async function handleContinue() {
    if (allKnownSelected) { hapticWarning(); return; }
    if (!draftOwner) return;
    hapticLight();
    const draft = await updateOnboardingDraftForOwner(draftOwner, { currentStep: 'experience_choice', knownSurahs });
    // Last common gate before leaving the block — same completeness check
    // as experience-choice.tsx, defensive against any UI bug upstream.
    const check = buildPlanInputFromDraft(draft, 'pending-signup');
    if (isPlanValidationError(check) && check.missingStep !== 'first_name') {
      router.replace(routeForOnboardingStep(check.missingStep));
      return;
    }
    router.push('/onboarding-v2/experience-choice');
  }

  const listHeader = useMemo(() => (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>ACQUIS</Text>
      <Text style={styles.title}>Quelles sourates maîtrises-tu déjà ?</Text>
      <Text style={[styles.subtitle, styles.subtitleTight]}>
        Coche uniquement les sourates que tu sais déjà réciter correctement.
      </Text>
      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={clearKnown}
          accessibilityRole="button"
          accessibilityLabel="Aucune sourate connue"
        >
          <Text style={[styles.quickBtnText, knownSurahs.length === 0 && styles.quickBtnActive]}>
            Aucune
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={selectJuzAmma}
          accessibilityRole="button"
          accessibilityLabel="Sélectionner le Juz Amma, sourates 78 à 114"
        >
          <Text style={[styles.quickBtnText, juzAmmaFullySelected && styles.quickBtnActive]}>
            Juz Amma (78–114)
          </Text>
        </TouchableOpacity>
      </View>
      {allKnownSelected && (
        <Text style={styles.errorText}>
          Tu as indiqué maîtriser toutes les sourates. Choisis au moins une sourate à travailler.
        </Text>
      )}
      {knownSurahs.length > 0 && !allKnownSelected && (
        <Text style={styles.countText}>
          {knownSurahs.length} sourate{knownSurahs.length > 1 ? 's' : ''} sélectionnée{knownSurahs.length > 1 ? 's' : ''}
        </Text>
      )}
    </View>
  ), [knownSurahs, allKnownSelected, juzAmmaFullySelected]);

  if (!draftChecked) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>
          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('known_surahs')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />
          <FlatList
            data={ZAINLY_ORDER}
            keyExtractor={item => String(item.surah)}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
          <View style={styles.ctaWrap}>
            <OnboardingBottomAction
              label={knownSurahs.length > 0 ? `Continuer (${knownSurahs.length} connues)` : 'Continuer'}
              disabled={allKnownSelected}
              onPress={handleContinue}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: SPLASH_BEIGE },
  safe: { flex: 1 },
  shell: { flex: 1, paddingHorizontal: 24 },
  listContent: { paddingBottom: 12 },
  header: { paddingTop: 8, paddingBottom: 4 },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: MUTED,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: SPLASH_GREEN,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14.5,
    lineHeight: 20,
    color: MUTED,
    marginBottom: 12,
  },
  subtitleTight: {
    marginBottom: 8,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  quickBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(22,48,38,0.14)',
  },
  quickBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
  },
  quickBtnActive: {
    color: SPLASH_GREEN,
  },
  errorText: {
    fontSize: 13,
    color: WARNING_TEXT,
    fontWeight: '600',
    marginBottom: 10,
  },
  countText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
    marginBottom: 10,
  },
  ctaWrap: {
    paddingTop: 10,
    paddingBottom: 14,
  },
});
