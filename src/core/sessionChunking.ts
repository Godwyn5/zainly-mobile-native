// ─── sessionChunking.ts ──────────────────────────────────────────────────────
// Pedagogical chunking helpers extracted from app/(app)/session.tsx.
// Pure functions — no external dependencies, no side effects.

export function chunkAyat(arabic: string): string[] {
  if (!arabic || !arabic.trim()) return [];
  const words = arabic.trim().split(/\s+/).filter(w => w.length > 0);
  const n = words.length;
  if (n === 0) return [];
  if (n <= 3) {
    // 1 word per chunk
    return words;
  }
  if (n <= 6) {
    // chunks of 2
    const out: string[] = [];
    for (let i = 0; i < n; i += 2) {
      out.push(words.slice(i, i + 2).join(' '));
    }
    return out;
  }
  // 7+ words: chunks of 3 (last chunk may be 1–3 words)
  const out: string[] = [];
  for (let i = 0; i < n; i += 3) {
    out.push(words.slice(i, i + 3).join(' '));
  }
  return out;
}

// Safe transliteration word-split mapping — only attempt if word counts match exactly
export function chunkTranslit(translit: string | null | undefined, arabicChunks: string[]): string[] | null {
  if (!translit || !translit.trim()) return null;
  const tWords = translit.trim().split(/\s+/).filter(w => w.length > 0);
  const aWords = arabicChunks.flatMap(c => c.split(/\s+/));
  if (tWords.length !== aWords.length) return null; // counts differ — skip safely
  // Rebuild transliteration chunks matching arabic chunk word counts
  const result: string[] = [];
  let idx = 0;
  for (const chunk of arabicChunks) {
    const wc = chunk.split(/\s+/).length;
    result.push(tWords.slice(idx, idx + wc).join(' '));
    idx += wc;
  }
  return result;
}
