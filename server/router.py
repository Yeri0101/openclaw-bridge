"""
router.py — ZettaCore Chrome Bridge Model Registry

Responsabilidad única: traducir el nombre de modelo que llega al bridge
a (platform, variant). No hace fallback — eso es trabajo del gateway primario.

El mapeo es configurado en VIRTUAL_MODELS. Para cambiar la prioridad de
web/auto de Arena a otro proveedor, basta con editar esa entrada aquí
o sobrescribir via variable de entorno BRIDGE_MODEL_OVERRIDES (JSON).

Ejemplo env override:
    BRIDGE_MODEL_OVERRIDES='{"web/auto": ["gemini", "gemini-2.0-flash"]}'
"""

import os
import json
import logging
from typing import Optional

log = logging.getLogger("zettacore.router")

# ── Model Registry ─────────────────────────────────────────────────────────────
# Formato: "model_name" → ("platform", "variant")
#
# platform: clave que el service-worker reconoce para inyectar el adapter correcto
#           valores válidos: "arena" | "gemini" | "qwen" | "sora"
# variant:  nombre de modelo específico dentro de la plataforma (puede ser "")
#
# NOTA: web/* son aliases semánticos diseñados para ser usados desde el gateway
# primario. Los nombres directos (arena-*, gemini*) mantienen backward compat.
# ─────────────────────────────────────────────────────────────────────────────

VIRTUAL_MODELS: dict[str, tuple[str, str]] = {
    # ── Aliases semánticos web/* para agentes ──────────────────────────────
    "web/auto":              ("arena",  "claude-opus-4-6"),         # default inteligente
    "web/claude":            ("arena",  "claude-opus-4-6"),         # Opus 4.6 estándar
    "web/claude-think":      ("arena",  "claude-opus-4-6-thinking"),# Opus 4.6 Thinking
    "web/claude-code":       ("arena",  "claude-opus-4-5-20251101"),# Opus 4.5 SWE/coding
    "web/claude-tools":      ("arena",  "claude-opus-4-1-20250805"),# Opus 4.1 herramientas
    # Gemini 3/3.1 — selectors UI: Fast | Pro | Thinking (los labels del pill)
    "web/gemini":            ("gemini", "flash"),       # Gemini 3.1 Flash-Lite (modo Fast)
    "web/gemini-flash":      ("gemini", "flash"),       # alias explícito Flash-Lite
    "web/gemini-pro":        ("gemini", "pro"),         # Gemini 3 Pro (máxima calidad)
    "web/gemini-think":      ("gemini", "reasoning"),   # Gemini 3 Thinking (razonamiento)
    "web/qwen":              ("qwen",   "qwen-plus"),

    # ── Nombres directos Arena — Claude Opus 4.x completo ────────────────────
    # Opus 4.6 (Feb 2026) — 1M ctx, razonamiento adaptativo, agentes en paralelo
    "arena-claude-opus-4-6":          ("arena", "claude-opus-4-6"),
    "arena-claude-opus-4-6-thinking": ("arena", "claude-opus-4-6-thinking"),
    # Opus 4.5 (Nov 2025) — SWE-bench, computer use, codificación E2E
    "arena-claude-opus-4-5":          ("arena", "claude-opus-4-5-20251101"),
    # Opus 4.1 (Ago 2025) — herramientas externas, razonamiento multi-paso
    "arena-claude-opus-4-1":          ("arena", "claude-opus-4-1-20250805"),
    # Otros
    "arena-claude-sonnet-4":          ("arena", "claude-sonnet-4"),
    "arena-gpt-4o":                   ("arena", "gpt-4o"),
    "arena-gemini-2.5-pro":           ("arena", "gemini-2.5-pro"),

    # Gemini nombres directos — también usan claves cortas para consistency
    "gemini-2.0-flash":          ("gemini", "flash"),
    "gemini-2.5-pro":            ("gemini", "pro"),
    "gemini-reasoning":          ("gemini", "reasoning"),

    "qwen-plus":                 ("qwen", "qwen-plus"),
    "qwen-max":                  ("qwen", "qwen-max"),

    "sora":                      ("sora", ""),
    "sora-hd":                   ("sora", "hd"),
}


def _load_env_overrides() -> dict[str, tuple[str, str]]:
    """
    Carga overrides de modelo desde la env var BRIDGE_MODEL_OVERRIDES.
    Permite cambiar web/auto (o cualquier alias) sin tocar el código.
    Formato JSON: { "web/auto": ["gemini", "gemini-2.0-flash"] }
    """
    raw = os.environ.get("BRIDGE_MODEL_OVERRIDES", "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return {k: tuple(v) for k, v in data.items() if isinstance(v, list) and len(v) == 2}
    except Exception as e:
        log.warning(f"BRIDGE_MODEL_OVERRIDES inválido, ignorando: {e}")
        return {}


# Aplicar overrides al arrancar
_overrides = _load_env_overrides()
if _overrides:
    log.info(f"Cargando {len(_overrides)} overrides de BRIDGE_MODEL_OVERRIDES")
    VIRTUAL_MODELS.update(_overrides)


def resolve_model(model_name: str) -> Optional[tuple[str, str]]:
    """
    Resuelve un nombre de modelo a (platform, variant).

    Soporta:
      - Nombres exactos: "arena-claude-opus-4-6" → ("arena", "claude-opus-4-6")
      - Aliases semánticos: "web/auto" → ("arena", "claude-opus-4-6")
      - Prefijos dinámicos: "arena-{variant}" o "gemini/{variant}" no listados

    Devuelve None si el modelo no puede resolverse.
    """
    # 1. Lookup exacto en el registry
    if model_name in VIRTUAL_MODELS:
        return VIRTUAL_MODELS[model_name]

    # 2. Prefijos dinámicos: "arena-{variant}"
    if model_name.startswith("arena-"):
        variant = model_name[len("arena-"):]
        return ("arena", variant)

    # 3. Prefijos dinámicos: "gemini-{variant}" o "gemini/{variant}"
    for prefix in ("gemini-", "gemini/"):
        if model_name.startswith(prefix):
            return ("gemini", model_name[len(prefix):])

    # 4. Prefijos dinámicos: "qwen-{variant}"
    if model_name.startswith("qwen-"):
        return ("qwen", model_name[len("qwen-"):])

    # 5. No resoluble
    return None


def list_models() -> list[dict]:
    """
    Devuelve la lista de modelos soportados en formato OpenAI /v1/models.
    """
    seen = set()
    models = []
    for name, (platform, variant) in VIRTUAL_MODELS.items():
        if name not in seen:
            seen.add(name)
            models.append({
                "id": name,
                "object": "model",
                "owned_by": f"zettacore-{platform}",
                "platform": platform,
                "variant": variant or name,
            })
    return models


def active_platforms() -> list[str]:
    """Lista de plataformas únicas registradas."""
    return list({platform for platform, _ in VIRTUAL_MODELS.values()})
