# Striqs

Push-ups, squats and planks — counted, timed and form-checked by on-device AI, shared with the people who keep you going. Live at [striqs.health](https://striqs.health).

Built for the hackathon prompt *"How can we leverage technology to promote health, social connections, and well-being in our communities?"* The idea: **use AI to turn social accountability into measurable community participation.** Your phone's camera scores every rep; your group sees the result, reacts to it, and works toward one shared goal where everyone's reps count.

```
striqs/
├── web/                     React + TypeScript + Vite + Tailwind PWA (Auth0 React SDK, MediaPipe Pose)
│   └── src/exercises/       one folder per exercise — detection, scoring, config, tests
│       ├── shared/          pose types, geometry, landmarks, signal helpers, camera, session engine
│       ├── pushups/  squats/  planks/
│       ├── meta.ts          names/kinds (lightweight, used by feed cards)
│       └── index.ts         registry — add an exercise here
├── api/                     FastAPI + SQLAlchemy (Auth0 JWT validation, groups, scoring, Gemini)
│   ├── app/scoring/         pushup.py, squat.py, plank.py — authoritative scorers
│   ├── app/migrations.py    versioned in-place schema migrations (SQLite + Postgres)
│   └── scripts/remove_demo_data.py
└── shared/scoring-cases.json   keeps the TypeScript and Python scorers identical
```

## What works

| Area | Status |
|---|---|
| Auth0 Universal Login (PKCE, rotating refresh tokens), protected routes, session-expiry handling | Done |
| API verifies every access token (RS256 via JWKS, issuer, audience, expiry, `sub`) | Done, tested |
| Groups, invite codes and `/join/CODE` links, owner/admin/member roles | Done, tested |
| **Push-ups** — elbow angle + body line, hysteresis state machine, per-rep form score | Done, tested on simulated motion |
| **Squats** — knee angle + torso lean from the side, own state machine, depth/posture scoring | Done, tested on simulated motion |
| **Planks** — timed hold that only runs in a valid plank, pauses on sag/pike/knees down, windowed form scoring | Done, tested on simulated motion |
| Live screens per exercise (rep counter or hold timer), lighting and tracking-quality warnings | Done |
| Results that explain the score; server re-scores raw measurements | Done, tested |
| Feed, profile (per-exercise stats + history), calendar, per-exercise leaderboards | Done, tested |
| Gemini weekly insights + AI group challenges (push-ups or squats) | Done (rule-based fallback without a key) |
| Database migration for existing data (SQLite and Postgres) | Done, tested on real old-format databases |

**Needs a real-device check.** The three detectors are tested against physically modelled synthetic motion and were exercised end-to-end in the browser UI, but not yet on a person in front of a real camera. Thresholds live in each exercise's `config.ts` (`web/src/exercises/<exercise>/`) if they need tuning; scoring constants must be changed in both the `.ts` config and the matching `api/app/scoring/*.py`, then regenerate the fixture (see Scoring).

## Run it locally

Requirements: Node 20+, Python 3.11+. On macOS the built-in `python3` is 3.9 — install a newer one (python.org or `brew install python@3.13`) and create the virtual environment with it: `python3.13 -m venv .venv && source .venv/bin/activate`. Start the API with `uvicorn` as below, not by running `main.py` directly.

```bash
# API
cd api
cp .env.example .env            # fill AUTH0_DOMAIN + AUTH0_AUDIENCE (see Auth0 setup)
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Web (second terminal)
cd web
cp .env.example .env.local      # fill VITE_AUTH0_* (see Auth0 setup)
npm install
npm run dev                     # http://localhost:5173  (Vite proxies /api → :8000)
```

Sign in, create a group from **Groups**, and share its invite code. Existing databases are upgraded automatically on startup (see Database).

**On your phone:** cameras and Auth0 both require HTTPS on anything except `localhost`. Run `npm run dev:https` and open `https://<your-laptop-LAN-IP>:5173` (accept the self-signed certificate once). Add that origin to the Auth0 URLs below.

**Tests:** `cd web && npm test` (detectors + scorers for all three exercises, 50 tests) · `cd api && pytest` (auth, authorization, per-exercise storage, migrations, scoring parity, leaderboards, challenges, insights — 45 tests).

## Auth0 setup

1. **Create an API** — Applications → APIs → *Create API*
   - Name: `Striqs API` · Identifier: e.g. `https://api.striqs.health` (any URI; it becomes the token `aud`) · Signing: **RS256**
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
5. **Branding (optional, nice for judges)** — Branding → Universal Login → primary colour `#C6DCF2`, page background `#181C21`, logo `https://striqs.health/icons/icon-512.png`
6. **Testing with several accounts** — sign up different emails in separate browser profiles / incognito windows, or create users under User Management.

### Demoing Auth0 to judges
- `GET /api/auth/session` (with a signed-in user's token) returns exactly what the API verified on that request — issuer, audience, scopes, expiry and the `sub` → user mapping. (The explanatory screen for this was removed from the app; the endpoint and all checks remain.)
- Authorization is the app's job, not Auth0's: try opening another group's URL as a non-member (404), or editing someone else's workout (403). These are covered by `api/tests/test_app.py`.
- Forged tokens are rejected: wrong key, wrong audience/issuer, expired, `alg: none`, HS256 key confusion — see `api/tests/test_auth.py`.

## How scoring works

Every exercise is scored the same *way* — 70% form, 30% volume toward a target that caps out — but each measures form on its own terms, and scores are never compared across exercises (leaderboards are per exercise).

**Push-ups** (per rep): depth = deepest elbow angle (40%), body line = shoulder–hip–ankle deviation (35%), lockout (15%), control/tempo (10%). Valid rep: elbow ≤ 105°, back to ≥ 155°.

**Squats** (per rep): depth = deepest knee angle (45%; ~55–65° is parallel), chest up = max torso lean (25%), stand tall = knee extension between reps (15%), control (15%). Valid rep: knee ≤ 105°, back to ≥ 160°. Front-facing cameras are detected and asked to turn side-on.

**Planks** (per ≤5 s window of valid hold): body line (60%), stillness = hip sway (25%), shoulders stacked over elbows/wrists (15%). The timer only runs in a valid plank (body roughly horizontal, legs straight, line within 28°); brief wobbles (< 0.7 s) don't break the hold but never add time.

Session form **F** = confidence-weighted mean of rep/window form, blended 85/15 with a consistency term. Volume **V** = 100 × min(reps ÷ target, 1) or min(hold ÷ target, 1). **Final S = 0.7F + 0.3V.** The brief's example (20 push-ups at 70 → 79; 15 at 95 → 89) is a unit test.

The browser shows a preview; the API recomputes and stores the authoritative score from the raw measurements and can only downgrade a rep or window, never upgrade it. Sets tracked with low confidence can be saved privately but not posted to groups. After changing any scoring constant: `cd web && npx tsx scripts/gen-scoring-fixture.ts`, then run both test suites.

## Database

`workouts.metric_kind` is `reps` (push-ups, squats) or `hold` (planks). Rep columns (`valid_reps`, `attempted_reps`, `target_reps`, `rep_score`, `rep_metrics`) are NULL for holds; hold columns (`hold_ms`, `longest_hold_ms`, `target_hold_ms`, `hold_score`, `hold_windows`) are NULL for reps. Raw measurements are always stored next to the scores.

Schema changes are applied by `api/app/migrations.py` on startup, tracked in `schema_migrations`. Migration 1 upgrades push-up-only databases in place — on SQLite via the documented table-rebuild procedure, on Postgres with `ALTER TABLE` — keeping every row, id and reaction. Tested against real old-format SQLite and Postgres databases.

**Removing old sample data:** the old `seed.py` demo accounts (Maya, Jules, … and the DEMO42 group) can be removed with `python scripts/remove_demo_data.py` from `api/`. It lists what it will delete and asks first; real users, groups and workouts are untouched.

## Gemini

`GEMINI_API_KEY` in `api/.env` enables:
- **Weekly insight** (Profile): Gemini gets only aggregate numbers — sessions, reps, average form, week-over-week change, weakest form area. No names, emails, photos or video. Cached per week; regenerated only when the numbers change, at most every 2 minutes.
- **Group challenge** (Group page, owners/admins): Gemini designs a collective push-up or squat goal from the group's last 14 days. The API clamps the goal to a range computed from real activity and stores it.

Responses use structured JSON output, are validated with Pydantic, checked for medical/injury/diet language, and replaced by clearly-labelled rule-based text on any error or rate limit. Model: `GEMINI_MODEL` (default `gemini-3.6-flash`).

## Deploying

- **Web → Vercel**: root `web/`, build `npm run build`, output `dist`. Set the three `VITE_AUTH0_*` vars and `VITE_API_URL=https://<your-api>`. `vercel.json` handles SPA routing.
- **API → Vultr** (or anywhere with Docker): `docker build -t striqs-api api/ && docker run -p 8000:8000 --env-file api/.env striqs-api`. Put Caddy or nginx in front for HTTPS, and set `CORS_ORIGINS` to your Vercel URL.
- **Database**: set `DATABASE_URL` to any Postgres URL. Tables are created on startup. On Postgres the API enables row-level security on its tables so Supabase's auto-generated REST API can't read them (the API connects as table owner, so it's unaffected).

### Sponsor fit notes
- **Tiger Data**: Tiger Cloud is managed Postgres with TimescaleDB, so it can *be* our one database (swap `DATABASE_URL`) rather than a second one. The real payoff would be making `workouts` a hypertable and replacing the Python aggregations in `api/app/services/stats.py` with continuous aggregates for daily/weekly rollups. Worth doing only if you go for that prize.
- **Vultr**: the Dockerfile above is all that's needed.
- Solana / Entire: intentionally not integrated.

## Videos

The landing page and each exercise's setup screen have a video slot. Drop files into `web/public/media/` — see `web/public/media/README.md` for the names.

## Privacy & safety choices
- Video is processed in the browser and never uploaded or stored. Only rep measurements are saved.
- Workouts can be shared with groups or kept private. Simulated demo sets are labelled and never count on leaderboards or challenges; seeded demo accounts are badged.
- The calendar and copy encourage rest days and weekly consistency instead of daily streaks.
- Feedback is presented as an estimate from 2D pose tracking, not medical or coaching advice.

See `docs/DEVLOG.md` for the decisions log (useful for the DEV writing challenge).
