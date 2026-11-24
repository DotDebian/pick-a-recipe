import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'

import en from '@/locales/en'
import fr from '@/locales/fr'
import he from '@/locales/he'
import { sectionsEn, sectionsFr } from '@/locales/sections'
import { pickLanguage } from '@/lib/language'

export const LANGUAGES = [
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'he', label: 'עברית', dir: 'rtl' },
] as const
export type Language = (typeof LANGUAGES)[number]['code']

const STORAGE_KEY = 'lang'

function initialLanguage(): Language {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private mode: fall through to the browser language.
  }
  return pickLanguage(stored, navigator.languages ?? [navigator.language])
}

export function dirFor(lang: string): 'rtl' | 'ltr' {
  return lang.startsWith('he') ? 'rtl' : 'ltr'
}

function applyDocument(lang: string) {
  document.documentElement.lang = lang
  document.documentElement.dir = dirFor(lang)
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, ...sectionsEn } },
    fr: { translation: { ...fr, ...sectionsFr } },
    // Hebrew has no translation of the section tables yet; i18next falls back to en.
    he: { translation: he },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

applyDocument(i18n.language)
i18n.on('languageChanged', (lang) => {
  applyDocument(lang)
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Not persisted; the choice still holds for this tab.
  }
})

export function useDirection(): 'rtl' | 'ltr' {
  const { i18n: instance } = useTranslation()
  return dirFor(instance.language)
}

export default i18n
