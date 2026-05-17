// ─── quranContent.ts — Public session API for Quran content ──────────────────
// All reads come from local bundled JSON. No network fetch. No API. No secrets.
// This module is the single import point for all session/UI code.

import {
  getQuranAyahRange as _getRange,
  isRiwayaAvailable as _isAvailable,
  getAvailableRiwayat as _getAvailable,
  validateQuranDataset as _validate,
} from '@/data/quran';

import type {
  QuranRiwaya,
  QuranAyahContent,
  QuranContentResult,
  QuranDatasetValidation,
} from '@/data/quran';

// Re-export types so session code has a single import point.
export type { QuranRiwaya, QuranAyahContent, QuranContentResult, QuranDatasetValidation };

// ─── getQuranAyahRange ────────────────────────────────────────────────────────
// Returns the requested ayah range from local bundled data.
// Async signature is intentional: keeps session code future-proof if a lazy
// chunk loader is added later. Resolves synchronously for now.

export async function getQuranAyahRange(params: {
  riwaya?: QuranRiwaya;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
}): Promise<QuranContentResult> {
  return _getRange(params);
}

// ─── isRiwayaAvailable ────────────────────────────────────────────────────────

export function isRiwayaAvailable(riwaya: QuranRiwaya): boolean {
  return _isAvailable(riwaya);
}

// ─── getAvailableRiwayat ──────────────────────────────────────────────────────

export function getAvailableRiwayat(): QuranRiwaya[] {
  return _getAvailable();
}

// ─── validateQuranDataset ─────────────────────────────────────────────────────
// For dev/debug use. Do not call this in hot render paths.

export function validateQuranDataset(riwaya: QuranRiwaya): QuranDatasetValidation {
  return _validate(riwaya);
}
