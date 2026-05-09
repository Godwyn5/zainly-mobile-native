import { Tabs } from 'expo-router';
import { colors } from '@/theme/colors';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Aujourd'hui" }}
      />
      <Tabs.Screen
        name="progression"
        options={{ title: 'Progression' }}
      />
      <Tabs.Screen
        name="hifz"
        options={{ title: 'Mon Hifz' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Réglages' }}
      />
    </Tabs>
  );
}
