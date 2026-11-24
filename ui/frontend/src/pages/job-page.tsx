import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trans, useTranslation } from 'react-i18next'
import { HomeIcon, ListChecksIcon } from 'lucide-react'
import { JobCard } from '@/components/job-card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
import { api } from '@/lib/api'
import { useJobRoom, useSocketEvent, useTransitionEvent } from '@/lib/socket'
import type { Job, JobProgressPayload, JobCompletePayload, JobFailedPayload, JobTransitionPayload } from '@/types'

function formatTimestamp(raw: string, locale: string): string {
  try {
    return new Date(raw.replace(' ', 'T')).toLocaleString(locale)
  } catch {
    return raw
  }
}

export function JobPage() {
  const { t, i18n } = useTranslation()
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const queryKey = ['job', jobId]

  const { data: job, isLoading, isError, error } = useQuery<Job>({
    queryKey,
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
    retry: (count, err) => {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
        return false
      }
      return count < 2
    },
  })

  useEffect(() => {
    if (job?.video_title) {
      document.title = t('tasks.job.docTitle', { title: job.video_title })
    } else {
      document.title = t('tasks.job.docTitleDefault')
    }
    return () => {
      document.title = 'Pick-a-Recipe'
    }
  }, [job?.video_title, t])

  useJobRoom(jobId)

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  useSocketEvent(
    'job_progress',
    useCallback(
      (data: JobProgressPayload) => {
        if (data.job_id === jobId) invalidate()
      },
      [jobId, invalidate],
    ),
  )

  useSocketEvent(
    'job_complete',
    useCallback(
      (data: JobCompletePayload) => {
        if (data.job_id === jobId) invalidate()
      },
      [jobId, invalidate],
    ),
  )

  useSocketEvent(
    'job_failed',
    useCallback(
      (data: JobFailedPayload) => {
        if (data.job_id !== jobId) return
        invalidate()
        toast.error(data.error?.trim() || t('tasks.job.failed'), {
          duration: Infinity,
          id: `job-failed-${data.job_id}`,
        })
      },
      [jobId, invalidate, t],
    ),
  )

  useSocketEvent(
    'job_cancelled',
    useCallback(
      (data: { job_id: string }) => {
        if (data.job_id === jobId) invalidate()
      },
      [jobId, invalidate],
    ),
  )

  const handleTransition = useCallback(
    (data: JobTransitionPayload) => {
      if (data.job_id === jobId) invalidate()
    },
    [jobId, invalidate],
  )

  useTransitionEvent('running', handleTransition)
  useTransitionEvent('awaiting_approval', handleTransition)
  useTransitionEvent('uploading', handleTransition)
  useTransitionEvent('completed', handleTransition)
  useTransitionEvent('expired', handleTransition)

  const handleCancel = useCallback(async () => {
    if (!jobId) return
    setCancelling(true)
    try {
      await api.cancelJob(jobId)
      toast.success(t('tasks.job.cancelled'))
      invalidate()
    } catch {
      toast.error(t('tasks.job.cancelFailed'))
    } finally {
      setCancelling(false)
    }
  }, [jobId, invalidate, t])

  const handleRetry = useCallback(async () => {
    if (!job) return
    setRetrying(true)
    try {
      const data = await api.retryJob({ url: job.url })
      toast.success(t('tasks.job.retryStarted'))
      navigate(`/jobs/${data.job_id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('tasks.job.retryFailed'))
    } finally {
      setRetrying(false)
    }
  }, [job, navigate, t])

  const is404 =
    isError &&
    error instanceof Error &&
    'status' in error &&
    (error as { status: number }).status === 404

  if (!jobId) {
    void navigate('/')
    return null
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">
            <HomeIcon className="size-4" />
            {t('tasks.job.home')}
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/tasks">
            <ListChecksIcon className="size-4" />
            {t('tasks.job.tasks')}
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}

      {is404 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.job.notFoundTitle')}</CardTitle>
            <CardDescription>
              <Trans
                i18nKey="tasks.job.notFoundBody"
                components={{ id: <span className="font-mono text-xs">{jobId}</span> }}
              />{' '}
              <Link to="/" className="underline underline-offset-4 hover:text-foreground">
                {t('tasks.job.goHome')}
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {isError && !is404 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('tasks.job.loadFailed')}</CardTitle>
            <CardDescription>{error instanceof Error ? error.message : t('tasks.job.unknownError')}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {job && (
        <>
          <AlertDialog>
            <JobCard
              job={job}
              onCancel={
                cancelling
                  ? undefined
                  : () => {
                      document.getElementById('cancel-trigger')?.click()
                    }
              }
              onRetry={
                (job.status === 'failed' || job.status === 'expired') && !retrying
                  ? () => {
                      void handleRetry()
                    }
                  : undefined
              }
            />
            <AlertDialogTrigger id="cancel-trigger" className="sr-only" />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('tasks.job.cancelTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('tasks.job.cancelDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('tasks.job.keepRunning')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void handleCancel()}>
                  {t('tasks.cancelJob')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <p className="text-xs text-muted-foreground text-center">
            {t('tasks.job.created', { date: formatTimestamp(job.created_at, i18n.language) })}
            {job.updated_at !== job.created_at && (
              <> &middot; {t('tasks.job.updated', { date: formatTimestamp(job.updated_at, i18n.language) })}</>
            )}
          </p>
        </>
      )}
    </div>
  )
}
