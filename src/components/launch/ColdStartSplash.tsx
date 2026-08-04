import {
  View, Text, StyleSheet,
  StatusBar,
} from 'react-native';

const GOLD               = '#C6A15B';
const SPLASH_BEIGE       = '#F7F2E7';
const SPLASH_BEIGE_EDGE  = '#EDE3CC';
const SPLASH_GREEN       = '#163026';

const F_BRAND_SB = 'Cinzel_600SemiBold';
const F_ARABIC   = 'Amiri_700Bold';

export function ColdStartSplash({ fontsLoaded }: { fontsLoaded: boolean }) {
  if (!fontsLoaded) {
    return (
      <View style={styles.splashRoot}>
        <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />
      </View>
    );
  }

  return (
    <View style={styles.splashRoot}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

      <View style={styles.spGreenFormTop} />
      <View style={styles.spGreenFormBot} />
      <View style={styles.spGoldAccent} />

      <View style={styles.splashCenter}>
        <View style={styles.lockup}>
          <Text style={styles.splashArabic}>زينلي</Text>
          <View style={styles.goldLine} />
          <Text style={styles.splashBrand}>ZAINLY</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splashRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  lockup: {
    alignItems: 'center',
  },
  splashArabic: {
    fontFamily: F_ARABIC,
    fontSize: 75,
    color: GOLD,
    includeFontPadding: false,
    lineHeight: 86,
  },
  goldLine: {
    width: 37,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginTop: 6,
    marginBottom: 9,
    opacity: 0.8,
  },
  splashBrand: {
    fontFamily: F_BRAND_SB,
    fontSize: 33,
    color: SPLASH_GREEN,
    letterSpacing: 4.5,
    fontWeight: '600',
  },
  spGreenFormTop: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: SPLASH_GREEN,
  },
  spGreenFormBot: {
    position: 'absolute',
    bottom: -140,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
    opacity: 0.85,
  },
  spGoldAccent: {
    position: 'absolute',
    top: 120,
    left: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: GOLD,
    opacity: 0.12,
  },
});
