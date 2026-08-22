/**
 * The reporter's session with the city's site, kept in this browser.
 *
 * The city will not accept a report from an anonymous citizen: the e-mail
 * address names the account, the city texts a one-time code to the phone
 * registered against it, and the code is exchanged for a token. That token
 * and the address stay here. The backend relays both and keeps
 * neither, so this is the only place either one lives.
 */

const TOKEN_KEY = 'dvo-reports.session'
const EMAIL_KEY = 'dvo-reports.email'

export interface Session {
  token: string
  /** When the city stops accepting the token. Absent if it did not say. */
  expires?: string
}

/** Returns the stored session, or null if there is none or it has expired. */
export function liveSession(): Session | null {
  const raw = read(TOKEN_KEY)
  if (!raw) return null
  let session: Session
  try {
    session = JSON.parse(raw) as Session
  } catch {
    return null
  }
  if (!session.token) return null
  // A session with no expiry still works; the reporter finds out late, when
  // the city refuses the token and we ask for a new code.
  if (session.expires && Date.parse(session.expires) <= Date.now()) return null
  return session
}

export function remember(session: Session, email: string): void {
  write(TOKEN_KEY, JSON.stringify(session))
  write(EMAIL_KEY, email)
}

/** Drops the token. The e-mail address stays, so it need not be retyped. */
export function forget(): void {
  write(TOKEN_KEY, null)
}

export function rememberedEmail(): string {
  return read(EMAIL_KEY) ?? ''
}

// Storage throws in a browser that has it switched off, and in a private
// window in some browsers. Losing the session is survivable; the reporter is
// asked for another code.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Nothing to do: the session lasts as long as the page does.
  }
}
