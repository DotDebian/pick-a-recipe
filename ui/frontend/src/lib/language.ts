export type Language = 'fr' | 'he' | 'en'

const SUPPORTED: readonly Language[] = ['fr', 'he', 'en']

/**
 * A saved choice wins; otherwise French, whatever the browser says.
 * (This deployment is French-first; the sidebar button still switches.)
 */
export function pickLanguage(stored: string | null, _browserLanguages: readonly string[]): Language {
  if (stored && (SUPPORTED as readonly string[]).includes(stored)) return stored as Language
  return 'fr'
}
