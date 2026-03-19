// service-worker.js

let ws = null;
const BRIDGE_WS_URL = "ws://localhost:8765";
let isBridgeEnabled = true;
let pingInterval = null;
let isConnecting = false;

// Connect to the Bridge Server
function connectWebSocket() {
  if (!isBridgeEnabled) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (isConnecting) return;

  console.log("Conectando al Bridge Server...");
  isConnecting = true;
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Naranja (conectando)

  ws = new WebSocket(BRIDGE_WS_URL);

  ws.onopen = () => {
    isConnecting = false;
    console.log("✅ WebSocket conectado a ZettaCore Bridge!");
    // Register the extension with the server
    ws.send(JSON.stringify({ type: "register", source: "extension" }));
    updateBadge(); // Volver al color original Verde
    
    // Iniciar ping cada 20s para mantener el service worker vivo
    clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    // Limpiar alarmas de reconexión pendientes
    chrome.alarms.clear("reconnect");
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
    isConnecting = false;
    clearInterval(pingInterval);
    
    if (!isBridgeEnabled) {
      console.log("WebSocket desconectado (Extensión Apagada).");
      updateBadge();
      return;
    }
    console.log("❌ WebSocket desconectado. Programando reconexión...");
    chrome.action.setBadgeText({ text: 'ERR' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Rojo error
    
    // En MV3, setTimeout falla si el SW se suspende. Usar alarms.
    chrome.alarms.create("reconnect", { delayInMinutes: 0.1 }); // ~6 segundos
  };

  ws.onerror = (err) => {
    console.error("WebSocket Error");
    // onclose se dispara después
  };
}

// Escuchar la alarma de reconexión
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "reconnect") {
    console.log("⏰ Alarma de reconexión disparada");
    if (isBridgeEnabled) connectWebSocket();
  }
});

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

// Actualiza el texto visual del ícono de la extensión
function updateBadge() {
  if (isBridgeEnabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Verde
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Rojo
  }
}

// Cargar estado inicial
chrome.storage.local.get(['bridgeEnabled'], (result) => {
  isBridgeEnabled = result.bridgeEnabled !== false;
  updateBadge();
  if (isBridgeEnabled) {
    connectWebSocket();
  }
});

// Escuchar cambios desde el popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.bridgeEnabled !== undefined) {
    isBridgeEnabled = changes.bridgeEnabled.newValue;
    updateBadge();
    
    if (isBridgeEnabled) {
      console.log("Extensión ENCENDIDA 🟢");
      connectWebSocket();
    } else {
      console.log("Extensión APAGADA 🔴");
      if (ws) {
        // Cerrar socket limpiamente sin auto-reconectar (gracias al check en onclose)
        ws.close();
        ws = null;
      }
    }
  }
});
