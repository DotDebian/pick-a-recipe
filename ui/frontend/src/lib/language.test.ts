import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickLanguage } from './language.ts'

describe('pickLanguage', () => {
  it('keeps a saved choice', () => {
    assert.equal(pickLanguage('he', ['en-US']), 'he')
    assert.equal(pickLanguage('en', ['fr-FR']), 'en')
    assert.equal(pickLanguage('fr', ['en-US']), 'fr')
  })

  it('defaults to French whatever the browser language', () => {
    assert.equal(pickLanguage(null, ['en-US']), 'fr')
    assert.equal(pickLanguage(null, ['he-IL']), 'fr')
    assert.equal(pickLanguage(null, []), 'fr')
  })

  it('ignores an unknown saved value', () => {
    assert.equal(pickLanguage('xx', ['en-US']), 'fr')
  })
})
