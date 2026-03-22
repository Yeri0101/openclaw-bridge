# ZettaCore Chrome Bridge — Manual de Uso

> Versión 1.2 · Actualizado 2026-03-21

El **ZettaCore Chrome Bridge** te permite usar LLMs web (Arena AI, Gemini, ChatGPT, Qwen) a través de una API compatible con OpenAI, sin necesitar API keys. Los agentes (Uchija, etc.) llaman a `http://localhost:8000/v1/chat/completions` exactamente como llamarían a OpenAI.

---

## Arquitectura en 30 segundos

```
Agente / curl
    ↓  POST /v1/chat/completions
Bridge Server (Python, puerto 8000)
    ↓  WebSocket (puerto 8765)
Service Worker (extensión Chrome)
    ↓  chrome.tabs.sendMessage / chrome.debugger (CDP)
Content Script (arena.js / gemini.js / ...)
    ↓  escribe y envía el prompt
Página web del LLM
    ↑  extrae la respuesta
    ↑  WebSocket → Bridge → Respuesta OpenAI-format
```

---

## Requisitos previos

| Requisito | Versión mínima |
|---|---|
| Python | 3.11+ |
| Google Chrome | 120+ |
| Cuenta activa en Arena AI / Gemini / ChatGPT | (sesión iniciada) |

---

## 1 · Instalación (primera vez)

```bash
cd /home/ken/.openclaw/workspace/chrome-bridge/server

# Crear entorno virtual
python3 -m venv venv

# Instalar dependencias
source venv/bin/activate
pip install -r requirements.txt
```

---

## 2 · Cargar la extensión en Chrome

1. Abre Chrome → `chrome://extensions`
2. Activa **Modo desarrollador** (esquina superior derecha)
3. Haz clic en **"Cargar descomprimida"**
4. Selecciona la carpeta: `/home/ken/.openclaw/workspace/chrome-bridge/extension`
5. Verifica que aparece el ícono de ZettaCore en la barra de herramientas con badge **ON** (verde)

> ⚠️ Chrome mostrará un banner "DevTools está depurando este navegador" cuando se use el clic CDP. Es normal — es el permiso `debugger` en acción.

---

## 3 · Iniciar el servidor bridge

```bash
cd /home/ken/.openclaw/workspace/chrome-bridge/server
bash start-bridge.sh
```

Verás:
```
╔══════════════════════════════════════════╗
║     ZettaCore Chrome Bridge v1.0         ║
╚══════════════════════════════════════════╝
🚀 Arrancando servidor...
   HTTP: http://localhost:8000
   WS:   ws://localhost:8765
```

Deja esta terminal abierta. Para correrlo en background con PM2:
```bash
pm2 start /home/ken/.openclaw/workspace/chrome-bridge/server/bridge_server.py \
  --name zettacore-bridge \
  --interpreter python3
```

---

## 4 · Conectar la extensión al servidor

1. Abre Chrome y navega a la plataforma que quieres usar:
   - **Arena AI** → `https://arena.ai/text/direct`
   - **Gemini** → `https://gemini.google.com/app`
   - **ChatGPT** → `https://chatgpt.com`
   - **Qwen** → `https://chat.qwenlm.ai`

2. Asegúrate de tener **sesión iniciada** en la plataforma

3. El badge de la extensión pasa a **ON** verde automáticamente en ~3 segundos

4. Verifica la conexión:
   ```bash
   curl http://localhost:8000/health
   # → {"status":"ok","extension_connected":true,...}
   ```

---

## 5 · Enviar peticiones

### Formato estándar (igual que OpenAI)

```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "arena-claude-opus-4-6",
    "messages": [{"role": "user", "content": "Explica qué es la fotosíntesis"}]
  }'
```

### Modelos disponibles

| Modelo | Plataforma | Notas |
|---|---|---|
| `arena-claude-opus-4-6` | Arena AI | Requiere tab de Arena abierto |
| `arena-gpt-4o` | Arena AI | Selecciona GPT-4o en Arena |
| `arena-claude-sonnet-4-5-20250929` | Arena AI | Claude Sonnet en Arena |
| `gemini-web` | Gemini | Modo Fast (por defecto) |
| `gemini-pro-web` | Gemini | Modo Pro |
| `gemini-thinking-web` | Gemini | Modo Reasoning |
| `chatgpt-web` | ChatGPT | GPT-4o por defecto |
| `qwen-web` | Qwen | Qwen2.5 por defecto |

> Para los modelos de Arena, el prefijo `arena-` va seguido del nombre del modelo tal como aparece en el dropdown de Arena. Ejemplo: `arena-claude-opus-4-6`.

