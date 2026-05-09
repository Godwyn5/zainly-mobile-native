import { Text, StyleSheet } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export default function HifzScreen() {
  return (
    <Screen>
      <SectionLabel text="Bibliothèque" style={styles.badge} />
      <Text style={styles.title}>Mon Hifz</Text>
      <Text style={styles.subtitle}>Les sourates que tu as mémorisées.</Text>

      <Card>
        <EmptyState
          title="Ta bibliothèque est vide"
          description="Ta bibliothèque de mémorisation apparaîtra ici une fois ta première sourate complétée."
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { marginTop: spacing.sm },
  title: { fontSize: 30, fontWeight: '700', color: colors.primary, marginBottom: 6 },
  subtitle: { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: spacing.lg },
});
