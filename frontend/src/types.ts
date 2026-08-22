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
  lat: number | null
  lon: number | null
  photos: File[]
}

export interface Receipt {
  reference: string
  track_url?: string
  /** Set when the report was filed but its photos did not upload. */
  warning?: string
}

/** One report this reporter has already filed, as the city lists it. */
export interface Filed {
  reference: string
  title: string
  description: string
  location: string
  status: string
  /** The city's own timestamp. Its layout is not documented; see docs/upstream.md. */
  filed: string
  photos?: string[]
}

/** One status change in a filed report's history. */
export interface Step {
  status: string
  office?: string
  at: string
}

/** What an office answered. */
export interface Resolution {
  office: string
  files?: string[]
}

/** What has happened to one filed report. */
export interface History {
  reference: string
  steps: Step[]
  /** The city's reason for a report it rejected or wants filed again. */
  note?: string
  resolutions?: Resolution[]
}

/**
 * What the city's status words mean, in the city's own wording from its
 * tracking page. A status not listed here is shown as the city wrote it.
 */
export const STATUS_MEANING: Record<string, string> = {
  REPORTED: 'Accepted and waiting to be processed.',
  'REPORT SUBMITTED': 'Accepted and waiting to be processed.',
  ENCODED: 'Added to the city’s database for processing.',
  FORVERIFICATION: 'Being checked for accuracy and completeness.',
  FORREMARKS: 'Forwarded to the City Mayor’s Office for review.',
  RECEIVED: 'Sent to the office that can act on it.',
  PENDING: 'The office has it and has not acted yet.',
  ONGOING: 'Being worked on, or waiting for an inspection.',
  RESOLVED: 'Closed. The city considers it done.',
  COMPLETED: 'Closed. The city considers it done.',
  FORRESUBMISSION: 'The city wants this one filed again.',
  INVALID: 'The city did not accept this report.',
}
