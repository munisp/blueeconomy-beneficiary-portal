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

