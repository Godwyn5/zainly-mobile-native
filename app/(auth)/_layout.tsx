import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function AuthLayout() {
  const { session, ready } = useAuthStore();

  useEffect(() => {
    if (!ready) return;
    if (session) {
      router.replace('/(app)/(tabs)');
    }
  }, [ready, session]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
