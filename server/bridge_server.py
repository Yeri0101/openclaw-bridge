#!/usr/bin/env python3
"""
ZettaCore Chrome Bridge Server
================================
Servidor dual: FastAPI (HTTP puerto 8000) + WebSocket (puerto 8765)

Flujo:
  Agente OpenClaw → POST /v1/chat/completions → Bridge → WS → Extensión Chrome → LLM Web → Chrome → Bridge → Agente

AISLADO de OpenClaw producción. No modifica ningún archivo del sistema.
Puerto HTTP: 8000 | Puerto WS: 8765
"""

import asyncio
import json
import logging
import os
import time
import uuid
from typing import Optional

# Módulos propios
from router import resolve_model, list_models as router_list_models, active_platforms
from incidents import log_incident, get_recent as get_incidents, count_last_n_seconds

import uvicorn
import websockets
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Tipo para el store de progreso
ProgressEntry = dict  # { status: generating|done|error, content: str, updated_at: float }

# ─────────────────────────────────────────────────────────────────────────────
# Configuración de logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ZettaBridge")

# ─────────────────────────────────────────────────────────────────────────────
# Resolución de modelos delegada a router.py
# ─────────────────────────────────────────────────────────────────────────────
# get_platform_and_variant() reemplazado por router.resolve_model().
# El registry completo vive en router.py y es configurable via
# la env var BRIDGE_MODEL_OVERRIDES (JSON) sin tocar código.
def get_platform_and_variant(model_name: str):
    return resolve_model(model_name)

# ── Configuración via env vars (facilita migración a VPS) ───────────────────
BRIDGE_WS_PORT   = int(os.environ.get("BRIDGE_WS_PORT",   8765))
BRIDGE_HTTP_PORT = int(os.environ.get("BRIDGE_HTTP_PORT", 8000))
REQUEST_TIMEOUT  = int(os.environ.get("BRIDGE_TIMEOUT",    660))  # Sora puede tardar hasta 10 min
BRIDGE_START_TIME = time.time()  # para uptime en /health

# TTL del progress_store:
# - Los jobs done/error se borran N segundos DESPUÉS de completarse (da tiempo al agente a leer)
# - Los jobs en estado 'generating' que llevan demasiado tiempo sin resolverse también se borran
POST_COMPLETION_TTL   = 300   # 5 min después de done/error → cleanup
STALE_GENERATING_TTL  = 900   # 15 min sin respuesta (fallback de seguridad — Claude puede tardar)
CLEANUP_INTERVAL      = 60    # el sweeper corre cada 60s

# ── Request Stats Store ────────────────────────────────────────────
# Guarda las últimas N peticiones exitosas para la página /infra
from collections import deque

class RequestStats:
    """Ring buffer de las últimas MAX_ENTRIES peticiones exitosas."""
    MAX_ENTRIES = 100

    def __init__(self):
        self._entries: deque = deque(maxlen=self.MAX_ENTRIES)

    def record(self, *, model: str, platform: str, variant: str,
               latency_ms: float, prompt_tokens: int, completion_tokens: int):
        self._entries.append({
            "ts":                time.time(),
            "model":             model,
            "platform":          platform,
            "variant":           variant,
            "latency_ms":        round(latency_ms),
            "prompt_tokens":     prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens":      prompt_tokens + completion_tokens,
        })

    def summary(self) -> dict:
        entries = list(self._entries)  # snapshot
        if not entries:
            return {
                "total_requests": 0,
                "avg_latency_ms": None,
                "p95_latency_ms": None,
                "total_tokens":   0,
                "by_model":       {},
                "recent":         [],
            }

        latencies = sorted(e["latency_ms"] for e in entries)
        n = len(latencies)
        p95_idx = max(0, int(n * 0.95) - 1)

        by_model: dict = {}
        for e in entries:
            key = e["model"]
            if key not in by_model:
                by_model[key] = {
                    "model":    e["model"],
                    "platform": e["platform"],
                    "variant":  e["variant"],
                    "count":    0,
                    "total_tokens": 0,
                    "avg_latency_ms": 0.0,
                    "_lat_sum": 0.0,
                }
            by_model[key]["count"]        += 1
            by_model[key]["total_tokens"] += e["total_tokens"]
            by_model[key]["_lat_sum"]     += e["latency_ms"]

        # Calcular avg_latency_ms por modelo
        for v in by_model.values():
            v["avg_latency_ms"] = round(v["_lat_sum"] / v["count"])
            del v["_lat_sum"]

        return {
            "total_requests": n,
            "avg_latency_ms": round(sum(latencies) / n),
            "p95_latency_ms": latencies[p95_idx],
            "total_tokens":   sum(e["total_tokens"] for e in entries),
            "by_model":       by_model,
            "recent":         list(reversed(entries[-20:])),  # últimos 20, más reciente primero
        }


