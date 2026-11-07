# Spotter

Push-ups counted and form-checked by on-device AI, shared with the people who keep you going.

Built for the hackathon prompt *"How can we leverage technology to promote health, social connections, and well-being in our communities?"* The idea: **use AI to turn social accountability into measurable community participation.** Your phone's camera scores every rep; your group sees the result, reacts to it, and works toward one shared goal where everyone's reps count.

```
spotter/
├── web/      React + TypeScript + Vite + Tailwind PWA (Auth0 React SDK, MediaPipe Pose)
├── api/      FastAPI + SQLAlchemy (Auth0 JWT validation, groups, scoring, Gemini)
└── shared/   scoring-cases.json — keeps the TypeScript and Python scorers identical
```

## What works

| Area | Status |
|---|---|
| Auth0 Universal Login (PKCE, rotating refresh tokens), protected routes, session-expiry handling | Done |
| API verifies every access token (RS256 signature via JWKS, issuer, audience, expiry, `sub`) | Done, tested |
| First-login profile sync from Auth0 `/userinfo`; one app user per Auth0 `sub` | Done, tested |
| Private groups, invite codes and `/join/CODE` links, owner/admin/member roles | Done, tested |
| Push-up detection: MediaPipe Pose in the browser → angles → state machine → per-rep scoring | Done, tested on simulated motion |
| Live UI: skeleton overlay, rep counter, coaching cues, timer, tracking-confidence, pause/finish | Done |
| Labelled demo mode (simulated athlete through the real detector) | Done |
| Results screen explaining the score; server re-scores from raw rep measurements | Done, tested |
| Feed with reactions, visibility (groups / only me) | Done, tested |
| Leaderboard: top score, most consistent, most improved, most encouraging, most reps | Done |
| GitHub-style activity calendar with day drill-down, milestones | Done |
| Gemini: weekly insights + AI-generated collective group challenges | Done (falls back to labelled rule-based text without a key) |
| Installable PWA (manifest, icons, service worker caching the pose model) | Done |

**Not yet verified on a real camera.** The detector is tested against physically modelled synthetic push-ups (exact rep counts, half reps rejected, sagging hips penalised, no double counts), but the MediaPipe → detector path needs a real try on your phone. Thresholds live in `web/src/pose/pushupDetector.ts` (`DETECTOR`) if they need tuning.

## Run it locally

Requirements: Node 20+, Python 3.11+.

```bash
# API
cd api
cp .env.example .env            # fill AUTH0_DOMAIN + AUTH0_AUDIENCE (see Auth0 setup)
pip install -r requirements-dev.txt
python seed.py                  # optional: demo group with invite code DEMO42
uvicorn app.main:app --reload --port 8000

# Web (second terminal)
cd web
cp .env.example .env.local      # fill VITE_AUTH0_* (see Auth0 setup)
npm install
npm run dev                     # http://localhost:5173  (Vite proxies /api → :8000)
```

Sign in, go to **Groups → Join with a code → `DEMO42`** to see a populated feed, leaderboard and challenge.

**On your phone:** cameras and Auth0 both require HTTPS on anything except `localhost`. Run `npm run dev:https` and open `https://<your-laptop-LAN-IP>:5173` (accept the self-signed certificate once). Add that origin to the Auth0 URLs below.

**Tests:** `cd web && npm test` (detector + scorer, 22 tests) · `cd api && pytest` (auth, authorization, scoring parity, challenges, insights — 30 tests).

## Auth0 setup

1. **Create an API** — Applications → APIs → *Create API*
   - Name: `Spotter API` · Identifier: `https://api.spotter.app` (any URI; it becomes the token `aud`) · Signing: **RS256**
   - Settings → **Allow Offline Access: on** (needed for refresh tokens)
2. **Create the app** — Applications → *Create Application* → **Single Page Web Application**
   - Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins — each:
     `http://localhost:5173, https://localhost:5173` plus your LAN URL and your Vercel URL when you have them
   - Refresh Token Rotation: **on** (Settings → Refresh Token Rotation)
3. **Connections** — enable Username-Password, and Google if you want one-tap social login
4. **Environment**
   - `web/.env.local`: `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`
   - `api/.env`: `AUTH0_DOMAIN` (same domain, no `https://`), `AUTH0_AUDIENCE` (same identifier)
   - Nothing secret is used in the browser — the SPA has no client secret (PKCE).
