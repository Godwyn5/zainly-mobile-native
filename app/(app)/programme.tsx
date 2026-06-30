import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Animated, Easing,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { usePlan } from '@/hooks/usePlan';
import { updateProgramMode, type UpdateProgramModeResult } from '@/db/plans';
import {
  ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH,
  type PlanMode,
} from '@/core/planEngine';
import { getSurahName } from '@/data/quran';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

// ─── Mode definitions (exact labels from onboarding) ──────────────────────────

type ModeDefinition = {
  id: PlanMode;
  label: string;
  desc: string;
  helper: string;
};

const MODES: ModeDefinition[] = [
  {
    id: 'recommended',
    label: 'Recommandé par Zainly',
    desc: 'Zainly organisera la suite à partir de ta position actuelle.',
    helper: 'Idéal si tu veux être guidé sans tout organiser toi-même.',
  },
  {
    id: 'start_surah',
    label: 'Choisir ma sourate de départ',
    desc: 'Choisis la sourate à partir de laquelle Zainly doit reprendre.',
    helper: 'Zainly organisera tes prochaines sessions à partir de cette sourate.',
  },
  // custom_order is intentionally omitted from this screen.
  // Editing a custom order requires a dedicated editor (future feature).
  // It remains fully available in onboarding.
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function surahDisplayName(surah: number): string {
  return getSurahName(surah) ?? `Sourate ${surah}`;
}

// ─── ModeCard ─────────────────────────────────────────────────────────────────

function ModeCard({
  mode, selected, onPress, isCurrent,
}: {
  mode: ModeDefinition;
  selected: boolean;
  onPress: (id: PlanMode) => void;
  isCurrent: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        p.card,
        selected && p.cardSelected,
        pressed && !selected && p.cardPressed,
      ]}
      onPress={() => onPress(mode.id)}
    >
      <View style={p.cardHeader}>
        <View style={[p.radio, selected && p.radioSelected]}>
          {selected && <View style={p.radioDot} />}
        </View>
        <Text style={[p.cardLabel, selected && p.cardLabelSelected]}>
          {mode.label}
        </Text>
        {isCurrent && !selected && (
          <View style={p.currentBadge}>
            <Text style={p.currentBadgeText}>Actuel</Text>
          </View>
        )}
      </View>
      <Text style={p.cardDesc}>{mode.desc}</Text>
      <Text style={p.cardHelper}>{mode.helper}</Text>
    </Pressable>
  );
}

// ─── SurahPicker — simple scrollable list ─────────────────────────────────────

