/**
 * Clamps a number to [min, max].
 * Returns min for non-finite values.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