request_stats = RequestStats()


# ─────────────────────────────────────────────────────────────────────────────
# Gestor de conexión WebSocket con la extensión Chrome
# ─────────────────────────────────────────────────────────────────────────────
class ConnectionManager:
    """Gestiona la conexión única con la extensión Chrome."""

    def __init__(self):
        self.extension_ws = None  # WebSocket de la extensión
        self.pending_requests: dict[str, asyncio.Event] = {}
        self.responses: dict[str, dict] = {}
        # Store de progreso: requestId → { status, content, updated_at }
        self.progress_store: dict[str, ProgressEntry] = {}

    def is_connected(self) -> bool:
        return self.extension_ws is not None

    async def send_to_extension(self, message: dict):
        if not self.extension_ws:
            raise RuntimeError("La extensión Chrome no está conectada al Bridge Server.")
        await self.extension_ws.send(json.dumps(message))
        log.info(f"→ Enviado a extensión: {message.get('type')} (id: {message.get('requestId', 'n/a')})")

    def register_request(self, request_id: str) -> asyncio.Event:
        event = asyncio.Event()
        self.pending_requests[request_id] = event
        now = time.time()
        # Inicializar entry de progreso
        self.progress_store[request_id] = {
            "status": "generating",
            "content": "",
            "registered_at": now,   # cuándo empezó el job
            "updated_at": now,      # cuándo se actualizó por última vez (completed_at si done/error)
        }
        return event

    def update_progress(self, request_id: str, content: str):
        """Actualiza el contenido acumulado de una petición en curso."""
        if request_id in self.progress_store:
            self.progress_store[request_id]["content"] = content
            self.progress_store[request_id]["updated_at"] = time.time()

    def resolve_request(self, request_id: str, response_data: dict):
        self.responses[request_id] = response_data
        # Marcar como done en el progress store
        if request_id in self.progress_store:
            final_content = response_data.get("content") or ""
            status = "error" if response_data.get("error") else "done"
            self.progress_store[request_id]["status"] = status
            self.progress_store[request_id]["content"] = final_content
            self.progress_store[request_id]["updated_at"] = time.time()
        if request_id in self.pending_requests:
            self.pending_requests[request_id].set()
        else:
            log.warning(f"Respuesta recibida para requestId desconocido: {request_id}")

    def cleanup_request(self, request_id: str):
        self.pending_requests.pop(request_id, None)
        # Mantener el progress_store con TTL controlado por el sweeper
        return self.responses.pop(request_id, None)

    def cleanup_stale_jobs(self) -> int:
        """
        Elimina entries del progress_store que ya no son útiles:
          - done/error cuyo updated_at (= completed_at) supera POST_COMPLETION_TTL
          - generating cuyo registered_at supera STALE_GENERATING_TTL (job abandonado)
        Devuelve el número de entries eliminadas.
        """
        now = time.time()
        to_delete = []
        for rid, entry in self.progress_store.items():
            status = entry["status"]
            age_since_update = now - float(entry["updated_at"] or now)
            age_since_register = now - float(entry.get("registered_at") or entry["updated_at"] or now)

            if status in ("done", "error") and age_since_update > POST_COMPLETION_TTL:
                to_delete.append(rid)
            elif status == "generating" and age_since_register > STALE_GENERATING_TTL:
                to_delete.append(rid)

        for rid in to_delete:
            self.progress_store.pop(rid, None)

        return len(to_delete)


# Instancia global
manager = ConnectionManager()

