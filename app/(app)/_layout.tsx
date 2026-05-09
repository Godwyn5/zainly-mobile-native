import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '@/store/authStore';

export default function AppLayout() {
  const { session, ready } = useAuthStore();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace('/(auth)/login');
    }
  }, [session, ready]);

  if (!ready || !session) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
