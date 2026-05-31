# Agentic Journal

Agentic Journal is a personal, Pi-hosted daily operating system for journaling, planning, task management, project tracking, and job lead tracking. It combines a Next.js interface, Cedar-OS chat surfaces, and a Mastra backend agent that can read current app state, update the UI, and persist journal/task/job changes to local JSON storage.

The app is built for everyday use from a MacBook over Tailscale, with the Raspberry Pi running the production service by default and a quick switch into hot-reloading development mode when editing.

## What It Is

Agentic Journal is an AI-assisted personal journal and planning workspace:

- A week view records what happened and what was planned, organized by date and hour.
- Two persistent General backlogs separate obligations from optional work: `have-to-do` and `want-to-do`.
- Today lists show the day’s selected Current work plus automatic due-date tasks, with full historical snapshots.
- Project tags roll tasks up into a dedicated project view.
- A job board tracks co-op and new-grad leads, including source, status, salary, notes, and posting metadata.
- Cedar chat modes let the journal agent inspect context and operate the app through structured tools.

## Core Features

- **Hourly journal and planner**: planned entries and logged entries live side by side, including single-hour entries and multi-hour ranges.
- **General, Current, and Today tasks**: maintain unordered backlogs, prioritize running work in Current, then select Current tasks into Today.
- **Daily snapshots**: dated Today lists retain selected Current work, unranked automatic due-date work, and completion history.
- **Project view**: tasks are grouped by project so active, scheduled, completed, and unassigned work can be scanned outside the daily view.
- **Job tracker**: save, star, apply, or archive fall co-op, spring co-op, and new-grad listings with structured source and status history.
- **Agentic UI control**: the Mastra journal agent can create journal files, append planned/logged entries, update tasks, reorder priorities, complete tasks, and maintain job listings.
- **Pi-first operations**: production runs as `agentic-journal.service`; development mode can temporarily take over the same Tailscale URL.

## Architecture

The project has two cooperating runtimes:

- **Frontend**: Next.js 15, React 19, Tailwind CSS, and Cedar-OS components in `src/app`, `src/components`, and `src/cedar`.
- **Backend agent**: Mastra lives under `src/backend` and exposes the Cedar-compatible chat and tool workflow.

Runtime shape:

- Next.js serves the main app on `127.0.0.1:3000`.
- Mastra serves the backend on `127.0.0.1:4111`.
- The Next app proxies Mastra through `/mastra` for browser access.
- Cedar publishes app context such as `weekJournals`, `taskLists`, `jobListings`, `currentDate`, and `currentTime` to the agent.
- The agent uses typed tools to update state and persist changes through the app's API routes.

The current journal agent is configured for Google Vertex AI via `@ai-sdk/google-vertex`.

## Local Development

### Prerequisites

- Node.js 20.9+ for the Mastra backend.
- `npm` for the root Next.js app.
- `pnpm` for `src/backend`.
- Google Vertex AI credentials configured through `.env`.

### Install

From the repository root:

```bash
npm install
pnpm --dir src/backend install
```

### Run

Start both the frontend and backend:

```bash
npm run dev
```

This starts:

- Next.js: `http://127.0.0.1:3000`
- Mastra: `http://127.0.0.1:4111`
- Mastra proxy through Next.js: `http://127.0.0.1:3000/mastra`

Run either side independently when needed:

```bash
npm run dev:next
npm run dev:mastra
```

Build both apps:

```bash
npm run build:all
```

## Environment

Create a root `.env` file. Do not commit secrets or machine-specific credential files.

The current app expects Google Vertex AI configuration:

```env
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
GOOGLE_VERTEX_PROJECT=your-gcp-project-id
GOOGLE_VERTEX_LOCATION=your-vertex-location
```

The backend agent currently imports `vertex` from `@ai-sdk/google-vertex` and uses `vertex('gemini-2.5-flash')`.

## Data Storage

Local app data lives under `src/backend/data`.

Important data areas:

- `src/backend/data/journal`: daily journal JSON files.
- `src/backend/data/tasks`: General backlogs, Current queue membership, dated Today snapshots, legacy compatibility data, and completion state.
- `src/backend/data/jobs`: job listing data, when present.

The app is designed around local JSON persistence. Treat this directory as important personal data and back it up before migrations or large edits.

