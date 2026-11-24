import { useCallback, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trans, useTranslation } from 'react-i18next'
import {
  LanguagesIcon,
  SendIcon,
  VideoIcon,
  ListIcon,
  DatabaseBackupIcon,
  SaveIcon,
  UploadIcon,
  Trash2Icon,
  DownloadIcon,
  UsersIcon,
  UtensilsIcon,
} from 'lucide-react'

import { api } from '@/lib/api'
import type { AiProvider, AppConfig } from '@/types'
import { useSession } from '@/hooks/use-session'
import { AccountCard } from '@/components/settings/account-card'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { UsersCard } from '@/components/settings/users-card'
import { AiProvidersCard } from '@/components/settings/ai-providers-card'
import { AiTasksCard } from '@/components/settings/ai-tasks-card'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type Draft = Partial<AppConfig>

function useDraft(loaded: AppConfig | undefined) {
  const [draft, setDraft] = useState<Draft>({})

  function get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    if (key in draft) return draft[key] as AppConfig[K]
    return (loaded?.[key] ?? '') as AppConfig[K]
  }

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function reset() {
    setDraft({})
  }

  const dirty = Object.keys(draft).length > 0

  return { get, set, reset, draft, dirty }
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground mt-1">{children}</p>
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <FieldHint>{hint}</FieldHint>}
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: session, isLoading: sessionLoading } = useSession()
  const isAdmin = session?.is_admin ?? false
  const localAuth = session?.local_auth_enabled ?? false

  const { data: loaded, isLoading: configLoading } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
    // Instance configuration holds the API keys, so the server refuses it to
    // non-admins. Not asking avoids a pointless 403 on every visit.
    enabled: isAdmin,
  })

  const { get, set, reset, draft, dirty } = useDraft(loaded)

  const [providers, setProvidersState] = useState<AiProvider[] | null>(null)

  const setProviders = useCallback(
    (next: AiProvider[]) => {
      // Adopting the server's registry on first render is not an edit, so
      // only a later change marks the form dirty and gets saved.
      if (providers !== null) set('ai_providers', JSON.stringify(next))
      setProvidersState(next)
    },
    [providers, set],
  )

  const [saving, setSaving] = useState(false)
  const [cookiesUploading, setCookiesUploading] = useState(false)
  const cookiesFileRef = useRef<HTMLInputElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  async function handleSave() {
    if (!dirty) return
    setSaving(true)
    try {
      await api.saveConfig(draft)
      toast.success(t('settings.page.saved'))
      if (providers) {
        queryClient.setQueryData(
          ['aiProviders'],
          (current: { providers: AiProvider[] } | undefined) =>
            current ? { ...current, providers } : current,
        )
      }
      reset()
      await queryClient.invalidateQueries({ queryKey: ['config'] })
      await queryClient.invalidateQueries({ queryKey: ['aiProviders'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.page.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleCookiesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setCookiesUploading(true)
    try {
      const result = await api.uploadCookies(file)
      toast.success(result.message)
      await queryClient.invalidateQueries({ queryKey: ['config'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.page.cookiesUploadFailed'))
    } finally {
      setCookiesUploading(false)
    }
  }

  async function handleDeleteCookies() {
    try {
      const result = await api.deleteCookies()
      toast.success(result.message)
      await queryClient.invalidateQueries({ queryKey: ['config'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.page.cookiesDeleteFailed'))
    }
  }

  async function handleExport() {
    try {
      const data = await api.exportSettings()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      a.href = url
      a.download = `settings-${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.page.exportFailed'))
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      await api.importSettings(parsed)
      toast.success(t('settings.page.imported'))
      reset()
      await queryClient.invalidateQueries({ queryKey: ['config'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.page.importFailed'))
    }
  }

  // null until the providers card has adopted the server's (already migrated)
  // registry, so an unedited page never saves a list it has not seen.
  const providerRows = providers ?? []
  const libraryEnabled = get('library_enabled') !== 'false'
  const mealieEnabled = get('mealie_enabled') === 'true'
  const tandoorEnabled = get('tandoor_enabled') === 'true'
  const confirmBeforeUpload = get('confirm_before_upload') === 'true'
  // Default on: the lookup needs no key, so only an explicit 'false' means off.
  const nutritionLookupEnabled = get('nutrition_lookup_enabled') !== 'false'
  const hasCookiesFile = Boolean(loaded?.yt_dlp_cookies_file)

  if (sessionLoading || (isAdmin && configLoading)) {
    return (
      <div className="p-6 text-muted-foreground text-sm">{t('settings.page.loading')}</div>
    )
  }

  // Non-admins get their own account and nothing else: everything below is
  // instance-wide, and the server refuses it to them anyway.
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{t('settings.page.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('settings.page.nonAdminNote')}
          </p>
        </div>
        <NotificationsCard />
        {localAuth && session && <AccountCard username={session.user} />}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t('settings.page.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.page.subtitle')}</p>
      </div>

      <AiProvidersCard providers={providers} onChange={setProviders} />

      <AiTasksCard providers={providerRows} get={get} set={set} />

      {/* Nutrition */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UtensilsIcon className="size-4" />
            {t('settings.nutrition.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.nutrition.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="nutrition_lookup_enabled"
              checked={nutritionLookupEnabled}
              onCheckedChange={checked =>
                set('nutrition_lookup_enabled', checked ? 'true' : 'false')
              }
            />
            <div>
              <Label htmlFor="nutrition_lookup_enabled">
                {t('settings.nutrition.toggle')}
              </Label>
              <p className="text-xs text-muted-foreground">
                <Trans
                  i18nKey="settings.nutrition.toggleHint"
                  components={{
                    a: (
                      <a
                        href="https://world.openfoodfacts.org/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      />
                    ),
                  }}
                />
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recipe Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LanguagesIcon className="size-4" />
            {t('settings.language.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label={t('settings.language.title')}
            hint={t('settings.language.hint')}
          >
            <Input
              type="text"
              placeholder={t('settings.language.placeholder')}
              value={get('recipe_lang')}
              onChange={e => set('recipe_lang', e.target.value)}
            />
          </Field>
          <Field
            label={t('settings.language.codeLabel')}
            hint={
              <Trans
                i18nKey="settings.language.codeHint"
                components={{ c: <code className="font-mono text-xs" /> }}
              />
            }
          >
            <Input
              type="text"
              placeholder={t('settings.language.codePlaceholder')}
              value={get('target_language')}
              onChange={e => set('target_language', e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Recipe Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SendIcon className="size-4" />
            {t('settings.export.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.export.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t('settings.export.libraryTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('settings.export.libraryDescription')}
              </p>
            </div>
            <Switch
              checked={libraryEnabled}
              onCheckedChange={checked => set('library_enabled', checked ? 'true' : 'false')}
              aria-label={t('settings.export.libraryAria')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Mealie */}
            <Card className={mealieEnabled ? '' : 'opacity-60'}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Mealie</CardTitle>
                  <Switch
                    checked={mealieEnabled}
                    onCheckedChange={checked =>
                      set('mealie_enabled', checked ? 'true' : 'false')
                    }
                    aria-label={t('settings.export.mealieAria')}
                  />
                </div>
                <CardDescription className="text-xs">
                  {mealieEnabled ? t('settings.export.enabled') : t('settings.export.disabled')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Field label={t('settings.export.mealieUrl')}>
                  <Input
                    type="url"
                    placeholder="http://localhost:9925"
                    autoComplete="off"
                    value={get('mealie_host')}
                    onChange={e => set('mealie_host', e.target.value)}
                  />
                </Field>
                <Field label={t('settings.export.mealieKey')}>
                  <Input
                    type="password"
                    placeholder={t('settings.export.mealieKeyPlaceholder')}
                    autoComplete="off"
                    value={get('mealie_api_key')}
                    onChange={e => set('mealie_api_key', e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>

            {/* Tandoor */}
            <Card className={tandoorEnabled ? '' : 'opacity-60'}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Tandoor</CardTitle>
                  <Switch
                    checked={tandoorEnabled}
                    onCheckedChange={checked =>
                      set('tandoor_enabled', checked ? 'true' : 'false')
                    }
                    aria-label={t('settings.export.tandoorAria')}
                  />
                </div>
                <CardDescription className="text-xs">
                  {tandoorEnabled ? t('settings.export.enabled') : t('settings.export.disabled')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Field label={t('settings.export.tandoorUrl')}>
                  <Input
                    type="url"
                    placeholder="https://tandoor.example.com"
                    autoComplete="off"
                    value={get('tandoor_host')}
                    onChange={e => set('tandoor_host', e.target.value)}
                  />
                </Field>
                <Field label={t('settings.export.tandoorKey')}>
                  <Input
                    type="password"
                    placeholder={t('settings.export.tandoorKeyPlaceholder')}
                    autoComplete="off"
                    value={get('tandoor_api_key')}
                    onChange={e => set('tandoor_api_key', e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>
          </div>

          {!libraryEnabled && !mealieEnabled && !tandoorEnabled && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <strong>{t('settings.export.noDestinationTitle')}</strong> {t('settings.export.noDestinationBody')}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch
              id="confirm_before_upload"
              checked={confirmBeforeUpload}
              onCheckedChange={checked =>
                set('confirm_before_upload', checked ? 'true' : 'false')
              }
            />
            <div>
              <Label htmlFor="confirm_before_upload">{t('settings.export.confirmLabel')}</Label>
              <FieldHint>{t('settings.export.confirmHint')}</FieldHint>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Video Downloads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <VideoIcon className="size-4" />
            {t('settings.video.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.video.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.video.uploadLabel')}</Label>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                disabled={cookiesUploading}
                onClick={() => cookiesFileRef.current?.click()}
              >
                <UploadIcon />
                {cookiesUploading ? t('settings.video.uploading') : t('settings.video.choose')}
              </Button>
              {hasCookiesFile && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <Trash2Icon />
                      {t('settings.video.delete')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('settings.video.deleteTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('settings.video.deleteBody')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('settings.video.cancel')}</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={handleDeleteCookies}>
                        {t('settings.video.confirmDelete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <span className="text-sm text-muted-foreground">
                {hasCookiesFile ? t('settings.video.configured') : t('settings.video.notConfigured')}
              </span>
            </div>
            <input
              ref={cookiesFileRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleCookiesUpload}
            />
            <FieldHint>
              <Trans
                i18nKey="settings.video.hint"
                components={{
                  a: (
                    <a
                      href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    />
                  ),
                }}
              />
            </FieldHint>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">{t('settings.video.howTitle')}</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>{t('settings.video.step1')}</li>
              <li>{t('settings.video.step2')}</li>
              <li>{t('settings.video.step3')}</li>
              <li>{t('settings.video.step4')}</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListIcon className="size-4" />
            {t('settings.queue.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            label={t('settings.queue.maxJobs')}
            hint={t('settings.queue.maxJobsHint')}
          >
            <Input
              type="number"
              min={1}
              max={16}
              value={get('max_concurrent_jobs') || '3'}
              onChange={e => {
                const clamped = Math.min(16, Math.max(1, Number(e.target.value)))
                set('max_concurrent_jobs', String(clamped))
              }}
              className="w-28"
            />
          </Field>
        </CardContent>
      </Card>

      <NotificationsCard />

      {localAuth && session && (
        <>
          <AccountCard username={session.user} />
          <UsersCard currentUsername={session.user} />
        </>
      )}

      {!localAuth && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersIcon className="size-4" />
              {t('settings.accounts.title')}
            </CardTitle>
            <CardDescription>
              {t('settings.accounts.oidcBody')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackupIcon className="size-4" />
            {t('settings.backup.title')}
          </CardTitle>
          <CardDescription>
            {t('settings.backup.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" onClick={handleExport}>
                <DownloadIcon />
                {t('settings.backup.export')}
              </Button>
              <FieldHint>{t('settings.backup.exportHint')}</FieldHint>
            </div>
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" onClick={() => importFileRef.current?.click()}>
                <UploadIcon />
                {t('settings.backup.import')}
              </Button>
              <FieldHint>{t('settings.backup.importHint')}</FieldHint>
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleImport}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-end border-t border-border bg-background/90 px-4 py-3 backdrop-blur-sm">
          <Button onClick={handleSave} disabled={saving}>
            <SaveIcon />
            {saving ? t('settings.page.saving') : t('settings.page.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
