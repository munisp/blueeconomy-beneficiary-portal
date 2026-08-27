/** Document types accepted alongside a CVFF application. */
export const DOCUMENT_TYPES = ["VESSEL_REGISTRATION", "CABOTAGE_LICENSE", "BANK_DETAILS"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  VESSEL_REGISTRATION: "Vessel registration certificate",
  CABOTAGE_LICENSE: "Cabotage license",
  BANK_DETAILS: "Receiving bank account details",
};

export interface DocumentValidationRules {
  maxBytes: number;
  contentTypes: readonly string[];
}

export function validateDocumentFile(
  file: { name: string; size: number; type: string },
  rules: DocumentValidationRules,
): string | null {
  if (file.size <= 0) {
    return "The selected file is empty.";
  }
  if (file.size > rules.maxBytes) {
    const limitMb = (rules.maxBytes / (1024 * 1024)).toFixed(1);
    return `The file exceeds the approved ${limitMb} MB limit.`;
  }
  if (!rules.contentTypes.includes(file.type)) {
    return `Files of type "${file.type || "unknown"}" are not accepted. Approved types: ${rules.contentTypes.join(", ")}.`;
  }
  if (!/^[\w,.() -]{1,128}$/.test(file.name)) {
    return "The file name contains characters outside the approved set.";
  }
  return null;
}
