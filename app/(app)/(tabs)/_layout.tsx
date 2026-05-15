import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '@/theme/colors';
import { hapticSelection } from '@/utils/haptics';

function TabIcon({ symbol, focused }: { symbol: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, color: focused ? colors.primary : colors.tabInactive }}>
      {symbol}
    </Text>
  );
}

const tabPressListener = { tabPress: () => hapticSelection() };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Aujourd'hui",
          tabBarIcon: ({ focused }) => <TabIcon symbol="⌂" focused={focused} />,
        }}
        listeners={tabPressListener}
      />
      <Tabs.Screen
        name="hifz"
        options={{
          title: 'Mon Hifz',
          tabBarIcon: ({ focused }) => <TabIcon symbol="☽" focused={focused} />,
        }}
        listeners={tabPressListener}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon symbol="◎" focused={focused} />,
        }}
        listeners={tabPressListener}
      />
      {/* Hidden routes — kept in codebase, not shown in tab bar */}
      <Tabs.Screen
        name="progression"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null }}
      />
    </Tabs>
  );
}
