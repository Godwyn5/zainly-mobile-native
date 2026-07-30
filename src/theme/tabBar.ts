// ─── Single source of truth for the floating tab bar geometry ────────────────
// Consumed by both PremiumTabBar.tsx (renders the bar) and Screen.tsx
// (reserves clearance so scroll content never sits underneath it).
// Changing any of these values only needs to happen here.

export const TAB_BAR_HEIGHT      = 64; // pill height
export const TAB_BAR_H_MARGIN    = 20; // left/right margin from screen edges
export const TAB_BAR_BOTTOM_GAP  = 8;  // gap between the pill and the safe-area bottom inset
export const TAB_BAR_BREATHING_ROOM = 24; // extra clearance below the last scroll item
