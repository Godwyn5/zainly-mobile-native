import { useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Pressable,
  Animated, Easing, Dimensions,
} from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { useProgress } from '@/hooks/useProgress';
import { usePlan } from '@/hooks/usePlan';
import { useLearnedItems } from '@/hooks/useLearnedItems';
import { useAuthStore } from '@/store/authStore';
import { getSurahName } from '@/data/quran';
import { ZAINLY_ORDER, ZAINLY_INDEX_BY_SURAH } from '@/core/zainlyOrder';
import {
  computeHifzProgressMetrics,
  QURAN_TOTAL_AYATS,
} from '@/core/hifzProgressMetrics';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

// ─── Constants ────────────────────────────────────────────────────────────────

const SW           = Dimensions.get('window').width;
const WEEK_HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function safeSessionDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
}

function sessionsThisMonth(dates: string[]): number {
  const now    = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return dates.filter(d => d.startsWith(prefix)).length;
}

/** Percentage string — always uses plain spaces, no unicode escapes in output. */
function pctStr(ratio: number): string {
  const pct = ratio * 100;
  if (pct <= 0)  return '0 % du Coran';
  if (pct < 0.1) return '< 0,1 % du Coran';
  return `${pct.toFixed(1).replace('.', ',')} % du Coran`;
}

/** Build monthly calendar grid: rows of 7 cells (Mon=0), null = padding. */
function buildMonthCalendar(year: number, month: number): (string | null)[][] {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (string | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let r = 0; r < cells.length / 7; r++) rows.push(cells.slice(r * 7, r * 7 + 7));
  return rows;
}

// ─── AnimatedProgressBar ─────────────────────────────────────────────────────

function AnimatedProgressBar({ progress, delay = 400, height = 8 }: {
  progress: number; delay?: number; height?: number;
}) {
  const mountedRef  = useRef(true);
  const fillAnim    = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(-1)).current;
  const shimmerLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const pct  = Math.min(Math.max(progress, 0), 1);
    const fill = Animated.timing(fillAnim, {
      toValue: pct, duration: 1000, delay,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    });
    fill.start(() => {
      if (!mountedRef.current) return;
      shimmerLoop.current = Animated.loop(
        Animated.timing(shimmerAnim, {
          toValue: 1, duration: 1800,
          easing: Easing.inOut(Easing.quad), useNativeDriver: false,
        })
      );
      shimmerLoop.current.start();
    });
    return () => { mountedRef.current = false; fill.stop(); shimmerLoop.current?.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const width       = fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const shimmerLeft = shimmerAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-40%', '140%'] });

  return (
    <View style={[pb.track, { height }]}>
      <Animated.View style={[pb.fill, { width, height }]}>
        <Animated.View style={[pb.shimmer, { left: shimmerLeft }]} />
      </Animated.View>
    </View>
  );
}

const pb = StyleSheet.create({
  track:   { backgroundColor: 'rgba(184,150,46,0.15)', borderRadius: 5, overflow: 'hidden' },
  fill:    { borderRadius: 5, backgroundColor: colors.gold, overflow: 'hidden' },
  shimmer: { position: 'absolute', top: 0, width: '40%', height: '100%', backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 5 },
});

// ─── MonthCalendar — compact, no-scroll safe ─────────────────────────────────

