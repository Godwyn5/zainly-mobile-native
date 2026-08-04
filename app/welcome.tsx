import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { clearActiveOnboardingAuthFlow, clearSessionAuthFlowId } from '@/lib/pendingOnboardingPlan';

const GOLD         = '#C6A15B';
const GOLD_DARK    = '#9F7628';
const SPLASH_BEIGE      = '#F7F2E7';
const SPLASH_BEIGE_EDGE = '#EDE3CC';
const SPLASH_GREEN      = '#163026';

export default function WelcomeScreen() {
  const [fontsLoaded] = useFonts({ Lora_500Medium });
  const [showDeletionBanner, setShowDeletionBanner] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('account_deleted_success').then((value) => {
      if (value === 'true') {
        setShowDeletionBanner(true);
        AsyncStorage.removeItem('account_deleted_success').catch(() => {});
      }
    }).catch(() => {});
  }, []);

  if (!fontsLoaded) {
    return <View style={styles.welcomeRoot} />;
  }

  return (
    <View style={styles.welcomeRoot}>
      <StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} />

      <View pointerEvents="none" style={styles.wGreenFormTopRight} />
      <View pointerEvents="none" style={styles.wGreenFormTopLeft} />
      <View pointerEvents="none" style={styles.wGreenFormBottomLeft} />

      <SafeAreaView style={styles.welcomeSafe}>
        <View style={styles.welcomeShell}>

          {showDeletionBanner && (
            <View style={styles.deletionBanner} accessible accessibilityLabel="Compte supprimé avec succès" accessibilityRole="alert">
              <Text style={styles.deletionBannerText}>Ton compte et tes données ont bien été supprimés.</Text>
            </View>
          )}

          <View style={styles.heroSection}>
            <View style={styles.goldLineSeparator} />

            <View style={styles.headlineWrap}>
              <Text style={styles.headline} numberOfLines={1} adjustsFontSizeToFit={true}>Mémorise le Coran</Text>
              <Text style={styles.headlineAccent}>avec constance.</Text>
            </View>

            <View style={styles.rosette}>
              <View style={styles.rosetteCenter} />
              <View style={styles.rosetteArm1} />
              <View style={styles.rosetteArm2} />
              <View style={styles.rosetteArm3} />
              <View style={styles.rosetteArm4} />
            </View>

            <Text style={styles.subtitle}>
              Chaque jour, Zainly te montre quoi mémoriser
              et quoi réviser pour continuer d'avancer.
            </Text>
          </View>

          <View style={styles.ctaSection}>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.88}
              onPress={() => { hapticMedium(); router.push('/onboarding-v2/name'); }}
            >
              <Text style={styles.primaryBtnText}>Commencer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.6}
              onPress={() => {
                hapticLight();
                // Normal Welcome login — clear any stale onboarding-v2 auth flow
                // proof so it cannot be used to claim an old pending payload.
                clearActiveOnboardingAuthFlow();
                clearSessionAuthFlowId();
                router.push('/(auth)/login-methods');
              }}
            >
              <Text style={styles.secondaryBtnText}>J'ai déjà un compte</Text>
            </TouchableOpacity>
          </View>

        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  welcomeRoot: {
    flex: 1,
    backgroundColor: SPLASH_BEIGE,
  },
  welcomeSafe: {
    flex: 1,
  },
  welcomeShell: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 10,
    alignItems: 'center',
  },

  deletionBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  deletionBannerText: { fontSize: 13, color: '#047857', lineHeight: 18 },

  wGreenFormTopRight: {
    position: 'absolute',
    top: -200,
    right: -150,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
  },
  wGreenFormTopLeft: {
    position: 'absolute',
    top: -80,
    left: -60,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: SPLASH_BEIGE_EDGE,
    opacity: 0.4,
  },
  wGreenFormBottomLeft: {
    position: 'absolute',
    bottom: -280,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: SPLASH_GREEN,
    opacity: 0.9,
  },

  heroSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  goldLineSeparator: {
    width: 48,
    height: 1.5,
    backgroundColor: GOLD,
    borderRadius: 1,
    marginBottom: 24,
  },
  headlineWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  headline: {
    fontFamily: 'Lora_500Medium',
    fontSize: 40,
    color: SPLASH_GREEN,
    lineHeight: 48,
    textAlign: 'center',
    flexShrink: 0,
  },
  headlineAccent: {
    fontFamily: 'Lora_500Medium',
    fontSize: 40,
    color: GOLD_DARK,
    lineHeight: 48,
    textAlign: 'center',
    flexShrink: 0,
  },
  subtitle: {
    fontWeight: '500',
    fontSize: 16,
    color: SPLASH_GREEN,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 300,
    marginTop: 20,
  },

  rosette: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  rosetteCenter: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
  rosetteArm1: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
  },
  rosetteArm2: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  rosetteArm3: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '90deg' }],
  },
  rosetteArm4: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: GOLD,
    borderRadius: 1,
    transform: [{ rotate: '135deg' }],
  },

  ctaSection: {
    gap: 14,
    width: '100%',
    marginBottom: 12,
  },
  primaryBtn: {
    backgroundColor: GOLD_DARK,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: GOLD_DARK,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 8,
  },
  primaryBtnText: {
    color: SPLASH_BEIGE,
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: SPLASH_GREEN,
    fontSize: 14.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
