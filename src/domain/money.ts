const ngnFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});


/** Formats a kobo amount (integer minor units) as an NGN currency string. */
export function formatKoboAsNgn(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) {
    throw new Error("kobo amount must be a non-negative safe integer");
  }
  return ngnFormatter.format(kobo / 100);
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats a cent amount (integer minor units) as a USD currency string. */
export function formatCentsAsUsd(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("cent amount must be a non-negative safe integer");
  }
  return usdFormatter.format(cents / 100);
}

/**
 * Formats an NGN-per-USD rate carried in micro units (rate × 1_000_000) as a
 * plain decimal, e.g. 1_550_000_000 → "1550".
 */
export function formatMicroRate(micro: number): string {
  if (!Number.isSafeInteger(micro) || micro < 0) {
    throw new Error("micro rate must be a non-negative safe integer");
  }
  return (micro / 1_000_000).toLocaleString("en-NG", { maximumFractionDigits: 6 });
}
