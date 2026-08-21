/** The issue types the backend accepts. Fetched at load; this is the fallback. */
export const CATEGORIES = [
  'pothole',
  'streetlight',
  'garbage',
  'drainage',
  'traffic-signal',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Labels shown to the reporter. Keys must match CATEGORIES. */
export const CATEGORY_LABELS: Record<string, string> = {
  pothole: 'Pothole',
  streetlight: 'Street light',
  garbage: 'Garbage',
  drainage: 'Drainage / flooding',
  'traffic-signal': 'Traffic signal',
  other: 'Something else',
}

export interface Draft {
  category: string
  description: string
  address: string
  contact: string
  lat: number | null
  lon: number | null
  photos: File[]
}

export interface Receipt {
  reference: string
  track_url?: string
}
