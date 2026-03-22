// gemini.js
// ZettaCore Adaptador para gemini.google.com
// Extiende LLMAdapter con los selectores específicos de la interfaz de Gemini.

(() => {
  'use strict';

  // Verificar que estamos en Gemini
  if (!window.location.hostname.includes('gemini.google.com')) return;

  const { deepQuerySelector, deepQuerySelectorAll, waitForElement } = window.ZettaShadowWalker;
  const { humanClick, randomDelay } = window.ZettaBlindProtocol;

  // Mapa de variante → lista de labels posibles en el UI de Gemini.
  // El UI puede estar en español o inglés según la configuración del usuario.
  // NOMENCLATURA REAL (Gemini 3): Fast | Razonamiento | Pro
  const VARIANT_LABELS = {
    fast:      ['Fast', 'Rápido'],
    flash:     ['Flash', 'Fast', 'Rápido'],  // Flash = modo Fast en Gemini 3
    pro:       ['Pro'],
    reasoning: ['Razonamiento', 'Reasoning', 'Thinking', 'Think'],
    // Aliases de nombres completos (backward compat)
    'gemini-2.0-flash': ['Flash', 'Fast', 'Rápido'],
    'gemini-2.5-pro':   ['Pro'],
    'gemini-reasoning': ['Razonamiento', 'Reasoning', 'Thinking'],
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
      // VARIANT_LABELS ahora es un array de posibles textos
      const labels = VARIANT_LABELS[this.variant];
      if (!labels) return; // variante desconocida, no cambiar

      // Leer el modo actual del pill
      const pillBtn = deepQuerySelector('[data-test-id="logo-pill-label-container"]');
      if (!pillBtn) {
        console.warn('[ZettaCore][gemini] ⚠️ No se encontró el selector de modo.');
        return;
      }

      const currentText = pillBtn.innerText.trim();
      // Ya está en el modo correcto si coincide con alguno de los labels
      const alreadyCorrect = labels.some(l => currentText.toLowerCase().includes(l.toLowerCase()));
      if (alreadyCorrect) {
        console.log(`[ZettaCore][gemini] ✅ Ya en modo "${currentText}", sin cambio.`);
        return;
      }

      console.log(`[ZettaCore][gemini] 🔄 Cambiando de "${currentText}" a "${labels[0]}"...`);
      await humanClick(pillBtn);

      // Esperar activamente a que aparezcan las opciones del menú (hasta 3s)
      const menuOptionSelectors = [
        'mat-option', '.mat-mdc-option', '[role="option"]', '[role="menuitem"]', 
        '.model-picker-option', 'mat-list-item', 'span.gds-body-m', '.gds-body-m',
        '[data-test-id*="model-"]'
      ];

      let option = null;
      const deadline = Date.now() + 3000;

      while (!option && Date.now() < deadline) {
        await randomDelay(200, 200);
        for (const sel of menuOptionSelectors) {
          // Buscar tanto en shadow DOM como directamente en document.body
          const fromShadow = deepQuerySelectorAll(sel);
          const fromBody = Array.from(document.querySelectorAll(sel));
          const candidates = [...new Set([...fromShadow, ...fromBody])];
        // Buscar la opción que coincida con cualquiera de los labels posibles
        option = candidates.find(el =>
          labels.some(l => el.innerText?.trim().toLowerCase().includes(l.toLowerCase()))
        );
          if (option) break;
        }
      }

      if (option) {
        console.log(`[ZettaCore][gemini] 🎯 Opción "${targetLabel}" encontrada. Haciendo clic...`);
        await humanClick(option);
        await randomDelay(600, 300);

        // ── Verificación post-clic: confirmar que el pill cambió ──
        const newText = pillBtn.innerText?.trim() || '';
        const confirmed = labels.some(l => newText.toLowerCase().includes(l.toLowerCase()));
        if (!confirmed) {
          await randomDelay(400, 200);
          const newPill = deepQuerySelector('[data-test-id="logo-pill-label-container"]');
          const confirmedText = newPill?.innerText?.trim() || '';
          const confirmedRetry = labels.some(l => confirmedText.toLowerCase().includes(l.toLowerCase()));
          if (!confirmedRetry) {
            throw new Error(
              `Modo "${labels[0]}" no confirmado tras selección. Pill actual: "${confirmedText || newText}"`
            );
          }
        }
        console.log(`[ZettaCore][gemini] ✅ Modo confirmado: "${pillBtn.innerText?.trim()}"`);
      } else {
        // Cerrar el menú y lanzar error real — no continuar con Fast
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        throw new Error(
          `Ninguno de los labels ${JSON.stringify(labels)} encontrado en el menú de Gemini después de 3s.`
        );
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
      // Señal 1: el botón "Stop" desaparece cuando Gemini termina de generar
      const stopBtn = deepQuerySelector(
        'button[aria-label*="Stop"], button[aria-label*="Detener"], button.stop-button'
      );

      // Si el botón Stop está visible y activo → aún generando
      if (stopBtn && !stopBtn.disabled && stopBtn.offsetParent !== null) return false;

      // Necesitamos al menos una respuesta en el DOM
      const responses = deepQuerySelectorAll(
        'model-response, message-content, [data-response-index]'
      );
      if (responses.length === 0) return false;

      // Señal 2: botón de copiar aparece en cualquier parte del Doc (fuera del model-response)
      const copyBtn = document.querySelector(
        'button[aria-label*="Copy"], button[aria-label*="Copiar"], [data-test-id="copy-button"]'
      );
      if (copyBtn) return true;

      // Señal 3: si el Stop desapareció completamente y hay respuesta → asumir completo
      if (!stopBtn && responses.length > 0) return true;

      return false;
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
