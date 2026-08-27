/**
 * Client-side validation for the CVFF new-application wizard. All rules are
 * advisory mirrors of the backend contract: the API remains authoritative and
 * its 4xx responses are mapped back onto these fields by `mapServerErrors`.
 */

export const VESSEL_CLASSES = [
  "FISHING_TRAWLER",
  "CARGO_COASTER",
  "TUG",
  "BARGE",
  "PASSENGER_FERRY",
  "SUPPLY_VESSEL",
  "CREW_BOAT",
  "OTHER",
] as const;

export type VesselClass = (typeof VESSEL_CLASSES)[number];

export const VESSEL_CLASS_LABELS: Record<VesselClass, string> = {
  FISHING_TRAWLER: "Fishing trawler",
  CARGO_COASTER: "Cargo coaster",
  TUG: "Tug",
  BARGE: "Barge",
  PASSENGER_FERRY: "Passenger ferry",
  SUPPLY_VESSEL: "Supply vessel",
  CREW_BOAT: "Crew boat",
  OTHER: "Other",
};

export const CABOTAGE_ROUTES = [
  "LAGOS_PORT_HARCOURT",
  "LAGOS_ONNE",
  "LAGOS_WARRI",
  "LAGOS_CALABAR",
  "PORT_HARCOURT_BONNY",
  "WARRI_ESCRAVOS",
  "INLAND_WATERWAYS",
  "OTHER",
] as const;

export type CabotageRoute = (typeof CABOTAGE_ROUTES)[number];

export const CABOTAGE_ROUTE_LABELS: Record<CabotageRoute, string> = {
  LAGOS_PORT_HARCOURT: "Lagos – Port Harcourt",
  LAGOS_ONNE: "Lagos – Onne",
  LAGOS_WARRI: "Lagos – Warri",
  LAGOS_CALABAR: "Lagos – Calabar",
  PORT_HARCOURT_BONNY: "Port Harcourt – Bonny",
  WARRI_ESCRAVOS: "Warri – Escravos",
  INLAND_WATERWAYS: "Inland waterways",
  OTHER: "Other",
};

/** CVFF loan bounds in kobo: ₦5,000,000.00 minimum, ₦2,000,000,000.00 maximum. */
export const MIN_AMOUNT_KOBO = 500_000_000;
export const MAX_AMOUNT_KOBO = 200_000_000_000;

export interface ApplicationDraft {
  vesselName: string;
  imoNumber: string;
  officialNumber: string;
  vesselClass: VesselClass | "";
  cabotageRoute: CabotageRoute | "";
  amountNairaText: string;
  businessName: string;
  businessRcNumber: string;
  businessAddress: string;
}

export const EMPTY_DRAFT: ApplicationDraft = {
  vesselName: "",
  imoNumber: "",
  officialNumber: "",
  vesselClass: "",
  cabotageRoute: "",
  amountNairaText: "",
  businessName: "",
  businessRcNumber: "",
  businessAddress: "",
};

export type DraftField = keyof ApplicationDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/**
 * Validates the seven-digit IMO number including its check digit:
 * for digits d1..d7, (7*d1 + 6*d2 + 5*d3 + 4*d4 + 3*d5 + 2*d6) mod 10 === d7.
 */
export function isValidImoNumber(value: string): boolean {
  if (!/^\d{7}$/.test(value)) {
    return false;
  }
  const digits = value.split("").map((character) => Number(character));
  let sum = 0;
  for (let index = 0; index < 6; index += 1) {
    sum += digits[index] * (7 - index);
  }
  return sum % 10 === digits[6];
}

