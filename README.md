# Podium Coach

A speech articulation coach for professional conversations. You answer a real scenario out loud, and Podium gives you:

- **Live transcript.** The browser's speech recognition writes down your words as you speak. You can edit the text afterwards to fix misheard words.
- **Voice analysis on your device.** It measures pace (words per minute), long pauses, pitch variation (to catch a monotone voice) and volume control. You see all of it on a timeline of your take.
- **Playback** of your take.
- **Word analysis.** Fillers, hedges, apologies and weak words are highlighted, and you get a tightened draft of what you said.
- **A score** across Clarity, Confidence, Structure, Concision and Delivery.
- **AI coach (optional).** It returns rewrites of your exact lines, a stronger version of your answer that it can read aloud to you, a drill, and the follow-up question the other person would ask next. You can answer that follow-up straight away.
- Streak, rep history, and English, French, Spanish and German filler lists.
- Installable as an app (PWA), and the app itself works offline.

## Run it locally

You need Node 18 or newer. There are no dependencies to install.

```bash
cp .env.example .env          # paste your Anthropic API key into .env
node dev-server.js            # → http://localhost:3000
```

Open it in **Chrome, Edge or Safari**. Live transcription needs the Web Speech API, and Firefox doesn't have it. Without a key, everything works except the AI coach.

## Deploy (Vercel)

1. Push this folder to a GitHub repo and import it in Vercel. `vercel.json` already sets it up as a static site (files in `public/`) plus one function (`api/coach.js`), so leave the framework and build settings as they are.
2. In Settings → Environment Variables, add `ANTHROPIC_API_KEY`.
3. Strongly recommended: also add `ACCESS_CODE`. Without it, anyone with the URL can spend your API credit. Enter the same code in the app's Settings (gear icon).

The files in `public/` are served as a static site, and `api/coach.js` becomes `POST /api/coach`. Any other host works too: serve `public/` and run `dev-server.js`, or port `lib/coach.js` to your platform's function format.

**HTTPS is required** for microphone access (localhost is exempt).

## Install on a phone

Open the deployed URL, then:
- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.

## Limits

- **Speech engines hide fillers.** Chrome often drops "um" and "uh" from the transcript. Podium reminds you to listen to the playback for those. Pause and pitch analysis comes from the audio itself, so the transcript doesn't affect it.
- **Pitch tracking** uses autocorrelation in the 70–400 Hz range. Background noise or music will make it less accurate.
- **The voice scores are heuristics**, tuned on typical conversational speech (pace 130–160 wpm, pitch variation 2.5–7 semitones). They are a practice aid, not a clinical speech assessment.

## Privacy (GDPR notes)

- Audio, voice metrics and history stay in the browser (localStorage), and nothing is uploaded by Podium itself.
- Live transcription is handled by the browser vendor's speech service. Chrome and Edge send audio to Google and Microsoft. Disclose this in your privacy notice if you offer the app publicly.
- The AI coach sends only the transcript, the scenario and the numeric metrics to your server, which forwards them to the Anthropic API.

## Files

| File | What it does |
|---|---|
| `public/index.html`, `public/app.css`, `public/app.js` | The app: recording, analysis, scoring, UI |
| `lib/coach.js` | Prompt and call to Claude, returns structured JSON |
| `api/coach.js` | Vercel function wrapper |
| `dev-server.js` | Zero-dependency local server (not used on Vercel) |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icon.svg` | Offline support and install |
| `vercel.json` | Tells Vercel: static site from `public/`, no server |

To add a scenario, add an entry to `SCEN` at the top of `public/app.js`. Set the model with `ANTHROPIC_MODEL`; the default is `claude-sonnet-5-5`.
