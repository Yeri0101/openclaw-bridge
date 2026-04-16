# 🌉 openclaw-bridge

A local bridge that lets AI agents talk to Gemini, ChatGPT, Qwen, Arena (Claude), and Sora — **without any API keys**. It works by routing requests through your Chrome browser, where you're already logged in.

The bridge exposes an OpenAI-compatible HTTP API on `localhost:8000`, so any agent or tool that speaks the OpenAI format just works — no changes needed on their end.

---

## How it works

```
Agent → POST :8000/v1/chat/completions → Bridge Server → WebSocket :8765 → Chrome Extension → LLM Web UI → back
```

The Python server receives requests, forwards them to the Chrome extension via WebSocket, the extension injects the prompt into the actual LLM web interface, waits for the response, and sends it back. Your browser session handles authentication — no API keys, no billing surprises.

---

## Requirements

- Python 3.10+
- Google Chrome
- The extension loaded in Chrome (unpacked, developer mode)

---

## Setup

**1. Clone the repo**

```bash
git clone https://github.com/Yeri0101/openclaw-bridge.git
cd openclaw-bridge
```

**2. Install Python dependencies**

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**3. Load the Chrome extension**

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `extension/` folder from this repo
5. The extension icon should appear in your toolbar

**4. Start the bridge server**

```bash
bash server/start-bridge.sh
```

Or manually:
```bash
source server/venv/bin/activate
python3 server/bridge_server.py
```

Once it says `Waiting for Chrome extension connection...`, click the extension icon in Chrome. The badge should turn green — you're live.

---

## Supported Models

| Model ID | Platform | Notes |
|----------|----------|-------|
| `web/auto` | Arena | Default — routes to Claude Opus 4.6 |
| `web/claude` | Arena | Claude Opus 4.6 |
| `web/claude-think` | Arena | Claude Opus 4.6 with extended thinking |
| `web/gemini` | Gemini | Gemini 3.1 Flash |
| `web/gemini-pro` | Gemini | Gemini 3 Pro |
| `web/gemini-think` | Gemini | Gemini 3 Thinking |
| `web/qwen` | Qwen | Qwen Plus |
| `gemini-web` | Gemini | Direct alias |
| `chatgpt-web` | ChatGPT | Direct alias |
| `qwen-web` | Qwen | Direct alias |
| `sora` | Sora | Video generation |

You can also use dynamic names like `arena-gpt-4o`, `gemini-2.5-pro`, `qwen-max`, etc.

Full list: `GET http://localhost:8000/v1/models`

---

## Usage Examples

### Basic request — Gemini

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "web/gemini",
    "messages": [{"role": "user", "content": "Explain black holes in two sentences."}]
  }'
```

### Using Claude via Arena

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "web/claude",
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "What is the difference between TCP and UDP?"}
    ]
  }'
```

### Claude with extended thinking

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "web/claude-think",
    "messages": [{"role": "user", "content": "Solve: if a snail climbs 3m up a 10m wall each day and slides 2m back each night, how many days to reach the top?"}]
  }'
```

### Async mode — fire and poll

For slow models (or long prompts), use async mode so you don't block waiting:

```bash
# 1. Submit the request
curl -X POST "http://localhost:8000/v1/chat/completions?async_mode=true" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "web/gemini-think",
    "messages": [{"role": "user", "content": "Write a detailed analysis of the CAP theorem."}]
  }'
# Returns: { "request_id": "abc-123", "status": "generating", "poll_url": "..." }

# 2. Poll for progress
curl http://localhost:8000/v1/requests/abc-123/status
# Returns: { "status": "generating", "content": "...partial text so far...", "chars_so_far": 412 }

# 3. When status = "done", content has the full response
```

### Using with the OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="no-key-needed",  # required by the SDK but ignored by the bridge
)

response = client.chat.completions.create(
    model="web/claude",
    messages=[{"role": "user", "content": "Write a haiku about distributed systems."}]
)

print(response.choices[0].message.content)
```

### Connect to OpenClaw Gateway

Add this to your OpenClaw gateway config:

```json
{
  "id": "gateway-chrome-bridge",
  "name": "Local Chrome Bridge",
  "baseUrl": "http://localhost:8000/v1",
  "apiKey": "no-key-needed",
  "models": ["web/auto", "web/claude", "web/gemini", "web/qwen"]
}
```

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Main chat endpoint (OpenAI-compatible) |
| `/v1/chat/completions?async_mode=true` | POST | Async mode — returns immediately with a request ID |
| `/v1/requests/{id}/status` | GET | Poll progress of an async request |
| `/v1/models` | GET | List all available models |
| `/v1/incidents` | GET | Recent errors and failures |
| `/health` | GET | Bridge status + extension connection state |
| `/stats` | GET | Request metrics (latency, token counts, by model) |

### Health check

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "extension_connected": true,
  "pending_requests": 0,
  "active_platforms": ["arena", "gemini", "qwen", "sora"],
  "incidents_last_hour": 0,
  "uptime_seconds": 3142.5
}
```

---

## Configuration

All settings are via environment variables — no config files needed:

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_HTTP_PORT` | `8000` | HTTP API port |
| `BRIDGE_WS_PORT` | `8765` | WebSocket port for the Chrome extension |
| `BRIDGE_TIMEOUT` | `660` | Max seconds to wait for a response |
| `BRIDGE_MODEL_OVERRIDES` | — | JSON to remap model aliases at runtime |
| `BRIDGE_DATA_DIR` | `server/` | Where to write `incidents.json` |

Example — change the default model for `web/auto`:

```bash
BRIDGE_MODEL_OVERRIDES='{"web/auto": ["gemini", "pro"]}' bash server/start-bridge.sh
```

---

## Project Structure

```
openclaw-bridge/
├── server/
│   ├── bridge_server.py     # FastAPI + WebSocket server
│   ├── router.py            # Model name → (platform, variant) registry
│   ├── incidents.py         # Error logging (JSONL, git-ignored)
│   ├── requirements.txt     # Python dependencies
│   └── start-bridge.sh      # Startup script
└── extension/
    ├── manifest.json        # Chrome extension manifest (MV3)
    ├── service-worker.js    # Background WS connection + message routing
    ├── popup/               # Extension popup UI
    └── content-scripts/     # Per-platform DOM injection scripts
        ├── gemini.js
        ├── chatgpt.js
        ├── arena.js
        ├── qwen.js
        ├── sora.js
        ├── common.js
        ├── shadow-walker.js # Shadow DOM traversal utility
        └── blind-protocol.js# Human-like interaction simulation
```

---

## Notes

- The bridge only listens on `localhost` — it's not exposed to the network.
- You need an active browser session on each platform you want to use (just be logged in; the extension handles the rest).
- For Sora (video generation), requests can take several minutes. Use async mode.
- `incidents.json` is created at runtime in `server/` and is git-ignored.

---

## License

MIT — use it, fork it, build on it.
