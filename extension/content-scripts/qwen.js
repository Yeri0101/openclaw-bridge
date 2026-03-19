// qwen.js
// ZettaCore Adaptador para chat.qwenlm.ai (Qwen AI de Alibaba)
// Extiende LLMAdapter con los selectores específicos de la interfaz de Qwen.

(() => {
  'use strict';

  // Verificar que estamos en Qwen
  if (!window.location.hostname.includes('qwenlm.ai')) return;

  class QwenAdapter extends window.ZettaLLMAdapter {
    constructor() {
      super({
        platform: 'qwen',
        // Qwen usa un textarea estándar o un contenteditable
        inputSelector: 'textarea#chat-input, div[contenteditable="true"].chat-input, textarea[placeholder], div[contenteditable="true"]',
        submitSelector: 'button[type="submit"], button.send-btn, button[aria-label*="Send"], button[aria-label*="send"]',
        stopSelector: 'button.stop-btn, button[aria-label*="Stop"]',
        maxWaitMs: 120000, // 2 minutos
        pollInterval: 600,
      });

      this._lastLength = 0;
      this._stableCount = 0;
    }

    /**
     * Qwen: override para manejar tanto textarea como contenteditable.
     * Qwen también puede tener un botón de envío con ícono.
     */
    async submitPrompt(inputEl) {
      const { randomDelay, pressCtrlEnter, humanClick } = window.ZettaBlindProtocol;
      const { waitForElement } = window.ZettaShadowWalker;

      await randomDelay(400, 700);

      // Intentar botón submit
      try {
        const btn = await waitForElement(this.selectors.submitBtn, 4000);
        if (btn && !btn.disabled && !btn.classList.contains('disabled')) {
          await humanClick(btn);
          return;
        }
      } catch (e) {
        console.warn('[qwen] Botón no encontrado, usando Enter');
      }

      // Fallback: Enter simple (Qwen suele enviarse con Enter)
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
      }));
    }

    /**
     * Detecta si Qwen terminó de generar.
     * Señal: desaparece el indicador de loading/typing y el botón stop.
     */
    isGenerationComplete() {
      // Si hay un botón de stop visible → aún generando
      const stopBtn = document.querySelector('button.stop-btn, [class*="stop"], button[aria-label*="Stop"]');
      if (stopBtn && stopBtn.offsetParent !== null) return false;

      // Verificar el estado del indicador de typing
      const typingIndicator = document.querySelector(
        '[class*="typing"], [class*="loading"], [class*="generating"], .dot-flashing'
      );
      if (typingIndicator && typingIndicator.offsetParent !== null) return false;

      // Verificar estabilidad del contenido
      const messages = document.querySelectorAll(
        '.chat-message.assistant, [class*="message-content"], .message-bubble:not(.user)'
      );
      if (messages.length === 0) return false;

      const lastMsg = messages[messages.length - 1];
      const currentLength = lastMsg.innerText?.length || 0;

      if (currentLength === this._lastLength) {
        this._stableCount++;
      } else {
        this._lastLength = currentLength;
        this._stableCount = 0;
      }

      return currentLength > 5 && this._stableCount >= 3;
    }

    /**
     * Extrae el texto de la última respuesta de Qwen.
     */
    extractResponse() {
      // Selectores por orden de prioridad
      const selectors = [
        '.chat-message.assistant .message-content',
        '[data-testid*="assistant"] .message-text',
        '.message-bubble:not(.user):not(.human)',
        '[class*="bot-message"] [class*="content"]',
        '[class*="assistant"] [class*="text"]',
      ];

      for (const sel of selectors) {
        const msgs = document.querySelectorAll(sel);
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const text = last.innerText || last.textContent;
          if (text && text.trim()) return text.trim();
        }
      }

      // Fallback: buscar cualquier burbuja de mensaje que no sea del usuario
      const allMessages = document.querySelectorAll('[class*="message"]');
      let lastAssistant = null;
      for (const msg of allMessages) {
        const classes = msg.className.toLowerCase();
        const isUser = classes.includes('user') || classes.includes('human') || classes.includes('me');
        if (!isUser) lastAssistant = msg;
      }

      if (lastAssistant) return lastAssistant.innerText?.trim() || '[ZettaCore] Respuesta vacía.';

      return '[ZettaCore] No se pudo extraer respuesta de Qwen.';
    }
  }

  // Registrar adaptador activo
  window.ZettaActiveAdapter = new QwenAdapter();
  console.log('[ZettaCore] qwen.js — Adaptador activo ✅ en', window.location.href);
})();
