import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet,
  StatusBar,
} from 'react-native';
import { useFonts } from 'expo-font';
import {
  Amiri_700Bold,
} from '@expo-google-fonts/amiri';
import {
  Cinzel_500Medium,
  Cinzel_600SemiBold,
} from '@expo-google-fonts/cinzel';
import {
  Lora_500Medium,
} from '@expo-google-fonts/lora';
import { router, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { hasValidPendingOnboardingPlan } from '@/lib/pendingOnboardingPlan';
import { planQueryOptions, progressQueryOptions, dueReviewsQueryOptions, profileQueryOptions, learnedItemsQueryOptions } from '@/queries';

const GOLD         = '#C6A15B';
const SPLASH_BEIGE      = '#F7F2E7';
const SPLASH_BEIGE_EDGE = '#EDE3CC';
const SPLASH_GREEN      = '#163026';

const F_BRAND_SB = 'Cinzel_600SemiBold';
const F_ARABIC   = 'Amiri_700Bold';

export default function EntryScreen() {
  const { session, ready, user } = useAuthStore();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [minDurationElapsed, setMinDurationElapsed] = useState(false);
  const [warmupReady, setWarmupReady] = useState(false);
  const [hasPendingOnboarding, setHasPendingOnboarding] = useState(false);
  const navigatedRef = useRef(false);

  const [fontsLoaded] = useFonts({
    Amiri_700Bold,
    Cinzel_500Medium,
    Cinzel_600SemiBold,
    Lora_500Medium,
  });

  useEffect(() => {
    if (!ready) return;

    hasValidPendingOnboardingPlan()
      .then((pending) => {
        setHasPendingOnboarding(pending);
      })
      .catch(() => {
        setHasPendingOnboarding(false);
      });
  }, [ready]);

  useEffect(() => {
    if (!fontsLoaded || !ready || !userId || hasPendingOnboarding) {
      setWarmupReady(true);
      return;
    }

    const mountedRef = { current: true };

    Promise.all([
      queryClient.prefetchQuery(planQueryOptions(userId)),
      queryClient.prefetchQuery(progressQueryOptions(userId)),
      queryClient.prefetchQuery(dueReviewsQueryOptions(userId)),
      queryClient.prefetchQuery(profileQueryOptions(userId)),
    ])
      .then(() => {
        if (mountedRef.current) setWarmupReady(true);
      })
      .catch(() => {
        if (mountedRef.current) setWarmupReady(true);
      });

    queryClient.prefetchQuery(learnedItemsQueryOptions(userId)).catch(() => {});

    return () => { mountedRef.current = false };
  }, [fontsLoaded, ready, userId, hasPendingOnboarding, queryClient]);

  useEffect(() => {
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setMinDurationElapsed(true);
    }, 1200);

    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded) return;

    const timer = setTimeout(() => {
      setWarmupReady(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [fontsLoaded]);

  useEffect(() => {
    if (!fontsLoaded || !ready || !minDurationElapsed || !warmupReady) return;
    if (navigatedRef.current) return;

    navigatedRef.current = true;

    if (session) {
      // Stack.Protected handles the redirect to (app) automatically.
      return;
    }

    router.replace('/welcome');
  }, [fontsLoaded, ready, minDurationElapsed, warmupReady, session, pathname]);

  if (!fontsLoaded) {
    return <View style={styles.splashRoot}><StatusBar barStyle="dark-content" backgroundColor={SPLASH_BEIGE_EDGE} translucent={false} /></View>;
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
