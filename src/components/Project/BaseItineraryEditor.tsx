'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createBaseItineraryItem,
  deleteBaseItineraryItem,
  updateBaseItineraryItem,
} from '@/app/project/[id]/actions'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

type BaseItineraryItem = {
  id: string
  title: string
  amount_cents: number
  sort_order: number
  created_at: string
}

const formatEuro = (cents: number) => `EUR ${(Math.max(0, Number(cents ?? 0)) / 100).toFixed(2)}`

const resolveErrorMessage = (error: unknown, fallback: string) => {
  const maybeError = error as { message?: string } | null
  return maybeError?.message || fallback
}

export function BaseItineraryEditor({
  projectId,
  available,
  items,
  variant = 'standalone',
  targetTotalCents = null,
}: {
  projectId: string
  available: boolean
  items: BaseItineraryItem[]
  variant?: 'standalone' | 'embedded'
  targetTotalCents?: number | null
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<BaseItineraryItem | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const addFormRef = useRef<HTMLFormElement | null>(null)

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const orderDelta = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
        if (orderDelta !== 0) return orderDelta
        return String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      }),
    [items]
  )
  const itineraryTotalCents = useMemo(
    () => sortedItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount_cents ?? 0)), 0),
    [sortedItems]
  )
  const isEmbedded = variant === 'embedded'

  const closeAddModal = useCallback(() => {
    setAddOpen(false)
    setSubmitError(null)
    addFormRef.current?.reset()
  }, [])

  const openAddModal = useCallback(() => {
    setSubmitError(null)
    setDeleteError(null)
    setAddOpen(true)
  }, [])

  const closeEditModal = useCallback(() => {
    setEditOpen(false)
    setSelectedItem(null)
    setSubmitError(null)
    setDeleteError(null)
  }, [])

  const openEditModal = useCallback((item: BaseItineraryItem) => {
    setSelectedItem(item)
    setSubmitError(null)
    setDeleteError(null)
    setEditOpen(true)
  }, [])

  useEffect(() => {
    if (!addOpen && !editOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (editOpen) closeEditModal()
      if (addOpen) closeAddModal()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [addOpen, editOpen, closeAddModal, closeEditModal])

  const handleAddSubmit = async (formData: FormData) => {
    setSubmitError(null)
    try {
      await createBaseItineraryItem(projectId, formData)
      closeAddModal()
    } catch (error: unknown) {
      setSubmitError(resolveErrorMessage(error, 'Failed to add itinerary item'))
    }
  }

  const handleEditSubmit = async (formData: FormData) => {
    if (!selectedItem) return
    setSubmitError(null)
    try {
      await updateBaseItineraryItem(projectId, selectedItem.id, formData)
      closeEditModal()
    } catch (error: unknown) {
      setSubmitError(resolveErrorMessage(error, 'Failed to update itinerary item'))
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return
    if (!window.confirm('Delete this itinerary item?')) return
    setDeleteError(null)
    try {
      await deleteBaseItineraryItem(projectId, selectedItem.id)
      closeEditModal()
    } catch (error: unknown) {
      setDeleteError(resolveErrorMessage(error, 'Failed to delete itinerary item'))
    }
  }

  if (!available) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Base itinerary is unavailable until the latest database migration is applied.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!isEmbedded ? (
        <>
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold">Base price itinerary</h2>
            <p className="text-sm text-muted-foreground">Add items, then click any item below to edit or delete it.</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <Button type="button" onClick={openAddModal} className="rounded-full px-5 py-2.5 text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          </div>
        </>
      ) : (
        <div className="flex justify-end">
          <Button type="button" onClick={openAddModal} variant="outline" className="rounded-full px-4 py-2 text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add item
          </Button>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {!isEmbedded ? (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-900">Items</h3>
          </div>
        ) : null}

        {sortedItems.length === 0 ? (
          <div className="px-4 py-3 text-sm text-slate-500">
            {isEmbedded ? 'No base itinerary has been published yet.' : 'No itinerary items yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="w-14 border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">#</th>
                  <th className="border-b border-r border-slate-200 px-3 py-2 text-left font-semibold">Title</th>
                  <th className="w-44 border-b border-slate-200 px-3 py-2 text-right font-semibold">Included price</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item, index) => (
                  <tr key={item.id} className="bg-white odd:bg-white even:bg-slate-50/60">
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-600">{index + 1}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(item)}
                        className="w-full text-left font-medium text-slate-900 underline decoration-dotted underline-offset-2 hover:text-slate-700"
                      >
                        {item.title}
                      </button>
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-right font-medium text-slate-900">
                      {formatEuro(item.amount_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {targetTotalCents !== null ? (
                <tfoot>
                  <tr className="bg-slate-100/80">
                    <td className="border-r border-slate-200 px-3 py-2 text-right font-semibold text-slate-700" colSpan={2}>
                      Itinerary total
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {formatEuro(itineraryTotalCents)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>

      {targetTotalCents !== null && itineraryTotalCents !== targetTotalCents ? (
        <div className="text-xs text-slate-500">
          Note: itinerary total is {formatEuro(itineraryTotalCents)}, while base target is {formatEuro(targetTotalCents)}.
        </div>
      ) : null}

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close add itinerary item modal"
            className="absolute inset-0 bg-black/40"
            onClick={closeAddModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add base itinerary item"
            className="relative w-full max-w-lg rounded-xl bg-white shadow-xl border flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold">Add itinerary item</h2>
                <p className="text-sm text-muted-foreground">Create a base itinerary line with included price.</p>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                onClick={closeAddModal}
              >
                Cancel
              </button>
            </div>

            <form ref={addFormRef} action={handleAddSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  name="title"
                  placeholder="Welcome dinner, venue access, transport pickup..."
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Included price <span className="text-red-500">*</span>
                </label>
                <input
                  name="amount_eur"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0.00"
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                />
              </div>

              {submitError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeAddModal} className="rounded-full px-5">
                  Cancel
                </Button>
                <Button type="submit" className="rounded-full px-5">
                  Submit
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close edit itinerary item modal"
            className="absolute inset-0 bg-black/40"
            onClick={closeEditModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit base itinerary item"
            className="relative w-full max-w-lg rounded-xl bg-white shadow-xl border flex flex-col max-h-[90vh]"
          >
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-semibold">Edit itinerary item</h2>
                <p className="text-sm text-muted-foreground">Update title/price or delete this item.</p>
              </div>
              <button
                type="button"
                className="text-sm px-3 py-1.5 rounded-lg border hover:bg-slate-50 transition-colors"
                onClick={closeEditModal}
              >
                Cancel
              </button>
            </div>

            <form key={selectedItem.id} action={handleEditSubmit} className="p-5 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  name="title"
                  defaultValue={selectedItem.title}
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Included price <span className="text-red-500">*</span>
                </label>
                <input
                  name="amount_eur"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={(Math.max(0, Number(selectedItem.amount_cents ?? 0)) / 100).toFixed(2)}
                  className="w-full border rounded-lg px-3 py-2.5 bg-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/10 focus-visible:border-black/40"
                  required
                />
              </div>

              {submitError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </div>
              )}

              {deleteError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {deleteError}
                </div>
              )}

              <div className="pt-2 flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={() => void handleDelete()} className="rounded-full px-5">
                  Delete
                </Button>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={closeEditModal} className="rounded-full px-5">
                    Cancel
                  </Button>
                  <Button type="submit" className="rounded-full px-5">
                    Save
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