### Ver todos los modelos disponibles
```bash
curl http://localhost:8000/v1/models
```

---

## 6 · Integración con el Gateway (OpenClaw)

El bridge está registrado en el gateway como provider `zettacore`. Para usarlo:

1. **En el dashboard** (Mission Control → tu proyecto → Providers):
   - Añade un nuevo provider → selecciona **ZettaCore (Chrome Bridge)**
   - API Key: es ignorada (puedes poner cualquier valor, ej: `local`)

2. **Crear Gateway Key** con los modelos de Arena/Gemini que quieras exponer

3. **Enviar al gateway** (tu API key personalizada):
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Authorization: Bearer TU_GATEWAY_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"arena-claude-opus-4-6","messages":[{"role":"user","content":"Hola"}]}'
   ```

---

## 7 · Cómo funciona el clic CDP (selección de modelo)

Cuando pides un modelo específico (ej: `arena-claude-opus-4-6`), el adapter detecta si el modelo activo en la UI es diferente y lo cambia automáticamente usando **Chrome Debugger Protocol (CDP)**:

1. El content script calcula las coordenadas del botón en pantalla
2. Envía `{ action: 'cdp_click', x, y }` al service-worker
3. El service-worker adjunta el debugger CDP al tab
4. Dispara `Input.dispatchMouseEvent` (move → press → release) — eventos reales del browser
5. Desadjunta el debugger
6. React/Radix recibe el evento como nativo (`isTrusted: true`) y responde correctamente

Si CDP falla por cualquier razón, el sistema hace **fallback automático** a `humanClick()` (simulación DOM).

---

## 8 · Diagnosticar problemas

### La extensión no se conecta (badge rojo `ERR`)
```bash
# Verificar que el servidor está corriendo
curl http://localhost:8000/health

# Si no responde, lanzar el servidor
bash /home/ken/.openclaw/workspace/chrome-bridge/server/start-bridge.sh
```

### El tab de Arena no responde al prompt
1. Abre la consola de Chrome (`F12`) en el tab de Arena
2. Busca logs de `[ZettaCore]` — indican el estado del adapter
3. Si no hay logs: recarga la extensión en `chrome://extensions` y refresca el tab

### CDP falla con "attach failed"
- Causa más común: DevTools está abierto en ese tab. Cierra DevTools y reintenta.
- O bien: otra herramienta de automatización tiene el debugger ocupado.

### El modelo no cambia aunque se pide uno diferente
- El nombre del modelo debe coincidir (normalizado) con el texto del dropdown de Arena
- Comprueba en consola: `[ZettaCore][arena] 🎯 Modelo "X" encontrado` o `⚠️ no encontrado`
- Abre `https://arena.ai/text/direct` manualmente y verifica el nombre exacto en el picker

### Logs útiles
```bash
# Ver logs del servidor bridge
tail -f /proc/$(pgrep -f bridge_server)/fd/1   # si está en background

# Si usas PM2
pm2 logs zettacore-bridge
```

---

## 9 · Estructura de archivos

```
chrome-bridge/
├── MANUAL.md                        ← este archivo
├── extension/
│   ├── manifest.json                ← permisos MV3 (incluye "debugger")
│   ├── service-worker.js            ← gestiona WS + ejecuta clics CDP
│   ├── popup/                       ← UI del toggle ON/OFF
│   └── content-scripts/
│       ├── shadow-walker.js         ← queries en Shadow DOM
│       ├── blind-protocol.js        ← humanType + cdpClick + humanClick
│       ├── common.js                ← clase base LLMAdapter
│       ├── arena.js                 ← adaptador Arena AI
│       ├── gemini.js                ← adaptador Gemini
│       ├── chatgpt.js               ← adaptador ChatGPT
│       ├── qwen.js                  ← adaptador Qwen
│       └── sora.js                  ← adaptador Sora (legacy)
└── server/
    ├── bridge_server.py             ← servidor FastAPI + WebSocket
    ├── start-bridge.sh              ← script de arranque
    ├── requirements.txt             ← dependencias Python
    └── venv/                        ← entorno virtual Python
```

---

## 10 · Añadir soporte para una nueva plataforma

1. Crear `extension/content-scripts/nueva.js` extendiendo `LLMAdapter`
2. Implementar `isGenerationComplete()` y `extractResponse()`
3. Añadir en `manifest.json`: entry en `content_scripts` con el dominio
4. Añadir en `service-worker.js`: entrada en `platformDomains` y `platformUrls`
5. Añadir en `bridge_server.py`: entrada en `MODEL_PLATFORM_MAP`

---

*ZettaCore Bridge — parte del ecosistema OpenClaw*