export function validateDraft(draft: ApplicationDraft): DraftErrors {
  const errors: DraftErrors = {};

  const vesselName = draft.vesselName.trim();
  if (vesselName.length < 2 || vesselName.length > 128) {
    errors.vesselName = "Vessel name is required (2–128 characters).";
  }

  if (!isValidImoNumber(draft.imoNumber.trim())) {
    errors.imoNumber = "Enter a valid 7-digit IMO number (check digit verified).";
  }

  const officialNumber = draft.officialNumber.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{1,31}$/.test(officialNumber)) {
    errors.officialNumber = "Official registry number is required (letters, digits, '/' or '-').";
  }

  if (draft.vesselClass === "") {
    errors.vesselClass = "Select the vessel class.";
  }

  if (draft.cabotageRoute === "") {
    errors.cabotageRoute = "Select the primary cabotage trade route.";
  }

  const kobo = parseAmountKobo(draft.amountNairaText);
  if (kobo === null) {
    errors.amountNairaText = "Enter the requested amount in naira (figures only, up to 2 decimals).";
  } else if (kobo < MIN_AMOUNT_KOBO || kobo > MAX_AMOUNT_KOBO) {
    errors.amountNairaText = "Requested amount must be between ₦5,000,000.00 and ₦2,000,000,000.00.";
  }

  const businessName = draft.businessName.trim();
  if (businessName.length < 2 || businessName.length > 256) {
    errors.businessName = "Registered business name is required (2–256 characters).";
  }

  if (!/^RC\d{4,10}$/i.test(draft.businessRcNumber.trim())) {
    errors.businessRcNumber = "Enter the CAC registration number in the form RC123456.";
  }

  const businessAddress = draft.businessAddress.trim();
  if (businessAddress.length < 8 || businessAddress.length > 512) {
    errors.businessAddress = "Business address is required (8–512 characters).";
  }

  return errors;
}

export function parseAmountKobo(text: string): number | null {
  const normalised = text.replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalised)) {
    return null;
  }
  const kobo = Math.round(Number(normalised) * 100);
  return Number.isSafeInteger(kobo) ? kobo : null;
}

export function draftIsValid(draft: ApplicationDraft): boolean {
  return Object.keys(validateDraft(draft)).length === 0;
}

/** Payload sent to POST {base_url}/applications. */
export interface CreateApplicationPayload {
  vessel_name: string;
  imo_number: string;
  official_number: string;
  vessel_class: VesselClass;
  cabotage_route: CabotageRoute;
  amount: number;
  currency: "NGN";
  business_name: string;
  business_rc_number: string;
  business_address: string;
}

export function draftToPayload(draft: ApplicationDraft): CreateApplicationPayload {
  if (!draftIsValid(draft)) {
    throw new Error("cannot build a submission payload from an invalid draft");
  }
  return {
    vessel_name: draft.vesselName.trim(),
    imo_number: draft.imoNumber.trim(),
    official_number: draft.officialNumber.trim(),
    vessel_class: draft.vesselClass as VesselClass,
    cabotage_route: draft.cabotageRoute as CabotageRoute,
    amount: parseAmountKobo(draft.amountNairaText) as number,
    currency: "NGN",
    business_name: draft.businessName.trim(),
    business_rc_number: draft.businessRcNumber.trim().toUpperCase(),
    business_address: draft.businessAddress.trim(),
  };
}

/**
 * Maps server-side 4xx problem fields back onto wizard fields. The backend is
 * expected to return RFC 9457 problem details with an `errors` object keyed by
 * payload field name; unrecognised fields fall back to a form-level message.
 */
export function mapServerErrors(problem: unknown): { fieldErrors: DraftErrors; formError: string | null } {
  const fieldErrors: DraftErrors = {};
  let formError: string | null = null;
  if (typeof problem !== "object" || problem === null) {
    return { fieldErrors, formError: "The server rejected the application without details." };
  }
  const record = problem as Record<string, unknown>;
  if (typeof record.title === "string" && record.title.trim().length > 0) {
    formError = record.title;
  }
  const errors = record.errors;
  if (typeof errors !== "object" || errors === null || Array.isArray(errors)) {
    return { fieldErrors, formError: formError ?? "The server rejected the application without field details." };
  }
  const fieldMap: Record<string, DraftField> = {
    vessel_name: "vesselName",
    imo_number: "imoNumber",
    official_number: "officialNumber",
    vessel_class: "vesselClass",
    cabotage_route: "cabotageRoute",
    amount: "amountNairaText",
    business_name: "businessName",
    business_rc_number: "businessRcNumber",
    business_address: "businessAddress",
  };
  for (const [serverField, message] of Object.entries(errors)) {
    const text = typeof message === "string" ? message : Array.isArray(message) ? message.join(" ") : null;
    if (text === null) {
      continue;
    }
    const draftField = fieldMap[serverField];
    if (draftField !== undefined) {
      fieldErrors[draftField] = text;
    } else {
      formError = formError === null ? `${serverField}: ${text}` : `${formError}; ${serverField}: ${text}`;
    }
  }
  return { fieldErrors, formError };
}
