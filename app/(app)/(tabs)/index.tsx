import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { useProfile } from '@/hooks/useProfile';
import { usePlan } from '@/hooks/usePlan';
import { useProgress } from '@/hooks/useProgress';
import { useDueReviews } from '@/hooks/useDueReviews';
import { getTodayProgramme } from '@/core/dailyPlan';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { StatusChip } from '@/components/ui/StatusChip';
import { StatPill } from '@/components/ui/StatPill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SecondaryButton } from '@/components/ui/SecondaryButton';
import { EmptyState } from '@/components/ui/EmptyState';
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
      <Screen>
        <Card style={styles.stateCard}>
          <EmptyState
            title="Impossible de charger ton programme"
            description="Vérifie ta connexion puis réessaie."
            buttonLabel="Réessayer"
            onPress={refetchAll}
          />
        </Card>
      </Screen>
    );
  }

  if (hasNoPlan) {
    return (
      <Screen>
        <Card style={styles.stateCard}>
          <EmptyState
            title="Ton programme n'est pas encore prêt"
            description="Commence par créer ton programme de mémorisation."
            buttonLabel="Créer mon programme"
            onPress={() => router.push('/onboarding')}
          />
        </Card>
      </Screen>
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
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Aujourd'hui</Text>
          <StatusChip
            label={isPremium ? 'Premium actif' : 'Gratuit'}
            variant={isPremium ? 'premium' : 'free'}
          />
        </View>
        <Text style={styles.subtitle}>Ton programme de mémorisation du jour.</Text>
      </View>

      {/* Main card */}
      <Card>
        <SectionLabel text="Programme du jour" />

        {/* Révisions */}
        <View style={styles.section}>
          <Text style={styles.subsectionLabel}>RÉVISIONS</Text>
          {prog.dueReviewCount > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {prog.dueReviewCount} ayat{prog.dueReviewCount > 1 ? 's' : ''} à revoir aujourd'hui
              </Text>
              <Text style={styles.sectionSub}>On commence par consolider ce que tu connais déjà.</Text>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Aucune révision aujourd'hui</Text>
              <Text style={styles.sectionSub}>Tu passeras directement à la nouvelle mémorisation.</Text>
            </>
          )}
        </View>

        <View style={styles.divider} />

        {/* Mémorisation */}
        <View style={styles.section}>
          <Text style={styles.subsectionLabel}>NOUVELLE MÉMORISATION</Text>
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

        {/* Surah progress */}
        {!prog.surahExhausted && prog.currentSurah != null && prog.surahTotalAyats > 0 && (
          <>
            <View style={styles.divider} />
            <View style={styles.section}>
              <Text style={styles.subsectionLabel}>DANS CETTE SOURATE</Text>
              <Text style={styles.sectionTitle}>
                {prog.currentAyah} / {prog.surahTotalAyats} ayats
              </Text>
              <View style={styles.barWrap}>
                <ProgressBar progress={progressPct} />
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
      </Card>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatPill value={`🔥 ${prog.streak}`} label="Série" />
        <View style={styles.statDivider} />
        <StatPill value={String(prog.totalMemorized)} label="Ayats acquis" />
        <View style={styles.statDivider} />
        <StatPill value={`${prog.ayahPerDay}/j`} label="Rythme" />
      </View>

      {/* CTA */}
      <PrimaryButton
        label={prog.sessionDoneToday ? 'Session terminée' : 'Commencer la session'}
        onPress={() => router.push('/(app)/session')}
        disabled={prog.sessionDoneToday}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  stateCard: { marginTop: spacing.xl },
  header: { marginBottom: spacing.lg, marginTop: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  section: { marginBottom: 4 },
  subsectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.muted,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: 4 },
  sectionSub: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  barWrap: { marginVertical: spacing.sm },
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
  statDivider: { width: 1, height: 32, backgroundColor: colors.border },
});