## Useful Commands

```bash
# Start Next.js and Mastra together
npm run dev

# Start only the frontend
npm run dev:next

# Start only the backend
npm run dev:mastra

# Build frontend and backend
npm run build:all

# Build only Mastra
npm run build:mastra

# Run production Next.js and generated Mastra output together
npm run start:production

# Check Pi/Tailscale access and service health
npm run status:local-access

# Rebuild and restart production on the Pi
npm run deploy:production
```

## Raspberry Pi / Tailscale Operations

Use Tailscale as the default access path from your MacBook for both apps:

- Agentic Journal (`:3000`)
- OpenClaw Web UI (`:18789`)

### One-Time HTTPS Setup

If your tailnet has Serve disabled, enable it once:

```bash
https://login.tailscale.com/f/serve
```

Then on the Raspberry Pi run:

```bash
npm run setup:tailscale-https
```

This configures:

- `https://<pi-magicdns>` -> `http://127.0.0.1:3000` (Agentic Journal)
- `https://<pi-magicdns>:18443` -> `http://127.0.0.1:18789` (OpenClaw)

### Default URLs From MacBook

```bash
https://rpi5.taile85e97.ts.net
https://rpi5.taile85e97.ts.net:18443
```

### Quick Verification On The Pi

```bash
npm run status:local-access
```

This checks:

- `tailscaled` system service
- `agentic-journal` system service
- `openclaw-gateway` user service
- Local Agentic Journal endpoint probes for Next, jobs, Mastra, and the `/mastra` proxy
- Tailnet identity and `tailscale serve` route status

### Production Rebuild And Restart

If the app fails after a reboot, rebuild the ignored production artifacts and restart both services:

```bash
npm run deploy:production
```

This performs a clean Next.js build, a clean Mastra build, installs Mastra's generated production dependencies, restarts `agentic-journal`, and probes the local endpoints.

### Development Mode Over The Same Tailscale URL

For normal everyday usage, the Pi runs the production service. When actively editing the app, switch the same Tailscale URL to hot-reloading dev mode:

```bash
npm run journal:dev
```

Then open or refresh:

```bash
https://rpi5.taile85e97.ts.net
```

Switch back to production:

```bash
npm run journal:prod
```

Useful checks:

```bash
npm run journal:status
npm run journal:logs
```

Dev mode starts `agentic-journal-dev.service`, which runs `npm run dev` on `127.0.0.1:3000` with Mastra on `127.0.0.1:4111`. Production remains the boot default because only `agentic-journal.service` is enabled; `agentic-journal-dev.service` is intentionally disabled.

## Troubleshooting

### Tailscale Fallbacks

If HTTPS routes are unavailable:

```bash
# Agentic Journal over tailnet HTTP
http://rpi5.taile85e97.ts.net:3000

# OpenClaw via SSH tunnel
ssh -N -L 18789:127.0.0.1:18789 rpi5
```

### OpenClaw Auth And Pairing

If OpenClaw over Tailscale shows:

- `disconnected (1008): unauthorized: gateway token missing`
- then `pairing required`

Use this flow:

1. Confirm gateway token from the Pi service config:

```bash
systemctl --user cat openclaw-gateway | rg OPENCLAW_GATEWAY_TOKEN
```

2. In the OpenClaw Control UI opened at `https://rpi5.taile85e97.ts.net:18443`, paste that token in **Control UI settings**.
3. If pairing is still required, approve from terminal on the Pi:

```bash
# show paired/pending device state
node /home/rpi5/projects/openclaw/dist/index.js devices list

# approve pending request, if any
node /home/rpi5/projects/openclaw/dist/index.js devices approve
```

4. Refresh the browser tab.

Notes:

- Pairing is origin-based, so `https://rpi5...:18443` is treated as a new device even if `http://127.0.0.1:18789` already worked.
- The current gateway service uses `OPENCLAW_GATEWAY_TOKEN=dev` unless you rotate it.

## Tech Stack

- [Next.js](https://nextjs.org/docs)
- [React](https://react.dev/)
- [Cedar-OS](https://docs.cedarcopilot.com/)
- [Mastra](https://mastra.ai/docs)
- [Google Vertex AI](https://cloud.google.com/vertex-ai)
- [Tailwind CSS](https://tailwindcss.com/)
- [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)
