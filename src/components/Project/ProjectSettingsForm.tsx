'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { validateBundlePricingConfig } from '@/lib/projectPricing'

type ProjectSettingsFormProps = {
  action: (formData: FormData) => void | Promise<void>
  initial: {
    title: string
    description: string
    totalEur: string
    totalIsPerPerson: boolean
    bundleSize: number | null
    bundlePayFor: number | null
    minParticipants: number | null
    maxParticipants: number | null
    eventStartDate: string
    eventStartTime: string
    eventEndDate: string
    eventEndTime: string
    eventLocationLabel: string
    eventLocationAddress: string
    eventLocationLat: string
    eventLocationLng: string
    eventLocationPlaceId: string
  }
}

const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'
const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-sdk'

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
    const handleError = () => {
      reject(new Error('Failed to load Google Maps Places script'))
    }

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

const resolveDateTime = (date: string, time: string, defaultTime: string) => {
  const dateRaw = date.trim()
  const timeRaw = time.trim()
  if (!dateRaw && !timeRaw) return null
  if (!dateRaw && timeRaw) return { error: 'Event time requires a date' as const }
  const normalized = `${dateRaw}T${timeRaw || defaultTime}`
  return { value: normalized }
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

export function ProjectSettingsForm({ action, initial }: ProjectSettingsFormProps) {
  const [totalIsPerPerson, setTotalIsPerPerson] = useState(initial.totalIsPerPerson)
  const [bundleEnabled, setBundleEnabled] = useState(initial.bundleSize != null && initial.bundlePayFor != null)
  const [bundleSize, setBundleSize] = useState(initial.bundleSize == null ? '' : String(initial.bundleSize))
  const [bundlePayFor, setBundlePayFor] = useState(initial.bundlePayFor == null ? '' : String(initial.bundlePayFor))
  const [startDate, setStartDate] = useState(initial.eventStartDate)
  const [startTime, setStartTime] = useState(initial.eventStartTime)
  const [endDate, setEndDate] = useState(initial.eventEndDate)
  const [endTime, setEndTime] = useState(initial.eventEndTime)
  const [dateError, setDateError] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [pricingError, setPricingError] = useState<string | null>(null)

  const [locationLabel, setLocationLabel] = useState(initial.eventLocationLabel)
  const [locationAddress, setLocationAddress] = useState(initial.eventLocationAddress)
  const [locationPlaceId, setLocationPlaceId] = useState(initial.eventLocationPlaceId)
  const [locationLat, setLocationLat] = useState(initial.eventLocationLat)
  const [locationLng, setLocationLng] = useState(initial.eventLocationLng)
  const [autocompleteReady, setAutocompleteReady] = useState(false)
  const [autocompleteLoadFailed, setAutocompleteLoadFailed] = useState(false)

  const addressInputRef = useRef<HTMLInputElement | null>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const autocompleteListenerRef = useRef<google.maps.MapsEventListener | null>(null)
  const geocoderRef = useRef<google.maps.Geocoder | null>(null)
  const geocodeRequestCounterRef = useRef(0)
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

  const timeOptions = useMemo(() => {
    const baseTimes = Array.from({ length: 48 }, (_, idx) => {
      const hours = Math.floor(idx / 2)
      const minutes = idx % 2 === 0 ? '00' : '30'
      return `${String(hours).padStart(2, '0')}:${minutes}`
    })
    const timeSet = new Set(baseTimes)
    if (startTime) timeSet.add(startTime)
    if (endTime) timeSet.add(endTime)
    return ['', ...Array.from(timeSet).sort()]
  }, [startTime, endTime])

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
        console.error('[ProjectSettingsForm] Failed to initialize Places autocomplete', error)
        setAutocompleteReady(false)
        setAutocompleteLoadFailed(true)
      })

    return () => {
      canceled = true
      autocompleteListenerRef.current?.remove()
      autocompleteListenerRef.current = null
    }
  }, [googleMapsApiKey])

  const validateEventRange = () => {
    const start = resolveDateTime(startDate, startTime, DEFAULT_START_TIME)
    if (start && 'error' in start) return start.error

    const end = resolveDateTime(endDate, endTime, DEFAULT_END_TIME)
    if (end && 'error' in end) return end.error

    if (start && end && start.value && end.value && end.value < start.value) {
      return 'Event end must be after event start'
    }
    return null
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
    if (!totalIsPerPerson || !bundleEnabled) return null
    try {
      validateBundlePricingConfig(true, bundleSize, bundlePayFor)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid bundle pricing'
    }
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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const eventError = validateEventRange()
    const locationValidationError = validateLocation()
    const pricingValidationError = validatePricing()

    if (eventError || locationValidationError || pricingValidationError) {
      event.preventDefault()
      setDateError(eventError ?? null)
      setLocationError(locationValidationError ?? null)
      setPricingError(pricingValidationError)
      return
    }

    setDateError(null)
    setLocationError(null)
    setPricingError(null)
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
    <form action={action} className="space-y-5" onSubmit={onSubmit}>
      <div className="space-y-3">
        <div>
          <label htmlFor="settings-project-title" className="mb-1 block text-sm font-medium text-slate-700">Project title</label>
          <input
            id="settings-project-title"
            name="project_title"
            defaultValue={initial.title}
            placeholder="Project title"
            className="control-input"
            required
          />
        </div>
        <div>
          <label htmlFor="settings-project-description" className="mb-1 block text-sm font-medium text-slate-700">Description</label>
          <textarea
            id="settings-project-description"
            name="project_description"
            defaultValue={initial.description}
            placeholder="Description (optional)"
            className="control-textarea min-h-[120px]"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(0,1.4fr)]">
        <div>
          <label htmlFor="settings-project-total" className="mb-1 block text-sm font-medium text-slate-700">Total (EUR)</label>
          <input
            id="settings-project-total"
            name="totalEur"
            type="text"
            inputMode="decimal"
            defaultValue={initial.totalEur}
            className="control-input"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Total type</label>
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
                checked={!!totalIsPerPerson}
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
              Optional. Use the regular per-ticket price above and equal-split the discounted total across all
              participants.
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
              <div>
                <label htmlFor="settings-bundle-size" className="mb-1 block text-sm font-medium text-slate-700">
                  Buy this many
                </label>
                <input
                  id="settings-bundle-size"
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
              <div>
                <label htmlFor="settings-bundle-pay-for" className="mb-1 block text-sm font-medium text-slate-700">
                  Pay for this many
                </label>
                <input
                  id="settings-bundle-pay-for"
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

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="settings-min-participants" className="mb-1 block text-sm font-medium text-slate-700">Min participants</label>
          <input
            id="settings-min-participants"
            name="min_participants"
            type="number"
            min={1}
            className="control-input"
            defaultValue={initial.minParticipants ?? ''}
            placeholder="No minimum"
          />
        </div>
        <div>
          <label htmlFor="settings-max-participants" className="mb-1 block text-sm font-medium text-slate-700">Max participants</label>
          <input
            id="settings-max-participants"
            name="max_participants"
            type="number"
            min={1}
            className="control-input"
            defaultValue={initial.maxParticipants ?? ''}
            placeholder="No maximum"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-slate-900">Event location</h3>
            <p className="text-xs text-slate-600">Participants will be able to open Google Maps, Waze, or Apple Maps.</p>
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
          <div>
            <label htmlFor="settings-location-label" className="mb-1 block text-sm font-medium text-slate-700">Location name (optional)</label>
            <input
              id="settings-location-label"
              name="event_location_label"
              value={locationLabel}
              onChange={event => setLocationLabel(event.target.value)}
              placeholder="e.g. Arena Zagreb"
              className="control-input"
            />
          </div>
          <div>
            <label htmlFor="settings-location-address" className="mb-1 block text-sm font-medium text-slate-700">Address</label>
            <input
              id="settings-location-address"
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

        <div className="text-xs text-slate-500">
          {locationHelperText || 'Location autocomplete is optional; you can still save a manual address.'}
        </div>
        {locationLat && locationLng && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            Coordinates: {locationLat}, {locationLng}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Event starts (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_start_date"
              type="date"
              className="control-input"
              defaultValue={initial.eventStartDate}
              onChange={event => {
                setStartDate(event.target.value)
                setDateError(null)
              }}
            />
            <select
              name="event_start_time"
              className="control-select"
              defaultValue={initial.eventStartTime}
              onChange={event => {
                setStartTime(event.target.value)
                setDateError(null)
              }}
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Event ends (optional)</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_end_date"
              type="date"
              min={startDate || undefined}
              className="control-input"
              defaultValue={initial.eventEndDate}
              onChange={event => {
                setEndDate(event.target.value)
                setDateError(null)
              }}
            />
            <select
              name="event_end_time"
              className="control-select"
              defaultValue={initial.eventEndTime}
              onChange={event => {
                setEndTime(event.target.value)
                setDateError(null)
              }}
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {dateError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {dateError}
        </div>
      )}
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

      <div className="flex justify-end">
        <Button className="rounded-full px-5">Save settings</Button>
      </div>
    </form>
  )
}
