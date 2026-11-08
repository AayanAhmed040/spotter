import { useAuth0 } from '@auth0/auth0-react'
import { useCallback } from 'react'
import { API_URL } from './config'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The session can't produce a valid access token any more — the user must sign in again. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, 'Your session has expired. Sign in again to continue.')
  }
}

const EXPIRED_CODES = new Set(['login_required', 'consent_required', 'invalid_grant', 'missing_refresh_token'])

/**
 * Returns a fetch function that attaches a fresh Auth0 access token (scoped to our
 * API's audience) to every request. Tokens are refreshed silently via rotating
 * refresh tokens; if that fails the caller gets a SessionExpiredError.
 */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0()

  return useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
      let token: string
      try {
        const t = await getAccessTokenSilently() // audience comes from the Auth0Provider config
        if (!t) throw new SessionExpiredError()
        token = t
      } catch (e) {
        const code = (e as { error?: string }).error
        if (code && EXPIRED_CODES.has(code)) throw new SessionExpiredError()
        throw e
      }
      const { json, headers, ...rest } = init
      const res = await fetch(`${API_URL}${path}`, {
        ...rest,
        headers: {
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
          Authorization: `Bearer ${token}`,
          // Lets the API run behind a free ngrok tunnel without its browser warning page.
          'ngrok-skip-browser-warning': 'true',
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      })
      if (res.status === 401) throw new SessionExpiredError()
      if (!res.ok) {
        let message = `Request failed (${res.status})`
        try {
          const body = await res.json()
          if (typeof body.detail === 'string') message = body.detail
          else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join('; ')
        } catch {
          /* non-JSON error body */
        }
        throw new ApiError(res.status, message)
      }
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    },
    [getAccessTokenSilently],
  )
}
