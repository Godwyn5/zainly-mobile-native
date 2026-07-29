// ─── LegalScreen ───────────────────────────────────────────────────────────────
// Shared layout for the in-app legal pages (Privacy Policy, Terms of Use).
// Sober, readable, scrollable — no paywall-style urgency, no gold CTA. Just a
// simple header with a back button and a beige/green Zainly-branded body.

import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

interface LegalScreenProps {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

export function LegalScreen({ title, lastUpdated, children }: LegalScreenProps) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/premium'))}
          hitSlop={12}
          style={s.backBtn}
        >
          <View style={s.backChevron} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {children}
        <Text style={s.updated}>Dernière mise à jour : {lastUpdated}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

interface LegalSectionProps {
  title: string;
  children: ReactNode;
}

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionBody}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  backChevron: {
    width: 10, height: 10,
    borderLeftWidth: 2, borderBottomWidth: 2, borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.primary },

  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },

  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: colors.gold,
    letterSpacing: 0.4, marginBottom: 6, textTransform: 'uppercase',
  },
  sectionBody: { fontSize: 14, lineHeight: 21, color: colors.text },

  updated: {
    fontSize: 11, color: colors.muted, textAlign: 'center',
    marginTop: spacing.sm, marginBottom: spacing.lg,
  },
});
