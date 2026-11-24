import { useState } from 'react'
import { toast } from 'sonner'
import { Trans, useTranslation } from 'react-i18next'
import { KeyRoundIcon } from 'lucide-react'

import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MIN_PASSWORD_LENGTH = 10

/** Change your own password. Shown to every user, admin or not. */
export function AccountCard({ username }: { username: string }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === confirm &&
    !saving

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.changeOwnPassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.success(t('settings.account.changed'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.account.changeFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4" />
          {t('settings.account.title')}
        </CardTitle>
        <CardDescription>
          <Trans
            i18nKey="settings.account.description"
            values={{ username }}
            components={{ b: <span className="font-medium text-foreground" /> }}
          />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">{t('settings.account.current')}</Label>
            <Input
              id="current-password"
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">{t('settings.account.new')}</Label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings.account.minLength', { count: MIN_PASSWORD_LENGTH })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-password">{t('settings.account.confirm')}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={mismatch}
            />
            {mismatch && (
              <p className="text-xs text-destructive">
                {t('settings.account.mismatch')}
              </p>
            )}
          </div>
          <Button type="submit" disabled={!canSubmit} className="self-start">
            {saving ? t('settings.account.changing') : t('settings.account.change')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
