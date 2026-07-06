import { useState } from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/db/client';
import { requestAccountDeletion } from '@/db/accountDeletion';
import { useAuthStore } from '@/store/authStore';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { ListRow } from '@/components/ui/ListRow';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function SettingsScreen() {
  const [signingOut, setSigningOut] = useState(false);
  const [requestingDeletion, setRequestingDeletion] = useState(false);
  const userId = useAuthStore((s) => s.user?.id);
  const userEmail = useAuthStore((s) => s.user?.email);

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

  async function performDeletionRequest() {
    if (!userId || requestingDeletion) return;
    setRequestingDeletion(true);
    const { error } = await requestAccountDeletion({ userId, email: userEmail ?? null });
    setRequestingDeletion(false);

    if (!error) {
      Alert.alert(
        'Demande envoyée',
        'Ta demande de suppression a été enregistrée. Nous la traiterons dans les meilleurs délais.'
      );
      return;
    }

    if (error === 'already_requested') {
      Alert.alert(
        'Demande déjà envoyée',
        'Une demande de suppression est déjà enregistrée pour ce compte.'
      );
      return;
    }

    Alert.alert(
      'Erreur',
      'Impossible d’envoyer la demande pour le moment. Réessaie plus tard.'
    );
  }

  function confirmDeletion() {
    Alert.alert(
      'Supprimer ton compte ?',
      'Cette action enverra une demande de suppression de ton compte et de tes données Zainly. Elle sera traitée dans les meilleurs délais. Cette action ne peut pas être annulée une fois la demande envoyée.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Envoyer la demande', style: 'destructive', onPress: performDeletionRequest },
      ]
    );
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
        <ListRow
          title="Supprimer mon compte"
          destructive
          chevron={false}
          onPress={confirmDeletion}
          loading={requestingDeletion}
          disabled={requestingDeletion}
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
