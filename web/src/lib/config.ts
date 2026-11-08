export const APP_NAME = 'Striqs'

export const auth0Config = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN as string | undefined,
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined,
  audience: import.meta.env.VITE_AUTH0_AUDIENCE as string | undefined,
}

export const isAuthConfigured = Boolean(auth0Config.domain && auth0Config.clientId && auth0Config.audience)

/** Empty in dev: Vite proxies /api to FastAPI. */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
