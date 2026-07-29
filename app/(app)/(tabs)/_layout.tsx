import { Tabs } from 'expo-router';
import { PremiumTabBar } from '@/components/navigation/PremiumTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <PremiumTabBar {...props} />}
    >
      <Tabs.Screen name="index"   options={{ title: "Aujourd'hui" }} />
      <Tabs.Screen name="hifz"    options={{ title: 'Mon Hifz' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
