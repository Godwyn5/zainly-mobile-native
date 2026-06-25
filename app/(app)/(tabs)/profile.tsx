import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useLogout } from '@/hooks/useLogout';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface ProfileRowProps {
  title: string;
  description: string;
}

function ProfileRow({ title, description }: ProfileRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <View style={styles.soonBadge}>
        <Text style={styles.soonText}>Bientôt</Text>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { confirmLogout, isLoggingOut } = useLogout();

  return (
    <Screen>
      <SectionLabel text="Mon compte" style={styles.badge} />
      <Text style={styles.title}>Profil</Text>
      <Text style={styles.subtitle}>Personnalise ton expérience Zainly.</Text>

      <View style={styles.card}>
        <ProfileRow
          title="Récitateur"
          description="Choisir la voix qui accompagnera tes sessions."
        />
        <View style={styles.divider} />
        <ProfileRow
          title="Notifications"
          description="Définir ton rappel quotidien."
        />
        <View style={styles.divider} />
        <ProfileRow
          title="Programme"
          description="Modifier ton rythme ou ton objectif."
        />
        <View style={styles.divider} />
        <ProfileRow
          title="Abonnement"
          description="Gérer ton accès Zainly."
        />
      </View>

      {/* ── Compte section ── */}
      <SectionLabel text="Compte" style={styles.sectionLabel} />
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [
            styles.logoutRow,
            isLoggingOut && styles.logoutRowDisabled,
            pressed && !isLoggingOut && styles.logoutRowPressed,
          ]}
          onPress={confirmLogout}
          disabled={isLoggingOut}
        >
          <Text style={[styles.logoutText, isLoggingOut && styles.logoutTextDim]}>
            {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { marginTop: spacing.sm },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sectionLabel: { marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 3,
  },
  rowDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  soonBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  soonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gold,
    letterSpacing: 0.2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  logoutRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  logoutRowDisabled: { opacity: 0.5 },
  logoutRowPressed:   { opacity: 0.65 },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  logoutTextDim: { color: colors.muted },
});
