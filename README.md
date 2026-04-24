<div align="center">

# TierMax — free-llm-gateway

**A self-hosted AI API gateway with smart routing, automatic failover, round-robin load balancing, semantic caching, and a real-time web dashboard.**

[![Version](https://img.shields.io/badge/version-2.1-orange?style=flat-square)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20React%20%7C%20Supabase-blueviolet?style=flat-square)](#tech-stack)

</div>

---

## What is TierMax?

TierMax is a reverse proxy you self-host that sits between your AI applications and the LLM providers you use — Google Gemini, Groq, OpenRouter, Cerebras, Mistral, and others.

Instead of hardcoding a single API key per provider and hoping it doesn't rate-limit, TierMax manages a **pool of upstream keys**, routes requests intelligently based on cost and complexity (via the built-in SOAT router), retries failed providers automatically, and caches duplicate responses so you don't waste tokens.

It exposes an **OpenAI-compatible API** at `/v1/chat/completions`, so anything that already works with OpenAI works with TierMax — no code changes on the client side.

---

## How it works

```
Your Agent / App
      │
      │  POST /v1/chat/completions
      │  Authorization: Bearer gk_xxxxx
      ▼
┌──────────────────────────────────────────┐
│              TierMax Gateway             │
│                                          │
│  1. Verify gateway key (Supabase DB)     │
│  2. Check semantic cache (SHA-256 LRU)   │
│  3. Classify request tier (SOAT)         │
│  4. Select best upstream provider        │
│  5. Forward request with upstream key    │
│  6. On failure → retry next provider     │
│  7. Cache response + log request         │
└────────────────┬─────────────────────────┘
                 │
       ┌─────────┼──────────┐
       ▼         ▼          ▼
   Google      Groq     OpenRouter
   Gemini    Cerebras    Mistral ...
```

---

## Features

| Feature | Description |
|---|---|
| **OpenAI-compatible API** | Drop-in replacement — no client changes needed |
| **Multi-key round-robin** | Distributes load across multiple API keys per provider |
| **Automatic failover** | If a provider errors or rate-limits, the next one is tried instantly |
| **SOAT Smart Router** | Classifies each request as Economy / Standard / Premium and routes accordingly |
| **Semantic cache** | SHA-256 keyed in-memory LRU cache — identical prompts served instantly at zero cost |
| **Context trimming** | Trims message history to fit provider limits without breaking the conversation |
| **Latency guard** | Skips providers with historically high latency for time-sensitive requests |
| **Brave Search proxy** | Routes web search requests through a pool of Brave API keys |
| **Analytics** | Every request logged — model, tokens, provider, latency, status |
| **Admin dashboard (TierMax UI)** | React web app to manage providers, gateway keys, usage stats, and analytics |
| **Batch jobs** | Submit async batch requests processed by a dedicated worker |
| **Copy key from dashboard** | Gateway keys can be copied directly from the project cards |

---

## Architecture overview

```
free-llm-gateway/
│
├── backend/            # Hono (Node.js) API server
│   ├── src/
│   │   ├── routes/
│   │   │   ├── v1.ts           ← /v1/chat/completions (SOAT routing, cache, failover)
│   │   │   ├── projects.ts     ← Project CRUD
│   │   │   ├── gatewayKeys.ts  ← Gateway key management + /reveal endpoint
│   │   │   ├── upstreamKeys.ts ← Upstream provider key management
│   │   │   ├── analytics.ts    ← Request log queries
│   │   │   ├── batch.ts        ← Batch job submission
│   │   │   └── pricing.ts      ← Token cost estimates
│   │   ├── middleware/
│   │   │   └── auth.ts         ← JWT authentication middleware
│   │   ├── tierConfig.ts       ← SOAT tier → provider mapping
│   │   └── db.ts               ← Supabase client
│   └── .env.example
│
├── frontend/           # React + Vite admin dashboard (TierMax UI v2.1)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx   ← Project list + quick copy API key
│   │   │   ├── ProjectDetail.tsx ← Upstream keys, gateway keys, analytics
│   │   │   └── Login.tsx
│   │   ├── App.tsx             ← Auth shell + navbar
│   │   ├── i18n.tsx            ← EN/ES translations
│   │   └── index.css           ← Design system (orange/dark theme)
│   └── .env.example
│
├── batch-worker/       # Background worker for async batch jobs
├── docs/               # Internal technical docs
├── ecosystem.config.js # PM2 process definition
└── README.md
```

---

## Requirements

- **Node.js** v18+ (v20 recommended)
- **npm** v9+
- A free **[Supabase](https://supabase.com)** account (used as the database)
- API keys for at least one LLM provider (Google AI Studio, Groq, OpenRouter, etc.)
- **PM2** (optional, for running as a background service)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Yeri0101/free-llm-gateway.git
cd free-llm-gateway
```

### 2. Create the Supabase database

Log in to [supabase.com](https://supabase.com), create a new project, then go to **SQL Editor** and run the following:

```sql
-- Admins: dashboard login accounts
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert your admin user (change username/password before using in production)
INSERT INTO admins (username, password) VALUES ('admin', 'changeme');

-- Projects: logical groupings for keys and analytics
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upstream keys: your real API keys for each LLM provider
CREATE TABLE upstream_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  label TEXT,
  status TEXT DEFAULT 'healthy',
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gateway keys: what your clients/agents use to authenticate
CREATE TABLE gateway_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  key_name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gateway key models: which models/upstreams each gateway key can access
CREATE TABLE gateway_key_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_key_id UUID REFERENCES gateway_keys(id) ON DELETE CASCADE,
  upstream_key_id UUID REFERENCES upstream_keys(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Request logs: analytics per request
CREATE TABLE request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  gateway_key_id UUID,
  upstream_key_id UUID,
  model TEXT,
  provider TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  status INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch jobs: async processing queue
CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  gateway_key_id UUID,
  status TEXT DEFAULT 'pending',
  payload JSONB,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

> ⚠️ The admin password is stored as plain text in this setup. For production use, migrate to bcrypt hashing.

### 3. Configure the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=3000
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
ADMIN_JWT_SECRET=change-this-to-a-long-random-string

# Optional — key used for bypass of tier limits on premium requests
SOAT_PREMIUM_BYPASS_KEY=gk_your_premium_gateway_key

# Optional tuning
CACHE_TTL_SECONDS=60
CACHE_MAX_SIZE=500
TIER_CONFIG_JSON={"economy":["groq","cerebras"],"standard":["openrouter","puter"],"premium":["openai","google"]}
```

Find your `SUPABASE_URL` and `SUPABASE_ANON_KEY` in your Supabase dashboard under **Project Settings → API**.

> ❌ Never commit your `.env` file. It is already in `.gitignore`.

### 4. Start the backend

```bash
cd backend
npm run dev
```

Verify it's running:

```bash
curl http://localhost:3000/
# → {"message":"TierMax Gateway Running"}
```

### 5. Configure and start the frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000/api
```

```bash
npm run dev
# → Dashboard at http://localhost:5173
```

Log in with the credentials you inserted in Step 2 (`admin` / `changeme` by default).

### 6. Add your first provider key

From the TierMax dashboard:

1. Click **Create New Project** (e.g. `"My Project"`)
2. Open the project → go to **Upstream Keys** tab → click **Add Key**
3. Select a provider (e.g. `google`) and paste your API key
4. Go to **Gateway Keys** tab → click **Create Gateway Key**
5. Your new gateway key is shown — copy it from the project card (📋 button) or from inside the project

---

## Running as a background service (PM2)

For production use, run all processes with PM2 so they survive reboots:

```bash
# Install PM2 globally (only once)
npm install -g pm2

# Start all services using the included config
pm2 start ecosystem.config.js

# Save the process list so it auto-restarts on reboot
pm2 save
pm2 startup
```

The `ecosystem.config.js` includes:

| PM2 name | Directory | What it does |
|---|---|---|
| `openclaw-backend` | `backend/` | Main API server (port 3000) |
| `openclaw-frontend` | `frontend/` | Admin dashboard (port 5173) |
| `openclaw-batch-worker` | `batch-worker/` | Async batch job processor |

Useful PM2 commands:

```bash
pm2 list                    # Show all running processes
pm2 logs openclaw-backend   # Tail backend logs
pm2 restart openclaw-backend
pm2 stop all
pm2 delete all
```

---

## Usage

### Making a request directly

Once you have a gateway key:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer gk_your_gateway_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [{"role": "user", "content": "Explain what a gateway is in one sentence."}]
  }'
```

### Using with the OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="gk_your_gateway_key"
)

response = client.chat.completions.create(
    model="gemini-2.0-flash",
    messages=[{"role": "user", "content": "Hello from TierMax!"}]
)

print(response.choices[0].message.content)
```

### Using with JavaScript / fetch

```javascript
const response = await fetch("http://localhost:3000/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer gk_your_gateway_key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "gemini-2.0-flash",
    messages: [{ role: "user", content: "Hello!" }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

---

## SOAT Smart Router

Every incoming request is automatically classified into one of three tiers based on prompt length, token count, and presence of tools. The router then selects the best available provider for that tier:

| Tier | When used | Default providers |
|---|---|---|
| **Economy** | Short prompts, no tools, < 200 tokens | Groq, Cerebras |
| **Standard** | Medium complexity, simple tool use | OpenRouter, Puter, Mistral |
| **Premium** | Large context, complex tasks, > 1500 tokens | OpenAI, Google |

If the preferred tier has no healthy providers, the router falls back to the next tier — requests never fail because a single provider is down.

You can override the tier → provider mapping at runtime:

```bash
TIER_CONFIG_JSON='{"economy":["cerebras"],"standard":["mistral"],"premium":["google"]}' npm run dev
```

---

## Admin Dashboard (TierMax UI v2.1)

Open `http://localhost:5173` after starting the frontend.

### What you can do from the dashboard

**Projects panel**
- Create and color-code projects to organize different apps or teams
- See each project's gateway keys directly on the card
- **📋 Copy any gateway key to clipboard** without entering the project — click the copy icon next to any key preview; it changes to ✅ for 3 seconds with a "Copied!" popup

**Inside a project**
- **Upstream Keys tab** — Add, view, enable/disable provider API keys (Gemini, Groq, OpenRouter, etc.)
- **Gateway Keys tab** — Issue gateway keys with specific model access; delete keys that are no longer needed
- **Analytics tab** — Request volume, token usage, latency histogram, error rates, recent request log

**Navbar**
- `EN / ES` language toggle
- Change admin password (without leaving the app)
- Version indicator: **TierMax v2.1**

---

## Use case: Running OpenClaw with TierMax

[OpenClaw](https://github.com/Yeri0101/openclaw-bridge) is a local AI agent system that runs tasks autonomously — writing code, browsing the web, managing files, orchestrating multi-agent debates. By default it needs a separate API key for every provider.

With **TierMax** as a centralized gateway:

```
OpenClaw agent
      │
      │  one gateway key · one endpoint
      ▼
TierMax  ←── pools all your API keys here
      │
      ├── Gemini 2.0 Flash  (Google — free tier)
      ├── Groq              (very fast, generous free tier)
      ├── Cerebras          (economy tasks)
      └── OpenRouter        (fallback for anything else)
```

**Why this setup makes sense:**

- OpenClaw sends many parallel requests — hitting rate limits with a single key is common. TierMax round-robins across your pool so no single key gets exhausted.
- You only configure one URL + one key in OpenClaw regardless of how many providers you add to the pool.
- The SOAT router automatically sends cheap tasks (summaries, quick responses) to free-tier providers like Groq, and reserves premium quota for complex reasoning or long contexts.
- If Google returns a 429 or goes down, TierMax retries the next healthy provider — OpenClaw never sees the error.
- Every request is logged in the dashboard so you can see exactly which provider handled what.

### Step-by-step setup

**1. Start TierMax** (using PM2, once):

```bash
pm2 start ecosystem.config.js
```

**2. In the TierMax dashboard** (`http://localhost:5173`):
- Create a project called `openclaw`
- Add your provider keys (Gemini, Groq, OpenRouter, etc.)
- Create a gateway key — copy it directly from the project card, e.g. `gk_abc123`

**3. Configure OpenClaw** to point to TierMax. In your OpenClaw agent config:

```json
{
  "agents": {
    "main": {
      "provider": "openai",
      "baseUrl": "http://localhost:3000/v1",
      "apiKey": "gk_abc123",
      "model": "gemini-2.0-flash"
    }
  }
}
```

From this point, every request OpenClaw makes goes through TierMax. You get automatic failover, smart tier routing, and a full log of every call in the dashboard — without touching the OpenClaw config again.

---

## Environment variables reference

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port the backend server listens on |
| `SUPABASE_URL` | ✅ | — | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | — | Supabase anon key (Project Settings → API) |
| `ADMIN_JWT_SECRET` | ✅ | — | Secret used to sign admin JWT tokens |
| `SOAT_PREMIUM_BYPASS_KEY` | No | — | A gateway key that bypasses tier limits for premium requests |
| `CACHE_TTL_SECONDS` | No | `60` | Seconds to cache identical responses in memory |
| `CACHE_MAX_SIZE` | No | `500` | Max number of entries in the LRU cache |
| `TIER_CONFIG_JSON` | No | *(see tierConfig.ts)* | JSON override for tier → provider mapping |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `VITE_API_URL` | ✅ | — | Full URL to the backend API (e.g. `http://localhost:3000/api`) |

---

## API reference

### `POST /v1/chat/completions`

OpenAI-compatible completions endpoint.

**Headers:**
```
Authorization: Bearer gk_your_gateway_key
Content-Type: application/json
```

**Body:**
```json
{
  "model": "gemini-2.0-flash",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is 2 + 2?" }
  ],
  "temperature": 0.7,
  "max_tokens": 512
}
```

**Response:** Standard OpenAI `ChatCompletion` object.

---

### `GET /api/projects`

Returns all projects with their gateway key previews and average latency.

**Headers:** `Authorization: Bearer <admin JWT>`

---

### `GET /api/analytics/:project_id`

Returns request logs, token totals, latency stats, and provider breakdown for a project.

---

### `GET /api/gateway-keys/:id/reveal`

Returns the full `api_key` value for a gateway key. Used internally by the dashboard copy button. Requires admin auth.

---

## Security notes

- **Upstream keys** are stored in Supabase, never exposed to clients.
- **Gateway keys** are what clients use — they only grant access to the models you configure per key.
- The `/reveal` endpoint is protected by the admin JWT middleware — only the logged-in dashboard can call it.
- The admin password is stored as plain text in this prototype. **Migrate to bcrypt before exposing externally.**
- The server binds to `localhost` by default. To expose externally, put nginx or Caddy in front as a reverse proxy with HTTPS.
- Add rate limiting to `/api/auth/*` before any public deployment.

---

## Changelog

### v2.1 (2026-04-24)
- **Rebrand:** App renamed from "OpenClaw Gateway" to **TierMax** across all UI surfaces (navbar, login, dashboard, i18n EN + ES)
- **Copy gateway key:** Added 📋 copy button on each gateway key in the project cards — no need to enter the project to copy the key
- **Copy feedback:** Icon switches to ✅ for 3 seconds, with a floating "Copied!" popup animation
- **Backend:** New protected `GET /gateway-keys/:id/reveal` endpoint used by the copy feature
- **Security:** Premium bypass key moved from hardcoded string to `process.env.SOAT_PREMIUM_BYPASS_KEY`

### v2.0
- SOAT Smart Router (Economy / Standard / Premium tier classification)
- Semantic cache (SHA-256 LRU)
- Full analytics dashboard
- Batch job worker
- Multi-language support (EN / ES)

---

## License

MIT — use it, fork it, build on it.

---

<div align="center">
  Built to run free — keep your providers flexible, your keys safe, and your agents fast.
</div>
