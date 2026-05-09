export const CYCLE_DAYS = [1, 3, 7, 14, 30, 60] as const;

export function nextSRSState(currentCycle: number, remembered: boolean) {
  const safeCycle = Number.isFinite(currentCycle)
    ? Math.max(0, Math.min(currentCycle, CYCLE_DAYS.length - 1))
    : 1;

  const nextCycle = remembered
    ? Math.min(safeCycle + 1, CYCLE_DAYS.length - 1)
    : 1;

  const mastered = remembered && safeCycle >= CYCLE_DAYS.length - 1;
  const daysUntilReview = CYCLE_DAYS[nextCycle];

  return { nextCycle, mastered, daysUntilReview };
}
