// recency glow, gource-style flash-then-decay. pure, no imports —
// this same compiled file is served to the page (one implementation).

// entities touched in the latest turn glow strongest, fading to neutral over N turns.
export const DECAY_TURNS = 8;

// distance = how many turns ago the entity was last touched (0 = latest turn).
// returns 0..1; 1 at distance 0, linearly to 0 at distance N and beyond.
export function glow(distance: number, n: number = DECAY_TURNS): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  if (distance >= n) return 0;
  return 1 - distance / n;
}
