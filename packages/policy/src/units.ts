/** Exact decimal <-> base-unit conversion. No floating point anywhere near money. */

export function parseUnits(decimal: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) throw new Error(`invalid decimal amount: ${decimal}`);
  const whole = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`${decimal} has more than ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

/** Micro-USD from a decimal USD string ("1.00" -> 1_000_000n). */
export const usdToMicros = (usd: string): bigint => parseUnits(usd, 6);
