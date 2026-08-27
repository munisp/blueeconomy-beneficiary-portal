const ngnFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ngnWholeFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formats a kobo amount (integer minor units) as an NGN currency string. */
export function formatKoboAsNgn(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) {
    throw new Error("kobo amount must be a non-negative safe integer");
  }
  return ngnFormatter.format(kobo / 100);
}

/** Formats a whole-naira amount without fractional digits. */
export function formatNaira(naira: number): string {
  if (!Number.isSafeInteger(naira) || naira < 0) {
    throw new Error("naira amount must be a non-negative safe integer");
  }
  return ngnWholeFormatter.format(naira);
}
