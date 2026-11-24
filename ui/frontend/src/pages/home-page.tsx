import { useState, useCallback, useRef } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import {
  SparklesIcon,
  LayersIcon,
  ChevronDownIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ListChecksIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { JobCard } from '@/components/job-card'
import { api } from '@/lib/api'
import { visibleFailureNotices } from '@/lib/settings-form'
import { useSocketEvent, useTransitionEvent } from '@/lib/socket'
import { useSession } from '@/hooks/use-session'
import type {
  Job,
  JobProgressPayload,
  JobCompletePayload,
  JobFailedPayload,
  JobTransitionPayload,
} from '@/types'

function isValidUrl(s: string): boolean {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

export function HomePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: session } = useSession()

  const sharedUrl =
    session?.shared_url ??
    new URLSearchParams(window.location.search).get('url') ??
    new URLSearchParams(window.location.search).get('text') ??
    ''

  const autoStart =
    (session?.auto_start === true) ||
    ['1', 'true', 'yes'].includes(
      new URLSearchParams(window.location.search).get('auto') ?? '',
    )

  const [urlInput, setUrlInput] = useState<string>(() => sharedUrl)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [liveFailures, setLiveFailures] = useState<{ key: string; message: string }[]>([])
  const [dismissedFailures, setDismissedFailures] = useState<string[]>([])

  const autoStartFiredRef = useRef(false)

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(),
  })

  const jobs: Job[] = jobsData?.jobs ?? []
  const activeJobs = jobs.filter(
    (j) =>
      j.status === 'queued' ||
      j.status === 'running' ||
      j.status === 'awaiting_approval' ||
      j.status === 'uploading',
  )

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['history-recent'],
    queryFn: () => api.getHistory({ limit: 5, status: 'success' }),
  })

  const { data: failedHistory } = useQuery({
    queryKey: ['history-recent-failed'],
    queryFn: () => api.getHistory({ limit: 3, status: 'failed' }),
  })

  const failureNotices = visibleFailureNotices(
    liveFailures,
    (failedHistory?.items ?? []).map((entry) => ({
      key: `history:${entry.id}`,
      message: entry.error_message ?? '',
    })),
    dismissedFailures,
  )

  const recentCompleted = historyData?.items ?? []

  const invalidateJobs = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
  }, [queryClient])

  const handleJobProgress = useCallback(
    (_p: JobProgressPayload) => {
      invalidateJobs()
    },
    [invalidateJobs],
  )

  const handleJobComplete = useCallback(
    (p: JobCompletePayload) => {
      invalidateJobs()
      void queryClient.invalidateQueries({ queryKey: ['history-recent'] })
      toast.success(
        t('pages.home.recipeCreated', {
          name: p.recipe.name || t('pages.home.untitled'),
        }),
      )
    },
    [invalidateJobs, queryClient, t],
  )

  const handleJobFailed = useCallback(
    (p: JobFailedPayload) => {
      invalidateJobs()
      void queryClient.invalidateQueries({ queryKey: ['history-recent-failed'] })
      const message = p.error?.trim() || t('pages.jobFailed')
      setLiveFailures((prev) => [
        { key: `job:${p.job_id}`, message },
        ...prev.filter((item) => item.key !== `job:${p.job_id}`),
      ])
      toast.error(message, { duration: Infinity, id: `job-failed-${p.job_id}` })
    },
    [invalidateJobs, queryClient, t],
  )

  const handleJobCancelled = useCallback(
    (_p: { job_id: string }) => {
      invalidateJobs()
      toast.info(t('pages.home.jobCancelled'))
    },
    [invalidateJobs, t],
  )

  const handleTransition = useCallback(
    (_p: JobTransitionPayload) => {
      invalidateJobs()
    },
    [invalidateJobs],
  )

  useSocketEvent('job_progress', handleJobProgress)
  useSocketEvent('job_complete', handleJobComplete)
  useSocketEvent('job_failed', handleJobFailed)
  useSocketEvent('job_cancelled', handleJobCancelled)

  useTransitionEvent('running', handleTransition)
  useTransitionEvent('awaiting_approval', handleTransition)
  useTransitionEvent('uploading', handleTransition)
  useTransitionEvent('completed', handleTransition)
  useTransitionEvent('failed', handleTransition)
  useTransitionEvent('cancelled', handleTransition)
  useTransitionEvent('expired', handleTransition)

  const createJobMutation = useMutation({
    mutationFn: (url: string) => api.createJob(url),
    onSuccess: (data) => {
      invalidateJobs()
      setUrlInput('')
      toast.success(
        data.queue_position > 1
          ? t('pages.home.jobQueued', { position: data.queue_position })
          : t('pages.home.jobStarted'),
      )
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const batchJobsMutation = useMutation({
    mutationFn: (urls: string[]) => api.createJobsBatch(urls),
    onSuccess: (data) => {
      invalidateJobs()
      setBatchInput('')
      toast.success(t('pages.home.batchQueued', { count: data.count }))
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => api.cancelJob(jobId),
    onSuccess: () => {
      invalidateJobs()
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const handleSubmit = useCallback(() => {
    const url = urlInput.trim()
    if (!url) {
      toast.error(t('pages.home.enterUrl'))
      return
    }
    if (!isValidUrl(url)) {
      toast.error(t('pages.home.invalidUrl'))
      return
    }
    createJobMutation.mutate(url)
  }, [urlInput, createJobMutation, t])

  const handleBatchSubmit = useCallback(() => {
    const raw = batchInput.trim()
    if (!raw) {
      toast.error(t('pages.home.enterAtLeastOne'))
      return
    }
    const urls = raw
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean)
    if (urls.length > 50) {
      toast.error(t('pages.home.maxBatch'))
      return
    }
    batchJobsMutation.mutate(urls)
  }, [batchInput, batchJobsMutation, t])

  if (
    sharedUrl &&
    autoStart &&
    !autoStartFiredRef.current &&
    !createJobMutation.isPending
  ) {
    autoStartFiredRef.current = true
    if (isValidUrl(sharedUrl)) {
      createJobMutation.mutate(sharedUrl)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{t('nav.app')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('pages.home.tagline')}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder={t('pages.home.pasteUrl')}
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="flex-1"
          />
          <Button
            onClick={handleSubmit}
            disabled={createJobMutation.isPending}
          >
            <SparklesIcon />
            {t('pages.home.extractRecipe')}
          </Button>
        </div>

        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => setBatchOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDownIcon
              className={`size-3.5 transition-transform ${batchOpen ? 'rotate-180' : ''}`}
            />
            {t('pages.home.batchImport')}
          </button>
          {batchOpen && (
            <div className="space-y-2 border-t px-3 pb-3 pt-2">
              <Textarea
                rows={4}
                placeholder={t('pages.home.batchPlaceholder')}
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                className="w-full resize-none text-sm"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBatchSubmit}
                disabled={batchJobsMutation.isPending}
              >
                <LayersIcon />
                {t('pages.home.queueAll')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {failureNotices.length > 0 && (
        <section className="space-y-2">
          {failureNotices.map((notice) => (
            <div
              key={notice.key}
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice.message}</p>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                aria-label={t('pages.home.dismissError')}
                onClick={() =>
                  setDismissedFailures((prev) =>
                    prev.includes(notice.key) ? prev : [...prev, notice.key],
                  )
                }
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ))}
        </section>
      )}

      {(activeJobs.length > 0 || jobsLoading) && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {t('pages.home.activeJobs')}
            {!jobsLoading && (
              <span className="text-xs font-normal text-muted-foreground">
                ({activeJobs.length})
              </span>
            )}
          </h2>
          {jobsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onCancel={(id) => cancelJobMutation.mutate(id)}
                  href={`/jobs/${job.id}`}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {(recentCompleted.length > 0 || historyLoading) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t('pages.home.recentlyCompleted')}</h2>
          {historyLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : (
            <div className="space-y-2">
              {recentCompleted.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm"
                >
                  <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
                  <span className="flex-1 truncate font-medium">
                    {entry.recipe_name ?? entry.video_title ?? t('pages.home.untitledRecipe')}
                  </span>
                  <Link
                    to="/tasks"
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('pages.home.view')}
                  </Link>
                </div>
              ))}
            </div>
          )}
          <Link to="/tasks">
            <Button variant="secondary" size="sm">
              <ListChecksIcon />
              {t('pages.home.viewAllTasks')}
            </Button>
          </Link>
        </section>
      )}

    </div>
  )
}
