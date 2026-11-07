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
