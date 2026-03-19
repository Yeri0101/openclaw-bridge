// gemini.js
// ZettaCore Adaptador para gemini.google.com
// Extiende LLMAdapter con los selectores específicos de la interfaz de Gemini.

(() => {
  'use strict';

  // Verificar que estamos en Gemini
  if (!window.location.hostname.includes('gemini.google.com')) return;

  const { deepQuerySelector, deepQuerySelectorAll } = window.ZettaShadowWalker;

  class GeminiAdapter extends window.ZettaLLMAdapter {
    constructor() {
      super({
        platform: 'gemini',
        // Gemini usa un rich-textarea dentro de un Shadow DOM
        inputSelector: 'rich-textarea div[contenteditable="true"]',
        submitSelector: 'button.send-button, button[aria-label*="Send"], button[aria-label*="Enviar"]',
        responseSelector: null, // Manejado en extractResponse() con lógica custom
        maxWaitMs: 180000, // 3 minutos para respuestas largas
        pollInterval: 600,
      });
    }

    /**
     * Detecta si Gemini ha terminado de generar.
     * Señales de "terminado": el botón "Stop" desaparece y aparece el botón de regenerar.
     */
    isGenerationComplete() {
      // Botón de "Stop" activo = aún generando
      const stopBtn = deepQuerySelector('button[aria-label*="Stop"], button.stop-button');
      if (stopBtn && !stopBtn.disabled) return false;

      // Verificar que haya al menos una respuesta completa renderizada
      const responses = deepQuerySelectorAll(
        'model-response, .response-container, [data-response-index], message-content'
      );
      
      if (responses.length === 0) return false;

      // La última respuesta debe tener el bloque de acciones (copy, like, etc.)
      const lastResponse = responses[responses.length - 1];
      const actions = deepQuerySelector('.response-actions, [aria-label*="Copy"], .trailing-actions', lastResponse);
      return !!actions;
    }

    /**
     * Extrae el texto de la última respuesta de Gemini.
     */
    extractResponse() {
      // Intentar con múltiples selectores por versiones de UI
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
          // Tomar los últimos elementos (la respuesta más reciente)
          const lastSet = Array.from(elements).slice(-20);
          const text = lastSet.map(el => el.innerText || el.textContent).join('\n').trim();
          if (text) return text;
        }
      }

      // Fallback: deepQuerySelector en Shadow DOM
      const modelResponse = deepQuerySelector('model-response');
      if (modelResponse) {
        return modelResponse.innerText || modelResponse.textContent || '';
      }

      return '[ZettaCore] No se pudo extraer la respuesta de Gemini.';
    }
  }

  // Registrar el adaptador como el activo para esta pestaña
  window.ZettaActiveAdapter = new GeminiAdapter();
  console.log('[ZettaCore] gemini.js — Adaptador activo ✅ en', window.location.href);
})();
