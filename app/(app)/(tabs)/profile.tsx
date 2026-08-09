import { useState, useRef, useEffect } from 'react';
import { ActivityIndicator, Alert, View, Text, StyleSheet, Pressable, Animated, Easing, Platform, Linking } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@/components/ui/Screen';
import { useAuthStore } from '@/store/authStore';
import { useProfile } from '@/hooks/useProfile';
import { useZainlyPlusAccess } from '@/hooks/useZainlyPlusAccess';
import { useLogout } from '@/hooks/useLogout';
import { useRestorePurchases } from '@/hooks/useRestorePurchases';
import { manageSubscription } from '@/lib/manageSubscription';
import { deleteAccountSelfService } from '@/db/accountDeletion';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';
import { hapticLight, hapticMedium } from '@/utils/haptics';

// ─── PremiumCard ────────────────────────────────────────────────────────────
// The focal point of the screen. Deep multi-tone green gradient, a barely-
// perceptible gold shimmer sweep (~7s cycle), and a whole-card tap target
// with a very light scale response. No gradient exists elsewhere in the
// palette scale beyond colors.primary/primarySoft/gold — this only layers
// those existing tones for depth, never introduces a new color.

function PremiumCard({ hasZainlyPlus, anim, userId }: { hasZainlyPlus: boolean; anim: Animated.Value; userId: string | undefined }) {
  const isPushing = useRef(false);
  const shimmerAnim = useRef(new Animated.Value(-1)).current;
  const shimmerLoop = useRef<Animated.CompositeAnimation | null>(null);
  const breatheAnim = useRef(new Animated.Value(0)).current;
  const breatheLoop = useRef<Animated.CompositeAnimation | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Extremely slow, rare sweep — a light pause between each pass so the
    // motion never reads as "active"/urgent.
    shimmerLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 3600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.delay(4800),
        Animated.timing(shimmerAnim, { toValue: -1, duration: 0, useNativeDriver: false }),
      ])
    );
    shimmerLoop.current.start();

    // "The card breathes" — extremely subtle translateY (1.5px) + opacity
    // shift on the soft tone overlay, on an 8s loop. Kept well under the
    // threshold where motion reads as "alive"/animated rather than static.
    breatheLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breatheAnim, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    breatheLoop.current.start();

    return () => {
      shimmerLoop.current?.stop();
      breatheLoop.current?.stop();
    };
  }, [shimmerAnim, breatheAnim]);

  const shimmerLeft = shimmerAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-30%', '130%'] });
  const breatheY = breatheAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] });

  function handlePressIn() {
    Animated.timing(scaleAnim, { toValue: 0.98, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }
  function handlePressOut() {
    Animated.timing(scaleAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }
  async function handlePress() {
    if (isPushing.current) return;
    isPushing.current = true;
    hapticLight();
    if (hasZainlyPlus) {
      const result = await manageSubscription(userId);
      if (!result.ok && result.reason !== 'unsupported_platform') {
        Alert.alert(
          'Gestion indisponible',
          'Impossible d\u2019ouvrir la gestion de ton abonnement pour le moment. Réessaie plus tard.'
        );
      }
    } else {
      router.push('/premium?context=profile');
    }
    setTimeout(() => { isPushing.current = false; }, 800);
  }

  return (
    <Animated.View
      style={[
        p.wrap,
        {
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: scaleAnim },
          ],
        },
      ]}
    >
      <Pressable
        style={p.pressable}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={hasZainlyPlus ? 'Gérer mon abonnement Zainly+' : 'Découvrir Zainly+'}
      >
        <View style={p.card}>
          {/* Base deep-green fill */}
          <View style={p.cardBg} pointerEvents="none" />

          {/* Layered organic circles — several green tones, softly
              overlapping, simulate depth/gradient using only existing
              palette tones (no gradient lib, no new colors). The lightest
              layer breathes very faintly (translateY + opacity). */}
          <Animated.View
            style={[p.toneLight, { transform: [{ translateY: breatheY }] }]}
            pointerEvents="none"
          />
          <View style={p.toneMid} pointerEvents="none" />
          <View style={p.toneDark} pointerEvents="none" />

          {/* Subtle gold accent — soft radial wash, top right */}
          <View style={p.goldAccent} pointerEvents="none" />

          {/* Extremely slow, faint shimmer sweep */}
          <Animated.View pointerEvents="none" style={[p.shimmer, { left: shimmerLeft }]} />

          {/* Fine corner ornaments — thin gold L-brackets, top-left and
              bottom-right, matching the reference mockup */}
          <View style={p.cornerTL} pointerEvents="none" />
          <View style={p.cornerBR} pointerEvents="none" />

          <View style={p.content}>
            <View style={p.headerRow}>
              <Text style={p.brandName}>Zainly+</Text>
              {hasZainlyPlus ? (
                <View style={p.badgeActive}>
                  <Text style={p.badgeActiveText}>Actif</Text>
                </View>
              ) : null}
            </View>

            {hasZainlyPlus ? (
              <>
                <Text style={p.headline}>Sessions illimitées</Text>
                <Text style={p.subline}>
                  Ton accès est actif. Mémorise sans limite quotidienne.
                </Text>
              </>
            ) : (
              <>
                <Text style={p.headline}>Passe à Zainly+</Text>
                <Text style={p.subline}>
                  Débloque les sessions guidées sans limite quotidienne.
                </Text>
                <View style={p.ctaRow}>
                  <Text style={p.ctaText}>Découvrir</Text>
                  <Text style={p.ctaArrow}>{'\u2192'}</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── BellIcon — pure-View bell silhouette, no SVG/emoji ────────────────────
// Drawn with nested Views and border-radius to create a clean, premium bell
// shape in beige on a deep-green circle — avoids the cheap emoji glyph look.

function BellIcon({ color, size = 24 }: { color: string; size?: number }) {
  const s = size;
  const knob = Math.round(s * 0.14);
  const bodyW = Math.round(s * 0.58);
  const bodyH = Math.round(s * 0.50);
  const rimW = Math.round(s * 0.72);
  const rimH = Math.round(s * 0.10);
  const clapper = Math.round(s * 0.12);
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Knob */}
      <View style={{
        width: knob, height: knob, borderRadius: knob / 2,
        backgroundColor: color, marginBottom: 1,
      }} />
      {/* Bell body — dome via asymmetric border radii */}
      <View style={{
        width: bodyW, height: bodyH,
        borderTopLeftRadius: bodyW / 2, borderTopRightRadius: bodyW / 2,
        borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
        backgroundColor: color,
      }} />
      {/* Rim — slightly wider than body */}
      <View style={{
        width: rimW, height: rimH, borderRadius: rimH / 2,
        backgroundColor: color, marginTop: -1,
      }} />
      {/* Clapper */}
      <View style={{
        width: clapper, height: clapper, borderRadius: clapper / 2,
        backgroundColor: color, marginTop: 1,
      }} />
    </View>
  );
}

// ─── SettingsCard — single Apple-Settings-style card ────────────────────────

function SettingsCard({ anim }: { anim: Animated.Value }) {
  const { uiState, errorMsg } = useNotificationSettings();

  const isEnabled = uiState === 'enabled';

  function handlePress() {
    hapticLight();
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => {});
    } else {
      Linking.openSettings().catch(() => {});
    }
  }

  return (
    <Animated.View
      style={[
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        },
      ]}
    >
      <View style={g.card}>
        <Pressable
          style={({ pressed }) => [g.row, pressed && g.rowPressed]}
          onPress={handlePress}
          accessibilityRole="button"
          accessibilityLabel={`Rappel quotidien, ${isEnabled ? 'activé' : 'désactivé'}`}
          accessibilityHint="Ouvre les réglages de notifications"
        >
          <View style={g.iconCircle}>
            <BellIcon color={colors.goldSoft} size={22} />
          </View>
          <View style={g.textWrap}>
            <Text style={g.rowTitle}>Rappel quotidien</Text>
            <Text style={g.rowSubtitle}>
              {isEnabled
                ? 'Reçois un rappel chaque jour pour continuer ton Hifz.'
                : 'Active les notifications dans les réglages.'}
            </Text>
            {errorMsg ? <Text style={g.rowError}>{errorMsg}</Text> : null}
          </View>
          <View style={g.controlWrap}>
            {uiState === 'loading' ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              // Chevron, matching the reference mockup — same tap target/
              // behavior as before, only the visual indicator changed.
              <Text style={g.chevron}>{'\u203A'}</Text>
            )}
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── ProfileScreen ──────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { confirmLogout, isLoggingOut, performLogout } = useLogout();
  const user = useAuthStore((s) => s.session?.user);
  const userId = user?.id;
  const { data: profile } = useProfile(userId);
  const { hasZainlyPlus } = useZainlyPlusAccess(userId);
  const { restore, isRestoring } = useRestorePurchases(userId);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const isDeletingRef = useRef(false);
  const logoutScale = useRef(new Animated.Value(1)).current;

  const headerAnim   = useRef(new Animated.Value(0)).current;
  const premiumAnim  = useRef(new Animated.Value(0)).current;
  const settingsAnim = useRef(new Animated.Value(0)).current;
  const accountAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const seq = Animated.stagger(140, [
      Animated.timing(headerAnim,   { toValue: 1, duration: 550, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(premiumAnim,  { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(settingsAnim, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(accountAnim,  { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    seq.start();
    return () => seq.stop();
  }, [headerAnim, premiumAnim, settingsAnim, accountAnim]);

  async function handleRestorePurchases() {
    if (isRestoring) return;
    hapticMedium();
    const result = await restore();
    if (result.ok) {
      if (result.hasEntitlement) {
        hapticLight();
        Alert.alert('Achats restaurés', 'Ton accès Zainly+ est actif.');
      } else {
        const storeLabel = Platform.OS === 'android' ? 'Google Play' : 'Apple';
        Alert.alert('Aucun achat trouvé', `Aucun abonnement Zainly+ actif n'a été trouvé sur ce compte ${storeLabel}.`);
      }
    } else if (result.reason !== 'already_restoring') {
      Alert.alert(
        'Restauration impossible',
        'Une erreur est survenue pendant la restauration. Réessaie dans quelques instants.'
      );
    }
  }

  async function performAccountDeletion() {
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;
    setIsDeletingAccount(true);

    const result = await deleteAccountSelfService();

    if (result.ok) {
      await AsyncStorage.setItem('account_deleted_success', 'true').catch(() => {});
      await performLogout({ preserveDeletionFlag: true });
      return;
    }

    isDeletingRef.current = false;
    setIsDeletingAccount(false);

    const message =
      result.error === 'unauthorized'
        ? 'Ta session a expiré. Reconnecte-toi puis réessaie.'
        : result.error === 'network'
          ? 'Vérifie ta connexion internet puis réessaie.'
          : 'Impossible de supprimer ton compte pour le moment. Réessaie dans un instant.';

    Alert.alert('Suppression impossible', message);
  }

  function confirmDeletion() {
    const subscriptionNote = hasZainlyPlus
      ? `\n\nTon abonnement Zainly+ ne sera pas annulé automatiquement : annule-le depuis les réglages ${Platform.OS === 'android' ? 'Google Play' : 'de l\u2019App Store'} pour éviter un renouvellement.`
      : '';
    Alert.alert(
      'Supprimer ton compte ?',
      `Cette action supprime définitivement ton compte Zainly et toutes tes données (programme, progression, révisions). Elle est irréversible.${subscriptionNote}`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer définitivement', style: 'destructive', onPress: performAccountDeletion },
      ]
    );
  }

  function handleLogoutPressIn() {
    Animated.timing(logoutScale, { toValue: 0.97, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }
  function handleLogoutPressOut() {
    Animated.timing(logoutScale, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }

  const firstName = profile?.first_name ?? null;
  const email = user?.email ?? null;

  return (
    <Screen>
      {/* Header */}
      <Animated.View
        style={[
          s.header,
          {
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          },
        ]}
      >
        <Text style={s.eyebrow}>MON COMPTE</Text>
        <Text style={s.title}>Profil</Text>
        {firstName ? <Text style={s.firstName}>{firstName}</Text> : null}
        {email ? <Text style={s.email}>{email}</Text> : null}
      </Animated.View>

      {/* Premium card — focal point */}
      <PremiumCard hasZainlyPlus={hasZainlyPlus} anim={premiumAnim} userId={userId} />

      {/* Restore purchases — discreet link, never competes with the card */}
      <Pressable
        style={({ pressed }) => [s.restoreLink, pressed && s.restoreLinkPressed]}
        onPress={handleRestorePurchases}
        disabled={isRestoring}
        accessibilityRole="button"
        accessibilityLabel="Restaurer mes achats"
        accessibilityState={{ disabled: isRestoring }}
      >
        {isRestoring ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          <Text style={s.restoreText}>Restaurer mes achats</Text>
        )}
      </Pressable>

      {/* Réglages */}
      <Animated.View style={[s.sectionWrap, { opacity: settingsAnim }]}>
        <Text style={s.sectionLabel}>RÉGLAGES</Text>
        <SettingsCard anim={settingsAnim} />
      </Animated.View>

      {/* Compte */}
      <Animated.View
        style={[
          s.accountWrap,
          {
            opacity: accountAnim,
            transform: [{ translateY: accountAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
          },
        ]}
      >
        <Animated.View style={{ width: '100%', transform: [{ scale: logoutScale }] }}>
          <Pressable
            style={s.logoutBtn}
            onPress={confirmLogout}
            onPressIn={handleLogoutPressIn}
            onPressOut={handleLogoutPressOut}
            disabled={isLoggingOut}
            accessibilityRole="button"
            accessibilityLabel="Se déconnecter"
            accessibilityState={{ disabled: isLoggingOut }}
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                {/* Monochrome glyph approximating SF Symbol
                    "rectangle.portrait.and.arrow.right" — expo-symbols would
                    require a native rebuild of the dev client (see chat). */}
                <Text style={s.logoutIcon}>{'\u21E5'}</Text>
                <Text style={s.logoutText}>Se déconnecter</Text>
              </>
            )}
          </Pressable>
        </Animated.View>

        <Pressable
          style={({ pressed }) => [s.deleteLink, pressed && s.deleteLinkPressed]}
          onPress={confirmDeletion}
          disabled={isDeletingAccount}
          accessibilityRole="button"
          accessibilityLabel="Supprimer mon compte"
        >
          <Text style={s.deleteLinkText}>
            {isDeletingAccount ? 'Suppression\u2026' : 'Supprimer mon compte'}
          </Text>
        </Pressable>
      </Animated.View>
    </Screen>
  );
}

// ─── Styles: screen ──────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 20,
  },
  firstName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 8, // grid: nom → email
  },
  email: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 28, // grid: email → carte premium
  },
  restoreLink: {
    alignSelf: 'center',
    marginTop: 18, // grid: carte → restaurer mes achats
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  restoreLinkPressed: { opacity: 0.55 },
  restoreText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: colors.muted,
  },
  sectionWrap: {
    marginTop: 36, // grid: restaurer mes achats → réglages
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.gold,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  accountWrap: {
    marginTop: 32, // grid: réglages → déconnexion
    alignItems: 'center',
  },
  logoutBtn: {
    width: '100%',
    height: 56, // same height as the main "Aujourd'hui" CTA (app/(app)/(tabs)/index.tsx)
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(180,35,24,0.07)',
    borderRadius: 16,
    gap: 8,
  },
  logoutIcon: {
    fontSize: 17,
    color: colors.danger,
    fontWeight: '600',
  },
  logoutText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: colors.danger,
  },
  deleteLink: {
    marginTop: 20, // grid: déconnexion → supprimer mon compte
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deleteLinkPressed: { opacity: 0.55 },
  deleteLinkText: {
    fontSize: 13,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
});

// ─── Styles: premium card ────────────────────────────────────────────────────

const p = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  pressable: {
    borderRadius: 28,
    // Soft, diffuse shadow — never black. Same technique already used for
    // the main CTA on the "Aujourd'hui" screen (shadowColor: colors.primary).
    shadowColor: colors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    minHeight: 168,
    backgroundColor: colors.primary,
  },
  cardBg: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.primary,
  },
  // Faint lighter wash, top-left — reads as a soft highlight catching light.
  toneLight: {
    position: 'absolute',
    top: -50, left: -70,
    width: 280, height: 280,
    borderRadius: 140,
    backgroundColor: colors.primarySoft,
    opacity: 0.5,
  },
  // Second, smaller organic circle — mid-tone, bottom-left. Purely additive
  // depth layer, same palette-only technique.
  toneMid: {
    position: 'absolute',
    bottom: -30, left: 40,
    width: 160, height: 160,
    borderRadius: 80,
    backgroundColor: colors.primarySoft,
    opacity: 0.22,
  },
  // Faint darker wash, bottom-right — reads as depth/shadow falling away.
  // Black overlay (same technique as shadowColor '#000' used app-wide) —
  // never a new palette color, just a translucent shading layer.
  toneDark: {
    position: 'absolute',
    bottom: -70, right: -50,
    width: 260, height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  goldAccent: {
    position: 'absolute',
    top: -80, right: -60,
    width: 240, height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(184,150,46,0.10)',
  },
  shimmer: {
    position: 'absolute',
    top: 0, width: '28%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.045)',
    transform: [{ skewX: '-18deg' }],
  },
  // Fine corner ornaments — thin gold L-brackets, matching the reference
  // mockup exactly (top-left + bottom-right).
  cornerTL: {
    position: 'absolute',
    top: 14, left: 14,
    width: 14, height: 14,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(184,150,46,0.40)',
  },
  cornerBR: {
    position: 'absolute',
    bottom: 14, right: 14,
    width: 14, height: 14,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(184,150,46,0.40)',
  },
  content: {
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  brandName: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.gold,
    letterSpacing: 0.4,
  },
  badgeActive: {
    backgroundColor: 'rgba(184,150,46,0.16)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(184,150,46,0.30)',
  },
  badgeActiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
  },
  headline: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
    lineHeight: 23,
  },
  subline: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 18,
  },
  // Text + arrow link — matches the reference mockup exactly.
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.gold,
  },
  ctaArrow: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.gold,
    marginLeft: 7,
  },
});

// ─── Styles: settings card ────────────────────────────────────────────────────

const g = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { opacity: 0.85 },
  iconCircle: {
    width: 42, height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  textWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    fontSize: 15.5,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 3,
  },
  rowSubtitle: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 17,
  },
  rowError: {
    fontSize: 11,
    color: colors.danger,
    marginTop: 4,
    lineHeight: 16,
  },
  controlWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 28,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.muted,
    lineHeight: 24,
  },
});
