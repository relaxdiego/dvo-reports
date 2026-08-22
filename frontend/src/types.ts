/** The issue types the backend accepts. Fetched at load; this is the fallback. */
export const CATEGORIES = [
  'garbage',
  'drainage',
  'pothole',
  'streetlight',
  'obstruction',
  'illegal-parking',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

/**
 * Labels shown to the reporter. Keys must match CATEGORIES.
 *
 * The city sees these words too: `categoryLabels` in
 * `backend/internal/upstream/city.go` puts them at the front of the title.
 * Change a word here and change it there. What is in brackets or after a
 * slash is for the reporter alone and the backend leaves it off, so those
 * two lists read the same without being character for character equal.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  garbage: 'Garbage',
  drainage: 'Drainage / flooding',
  pothole: 'Pothole (Lubak)',
  streetlight: 'Street light',
  obstruction: 'Blocked road',
  'illegal-parking': 'Illegal parking',
  other: 'Something else',
}

export interface Draft {
  category: string
  description: string
  /**
   * The street under the pin, looked up rather than typed. The city's own
   * form fills its location box the same way, from its own geocoder.
   * Empty when the lookup found nothing or could not be made; the report
   * then travels with its coordinates alone.
   */
  address: string
  /** Where the problem is. Never null in a draft that passes validate(). */
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
  /** The second number the city puts on a report, once its office has one. */
  city_reference?: string
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
