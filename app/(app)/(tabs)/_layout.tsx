import { Tabs } from 'expo-router';
import { PremiumTabBar } from './PremiumTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <PremiumTabBar {...props} />}
    >
      <Tabs.Screen name="index"       options={{ title: "Aujourd'hui" }} />
      <Tabs.Screen name="hifz"        options={{ title: 'Mon Hifz' }} />
      <Tabs.Screen name="profile"     options={{ title: 'Profil' }} />
      {/* Hidden routes — kept in codebase, not shown in tab bar */}
      <Tabs.Screen name="progression" options={{ href: null }} />
      <Tabs.Screen name="settings"    options={{ href: null }} />
    </Tabs>
  );
}