# ─────────────────────────────────────────────────────────────────────────────
# Servidor WebSocket (maneja la conexión con la extensión)
# ─────────────────────────────────────────────────────────────────────────────
async def ws_server_handler(websocket, path=None):
    """Maneja la conexión entrante de la extensión Chrome."""
    client_addr = websocket.remote_address
    log.info(f"Nueva conexión WS desde {client_addr}")

    # Registrar la extensión
    manager.extension_ws = websocket
    log.info("✅ Extensión Chrome conectada al Bridge Server!")

    try:
        async for raw_message in websocket:
            try:
                data = json.loads(raw_message)
                msg_type = data.get("type")
                
                if msg_type == "ping":
                    continue  # Ignorar pings de forma silenciosa (keep-alive)

                log.info(f"← Recibido de extensión: type={msg_type}")

                if msg_type == "register":
                    log.info(f"  Extensión registrada. Source: {data.get('source')}")
                    await websocket.send(json.dumps({"type": "ack", "message": "Bridge conectado"}))

                elif msg_type == "progress":
                    request_id = data.get("requestId")
                    content = data.get("content", "")
                    if request_id and content:
                        manager.update_progress(request_id, content)
                        log.debug(f"  Progreso parcial para {request_id}: {len(content)} chars")

                elif msg_type == "response":
                    request_id = data.get("requestId")
                    if request_id:
                        log.info(f"  Respuesta llegó para requestId: {request_id} "
                                 f"(plataforma: {data.get('platform')}, "
                                 f"chars: {len(data.get('content') or '')})")
                        manager.resolve_request(request_id, data)

                elif msg_type == "error":
                    request_id = data.get("requestId")
                    log.error(f"  Error de extensión para {request_id}: {data.get('message')}")
                    if request_id:
                        manager.resolve_request(request_id, {
                            "type": "error",
                            "requestId": request_id,
                            "content": None,
                            "error": data.get("message", "Error desconocido"),
                        })

            except json.JSONDecodeError as e:
                log.error(f"JSON inválido de extensión: {e}")

    except websockets.exceptions.ConnectionClosedOK:
        log.info("Extensión desconectada limpiamente.")
    except websockets.exceptions.ConnectionClosedError as e:
        log.warning(f"Extensión desconectada con error: {e}")
    finally:
        manager.extension_ws = None
        log.info("❌ Extensión Chrome desconectada.")


# ─────────────────────────────────────────────────────────────────────────────
# Modelos Pydantic para la API OpenAI-compatible
# ─────────────────────────────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = None
    stream: Optional[bool] = False
    sora_settings: Optional[dict] = None  # {duration?, orientation?, count?}


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────
async def _dispatch_to_extension(
    request: "ChatCompletionRequest",
    model_info: tuple,
    prompt: str,
    request_id: str,
) -> asyncio.Event:
    """Registra la petición y la envía a la extensión Chrome. Devuelve el Event de espera."""
    platform, variant = model_info
    event = manager.register_request(request_id)
    await manager.send_to_extension({
        "type": "generate",
        "platform": platform,
        "variant": variant,
        "prompt": prompt,
        "requestId": request_id,
        "settings": request.sora_settings or {},
    })
    return event


def _format_openai_response(content: str, model: str, platform: str, variant: str,
                            prompt: str, latency_ms: float = 0.0) -> dict:
    """Construye la respuesta en formato OpenAI Chat Completion y registra stats."""
    prompt_tokens      = len(prompt.split())
    completion_tokens  = len(content.split())
    request_stats.record(
        model=model, platform=platform, variant=variant,
        latency_ms=latency_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens":     prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens":      prompt_tokens + completion_tokens,
        },
        "system_fingerprint": f"zettacore-bridge-{platform}",
        "x_zettacore": {
            "platform":       platform,
            "variant":        variant,
            "latency_ms":     round(latency_ms),
            "bridge_version": "1.1",
        },
    }


