'use client'

import { FormEvent, startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { createProjectWithState } from '@/app/project/new/actions'
import { Button } from '@/components/ui/button'
import { DateRangePicker } from '@/components/ui/DateRangePicker'
import { validateBundlePricingConfig } from '@/lib/projectPricing'
import { getProjectFinanceStrings } from '@/lib/projectFinanceStrings'
import { normalizeDateOnlyOption } from '@/lib/projectDateSelection'
import type { ProjectDateLocale } from '@/lib/projectDateStrings'

type NewProjectFormProps = {
  showCancel?: boolean
  onCancel?: () => void
  submitLabel?: string
  locale?: ProjectDateLocale
}

type DraftDateOption = {
  id: string
  startDate: string
  endDate: string | null
}

const EURO = '\u20AC'
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-sdk'
const MAX_INITIAL_DATE_OPTIONS = 20

let googleMapsPlacesScriptPromise: Promise<void> | null = null

const loadGoogleMapsPlacesScript = (apiKey: string) => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser'))
  }
  if (typeof google !== 'undefined' && google.maps?.places) {
    return Promise.resolve()
  }
  if (googleMapsPlacesScriptPromise) {
    return googleMapsPlacesScriptPromise
  }

  googleMapsPlacesScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null
    const handleReady = () => {
      if (typeof google !== 'undefined' && google.maps?.places) {
        resolve()
      } else {
        reject(new Error('Google Maps Places did not initialize'))
      }
    }
    const handleError = () => reject(new Error('Failed to load Google Maps Places script'))

    if (existingScript) {
      existingScript.addEventListener('load', handleReady, { once: true })
      existingScript.addEventListener('error', handleError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = GOOGLE_MAPS_SCRIPT_ID
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`
    script.addEventListener('load', handleReady, { once: true })
    script.addEventListener('error', handleError, { once: true })
    document.head.appendChild(script)
  })

  return googleMapsPlacesScriptPromise
}

const parseCoordinate = (value: string, axis: 'latitude' | 'longitude') => {
  if (!value.trim()) return { value: null as number | null }
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    return { error: `Invalid location ${axis}` as const }
  }
  if (axis === 'latitude' && (parsed < -90 || parsed > 90)) {
    return { error: 'Location latitude must be between -90 and 90' as const }
  }
  if (axis === 'longitude' && (parsed < -180 || parsed > 180)) {
    return { error: 'Location longitude must be between -180 and 180' as const }
  }
  return { value: parsed }
}

export function NewProjectForm({ showCancel = false, onCancel, submitLabel = 'Create', locale = 'en' }: NewProjectFormProps) {
  const [createState, createAction, isCreating] = useActionState(createProjectWithState, { error: null })
  const formRef = useRef<HTMLFormElement>(null)
  const [draftError, setDraftError] = useState<{ section: string; message: string } | null>(null)
  const [showServerError, setShowServerError] = useState(true)
  const [financeMode, setFinanceMode] = useState<'none' | 'managed'>('none')
  const [dateMode, setDateMode] = useState<'fixed' | 'selecting'>('fixed')
  const [dateOptions, setDateOptions] = useState<DraftDateOption[]>([{
    id: 'initial-date-option',
    startDate: '',
    endDate: null,
  }])
  const [totalIsPerPerson, setTotalIsPerPerson] = useState(false)
  const [bundleEnabled, setBundleEnabled] = useState(false)
  const [bundleSize, setBundleSize] = useState('')
  const [bundlePayFor, setBundlePayFor] = useState('')
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [locationAddress, setLocationAddress] = useState('')
  const [locationPlaceId, setLocationPlaceId] = useState('')
  const [locationLat, setLocationLat] = useState('')
  const [locationLng, setLocationLng] = useState('')
  const [locationError, setLocationError] = useState<string | null>(null)
  const [autocompleteReady, setAutocompleteReady] = useState(false)
  const [autocompleteLoadFailed, setAutocompleteLoadFailed] = useState(false)

  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const autocompleteListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)
  const geocodeRequestCounterRef = useRef(0)
  const nextDateOptionIdRef = useRef(1)
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  const financeStrings = getProjectFinanceStrings(locale)

  const timeOptions = useMemo(
    () => [
      '',
      ...Array.from({ length: 48 }, (_, idx) => {
        const hours = Math.floor(idx / 2)
        const minutes = idx % 2 === 0 ? '00' : '30'
        return `${String(hours).padStart(2, '0')}:${minutes}`
      }),
    ],
    []
  )

  useEffect(() => {
    let canceled = false
    if (!googleMapsApiKey) {
      return
    }

    void loadGoogleMapsPlacesScript(googleMapsApiKey)
      .then(() => {
        if (canceled) return
        const addressInput = addressInputRef.current
        if (!addressInput) return

        geocoderRef.current = new google.maps.Geocoder()
        autocompleteRef.current = new google.maps.places.Autocomplete(addressInput, {
          fields: ['formatted_address', 'geometry', 'name', 'place_id'],
          types: ['geocode'],
        })

        autocompleteListenerRef.current?.remove()
        autocompleteListenerRef.current = autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current?.getPlace()
          if (!place) return

          const formattedAddress = place.formatted_address ?? addressInput.value.trim()
          const geometry = place.geometry?.location ?? null
          const placeName = place.name ?? ''

          setLocationAddress(formattedAddress)
          setLocationPlaceId(place.place_id ?? '')
          setLocationError(null)
          if (placeName) {
            setLocationLabel(placeName)
          }
          if (geometry) {
            setLocationLat(String(geometry.lat()))
            setLocationLng(String(geometry.lng()))
          } else {
            setLocationLat('')
            setLocationLng('')
          }
        })

        setAutocompleteReady(true)
        setAutocompleteLoadFailed(false)
      })
      .catch(error => {
        if (canceled) return
        console.error('[NewProjectForm] Failed to initialize Places autocomplete', error)
        setAutocompleteReady(false)
        setAutocompleteLoadFailed(true)
      })

    return () => {
      canceled = true
      autocompleteListenerRef.current?.remove()
      autocompleteListenerRef.current = null
    }
  }, [googleMapsApiKey])

  const sanitizeAmount = (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const raw = input.value
    const cleaned = raw.replace(/[^0-9.,]/g, '')
    const firstSeparatorIndex = cleaned.search(/[.,]/)
    if (firstSeparatorIndex === -1) {
      input.value = cleaned
      return
    }
    const integerPart = cleaned.slice(0, firstSeparatorIndex).replace(/[.,]/g, '')
    const decimalPart = cleaned.slice(firstSeparatorIndex + 1).replace(/[.,]/g, '').slice(0, 2)
    const separator = cleaned[firstSeparatorIndex]
    input.value = `${integerPart}${separator}${decimalPart}`
  }

  const geocodeAddress = (address: string) => {
    const geocoder = geocoderRef.current
    const normalizedAddress = address.trim()
    if (!geocoder || !normalizedAddress || locationPlaceId) return

    const requestId = geocodeRequestCounterRef.current + 1
    geocodeRequestCounterRef.current = requestId

    geocoder.geocode({ address: normalizedAddress }, (results, status) => {
      if (requestId !== geocodeRequestCounterRef.current) return
      if (status !== google.maps.GeocoderStatus.OK || !results || results.length === 0) {
        return
      }
      const topResult = results[0]
      const topLocation = topResult.geometry?.location
      if (!topLocation) return
      setLocationAddress(topResult.formatted_address || normalizedAddress)
      setLocationPlaceId(topResult.place_id ?? '')
      setLocationLat(String(topLocation.lat()))
      setLocationLng(String(topLocation.lng()))
      if (!locationLabel.trim() && topResult.address_components?.[0]?.long_name) {
        setLocationLabel(topResult.address_components[0].long_name)
      }
    })
  }

  const validateLocation = () => {
    const hasLat = locationLat.trim().length > 0
    const hasLng = locationLng.trim().length > 0
    if (hasLat !== hasLng) return 'Location coordinates must include both latitude and longitude'

    const parsedLat = parseCoordinate(locationLat, 'latitude')
    if ('error' in parsedLat) return parsedLat.error
    const parsedLng = parseCoordinate(locationLng, 'longitude')
    if ('error' in parsedLng) return parsedLng.error
    return null
  }

  const validatePricing = () => {
    if (financeMode === 'none') return null
    if (!totalIsPerPerson || !bundleEnabled) return null
    try {
      validateBundlePricingConfig(true, bundleSize, bundlePayFor)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid bundle pricing'
    }
  }

  const errorSection = (message: string) => {
    if (/date|time|option|event (start|end)/i.test(message)) return 'date'
    if (/participants/i.test(message)) return 'participants'
    if (/total|pricing|bundle|cost|finance|price/i.test(message)) return 'finance'
    if (/location|coordinate/i.test(message)) return 'location'
    return 'general'
  }
  const visibleError = draftError ?? (showServerError && !isCreating && createState.error
    ? { section: errorSection(createState.error), message: createState.error }
    : null)

  const errorMessage = visibleError?.message
  const errorArea = visibleError?.section
  useEffect(() => {
    if (!errorMessage) return
    const alert = formRef.current?.querySelector<HTMLElement>('[data-creation-error]')
    alert?.focus()
  }, [errorMessage, errorArea, isCreating])

  const renderError = (section: string) => visibleError?.section === section ? (
    <div data-creation-error tabIndex={-1} role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {visibleError.message}
    </div>
  ) : null

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // A fulfilled React form action resets uncontrolled inputs, even when its
    // result contains an error. Dispatch explicitly so the DOM remains the draft.
    event.preventDefault()
    if (isCreating) return
    const data = new FormData(event.currentTarget)
    setShowServerError(false)
    setDraftError(null)
    setLocationError(null)
    setPricingError(null)
    const fail = (section: string, message: string) => setDraftError({ section, message })
    const value = (name: string) => String(data.get(name) ?? '')
    const min = value('min_participants')
    const max = value('max_participants')
    if (min && max && Number(max) < Number(min)) {
      fail('participants', 'Max participants must be greater than or equal to min participants')
      return
    }
    const location = validateLocation()
    const pricing = validatePricing()
    if (pricing) { fail('finance', pricing); return }
    if (location) { fail('location', location); return }
    if (value('date_mode') === 'fixed') {
      if (!value('event_start_date') || !value('event_start_time')) {
        fail('date', 'A fixed project needs a confirmed start date and time')
        return
      }
      if (value('event_end_time') && !value('event_end_date')) {
        fail('date', 'Event end time requires an end date')
        return
      }
      if (value('event_end_date') &&
        new Date(`${value('event_end_date')}T${value('event_end_time') || '17:00'}`) <
        new Date(`${value('event_start_date')}T${value('event_start_time')}`)) {
        fail('date', 'Event end must be after event start')
        return
      }
    } else if (value('date_mode') === 'selecting') {
      if (!value('date_voting_deadline_date')) {
        fail('date', 'Choose a date voting deadline')
        return
      }
      const starts = data.getAll('date_option_start_date')
      const ends = data.getAll('date_option_end_date')
      if (!starts.length) { fail('date', 'Add at least one date option'); return }
      try {
        const options = starts.map((start, index) => normalizeDateOnlyOption(String(start), String(ends[index] ?? '')))
        const unique = new Set(options.map(option => `${option.startsAt}:${option.endsAt ?? ''}`))
        if (unique.size !== options.length) throw new Error('The same date option was added more than once')
      } catch (error) {
        fail('date', error instanceof Error ? error.message : 'Check the initial date options')
        return
      }
    } else {
      fail('date', 'Choose how the project date will be decided.')
      return
    }
    setShowServerError(true)
    startTransition(() => createAction(data))
  }

  const clearLocation = () => {
    setLocationLabel('')
    setLocationAddress('')
    setLocationPlaceId('')
    setLocationLat('')
    setLocationLng('')
    setLocationError(null)
  }

  const locationHelperText = (() => {
    if (!googleMapsApiKey) return 'Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable location autocomplete.'
    if (autocompleteLoadFailed) return 'Autocomplete unavailable. You can still enter the address manually.'
    if (autocompleteReady) return 'Start typing an address and choose a suggestion.'
    return 'Loading location autocomplete...'
  })()

  return (
    <form ref={formRef} action={createAction} className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label htmlFor="project_title" className="text-sm font-medium">
          Project title <span className="text-red-500">*</span>
        </label>
        <input
          id="project_title"
          name="title"
          placeholder="Weekend trip, team event..."
          className="control-input"
          required
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="project_description" className="text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="project_description"
          name="description"
          placeholder="Add context and details for participants"
          className="control-textarea min-h-[96px] resize-none"
        />
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Visibility</h3>
          <p className="text-xs text-slate-600">
            Private projects stay off the main projects page except for you and members who join.
          </p>
        </div>
        <div className="control-radio-group space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="private"
              defaultChecked
            />
            <span>
              <span className="font-medium text-slate-900">Private</span>
              <span className="block text-xs text-slate-600">Hidden from the public projects list.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="public"
            />
            <span>
              <span className="font-medium text-slate-900">Public</span>
              <span className="block text-xs text-slate-600">Visible on the main projects page for everyone.</span>
            </span>
          </label>
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">{financeStrings.sharedCosts}</h3>
          {renderError('finance')}
          <p className="text-xs text-slate-600">{financeStrings.sharedCostsHelp}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`min-h-28 cursor-pointer rounded-xl border bg-white p-4 transition-colors ${financeMode === 'none' ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
            <input
              type="radio"
              name="finance_mode"
              value="none"
              checked={financeMode === 'none'}
              onChange={() => {
                setFinanceMode('none')
                setPricingError(null)
              }}
              className="sr-only"
            />
            <span className="block text-sm font-semibold text-slate-900">{financeStrings.organizeOnly}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">{financeStrings.organizeOnlyDescription}</span>
          </label>
          <label className={`min-h-28 cursor-pointer rounded-xl border bg-white p-4 transition-colors ${financeMode === 'managed' ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-400'}`}>
            <input
              type="radio"
              name="finance_mode"
              value="managed"
              checked={financeMode === 'managed'}
              onChange={() => setFinanceMode('managed')}
              className="sr-only"
            />
            <span className="block text-sm font-semibold text-slate-900">{financeStrings.manageSharedCosts}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-600">{financeStrings.manageSharedCostsDescription}</span>
          </label>
        </div>
      </section>

      {financeMode === 'managed' && <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="project_total" className="block text-sm font-medium">
            <span>
              Total <span className="text-red-500">*</span>
            </span>
            <span className="block text-xs font-normal text-muted-foreground">(can be changed later)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{EURO}</span>
            <input
              id="project_total"
              name="totalEur"
              type="text"
              inputMode="decimal"
              className="control-input pl-7"
              onInput={sanitizeAmount}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Total type</label>
          <div className="control-radio-group space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="total_is_per_person"
                value="false"
                checked={!totalIsPerPerson}
                onChange={() => {
                  setTotalIsPerPerson(false)
                  setPricingError(null)
                }}
              />
              Grand total
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="total_is_per_person"
                value="true"
                checked={totalIsPerPerson}
                onChange={() => {
                  setTotalIsPerPerson(true)
                  setPricingError(null)
                }}
              />
              Per person
            </label>
          </div>
        </div>
      </div>
      {totalIsPerPerson && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">Bundle deal</h3>
            <p className="text-xs text-slate-600">
              Optional. Use the regular per-ticket price above and equal-split the discounted total across everyone,
              for example buy 4 tickets and pay for 3.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={bundleEnabled}
              onChange={event => {
                const checked = event.target.checked
                setBundleEnabled(checked)
                setPricingError(null)
                if (checked) {
                  if (!bundleSize) setBundleSize('4')
                  if (!bundlePayFor) setBundlePayFor('3')
                }
              }}
            />
            Apply bundle pricing
          </label>
          {bundleEnabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="project_bundle_size" className="text-sm font-medium">
                  Buy this many
                </label>
                <input
                  id="project_bundle_size"
                  name="bundle_size"
                  type="number"
                  min={2}
                  step={1}
                  className="control-input"
                  value={bundleSize}
                  onChange={event => {
                    setBundleSize(event.target.value)
                    setPricingError(null)
                  }}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="project_bundle_pay_for" className="text-sm font-medium">
                  Pay for this many
                </label>
                <input
                  id="project_bundle_pay_for"
                  name="bundle_pay_for"
                  type="number"
                  min={1}
                  step={1}
                  className="control-input"
                  value={bundlePayFor}
                  onChange={event => {
                    setBundlePayFor(event.target.value)
                    setPricingError(null)
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      </>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {renderError('participants')}
          <label htmlFor="project_min_participants" className="text-sm font-medium">
            Min participants
          </label>
          <input
            id="project_min_participants"
            name="min_participants"
            type="number"
            min={1}
            className="control-input"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="project_max_participants" className="text-sm font-medium">
            Max participants
          </label>
          <input
            id="project_max_participants"
            name="max_participants"
            type="number"
            min={1}
          className="control-input"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-slate-900">Event location</h3>
            {renderError('location')}
            <p className="text-xs text-slate-600">Optional. Members can open Google Maps, Waze, or Apple Maps.</p>
          </div>
          {(locationAddress || locationLabel) && (
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
              onClick={clearLocation}
            >
              Clear location
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="project_event_location_label" className="text-sm font-medium">
              Location name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="project_event_location_label"
              name="event_location_label"
              value={locationLabel}
              onChange={event => setLocationLabel(event.target.value)}
              placeholder="e.g. Arena Zagreb"
              className="control-input"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="project_event_location_address" className="text-sm font-medium">
              Address
            </label>
            <input
              id="project_event_location_address"
              ref={addressInputRef}
              name="event_location_address"
              value={locationAddress}
              onChange={event => {
                setLocationAddress(event.target.value)
                setLocationPlaceId('')
                setLocationLat('')
                setLocationLng('')
                setLocationError(null)
              }}
              onBlur={() => {
                if (!locationAddress.trim()) return
                geocodeAddress(locationAddress)
              }}
              placeholder="Start typing an address..."
              className="control-input"
            />
          </div>
        </div>

        <input type="hidden" name="event_location_place_id" value={locationPlaceId} />
        <input type="hidden" name="event_location_lat" value={locationLat} />
        <input type="hidden" name="event_location_lng" value={locationLng} />

        <div className="text-xs text-slate-500">{locationHelperText}</div>
        {locationLat && locationLng && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Coordinates: {locationLat}, {locationLng}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">Project date</h3>
          {renderError('date')}
          <p className="text-xs text-slate-600">Use a confirmed date, or let project members find the best date together.</p>
        </div>
        <div className="control-radio-group space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="date_mode"
              value="fixed"
              checked={dateMode === 'fixed'}
              onChange={() => setDateMode('fixed')}
            />
            <span>
              <span className="font-medium text-slate-900">Fixed date</span>
              <span className="block text-xs text-slate-600">The event date is already confirmed.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="date_mode"
              value="selecting"
              checked={dateMode === 'selecting'}
              onChange={() => setDateMode('selecting')}
            />
            <span>
              <span className="font-medium text-slate-900">Choose together</span>
              <span className="block text-xs text-slate-600">Members share availability before payments open.</span>
            </span>
          </label>
        </div>

        {dateMode === 'fixed' ? (
          <div className="grid gap-4 pt-1 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Event starts <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input name="event_start_date" type="date" className="control-input" required />
                <select name="event_start_time" className="control-select" required>
                  {timeOptions.map(value => (
                    <option key={value || 'blank'} value={value}>{value || 'Time'}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Event ends <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input name="event_end_date" type="date" className="control-input" />
                <select name="event_end_time" className="control-select">
                  {timeOptions.map(value => (
                    <option key={value || 'blank'} value={value}>{value || 'Time'}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Date voting deadline <span className="text-red-500">*</span>
              </label>
              <div className="md:max-w-xs">
                <input name="date_voting_deadline_date" type="date" className="control-input" required />
              </div>
              <p className="text-xs text-slate-600">
                Voting remains open through this date. New suggestions close automatically one day earlier.
              </p>
            </div>

            <div className="space-y-3 border-t border-slate-200 pt-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Initial date options</h4>
                <p className="mt-0.5 text-xs text-slate-600">Add one or more dates for members to vote on. Times are not required.</p>
              </div>
              {dateOptions.map((option, index) => (
                <div key={option.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Option {index + 1}</span>
                    {dateOptions.length > 1 && (
                      <button
                        type="button"
                        className="min-h-9 rounded-full px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                        onClick={() => setDateOptions(current => current.filter(item => item.id !== option.id))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <DateRangePicker
                    value={{ startDate: option.startDate, endDate: option.endDate }}
                    onChange={value => setDateOptions(current => current.map(item =>
                      item.id === option.id ? { ...item, ...value } : item
                    ))}
                    locale={locale}
                    startName="date_option_start_date"
                    endName="date_option_end_date"
                    required
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11 rounded-full"
                disabled={dateOptions.length >= MAX_INITIAL_DATE_OPTIONS}
                onClick={() => {
                  const id = `date-option-${nextDateOptionIdRef.current}`
                  nextDateOptionIdRef.current += 1
                  setDateOptions(current => [...current, { id, startDate: '', endDate: null }])
                }}
              >
                + Add another date
              </Button>
            </div>
          </div>
        )}
      </div>

      {locationError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {locationError}
        </div>
      )}
      {pricingError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pricingError}
        </div>
      )}
      {renderError('general')}

      <div className="flex items-center justify-end gap-3 pt-2">
        {showCancel && (
          <Button
            className="rounded-full px-5"
            variant="outline"
            type="button"
            onClick={() => onCancel?.()}
          >
            Cancel
          </Button>
        )}
        <Button className="rounded-full px-5" type="submit" disabled={isCreating} aria-busy={isCreating}>
          {isCreating ? 'Creating…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
