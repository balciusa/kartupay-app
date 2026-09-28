'use client'

import { FormEvent, ReactNode, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  deriveTransportStatuses,
  remainingTransportSeats,
  sortTransportOffers,
  summarizeTransport,
  type ProjectTransportSnapshot,
  type TransportDirection,
  type TransportOffer,
} from '@/lib/projectTransport'
import { getProjectTransportStrings } from '@/lib/projectTransportStrings'
import {
  cancelTransportOffer,
  clearTransportIntent,
  createTransportOffer,
  joinTransportOffer,
  leaveTransportOffer,
  removeTransportPassenger,
  setTransportIntent,
  updateTransportOffer,
  type TransportActionResult,
} from '@/app/project/[id]/transportActions'

const pad = (value: number) => String(value).padStart(2, '0')
const localDate = (iso: string | null) => {
  if (!iso) return ''
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}
const localTime = (iso: string | null) => {
  if (!iso) return ''
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`
}

function RideForm({
  direction,
  snapshot,
  offer,
  onSubmit,
  onCancel,
  busy,
}: {
  direction: TransportDirection
  snapshot: ProjectTransportSnapshot
  offer?: TransportOffer
  onSubmit: (formData: FormData) => void
  onCancel: () => void
  busy: boolean
}) {
  const strings = getProjectTransportStrings(snapshot.locale)
  const passengerCount = offer?.assignments.length ?? 0
  const defaultIso = direction === 'from_event'
    ? snapshot.eventEndAt || snapshot.eventStartAt
    : snapshot.eventStartAt
  const [date, setDate] = useState(localDate(offer?.departureAt ?? defaultIso))
  const [time, setTime] = useState(offer ? localTime(offer.departureAt) : '')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    formData.set('departure_local', date && time ? `${date}T${time}` : '')
    formData.set('timezone_offset_minutes', String(new Date().getTimezoneOffset()))
    onSubmit(formData)
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`transport-location-${offer?.id ?? direction}`}>
          {direction === 'to_event' ? strings.leavingFrom : strings.goingTo}
        </label>
        <input
          id={`transport-location-${offer?.id ?? direction}`}
          name="location_text"
          defaultValue={offer?.locationText ?? ''}
          maxLength={300}
          className="control-input"
          required
          readOnly={passengerCount > 0}
        />
        {passengerCount > 0 && (
          <p className="text-xs text-slate-500">{strings.routeLocked}</p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor={`transport-date-${offer?.id ?? direction}`}>{strings.departure}</label>
          <input
            id={`transport-date-${offer?.id ?? direction}`}
            type="date"
            className="control-input"
            value={date}
            onChange={event => setDate(event.target.value)}
            required
            disabled={passengerCount > 0}
          />
        </div>
        <div className="space-y-1.5 sm:pt-6">
          <input
            aria-label={strings.departure}
            type="time"
            className="control-input"
            value={time}
            onChange={event => setTime(event.target.value)}
            required
            disabled={passengerCount > 0}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`transport-seats-${offer?.id ?? direction}`}>{strings.passengerSeats}</label>
        <input
          id={`transport-seats-${offer?.id ?? direction}`}
          name="seat_capacity"
          type="number"
          min={Math.max(1, passengerCount)}
          max={20}
          step={1}
          defaultValue={offer?.seatCapacity ?? 1}
          className="control-input"
          required
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`transport-note-${offer?.id ?? direction}`}>{strings.noteOptional}</label>
        <textarea
          id={`transport-note-${offer?.id ?? direction}`}
          name="note"
          defaultValue={offer?.note ?? ''}
          maxLength={500}
          className="control-textarea min-h-20"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11 rounded-full" disabled={busy}>{offer ? strings.editRide : strings.offerRide}</Button>
        <Button type="button" variant="outline" className="min-h-11 rounded-full" onClick={onCancel} disabled={busy}>{strings.cancel}</Button>
      </div>
    </form>
  )
}

function RideDetails({
  offer,
  snapshot,
  actions,
}: {
  offer: TransportOffer
  snapshot: ProjectTransportSnapshot
  actions?: ReactNode
}) {
  const strings = getProjectTransportStrings(snapshot.locale)
  const participantById = new Map(snapshot.participants.map(participant => [participant.id, participant]))
  const driver = participantById.get(offer.driverParticipantId)
  const event = snapshot.eventLocation || strings.event
  const route = offer.direction === 'to_event'
    ? `${offer.locationText} → ${event}`
    : `${event} → ${offer.locationText}`
  const remaining = remainingTransportSeats(offer)
  const formattedDeparture = new Intl.DateTimeFormat(snapshot.locale === 'lt' ? 'lt-LT' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(offer.departureAt))

  return (
    <article className="w-full space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h4 className="font-semibold text-slate-950">{driver?.name ?? 'Member'}</h4>
        <p className="mt-1 break-words text-sm text-slate-700">{route}</p>
        <p className="mt-1 text-sm text-slate-600">{formattedDeparture}</p>
      </div>
      <div className="text-sm font-medium text-slate-900">
        {remaining === 0 ? strings.full : strings.seatsOf(remaining, offer.seatCapacity)}
      </div>
      {offer.note && <p className="break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{offer.note}</p>}
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{strings.passengersList}</div>
        {offer.assignments.length ? (
          <div className="flex flex-wrap gap-1.5">
            {offer.assignments.map(assignment => (
              <span key={assignment.id} className="max-w-full break-words rounded-full bg-slate-100 px-2.5 py-1 text-sm">
                {participantById.get(assignment.participantId)?.name ?? 'Member'}
              </span>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">{strings.noPassengers}</p>}
      </div>
      {actions}
    </article>
  )
}

export function ProjectTransport({ snapshot }: { snapshot: ProjectTransportSnapshot }) {
  const strings = getProjectTransportStrings(snapshot.locale)
  const router = useRouter()
  const [direction, setDirection] = useState<TransportDirection>('to_event')
  const [showOfferForm, setShowOfferForm] = useState(false)
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null)
  const [changingStatus, setChangingStatus] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const statuses = useMemo(() => deriveTransportStatuses({
    participants: snapshot.participants,
    offers: snapshot.offers,
    intents: snapshot.intents,
    direction,
  }), [snapshot, direction])
  const summary = useMemo(() => summarizeTransport({ statuses, offers: snapshot.offers, direction }), [statuses, snapshot.offers, direction])
  const offers = useMemo(() => sortTransportOffers(snapshot.offers.filter(offer => offer.direction === direction)), [snapshot.offers, direction])
  const participantById = useMemo(() => new Map(snapshot.participants.map(participant => [participant.id, participant])), [snapshot.participants])
  const viewerStatus = statuses.find(status => status.participantId === snapshot.viewerParticipantId)
  const viewerOffer = viewerStatus?.state === 'driver' ? offers.find(offer => offer.id === viewerStatus.offerId) : undefined
  const viewerPassengerOffer = viewerStatus?.state === 'passenger' ? offers.find(offer => offer.id === viewerStatus.offerId) : undefined

  const run = (action: () => Promise<TransportActionResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setShowOfferForm(false)
      setEditingOfferId(null)
      setChangingStatus(false)
      router.refresh()
    })
  }

  const planningBlocked = !snapshot.planningReady || snapshot.projectCanceled
  const needsRide = statuses.filter(status => status.state === 'needs_ride')
  const notDecided = statuses.filter(status => status.state === 'not_decided')

  return (
    <div className="min-w-0 space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-slate-950">{strings.transport}</h2>
      </div>
      <div className="grid w-full grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={strings.transport}>
        {(['to_event', 'from_event'] as const).map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={direction === value}
            className={`min-h-11 rounded-lg px-2 text-sm font-medium ${direction === value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600'}`}
            onClick={() => {
              setDirection(value)
              setShowOfferForm(false)
              setEditingOfferId(null)
              setChangingStatus(false)
              setError(null)
            }}
          >
            {value === 'to_event' ? strings.toEvent : strings.fromEvent}
          </button>
        ))}
      </div>

      {!snapshot.planningReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{strings.planningLocked}</div>
      )}
      {snapshot.projectCanceled && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{strings.canceledLocked}</div>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold text-slate-950">{strings.status}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            [strings.drivers, summary.drivers], [strings.passengers, summary.passengers],
            [strings.seatsAvailable, summary.availableSeats], [strings.needRide, summary.needsRide],
            [strings.ownArrangement, summary.ownArrangement], [strings.notDecided, summary.notDecided],
          ].map(([label, value]) => (
            <div key={String(label)} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xl font-semibold text-slate-950">{value}</div>
              <div className="break-words text-xs text-slate-600">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-slate-950">{strings.yourTransport}</h3>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {!viewerStatus ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">{strings.attendingOnly}</p>
        ) : viewerStatus.state === 'not_decided' ? (
          <div className="space-y-3">
            {!showOfferForm && !planningBlocked && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Button className="min-h-11" onClick={() => setShowOfferForm(true)} disabled={isPending}>{strings.offerRide}</Button>
                <Button variant="outline" className="min-h-11" onClick={() => run(() => setTransportIntent(snapshot.projectId, direction, 'needs_ride'))} disabled={isPending}>{strings.needRideAction}</Button>
                <Button variant="outline" className="min-h-11" onClick={() => run(() => setTransportIntent(snapshot.projectId, direction, 'own_arrangement'))} disabled={isPending}>{strings.ownArrangementAction}</Button>
              </div>
            )}
            {showOfferForm && !planningBlocked && (
              <RideForm
                direction={direction}
                snapshot={snapshot}
                busy={isPending}
                onCancel={() => setShowOfferForm(false)}
                onSubmit={formData => run(() => createTransportOffer(snapshot.projectId, direction, formData))}
              />
            )}
          </div>
        ) : viewerStatus.state === 'driver' && viewerOffer ? (
          <div className="space-y-3">
            <RideDetails
              offer={viewerOffer}
              snapshot={snapshot}
              actions={!planningBlocked ? (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  {viewerOffer.assignments.map(assignment => (
                    <div key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="break-words">{participantById.get(assignment.participantId)?.name ?? 'Member'}</span>
                      <Button variant="outline" className="min-h-11" disabled={isPending} onClick={() => run(() => removeTransportPassenger(snapshot.projectId, viewerOffer.id, assignment.participantId))}>{strings.removePassenger}</Button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="min-h-11" onClick={() => setEditingOfferId(viewerOffer.id)} disabled={isPending}>{strings.editRide}</Button>
                    <Button
                      variant="outline"
                      className="min-h-11 border-red-200 text-red-700"
                      disabled={isPending}
                      onClick={() => {
                        if (window.confirm(strings.cancelWarning(viewerOffer.assignments.length))) {
                          run(() => cancelTransportOffer(snapshot.projectId, viewerOffer.id))
                        }
                      }}
                    >{strings.cancelRide}</Button>
                  </div>
                </div>
              ) : null}
            />
            {editingOfferId === viewerOffer.id && !planningBlocked && (
              <RideForm
                direction={direction}
                snapshot={snapshot}
                offer={viewerOffer}
                busy={isPending}
                onCancel={() => setEditingOfferId(null)}
                onSubmit={formData => run(() => updateTransportOffer(snapshot.projectId, viewerOffer.id, formData))}
              />
            )}
          </div>
        ) : viewerStatus.state === 'passenger' && viewerPassengerOffer ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-900">
              {strings.ridingWith(participantById.get(viewerPassengerOffer.driverParticipantId)?.name ?? 'Member')}
            </div>
            <RideDetails
              offer={viewerPassengerOffer}
              snapshot={snapshot}
              actions={!planningBlocked ? (
                <Button variant="outline" className="min-h-11" disabled={isPending} onClick={() => run(() => leaveTransportOffer(snapshot.projectId, direction))}>{strings.leaveRide}</Button>
              ) : null}
            />
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="font-medium text-slate-950">{viewerStatus.state === 'needs_ride' ? strings.needRide : strings.ownArrangement}</div>
            {!planningBlocked && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => setChangingStatus(value => !value)} disabled={isPending}>{strings.change}</Button>
                <Button variant="outline" className="min-h-11" onClick={() => run(() => clearTransportIntent(snapshot.projectId, direction))} disabled={isPending}>{strings.clear}</Button>
              </div>
            )}
            {changingStatus && !planningBlocked && (
              <div className="grid gap-2 sm:grid-cols-3">
                <Button className="min-h-11" onClick={() => setShowOfferForm(true)} disabled={isPending}>{strings.offerRide}</Button>
                <Button variant="outline" className="min-h-11" onClick={() => run(() => setTransportIntent(snapshot.projectId, direction, 'needs_ride'))} disabled={isPending}>{strings.needRideAction}</Button>
                <Button variant="outline" className="min-h-11" onClick={() => run(() => setTransportIntent(snapshot.projectId, direction, 'own_arrangement'))} disabled={isPending}>{strings.ownArrangementAction}</Button>
              </div>
            )}
            {showOfferForm && !planningBlocked && (
              <RideForm direction={direction} snapshot={snapshot} busy={isPending} onCancel={() => setShowOfferForm(false)} onSubmit={formData => run(() => createTransportOffer(snapshot.projectId, direction, formData))} />
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-slate-950">{strings.availableRides}</h3>
        {offers.filter(offer => offer.id !== viewerOffer?.id && offer.id !== viewerPassengerOffer?.id).length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">{strings.noRides}</p>
        ) : offers.filter(offer => offer.id !== viewerOffer?.id && offer.id !== viewerPassengerOffer?.id).map(offer => {
          const remaining = remainingTransportSeats(offer)
          const canJoin = !planningBlocked && viewerStatus && !['driver', 'passenger'].includes(viewerStatus.state) && remaining > 0
          return (
            <RideDetails
              key={offer.id}
              offer={offer}
              snapshot={snapshot}
              actions={remaining === 0 ? <span className="text-sm font-medium text-slate-500">{strings.full}</span> : canJoin ? (
                <Button className="min-h-11" disabled={isPending} onClick={() => run(() => joinTransportOffer(snapshot.projectId, offer.id))}>{strings.joinRide}</Button>
              ) : null}
            />
          )
        })}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-slate-950">{strings.needRide}</h3>
        {needsRide.length ? <div className="flex flex-wrap gap-2">{needsRide.map(status => <span key={status.participantId} className="break-words rounded-full bg-amber-50 px-3 py-1.5 text-sm text-amber-950">{status.name}</span>)}</div> : <p className="text-sm text-slate-500">{strings.noNeedsRide}</p>}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-slate-950">{strings.notDecided}</h3>
        <div className="text-sm text-slate-600">{notDecided.length}</div>
        {notDecided.length > 0 && <div className="flex flex-wrap gap-2">{notDecided.map(status => <span key={status.participantId} className="max-w-full break-words rounded-full bg-slate-100 px-3 py-1.5 text-sm">{status.name}</span>)}</div>}
      </section>
    </div>
  )
}
