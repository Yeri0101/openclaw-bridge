// common.js
// ZettaCore LLMAdapter Base Class
// Orquesta el flujo completo: recibir orden → inyectar prompt → esperar respuesta → extraerla.
// Los adaptadores específicos (gemini.js, chatgpt.js, qwen.js) extienden esta clase.

(() => {
  'use strict';

  const { deepQuerySelector, waitForElement } = window.ZettaShadowWalker;
  const { wakeUpField, humanType, humanClick, cdpClick, pressCtrlEnter, randomDelay } = window.ZettaBlindProtocol;

  class LLMAdapter {
    constructor(config) {
      // Cada adaptador específico debe proveer estos selectores
      this.selectors = {
        input: config.inputSelector,         // Selector del campo de texto
        submitBtn: config.submitSelector,    // Selector del botón de envío
        response: config.responseSelector,  // Selector del contenedor de respuesta
        stopBtn: config.stopSelector || null, // Selector del botón "Stop generating"
      };
      this.platform = config.platform;
      this.maxWaitMs = config.maxWaitMs || 120000; // 2 min máximo por defecto
      this.pollInterval = config.pollInterval || 500;
    }

    /**
     * PASO 1: Encontrar y preparar el campo de input.
     */
    async getInputElement() {
      try {
        const el = await waitForElement(this.selectors.input, 15000);
        return el;
      } catch (e) {
        throw new Error(`[${this.platform}] No se encontró el campo de input: ${this.selectors.input}`);
      }
    }

    /**
     * PASO 2: Limpiar el campo de input (por si tenía contenido previo).
     */
    async clearInput(inputEl) {
      inputEl.focus();
      await randomDelay(100, 200);
      // Ctrl+A → Delete
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
      await randomDelay(30, 60);
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }));
      await randomDelay(50, 100);
    }

    /**
     * PASO 3: Escribir el prompt usando el Blind Protocol.
     */
    async injectText(inputEl, prompt) {
      await wakeUpField(inputEl);
      await humanType(inputEl, prompt);
    }

    /**
     * PASO 4: Enviar el prompt (intenta botón primero, luego Ctrl+Enter).
     */
    async submitPrompt(inputEl) {
      await randomDelay(300, 600);

      if (this.selectors.submitBtn) {
        try {
          const btn = await waitForElement(this.selectors.submitBtn, 3000);
          if (btn && !btn.disabled) {
            await humanClick(btn);
            return;
          }
        } catch (e) {
          console.warn(`[${this.platform}] Botón submit no encontrado, usando Ctrl+Enter`);
        }
      }

      // Fallback: Ctrl+Enter
      await pressCtrlEnter(inputEl);
    }

    /**
     * PASO 5 (abstracto): Detectar si la generación ha terminado.
     * Los adaptadores específicos deben implementar esta lógica.
     * @returns {boolean}
     */
    isGenerationComplete() {
      throw new Error(`[${this.platform}] isGenerationComplete() debe ser implementado por el adaptador`);
    }

    /**
     * PASO 6 (abstracto): Extraer el texto de la respuesta del DOM.
     * @returns {string}
     */
    extractResponse() {
      throw new Error(`[${this.platform}] extractResponse() debe ser implementado por el adaptador`);
    }

    /**
     * Polling: espera hasta que la generación haya terminado.
     */
    async waitForCompletion(requestId) {
      const startTime = Date.now();
      const PROGRESS_EVERY_N_POLLS = 5; // reportar cada ~3s con pollInterval=600ms
      let pollCount = 0;

      // Esperar un poco antes de empezar a hacer polling (para que empiece a generar)
      await new Promise(r => setTimeout(r, 1500));

      return new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          try {
            pollCount++;

            // Reportar progreso parcial cada N polls (no bloquea el flujo)
            if (pollCount % PROGRESS_EVERY_N_POLLS === 0 && requestId) {
              try {
                const partialContent = this.extractResponse();
                if (partialContent && partialContent.length > 0) {
                  chrome.runtime.sendMessage({
                    action: 'stream_progress',
                    requestId,
                    content: partialContent,
                  });
                }
              } catch (_) { /* ignorar errores de extracción parcial */ }
            }

            if (this.isGenerationComplete()) {
              clearInterval(poll);
              resolve();
            } else if (Date.now() - startTime > this.maxWaitMs) {
              clearInterval(poll);
              reject(new Error(`[${this.platform}] Timeout: la generación tardó más de ${this.maxWaitMs / 1000}s`));
            }
          } catch (e) {
            clearInterval(poll);
            reject(e);
          }
        }, this.pollInterval);
      });
    }

    /**
     * Método principal: orquesta todo el flujo de inyección y extracción.
     * @param {string} prompt
     * @param {string} requestId
     */
    async handle(prompt, requestId, settings = {}) {
      console.log(`[ZettaCore][${this.platform}] Iniciando handle() para requestId: ${requestId}`);
      
      try {
        const inputEl = await this.getInputElement();
        await this.clearInput(inputEl);
        await this.injectText(inputEl, prompt);
        await this.submitPrompt(inputEl);
        
        console.log(`[ZettaCore][${this.platform}] Prompt enviado, esperando respuesta...`);
        await this.waitForCompletion(requestId);
        
        const responseText = this.extractResponse();
        console.log(`[ZettaCore][${this.platform}] Respuesta extraída (${responseText.length} chars)`);

        // Notificar al service worker
        chrome.runtime.sendMessage({
          action: 'generation_complete',
          requestId,
          content: responseText,
          platform: this.platform,
        });

      } catch (error) {
        console.error(`[ZettaCore][${this.platform}] Error en handle():`, error.message);
        chrome.runtime.sendMessage({
          action: 'generation_complete',
          requestId,
          content: null,
          error: error.message,
          platform: this.platform,
        });
      }
    }
  }

  // Exponer la clase base globalmente
  window.ZettaLLMAdapter = LLMAdapter;
  console.log('[ZettaCore] common.js (LLMAdapter) cargado ✅');

  // ─────────────────────────────────────────────────────────────────────────────
  // LISTENER CENTRAL: recibe órdenes del service-worker
  // ─────────────────────────────────────────────────────────────────────────────
  // Este listener se activa cuando el service-worker envía "inject_prompt".
  // Cada adaptador se registra a sí mismo con window.ZettaActiveAdapter.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'inject_prompt') {
      const { prompt, requestId, variant, settings } = message;
      console.log(`[ZettaCore] Recibido inject_prompt (id: ${requestId}, variant: ${variant || 'default'})`);

      if (!window.ZettaActiveAdapter) {
        const errMsg = '[ZettaCore] No hay adaptador activo registrado en esta pestaña.';
        console.error(errMsg);
        chrome.runtime.sendMessage({
          action: 'generation_complete',
          requestId,
          content: null,
          error: errMsg,
        });
        return;
      }

      // Para Gemini y Arena: crear instancia con la variante del modelo si se especificó
      let adapter = window.ZettaActiveAdapter;
      if (variant) {
        if (window.ZettaGeminiAdapterClass && adapter instanceof window.ZettaGeminiAdapterClass) {
          adapter = new window.ZettaGeminiAdapterClass(variant);
          window.ZettaActiveAdapter = adapter; // actualizar instancia global
        } else if (window.ZettaArenaAdapterClass && adapter instanceof window.ZettaArenaAdapterClass) {
          adapter = new window.ZettaArenaAdapterClass(variant);
          window.ZettaActiveAdapter = adapter; // actualizar instancia global
        }
      }

      // Ejecutar de forma asíncrona (no bloquear el listener)
      adapter.handle(prompt, requestId, settings || {});
      sendResponse({ status: 'accepted' });
    }
    return true; // Mantener canal abierto para respuesta asíncrona
  });
})();
