// chatgpt.js
// ZettaCore Adaptador para chatgpt.com
// Extiende LLMAdapter con los selectores específicos de la interfaz de ChatGPT.

(() => {
  'use strict';

  // Verificar que estamos en ChatGPT
  if (!window.location.hostname.includes('chatgpt.com')) return;

  class ChatGPTAdapter extends window.ZettaLLMAdapter {
    constructor() {
      super({
        platform: 'chatgpt',
        inputSelector: '#prompt-textarea, div[contenteditable="true"][data-testid*="prompt"]',
        submitSelector: 'button[data-testid="send-button"], button[aria-label*="Send message"]',
        stopSelector: 'button[aria-label*="Stop"], button[data-testid="stop-button"]',
        maxWaitMs: 180000,
        pollInterval: 700,
      });

      // Estado interno para detectar fin de generación
      this._lastResponseLength = 0;
      this._stableCount = 0;
    }

    /**
     * Detecta si ChatGPT ha terminado de generar.
     * Estrategia: el botón "Stop" desaparece y el botón "Send" reaparece.
     */
    isGenerationComplete() {
      // Si el botón de stop ya no existe o está oculto → terminó
      const stopBtn = document.querySelector('button[aria-label*="Stop"], button[data-testid="stop-button"]');
      if (stopBtn) return false; // Aún está generando

      // Verificar que el botón de send está de vuelta
      const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send message"]');
      if (!sendBtn) return false;

      // Verificar que hay contenido en la última respuesta
      const articles = document.querySelectorAll('article[data-testid*="conversation-turn"]');
      if (articles.length === 0) return false;

      const lastArticle = articles[articles.length - 1];
      // El último turno debería ser del asistente
      const isAssistant = lastArticle.getAttribute('data-testid')?.includes('assistant');
      
      // Verificar estabilidad de la respuesta (que no está cambiando)
      const currentLength = lastArticle.innerText?.length || 0;
      if (currentLength === this._lastResponseLength) {
        this._stableCount++;
      } else {
        this._lastResponseLength = currentLength;
        this._stableCount = 0;
      }

      return currentLength > 10 && this._stableCount >= 2;
    }

    /**
     * Extrae el texto de la última respuesta del asistente.
     */
    extractResponse() {
      // Los artículos de conversación en ChatGPT
      const articles = document.querySelectorAll('article[data-testid*="conversation-turn"]');
      if (articles.length === 0) {
        // Fallback para versiones antiguas de UI
        const msgs = document.querySelectorAll('.markdown.prose');
        if (msgs.length > 0) {
          return msgs[msgs.length - 1].innerText.trim();
        }
        return '[ZettaCore] No se pudo extraer la respuesta de ChatGPT.';
      }

      // Buscar el último mensaje del asistente
      for (let i = articles.length - 1; i >= 0; i--) {
        const article = articles[i];
        const testId = article.getAttribute('data-testid') || '';
        if (testId.includes('assistant') || !testId.includes('user')) {
          // Extraer el contenido markdown
          const prose = article.querySelector('.markdown, .prose, [data-message-author-role="assistant"]');
          if (prose) return prose.innerText.trim();
          
          // Fallback: todo el texto del artículo
          const text = article.innerText.trim();
          if (text) return text;
        }
      }

      return '[ZettaCore] No se encontró respuesta del asistente en ChatGPT.';
    }
  }

  // Registrar el adaptador como activo para esta pestaña
  window.ZettaActiveAdapter = new ChatGPTAdapter();
  console.log('[ZettaCore] chatgpt.js — Adaptador activo ✅ en', window.location.href);
})();
