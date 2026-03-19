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
        inputSelector: 'rich-textarea div[contenteditable="true"]',
        submitSelector: 'button.send-button, button[aria-label*="Send"], button[aria-label*="Enviar"]',
        responseSelector: null,
        maxWaitMs: 180000,
        pollInterval: 600,
      });

      // Diagnóstico: verificar selector del campo de texto en el DOM
      const inputCheck = deepQuerySelector('rich-textarea div[contenteditable="true"]');
      console.log('[ZettaCore][gemini] 🔍 Campo de input encontrado:', !!inputCheck, inputCheck);
    }

    /**
     * Detecta si Gemini ha terminado de generar.
     * Señales de "terminado": el botón "Stop" desaparece y aparece el botón de regenerar.
     */
    isGenerationComplete() {
      const stopBtn = deepQuerySelector('button[aria-label*="Stop"], button.stop-button');
      const responses = deepQuerySelectorAll(
        'model-response, .response-container, [data-response-index], message-content'
      );
      console.log('[ZettaCore][gemini] 🔁 Polling — stopBtn:', !!stopBtn, '| responses:', responses.length);

      if (stopBtn && !stopBtn.disabled) return false;
      if (responses.length === 0) return false;

      const lastResponse = responses[responses.length - 1];
      const actions = deepQuerySelector('.response-actions, [aria-label*="Copy"], .trailing-actions', lastResponse);
      console.log('[ZettaCore][gemini] ❓ actions found:', !!actions);
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