function MonthCalendar({ sessionDates }: { sessionDates: string[] }) {
  const now      = new Date();
  const year     = now.getFullYear();
  const month    = now.getMonth();
  const todayStr = localDateStr(now);
  const dateSet  = useMemo(() => new Set(sessionDates), [sessionDates]);
  const rows     = useMemo(() => buildMonthCalendar(year, month), [year, month]);

  // Tight cell: 4px margin each side, 7 cells, inside card paddingHorizontal=spacing.md*2=32, screen padding=spacing.lg*2=48
  const cellSize = Math.floor((SW - spacing.lg * 2 - spacing.md * 2 - 7 * 4) / 7);

  return (
    <View>
      <View style={cal.headerRow}>
        {WEEK_HEADERS.map((h, i) => (
          <View key={i} style={[cal.cell, { width: cellSize, height: cellSize }]}>
            <Text style={cal.headerTxt}>{h}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={cal.row}>
          {row.map((dateStr, ci) => {
            const isToday    = dateStr === todayStr;
            const hasSession = dateStr !== null && dateSet.has(dateStr);
            const isFuture   = dateStr !== null && dateStr > todayStr;
            return (
              <View
                key={ci}
                style={[
                  cal.cell,
                  { width: cellSize, height: cellSize, borderRadius: cellSize / 2 },
                  hasSession  && cal.cellOn,
                  isToday && !hasSession && cal.cellToday,
                  (isFuture || dateStr === null) && cal.cellFaded,
                ]}
              >
                {dateStr !== null && (
                  <Text style={[
                    cal.dayTxt,
                    hasSession           && cal.dayOn,
                    isToday && !hasSession && cal.dayToday,
                    isFuture             && cal.dayFaded,
                  ]}>
                    {parseInt(dateStr.slice(8), 10)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const cal = StyleSheet.create({
  headerRow: { flexDirection: 'row', marginBottom: 2 },
  row:       { flexDirection: 'row', marginBottom: 2 },
  cell:      { alignItems: 'center', justifyContent: 'center', margin: 2 },
  cellOn:    { backgroundColor: colors.primary },
  cellToday: { borderWidth: 1.5, borderColor: colors.gold },
  cellFaded: { opacity: 0.18 },
  headerTxt: { fontSize: 9, fontWeight: '700', color: colors.muted, letterSpacing: 0.3 },
  dayTxt:    { fontSize: 10, fontWeight: '500', color: colors.primary },
  dayOn:     { color: '#FFFFFF', fontWeight: '700' },
  dayToday:  { color: colors.gold, fontWeight: '700' },
  dayFaded:  { color: colors.muted },
});

// ─── ProgressionScreen ────────────────────────────────────────────────────────

export default function ProgressionScreen() {
  const userId = useAuthStore(s => s.user?.id);

  const { data,              isLoading,              isError,     refetch } = useProgress(userId);
  const { data: plan,        isLoading: planLoading                       } = usePlan(userId);
  const { data: learnedItems, isLoading: learnedLoading                   } = useLearnedItems(userId);

  // Entrance animations — 4 elements
  const headerAnim = useRef(new Animated.Value(0)).current;
  const heroAnim   = useRef(new Animated.Value(0)).current;
  const posAnim    = useRef(new Animated.Value(0)).current;
  const calAnim    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const seq = Animated.stagger(90, [
      Animated.timing(headerAnim, { toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(heroAnim,   { toValue: 1, duration: 440, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(posAnim,    { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(calAnim,    { toValue: 1, duration: 370, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    seq.start();
    return () => seq.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fadeIn(anim: Animated.Value, dy = 12) {
    return {
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }],
    };
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading || planLoading || learnedLoading) {
    return (
      <Screen>
        <Text style={s.eyebrow}>PROGRESSION</Text>
        <Text style={s.pageTitle}>Progression</Text>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </Screen>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Screen>
        <Text style={s.eyebrow}>PROGRESSION</Text>
        <Text style={s.pageTitle}>Progression</Text>
        <View style={s.stateCard}>
          <Text style={s.stateTitle}>Impossible de charger tes données.</Text>
          <Text style={s.stateSub}>Vérifie ta connexion, puis réessaie.</Text>
          <Pressable style={s.retryBtn} onPress={() => refetch()}>
            <Text style={s.retryTxt}>Réessayer</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // ── Empty / first launch ──────────────────────────────────────────────────
  if (!data) {
    return (
      <Screen>
        <Text style={s.eyebrow}>PROGRESSION</Text>
        <Text style={s.pageTitle}>Progression</Text>
        <View style={s.hero}>
          <Text style={s.heroEyebrow}>TON HIFZ COMMENCE ICI</Text>
          <Text style={s.heroNumber}>0 ayat</Text>
          <Text style={s.heroHint}>Complète ta première session pour lancer ta progression.</Text>
        </View>
      </Screen>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fallbackTotal = typeof data.total_memorized === 'number'
    ? Math.max(0, data.total_memorized) : 0;

  // Streak & calendar
  const streak       = typeof data.streak === 'number' ? Math.max(0, data.streak) : 0;
  const sessionDates = safeSessionDates(data.session_dates);
  const monthCount   = sessionsThisMonth(sessionDates);

  // Long-term-safe Hifz metrics via set union.
  // Double-counting is avoided by ayat-key set union when exact learned items
  // are available. Count addition is never used for a combined total.
  const metrics = computeHifzProgressMetrics({
    plan,
    learnedItems: learnedItems ?? null,
    fallbackTotalMemorized: fallbackTotal,
  });

  const {
    knownBeforeAyats,
    learnedWithZainlyAyats,
    trackedHifzAyats,
    canShowTrackedTotal,
  } = metrics;

  // Hero case decision:
  //   CASE A — exact sets available AND consistent: show MON HIFZ SUIVI (set-union total).
  //   CASE B — canShowTrackedTotal=false BUT known-before ayats exist: show APPRIS AVEC
  //            ZAINLY + small note that known-before ayats are not added (no count addition).
  //   CASE C — canShowTrackedTotal=false, no known-before: show APPRIS AVEC ZAINLY only.
  const caseA = canShowTrackedTotal && (knownBeforeAyats > 0 || learnedWithZainlyAyats > 0);
  const caseB = !canShowTrackedTotal && knownBeforeAyats > 0;
  const trackedRatio = caseA ? Math.min(trackedHifzAyats / QURAN_TOTAL_AYATS, 1) : null;
  const zainlyRatio  = Math.min(learnedWithZainlyAyats / QURAN_TOTAL_AYATS, 1);

  // Current position — current_ayah is the LAST completed ayah in current_surah
  // (0 = none yet). It is never used as a learned-count numerator. The next ayat
  // to display is current_ayah + 1, bounded by the surah's total ayat count.
  const hasSurahNum      = typeof data.current_surah === 'number'
    && data.current_surah >= 1 && data.current_surah <= 114;
  const surahNum         = hasSurahNum ? data.current_surah as number : null;
  const surahTotalAyats  = surahNum !== null
    ? (ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[surahNum]]?.ayahs ?? 0)
    : 0;
  const lastCompletedAyah = typeof data.current_ayah === 'number' ? Math.max(0, data.current_ayah) : 0;
  // Fresh user: no ayah completed yet in the current surah.
  const isFreshStart     = hasSurahNum && lastCompletedAyah === 0 && learnedWithZainlyAyats === 0;
  const hasNextAyah      = hasSurahNum && lastCompletedAyah < surahTotalAyats;
  const nextAyah         = hasNextAyah ? lastCompletedAyah + 1 : null;
  // For a fresh user, fall back to plan.start_ayah (or 1) as the starting ayah display.
  const startAyah     = isFreshStart
    ? (typeof plan?.start_ayah === 'number' && plan.start_ayah >= 1 ? plan.start_ayah : 1)
    : null;
  const surahName     = surahNum !== null ? (getSurahName(surahNum) ?? `Sourate ${surahNum}`) : null;

  // Next step text — plain spaces, no unicode escape sequences
  const nextStepText =
    learnedWithZainlyAyats === 0
      ? 'Complète ta première session pour démarrer.'
      : nextAyah !== null && surahName !== null
        ? `Prochaine session : continue à partir de l'ayat ${nextAyah} de ${surahName}.`
        : streak < 3
          ? 'Continue avec ta prochaine session pour installer ton rythme.'
          : 'Continue à protéger ta régularité.';

  // Session summary — plain spaces
  const sessionSummary = (() => {
    const parts: string[] = [];
    if (monthCount === 0)      parts.push('Aucune session ce mois-ci');
    else if (monthCount === 1) parts.push('1 session');
    else                       parts.push(`${monthCount} sessions`);
    if (streak > 0) parts.push(`${streak} jour${streak > 1 ? 's' : ''} de série`);
    return parts.join(' · ');
  })();

  return (
    <Screen scroll={false} contentStyle={s.screenContent}>

      {/* ══ 1. HEADER ═══════════════════════════════════════════════ */}
      <Animated.View style={fadeIn(headerAnim, 10)}>
        <Text style={s.eyebrow}>PROGRESSION</Text>
        <Text style={s.pageTitle}>Progression</Text>
        <Text style={s.pageSubtitle}>Ce que tu bâtis, session après session.</Text>
      </Animated.View>

      {/* ══ 2. HERO ═════════════════════════════════════════════════ */}
      <Animated.View style={fadeIn(heroAnim, 14)}>
        <View style={s.hero}>

          {caseA ? (
            // CASE A — exact sets available: union gives honest combined total.
            // Double-counting is avoided by ayat-key set union (not count addition).
            <>
              <Text style={s.heroEyebrow}>MON HIFZ SUIVI</Text>
              <View style={s.heroValueRow}>
                <Text style={s.heroNumber}>{trackedHifzAyats.toLocaleString('fr-FR')}</Text>
                <Text style={s.heroDenom}>/ {QURAN_TOTAL_AYATS.toLocaleString('fr-FR')} ayats</Text>
              </View>
              <View style={s.barWrap}>
                <AnimatedProgressBar progress={trackedRatio!} delay={500} height={7} />
              </View>
              <Text style={s.heroPct}>{pctStr(trackedRatio!)}</Text>
              <View style={s.heroBreakdown}>
                <Text style={s.heroBreakdownTxt}>
                  {knownBeforeAyats.toLocaleString('fr-FR')} déjà connus
                </Text>
                <Text style={s.heroBreakdownSep}>·</Text>
                <Text style={s.heroBreakdownTxt}>
                  {learnedWithZainlyAyats.toLocaleString('fr-FR')} appris avec Zainly
                </Text>
              </View>
            </>
          ) : (
            // CASE B or C — exact data missing or inconsistent: Zainly count only.
            // Count addition is never used for a combined total.
            <>
              <Text style={s.heroEyebrow}>APPRIS AVEC ZAINLY</Text>
              <View style={s.heroValueRow}>
                <Text style={s.heroNumber}>{learnedWithZainlyAyats.toLocaleString('fr-FR')}</Text>
                <Text style={s.heroDenom}>
                  {learnedWithZainlyAyats === 1 ? 'ayat' : 'ayats'}
                </Text>
              </View>
              {learnedWithZainlyAyats > 0 && (
                <View style={s.barWrap}>
                  <AnimatedProgressBar progress={zainlyRatio} delay={500} height={7} />
                </View>
              )}
              <Text style={s.heroPct}>
                {learnedWithZainlyAyats > 0 ? pctStr(zainlyRatio) : 'Basé sur tes sessions Zainly.'}
              </Text>
              {caseB && (
                <Text style={s.heroNote}>
                  Les ayats connus au départ ne sont pas additionnés ici pour éviter un double comptage.
                </Text>
              )}
            </>
          )}

        </View>
      </Animated.View>

      {/* ══ 3. POSITION ACTUELLE ════════════════════════════════════ */}
      {isFreshStart && surahName !== null ? (
        <Animated.View style={fadeIn(posAnim, 10)}>
          <View style={s.card}>
            <Text style={s.cardEyebrow}>POINT DE DÉPART</Text>
            <Text style={s.posMain}>Ton parcours commence ici</Text>
            <Text style={s.posSub}>
              {`Première session : ${surahName} — Ayat ${startAyah}`}
            </Text>
          </View>
        </Animated.View>
      ) : surahName !== null && nextAyah !== null ? (
        <Animated.View style={fadeIn(posAnim, 10)}>
          <View style={s.card}>
            <Text style={s.cardEyebrow}>POSITION ACTUELLE</Text>
            <Text style={s.posMain}>{surahName} — Ayat {nextAyah}</Text>
            <Text style={s.posSub}>{nextStepText}</Text>
          </View>
        </Animated.View>
      ) : null}

      {/* ══ 4. CE MOIS-CI — compact monthly calendar ════════════════ */}
      <Animated.View style={[{ flex: 1 }, fadeIn(calAnim, 10)]}>
        <View style={[s.card, s.calCard]}>
          <View style={s.calHeader}>
            <Text style={s.cardEyebrow}>CE MOIS-CI</Text>
            <Text style={s.calMeta}>{sessionSummary}</Text>
          </View>
          <MonthCalendar sessionDates={sessionDates} />
          {/* next step when position is not available */}
          {(surahName === null || nextAyah === null) && (
            <Text style={s.calNote}>{nextStepText}</Text>
          )}
        </View>
      </Animated.View>

    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

  screenContent: {
    flex: 1,
    paddingTop: spacing.sm,
  },

  // ── Header ──
  eyebrow: {
    fontSize: 10, fontWeight: '700', letterSpacing: 2.5,
    color: colors.gold, textTransform: 'uppercase', marginBottom: 2,
  },
  pageTitle: {
    fontSize: 24, fontWeight: '800', color: colors.primary,
    letterSpacing: -0.5, marginBottom: 1,
  },
  pageSubtitle: {
    fontSize: 11, color: colors.muted, lineHeight: 16, marginBottom: spacing.xs,
  },

  // ── Hero — full-bleed deep green ──
  hero: {
    backgroundColor: colors.primary,
    marginHorizontal: -spacing.lg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000', shadowOpacity: 0.18,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    borderBottomWidth: 1, borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 0,
    borderColor: 'rgba(184,150,46,0.22)',
  },
  heroEyebrow: {
    fontSize: 9, fontWeight: '700', letterSpacing: 2.2,
    color: colors.gold, textTransform: 'uppercase', marginBottom: 6, opacity: 0.9,
  },
  heroValueRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6,
  },
  heroNumber: {
    fontSize: 36, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.8,
  },
  heroDenom: {
    fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.48)',
  },
  barWrap: { marginBottom: 5 },
  heroPct:  { fontSize: 11, color: 'rgba(255,255,255,0.60)', fontWeight: '500' },
  heroHint: { fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 4 },
  heroBreakdown: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
  },
  heroBreakdownTxt: { fontSize: 10, color: 'rgba(255,255,255,0.55)' },
  heroBreakdownSep: { fontSize: 10, color: 'rgba(255,255,255,0.30)' },
  heroNote: { fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 14, fontStyle: 'italic' },

  // ── Ivory card base ──
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#000', shadowOpacity: 0.05,
    shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cardEyebrow: {
    fontSize: 9, fontWeight: '700', letterSpacing: 2,
    color: colors.gold, textTransform: 'uppercase', marginBottom: 4,
  },

  // ── Position card ──
  posMain: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 3 },
  posSub:  { fontSize: 11, color: colors.muted, lineHeight: 15 },

  // ── Calendar card ──
  calCard:   { flex: 1 },
  calHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  calMeta: { fontSize: 10, color: colors.muted, fontWeight: '500' },
  calNote: { fontSize: 10, color: colors.muted, marginTop: 6, lineHeight: 14 },

  // ── State screens ──
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginTop: spacing.sm,
    shadowColor: colors.primary, shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  stateTitle: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 6 },
  stateSub:   { fontSize: 13, color: colors.muted, lineHeight: 19 },
  retryBtn: {
    alignSelf: 'flex-start', marginTop: spacing.md,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.border,
  },
  retryTxt: { fontSize: 13, fontWeight: '600', color: colors.primary },
});
