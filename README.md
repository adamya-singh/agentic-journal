# Cedar-OS + Mastra Starter Template

A blank starter template combining [Cedar-OS](https://cedar.ai) for the frontend AI interface and [Mastra](https://mastra.ai) for the backend agent orchestration.

## Features

- **🤖 AI Chat Integration**: Built-in chat workflows powered by OpenAI through Mastra agents
- **⚡ Real-time Streaming**: Server-sent events (SSE) for streaming AI responses
- **🎨 Beautiful UI**: Cedar-OS components with 3D effects and modern design
- **🔧 Type-safe Workflows**: Mastra-based backend with full TypeScript support
- **📡 Dual API Modes**: Both streaming and non-streaming chat endpoints

## Quick Start

The fastest way to get started:

```bash
npx cedar-os-cli plant-seed
```

Then select this template when prompted. This will set up the entire project structure and dependencies automatically.

This template contains the Cedar chat connected to a mastra backend to demonstrate what endpoints need to be implemented.

For more details, see the [Cedar Getting Started Guide](https://docs.cedarcopilot.com/getting-started/getting-started).

## Manual Setup

### Prerequisites

- Node.js 18+
- OpenAI API key
- pnpm (recommended) or npm

### Installation

1. **Clone and install dependencies:**

```bash
git clone <repository-url>
cd cedar-mastra-starter
pnpm install && cd src/backend && pnpm install && cd ../..
```

2. **Set up environment variables:**
   Create a `.env` file in the root directory:

```env
OPENAI_API_KEY=your-openai-api-key-here
```

3. **Start the development servers:**

```bash
npm run dev
```

This runs both the Next.js frontend and Mastra backend concurrently:

- Frontend: http://localhost:3000
- Backend API: http://localhost:4111

## Project Architecture

### Frontend (Next.js + Cedar-OS)

- **Simple Chat UI**: See Cedar OS components in action in a pre-configured chat interface
- **Cedar-OS Components**: Cedar-OS Components installed in shadcn style for local changes
- **Tailwind CSS, Typescript, NextJS**: Patterns you're used to in any NextJS project

### Backend (Mastra)

- **Chat Workflow**: Example of a Mastra workflow – a chained sequence of tasks including LLM calls
- **Streaming Utils**: Examples of streaming text, status updates, and objects like tool calls
- **API Routes**: Examples of registering endpoint handlers for interacting with the backend

## API Endpoints (Mastra backend)

### Non-streaming Chat

```bash
POST /chat/execute-function
Content-Type: application/json

{
  "prompt": "Hello, how can you help me?",
  "temperature": 0.7,
  "maxTokens": 1000,
  "systemPrompt": "You are a helpful assistant."
}
```

### Streaming Chat

```bash
POST /chat/execute-function/stream
Content-Type: application/json

{
  "prompt": "Tell me a story",
  "temperature": 0.7
}
```

Returns Server-Sent Events with:

- **JSON Objects**: `{ type: 'stage_update', status: 'update_begin', message: 'Generating response...'}`
- **Text Chunks**: Streamed AI response text
- **Completion**: `event: done` signal

## Development

### Running the Project

```bash
# Start both frontend and backend
npm run dev

# Run frontend only
npm run dev:next

# Run backend only
npm run dev:mastra
```

## Local Raspberry Pi Access (Tailscale HTTPS)

Use Tailscale as the default access path from your MacBook for both apps:
- Agentic Journal (`:3000`)
- OpenClaw Web UI (`:18789`)

### One-time setup

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

### Default URLs (from MacBook on Tailscale)

```bash
https://rpi5.taile85e97.ts.net
https://rpi5.taile85e97.ts.net:18443
```

### Quick verification on the Raspberry Pi

```bash
npm run status:local-access
```

This checks:
- `tailscaled` system service
- `agentic-journal` system service
- `openclaw-gateway` user service
- Tailnet identity and `tailscale serve` route status

### Fallbacks

If HTTPS routes are unavailable:

```bash
# Agentic Journal over tailnet HTTP
http://rpi5.taile85e97.ts.net:3000

# OpenClaw via SSH tunnel
ssh -N -L 18789:127.0.0.1:18789 rpi5
```

### OpenClaw auth and pairing troubleshooting

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

# approve pending request (if any)
node /home/rpi5/projects/openclaw/dist/index.js devices approve
```

4. Refresh the browser tab.

Notes:
- Pairing is origin-based, so `https://rpi5...:18443` is treated as a new device even if `http://127.0.0.1:18789` already worked.
- The current gateway service uses `OPENCLAW_GATEWAY_TOKEN=dev` unless you rotate it.

## Learn More

- [Cedar-OS Documentation](https://docs.cedarcopilot.com/)
- [Mastra Documentation](https://mastra.ai/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## License

MIT License - see LICENSE file for details.
