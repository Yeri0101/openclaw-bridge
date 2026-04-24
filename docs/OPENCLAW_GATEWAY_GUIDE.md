# OpenClaw Gateway — Guía Completa de A a Z

> **Versión:** 2026.2.x · **Última actualización:** 2026-03-05  
> Esta guía explica cómo funciona OpenClaw Gateway internamente, cómo configurarlo y cómo sacarle el máximo provecho.

---

## Índice

1. [¿Qué es OpenClaw Gateway?](#1-qué-es-openclaw-gateway)
2. [Arquitectura general](#2-arquitectura-general)
3. [Flujo de una petición de A a Z](#3-flujo-de-una-petición-de-a-a-z)
4. [Componentes del backend](#4-componentes-del-backend)
5. [Componentes del frontend](#5-componentes-del-frontend)
6. [Base de datos (Supabase)](#6-base-de-datos-supabase)
7. [Sistema SOAT](#7-sistema-soat)
8. [Gestión de proveedores y fallback](#8-gestión-de-proveedores-y-fallback)
9. [Configuración de OpenClaw CLI](#9-configuración-de-openclaw-cli)
10. [Casos de uso prácticos](#10-casos-de-uso-prácticos)
11. [Troubleshooting](#11-troubleshooting)
12. [Variables de entorno y seguridad](#12-variables-de-entorno-y-seguridad)

---

## 1. ¿Qué es OpenClaw Gateway?

OpenClaw Gateway es un **proxy inteligente de APIs de IA** que actúa como intermediario entre el agente OpenClaw y múltiples proveedores de LLM (Google Gemini, Groq, Cerebras, OpenRouter, Puter, Kie, etc.).

### Funciones principales

| Función | Descripción |
|---------|-------------|
| **Load balancing** | Distribuye las peticiones entre múltiples API keys del mismo proveedor |
| **Fallback automático** | Si un proveedor falla o alcanza su límite, pasa al siguiente |
| **Rate limiting** | Registra y controla el uso de cada API key |
| **Normalización** | Adapta el formato de petición a cada proveedor (Google, Cerebras, etc.) |
| **Caché semántica** | Evita peticiones duplicadas cacheando respuestas similares |
| **Smart routing** | Enruta según el tipo de solicitud (texto, código, herramientas) |
| **Context trimming** | Recorta el historial de mensajes si supera el límite del proveedor |
| **Analytics** | Registra cada petición para análisis y monitoreo |
| **Brave Search proxy** | Proxy para búsquedas web con múltiples API keys |

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│                      OPENCLAW AGENT (CLI)                        │
│              Configurado en ~/.openclaw/openclaw.json            │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP POST /v1/chat/completions
                          │ Authorization: Bearer gk_xxxxx
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OPENCLAW GATEWAY (Node.js + Hono)              │
│                      localhost:3000                              │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Auth MW    │  │ SOAT Engines │  │    Route Handlers      │ │
│  │ (gk_ keys)  │  │ Smart Router │  │  /v1/chat/completions  │ │
│  │             │  │ Semantic Cache│  │  /api/providers        │ │
│  │             │  │ Latency Guard │  │  /api/gateway-keys     │ │
│  │             │  │ Limit Tracker │  │  /api/analytics        │ │
│  │             │  │ Context Trim │  │  /api/brave/search     │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              FALLBACK CHAIN (loop)                          ││
│  │  1° Proveedor → error → 2° → error → 3° → respuesta OK     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────┬──────────────┬───────────────┬────────────────────────┘
          │              │               │
          ▼              ▼               ▼
    ┌──────────┐  ┌──────────┐   ┌──────────────┐
    │  Google  │  │  Groq    │   │  OpenRouter  │
    │  Gemini  │  │  Kimi K2 │   │  MiniMax     │
    │  Flash   │  │  Llama   │   │  + otros     │
    └──────────┘  └──────────┘   └──────────────┘
          │
          ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ Cerebras │   │  Puter   │   │   Kie    │
    │ GPT-OSS  │   │  (free)  │   │ (proxy)  │
    └──────────┘   └──────────┘   └──────────┘
```

### Stack tecnológico

- **Backend:** Node.js + [Hono](https://hono.dev) (ultra-rápido, compatible con Web Standards)
- **Frontend:** React + Vite + TypeScript
- **Base de datos:** Supabase (PostgreSQL)
- **Proceso manager:** PM2
- **Build system:** esbuild (backend), Vite (frontend)

---

## 3. Flujo de una petición de A a Z

### Paso a paso detallado

```
USUARIO/AGENTE envía:
POST http://localhost:3000/v1/chat/completions
Authorization: Bearer gk_abc123...
Content-Type: application/json
Body: { model: "gemini-3-flash-preview", messages: [...], stream: true }
```

**→ PASO 1: Autenticación** (`authMiddleware.ts`)
- El gateway verifica que la `gk_` key existe en la tabla `gateway_keys` de Supabase
- Si la key es inválida → 401 Unauthorized
- Si es válida → extrae `project_id` y modelos permitidos

**→ PASO 2: Validación del modelo**
- Verifica que el modelo solicitado está en la lista de `gateway_key_models`
- Si el modelo no está permitido → 403

**→ PASO 3: Smart Router** (`smartRouter.ts`)
- Analiza el tipo de petición: ¿tiene `tools`? ¿es código? ¿es texto simple?
- Clasifica en tiers: `tier1` (mejor), `tier2` (medio), `tier3` (básico)
- Filtra candidatos de upstream keys compatibles

**→ PASO 4: Caché semántica** (`semanticCache.ts`)
- Genera un hash del prompt
- Si hay una respuesta cacheada y válida → devuelve directamente (latencia ~0ms)
- Si no hay caché → continúa

**→ PASO 5: Selección de upstream key**
- Busca todas las upstream keys del proyecto para ese proveedor
- Filtra las que están `paused` o `rate_limited` sin recuperarse
- Selecciona la que tiene menor uso en el minuto actual (round-robin ponderado)

**→ PASO 6: Latency Guard** (`latencyGuard.ts`)
- Si un proveedor tiene historial de ser lento (>15s últimas peticiones) → lo salta
- Previene que el fallback espere demasiado en proveedores lentos
- Timeout de abort configurado en `LATENCY_ABORT_TIMEOUT_MS`

**→ PASO 7: Context Trim Guard** (`v1.ts`)
- Si la upstream key tiene `max_context_tokens` configurado en la DB:
  - Estima los tokens del historial de mensajes (1 token ≈ 4 chars)
  - Si supera el límite → elimina los mensajes más antiguos (preservando system prompt y último user message)
  - Previene errores 413 en proveedores con contexto limitado (ej: Groq free = 10K TPM)

**→ PASO 8: Normalización por proveedor**
Dependiendo del proveedor seleccionado:
- **Google/Kie-Gemini:** elimina `max_completion_tokens`, mapea a `max_tokens`, mueve `system` al primer mensaje, convierte `tool_calls` al formato de Google, elimina `store` y `stream_options`
- **Cerebras:** elimina `tools`, `tool_choice`, `tool_calls`, convierte mensajes `tool` a `user`
- **Todos:** limita `max_tokens` a 16000 como máximo global

**→ PASO 9: Petición al proveedor**
```
POST https://api.proveedor.com/v1/chat/completions
Authorization: Bearer sk-xxxx (API key real)
Body: { body normalizado }
```

**→ PASO 10: Manejo de errores y fallback**
Si el proveedor devuelve error:
- `429` → marca la key como `rate_limited` (cooldown 60s) → intenta con siguiente key/proveedor
- `413` → demasiados tokens → marca error → fallback
- `5xx` → error del servidor → marca `error` (retry 15s) → fallback
- **Timeout** (>N segundos) → aborta → fallback
- Si **todos los proveedores fallan** → devuelve 503

Si respuesta exitosa:
**→ PASO 11: Logging**
- Guarda en tabla `request_logs` de Supabase:
  - provider, model, latency_ms, status_code, total_tokens, error_message
- Actualiza contadores en memoria (`providerStates`)

**→ PASO 12: Respuesta al agente**
- Streaming: SSE (Server-Sent Events) en tiempo real
- No-streaming: JSON completo
- Se añade header `x-openclaw-provider` con info del proveedor usado

---

## 4. Componentes del backend

### `backend/src/index.ts`
Punto de entrada. Registra todas las rutas:
- `/v1/*` → rutas compatibles con OpenAI (chat completions, etc.)
- `/api/projects` → CRUD de proyectos
- `/api/providers` → CRUD de upstream keys
- `/api/gateway-keys` → CRUD de gateway keys
- `/api/analytics` → estadísticas de uso
- `/api/brave/*` → proxy de Brave Search

### `backend/src/routes/v1.ts` ⭐ (el más importante)
El corazón del gateway. Maneja:
- `POST /v1/chat/completions` — la ruta principal
- Loop de fallback entre proveedores
- Normalización por proveedor
- Context Trim Guard
- Streaming y non-streaming

### `backend/src/routes/upstreamKeys.ts`
CRUD de API keys de proveedores:
- `GET /` → lista todas las keys (con preview enmascarado)
- `POST /` → añade nueva key
- `DELETE /:id` → elimina key
- `PATCH /:id/context-limit` → actualiza `max_context_tokens`
- `GET /health` → estado en memoria de todos los proveedores
- `POST /reset-all` → resetea todos los estados
- `POST /:id/reset` → resetea estado de una key
- `POST /:id/pause` → pausa una key manualmente

### `backend/src/utils/limitTracker.ts`
Gestiona el estado en memoria de cada upstream key:
- **Estados:** `healthy`, `rate_limited`, `error`, `paused`
- **Recuperación:**
  - `rate_limited` → 60s cooldown automático
  - `error` → 15s retry automático  
  - `paused` → solo manual (reset desde UI)
- Registra: `requestsPerMinute`, `requestsPerDay`, `tokensPerMinute`, `tokensPerDay`

### `backend/src/utils/smartRouter.ts`
Selección inteligente de proveedor:
- Clasifica peticiones por complejidad y tipo (text/code/tools/reasoning)
- Filtra proveedores compatibles con el tipo de petición
- Estima tokens: `estimateTokenCount(messages)`

### `backend/src/utils/semanticCache.ts`
Caché de respuestas:
- Hashea el prompt + modelo para generar clave única
- TTL configurable
- Evita peticiones duplicadas en conversaciones repetitivas

### `backend/src/utils/latencyGuard.ts`
Protección contra latencias altas:
- Registra historial de latencias por proveedor
- Si un proveedor tiene latencia alta sostenida → se marca como "slow" temporalmente
- `LATENCY_ABORT_TIMEOUT_MS` → timeout de abort para peticiones lentas

### `backend/src/utils/puterClient.ts`
Cliente especial para el proveedor Puter (gratuito):
- Puter no tiene API standard → usa cliente personalizado
- Soporte streaming via SSE propio de Puter

---

## 5. Componentes del frontend

### Páginas principales
```
frontend/src/pages/
├── Login.tsx        → Autenticación admin
├── Dashboard.tsx    → Lista de proyectos con estadísticas
└── ProjectDetail.tsx → Gestión de un proyecto específico
```

### `Dashboard.tsx`
- Lista todos los proyectos del usuario
- Muestra stats: total requests, success rate, tokens usados
- Botón para crear nuevo proyecto
- Indicador de salud global del gateway

### `ProjectDetail.tsx`
Tiene 3 tabs:

**Tab Providers (Upstream Keys):**
- Lista de API keys de proveedores configuradas
- Estado en tiempo real (healthy/rate_limited/error/paused)
- Uso: requests/min, tokens/min
- **Columna Ctx Limit:** límite de tokens de contexto por key (editable inline)
- Acciones: Pause, Reset, Delete
- Botones masivos: Pause All, Restart All

**Tab Gateway Keys:**
- Lista de gateway keys (`gk_`) para dar acceso a agentes/clientes
- Modelos permitidos por cada key
- Test de petición en tiempo real (con resultado y metadata del proveedor usado)

**Tab Analytics:**
- Total requests, success rate, tokens usados, latencia media
- Top proveedores usados (con gráfica de barras)
- Top modelos usados
- Log de últimas peticiones (timestamp, provider, model, status, latency, tokens)

### `frontend/src/i18n.tsx`
Sistema de internacionalización (ES/EN). Todos los textos del UI pasan por `t('clave')`.

### `frontend/src/index.css`
Sistema de diseño completo:
- Variables CSS (colores, tipografía, spacing, radii)
- Tema dark "Cyber Command Center"
- Componentes: `.glass-panel`, `.btn`, `.badge`, `.provider-chip`, `.data-table`, etc.
- Animaciones: fade-in, slide-in, pulse-glow

---

## 6. Base de datos (Supabase)

### Tablas principales

**`projects`**
```sql
id uuid PRIMARY KEY
name text
created_at timestamp
```

**`upstream_keys`** — API keys de proveedores reales
```sql
id uuid PRIMARY KEY
project_id uuid → projects.id
provider text  -- 'google', 'groq', 'cerebras', 'openrouter', etc.
api_key text   -- clave real del proveedor (ej: sk-xxx, gsk_xxx)
max_context_tokens integer NULL  -- límite de tokens de contexto (NULL = sin límite)
created_at timestamp
```

**`gateway_keys`** — Claves que dan acceso al gateway
```sql
id uuid PRIMARY KEY
project_id uuid → projects.id
key_name text   -- nombre descriptivo (ej: "Agent Rocky")
api_key text    -- la clave gk_xxx que usan los agentes
created_at timestamp
```

**`gateway_key_models`** — Modelos permitidos por each gateway key
```sql
id uuid PRIMARY KEY
gateway_key_id uuid → gateway_keys.id
upstream_key_id uuid → upstream_keys.id
model_name text  -- ej: "gemini-3-flash-preview"
```

**`request_logs`** — Log de TODAS las peticiones
```sql
id uuid PRIMARY KEY
project_id uuid → projects.id
gateway_key_id uuid → gateway_keys.id
upstream_key_id uuid → upstream_keys.id
provider text
model text
status text  -- 'success' | 'error'
status_code integer
latency_ms integer
total_tokens integer
error_message text NULL
created_at timestamp
```

---

## 7. Sistema SOAT

SOAT son las siglas de las capas de inteligencia que el gateway aplica **antes** de cada petición:

| Capa | Descripción |
|------|-------------|
| **S** — Smart Router | Selecciona el proveedor más adecuado según el tipo de petición |
| **O** — Orchestration | Gestiona el loop de fallback entre proveedores |
| **A** — Availability | Comprueba estado (healthy/paused/rate_limited) antes de intentar |
| **T** — Token Management | Controla límites de tokens, recorta contexto si es necesario |

### Flujo SOAT completo
```
Petición entrante
     ↓
[S] Clasificar tipo de petición (code/tools/text/reasoning)
     ↓ 
[S] Filtrar candidatos compatibles
     ↓
[O] Para cada candidato en orden de prioridad:
     ↓
  [A] ¿Estado = healthy? → sí → continuar
                          → no → siguiente candidato
     ↓
  [A] ¿Latencia reciente alta? → sí → siguiente candidato
     ↓
  [T] ¿max_context_tokens configurado? → sí → recortar mensajes
     ↓
  Normalizar payload para el proveedor
     ↓
  Enviar petición
     ↓
  ¿Éxito? → devolver respuesta
  ¿Error? → marcar estado → siguiente candidato
     ↓
[O] ¿Todos fallaron? → 503 Service Unavailable
```

---

## 8. Gestión de proveedores y fallback

### Cadena de fallback configurada (actual)

```
PRIMARIO:    gateway-primary  → gemini-3-flash-preview (Google)
FALLBACK 1:  gateway-kimi     → moonshotai/kimi-k2-instruct-0905 (Groq)
FALLBACK 2a: gateway-openrouter → minimax/minimax-m2.5
FALLBACK 2b: gateway-openrouter → google/gemini-3-flash-preview
```

### Recuperación automática de estados

```
rate_limited → espera 60 segundos → vuelve a healthy
error        → espera 15 segundos → vuelve a healthy
paused       → requiere reset manual desde el UI
```

### Límites de cada proveedor (free tier)

| Proveedor | RPM | TPM | RPD | Notas |
|-----------|-----|-----|-----|-------|
| Google Gemini | 60 | 1M | 1500 | Muy generoso |
| Groq (free) | 60 | 10K | 1K | **TPM muy limitado** — usar `max_context_tokens: 8000` |
| Cerebras (free) | 30 | 60K | 1K | No soporta `tool_calls` |
| Puter | — | — | — | Gratuito sin documentar |
| OpenRouter | Varía | Varía | — | Depende del modelo |

### Normalización especial por proveedor

**Google/Kie-Gemini:**
- `max_completion_tokens` → renombrar a `max_tokens`
- Mensajes `system` → mover como primer mensaje `user`
- `tool_calls` → convertir al formato de Google (`functionCall`)
- `store`, `stream_options` → eliminar (no soportados)

**Cerebras:**
- `tools`, `tool_choice` → eliminar (no soporta herramientas)
- `tool_calls` en mensajes de assistant → eliminar
- Mensajes con `role: "tool"` → convertir a `role: "user"`
- `store`, `stream_options` → eliminar

---

## 9. Configuración de OpenClaw CLI

### Archivo de config: `~/.openclaw/openclaw.json`

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "gateway-primary": {
        "baseUrl": "http://127.0.0.1:3000/v1",
        "apiKey": "gk_XXXXX",
        "api": "openai-completions",
        "models": [
          {
            "id": "gemini-3-flash-preview",
            "name": "Gemini 3 Flash (Primary)",
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      },
      "gateway-kimi": {
        "baseUrl": "http://127.0.0.1:3000/v1",
        "apiKey": "gk_YYYYY",
        "api": "openai-completions",
        "models": [
          {
            "id": "moonshotai/kimi-k2-instruct-0905",
            "contextWindow": 7000,
            "maxTokens": 4096
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "gateway-primary/gemini-3-flash-preview",
        "fallbacks": [
          "gateway-kimi/moonshotai/kimi-k2-instruct-0905",
          "gateway-openrouter/minimax/minimax-m2.5"
        ]
      },
      "compaction": {
        "mode": "safeguard"
      }
    }
  }
}
```

### Parámetros clave

| Parámetro | Descripción |
|-----------|-------------|
| `baseUrl` | URL del gateway local |
| `apiKey` | Gateway key (`gk_xxx`) del proyecto en el gateway |
| `contextWindow` | Ventana de contexto que OpenClaw usará para compactar |
| `maxTokens` | Límite de tokens de respuesta |
| `primary` | Modelo principal |
| `fallbacks` | Lista ordenada de modelos de respaldo |
| `compaction.mode` | `safeguard` = compacta solo cuando es necesario |

---

## 10. Casos de uso prácticos

### Caso 1: Agente con múltiples proveedores gratuitos

1. Crear proyecto en el gateway UI (`http://localhost:5173`)
2. Añadir API keys de Google, Groq, Cerebras en la tab **Providers**
3. Poner `max_context_tokens = 8000` en las keys de Groq
4. Crear Gateway Key en la tab **Gateway Keys**
5. Seleccionar todos los modelos deseados
6. Copiar el `gk_xxx` generado
7. Pegar en `~/.openclaw/openclaw.json` como `apiKey` del provider

### Caso 2: Prevenir errores 413 (Request too large) en Groq

El free tier de Groq tiene límite de **10K tokens por minuto**. Para evitar:
- En el UI: pestaña Providers → columna Ctx Limit → clic → escribir `8000` → Enter
- O en SQL: `UPDATE upstream_keys SET max_context_tokens = 8000 WHERE provider = 'groq';`

### Caso 3: Monitorear uso de API

- Tab **Analytics** del proyecto → ver total requests, success rate, tokens usados
- Revisar la tabla de últimas peticiones para detectar errores por proveedor
- Exportar CSV para análisis externo

### Caso 4: Pausa de emergencia de un proveedor

Si un proveedor empieza a dar errores constantes:
- En el UI: botón **Pause** (ícono ⏸) en la fila del proveedor
- El gateway dejará de enviarle peticiones hasta que des clic en **Play**
- O usar **Pause All** para pausar todos los del proyecto

---

## 11. Troubleshooting

### "413 Request too large" con Kimi/Groq
**Causa:** El historial acumulado supera los 10K tokens del free tier  
**Solución:** Poner `max_context_tokens = 8000` en la key de Groq (UI o SQL)

### Respuestas muy lentas
**Causa:** El proveedor primario está rate-limited y el gateway espera el timeout antes de hacer fallback  
**Solución:** 
- Revisar tab Analytics para ver qué proveedor está tardando
- El `latencyGuard` debería detectarlo tras ~2 peticiones lentas
- Hacer **Reset** manual del proveedor lento

### Error "Invalid credentials" en el UI
**Causa:** La contraseña del admin no coincide con el `password_hash` en Supabase  
**Comprobación:** Revisar tabla `admins` en Supabase dashboard

### "config reload skipped (invalid config)"
**Causa:** Valor inválido en `openclaw.json`  
**Errores comunes:**
- `compaction.mode: "auto"` → cambiar a `"safeguard"`
- Model ID con espacios o caracteres inválidos

### El UI no muestra los últimos cambios
**Causa:** PM2 sirve el `dist/` antiguo  
**Solución:**
```bash
cd frontend && npx vite build
pm2 restart openclaw-frontend
```
Luego `Ctrl+Shift+R` en el navegador (hard refresh).

---

## 12. Variables de entorno y seguridad

### Backend (`backend/.env`)
```env
PORT=3000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx...
```

### Seguridad de las keys

| Tipo | Formato | Almacenado en | Expuesto en UI |
|------|---------|---------------|----------------|
| Gateway key | `gk_xxxxx` | DB `gateway_keys.api_key` | ✅ Visible completa |
| Upstream key | `sk-xxx`, `gsk_xxx` | DB `upstream_keys.api_key` | ❌ Solo preview (4+4 chars) |
| Admin password | hash bcrypt | DB `admins.password_hash` | ❌ Nunca |

### PM2 (proceso manager)

```bash
# Ver estado de todos los procesos
pm2 list

# Ver logs en tiempo real
pm2 logs openclaw-backend
pm2 logs openclaw-frontend

# Restart después de rebuild
pm2 restart openclaw-backend
pm2 restart openclaw-frontend

# Auto-arranque al reiniciar el PC
pm2 startup
pm2 save
```

---

## Diagrama de flujo completo

```
OpenClaw Agent
     │
     ▼
POST /v1/chat/completions
Authorization: Bearer gk_xxx
     │
     ▼
┌── authMiddleware ──────────────────────────────┐
│   ¿gk_ existe en DB? → NO → 401               │
│                      → SÍ → extraer project_id │
└────────────────────────────────────────────────┘
     │
     ▼
┌── Validate model ──────────────────────────────┐
│   ¿Modelo en gateway_key_models? → NO → 403   │
└────────────────────────────────────────────────┘
     │
     ▼
┌── semanticCache ───────────────────────────────┐
│   ¿Cache hit? → SÍ → devolver respuesta        │
│              → NO → continuar                  │
└────────────────────────────────────────────────┘
     │
     ▼
┌── smartRouter ─────────────────────────────────┐
│   Clasificar: code/tools/text/reasoning        │
│   Obtener candidatos upstream keys             │
└────────────────────────────────────────────────┘
     │
     ▼
┌── FALLBACK LOOP ───────────────────────────────────────────────┐
│   Para cada upstream key candidata:                            │
│                                                                │
│   ┌── checkAndRecoverProvider                                 │
│   │   Estado healthy? → NO → siguiente key                    │
│   │                 → SÍ → continuar                          │
│   └────────────────────────────────────────────               │
│                                                                │
│   ┌── isProviderSlow                                          │
│   │   ¿Latencia alta reciente? → SÍ → siguiente key          │
│   └────────────────────────────────────────────               │
│                                                                │
│   ┌── Context Trim Guard                                      │
│   │   max_context_tokens configurado? → recortar mensajes    │
│   └────────────────────────────────────────────               │
│                                                                │
│   ┌── Normalize for provider                                  │
│   │   Google | Cerebras | Default                             │
│   └────────────────────────────────────────────               │
│                                                                │
│   ┌── fetch → proveedor real                                  │
│   │   OK (2xx) → streaming/json response → FIN               │
│   │   429 → rate_limited (60s) → siguiente key               │
│   │   413 → error (15s) → siguiente key                      │
│   │   5xx → error (15s) → siguiente key                      │
│   │   timeout → abort → siguiente key                         │
│   └────────────────────────────────────────────               │
│                                                                │
│   Todos fallaron → 503                                         │
└────────────────────────────────────────────────────────────────┘
     │
     ▼
┌── request_logs INSERT ─────────────────────────┐
│   provider, model, latency, status, tokens     │
└────────────────────────────────────────────────┘
     │
     ▼
Respuesta al agente (stream SSE o JSON)
```

---

*Guía generada el 2026-03-05. Para reportar problemas o mejoras: ver proyecto en GitHub.*
