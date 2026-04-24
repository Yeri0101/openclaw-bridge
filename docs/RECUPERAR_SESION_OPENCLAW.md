# 🔑 Recuperar Sesión de OpenClaw tras Cuelgue o Reinicio

> **Cuándo usar esto:** Si al abrir el dashboard de OpenClaw ves alguno de estos errores:
> - `unauthorized: gateway token mismatch`
> - `unauthorized: too many failed authentication attempts`
> - `Disconnected from gateway`

---

## Paso 1 — Conseguir el Token

El token de autenticación del gateway vive en el archivo de configuración principal de OpenClaw:

```bash
cat ~/.openclaw/openclaw.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['gateway']['auth']['token'])"
```

O abrirlo directamente y buscar la sección `gateway > auth > token`:

```json
"gateway": {
    "auth": {
        "mode": "token",
        "token": "748a75db2c3430c3e00a09d85c1ac6b53ab89749e7fbd2f2"
    }
}
```

📁 Ruta del archivo: `~/.openclaw/openclaw.json`

---

## Paso 2 — Aplicar el Token (Método Rápido)

Abre el navegador y navega a esta URL **con el token al final**:

```
http://127.0.0.1:18789/?token=TU_TOKEN_AQUI
```

**Ejemplo con el token actual:**
```
http://127.0.0.1:18789/?token=748a75db2c3430c3e00a09d85c1ac6b53ab89749e7fbd2f2
```

✅ OpenClaw autenticará la sesión del navegador y redirigirá automáticamente al chat con el historial anterior restaurado.

---

## Paso 3 — Si hay bloqueo por intentos fallidos

Si el error es `too many failed authentication attempts`, el contador de bloqueo vive **en memoria** del proceso. Basta con reiniciarlo:

```bash
# El proceso se relanza automáticamente, solo matarlo es suficiente
kill -15 $(pgrep openclaw-gateway)
```

Esperar ~3 segundos y luego aplicar el token por URL (Paso 2).

> ⚠️ **Los datos de sesión NO se pierden** — están guardados en disco en `~/.openclaw/agents/` y `~/.openclaw/workspace/`. Solo se limpia el contador de intentos fallidos en RAM.

---

## Resumen Rápido (TL;DR)

```bash
# 1. Sacar el token
cat ~/.openclaw/openclaw.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['gateway']['auth']['token'])"

# 2. Si hay bloqueo por intentos, reiniciar el proceso
kill -15 $(pgrep openclaw-gateway)

# 3. En el navegador, entrar con el token en la URL
# http://127.0.0.1:18789/?token=<TOKEN>
```

---

## Información del Gateway

| Parámetro | Valor |
|-----------|-------|
| Puerto | `18789` |
| URL base | `http://127.0.0.1:18789` |
| Config | `~/.openclaw/openclaw.json` |
| Servidores PM2 | `openclaw-backend` (3000), `openclaw-frontend`, `openclaw-batch-worker` |
| Ecosystem PM2 | `~/Documents/openclaw-gateway-main/ecosystem.config.js` |

---

*Documentado el 2026-03-11 tras incidente de cuelgue de PC.*
