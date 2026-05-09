import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { useProfile } from '@/hooks/useProfile';
import { usePlan } from '@/hooks/usePlan';
import { useProgress } from '@/hooks/useProgress';
import { useDueReviews } from '@/hooks/useDueReviews';
import { getTodayProgramme } from '@/core/dailyPlan';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TodayScreen() {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const today = localDateStr();

  const profile  = useProfile(userId);
  const plan     = usePlan(userId);
  const progress = useProgress(userId);
  const reviews  = useDueReviews(userId);

  const isLoading = profile.isLoading || plan.isLoading || progress.isLoading || reviews.isLoading;
  const hasError  = profile.isError   || plan.isError   || progress.isError   || reviews.isError;
  const hasNoPlan = !plan.data || !progress.data;

  function refetchAll() {
    profile.refetch();
    plan.refetch();
    progress.refetch();
    reviews.refetch();
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={styles.loadingText}>Chargement de ton programme…</Text>
      </SafeAreaView>
    );
  }

  if (hasError) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Impossible de charger ton programme</Text>
          <Text style={styles.stateSub}>Vérifie ta connexion puis réessaie.</Text>
          <Pressable style={styles.retryBtn} onPress={refetchAll}>
            <Text style={styles.retryBtnText}>Réessayer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (hasNoPlan) {
    return (
      <SafeAreaView style={styles.centered}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Ton programme n'est pas encore prêt</Text>
          <Text style={styles.stateSub}>Commence par créer ton programme de mémorisation.</Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.push('/onboarding')}>
            <Text style={styles.ctaBtnText}>Créer mon programme</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const prog = getTodayProgramme({
    plan: plan.data,
    progress: progress.data,
    dueReviewCount: reviews.data ?? 0,
    today,
  });

  const isPremium = profile.data?.is_premium ?? false;

  const ayatLabel = (() => {
    if (prog.surahExhausted && prog.nextSurahName) {
      return `Passage à ${prog.nextSurahName}`;
    }
    if (prog.memStart != null && prog.memEnd != null && prog.surahName) {
      return prog.memStart === prog.memEnd
        ? `${prog.surahName} — ayat ${prog.memStart}`
        : `${prog.surahName} — ayats ${prog.memStart} à ${prog.memEnd}`;
    }
    return '—';
  })();

  const ayatSubLabel = (() => {
    if (prog.sessionDoneToday) return 'Reviens demain pour continuer ton programme.';
    if (prog.surahExhausted && prog.nextSurahName) return 'Ta sourate actuelle est terminée.';
    return `${prog.todayAyatCount} nouveau${prog.todayAyatCount > 1 ? 'x' : ''} ayat${prog.todayAyatCount > 1 ? 's' : ''}`;
  })();

  const progressPct = prog.surahTotalAyats > 0
    ? Math.min(prog.currentAyah / prog.surahTotalAyats, 1)
    : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Aujourd'hui</Text>
            <View style={[styles.chip, isPremium ? styles.chipPremium : styles.chipFree]}>
              <Text style={[styles.chipText, isPremium ? styles.chipTextPremium : styles.chipTextFree]}>
                {isPremium ? 'Premium actif' : 'Gratuit'}
              </Text>
            </View>
          </View>
          <Text style={styles.subtitle}>Ton programme de mémorisation du jour.</Text>
        </View>

        {/* Main card */}
        <View style={styles.card}>
          <Text style={styles.cardBadge}>PROGRAMME DU JOUR</Text>

          {/* Section — Révisions */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RÉVISIONS</Text>
            {prog.dueReviewCount > 0 ? (
              <>
                <Text style={styles.sectionTitle}>
                  {prog.dueReviewCount} ayat{prog.dueReviewCount > 1 ? 's' : ''} à revoir aujourd'hui
                </Text>
                <Text style={styles.sectionSub}>
                  On commence par consolider ce que tu connais déjà.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>Aucune révision prévue aujourd'hui</Text>
                <Text style={styles.sectionSub}>
                  Tu passeras directement à la nouvelle mémorisation.
                </Text>
              </>
            )}
          </View>

          <View style={styles.divider} />

          {/* Section — Nouvelle mémorisation */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>NOUVELLE MÉMORISATION</Text>
            {prog.sessionDoneToday ? (
              <>
                <Text style={styles.sectionTitle}>Session du jour terminée</Text>
                <Text style={styles.sectionSub}>Reviens demain pour continuer ton programme.</Text>
              </>
            ) : (
              <>
                <Text style={styles.sectionTitle}>{ayatLabel}</Text>
                <Text style={styles.sectionSub}>{ayatSubLabel}</Text>
              </>
            )}
          </View>

          {/* Section — Dans cette sourate */}
          {!prog.surahExhausted && prog.currentSurah != null && prog.surahTotalAyats > 0 && (
            <>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>DANS CETTE SOURATE</Text>
                <Text style={styles.sectionTitle}>
                  {prog.currentAyah} / {prog.surahTotalAyats} ayats
                </Text>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${progressPct * 100}%` }]} />
                </View>
                <Text style={styles.sectionSub}>
                  {prog.sessionFinishesSurah
                    ? `Tu termineras ${prog.surahName} aujourd'hui.`
                    : `Il restera ${prog.remainingAfterSession} ayat${prog.remainingAfterSession > 1 ? 's' : ''} après ta session.`
                  }
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Stats mini row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>🔥 {prog.streak}</Text>
            <Text style={styles.statLabel}>Série</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{prog.totalMemorized}</Text>
            <Text style={styles.statLabel}>Ayats acquis</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{prog.ayahPerDay}/j</Text>
            <Text style={styles.statLabel}>Rythme</Text>
          </View>
        </View>

        {/* CTA */}
        <Pressable
          style={({ pressed }) => [
            styles.ctaBtn,
            prog.sessionDoneToday && styles.ctaBtnDisabled,
            pressed && !prog.sessionDoneToday && styles.ctaBtnPressed,
          ]}
          onPress={() => { if (!prog.sessionDoneToday) router.push('/(app)/session'); }}
          disabled={prog.sessionDoneToday}
        >
          <Text style={styles.ctaBtnText}>
            {prog.sessionDoneToday ? 'Session terminée' : 'Commencer la session'}
          </Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  container: { paddingHorizontal: spacing.md, paddingBottom: 48, paddingTop: spacing.md },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },

  /* Header */
  header: { marginBottom: spacing.lg, marginTop: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipPremium: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  chipFree: { backgroundColor: colors.surface, borderColor: colors.border },
  chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  chipTextPremium: { color: colors.gold },
  chipTextFree: { color: colors.muted },

  /* Main card */
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
    shadowColor: colors.primary,
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardBadge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    marginBottom: spacing.md,
  },
  section: { marginBottom: 4 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: 4 },
  sectionSub: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },

  /* Progress bar */
  progressBarBg: {
    height: 5,
    backgroundColor: colors.border,
    borderRadius: 4,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 5,
    backgroundColor: colors.primary,
    borderRadius: 4,
  },

  /* Stats row */
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  statLabel: { fontSize: 11, color: colors.muted },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },

  /* CTA */
  ctaBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  ctaBtnPressed: { opacity: 0.85 },
  ctaBtnDisabled: { backgroundColor: colors.border },
  ctaBtnText: { color: colors.surface, fontSize: 16, fontWeight: '600' },

  /* State screens */
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  stateTitle: { fontSize: 17, fontWeight: '700', color: colors.primary, textAlign: 'center', marginBottom: 8 },
  stateSub: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: spacing.lg },
  retryBtn: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  retryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
