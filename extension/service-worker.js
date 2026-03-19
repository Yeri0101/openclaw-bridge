// service-worker.js

let ws = null;
const BRIDGE_WS_URL = "ws://localhost:8765";

// Connect to the Bridge Server
function connectWebSocket() {
  if (ws && ws.readyState !== WebSocket.CLOSED) return;

  console.log("Conectando al Bridge Server...");
  ws = new WebSocket(BRIDGE_WS_URL);

  ws.onopen = () => {
    console.log("✅ WebSocket conectado a ZettaCore Bridge!");
    // Register the extension with the server
    ws.send(JSON.stringify({ type: "register", source: "extension" }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error("Error parseando mensaje WS:", e);
    }
  };

  ws.onclose = () => {
    console.log("❌ WebSocket desconectado. Reintentando en 5s...");
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (err) => {
    console.error("WebSocket Error:", err);
    ws.close();
  };
}

// Handle commands from the Bridge Server
async function handleServerMessage(message) {
  console.log("Mensaje recibido del servidor:", message);
  
  if (message.type === "generate") {
    const { platform, prompt, requestId } = message;
    
    // 1. Encuentra o abre la pestaña adecuada
    let url = "";
    if (platform === "chatgpt") url = "https://chatgpt.com/";
    else if (platform === "gemini") url = "https://gemini.google.com/app";
    else if (platform === "qwen") url = "https://chat.qwenlm.ai/";
    else {
      ws.send(JSON.stringify({ type: "error", requestId, message: "Plataforma no soportada" }));
      return;
    }

    // Buscar si ya hay una pestaña abierta de esta plataforma
    const tabs = await chrome.tabs.query({ url: url + "*" });
    let tabId;
    
    if (tabs.length > 0) {
      tabId = tabs[0].id;
      // Refrescar o asegurar que está activa (depende de la estrategia)
      await chrome.tabs.update(tabId, { active: true });
    } else {
      const newTab = await chrome.tabs.create({ url, active: true });
      tabId = newTab.id;
      // Esperar un poco a que cargue
      await new Promise(r => setTimeout(r, 3000));
    }

    // 2. Enviar el prompt al content script de la pestaña
    console.log("Enviando comando al content script del Tab:", tabId);
    try {
      // Necesitamos esperar a que el content script inyecte su listener
      chrome.tabs.sendMessage(tabId, { 
        action: "inject_prompt", 
        prompt: prompt,
        requestId: requestId
      });
    } catch(e) {
      console.error("Error enviando mensaje al tab", e);
      ws.send(JSON.stringify({ type: "error", requestId, message: e.message }));
    }
  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generation_complete") {
    // Send standard API response format back to server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "response",
        requestId: request.requestId,
        content: request.content,
        platform: request.platform
      }));
    }
  }
  return true; // async
});

// Iniciamos la conexión al arrancar
connectWebSocket();
