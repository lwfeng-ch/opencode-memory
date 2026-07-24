"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { translations, type Language, type TranslationKey } from "./i18n";

interface I18nContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("memoryos-lang");
      if (stored === "zh" || stored === "en") return stored;
      // Detect browser language
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("zh")) return "zh";
    }
    return "en";
  });

  const setLangWithStorage = useCallback((newLang: Language) => {
    setLang(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("memoryos-lang", newLang);
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      let text = (translations[lang][key] ?? translations["en"][key] ?? key) as string;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v));
        });
      }
      return text;
    },
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang: setLangWithStorage, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
