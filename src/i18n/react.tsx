/**
 * React binding for the i18n skeleton: a context carrying the active
 * translator plus a locale setter that persists the user's choice.
 */
import { createContext, useContext } from "react";
import { createTranslator, DEFAULT_LOCALE, type Locale, type Translator } from "./index";

export interface I18nContextValue {
  translator: Translator;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextValue>({
  translator: createTranslator(DEFAULT_LOCALE),
  setLocale: () => {},
});

export function useTranslator(): Translator {
  return useContext(I18nContext).translator;
}

