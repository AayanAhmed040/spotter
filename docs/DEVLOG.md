# Development log

Notes for the DEV write-up. Newest at the bottom.

## Day 1 — foundation

**Architecture: CV in the browser, judgment on the server.** MediaPipe Pose runs client-side (privacy, latency, no GPU servers). The server never sees video, but it does own the *formula*: the browser uploads raw per-rep measurements and the API recomputes the score. A shared JSON fixture (`shared/scoring-cases.json`) is tested by both the TypeScript and Python scorers so they can't drift.

**Detection = geometry + a state machine.** Per frame: pick the body side facing the camera, convert normalized landmarks to pixel space (otherwise a 16:9 frame distorts every angle — there's a test for this), then measure elbow angle, shoulder–hip–ankle deviation, a signed hip offset (sag vs pike), and body tilt. The state machine (`searching → setup → top ⇄ down`) uses hysteresis: a rep starts below 140°, counts only after returning above 155°, and an "armed" flag means bouncing near the bottom can't produce a second count.

**Testing CV without a camera.** A small kinematic model generates side-view push-ups: wrist planted under the shoulder, equal upper-arm/forearm segments, so for elbow angle θ the shoulder height is 2L·sin(θ/2). Adding Gaussian noise, half reps, sagging hips and fatigue gives repeatable test cases. The same simulator powers the labelled demo mode and the landing-page animation — real detector, simulated input.

**Scoring rewards quality and honesty about uncertainty.** Session form is a confidence-weighted mean (uncertain reps count less) plus a consistency term, so one perfect rep can't rescue a sloppy set. 15 clean reps beat 30 sloppy ones (unit test).

**Auth0 split of responsibilities.** Auth0 answers "who is this?" (Universal Login, PKCE, rotating refresh tokens). The API answers "what may they do?" — group membership, roles and ownership — from its own tables keyed by `sub`. Tests forge tokens every way we could think of (wrong key, wrong audience, expired, `alg: none`, HS256 key confusion).

**Gemini with guardrails.** Aggregates only in, structured JSON out, Pydantic validation, a banned-topic check, goal clamping to a range derived from real data, and a clearly-labelled rule-based fallback so the feature never breaks the demo.

**Things that bit us**
- Safari/installed PWAs block third-party cookies, so silent auth via iframe fails → refresh tokens with `offline_access` and local-storage cache.
- Simulated workouts must not pollute leaderboards — they're tagged `source: demo` and excluded everywhere competitive.
- Weekly insights cached per week went stale after the first workout → cache is now invalidated when the underlying numbers change (still throttled).

## Day 2 — Striqs: squats, planks, rebrand

**Rebrand.** Spotter → Striqs. The mark was traced from the logo raster (column-by-column outline) into an SVG path so it stays sharp at every size; the wordmark is Outfit, which matches the logo's geometric letterforms. Palette taken straight from the logo: charcoal + ice blue.

**One folder per exercise.** `web/src/exercises/{pushups,squats,planks}` each own their detector, scoring and config; `shared/` holds geometry, landmark helpers, smoothing/stability/feedback utilities, the camera session engine and the generic rep-session aggregator. The UI only talks to an `ExerciseDefinition` (tracker factory, score, explain, details), so adding an exercise doesn't touch the workout screen.

**Squats need their own geometry.** First thresholds assumed ~90° at the knee for a full squat — the simulator test caught that the internal hip–knee–ankle angle at parallel is closer to 55–65°. Depth now ramps from 115° (0 points) to 70° (100 points).

**Planks are timed, not counted.** The tracker only adds time on frames that are a valid plank, caps frame gaps (a hidden tab can't add time), uses a short grace period so a wobble doesn't split the hold, and summarises the hold in ≤5 s windows. Windows are what the server re-scores — the same "raw measurements in, authoritative score out" contract as reps.

**Client and server agree by construction.** The browser preview now applies the same downgrade rules the server applies (e.g. a "valid" squat at 118° becomes "not deep enough"), and a shared fixture with cases for all three exercises is checked by both test suites.

**Migrating real data.** SQLite can't drop NOT NULL in place, so migration 1 follows SQLite's table-rebuild procedure with foreign keys off (reactions keep their workout ids) and verifies row counts before committing; Postgres uses plain ALTERs. Both paths were tested against databases created by the original code.

**Testing the live screens without a camera model.** A QA-only Vite alias swapped MediaPipe for the test simulators, so the real trackers, live HUD, results and saving were exercised end-to-end in Chrome. (Removed afterwards — not shipped.)
