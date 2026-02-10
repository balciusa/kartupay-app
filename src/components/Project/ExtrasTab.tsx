'use client'

import { useState } from 'react'
import { createExtra, joinExtra, leaveExtra, updateExtraCollector } from '@/app/project/[id]/actions'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

type ExtraItem = {
  id: string
  title: string
  description: string | null
  amount_cents: number
  amount_is_per_person: boolean
  collection_mode: 'project_collector' | 'dedicated_collector'
  dedicated_collector_participant_id: string | null
  collector_label: string
  member_count: number
  member_labels: string[]
  viewer_joined: boolean
  viewer_share_cents: number | null
  created_by_label: string
  can_manage: boolean
}

type CollectorOption = {
  participant_id: string
  label: string
}

const EURO = '\u20AC'
const formatEuro = (cents: number) => `${EURO}${(Math.max(0, Number(cents ?? 0)) / 100).toFixed(2)}`

function CreateExtraModal({
  projectId,
  canInteract,
  projectCanceled,
  projectCollectorLabel,
  collectorOptions,
}: {
  projectId: string
  canInteract: boolean
  projectCanceled?: boolean
  projectCollectorLabel: string
  collectorOptions: CollectorOption[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [collectionMode, setCollectionMode] = useState<'project_collector' | 'dedicated_collector'>('project_collector')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [dedicatedCollectorId, setDedicatedCollectorId] = useState<string>(collectorOptions[0]?.participant_id ?? '')

  const isDisabled = !canInteract || !!projectCanceled

  const closeModal = () => {
    setIsOpen(false)
    setCollectionMode('project_collector')
    setSubmitError(null)
    setDedicatedCollectorId(collectorOptions[0]?.participant_id ?? '')
  }

  const handleSubmit = async (formData: FormData) => {
    if (collectionMode === 'dedicated_collector' && !dedicatedCollectorId) {
      setSubmitError('Select an extra collector')
      return
    }
    setSubmitError(null)
    try {
      await createExtra(projectId, formData)
      closeModal()
    } catch (error: unknown) {
      const maybeError = error as { message?: string } | null
      setSubmitError(maybeError?.message || 'Failed to create extra')
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        disabled={isDisabled}
        className="rounded-full px-5 py-2.5 text-sm flex items-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Create extra
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close create extra modal"
            className="absolute inset-0 bg-black/40"
            onClick={closeModal}
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl border flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold">Create extra</h2>
                <p className="text-sm text-muted-foreground">Create an optional add-on for participants</p>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>

            <form action={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  name="title"
                  placeholder="Sauna, private shuttle, premium drinks..."
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                  disabled={isDisabled}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  name="description"
                  placeholder="Add context for this extra"
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  disabled={isDisabled}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{EURO}</span>
                    <input
                      name="amount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="w-full border rounded-lg pl-7 pr-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                      required
                      disabled={isDisabled}
                    />
                  </div>
                  <div className="rounded-lg border px-3 py-2.5 space-y-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="radio" name="amount_is_per_person" value="false" defaultChecked disabled={isDisabled} />
                      Extra grand total
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="radio" name="amount_is_per_person" value="true" disabled={isDisabled} />
                      Extra cost per person
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Funds collector</label>
                  <div className="rounded-lg border px-3 py-2.5 space-y-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="collection_mode"
                        value="project_collector"
                        checked={collectionMode === 'project_collector'}
                        onChange={() => setCollectionMode('project_collector')}
                        disabled={isDisabled}
                      />
                      Project collector ({projectCollectorLabel})
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="collection_mode"
                        value="dedicated_collector"
                        checked={collectionMode === 'dedicated_collector'}
                        onChange={() => setCollectionMode('dedicated_collector')}
                        disabled={isDisabled || collectorOptions.length === 0}
                      />
                      Extra collector
                    </label>
                  </div>
                  {collectionMode === 'dedicated_collector' && (
                    <select
                      name="dedicated_collector_participant_id"
                      value={dedicatedCollectorId}
                      onChange={event => setDedicatedCollectorId(event.target.value)}
                      className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                      required
                      disabled={isDisabled || collectorOptions.length === 0}
                    >
                      {collectorOptions.length === 0 ? (
                        <option value="">No participants available</option>
                      ) : (
                        collectorOptions.map(option => (
                          <option key={option.participant_id} value={option.participant_id}>
                            {option.label}
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>
              </div>

              {submitError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeModal} className="rounded-full px-5">
                  Cancel
                </Button>
                <Button type="submit" disabled={isDisabled} className="rounded-full px-5">
                  Create extra
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function ExtraCollectorManager({
  projectId,
  extra,
  projectCollectorLabel,
  collectorOptions,
  disabled,
}: {
  projectId: string
  extra: ExtraItem
  projectCollectorLabel: string
  collectorOptions: CollectorOption[]
  disabled?: boolean
}) {
  const [collectionMode, setCollectionMode] = useState<'project_collector' | 'dedicated_collector'>(extra.collection_mode)
  const [dedicatedCollectorId, setDedicatedCollectorId] = useState<string>(
    extra.dedicated_collector_participant_id ?? collectorOptions[0]?.participant_id ?? ''
  )
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (formData: FormData) => {
    if (collectionMode === 'dedicated_collector' && !dedicatedCollectorId) {
      setSubmitError('Select an extra collector')
      return
    }
    setSubmitError(null)
    try {
      await updateExtraCollector(projectId, extra.id, formData)
    } catch (error: unknown) {
      const maybeError = error as { message?: string } | null
      setSubmitError(maybeError?.message || 'Failed to update collector')
    }
  }

  return (
    <details className="border rounded-lg p-3">
      <summary className="text-xs font-medium cursor-pointer select-none">Collector settings</summary>
      <form action={handleSubmit} className="mt-3 space-y-3">
        <div className="rounded-lg border px-3 py-2.5 space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="collection_mode"
              value="project_collector"
              checked={collectionMode === 'project_collector'}
              onChange={() => setCollectionMode('project_collector')}
              disabled={disabled}
            />
            Project collector ({projectCollectorLabel})
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="collection_mode"
              value="dedicated_collector"
              checked={collectionMode === 'dedicated_collector'}
              onChange={() => setCollectionMode('dedicated_collector')}
              disabled={disabled || collectorOptions.length === 0}
            />
            Extra collector
          </label>
        </div>

        {collectionMode === 'dedicated_collector' && (
          <select
            name="dedicated_collector_participant_id"
            value={dedicatedCollectorId}
            onChange={event => setDedicatedCollectorId(event.target.value)}
            className="w-full border rounded-lg px-3 py-2 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
            required
            disabled={disabled || collectorOptions.length === 0}
          >
            {collectorOptions.map(option => (
              <option key={option.participant_id} value={option.participant_id}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {submitError && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="outline" className="rounded-full px-4" disabled={disabled}>
            Save collector
          </Button>
        </div>
      </form>
    </details>
  )
}

export function ExtrasTab({
  projectId,
  extras,
  canInteract,
  projectCanceled,
  projectCollectorLabel,
  collectorOptions,
}: {
  projectId: string
  extras: ExtraItem[]
  canInteract: boolean
  projectCanceled?: boolean
  projectCollectorLabel: string
  collectorOptions: CollectorOption[]
}) {
  const isDisabled = !canInteract || !!projectCanceled
  const totalExtras = extras.length
  const joinedExtras = extras.filter(extra => extra.viewer_joined).length

  return (
    <div className="space-y-4">
      {projectCanceled && (
        <div className="rounded border border-dashed p-3 text-sm text-red-700 bg-red-50/50">
          Extras are disabled because the project is canceled.
        </div>
      )}

      {!canInteract && (
        <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
          Only active participants can join or create extras.
        </div>
      )}

      <section className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold">Extras</h2>
            <p className="text-sm text-muted-foreground">Optional add-ons inside this project</p>
          </div>
          <CreateExtraModal
            projectId={projectId}
            canInteract={canInteract}
            projectCanceled={projectCanceled}
            projectCollectorLabel={projectCollectorLabel}
            collectorOptions={collectorOptions}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <div className="rounded-md border bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
            Total extras: <span className="font-semibold">{totalExtras}</span>
          </div>
          <div className="rounded-md border bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
            Joined by you: <span className="font-semibold">{joinedExtras}</span>
          </div>
        </div>
      </section>

      {extras.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No extras yet.</div>
      ) : (
        <div className="space-y-3">
          {extras.map(extra => {
            const pricingLabel = extra.amount_is_per_person ? 'Per person' : 'Grand total'
            const statusLabel = extra.viewer_joined ? 'Joined' : 'Not joined'
            const collectorLabel =
              extra.collection_mode === 'dedicated_collector' ? `${extra.collector_label} (Extra)` : extra.collector_label

            return (
              <section key={extra.id} className="rounded-xl border bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{extra.title}</h3>
                    {extra.description ? <p className="mt-1 text-sm text-muted-foreground">{extra.description}</p> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">{pricingLabel}</div>
                    <div className="text-sm font-semibold text-slate-900">{formatEuro(extra.amount_cents)}</div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Members</div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-800">{extra.member_count}</div>
                      <div className="text-xs text-slate-600">
                        {extra.member_labels.length > 0 ? extra.member_labels.join(', ') : 'No joined participants'}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Collector</div>
                    <div className="text-sm text-slate-800">{collectorLabel}</div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Created by</div>
                    <div className="text-sm text-slate-800">{extra.created_by_label}</div>
                  </div>
                  <div className="rounded-md border bg-slate-50 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Your status</div>
                    <div className="text-sm text-slate-800">
                      {statusLabel}
                      {extra.viewer_joined && extra.viewer_share_cents !== null
                        ? ` • Share ${formatEuro(extra.viewer_share_cents)}`
                        : ''}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="text-xs text-slate-500">
                    {extra.amount_is_per_person
                      ? 'Each joined participant pays this amount.'
                      : 'Grand total is split among joined participants.'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {extra.viewer_joined ? (
                      <form action={leaveExtra.bind(null, projectId, extra.id)}>
                        <Button type="submit" variant="outline" className="rounded-full px-4" disabled={isDisabled}>
                          Leave extra
                        </Button>
                      </form>
                    ) : (
                      <form action={joinExtra.bind(null, projectId, extra.id)}>
                        <Button type="submit" className="rounded-full px-4" disabled={isDisabled}>
                          Join extra
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                {extra.can_manage && (
                  <ExtraCollectorManager
                    projectId={projectId}
                    extra={extra}
                    projectCollectorLabel={projectCollectorLabel}
                    collectorOptions={collectorOptions}
                    disabled={isDisabled}
                  />
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
