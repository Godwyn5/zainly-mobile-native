import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hapticLight, hapticSelection, hapticWarning } from '@/utils/haptics';
import { readOnboardingDraftForOwner, updateOnboardingDraftForOwner } from '@/lib/onboardingDraft';
import { useDraftOwner } from '@/hooks/useDraftOwner';
import { TOTAL_ONBOARDING_PHASES, phaseStepNumber, QUESTIONNAIRE_BACK_TARGETS } from '@/lib/onboardingQuestionnaire';
import { ZAINLY_ORDER } from '@/core/planEngine';
import OnboardingQuestionHeader from '@/components/onboarding/OnboardingQuestionHeader';
import OnboardingBottomAction from '@/components/onboarding/OnboardingBottomAction';
import SurahListRow from '@/components/onboarding/SurahListRow';

// ─── 'start_surah' mode branch: pick a single starting surah ──────────────
// Faithful port of the historical 'startSurahPicker' step into onboarding-v2.

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';
const MUTED        = '#7C7365';
const BORDER       = 'rgba(22,48,38,0.14)';

export default function OnboardingStartSurahScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [startingSurah, setStartingSurah] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) { router.replace('/onboarding-v2/name'); return; }
      if (draft.learningMode !== 'start_surah') {
        router.replace('/onboarding-v2/learning-mode');
        return;
      }
      setStartingSurah(draft.startingSurah);
      setDraftChecked(true);
    });
    return () => { cancelled = true; };

  }, [draftOwner]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredSurahs = useMemo(() => {
    if (!normalizedSearch) return ZAINLY_ORDER;
    return ZAINLY_ORDER.filter(s =>
      s.name.toLowerCase().includes(normalizedSearch) || String(s.surah).includes(normalizedSearch)
    );
  }, [normalizedSearch]);

  function pickStartingSurah(surahNum: number) {
    hapticSelection();
    setStartingSurah(surahNum);
  }

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.start_surah_picker!);
  }

  async function handleContinue() {
    if (!startingSurah) { hapticWarning(); return; }
    if (!draftOwner) return;
    hapticLight();
    // Invariant mirrored from the historical onboarding: the starting
    // surah must never also be marked as known.
    const draft = await readOnboardingDraftForOwner(draftOwner);
    const sanitizedKnown = (draft?.knownSurahs ?? []).filter(n => n !== startingSurah);
    await updateOnboardingDraftForOwner(draftOwner, {
      currentStep: 'known_surahs', startingSurah, knownSurahs: sanitizedKnown,
    });
    setSearch('');
    router.push('/onboarding-v2/known-surahs');
  }

  const renderItem = useCallback(({ item }: { item: typeof ZAINLY_ORDER[number] }) => (
    <SurahListRow entry={item} selected={startingSurah === item.surah} onPress={pickStartingSurah} />
  ), [startingSurah]);

  const listHeader = (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>POINT DE DÉPART</Text>
      <Text style={styles.title}>Par quelle sourate veux-tu commencer ?</Text>
      <Text style={styles.subtitle}>
        Choisis ton point de départ. Zainly construira ensuite le reste du programme.
      </Text>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher une sourate…"
          placeholderTextColor={MUTED}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Rechercher une sourate"
        />
      </View>
    </View>
  );

  if (!draftChecked) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE} translucent={false} />
      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>
          <OnboardingQuestionHeader
            currentStep={phaseStepNumber('start_surah_picker')}
            totalSteps={TOTAL_ONBOARDING_PHASES}
            onBack={handleBack}
          />
          <FlatList
            data={filteredSurahs}
            keyExtractor={item => String(item.surah)}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
          <View style={styles.ctaWrap}>
            <OnboardingBottomAction
              label="Continuer"
              disabled={!startingSurah}
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
  searchWrap: {
    marginBottom: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: SPLASH_GREEN,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  ctaWrap: {
    paddingTop: 10,
    paddingBottom: 14,
  },
});
