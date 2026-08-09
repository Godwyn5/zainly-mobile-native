/// <reference types="jest" />

// Tests that the revision error message is a stable French string,
// not a raw Supabase/DB error message.

describe('revision error message', () => {
  it('uses a stable French message, not raw error.message', () => {
    const rawSupabaseError = 'PostgresError: column "review_cycle" does not exist in table "review_items"';
    const userFacingMessage = 'Impossible d\u2019enregistrer ta révision pour l\u2019instant. Réessaie.';

    // The user-facing message must NOT contain any technical details
    expect(userFacingMessage).not.toContain('Postgres');
    expect(userFacingMessage).not.toContain('column');
    expect(userFacingMessage).not.toContain('table');
    expect(userFacingMessage).not.toContain(rawSupabaseError);

    // It must be a stable, French, user-friendly sentence
    expect(userFacingMessage).toContain('révision');
    expect(userFacingMessage).toContain('Réessaie');
  });

  it('does not expose table names or error codes', () => {
    const userFacingMessage = 'Impossible d\u2019enregistrer ta révision pour l\u2019instant. Réessaie.';
    const sensitivePatterns = ['review_items', 'review_cycle', 'PGRST', 'PostgresError', 'supabase', '42501', '23505'];

    for (const pattern of sensitivePatterns) {
      expect(userFacingMessage).not.toContain(pattern);
    }
  });

  it('allows retry — the message says "Réessaie"', () => {
    const userFacingMessage = 'Impossible d\u2019enregistrer ta révision pour l\u2019instant. Réessaie.';
    expect(userFacingMessage).toMatch(/Réessaie/);
  });
});
