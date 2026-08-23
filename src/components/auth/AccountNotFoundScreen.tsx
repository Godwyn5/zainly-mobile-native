import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Amiri_700Bold } from '@expo-google-fonts/amiri';
import { Cinzel_500Medium } from '@expo-google-fonts/cinzel';
import { Lora_500Medium } from '@expo-google-fonts/lora';
import { hapticMedium } from '@/utils/haptics';

export type AccountNotFoundPhase = 'signing_out' | 'ready_to_choose' | 'sign_out_error';

interface AccountNotFoundScreenProps {
  phase: AccountNotFoundPhase;
  onCommencer: () => void;
  onAutreCompte: () => void;
  onRetry: () => void;
}

const BG = '#F7F2E7';
const GREEN = '#163026';
const MUTED = '#7A6E61';
const GOLD = '#B8962E';
const BUTTON_BG = '#FFFFFF';
const BUTTON_BORDER = 'rgba(22,48,38,0.12)';

export default function AccountNotFoundScreen({
  phase,
  onCommencer,
  onAutreCompte,
  onRetry,
}: AccountNotFoundScreenProps) {
  const [fontsLoaded] = useFonts({
    Amiri_700Bold,
    Cinzel_500Medium,
    Lora_500Medium,
  });

  const buttonsDisabled = phase !== 'ready_to_choose';

  const titleO = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(14)).current;
  const msgO = useRef(new Animated.Value(0)).current;
  const msgY = useRef(new Animated.Value(14)).current;
  const btnsO = useRef(new Animated.Value(0)).current;
  const btnsY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!fontsLoaded) return;
    const E = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(titleO, { toValue: 1, duration: 280, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(titleY, { toValue: 0, duration: 280, delay: 0, easing: E, useNativeDriver: true }),
      Animated.timing(msgO, { toValue: 1, duration: 260, delay: 80, easing: E, useNativeDriver: true }),
      Animated.timing(msgY, { toValue: 0, duration: 260, delay: 80, easing: E, useNativeDriver: true }),
      Animated.timing(btnsO, { toValue: 1, duration: 300, delay: 160, easing: E, useNativeDriver: true }),
      Animated.timing(btnsY, { toValue: 0, duration: 300, delay: 160, easing: E, useNativeDriver: true }),
    ]).start();
  }, [fontsLoaded, titleO, titleY, msgO, msgY, btnsO, btnsY]);

  function handleCommencer() {
    if (buttonsDisabled) return;
    hapticMedium();
    onCommencer();
  }

  function handleAutreCompte() {
    if (buttonsDisabled) return;
    hapticMedium();
    onAutreCompte();
  }

  function handleRetry() {
    hapticMedium();
    onRetry();
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <Animated.View
            style={[
              styles.centerBlock,
              { opacity: titleO, transform: [{ translateY: titleY }] },
            ]}
          >
            <Text style={styles.arabic}>زينلي</Text>
            <View style={styles.goldLine} />
            <Text style={styles.brand}>Zainly</Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.messageBlock,
              { opacity: msgO, transform: [{ translateY: msgY }] },
            ]}
          >
            <Text style={styles.title}>Compte introuvable</Text>
            <Text style={styles.subtitle}>
              Aucun programme Zainly n'est associé à ce compte.
            </Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.buttonBlock,
              { opacity: btnsO, transform: [{ translateY: btnsY }] },
            ]}
          >
            {phase === 'sign_out_error' ? (
              <>
                <Text style={styles.errorText}>
                  La déconnexion a échoué. Veuillez réessayer.
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleRetry}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryLabel}>Réessayer</Text>
                </TouchableOpacity>
              </>
            ) : phase === 'signing_out' ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={GREEN} />
                <Text style={styles.loadingText}>Déconnexion…</Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleCommencer}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryLabel}>Commencer</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={handleAutreCompte}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryLabel}>Utiliser un autre compte</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  safe: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  centerBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
  arabic: {
    fontFamily: 'Amiri_700Bold',
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
  brand: {
    fontFamily: 'Cinzel_500Medium',
    fontSize: 15,
    color: GREEN,
    letterSpacing: 4,
  },
  messageBlock: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontFamily: 'Lora_500Medium',
    fontSize: 22,
    color: GREEN,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: 'Lora_500Medium',
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonBlock: {
    width: '100%',
    maxWidth: 340,
    gap: 12,
  },
  primaryButton: {
    backgroundColor: GREEN,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryLabel: {
    fontFamily: 'Lora_500Medium',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: BUTTON_BG,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BUTTON_BORDER,
  },
  secondaryLabel: {
    fontFamily: 'Lora_500Medium',
    fontSize: 15,
    color: GREEN,
  },
  errorText: {
    fontFamily: 'Lora_500Medium',
    fontSize: 15,
    color: '#8B2D2D',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Lora_500Medium',
    fontSize: 15,
    color: MUTED,
  },
});
