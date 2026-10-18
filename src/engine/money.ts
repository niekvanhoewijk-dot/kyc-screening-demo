// Whole-dollar rounding for percentage-of-amount results. Floating point turns e.g. 0.8 * 200000
// into 159999.99999999997; the tolerance is a numeric-precision guard, not a business rule.
const FLOAT_TOLERANCE = 1e-9;

export function floorDollars(value: number): number {
  return Math.floor(value + FLOAT_TOLERANCE);
}
