#!/bin/bash
# start-bridge.sh — Lanza el ZettaCore Chrome Bridge Server
# Uso: bash start-bridge.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════╗"
echo "║     ZettaCore Chrome Bridge v1.0         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Activar venv
source "$SCRIPT_DIR/venv/bin/activate"

# Verificar que el venv tiene las dependencias
python3 -c "import fastapi, uvicorn, websockets" 2>/dev/null || {
    echo "⚠️  Instalando dependencias..."
    pip install -r "$SCRIPT_DIR/requirements.txt" -q
}

echo "🚀 Arrancando servidor..."
echo "   HTTP: http://localhost:8000"
echo "   WS:   ws://localhost:8765"
echo ""
echo "Pasos siguientes:"
echo "  1. Abre Chrome y navega a gemini.google.com (o chatgpt.com / chat.qwenlm.ai)"
echo "  2. La extensión se conectará automáticamente"
echo "  3. Envía peticiones a http://localhost:8000/v1/chat/completions"
echo ""

python3 "$SCRIPT_DIR/bridge_server.py"
