# Quran Data Assets

This directory will contain the bundled Quran JSON files.

## Files to add (next step)

- `quran.json` — Arabic text + transliteration, verse by verse
- `quran_fr.json` — French translations

## Source

Copy from the Zainly web app: `public/data/quran.json` and `public/data/quran_fr.json`

## Usage in React Native

```ts
const quran = require('../../assets/data/quran.json');
const quranFr = require('../../assets/data/quran_fr.json');
```

JSON files required via `require()` are bundled at build time — no network fetch at runtime.
