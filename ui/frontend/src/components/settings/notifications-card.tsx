import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { BellIcon } from 'lucide-react'

import {
  currentSubscription,
  disablePush,
  enablePush,
  isPushSupported,
  permissionState,
} from '@/lib/push'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * Per-browser notification opt-in. Shown to every user, admin or not — this is
 * a personal preference, not instance configuration.
 *
 * Subscriptions are per browser, not per account, so the state here is read
 * from the PushManager rather than the server: signing in elsewhere should not
 * make this device claim it is subscribed.
 */
export function NotificationsCard() {
  const { t } = useTranslation()
  const supported = isPushSupported()

  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(supported)

  const refresh = useCallback(async () => {
    try {
      setSubscribed((await currentSubscription()) !== null)
    } catch {
      setSubscribed(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    void refresh()
  }, [supported, refresh])

  async function handleToggle(next: boolean) {
    setBusy(true)
    try {
      if (next) {
        await enablePush()
        toast.success(t('settings.notifications.on'))
      } else {
        await disablePush()
        toast.success(t('settings.notifications.off'))
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.notifications.failed'))
      // Re-read rather than assuming the toggle failed cleanly: permission may
      // have been granted even though registering the endpoint did not finish.
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const blocked = permissionState() === 'denied'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellIcon className="size-4" />
          {t('settings.notifications.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.notifications.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 max-w-md">
          <Label htmlFor="push-toggle" className="font-normal">
            {t('settings.notifications.toggle')}
          </Label>
          <Switch
            id="push-toggle"
            checked={subscribed}
            disabled={!supported || blocked || busy || loading}
            onCheckedChange={handleToggle}
          />
        </div>

        {!supported && (
          <p className="text-xs text-muted-foreground">
            {t('settings.notifications.unsupported')}
          </p>
        )}

        {supported && blocked && (
          <p className="text-xs text-destructive">
            {t('settings.notifications.blocked')}
          </p>
        )}

        {supported && !blocked && (
          <p className="text-xs text-muted-foreground">
            {t('settings.notifications.perBrowser')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
