import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { PlusIcon, SearchIcon, ServerIcon, Trash2Icon } from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { hostOf, useCatalogFor } from '@/components/settings/use-catalog-for'
import type { AiProvider, ApiTypeSpec, CatalogModel } from '@/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `provider-${Math.random().toString(36).slice(2, 10)}`
  )
}

function usd(value: number | null, t: TFunction): string {
  if (value === null) return '?'
  if (value === 0) return t('settings.providers.free')
  return `$${value < 0.1 ? value.toFixed(3) : value < 10 ? value.toFixed(2) : value.toFixed(0)}`
}

function contextSize(tokens: number | null): string {
  if (!tokens) return ''
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}K`
}

function priceLine(model: CatalogModel, t: TFunction): string {
  if (model.unit === 'minute') {
    return model.input_cost === 0
      ? t('settings.providers.freeCap')
      : t('settings.providers.perMin', { price: usd(model.input_cost, t) })
  }
  if (model.input_cost === 0 && model.output_cost === 0) return t('settings.providers.freeCap')
  return t('settings.providers.inOut', {
    in: usd(model.input_cost, t),
    out: usd(model.output_cost, t),
  })
}

function priceSummary(model: CatalogModel, t: TFunction): string {
  const unit = model.unit === 'minute' ? t('settings.providers.unitAudio') : t('settings.providers.unitTokens')
  const context = model.context
    ? ` · ${t('settings.providers.contextSize', { size: contextSize(model.context) })}`
    : ''
  return t('settings.providers.priceSummary', { id: model.id, line: priceLine(model, t), unit, context })
}

// Unknown prices sort last, so "cheapest" never opens on a model nobody can price.
// Per-minute and per-token prices are not comparable; they only share a list
// for transcription, where the server already puts per-minute ones first.
const blendedCost = (m: CatalogModel) =>
  m.input_cost === null ? Infinity : m.input_cost + (m.output_cost ?? 0)

/**
 * Model names are always free text. The list only saves people from having to
 * look an id and its price up, so a gateway no catalog has heard of still works.
 */
export function ModelField({
  catalog,
  task = 'chat',
  label,
  value,
  defaultModel = '',
  onChange,
  placeholder,
}: {
  catalog: string
  task?: 'chat' | 'transcription'
  label?: string
  value: string
  /** What runs when the field is left empty, so its price can still be shown. */
  defaultModel?: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const { t } = useTranslation()
  const listId = useId()
  const [browsing, setBrowsing] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'cheapest'>('newest')
  const { data, isLoading } = useQuery({
    queryKey: ['modelCatalog', catalog, task],
    queryFn: () => api.modelCatalog(catalog, task),
    enabled: Boolean(catalog),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })
  const models = useMemo(() => data?.models ?? [], [data])
  const selected = models.find(m => m.id === (value || defaultModel))

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const hits = needle
      ? models.filter(m => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      : models
    return sort === 'cheapest' ? [...hits].sort((a, b) => blendedCost(a) - blendedCost(b)) : hits
  }, [models, search, sort])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={listId}>{label ?? t('settings.providers.model')}</Label>
        {models.length > 0 && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            aria-expanded={browsing}
            onClick={() => setBrowsing(v => !v)}
          >
            {browsing
              ? t('settings.providers.hideModels')
              : t('settings.providers.browseModels', { count: models.length })}
          </button>
        )}
      </div>
      <Input
        id={listId}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {browsing && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('settings.providers.searchModels')}
                className="h-8 ps-7 text-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={sort} onValueChange={v => setSort(v as 'newest' | 'cheapest')}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t('settings.providers.newest')}</SelectItem>
                <SelectItem value="cheapest">{t('settings.providers.cheapest')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ul className="max-h-72 overflow-y-auto" role="listbox" aria-label={t('settings.providers.modelsAria')}>
            {shown.length === 0 && (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">{t('settings.providers.noMatch')}</li>
            )}
            {shown.map(model => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  onClick={() => {
                    onChange(model.id)
                    setBrowsing(false)
                  }}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 rounded px-2 py-1.5 text-start hover:bg-muted',
                    model.id === value && 'bg-muted',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{model.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{model.id}</span>
                  </span>
                  <span className="shrink-0 text-end text-xs tabular-nums">
                    <span className="block">{priceLine(model, t)}</span>
                    {model.context && (
                      <span className="block text-muted-foreground">
                        {t('settings.providers.contextSize', { size: contextSize(model.context) })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {selected
          ? priceSummary(selected, t)
          : isLoading
            ? t('settings.providers.loadingModels')
            : `${t('settings.providers.anyModel')}${models.length ? ` ${t('settings.providers.pricesUsd')}` : ''}`}
      </p>
    </div>
  )
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1'

interface Kind {
  value: string
  api_type: string
  /** Fixed endpoint for a known gateway, so its base URL never has to be typed. */
  base_url?: string
  key_placeholder?: string
  /** Whether `settings.providers.kinds.<value>.hint` / `.link` exist. */
  has_hint?: boolean
  has_link?: boolean
  key_url?: string
}

// What people pick from. OpenRouter is an OpenAI-compatible endpoint to the
// server; here it is just another provider, with its address filled in.
const KINDS: Kind[] = [
  { value: 'openai', api_type: 'openai' },
  { value: 'gemini', api_type: 'gemini' },
  { value: 'anthropic', api_type: 'anthropic' },
  { value: 'claude-subscription', api_type: 'claude-subscription' },
  {
    value: 'openrouter',
    api_type: 'openai-compatible',
    base_url: OPENROUTER_URL,
    key_placeholder: 'sk-or-...',
    has_hint: true,
    has_link: true,
    key_url: 'https://openrouter.ai/keys',
  },
  {
    value: 'openai-compatible',
    api_type: 'openai-compatible',
    has_hint: true,
    key_url: '',
  },
]

const kindLabel = (kind: Kind, t: TFunction) => t(`settings.providers.kinds.${kind.value}.label`)
const shortName = (kind: Kind, t: TFunction) => kindLabel(kind, t).replace(/ \(.*\)$/, '')

function kindOf(provider: AiProvider): Kind {
  if (provider.api_type === 'openai-compatible' && hostOf(provider.base_url) === 'openrouter.ai') {
    return KINDS.find(k => k.value === 'openrouter')!
  }
  return KINDS.find(k => k.value === provider.api_type) ?? KINDS[0]
}

export function AiProvidersCard({
  providers,
  onChange,
}: {
  providers: AiProvider[] | null
  onChange: (providers: AiProvider[]) => void
}) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['aiProviders'],
    queryFn: api.aiProviders,
    staleTime: 30_000,
  })

  // The server does the legacy-settings migration, so the first render adopts
  // whatever it returns rather than guessing here.
  useEffect(() => {
    if (providers === null && data) onChange(data.providers)
  }, [providers, data, onChange])

  const apiTypes: Record<string, ApiTypeSpec> = data?.api_types ?? {}
  const rows = providers ?? data?.providers ?? []
  const catalogFor = useCatalogFor()

  function update(index: number, patch: Partial<AiProvider>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const isSaved = (provider: AiProvider) =>
    Boolean(provider.id && data?.providers.some(p => p.id === provider.id))

  function add() {
    onChange([
      ...rows,
      { id: '', name: '', api_type: 'openai', api_key: '', base_url: '', model: '' },
    ])
  }

  function changeKind(index: number, provider: AiProvider, next: Kind) {
    const previous = kindOf(provider)
    if (previous.value === next.value) return
    // A name still matching the old kind was never really chosen, so it
    // follows the new one. The model belongs to the old vendor either way.
    const renamed = !provider.name.trim() || provider.name === shortName(previous, t)
    update(index, {
      api_type: next.api_type,
      base_url: next.base_url ?? '',
      model: '',
      ...(renamed && {
        name: shortName(next, t),
        id: isSaved(provider) ? provider.id : slugify(shortName(next, t)),
      }),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerIcon className="size-4" />
          {t('settings.providers.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.providers.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('settings.providers.empty')}
          </p>
        )}

        {rows.map((provider, index) => {
          const spec = apiTypes[provider.api_type]
          const kind = kindOf(provider)
          const keyPlaceholder = kind.key_placeholder ?? spec?.key_placeholder ?? 'sk-...'
          const keyHint = kind.has_hint
            ? t(`settings.providers.kinds.${kind.value}.hint`)
            : spec?.key_hint
          const keyUrl = kind.key_url ?? spec?.key_url
          const keyLinkLabel = kind.has_link
            ? t(`settings.providers.kinds.${kind.value}.link`)
            : spec?.key_link_label
          return (
            <div
              key={index}
              className="flex flex-col gap-4 rounded-lg border border-border p-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.providers.name')}</Label>
                  <Input
                    type="text"
                    placeholder="OpenAI"
                    autoComplete="off"
                    value={provider.name}
                    onChange={e =>
                      update(index, {
                        name: e.target.value,
                        // Ids follow the name until the record has been saved
                        // once; renaming a saved provider must not orphan the
                        // sections pointing at it.
                        id: isSaved(provider) ? provider.id : slugify(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.providers.provider')}</Label>
                  <Select
                    value={kind.value}
                    onValueChange={v => changeKind(index, provider, KINDS.find(k => k.value === v)!)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map(k => (
                        <SelectItem key={k.value} value={k.value}>
                          {kindLabel(k, t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.providers.apiKey')}</Label>
                  <Input
                    type="password"
                    placeholder={keyPlaceholder}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={provider.api_key}
                    onChange={e => update(index, { api_key: e.target.value })}
                  />
                  {keyHint && (
                    <p className="text-xs text-muted-foreground">
                      {keyHint}{' '}
                      {keyUrl && (
                        <a
                          href={keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {keyLinkLabel || keyUrl}
                        </a>
                      )}
                    </p>
                  )}
                </div>
                <ModelField
                  label={t('settings.providers.defaultModel')}
                  catalog={catalogFor(provider)}
                  value={provider.model}
                  onChange={model => update(index, { model })}
                  placeholder={spec?.example_model ?? 'model-name'}
                />
              </div>

              {spec?.needs_base_url && !kind.base_url && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.providers.baseUrl')}</Label>
                  <Input
                    type="url"
                    placeholder="https://api.groq.com/openai/v1"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={provider.base_url}
                    onChange={e => update(index, { base_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('settings.providers.baseUrlHint')}
                  </p>
                </div>
              )}

              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                  {t('settings.providers.remove')}
                </Button>
              </div>
            </div>
          )
        })}

        <div>
          <Button type="button" variant="secondary" onClick={add}>
            <PlusIcon />
            {t('settings.providers.add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
