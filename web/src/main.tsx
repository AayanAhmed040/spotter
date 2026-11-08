import { Auth0Provider, type AppState } from '@auth0/auth0-react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import App from './App'
import '@fontsource-variable/outfit'
import '@fontsource-variable/figtree'
import './index.css'
import { SessionExpiredError } from './lib/api'
import { auth0Config, isAuthConfigured } from './lib/config'
import { sessionEvents } from './lib/session-events'

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (e) => {
      if (e instanceof SessionExpiredError) sessionEvents.expire()
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, e) => !(e instanceof SessionExpiredError) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
})

/** Auth0 needs to navigate after the Universal Login redirect, so it sits inside the router. */
function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  if (!isAuthConfigured) return <>{children}</>
  return (
    <Auth0Provider
      domain={auth0Config.domain!}
      clientId={auth0Config.clientId!}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Config.audience,
        // offline_access → rotating refresh tokens, so sessions survive reloads
        // without third-party cookies (Safari / installed PWA).
        scope: 'openid profile email offline_access',
      }}
      useRefreshTokens
      useRefreshTokensFallback={false}
      cacheLocation="localstorage"
      onRedirectCallback={(state?: AppState) => navigate(state?.returnTo ?? '/feed', { replace: true })}
    >
      {children}
    </Auth0Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker registration failed', e))
  })
}
