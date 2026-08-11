-- ─── Migration: finalize_onboarding_plan RPC ──────────────────────────────
-- Atomically creates plan + progress for a just-authenticated user in a
-- single PostgreSQL transaction.  Replaces the client-side two-step
-- (upsertPlan + resetProgressForNewPlan) that was vulnerable to:
--   • TOCTOU race between SELECT and INSERT (cross-device concurrency)
--   • Partial state if the second INSERT failed after the first succeeded
--   • ON CONFLICT DO UPDATE silently overwriting the winning plan
--
-- Security:
--   • Identity is obtained exclusively from auth.uid() (verified JWT).
--     The client never passes user_id — it is injected server-side.
--   • SECURITY DEFINER with explicit search_path = public.
--   • REVOKE EXECUTE FROM PUBLIC and FROM anon (PUBLIC is broader than anon).
--   • Only authenticated role can execute.
--   • All table references are schema-qualified (public.plans, public.progress).
--
-- Concurrency:
--   • pg_advisory_xact_lock per user serializes concurrent calls.
--   • The second call blocks until the first commits, then sees the
--     committed rows and returns 'already_finalized'.
--   • No ON CONFLICT DO UPDATE — pure INSERT inside a transaction.
--   • If the second INSERT fails, the entire transaction rolls back.
--
-- Return values:
--   { ok: true,  reason: 'created'           } — both rows inserted
--   { ok: true,  reason: 'already_finalized' } — both rows already exist
--   { ok: false, reason: 'inconsistent_state'} — exactly one row exists
--   { ok: false, reason: 'not_authenticated' } — auth.uid() is NULL
--
-- ─── THIS MIGRATION MUST BE APPLIED IN SUPABASE BEFORE THE RPC IS ACTIVE ──
-- The client code calls supabase.rpc('finalize_onboarding_plan', ...).
-- Until this migration is deployed, the RPC does not exist and the call
-- will fail with a PostgREST error.  The client includes a fallback path
-- that surfaces the error to the user (fail-closed, never silent).

CREATE OR REPLACE FUNCTION public.finalize_onboarding_plan(
  p_plan jsonb,
  p_progress jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id text := auth.uid()::text;
  v_existing_plan_id bigint;
  v_existing_progress_exists boolean;
BEGIN
  -- ── Identity from verified JWT, never from client parameter ──
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ── Per-user advisory lock: serializes concurrent finalization calls ──
  -- The lock is automatically released at transaction end (commit or rollback).
  -- hashtext returns int4; pg_advisory_xact_lock(int4) is the text-key variant.
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id));

  -- ── Check existing state inside the lock ──
  -- All table references are schema-qualified to prevent search_path hijacking.
  SELECT id INTO v_existing_plan_id
  FROM public.plans
  WHERE user_id = v_user_id
  LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM public.progress WHERE user_id = v_user_id
  ) INTO v_existing_progress_exists;

  -- ── Both exist → idempotent, no write ──
  IF v_existing_plan_id IS NOT NULL AND v_existing_progress_exists THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'already_finalized');
  END IF;

  -- ── Exactly one exists → inconsistent state, no write ──
  IF v_existing_plan_id IS NOT NULL OR v_existing_progress_exists THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inconsistent_state');
  END IF;

  -- ── Neither exists → create both in a single transaction ──
  -- user_id is injected from auth.uid(), never from the client payload.
  -- jsonb_populate_record handles type coercion from JSONB to column types.
  -- Columns not listed (id, created_at) use their DB defaults.
  INSERT INTO public.plans (
    user_id, ayah_per_day, days_per_week, first_surah_name, surah_start,
    start_ayah, remaining_ayats, estimated_months, plan_mode, known_surahs,
    starting_surah, custom_surah_order, pace_type, pace_label,
    pedagogical_order_version, partial_known_surahs
  )
  SELECT
    user_id, ayah_per_day, days_per_week, first_surah_name, surah_start,
    start_ayah, remaining_ayats, estimated_months, plan_mode, known_surahs,
    starting_surah, custom_surah_order, pace_type, pace_label,
    pedagogical_order_version, partial_known_surahs
  FROM jsonb_populate_record(
    NULL::public.plans,
    p_plan || jsonb_build_object('user_id', v_user_id)
  );

  INSERT INTO public.progress (
    user_id, current_surah, current_ayah, ayah_per_day, streak,
    total_memorized, session_dates, last_session_date,
    last_session_difficulty, last_revision_scores, last_adaptation_date
  )
  SELECT
    user_id, current_surah, current_ayah, ayah_per_day, streak,
    total_memorized, session_dates, last_session_date,
    last_session_difficulty, last_revision_scores, last_adaptation_date
  FROM jsonb_populate_record(
    NULL::public.progress,
    p_progress || jsonb_build_object(
      'user_id', v_user_id,
      'streak', 0,
      'total_memorized', 0,
      'session_dates', '[]'::jsonb,
      'last_session_date', NULL,
      'last_session_difficulty', NULL,
      'last_revision_scores', NULL,
      'last_adaptation_date', NULL
    )
  );

  RETURN jsonb_build_object('ok', true, 'reason', 'created');
END;
$$;

-- ── Permissions ──
-- Revoke from PUBLIC first — PUBLIC is broader than anon and includes
-- any role that might inherit execute by default.
REVOKE EXECUTE ON FUNCTION public.finalize_onboarding_plan(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_onboarding_plan(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_onboarding_plan(jsonb, jsonb) TO authenticated;
