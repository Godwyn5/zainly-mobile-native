import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';

export default function PremiumScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>PREMIUM</Text>
      <Text style={styles.title}>Zainly Premium</Text>
      <Text style={styles.subtitle}>
        Accès illimité à toutes tes sessions, révisions et statistiques.
      </Text>

      {/* TODO: RevenueCat paywall */}
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Paywall RevenueCat — à implémenter</Text>
      </View>

      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>S'abonner (placeholder)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>Pas maintenant</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: colors.gold,
    marginBottom: 12,
  },
  title: { fontSize: 32, fontWeight: '700', color: colors.primary, marginBottom: 10 },
  subtitle: { fontSize: 14, color: colors.muted, lineHeight: 22, marginBottom: 32 },
  placeholder: {
    flex: 1,
    backgroundColor: colors.goldSoft,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gold,
    marginBottom: 24,
  },
  placeholderText: { fontSize: 14, color: colors.gold },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  back: { alignItems: 'center', paddingVertical: 12 },
  backText: { color: colors.muted, fontSize: 14 },
});
