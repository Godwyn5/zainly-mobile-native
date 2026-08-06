/// <reference types="jest" />
import { chunkAyat, chunkTranslit } from '../sessionChunking';

// ─── chunkAyat ───────────────────────────────────────────────────────────────

describe('chunkAyat', () => {
  it('returns empty array for empty string', () => {
    expect(chunkAyat('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(chunkAyat('   ')).toEqual([]);
  });

  // ── 1 word per chunk (n <= 3) ──
  it('returns 1 word per chunk for 1 word', () => {
    expect(chunkAyat('بسم')).toEqual(['بسم']);
  });

  it('returns 1 word per chunk for 2 words', () => {
    expect(chunkAyat('بسم الله')).toEqual(['بسم', 'الله']);
  });

  it('returns 1 word per chunk for 3 words', () => {
    expect(chunkAyat('بسم الله الرحمن')).toEqual(['بسم', 'الله', 'الرحمن']);
  });

  // ── chunks of 2 (4 <= n <= 6) ──
  it('returns chunks of 2 for 4 words', () => {
    expect(chunkAyat('بسم الله الرحمن الرحيم')).toEqual([
      'بسم الله',
      'الرحمن الرحيم',
    ]);
  });

  it('returns chunks of 2 for 5 words (last chunk has 1 word)', () => {
    expect(chunkAyat('بسم الله الرحمن الرحيم ملك')).toEqual([
      'بسم الله',
      'الرحمن الرحيم',
      'ملك',
    ]);
  });

  it('returns chunks of 2 for 6 words', () => {
    expect(chunkAyat('بسم الله الرحمن الرحيم ملك يوم')).toEqual([
      'بسم الله',
      'الرحمن الرحيم',
      'ملك يوم',
    ]);
  });

  // ── chunks of 3 (n >= 7) ──
  it('returns chunks of 3 for 7 words (last chunk has 1 word)', () => {
    expect(chunkAyat('a b c d e f g')).toEqual([
      'a b c',
      'd e f',
      'g',
    ]);
  });

  it('returns chunks of 3 for 8 words (last chunk has 2 words)', () => {
    expect(chunkAyat('a b c d e f g h')).toEqual([
      'a b c',
      'd e f',
      'g h',
    ]);
  });

  it('returns chunks of 3 for 9 words', () => {
    expect(chunkAyat('a b c d e f g h i')).toEqual([
      'a b c',
      'd e f',
      'g h i',
    ]);
  });

  it('returns chunks of 3 for 10 words (last chunk has 1 word)', () => {
    expect(chunkAyat('a b c d e f g h i j')).toEqual([
      'a b c',
      'd e f',
      'g h i',
      'j',
    ]);
  });

  // ── order preservation & no loss/duplication ──
  it('preserves word order and loses no words', () => {
    const input = 'وَالشَّمْسِ وَضُحَاهَا وَالْقَمَرِ إِذَا تَلَاهَا وَالنَّهَارِ';
    const chunks = chunkAyat(input);
    const reconstructed = chunks.join(' ');
    const originalWords = input.trim().split(/\s+/).join(' ');
    expect(reconstructed).toBe(originalWords);
  });

  it('does not duplicate words across chunks', () => {
    const input = 'one two three four five six seven';
    const chunks = chunkAyat(input);
    const allWords = chunks.flatMap(c => c.split(/\s+/));
    const uniqueWords = [...new Set(allWords)];
    expect(allWords.length).toBe(uniqueWords.length);
  });

  // ── leading/trailing whitespace ──
  it('trims leading and trailing whitespace before splitting', () => {
    expect(chunkAyat('  بسم الله  ')).toEqual(['بسم', 'الله']);
  });
});

// ─── chunkTranslit ───────────────────────────────────────────────────────────

describe('chunkTranslit', () => {
  it('returns null for null input', () => {
    expect(chunkTranslit(null, ['bism', 'allah'])).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(chunkTranslit(undefined, ['bism', 'allah'])).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(chunkTranslit('', ['bism', 'allah'])).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(chunkTranslit('   ', ['bism', 'allah'])).toBeNull();
  });

  it('returns null when word counts differ', () => {
    // arabicChunks has 2 words total, translit has 3
    const arabicChunks = ['bism allah']; // 2 words
    expect(chunkTranslit('bism allah rahman', arabicChunks)).toBeNull();
  });

  it('aligns transliteration chunks with arabic chunks (1 word per chunk)', () => {
    const arabicChunks = ['بسم', 'الله', 'الرحمن'];
    const result = chunkTranslit('bism allah rahman', arabicChunks);
    expect(result).toEqual(['bism', 'allah', 'rahman']);
  });

  it('aligns transliteration chunks with arabic chunks (2 words per chunk)', () => {
    const arabicChunks = ['بسم الله', 'الرحمن الرحيم'];
    const result = chunkTranslit('bism allah rahman raheem', arabicChunks);
    expect(result).toEqual(['bism allah', 'rahman raheem']);
  });

  it('aligns transliteration chunks with arabic chunks (3 words per chunk)', () => {
    const arabicChunks = ['a b c', 'd e f'];
    const result = chunkTranslit('one two three four five six', arabicChunks);
    expect(result).toEqual(['one two three', 'four five six']);
  });

  it('preserves word order in transliteration chunks', () => {
    const arabicChunks = ['بسم الله', 'الرحمن الرحيم'];
    const result = chunkTranslit('bism allah rahman raheem', arabicChunks);
    expect(result).not.toBeNull();
    const allWords = result!.flatMap(c => c.split(/\s+/));
    expect(allWords).toEqual(['bism', 'allah', 'rahman', 'raheem']);
  });

  it('handles mixed chunk sizes (2+1 words)', () => {
    // chunkAyat('a b c d e') → ['a b', 'c d', 'e'] (chunks of 2, last has 1)
    const arabicChunks = ['a b', 'c d', 'e'];
    const result = chunkTranslit('one two three four five', arabicChunks);
    expect(result).toEqual(['one two', 'three four', 'five']);
  });

  // ── representative case with real Arabic + transliteration ──
  it('correctly chunks a real ayah with matching transliteration', () => {
    const arabic = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
    const translit = 'bismi llahi rrahmani rraheemi';
    const chunks = chunkAyat(arabic);
    // 4 words → chunks of 2
    expect(chunks).toEqual([
      'بِسْمِ ٱللَّهِ',
      'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    ]);
    const result = chunkTranslit(translit, chunks);
    expect(result).toEqual([
      'bismi llahi',
      'rrahmani rraheemi',
    ]);
  });

  it('returns null when transliteration has fewer words than arabic', () => {
    const arabicChunks = ['bism allah', 'rahman raheem']; // 4 words total
    expect(chunkTranslit('bism allah rahman', arabicChunks)).toBeNull();
  });
});
