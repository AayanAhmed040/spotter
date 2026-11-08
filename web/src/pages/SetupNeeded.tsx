import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

/** Shown when the Auth0 environment variables are missing — sign-in can't work without them. */
export default function SetupNeeded() {
  const origin = window.location.origin
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link to="/">
        <Logo className="text-4xl" />
      </Link>
      <h1 className="mt-8 font-display text-5xl font-semibold tracking-tight">Connect Auth0 to sign in</h1>
      <p className="mt-3 text-mist">
        Striqs uses Auth0 Universal Login. Add your tenant details to <code className="text-chalk">web/.env.local</code>, then
        restart <code className="text-chalk">npm run dev</code>.
      </p>
      <ol className="mt-8 space-y-5 text-[15px]">
        <Step n={1} title="Create a Single Page Application in Auth0">
          Allowed Callback URLs, Logout URLs and Web Origins: <code className="break-all text-accent">{origin}</code>.
          Turn on Refresh Token Rotation.
        </Step>
        <Step n={2} title="Create an API">
          Identifier: <code className="text-accent">https://api.striqs.health</code> (any URI works — it's the token audience).
          Signing algorithm RS256. Enable "Allow Offline Access".
        </Step>
        <Step n={3} title="Fill in web/.env.local">
          <pre className="mt-2 overflow-x-auto rounded-xl bg-court p-3 text-[13px] text-chalk">
{`VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=…
VITE_AUTH0_AUDIENCE=https://api.striqs.health`}
          </pre>
        </Step>
        <Step n={4} title="Fill in api/.env with the same domain and audience">
          The API verifies every access token against your tenant's public keys.
        </Step>
      </ol>
      <p className="mt-8 text-sm text-dim">Full walkthrough: README.md → "Auth0 setup".</p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="font-display text-3xl leading-none font-semibold text-accent">{n}</span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <div className="mt-1 text-mist">{children}</div>
      </div>
    </li>
  )
}
