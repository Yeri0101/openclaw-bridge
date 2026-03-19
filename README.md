# ZettaCore Chrome Bridge — Fase 1 ✅

Puente local que permite a los agentes OpenClaw usar Gemini, ChatGPT y Qwen como si fueran APIs OpenAI estándar, sin API key.

## Arquitectura

```
Agente → POST :8000/v1/chat/completions → Bridge Server → WS :8765 → Chrome Extension → LLM Web
```

## Instalación de la Extensión

1. Abre Chrome → `chrome://extensions/`
2. Activa **"Modo desarrollador"** (toggle arriba a la derecha)
3. Clic en **"Cargar extensión descomprimida"**
4. Selecciona la carpeta: `chrome-bridge/extension/`
5. Anota el **Extension ID** que aparece

## Arrancar el Servidor

```bash
cd chrome-bridge/server
bash start-bridge.sh
```

O manualmente:
```bash
source venv/bin/activate
python3 bridge_server.py
```

## Test Rápido E2E

1. Abre `gemini.google.com` en Chrome (con sesión activa)
2. Arranca el servidor
3. Envía una petición de prueba:

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-web",
    "messages": [{"role": "user", "content": "Saluda en una sola línea corta."}]
  }'
```

## Modelos Disponibles

| Modelo | Plataforma |
|--------|-----------|
| `gemini-web` | gemini.google.com |
| `chatgpt-web` | chatgpt.com |
| `qwen-web` | chat.qwenlm.ai |

## Integrar con OpenClaw (Gateway)

Añadir en la configuración del Gateway de OpenClaw:
```json
{
  "id": "gateway-chrome-bridge",
  "name": "Local Chrome Bridge",
  "baseUrl": "http://localhost:8000/v1",
  "apiKey": "no-key-needed",
  "models": ["gemini-web", "chatgpt-web", "qwen-web"]
}
```

## Health Check

```bash
curl http://localhost:8000/health
```
