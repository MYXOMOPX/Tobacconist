/**
 * Number formatting for the whole app. Every euro, kilogram and pack count on
 * screen goes through here, so a card total can never disagree with the rows
 * above it (spec §11).
 *
 * Units are not baked into these strings: the <Money>/<Weight> components add
 * them, which keeps the unit a typographic decision rather than a string one.
 */

/** Price of one pack: €/kg × weight, rounded to whole cents. Never stored — always derived. */
export function packPriceEur(pricePerKgEur: number, grams: number): number {
  return roundCents((pricePerKgEur * grams) / 1000);
}

/** Adds euro amounts in cents, so 0.1 + 0.2 is 0.3 and not 0.30000000000000004. */
export function sumEur(values: number[]): number {
  return roundCents(values.reduce((total, value) => total + Math.round(value * 100) / 100, 0));
}

export function formatEur(value: number): string {
  return value.toFixed(2);
}

export function formatKg(value: number): string {
  return value.toFixed(2);
}

export function formatQty(quantity: number): string {
  return `x${quantity}`;
}

export function gramsLabel(grams: number): string {
  return `${grams}г`;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
