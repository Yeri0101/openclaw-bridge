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
import time
import uuid
from typing import Optional

import uvicorn
import websockets
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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
# Mapeo de nombres de modelo → plataforma web
# ─────────────────────────────────────────────────────────────────────────────
MODEL_PLATFORM_MAP = {
    "gemini-web": "gemini",
    "chatgpt-web": "chatgpt",
    "gpt-web": "chatgpt",
    "qwen-web": "qwen",
    "qwen2-web": "qwen",
}

BRIDGE_WS_PORT = 8765
BRIDGE_HTTP_PORT = 8000
REQUEST_TIMEOUT = 180  # segundos


# ─────────────────────────────────────────────────────────────────────────────
# Gestor de conexión WebSocket con la extensión Chrome
# ─────────────────────────────────────────────────────────────────────────────
class ConnectionManager:
    """Gestiona la conexión única con la extensión Chrome."""

    def __init__(self):
        self.extension_ws = None  # WebSocket de la extensión
        self.pending_requests: dict[str, asyncio.Event] = {}
        self.responses: dict[str, dict] = {}

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
        return event

    def resolve_request(self, request_id: str, response_data: dict):
        self.responses[request_id] = response_data
        if request_id in self.pending_requests:
            self.pending_requests[request_id].set()
        else:
            log.warning(f"Respuesta recibida para requestId desconocido: {request_id}")

    def cleanup_request(self, request_id: str):
        self.pending_requests.pop(request_id, None)
        return self.responses.pop(request_id, None)


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


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ─────────────────────────────────────────────────────────────────────────────
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
    return {
        "status": "ok",
        "extension_connected": manager.is_connected(),
        "pending_requests": len(manager.pending_requests),
        "timestamp": time.time(),
    }


@app.get("/v1/models")
async def list_models():
    """Endpoint de modelos compatible con OpenAI SDK."""
    models = [
        {"id": model_id, "object": "model", "owned_by": "zettacore-bridge"}
        for model_id in MODEL_PLATFORM_MAP.keys()
    ]
    return {"object": "list", "data": models}


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    """
    Endpoint principal. Recibe petición en formato OpenAI,
    la envía a Chrome vía WebSocket y espera la respuesta.
    """
    # 1. Validar modelo
    platform = MODEL_PLATFORM_MAP.get(request.model)
    if not platform:
        raise HTTPException(
            status_code=400,
            detail=f"Modelo '{request.model}' no soportado. Modelos disponibles: {list(MODEL_PLATFORM_MAP.keys())}"
        )

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

    log.info(f"Nueva petición → modelo: {request.model}, plataforma: {platform}, "
             f"requestId: {request_id}, prompt: {prompt[:80]}...")

    # 4. Registrar la petición pendiente
    event = manager.register_request(request_id)

    # 5. Enviar orden a la extensión
    try:
        await manager.send_to_extension({
            "type": "generate",
            "platform": platform,
            "prompt": prompt,
            "requestId": request_id,
        })
    except RuntimeError as e:
        manager.cleanup_request(request_id)
        raise HTTPException(status_code=503, detail=str(e))

    # 6. Esperar respuesta asíncronamente (con timeout)
    try:
        await asyncio.wait_for(event.wait(), timeout=REQUEST_TIMEOUT)
    except asyncio.TimeoutError:
        manager.cleanup_request(request_id)
        raise HTTPException(
            status_code=504,
            detail=f"Timeout después de {REQUEST_TIMEOUT}s esperando respuesta de {platform}"
        )

    # 7. Recuperar y limpiar respuesta
    response_data = manager.cleanup_request(request_id)

    if not response_data or response_data.get("error"):
        error_msg = response_data.get("error", "Error desconocido") if response_data else "Respuesta vacía"
        raise HTTPException(status_code=502, detail=f"Error desde la extensión: {error_msg}")

    content = response_data.get("content", "")

    # 8. Formatear respuesta en formato OpenAI
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_ts = int(time.time())
    token_estimate = len(content.split())  # Estimación simple

    openai_response = {
        "id": completion_id,
        "object": "chat.completion",
        "created": created_ts,
        "model": request.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": len(prompt.split()),
            "completion_tokens": token_estimate,
            "total_tokens": len(prompt.split()) + token_estimate,
        },
        "system_fingerprint": f"zettacore-bridge-{platform}",
    }

    log.info(f"✅ Respuesta enviada al agente (requestId: {request_id}, chars: {len(content)})")
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


async def main():
    log.info("=" * 55)
    log.info("   ZettaCore Chrome Bridge Server v1.0")
    log.info("=" * 55)
    log.info(f"   HTTP API: http://localhost:{BRIDGE_HTTP_PORT}/v1/chat/completions")
    log.info(f"   WebSocket: ws://localhost:{BRIDGE_WS_PORT}")
    log.info(f"   Health:    http://localhost:{BRIDGE_HTTP_PORT}/health")
    log.info("=" * 55)
    log.info("Esperando conexión de la extensión Chrome...")

    # Lanzar ambos servidores en paralelo
    await asyncio.gather(
        start_ws_server(),
        start_http_server(),
    )


if __name__ == "__main__":
    asyncio.run(main())
