'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createProject } from '@/app/project/new/actions'
import { Button } from '@/components/ui/button'

type NewProjectFormProps = {
  showCancel?: boolean
  onCancel?: () => void
  submitLabel?: string
}

const EURO = '\u20AC'
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

export function NewProjectForm({ showCancel = false, onCancel, submitLabel = 'Create' }: NewProjectFormProps) {
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
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const validationError = validateLocation()
    if (!validationError) {
      setLocationError(null)
      return
    }
    event.preventDefault()
    setLocationError(validationError)
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
    <form action={createProject} className="space-y-5" onSubmit={onSubmit}>
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="project_total" className="text-sm font-medium">
            Total <span className="text-red-500">*</span>
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
              <input type="radio" name="total_is_per_person" value="false" defaultChecked />
              Grand total
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="total_is_per_person" value="true" />
              Per person
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Event starts <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_start_date"
              type="date"
              className="control-input"
            />
            <select
              name="event_start_time"
              className="control-select"
            >
              {timeOptions.map(value => (
                <option key={value || 'blank'} value={value}>
                  {value || 'Time'}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Event ends <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              name="event_end_date"
              type="date"
              className="control-input"
            />
            <select
              name="event_end_time"
              className="control-select"
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

      {locationError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {locationError}
        </div>
      )}

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
        <Button className="rounded-full px-5" type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
