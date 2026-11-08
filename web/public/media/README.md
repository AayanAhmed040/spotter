# Videos

Drop video files here with these exact names and they appear in the app automatically
(until then a "Video coming soon" placeholder shows):

| File | Where it shows |
|---|---|
| `pushups-demo.mp4` (+ `pushups-demo.jpg` poster) | Landing page hero (autoplays muted on loop) **and** the Push-ups setup screen |
| `setup-squats.mp4` | Workout setup screen when Squats is selected |
| `setup-plank.mp4` | Workout setup screen when Plank is selected |

Tips: H.264 MP4, 16:9, under ~5 MB each (they're served from the site, not a CDN).
To use a different hero clip, change `HERO_VIDEO` in `src/pages/Landing.tsx` or
`setupVideo` in `src/exercises/<exercise>/index.ts`.
