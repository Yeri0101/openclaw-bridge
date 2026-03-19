// gemini.js
// ZettaCore Adaptador para gemini.google.com
// Extiende LLMAdapter con los selectores específicos de la interfaz de Gemini.

(() => {
  'use strict';

  // Verificar que estamos en Gemini
  if (!window.location.hostname.includes('gemini.google.com')) return;

  const { deepQuerySelector, deepQuerySelectorAll, waitForElement } = window.ZettaShadowWalker;
  const { humanClick, randomDelay } = window.ZettaBlindProtocol;

  // Mapa de variante de modelo → texto que aparece en el menú de Gemini
  const VARIANT_LABELS = {
    fast:      'Fast',
    pro:       'Pro',
    reasoning: 'Reasoning',
    flash:     'Flash',  // por si aparece en alguna versión
  };

  class GeminiAdapter extends window.ZettaLLMAdapter {
    constructor(variant = 'fast') {
      super({
        platform: 'gemini',
        inputSelector: 'rich-textarea div[contenteditable="true"]',
        submitSelector: 'button.send-button, button[aria-label*="Send"], button[aria-label*="Enviar"]',
        responseSelector: null,
        maxWaitMs: 180000,
        pollInterval: 600,
      });
      this.variant = variant;
    }

    /**
     * Selecciona el modo de Gemini (Fast / Pro / Reasoning) antes de enviar el prompt.
     */
    async selectMode() {
      const targetLabel = VARIANT_LABELS[this.variant] || 'Fast';

      // Leer el modo actual
      const pillBtn = deepQuerySelector('[data-test-id="logo-pill-label-container"]');
      if (!pillBtn) {
        console.warn('[ZettaCore][gemini] ⚠️ No se encontró el selector de modo.');
        return;
      }

      const currentText = pillBtn.innerText.trim();
      if (currentText.toLowerCase().includes(targetLabel.toLowerCase())) {
        console.log(`[ZettaCore][gemini] ✅ Ya en modo "${targetLabel}", sin cambio.`);
        return;
      }

      console.log(`[ZettaCore][gemini] 🔄 Cambiando de "${currentText}" a "${targetLabel}"...`);
      await humanClick(pillBtn);
      await randomDelay(500, 900);

      // Esperar a que aparezca el menú desplegable
      // El menú suele renderizarse en un overlay con opciones tipo mat-option o botones con el texto del modo
      const menuSelectors = [
        `mat-option`,
        `.model-picker-option`,
        `[role="option"]`,
        `[role="menuitem"]`,
        `.mat-mdc-option`,
      ];

      let option = null;
      for (const sel of menuSelectors) {
        const candidates = deepQuerySelectorAll(sel);
        option = candidates.find(el => el.innerText?.trim().toLowerCase().includes(targetLabel.toLowerCase()));
        if (option) break;
      }

      if (option) {
        console.log(`[ZettaCore][gemini] 🎯 Opción "${targetLabel}" encontrada. Haciendo clic...`);
        await humanClick(option);
        await randomDelay(400, 700);
      } else {
        console.warn(`[ZettaCore][gemini] ⚠️ No se encontró la opción "${targetLabel}" en el menú.`);
        // Cerrar el menú pulsando Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    }

    /**
     * Override de handle: seleccionar modo antes de inyectar el prompt.
     */
    async handle(prompt, requestId) {
      if (this.variant !== 'fast') {
        await this.selectMode();
      }
      await super.handle(prompt, requestId);
    }

    /**
     * Detecta si Gemini ha terminado de generar.
     */
    isGenerationComplete() {
      const stopBtn = deepQuerySelector('button[aria-label*="Stop"], button.stop-button');
      const responses = deepQuerySelectorAll(
        'model-response, .response-container, [data-response-index], message-content'
      );

      if (stopBtn && !stopBtn.disabled) return false;
      if (responses.length === 0) return false;

      const lastResponse = responses[responses.length - 1];
      const actions = deepQuerySelector('.response-actions, [aria-label*="Copy"], .trailing-actions', lastResponse);
      return !!actions;
    }

    /**
     * Extrae el texto de la última respuesta de Gemini.
     */
    extractResponse() {
      const selectors = [
        'model-response .markdown',
        '.response-container-scrollable .model-response-text p',
        'message-content .markdown-main-panel',
        '[data-response-index] .response-text',
        '.conversation-container model-response',
      ];

      for (const sel of selectors) {
        const elements = deepQuerySelectorAll(sel);
        if (elements.length > 0) {
          const lastSet = Array.from(elements).slice(-20);
          const text = lastSet.map(el => el.innerText || el.textContent).join('\n').trim();
          if (text) return text;
        }
      }

      const modelResponse = deepQuerySelector('model-response');
      if (modelResponse) {
        return modelResponse.innerText || modelResponse.textContent || '';
      }

      return '[ZettaCore] No se pudo extraer la respuesta de Gemini.';
    }
  }

  // Registrar el adaptador. El variant se recibe via el mensaje inject_prompt.
  // Se crea con 'fast' por defecto y puede ser reemplazado con la variant correcta.
  window.ZettaGeminiAdapterClass = GeminiAdapter;
  window.ZettaActiveAdapter = new GeminiAdapter('fast');
  console.log('[ZettaCore] gemini.js — Adaptador activo ✅ en', window.location.href);
})();
