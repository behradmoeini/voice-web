# Praxify voice web (Realtime WebRTC)

This app is now a **speech-to-speech call console** using OpenAI Realtime over WebRTC.

Flow:
1. Browser requests `POST /api/realtime-session`.
2. Server uses `OPENAI_API_KEY` to mint a short-lived client secret from OpenAI.
3. Browser connects directly to `https://api.openai.com/v1/realtime/calls` with SDP + ephemeral secret.
4. Audio in/out streams live over WebRTC, transcript is shown in-session only (no persistence).
5. UI surfaces diagnostic timing/event logs and can copy a full debug snapshot.
6. In-app documentation is available via the `Technical Docs` tab.

## Environment variables

Required:

- `OPENAI_API_KEY` - standard server-side API key

Optional:

- `OPENAI_REALTIME_MODEL` (default: `gpt-realtime`)
- `OPENAI_REALTIME_VOICE` (default: `marin`)

## Setup

```bash
npm install
npm run sync:env
```

`sync:env` reads `../voice-agent/config/config.yaml` and writes `.env.local` for this app.

## Local dev

```bash
npm run dev:vercel
```

Use `vercel dev` (not plain `vite`) so `/api/realtime-session` works locally.

## Debug endpoints

- `GET /api/realtime-session`: lightweight health check (`OPENAI_API_KEY` configured or not + defaults)
- `POST /api/realtime-session`: mints realtime client secret and returns debug timings

## Useful commands

```bash
# build validation
npm run build

# run local app + api
npm run dev:vercel

# check health locally
curl -s http://localhost:3000/api/realtime-session

# check deployed preview health
curl -s https://<your-preview-url>/api/realtime-session

# inspect deployment
npx vercel inspect <deployment-url>

# stream runtime logs (replace project/team)
npx vercel logs <deployment-url> --since=1h
```

## Deploy on Vercel

1. Create a Vercel project with **Root Directory = `voice-web`**.
2. Set `OPENAI_API_KEY` in project environment variables.
3. Optionally set `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE`.

## Notes

- Keep `server/site-assistant-knowledge.ts` as the authoritative Praxify receptionist grounding source.
- The transcript is session-local and is cleared on refresh.
- Canonical technical design document: `/TECHNICAL_DESIGN.md` (served from `public/TECHNICAL_DESIGN.md`).
