/**
 * Minimal EN/FR i18n skeleton (Phase 17, innovation #15).
 *
 * Architecture (shared decision with the ministry-portal track):
 *   - Flat dot-namespaced keys in JSON resource bundles, one file per locale.
 *   - Fallback chain: selected locale → English → the key itself (never a
 *     blank string, so a missing translation is visible, not silent).
 *   - Locale resolution: explicit user choice persisted in localStorage
 *     ("cvff.locale") → navigator.language prefix → "en".
 *   - No runtime ICU/plural machinery yet — `{var}` substitution only.
 *     Real data only: untranslated keys surface the English source text.
 */
import en from "./en.json";
import fr from "./fr.json";

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "cvff.locale";

type ResourceBundle = Record<string, string>;

const BUNDLES: Record<Locale, ResourceBundle> = { en, fr };

export function isLocale(candidate: unknown): candidate is Locale {
  return typeof candidate === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(candidate);
}

/**
 * Resolves the active locale from an explicit stored choice, then the
 * browser language. Any unpersistable/unknown value degrades to English.
 */
export function detectLocale(store: { getItem(key: string): string | null } | null, navigatorLanguage?: string): Locale {
  try {
    const stored = store?.getItem(LOCALE_STORAGE_KEY) ?? null;
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // Storage unavailable — fall through to the browser language.
  }
  const browser = (navigatorLanguage ?? "").slice(0, 2).toLowerCase();
  return isLocale(browser) ? browser : DEFAULT_LOCALE;
}

export function persistLocale(store: { setItem(key: string, value: string): void } | null, locale: Locale): void {
  try {
    store?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The selection simply will not survive a reload.
  }
}

export interface Translator {
  locale: Locale;
  /** Translates `key`, substituting `{name}` placeholders from `vars`. */
  t(key: string, vars?: Record<string, string | number>): string;
}

export function createTranslator(locale: Locale): Translator {
  const bundle = BUNDLES[locale];
  const fallback = BUNDLES[DEFAULT_LOCALE];
  return {
    locale,
    t(key, vars) {
      let text = bundle[key] ?? fallback[key] ?? key;
      if (vars !== undefined) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
  };
}
