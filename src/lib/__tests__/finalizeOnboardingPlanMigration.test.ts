import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('finalize_onboarding_plan migration SQL', () => {
  const migrationPath = resolve(
    __dirname,
    '../../../supabase/migrations/20260811000000_finalize_onboarding_plan.sql',
  );
  const sql = readFileSync(migrationPath, 'utf-8');

  test('SECURITY DEFINER uses empty search_path', () => {
    expect(sql).toContain("SET search_path = ''");
    expect(sql).not.toContain('SET search_path = public');
  });

  test('all application tables are schema-qualified', () => {
    // Every reference to plans and progress must be public.plans / public.progress
    expect(sql).not.toMatch(/\bFROM\s+plans\b/);
    expect(sql).not.toMatch(/\bFROM\s+progress\b/);
    expect(sql).not.toMatch(/\bINTO\s+plans\b/);
    expect(sql).not.toMatch(/\bINTO\s+progress\b/);
    expect(sql).not.toMatch(/NULL::plans\b/);
    expect(sql).not.toMatch(/NULL::progress\b/);

    expect(sql).toContain('public.plans');
    expect(sql).toContain('public.progress');
    expect(sql).toContain('NULL::public.plans');
    expect(sql).toContain('NULL::public.progress');
  });

  test('auth.uid() is schema-qualified', () => {
    expect(sql).toContain('auth.uid()');
  });

  test('REVOKE FROM PUBLIC is present', () => {
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.finalize_onboarding_plan(jsonb, jsonb) FROM PUBLIC');
  });

  test('no ON CONFLICT DO UPDATE in SQL statements', () => {
    // Strip comment lines before checking
    const codeOnly = sql.replace(/^--.*$/gm, '');
    expect(codeOnly).not.toMatch(/ON\s+CONFLICT/i);
  });

  test('no user_id function parameter', () => {
    // The function accepts only p_plan and p_progress — user_id comes from auth.uid()
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_onboarding_plan\(\s*p_plan jsonb,\s*p_progress jsonb\s*\)/);
  });
});
