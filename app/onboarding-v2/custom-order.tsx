import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, StatusBar,
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

// ─── 'custom_order' mode branch: pick surahs + their exact order ──────────
// Faithful port of the historical 'customOrderPicker' step into onboarding-v2.
// Reordering uses tap-to-add / tap-to-remove (order badges show the current
// position) — no drag-and-drop library exists in this project (verified:
// no reanimated/gesture-handler/drag dependency in package.json), so no new
// native dependency is introduced.

const SPLASH_BEIGE = '#F7F2E7';
const SPLASH_GREEN = '#163026';
const MUTED        = '#7C7365';
const BORDER       = 'rgba(22,48,38,0.14)';

const JUZ_AMMA_SURAH_NUMS = ZAINLY_ORDER
  .filter(s => s.surah >= 78 && s.surah <= 114)
  .map(s => s.surah);

const TOTAL_SURAHS = ZAINLY_ORDER.length;

export default function OnboardingCustomOrderScreen() {
  const [draftChecked, setDraftChecked] = useState(false);
  const [customOrder, setCustomOrder] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);

  const { owner: draftOwner } = useDraftOwner();

  useEffect(() => {
    if (!draftOwner) return;
    let cancelled = false;
    readOnboardingDraftForOwner(draftOwner).then(draft => {
      if (cancelled) return;
      if (!draft?.firstName) { router.replace('/onboarding-v2/name'); return; }
      if (draft.learningMode !== 'custom_order') {
        router.replace('/onboarding-v2/learning-mode');
        return;
      }
      setCustomOrder(draft.customSurahOrder);
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

  function toggleCustom(surahNum: number) {
    hapticSelection();
    setShowIncompleteWarning(false);
    setCustomOrder(prev =>
      prev.includes(surahNum) ? prev.filter(n => n !== surahNum) : [...prev, surahNum]
    );
  }

  function applyJuzAmma() {
    hapticSelection();
    setShowIncompleteWarning(false);
    setCustomOrder(JUZ_AMMA_SURAH_NUMS);
  }

  function resetOrder() {
    hapticSelection();
    setShowIncompleteWarning(false);
    setCustomOrder([]);
  }

  function handleBack() {
    router.replace(QUESTIONNAIRE_BACK_TARGETS.custom_order_picker!);
  }

  function handleContinueAttempt() {
    if (customOrder.length !== TOTAL_SURAHS) {
      hapticWarning();
      setShowIncompleteWarning(true);
    }
  }

  async function handleContinue() {
    if (!draftOwner) return;
    hapticLight();
    // Explicit, not implicit: the user has just assigned a position to all
    // 114 surahs, so there is no "rest of the Quran" left to append after
    // their order. continueWithRest must be false here — never silently
    // inherit the draft's default `true` (see computePlan's custom_order
    // branch, src/core/planEngine.ts), even though a full-114 selection
    // already makes that flag mathematically inert (validCustomSet already
    // covers every surah, so the 'true' branch's appended-rest is always
    // empty). Being explicit removes any dependency on that invariant.
    await updateOnboardingDraftForOwner(draftOwner, {
      currentStep: 'known_surahs', customSurahOrder: customOrder, continueWithRest: false,
    });
    setSearch('');
    router.push('/onboarding-v2/known-surahs');
  }

  const renderItem = useCallback(({ item }: { item: typeof ZAINLY_ORDER[number] }) => {
    const orderIdx = customOrder.indexOf(item.surah);
    return (
      <SurahListRow
        entry={item}
        selected={orderIdx !== -1}
        orderIndex={orderIdx !== -1 ? orderIdx + 1 : undefined}
        onPress={toggleCustom}
      />
    );
  }, [customOrder]);

  const listHeader = (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>ORDRE PERSONNALISÉ</Text>
      <Text style={styles.title}>Choisis ton ordre.</Text>
      <Text style={styles.subtitle}>
        Sélectionne les sourates dans l'ordre où tu veux les mémoriser. Le chiffre indique la position.
      </Text>

      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickBtn}
          onPress={applyJuzAmma}
          accessibilityRole="button"
          accessibilityLabel="Démarrer depuis le Juz Amma"
        >
          <Text style={styles.quickBtnText}>Juz Amma</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, styles.quickBtnReset]}
          onPress={resetOrder}
          accessibilityRole="button"
          accessibilityLabel="Réinitialiser l'ordre"
        >
          <Text style={[styles.quickBtnText, styles.quickBtnResetText]}>Réinitialiser</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.infoText, showIncompleteWarning && customOrder.length !== TOTAL_SURAHS && styles.infoTextError]}>
        Sélectionne les 114 sourates dans l'ordre où tu souhaites les mémoriser.
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
            currentStep={phaseStepNumber('custom_order_picker')}
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
            {/* accessible={false}: only the inner OnboardingBottomAction must be
                exposed to screen readers — this wrapper exists purely to catch
                taps that the inner disabled button refuses to claim as
                responder (RN disabled Touchables don't claim the responder,
                so the tap bubbles up here), never as a second a11y control. */}
            <TouchableOpacity activeOpacity={1} onPress={handleContinueAttempt} accessible={false}>
              <OnboardingBottomAction
                label={`Continuer (${customOrder.length}/${TOTAL_SURAHS})`}
                disabled={customOrder.length !== TOTAL_SURAHS}
                onPress={handleContinue}
              />
            </TouchableOpacity>
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
    borderColor: BORDER,
  },
  quickBtnReset: {
    borderColor: 'rgba(159,49,29,0.24)',
  },
  quickBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
  },
  quickBtnResetText: {
    color: '#7A2A18',
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    marginBottom: 12,
  },
  infoTextError: {
    color: '#7A2A18',
    fontWeight: '600',
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
