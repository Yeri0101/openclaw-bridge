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
  console.log("Mensaje recibido del servidor:", message.type);
  
  if (message.type === "generate") {
    const { platform, variant, prompt, requestId, settings } = message;
    
    // 1. Determinar el dominio de la plataforma
    const platformDomains = {
      chatgpt: "chatgpt.com",
      gemini: "gemini.google.com",
      qwen: "chat.qwenlm.ai",
      arena: "arena.ai",
      sora: "sora.chatgpt.com",
    };
    const platformUrls = {
      chatgpt: "https://chatgpt.com/",
      gemini: "https://gemini.google.com/app",
      qwen: "https://chat.qwenlm.ai/",
      arena: "https://arena.ai/text/direct",
      sora: "https://sora.chatgpt.com/drafts",
    };

    const domain = platformDomains[platform];
    const targetUrl = platformUrls[platform];
    
    if (!domain) {
      ws.send(JSON.stringify({ type: "error", requestId, message: "Plataforma no soportada" }));
      return;
    }

    // 2. Buscar tab activo por dominio (más robusto que por URL exacta)
    let tabId = null;
    const allTabs = await chrome.tabs.query({});
    const matchingTab = allTabs.find(t => t.url && t.url.includes(domain));
    
    console.log(`🔍 Buscando tab de ${domain} entre ${allTabs.length} tabs...`);
    
    if (matchingTab) {
      tabId = matchingTab.id;
      console.log(`✅ Tab encontrado: ID=${tabId}, URL=${matchingTab.url}`);
      await chrome.tabs.update(tabId, { active: true });
      // Dar tiempo para que el content script esté listo si el tab estaba en background
      await new Promise(r => setTimeout(r, 500));
    } else {
      console.log(`📂 No hay tab de ${domain}, creando uno nuevo...`);
      const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
      tabId = newTab.id;
      // Esperar a que cargue la página y los content scripts
      await new Promise(r => setTimeout(r, 5000));
    }

    // 3. Función helper para enviar el prompt al content script
    const sendPromptToTab = (tabId, retrying = false) => {
      chrome.tabs.sendMessage(tabId, { 
        action: "inject_prompt", 
        prompt: prompt,
        requestId: requestId,
        variant: variant,
        settings: settings || {}
      }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (!retrying && err.message.includes("Receiving end does not exist")) {
            // Content script huérfano — re-inyectar los scripts y reintentar
            console.warn(`⚠️ Content script huérfano en tab ${tabId}. Re-inyectando scripts...`);
            const scripts = platform === "gemini"
              ? ["content-scripts/shadow-walker.js", "content-scripts/blind-protocol.js", "content-scripts/common.js", "content-scripts/gemini.js"]
              : platform === "chatgpt"
              ? ["content-scripts/shadow-walker.js", "content-scripts/blind-protocol.js", "content-scripts/common.js", "content-scripts/chatgpt.js"]
              : platform === "arena"
              ? ["content-scripts/shadow-walker.js", "content-scripts/blind-protocol.js", "content-scripts/common.js", "content-scripts/arena.js"]
              : platform === "sora"
              ? ["content-scripts/shadow-walker.js", "content-scripts/blind-protocol.js", "content-scripts/common.js", "content-scripts/sora.js"]
              : ["content-scripts/shadow-walker.js", "content-scripts/blind-protocol.js", "content-scripts/common.js", "content-scripts/qwen.js"];


            chrome.scripting.executeScript(
              { target: { tabId }, files: scripts },
              () => {
                if (chrome.runtime.lastError) {
                  const msg = `No se pudo re-inyectar scripts: ${chrome.runtime.lastError.message}`;
                  console.error("❌", msg);
                  ws.send(JSON.stringify({ type: "error", requestId, message: msg }));
                } else {
                  console.log("✅ Scripts re-inyectados. Reintentando inject_prompt en 500ms...");
                  setTimeout(() => sendPromptToTab(tabId, true), 500);
                }
              }
            );
          } else {
            const msg = `Error comunicando con content script: ${err.message}`;
            console.error("❌ Error sendMessage:", msg);
            ws.send(JSON.stringify({ type: "error", requestId, message: msg }));
          }
        } else {
          console.log("✅ inject_prompt aceptado por content script:", response);
        }
      });
    };

    console.log(`📤 Enviando inject_prompt al tab ${tabId}...`);
    sendPromptToTab(tabId);

  }
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ─── generation_complete: reenviar resultado al Bridge Server ───
  if (request.action === "generation_complete") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "response",
        requestId: request.requestId,
        content: request.content,
        platform: request.platform
      }));
    }
    return true; // async
  }

  // ─── cdp_click: clic nativo real via Chrome Debugger Protocol ───
  if (request.action === "cdp_click") {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: "sender.tab.id no disponible" });
      return true;
    }

    const { x, y } = request;
    if (typeof x !== "number" || typeof y !== "number") {
      sendResponse({ success: false, error: "Coordenadas x/y inválidas" });
      return true;
    }

    // Flujo CDP: attach → mouseMoved → mousePressed → mouseReleased → detach
    (async () => {
      const target = { tabId };
      try {
        await chrome.debugger.attach(target, "1.3");
      } catch (e) {
        console.error("❌ CDP attach failed:", e.message);
        sendResponse({ success: false, error: `attach failed: ${e.message}` });
        return;
      }

      try {
        const baseParams = { x, y, button: "left", clickCount: 1, modifiers: 0 };

        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          ...baseParams, type: "mouseMoved"
        });
        await new Promise(r => setTimeout(r, 30 + Math.random() * 30));

        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          ...baseParams, type: "mousePressed"
        });
        await new Promise(r => setTimeout(r, 60 + Math.random() * 60));

        await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
          ...baseParams, type: "mouseReleased"
        });

        console.log(`✅ CDP click ejecutado en (${Math.round(x)}, ${Math.round(y)}) tab=${tabId}`);
        sendResponse({ success: true });
      } catch (e) {
        console.error("❌ CDP dispatch failed:", e.message);
        sendResponse({ success: false, error: `dispatch failed: ${e.message}` });
      } finally {
        try {
          await chrome.debugger.detach(target);
        } catch (e) {
          console.warn("⚠️ CDP detach warning:", e.message);
        }
      }
    })();

    return true; // keep message channel open for async sendResponse
  }

  // ─── stream_progress: progreso parcial durante generación ───
  if (request.action === "stream_progress") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "progress",
        requestId: request.requestId,
        content: request.content,
      }));
    }
    return false; // fire-and-forget, no sendResponse needed
  }

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
