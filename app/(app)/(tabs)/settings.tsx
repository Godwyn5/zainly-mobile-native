import { useState } from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/db/client';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { ListRow } from '@/components/ui/ListRow';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function SettingsScreen() {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);
    if (error) {
      Alert.alert('Erreur', 'Impossible de se déconnecter. Réessaie.');
      return;
    }
    router.replace('/(auth)/login');
  }

  return (
    <Screen>
      <SectionLabel text="Compte" style={styles.badge} />
      <Text style={styles.title}>Réglages</Text>

      <Card style={styles.groupCard}>
        <SectionLabel text="Mon programme" style={styles.groupLabel} />
        <ListRow title="Changer mon rythme" topBorder={false} />
        <ListRow title="Reconstruire mon programme" />
      </Card>

      <Card style={styles.groupCard}>
        <SectionLabel text="Compte" style={styles.groupLabel} />
        <ListRow title="Premium" topBorder={false} />
        <ListRow
          title="Se déconnecter"
          destructive
          chevron={false}
          onPress={handleSignOut}
          loading={signingOut}
          disabled={signingOut}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { marginTop: spacing.sm },
  title: { fontSize: 30, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
  groupCard: { padding: 0, overflow: 'hidden' },
  groupLabel: { paddingHorizontal: 16, paddingTop: 14, marginBottom: 0 },
});
