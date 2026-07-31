import { View, Text, StyleSheet } from 'react-native';

// ─── palette — matches reset-password.tsx exactly ───────────────────────────
const GREEN = '#031A12';
const GOLD = '#C6A15B';

// ─── font families ───────────────────────────────────────────────────────────
const F_BRAND = 'Cinzel_500Medium';
const F_ARABIC = 'Amiri_700Bold';

export default function ZainlyLogo() {
  return (
    <View style={styles.brandBlock}>
      <Text style={styles.brandArabic}>زينلي</Text>
      <View style={styles.goldLine} />
      <Text style={styles.brandWord}>Zainly</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brandBlock: {
    alignItems: 'center',
    marginBottom: 32,
  },
  brandArabic: {
    fontFamily: F_ARABIC,
    fontSize: 28,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 34,
  },
  goldLine: {
    width: 22,
    height: 1,
    backgroundColor: GOLD,
    opacity: 0.55,
    marginTop: 5,
    marginBottom: 6,
    borderRadius: 1,
  },
  brandWord: {
    fontFamily: F_BRAND,
    fontSize: 15,
    color: GREEN,
    letterSpacing: 4,
  },
});
