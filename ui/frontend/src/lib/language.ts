export type Language = 'fr' | 'he' | 'en'

const SUPPORTED: readonly Language[] = ['fr', 'he', 'en']

/** A saved choice wins; otherwise the browser's first language when supported, English for everyone else. */
export function pickLanguage(stored: string | null, browserLanguages: readonly string[]): Language {
  if (stored && (SUPPORTED as readonly string[]).includes(stored)) return stored as Language
  const preferred = (browserLanguages[0] ?? '').toLowerCase()
  if (preferred.startsWith('he') || preferred.startsWith('iw')) return 'he'
  if (preferred.startsWith('fr')) return 'fr'
  return 'en'
}
