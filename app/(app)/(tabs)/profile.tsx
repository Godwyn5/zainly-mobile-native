import { useState } from 'react';
import { ActivityIndicator, Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { useAuthStore } from '@/store/authStore';
import { useProfile } from '@/hooks/useProfile';
import { useLogout } from '@/hooks/useLogout';
import { requestAccountDeletion } from '@/db/accountDeletion';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { PRESETS, NotificationPreset } from '@/notifications/types';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

// ─── ProfileRow – "Bientôt" placeholder row ───────────────────────────────────

interface ProfileRowProps {
  title: string;
  description: string;
}

function ProfileRow({ title, description }: ProfileRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
      </View>
      <View style={styles.soonBadge}>
        <Text style={styles.soonText}>Bientôt</Text>
      </View>
    </View>
  );
}

// ─── NotificationsCard ────────────────────────────────────────────────────────

function NotificationsCard() {
  const {
    uiState, settings, isBusy, testSent, testMsg, errorMsg,
    enable, disable, changePreset, sendTest, openSystemSettings,
  } = useNotificationSettings();

  const presetKeys: NotificationPreset[] = ['morning', 'afternoon', 'evening'];

  const subtitle = uiState === 'enabled'
    ? `Rappel quotidien à ${String(settings.hour).padStart(2, '0')}h${String(settings.minute).padStart(2, '0')}.`
    : uiState === 'denied'
      ? 'Notifications désactivées dans les réglages.'
      : 'Reçois un rappel doux pour garder ton Hifz vivant.';

  if (uiState === 'loading') {
    return (
      <View style={n.card}>
        <View style={n.accentBar} />
        <View style={n.body}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={n.card}>
      <View style={n.accentBar} />
      <View style={n.body}>

        {/* Header row */}
        <View style={n.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={n.title}>Notifications</Text>
            <Text style={n.subtitle}>{subtitle}</Text>
          </View>
          {/* Toggle pill when enabled */}
          {uiState === 'enabled' && (
            <Pressable
              style={[n.togglePill, n.toggleOn]}
              onPress={disable}
              disabled={isBusy}
            >
              {isBusy
                ? <ActivityIndicator size="small" color={colors.surface} style={{ width: 14, height: 14 }} />
                : <Text style={n.toggleOnText}>Activé</Text>}
            </Pressable>
          )}
        </View>

        {/* Error message */}
        {errorMsg ? (
          <Text style={n.errorMsg}>{errorMsg}</Text>
        ) : null}

        {/* Preset selector — only when enabled */}
        {uiState === 'enabled' && (
          <View style={n.presetRow}>
            {presetKeys.map(key => {
              const p     = PRESETS[key];
              const active = settings.preset === key;
              return (
                <Pressable
                  key={key}
                  style={[n.presetBtn, active && n.presetBtnActive]}
                  onPress={() => changePreset(key)}
                  disabled={isBusy}
                >
                  <Text style={[n.presetLabel, active && n.presetLabelActive]}>
                    {p.label}
                  </Text>
                  <Text style={[n.presetTime, active && n.presetTimeActive]}>
                    {String(p.hour).padStart(2, '0')}h{String(p.minute).padStart(2, '0')}
                  </Text>
                  {key === 'evening' && (
                    <View style={n.recoBadge}>
                      <Text style={n.recoBadgeText}>Recommandé</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* CTA row */}
        <View style={n.ctaRow}>
          {uiState === 'disabled' && (
            <Pressable
              style={[n.ctaBtn, n.ctaBtnPrimary, isBusy && n.ctaBtnDisabled]}
              onPress={enable}
              disabled={isBusy}
            >
              {isBusy
                ? <ActivityIndicator size="small" color={colors.surface} style={{ width: 14, height: 14 }} />
                : <Text style={n.ctaBtnPrimaryText}>Activer</Text>}
            </Pressable>
          )}

          {uiState === 'denied' && (
            <Pressable style={[n.ctaBtn, n.ctaBtnSecondary]} onPress={openSystemSettings}>
              <Text style={n.ctaBtnSecondaryText}>Ouvrir les réglages</Text>
            </Pressable>
          )}

          {uiState === 'enabled' && (
            <Pressable
              style={[n.ctaBtn, n.ctaBtnSecondary, isBusy && n.ctaBtnDisabled]}
              onPress={sendTest}
              disabled={isBusy}
            >
              {testSent
                ? <Text style={[n.ctaBtnSecondaryText, { color: colors.success }]}>Envoyé !</Text>
                : isBusy
                  ? <ActivityIndicator size="small" color={colors.primary} style={{ width: 14, height: 14 }} />
                  : <Text style={n.ctaBtnSecondaryText}>Envoyer un test</Text>}
            </Pressable>
          )}
        </View>

        {/* Test status line */}
        {testMsg ? (
          <Text style={n.testStatus}>{testMsg}</Text>
        ) : null}

        {/* Fine print */}
        {uiState === 'disabled' && (
          <Text style={n.finePrint}>
            Une seule notification par jour. Tu peux la désactiver à tout moment.
          </Text>
        )}

      </View>
    </View>
  );
}

// ─── SubscriptionCard ─────────────────────────────────────────────────────────

function SubscriptionCard({ hasZainlyPlus }: { hasZainlyPlus: boolean }) {
  if (hasZainlyPlus) {
    return (
      <View style={sub.card}>
        <View style={sub.accentBar} />
        <View style={sub.body}>
          <View style={sub.headerRow}>
            <Text style={sub.title}>Zainly+</Text>
            <View style={sub.badgeActive}>
              <Text style={sub.badgeActiveText}>Actif</Text>
            </View>
          </View>
          <Text style={sub.desc}>Sessions guidées sans limite quotidienne.</Text>
          <Text style={sub.secondary}>Ton accès Zainly+ est actif sur ce compte.</Text>
          <Pressable
            style={({ pressed }) => [sub.btnSecondary, pressed && sub.btnPressed]}
            onPress={() => {
              // TODO Zainly+: replace with RevenueCat subscription management.
              Alert.alert(
                'Bientôt disponible',
                'La gestion de l’abonnement sera disponible avec les achats intégrés.'
              );
            }}
          >
            <Text style={sub.btnSecondaryText}>Gérer l’abonnement</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [sub.linkBtn, pressed && sub.btnPressed]}
            onPress={() => {
              // TODO Zainly+: replace with RevenueCat restorePurchases call.
              Alert.alert(
                'Bientôt disponible',
                'La restauration des achats sera disponible avec les achats intégrés.'
              );
            }}
          >
            <Text style={sub.linkBtnText}>Restaurer mes achats</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={sub.card}>
      <View style={sub.accentBar} />
      <View style={sub.body}>
        <View style={sub.headerRow}>
          <Text style={sub.title}>Zainly Free</Text>
          <View style={sub.badgeFree}>
            <Text style={sub.badgeFreeText}>Gratuit</Text>
          </View>
        </View>
        <Text style={sub.desc}>1 ayat guidé par jour.</Text>
        <Text style={sub.secondary}>
          Passe à Zainly+ pour débloquer les sessions guidées sans limite quotidienne.
        </Text>
        <Pressable
          style={({ pressed }) => [sub.btnPrimary, pressed && sub.btnPressed]}
          onPress={() => router.push('/premium?context=profile')}
        >
          <Text style={sub.btnPrimaryText}>Découvrir Zainly+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── ProfileScreen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { confirmLogout, isLoggingOut } = useLogout();
  const userId = useAuthStore((s) => s.session?.user.id);
  const userEmail = useAuthStore((s) => s.session?.user.email);
  const { data: profileData } = useProfile(userId);
  // TODO Zainly+: replace profile.is_premium with entitlement-backed access from RevenueCat/Supabase.
  const hasZainlyPlus = profileData?.is_premium === true;
  const [requestingDeletion, setRequestingDeletion] = useState(false);

  async function performDeletionRequest() {
    if (!userId || requestingDeletion) return;
    setRequestingDeletion(true);
    const { error } = await requestAccountDeletion({ userId, email: userEmail ?? null });
    setRequestingDeletion(false);

    if (!error) {
      Alert.alert(
        'Demande envoyée',
        'Ta demande de suppression a été enregistrée. Nous la traiterons dans les meilleurs délais.'
      );
      return;
    }

    if (error === 'already_requested') {
      Alert.alert(
        'Demande déjà envoyée',
        'Une demande de suppression est déjà enregistrée pour ce compte.'
      );
      return;
    }

    Alert.alert(
      'Erreur',
      'Impossible d’envoyer la demande pour le moment. Réessaie plus tard.'
    );
  }

  function confirmDeletion() {
    Alert.alert(
      'Supprimer ton compte ?',
      'Cette action enverra une demande de suppression de ton compte et de tes données Zainly. Elle sera traitée dans les meilleurs délais. Cette action ne peut pas être annulée une fois la demande envoyée.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Envoyer la demande', style: 'destructive', onPress: performDeletionRequest },
      ]
    );
  }

  return (
    <Screen>
      <SectionLabel text="Mon compte" style={styles.badge} />
      <Text style={styles.title}>Profil</Text>
      <Text style={styles.subtitle}>Personnalise ton expérience Zainly.</Text>

      {/* ── Notifications ── */}
      <SectionLabel text="Notifications" style={styles.sectionLabel} />
      <NotificationsCard />

      {/* ── Abonnement ── */}
      <SectionLabel text="Abonnement" style={styles.sectionLabel} />
      <SubscriptionCard hasZainlyPlus={hasZainlyPlus} />

      {/* ── Bientôt ── */}
      <SectionLabel text="Personnalisation" style={styles.sectionLabel} />
      <View style={styles.card}>
        <ProfileRow
          title="Récitateur"
          description="Choisir la voix qui accompagnera tes sessions."
        />
        <View style={styles.divider} />
        <ProfileRow
          title="Programme"
          description="Modifier ton rythme ou ton objectif."
        />
      </View>

      {/* ── Compte section ── */}
      <SectionLabel text="Compte" style={styles.sectionLabel} />
      <View style={styles.card}>
        <Pressable
          style={({ pressed }) => [
            styles.logoutRow,
            isLoggingOut && styles.logoutRowDisabled,
            pressed && !isLoggingOut && styles.logoutRowPressed,
          ]}
          onPress={confirmLogout}
          disabled={isLoggingOut}
        >
          <Text style={[styles.logoutText, isLoggingOut && styles.logoutTextDim]}>
            {isLoggingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          style={({ pressed }) => [
            styles.logoutRow,
            requestingDeletion && styles.logoutRowDisabled,
            pressed && !requestingDeletion && styles.logoutRowPressed,
          ]}
          onPress={confirmDeletion}
          disabled={requestingDeletion}
        >
          <Text style={[styles.logoutText, requestingDeletion && styles.logoutTextDim]}>
            {requestingDeletion ? 'Envoi…' : 'Supprimer mon compte'}
          </Text>
          <Text style={styles.deleteDesc}>
            Envoyer une demande de suppression de ton compte et de tes données.
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

// ─── Styles: profile ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  badge: { marginTop: spacing.sm },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  sectionLabel: { marginTop: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 3,
  },
  rowDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  soonBadge: {
    backgroundColor: colors.goldSoft,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  soonText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.gold,
    letterSpacing: 0.2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  logoutRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  logoutRowDisabled: { opacity: 0.5 },
  logoutRowPressed:   { opacity: 0.65 },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  logoutTextDim: { color: colors.muted },
  deleteDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 4,
  },
});

// ─── Styles: notifications card ───────────────────────────────────────────────

const n = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  accentBar: {
    width: 4,
    backgroundColor: colors.gold,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  errorMsg: {
    fontSize: 11,
    color: colors.danger,
    marginBottom: 8,
    lineHeight: 16,
  },
  // Toggle pill (enabled state header)
  togglePill: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  toggleOn: {
    backgroundColor: colors.primary,
  },
  toggleOnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.surface,
    letterSpacing: 0.2,
  },
  // Preset selector
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  presetBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
  },
  presetBtnActive: {
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
  },
  presetLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.1,
  },
  presetLabelActive: {
    color: colors.primary,
  },
  presetTime: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: -0.2,
  },
  presetTimeActive: {
    color: colors.gold,
  },
  recoBadge: {
    marginTop: 2,
    backgroundColor: colors.gold,
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  recoBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.surface,
    letterSpacing: 0.3,
  },
  // CTA
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  ctaBtn: {
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  ctaBtnPrimary: {
    backgroundColor: colors.primary,
  },
  ctaBtnPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.surface,
    letterSpacing: 0.2,
  },
  ctaBtnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  ctaBtnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  ctaBtnDisabled: {
    opacity: 0.5,
  },
  // Test status line
  testStatus: {
    fontSize: 11,
    color: colors.success,
    lineHeight: 16,
    marginTop: 6,
    fontStyle: 'italic',
  },
  // Fine print
  finePrint: {
    fontSize: 10.5,
    color: colors.muted,
    lineHeight: 15,
    marginTop: 8,
    fontStyle: 'italic',
  },
});

// ─── Styles: subscription card ────────────────────────────────────────────────

const sub = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  accentBar: {
    width: 4,
    backgroundColor: colors.gold,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  badgeFree: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeFreeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  badgeActive: {
    backgroundColor: colors.goldSoft,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeActiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
  },
  desc: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 4,
  },
  secondary: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.surface,
  },
  btnSecondary: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  btnSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  linkBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  linkBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  btnPressed: { opacity: 0.75 },
});