5. **Branding (optional, nice for judges)** — Branding → Universal Login → primary colour `#FFC83D`, page background `#0F1B33`, logo `https://<your-app>/icons/icon-512.png`
6. **Testing with several accounts** — sign up different emails in separate browser profiles / incognito windows, or create users under User Management.

### Demoing Auth0 to judges
- **Account tab → "How your sign-in is protected"** shows the identity provider, the access token's issuer/audience/scopes/expiry, and the checks the API just performed on the live request.
- Authorization is the app's job, not Auth0's: try opening another group's URL as a non-member (404), or editing someone else's workout (403). These are covered by `api/tests/test_app.py`.
- Forged tokens are rejected: wrong key, wrong audience/issuer, expired, `alg: none`, HS256 key confusion — see `api/tests/test_auth.py`.

## How scoring works

Per rep, measured on-device from the side-on pose (pixel space, so phone aspect ratio doesn't skew angles):

| Component | Weight | 100 points at | 0 points at |
|---|---|---|---|
| Depth (deepest elbow angle) | 40% | ≤ 85° | ≥ 115° |
| Body line (shoulder–hip–ankle deviation) | 35% | ≤ 8° | ≥ 35° |
| Lockout (elbow angle at the top) | 15% | ≥ 165° | ≤ 150° |
| Control (rep duration) | 10% | ≥ 0.8 s | ≤ 0.4 s |

A rep only counts if it reaches ≤ 105°, returns to ≥ 155°, and was tracked with enough confidence. Session form **F** is the confidence-weighted mean of rep scores blended 85/15 with a consistency term (so one great rep can't carry a sloppy set). Repetition score **R = 100 × min(N / T, 1)**, default T = 20. **Final S = 0.7F + 0.3R** — the brief's example (20 reps at 70 → 79; 15 reps at 95 → 89) is a unit test.

The browser shows a preview; the API recomputes and stores the authoritative score from the raw per-rep measurements (and can only downgrade a rep, never upgrade it). All weights are constants in `web/src/pose/scoring.ts` and `api/app/scoring.py`; after changing them run `npx tsx scripts/gen-scoring-fixture.ts` in `web/` and both test suites.

## Gemini

`GEMINI_API_KEY` in `api/.env` enables:
- **Weekly insight** (Profile): Gemini gets only aggregate numbers — sessions, reps, average form, week-over-week change, weakest form area. No names, emails, photos or video. Cached per week; regenerated only when the numbers change, at most every 2 minutes.
- **Group challenge** (Group page, owners/admins): Gemini designs a collective goal from the group's last 14 days. The API clamps the goal to a range computed from real activity and stores it.

Responses use structured JSON output, are validated with Pydantic, checked for medical/injury/diet language, and replaced by clearly-labelled rule-based text on any error or rate limit. Model: `GEMINI_MODEL` (default `gemini-3.6-flash`).

## Deploying

- **Web → Vercel**: root `web/`, build `npm run build`, output `dist`. Set the three `VITE_AUTH0_*` vars and `VITE_API_URL=https://<your-api>`. `vercel.json` handles SPA routing.
- **API → Vultr** (or anywhere with Docker): `docker build -t spotter-api api/ && docker run -p 8000:8000 --env-file api/.env spotter-api`. Put Caddy or nginx in front for HTTPS, and set `CORS_ORIGINS` to your Vercel URL.
- **Database**: set `DATABASE_URL` to any Postgres URL. Tables are created on startup. On Postgres the API enables row-level security on its tables so Supabase's auto-generated REST API can't read them (the API connects as table owner, so it's unaffected).

### Sponsor fit notes
- **Tiger Data**: Tiger Cloud is managed Postgres with TimescaleDB, so it can *be* our one database (swap `DATABASE_URL`) rather than a second one. The real payoff would be making `workouts` a hypertable and replacing the Python aggregations in `api/app/services/stats.py` with continuous aggregates for daily/weekly rollups. Worth doing only if you go for that prize.
- **Vultr**: the Dockerfile above is all that's needed.
- Solana / Entire: intentionally not integrated.

## Privacy & safety choices
- Video is processed in the browser and never uploaded or stored. Only rep measurements are saved.
- Workouts can be shared with groups or kept private. Simulated demo sets are labelled and never count on leaderboards or challenges; seeded demo accounts are badged.
- The calendar and copy encourage rest days and weekly consistency instead of daily streaks.
- Feedback is presented as an estimate from 2D pose tracking, not medical or coaching advice.

See `docs/DEVLOG.md` for the decisions log (useful for the DEV writing challenge).
