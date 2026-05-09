import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function ProgressionScreen() {
  return (
    <Screen>
      <SectionLabel text="Stats" style={styles.badge} />
      <Text style={styles.title}>Progression</Text>
      <Text style={styles.subtitle}>Ton avancement dans la mémorisation.</Text>

      <Card>
        <SectionLabel text="Total mémorisé" />
        <Text style={styles.stat}>0 / 6 236 ayats</Text>
      </Card>

      <Card>
        <SectionLabel text="Meilleure série" />
        <Text style={styles.stat}>0 jour</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { marginTop: spacing.sm },
  title: { fontSize: 30, fontWeight: '700', color: colors.primary, marginBottom: 6 },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: spacing.lg },
  stat: { fontSize: 24, fontWeight: '700', color: colors.primary },
});
