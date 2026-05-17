# Zainly Local Quran Data

## ⚠️ Provenance Notice

The datasets in `assets/data/` were copied from the Zainly web app (`public/data/`).
The web app's git history contains a single "first commit" with no source attribution,
no LICENSE file, and no CREDITS file.

**The upstream origin has NOT been formally documented in the web app codebase.**

Based on structural analysis:

- The Arabic text shape, Unicode orthography, and ayah count (6236) are consistent
  with the **Tanzil.net** Quran corpus (Hafs `an Asim`), widely distributed via
  [alquran.cloud](https://alquran.cloud). The Tanzil corpus is released under
  [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
- The transliteration style matches the `en.transliteration` edition on alquran.cloud.
- The French translation wording matches the **Muhammad Hamidullah** translation
  (`fr.hamidullah` on alquran.cloud), which is in the public domain in most jurisdictions
  due to its age and wide open distribution.

**This is an informed inference, not a verified chain of custody.**

**Before production release or public distribution, a human must:**
1. Confirm the Arabic text source (recommended: re-fetch from Tanzil.net or alquran.cloud
   with explicit CC-BY attribution).
2. Confirm the French translation source and its redistribution terms.
3. Add a formal ATTRIBUTION or LICENSE note to the Zainly web app repo.
4. Mirror that attribution here.

The data is used here in good faith for an internal Hifz memorisation tool
while provenance verification is pending.

---

## Installed Datasets

### Hafs (`hafs`) ✅ ACTIVE — provenance pending verification (see above)

| Property | Value |
|---|---|
| **Immediate source** | Zainly web app — `public/data/quran.json` / `public/data/quran_fr.json` |
| **Inferred upstream (Arabic)** | Tanzil.net corpus via alquran.cloud — CC-BY 3.0 (inferred, unconfirmed) |
| **Inferred upstream (transliteration)** | alquran.cloud `en.transliteration` edition (inferred, unconfirmed) |
| **Inferred upstream (French)** | Muhammad Hamidullah translation `fr.hamidullah` (inferred, unconfirmed) |
| **Riwaya claim** | Consistent with Hafs `an Asim` — structurally inferred, not scholarly-certified |
| **Surahs** | 114 |
| **Ayahs** | 6236 |
| **Arabic text** | ✅ Present |
| **Transliteration** | ✅ Present |
| **French translation** | ✅ Present |
| **Audio** | ❌ Not bundled |
| **Structural integrity** | ✅ Automated check: 0 missing ayah numbers across all 114 surahs |
| **Scholarly/textual verification** | ⚠️ Not performed — structural validation ≠ religious verification |

> **Note on "structural integrity vs. scholarly verification":**
> The automated `validateQuranDataset()` check confirms that the JSON contains
> exactly 114 surahs with 6236 ayahs and no missing ayah IDs. It does **not**
> compare the Arabic text against a certified mushaf. Textual accuracy must be
> verified by a qualified person before this dataset is used in a production
> Hifz (memorisation) product.

Asset locations:
- `assets/data/quran.json` — Arabic text + transliteration, 114 surahs, 6236 ayahs
- `assets/data/quran_fr.json` — Arabic text + French translation, 114 surahs, 6236 ayahs

---

### Warsh (`warsh`) ❌ NOT INSTALLED

Architecture is prepared. To activate:
1. Obtain a verified, complete Warsh dataset with documented provenance.
2. Transform it to `RawQuranSurah[]` shape (see `types.ts`).
3. Place at `assets/data/quran_warsh.json`.
4. Import it in `src/data/quran/index.ts` and add `'warsh'` to `AVAILABLE_RIWAYAT`.
5. Implement `loadWarshSurah()` following the pattern of `loadHafsSurah()`.
6. Run `validateQuranDataset('warsh')` to confirm structural integrity.
7. Document source and license in this README.

### Qalun (`qalun`) ❌ NOT INSTALLED

Same process as Warsh above.

---

## Adding Audio

Audio is not currently bundled. Do not add it without:
- A verified, complete reciter audio dataset with documented provenance and license.
- `expo-av` installed (`expo install expo-av`).
- A separate audio manifest mapping surah/ayah to file paths or CDN URLs.

---

## Data Shape

### `assets/data/quran.json` (Arabic + transliteration)

```json
[
  {
    "id": 1,
    "name": "الفاتحة",
    "transliteration": "Al-Fatihah",
    "type": "meccan",
    "total_verses": 7,
    "verses": [
      { "id": 1, "text": "بِسۡمِ ٱللَّهِ...", "transliteration": "Bismi Allahi..." }
    ]
  }
]
```

### `assets/data/quran_fr.json` (Arabic + French translation)

```json
[
  {
    "id": 1,
    "name": "الفاتحة",
    "transliteration": "Al-Fatihah",
    "translation": "L'Ouverture",
    "type": "meccan",
    "total_verses": 7,
    "verses": [
      { "id": 1, "text": "بِسۡمِ ٱللَّهِ...", "translation": "Au nom d'Allah..." }
    ]
  }
]
```

---

## Structural Validation

Run `validateQuranDataset('hafs')` from `src/data/quran/index.ts` to confirm:
- 114 surahs present
- 6236 total ayahs
- No missing ayah IDs within any surah range

**Reminder:** this is a structural check only. It does not verify textual correctness
against a printed mushaf or certified Quran corpus.

---

## Usage

```ts
import { getQuranAyahRange, isRiwayaAvailable, validateQuranDataset } from '@/data/quran';

const result = getQuranAyahRange({ surahNumber: 1, fromAyah: 1, toAyah: 7 });
if (result.ok) {
  result.ayahs; // QuranAyahContent[]
}
```
