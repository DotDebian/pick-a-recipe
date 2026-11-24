import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AudioLinesIcon, ChefHatIcon, WorkflowIcon } from 'lucide-react'

import type { AiProvider, AppConfig } from '@/types'
import { ModelField } from '@/components/settings/ai-providers-card'
import { useCatalogFor } from '@/components/settings/use-catalog-for'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// The dialects that expose an OpenAI-compatible /audio/transcriptions endpoint.
const AUDIO_API_TYPES = ['openai', 'openai-compatible']

type Get = <K extends keyof AppConfig>(key: K) => AppConfig[K]
type Set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void

function Task({ icon, title, description, children }: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">{icon}{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Choice({ value, onChange, options }: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Which configured provider, and which of its models, does each job. */
export function AiTasksCard({ providers, get, set }: {
  providers: AiProvider[]
  get: Get
  set: Set
}) {
  const { t } = useTranslation()
  const catalogFor = useCatalogFor()
  const named = providers.filter(p => p.name.trim())
  const byId = (id: string) => named.find(p => p.id === id)

  // A provider that was renamed or removed leaves the saved id pointing
  // nowhere; the server falls back to the first, so the page shows the same.
  const extraction = byId(get('ai_extraction_provider') || get('llm_provider')) ?? named[0]

  const audioProviders = named.filter(p => AUDIO_API_TYPES.includes(p.api_type))
  const mode = get('transcription_mode') || 'local'
  const transcriber = mode === 'provider' ? byId(get('transcription_provider')) ?? audioProviders[0] : undefined
  const speechValue = mode === 'off' ? 'off' : transcriber ? `provider:${transcriber.id}` : 'local'

  const providerOptions = named.map(p => ({ value: p.id, label: p.name }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WorkflowIcon className="size-4" />
          {t('settings.tasks.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.tasks.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {named.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('settings.tasks.addProviderFirst')}</p>
        )}

        {extraction && (
          <Task
            icon={<ChefHatIcon className="size-4" />}
            title={t('settings.tasks.recipesTitle')}
            description={t('settings.tasks.recipesDescription')}
          >
            <Field label={t('settings.tasks.provider')}>
              <Choice
                value={extraction.id}
                onChange={v => {
                  set('ai_extraction_provider', v)
                  set('ai_extraction_model', '')
                }}
                options={providerOptions}
              />
            </Field>
            <ModelField
              catalog={catalogFor(extraction)}
              value={get('ai_extraction_model')}
              defaultModel={extraction.model}
              onChange={v => set('ai_extraction_model', v)}
              placeholder={t('settings.tasks.defaultPlaceholder', {
                model: extraction.model || t('settings.tasks.noneSet'),
              })}
            />
          </Task>
        )}

        <Task
          icon={<AudioLinesIcon className="size-4" />}
          title={t('settings.tasks.speechTitle')}
          description={t('settings.tasks.speechDescription')}
        >
          <Field
            label={t('settings.tasks.transcribeWith')}
            hint={transcriber ? t('settings.tasks.fallbackHint') : undefined}
          >
            <Choice
              value={speechValue}
              onChange={v => {
                if (v === 'off' || v === 'local') {
                  set('transcription_mode', v)
                  return
                }
                set('transcription_mode', 'provider')
                set('transcription_provider', v.slice('provider:'.length))
              }}
              options={[
                { value: 'off', label: t('settings.tasks.speechOff') },
                { value: 'local', label: t('settings.tasks.speechLocal') },
                ...audioProviders.map(p => ({ value: `provider:${p.id}`, label: p.name })),
              ]}
            />
          </Field>

          {transcriber ? (
            <ModelField
              catalog={catalogFor(transcriber)}
              task="transcription"
              value={get('transcription_model')}
              onChange={v => set('transcription_model', v)}
              placeholder={catalogFor(transcriber) === 'openrouter' ? 'openai/whisper-large-v3-turbo' : 'whisper-1'}
            />
          ) : speechValue === 'local' ? (
            <>
              <Field label={t('settings.tasks.whisperModel')} hint={t('settings.tasks.whisperHint')}>
                <Choice
                  value={get('whisper_model') || 'small'}
                  onChange={v => set('whisper_model', v)}
                  options={[
                    { value: 'tiny', label: t('settings.tasks.whisper.tiny') },
                    { value: 'base', label: t('settings.tasks.whisper.base') },
                    { value: 'small', label: t('settings.tasks.whisper.small') },
                    { value: 'medium', label: t('settings.tasks.whisper.medium') },
                    { value: 'large-v3', label: t('settings.tasks.whisper.large') },
                  ]}
                />
              </Field>
              <Field
                label={t('settings.tasks.hfToken')}
                hint={
                  <Trans
                    i18nKey="settings.tasks.hfHint"
                    components={{
                      a: (
                        <a
                          href="https://huggingface.co/settings/tokens"
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2 hover:text-foreground"
                        />
                      ),
                    }}
                  />
                }
              >
                <Input
                  type="password"
                  placeholder="hf_..."
                  autoComplete="off"
                  value={get('hf_token')}
                  onChange={e => set('hf_token', e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </Task>
      </CardContent>
    </Card>
  )
}
