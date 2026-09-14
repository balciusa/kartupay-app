'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

type LocationLinkMenuProps = {
  label: string
  address?: string | null
  googleMapsUrl?: string | null
  wazeUrl?: string | null
  appleMapsUrl?: string | null
}

type LinkItem = {
  label: string
  href: string
}

export function LocationLinkMenu({
  label,
  address,
  googleMapsUrl,
  wazeUrl,
  appleMapsUrl,
}: LocationLinkMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const links = useMemo<LinkItem[]>(() => {
    const list: LinkItem[] = []
    if (googleMapsUrl) list.push({ label: 'Open in Google Maps', href: googleMapsUrl })
    if (wazeUrl) list.push({ label: 'Open in Waze', href: wazeUrl })
    if (appleMapsUrl) list.push({ label: 'Open in Apple Maps', href: appleMapsUrl })
    return list
  }, [appleMapsUrl, googleMapsUrl, wazeUrl])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!links.length) return null

  const showAddress = address && address.trim() && address !== label
  const triggerText = showAddress ? `${label} - ${address}` : label

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-left text-sm text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="truncate">{triggerText}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="surface-card absolute left-0 z-20 mt-2 w-56 overflow-hidden" role="menu">
          {links.map(item => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="block px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
