"""
incidents.py — ZettaCore Chrome Bridge Incident Logger

Responsabilidad: registrar fallos estructurados y exponerlos vía API.
Los incidentes son consumidos por Mission Control y potencialmente
por el gateway primario para decisiones de health.

Contrato de API (estable):
    GET /v1/incidents?limit=50&platform=arena&error_type=timeout

Formato de incidente (estable — Mission Control depende de esto):
    {
        "id":          "uuid",
        "ts":          1742583600.0,      # unix timestamp UTC
        "request_id":  "uuid",
        "model":       "web/claude",      # modelo como llegó al bridge
        "platform":    "arena",           # plataforma ejecutora
        "error_type":  "timeout",         # ver ERROR_TYPES
        "error_msg":   "...",
        "duration_ms": 660000,
        "resolved_by": "none"             # none | retry
    }
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, asdict

log = logging.getLogger("zettacore.incidents")

# Tipos de error reconocidos (contrato estable)
ERROR_TYPES = frozenset({
    "timeout",
    "adapter_error",
    "extension_disconnected",
    "tab_not_found",
    "parse_error",
    "unknown",
})

# ── Configuración ─────────────────────────────────────────────────────────────
# Ruta configurable via env var para facilitar migración a VPS
_DEFAULT_PATH = Path(os.environ.get("BRIDGE_DATA_DIR", os.path.dirname(__file__))) / "incidents.json"
INCIDENTS_PATH = Path(os.environ.get("INCIDENTS_PATH", str(_DEFAULT_PATH)))

# Límite de rotación: si el archivo supera este tamaño, se compacta a las N entradas más recientes
INCIDENTS_MAX_BYTES = int(os.environ.get("INCIDENTS_MAX_BYTES", 1_000_000))   # 1 MB
INCIDENTS_KEEP_ON_ROTATE = int(os.environ.get("INCIDENTS_KEEP_ON_ROTATE", 500))


# ── Dataclass del incidente ───────────────────────────────────────────────────

@dataclass
class Incident:
    id: str
    ts: float
    request_id: str
    model: str
    platform: str
    error_type: str
    error_msg: str
    duration_ms: int
    resolved_by: str = "none"   # none | retry

    def to_dict(self) -> dict:
        return asdict(self)


# ── Core functions ────────────────────────────────────────────────────────────

def log_incident(
    request_id: str,
    model: str,
    platform: str,
    error_type: str,
    error_msg: str,
    duration_ms: int,
    resolved_by: str = "none",
) -> Incident:
    """
    Registra un incidente estructurado en incidents.json.
    Thread/coroutine safe: append atómico por línea (JSONL).
    Si el archivo supera INCIDENTS_MAX_BYTES, rota automáticamente.
    """
    if error_type not in ERROR_TYPES:
        error_type = "unknown"

    incident = Incident(
        id=str(uuid.uuid4()),
        ts=time.time(),
        request_id=request_id,
        model=model,
        platform=platform,
        error_type=error_type,
        error_msg=error_msg[:500],   # truncar mensajes largos
        duration_ms=duration_ms,
        resolved_by=resolved_by,
    )

    _append_incident(incident)
    log.warning(
        f"🚨 Incident [{error_type}] platform={platform} model={model} "
        f"req={request_id[:8]}… duration={duration_ms}ms"
    )
    return incident


def get_recent(
    limit: int = 50,
    platform: Optional[str] = None,
    error_type: Optional[str] = None,
) -> list[dict]:
    """
    Devuelve los N incidentes más recientes, opcionalmente filtrados.
    Si el archivo no existe, devuelve lista vacía.
    """
    if not INCIDENTS_PATH.exists():
        return []

    try:
        with open(INCIDENTS_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()

        results = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                inc = json.loads(line)
            except json.JSONDecodeError:
                continue

            if platform and inc.get("platform") != platform:
                continue
            if error_type and inc.get("error_type") != error_type:
                continue

            results.append(inc)
            if len(results) >= limit:
                break

        return results

    except Exception as e:
        log.error(f"Error leyendo incidents.json: {e}")
        return []


def count_last_n_seconds(seconds: int = 3600) -> int:
    """Cuenta incidentes en los últimos N segundos. Usado por /health."""
    cutoff = time.time() - seconds
    if not INCIDENTS_PATH.exists():
        return 0
    try:
        with open(INCIDENTS_PATH, "r", encoding="utf-8") as f:
            return sum(
                1 for line in f
                if line.strip()
                and _safe_ts(line) >= cutoff
            )
    except Exception:
        return 0


# ── Internals ─────────────────────────────────────────────────────────────────

def _append_incident(incident: Incident) -> None:
    """Append-only write al archivo JSONL. Rota si supera el límite."""
    INCIDENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(INCIDENTS_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(incident.to_dict()) + "\n")
    except Exception as e:
        log.error(f"No se pudo escribir el incidente: {e}")
        return

    # Rotar si el archivo es demasiado grande
    try:
        if INCIDENTS_PATH.stat().st_size > INCIDENTS_MAX_BYTES:
            _rotate()
    except Exception:
        pass


def _rotate() -> None:
    """Compacta el archivo conservando las últimas INCIDENTS_KEEP_ON_ROTATE entradas."""
    try:
        with open(INCIDENTS_PATH, "r", encoding="utf-8") as f:
            lines = [l for l in f.readlines() if l.strip()]
        keep = lines[-INCIDENTS_KEEP_ON_ROTATE:]
        with open(INCIDENTS_PATH, "w", encoding="utf-8") as f:
            f.writelines(keep)
        log.info(f"🧹 incidents.json rotado: conservando {len(keep)} entradas")
    except Exception as e:
        log.error(f"Error rotando incidents.json: {e}")


def _safe_ts(line: str) -> float:
    """Extrae el timestamp de una línea JSONL sin parsear el objeto completo."""
    try:
        return json.loads(line).get("ts", 0.0)
    except Exception:
        return 0.0
