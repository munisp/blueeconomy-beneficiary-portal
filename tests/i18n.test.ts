import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  createTranslator,
  detectLocale,
  persistLocale,
} from "../src/i18n";
import en from "../src/i18n/en.json";
import fr from "../src/i18n/fr.json";

describe("i18n skeleton (EN/FR)", () => {
  it("supports exactly en and fr", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "fr"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("translates shared header keys in both locales and keeps them distinct", () => {
    const enT = createTranslator("en");
    const frT = createTranslator("fr");
    for (const key of ["app.eyebrow", "app.tagline", "auth.signIn", "auth.signOut", "nav.dashboard", "nav.newApplication"]) {
      expect(enT.t(key)).not.toBe(key);
      expect(frT.t(key)).not.toBe(key);
      expect(frT.t(key)).not.toBe(enT.t(key));
    }
  });

  it("falls back to English for keys missing in French, then to the key", () => {
    const frT = createTranslator("fr");
    const key = "test.only-in-english";
    // Simulate a key present only in the fallback bundle.
    (en as Record<string, string>)[key] = "English source text";
    expect(frT.t(key)).toBe("English source text");
    delete (en as Record<string, string>)[key];
    expect(frT.t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("substitutes {var} placeholders", () => {
    const t = createTranslator("en");
    expect(t.t("live.refreshed", { age: "2 min ago" })).toBe("Last refreshed 2 min ago");
  });

  it("has identical key sets in both bundles", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("detects locale: stored choice wins, then browser prefix, then en", () => {
    const store = {
      value: "fr",
      getItem(key: string) {
        return key === LOCALE_STORAGE_KEY ? this.value : null;
      },
    };
    expect(detectLocale(store, "en-US")).toBe("fr");
    store.value = "de"; // unsupported stored value is ignored
    expect(detectLocale(store, "fr-CA")).toBe("fr");
    expect(detectLocale(store, "de-DE")).toBe("en");
    expect(detectLocale(null, "fr-FR")).toBe("fr");
    expect(detectLocale(null, undefined)).toBe("en");
  });

  it("persists the locale choice best-effort", () => {
    const written: Record<string, string> = {};
    persistLocale({ setItem: (k, v) => void (written[k] = v) }, "fr");
    expect(written[LOCALE_STORAGE_KEY]).toBe("fr");
    // A throwing store must not break the flow.
    persistLocale(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      "en",
    );
  });
});