function SurahPicker({
  selected, onSelect,
}: {
  selected: number | null;
  onSelect: (surah: number) => void;
}) {
  return (
    <View style={sp.wrap}>
      <Text style={sp.title}>Sourate de départ</Text>
      <Text style={sp.sub}>Zainly reprendra tes prochaines sessions à partir de cette sourate.</Text>
      <ScrollView style={sp.list} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {ZAINLY_ORDER.map((entry) => {
          const active = selected === entry.surah;
          return (
            <Pressable
              key={entry.surah}
              style={({ pressed }) => [
                sp.row,
                active && sp.rowActive,
                pressed && !active && sp.rowPressed,
              ]}
              onPress={() => onSelect(entry.surah)}
            >
              <Text style={[sp.surahName, active && sp.surahNameActive]}>
                {surahDisplayName(entry.surah)}
              </Text>
              <Text style={[sp.surahMeta, active && sp.surahMetaActive]}>
                {entry.ayahs} ayats
              </Text>
              {active && <View style={sp.activeDot} />}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── ProgrammeScreen ──────────────────────────────────────────────────────────

export default function ProgrammeScreen() {
  const insets    = useSafeAreaInsets();
  const userId    = useAuthStore(s => s.user?.id);
  const qc        = useQueryClient();
  const { data: plan, isLoading: planLoading } = usePlan(userId);

  const currentMode = (plan?.plan_mode ?? null) as PlanMode | null;

  // ── Selection state
  const [selectedMode,    setSelectedMode]    = useState<PlanMode | null>(null);
  const [pickerSurah,     setPickerSurah]     = useState<number | null>(null);
  const [showSurahPicker, setShowSurahPicker] = useState(false);

  // ── Save state
  const [isSaving,    setIsSaving]    = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 380,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // When plan loads, reset selection to current (to detect changes)
  useEffect(() => {
    if (currentMode !== null) setSelectedMode(null);
  }, [currentMode]);

  const handleModePress = useCallback((id: PlanMode) => {
    setSaveError(null);
    setSaveSuccess(false);
    if (id === selectedMode) {
      setSelectedMode(null);
      setShowSurahPicker(false);
      return;
    }
    setSelectedMode(id);
    setShowSurahPicker(id === 'start_surah');
    if (id !== 'start_surah') setPickerSurah(null);
  }, [selectedMode]);

  const handleSurahSelect = useCallback((surah: number) => {
    setPickerSurah(surah);
    setSaveError(null);
  }, []);

  // ── CTA validation
  const isSameMode     = selectedMode === currentMode;
  const needsSurahPick = selectedMode === 'start_surah';
  const surahOk        = !needsSurahPick || (pickerSurah != null && ZAINLY_INDEX_BY_SURAH[pickerSurah] != null);
  const canSave        = selectedMode !== null && !isSameMode && surahOk && !isSaving;

  const handleSave = useCallback(async () => {
    if (!canSave || !userId || !selectedMode) return;
    setIsSaving(true);
    setSaveError(null);

    const result: UpdateProgramModeResult = await updateProgramMode({
      userId,
      mode:       selectedMode,
      startSurah: selectedMode === 'start_surah' ? pickerSurah! : undefined,
    });

    setIsSaving(false);

    if (result.error) {
      // If planUpdated is true, plan saved but progress pointer failed — show warning, not error card
      setSaveError(result.error.message);
      // Even on partial success, invalidate plan cache so UI reflects saved plan_mode
      if (result.planUpdated) {
        void qc.invalidateQueries({ queryKey: ['plan', userId] });
      }
      return;
    }

    // Full success — invalidate plan and progress so session/today update immediately
    void qc.invalidateQueries({ queryKey: ['plan',     userId] });
    void qc.invalidateQueries({ queryKey: ['progress', userId] });

    setSaveSuccess(true);
    setSelectedMode(null);
    setPickerSurah(null);
    setShowSurahPicker(false);
  }, [canSave, userId, selectedMode, pickerSurah, qc]);

  // ── UI
  if (!userId) {
    return (
      <View style={s.centered}>
        <Text style={s.errorText}>Session expirée. Reconnecte-toi.</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header bar ── */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Text style={s.backText}>‹ Retour</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <Animated.View style={{ opacity: fadeAnim }}>

          {/* ── Title ── */}
          <Text style={s.eyebrow}>PROGRAMME</Text>
          <Text style={s.title}>Réorganiser mon programme</Text>
          <Text style={s.subtitle}>Choisis comment Zainly doit organiser tes prochaines sessions.</Text>

          {/* ── History preservation notice ── */}
          <View style={s.noticeCard}>
            <Text style={s.noticeText}>
              Ton historique reste conservé. Tes ayats appris, tes révisions et ta progression ne seront pas supprimés.
            </Text>
            <Text style={s.noticeHint}>
              Ce changement s'appliquera à tes prochaines sessions.
            </Text>
          </View>

          {/* ── Loading plan ── */}
          {planLoading && (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          )}

          {/* ── Plan not found ── */}
          {!planLoading && !plan && (
            <View style={s.errorCard}>
              <Text style={s.errorText}>Impossible de charger ton programme.</Text>
            </View>
          )}

          {/* ── Mode cards ── */}
          {plan && (
            <View style={s.modesWrap}>
              {MODES.map((mode) => (
                <ModeCard
                  key={mode.id}
                  mode={mode}
                  selected={selectedMode === mode.id}
                  isCurrent={currentMode === mode.id}
                  onPress={handleModePress}
                />
              ))}
            </View>
          )}

          {/* ── Same mode message ── */}
          {isSameMode && selectedMode !== null && (
            <Text style={s.sameModeNote}>Ce mode est déjà actif.</Text>
          )}

          {/* ── Surah picker ── */}
          {showSurahPicker && selectedMode === 'start_surah' && (
            <SurahPicker
              selected={pickerSurah}
              onSelect={handleSurahSelect}
            />
          )}

          {/* ── Save error ── */}
          {saveError && (
            <View style={s.errorCard}>
              <Text style={s.errorText}>{saveError}</Text>
            </View>
          )}

          {/* ── Save success ── */}
          {saveSuccess && (
            <View style={s.successCard}>
              <Text style={s.successText}>
                Programme réorganisé. Tes prochaines sessions suivront ce choix.
              </Text>
            </View>
          )}

          {/* ── CTA ── */}
          {plan && (
            <Pressable
              style={[s.cta, !canSave && s.ctaDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              {isSaving
                ? <ActivityIndicator size="small" color={colors.surface} />
                : <Text style={s.ctaText}>Enregistrer mon programme</Text>
              }
            </Pressable>
          )}

        </Animated.View>
      </ScrollView>
    </View>
  );
}

// ─── Styles: screen ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    padding: spacing.lg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { alignSelf: 'flex-start' },
  backText: {
    fontSize: 16, fontWeight: '600',
    color: colors.primary,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '700', letterSpacing: 2.5,
    color: colors.gold, textTransform: 'uppercase', marginBottom: 3,
  },
  title: {
    fontSize: 24, fontWeight: '800',
    color: colors.primary, letterSpacing: -0.4, marginBottom: 6,
  },
  subtitle: {
    fontSize: 13, color: colors.muted,
    lineHeight: 19, marginBottom: spacing.md,
  },
  noticeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  noticeText: {
    fontSize: 12, color: colors.primary,
    lineHeight: 18, marginBottom: 4,
  },
  noticeHint: {
    fontSize: 11, color: colors.muted,
    fontStyle: 'italic', lineHeight: 16,
  },
  loadingWrap: { alignItems: 'center', paddingVertical: spacing.lg },
  modesWrap: { gap: 10, marginBottom: spacing.md },
  sameModeNote: {
    fontSize: 12, color: colors.muted,
    fontStyle: 'italic', marginBottom: spacing.sm, textAlign: 'center',
  },
  errorCard: {
    backgroundColor: '#FFF0F0',
    borderRadius: 12, borderWidth: 1, borderColor: '#FFCCCC',
    padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 13, color: colors.danger, lineHeight: 18,
  },
  successCard: {
    backgroundColor: '#F0FBF4',
    borderRadius: 12, borderWidth: 1, borderColor: '#B2DFC3',
    padding: spacing.md, marginBottom: spacing.md,
  },
  successText: {
    fontSize: 13, color: colors.success, lineHeight: 18,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
    shadowColor: colors.primary, shadowOpacity: 0.20,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  ctaDisabled: { opacity: 0.38 },
  ctaText: {
    fontSize: 15, fontWeight: '700',
    color: colors.surface, letterSpacing: 0.2,
  },
});

// ─── Styles: ModeCard ─────────────────────────────────────────────────────────

const p = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.04,
    shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  cardSelected: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft ?? '#FDF8EE',
    shadowColor: colors.gold, shadowOpacity: 0.14, shadowRadius: 8, elevation: 2,
  },
  cardPressed: { opacity: 0.72 },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6,
  },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: colors.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.gold },
  radioDot: {
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: colors.gold,
  },
  cardLabel: {
    flex: 1, fontSize: 15, fontWeight: '700', color: colors.primary,
  },
  cardLabelSelected: { color: colors.primary },
  currentBadge: {
    backgroundColor: colors.goldSoft ?? '#FDF8EE',
    borderRadius: 10, borderWidth: 1, borderColor: colors.gold,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 10, fontWeight: '700',
    color: colors.gold, letterSpacing: 0.2,
  },
  cardDesc: {
    fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: 4,
    paddingLeft: 28,
  },
  cardHelper: {
    fontSize: 11, color: colors.muted, lineHeight: 16,
    fontStyle: 'italic', paddingLeft: 28,
  },
});

// ─── Styles: SurahPicker / AyahPicker ────────────────────────────────────────

const sp = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm, marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  title: {
    fontSize: 13, fontWeight: '700', color: colors.primary,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, marginBottom: 2,
  },
  sub: {
    fontSize: 11, color: colors.muted, lineHeight: 16,
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  list: { maxHeight: 220 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  rowActive: { backgroundColor: colors.goldSoft ?? '#FDF8EE' },
  rowPressed: { opacity: 0.6 },
  surahName: {
    flex: 1, fontSize: 14, fontWeight: '500', color: colors.primary,
  },
  surahNameActive: { color: colors.primary, fontWeight: '700' },
  surahMeta: {
    fontSize: 11, color: colors.muted, marginRight: 8,
  },
  surahMetaActive: { color: colors.gold },
  activeDot: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: colors.gold,
  },
});