app = FastAPI(
    title="ZettaCore Chrome Bridge",
    description="Proxy OpenAI-compatible que enruta peticiones a LLMs web vía extensión Chrome.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """
    Health endpoint estable — Mission Control y el gateway primario dependen de esto.

    Contrato (no cambiar campos sin versionar):
        status:                  "ok" | "degraded" | "offline"
        extension_connected:     bool
        pending_requests:        int
        active_platforms:        list[str]   # plataformas registradas en router
        incidents_last_hour:     int         # incidentes en los últimos 3600s
        uptime_seconds:          float
        ts:                      float       # unix timestamp
    """
    connected = manager.is_connected()
    return {
        "status": "ok" if connected else "degraded",
        "extension_connected": connected,
        "pending_requests": len(manager.pending_requests),
        "active_platforms": active_platforms(),
        "incidents_last_hour": count_last_n_seconds(3600),
        "uptime_seconds": round(time.time() - BRIDGE_START_TIME, 1),
        "ts": time.time(),
    }


@app.get("/v1/models")
async def list_models_endpoint():
    """Lista de modelos soportados. Usa el registry de router.py."""
    return {"object": "list", "data": router_list_models()}


@app.get("/stats")
async def get_stats():
    """
    Métricas agregadas de las últimas 100 peticiones exitosas.
    La página /infra de Mission Control consume este endpoint.
    """
    return request_stats.summary()


@app.get("/v1/requests/{request_id}/status")
async def request_status(request_id: str):
    """
    Devuelve el estado actual de una petición en curso o ya completada.
    Útil para que el agente haga polling y vea el progreso parcial.

    Respuesta:
        {
            "request_id": "...",
            "status": "generating" | "done" | "error" | "not_found",
            "content": "texto acumulado hasta ahora...",
            "chars_so_far": 345,
            "updated_at": 1742580000.0
        }
    """
    entry = manager.progress_store.get(request_id)
    if not entry:
        return JSONResponse(
            content={
                "request_id": request_id,
                "status": "not_found",
                "content": "",
                "chars_so_far": 0,
                "updated_at": None,
            },
            status_code=404,
        )

    return {
        "request_id": request_id,
        "status": entry["status"],
        "content": entry["content"],
        "chars_so_far": len(entry["content"]),
        "updated_at": entry["updated_at"],
    }


@app.get("/v1/incidents")
async def incidents_endpoint(
    limit: int = 50,
    platform: Optional[str] = None,
    error_type: Optional[str] = None,
):
    """
    Lista de incidentes estructurados (errores del bridge).
    Contrato estable — Mission Control depende de este endpoint.

    Query params:
        limit:       máximo número de resultados (default: 50)
        platform:    filtrar por plataforma (arena, gemini, qwen, sora)
        error_type:  filtrar por tipo (timeout, adapter_error, extension_disconnected, ...)

    Respuesta:
        {
            "object": "list",
            "count": N,
            "data": [ ... incidentes en orden más reciente primero ... ]
        }
    """
    data = get_incidents(limit=limit, platform=platform, error_type=error_type)
    return {
        "object": "list",
        "count": len(data),
        "data": data,
    }

@app.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    async_mode: bool = False,
):
    """
    Endpoint principal. Compatible con OpenAI SDK.

    Modos:
      - Síncrono (default): espera la respuesta completa y la devuelve.
        POST /v1/chat/completions

      - Asíncrono: devuelve inmediatamente con request_id para sondear.
        POST /v1/chat/completions?async_mode=true
        → 202 { request_id, status, poll_url }
        → GET /v1/requests/{id}/status
    """
    # 1. Validar modelo
    model_info = get_platform_and_variant(request.model)
    if not model_info:
        raise HTTPException(
            status_code=400,
            detail=f"Modelo '{request.model}' no soportado. Prefijos admitidos: arena-*, gemini*, chatgpt*, qwen*, sora*"
        )
    platform, variant = model_info

    # 2. Verificar que la extensión está conectada
    if not manager.is_connected():
        raise HTTPException(
            status_code=503,
            detail="La extensión Chrome no está conectada. Asegúrate de que Chrome esté abierto con la extensión instalada."
        )

    # 3. Extraer el prompt (último mensaje del usuario)
    user_messages = [m for m in request.messages if m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="Se requiere al menos un mensaje con role='user'")

    prompt = user_messages[-1].content
    request_id = str(uuid.uuid4())
    req_start  = time.time()  # para medir latencia total

    log.info(
        f"Nueva petición [{('async' if async_mode else 'sync')}] "
        f"→ modelo: {request.model}, plataforma: {platform}, "
        f"requestId: {request_id}, prompt: {prompt[:80]}..."
    )

    # 4. Enviar a la extensión
    try:
        event = await _dispatch_to_extension(request, model_info, prompt, request_id)
    except RuntimeError as e:
        manager.cleanup_request(request_id)
        raise HTTPException(status_code=503, detail=str(e))

    # ── MODO ASÍNCRONO: devolver inmediatamente ────────────────────────────────
    if async_mode:
        async def _background_wait():
            """Espera la respuesta en background; solo actualiza el progress_store."""
            try:
                await asyncio.wait_for(event.wait(), timeout=REQUEST_TIMEOUT)
                response_data = manager.cleanup_request(request_id)
                if not response_data or response_data.get("error"):
                    err = (response_data or {}).get("error", "Error desconocido")
                    manager.progress_store[request_id] = {
                        "status": "error",
                        "content": "",
                        "error": err,
                        "updated_at": time.time(),
                    }
                    log.error(f"[async] Error para {request_id}: {err}")
                else:
                    # resolve_request ya actualizó el progress_store a "done"
                    log.info(f"[async] ✅ Job {request_id} completado "
                             f"({len(response_data.get('content',''))} chars)")
            except asyncio.TimeoutError:
                duration_ms = int((time.time() - float(manager.progress_store.get(request_id, {}).get("registered_at") or time.time())) * 1000)
                manager.cleanup_request(request_id)
                manager.progress_store[request_id] = {
                    "status": "error",
                    "content": "",
                    "error": f"Timeout después de {REQUEST_TIMEOUT}s",
                    "updated_at": time.time(),
                }
                log_incident(
                    request_id=request_id, model=request.model, platform=platform,
                    error_type="timeout", error_msg=f"Timeout después de {REQUEST_TIMEOUT}s",
                    duration_ms=int(REQUEST_TIMEOUT * 1000),
                )

        asyncio.create_task(_background_wait())

        return JSONResponse(
            status_code=202,
            content={
                "request_id": request_id,
                "status": "generating",
                "model": request.model,
                "poll_url": f"http://localhost:{BRIDGE_HTTP_PORT}/v1/requests/{request_id}/status",
                "created_at": time.time(),
            },
        )

    # ── MODO SÍNCRONO: esperar y devolver OpenAI response ─────────────────────
    try:
        await asyncio.wait_for(event.wait(), timeout=REQUEST_TIMEOUT)
    except asyncio.TimeoutError:
        duration_ms = int(REQUEST_TIMEOUT * 1000)
        manager.cleanup_request(request_id)
        log_incident(
            request_id=request_id, model=request.model, platform=platform,
            error_type="timeout", error_msg=f"Timeout después de {REQUEST_TIMEOUT}s",
            duration_ms=duration_ms,
        )
        raise HTTPException(
            status_code=504,
            detail=f"Timeout después de {REQUEST_TIMEOUT}s esperando respuesta de {platform}"
        )

    # 7. Recuperar y limpiar respuesta
    response_data = manager.cleanup_request(request_id)

    if not response_data or response_data.get("error"):
        error_msg = response_data.get("error", "Error desconocido") if response_data else "Respuesta vacía"
        log_incident(
            request_id=request_id, model=request.model, platform=platform,
            error_type="adapter_error", error_msg=error_msg,
            duration_ms=int((time.time() - float(manager.progress_store.get(request_id, {}).get("registered_at") or time.time())) * 1000),
        )
        raise HTTPException(status_code=502, detail=f"Error desde la extensión: {error_msg}")

    content = response_data.get("content", "")
    latency_ms = (time.time() - req_start) * 1000
    openai_response = _format_openai_response(content, request.model, platform, variant, prompt, latency_ms=latency_ms)
    log.info(f"✅ [sync] Respuesta enviada al agente (requestId: {request_id}, chars: {len(content)})")
    return JSONResponse(content=openai_response)


# ─────────────────────────────────────────────────────────────────────────────
# Arranque del servidor (HTTP + WS en paralelo)
# ─────────────────────────────────────────────────────────────────────────────
async def start_ws_server():
    log.info(f"🔌 WebSocket server escuchando en ws://localhost:{BRIDGE_WS_PORT}")
    async with websockets.serve(ws_server_handler, "localhost", BRIDGE_WS_PORT):
        await asyncio.Future()  # Mantener corriendo


async def start_http_server():
    log.info(f"🌐 HTTP API server escuchando en http://localhost:{BRIDGE_HTTP_PORT}")
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=BRIDGE_HTTP_PORT,
        log_level="warning",  # uvicorn silencioso, usamos nuestro logger
    )
    server = uvicorn.Server(config)
    await server.serve()


async def cleanup_loop():
    """Task de background: limpia jobs expirados del progress_store cada CLEANUP_INTERVAL segundos."""
    log.info(f"🧹 Sweeper de jobs iniciado (intervalo: {CLEANUP_INTERVAL}s, "
             f"TTL done/error: {POST_COMPLETION_TTL}s, TTL stale: {STALE_GENERATING_TTL}s)")
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        removed = manager.cleanup_stale_jobs()
        if removed > 0:
            log.info(f"🧹 Sweeper: {removed} job(s) expirado(s) eliminado(s) del progress_store")


async def main():
    log.info("=" * 55)
    log.info("   ZettaCore Chrome Bridge Server v1.1")
    log.info("=" * 55)
    log.info(f"   HTTP API: http://localhost:{BRIDGE_HTTP_PORT}/v1/chat/completions")
    log.info(f"   WebSocket: ws://localhost:{BRIDGE_WS_PORT}")
    log.info(f"   Health:    http://localhost:{BRIDGE_HTTP_PORT}/health")
    log.info(f"   Job TTL:   done/error → {POST_COMPLETION_TTL}s | stale generating → {STALE_GENERATING_TTL}s")
    log.info("=" * 55)
    log.info("Esperando conexión de la extensión Chrome...")

    # Lanzar servidores + sweeper en paralelo
    await asyncio.gather(
        start_ws_server(),
        start_http_server(),
        cleanup_loop(),
    )


if __name__ == "__main__":
    asyncio.run(main())
