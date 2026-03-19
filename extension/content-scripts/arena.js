// arena.js
// ZettaCore Adaptador para arena.ai/text/direct

(() => {
  'use strict';

  // Solo ejecutar si estamos en arena.ai
  if (!window.location.hostname.includes('arena.ai')) return;

  const { deepQuerySelector, deepQuerySelectorAll } = window.ZettaShadowWalker;
  const { humanClick, randomDelay } = window.ZettaBlindProtocol;

  class ArenaAdapter extends window.ZettaLLMAdapter {
    constructor(variant = 'default') {
      super({
        platform: 'arena',
        // Selector genérico para el input en la mayoría de chats, lo iremos ajustando
        inputSelector: 'textarea, div[contenteditable="true"]',
        submitSelector: 'button[type="submit"], button[aria-label*="Send"]',
        responseSelector: null,
        maxWaitMs: 180000,
        pollInterval: 600,
      });
      this.variant = variant; // Nombre del modelo (ej. claude-opus-4)
    }

    /**
     * Selecciona el modelo en Arena usando el botón del selector.
     */
    async selectMode() {
      if (this.variant === 'default') return;

      const targetLabel = this.variant;
      // Normalizar: quitar guiones, espacios, etc para hacer un match más flexible
      const normalize = (str) => str ? str.toLowerCase().replace(/[-_ .]/g, '') : '';
      const normTarget = normalize(targetLabel);

      // 1. Encontrar el botón que abre el selector de modelos
      const pickerBtn = deepQuerySelector('button[aria-haspopup="dialog"], button[aria-controls^="radix-"]');
      if (!pickerBtn) {
        console.warn(`[ZettaCore][arena] ⚠️ No se encontró el botón de selección de modelo.`);
        return;
      }

      // Ver el modelo actual
      const currentSpan = pickerBtn.querySelector('span.truncate, span');
      const currentText = currentSpan ? currentSpan.innerText.trim() : pickerBtn.innerText.trim();
      
      if (normalize(currentText).includes(normTarget)) {
        console.log(`[ZettaCore][arena] ✅ Ya en modelo "${currentText}", sin cambio.`);
        return;
      }

      console.log(`[ZettaCore][arena] 🔄 Cambiando de "${currentText}" a "${targetLabel}"...`);
      await humanClick(pickerBtn);

      // Esperar activamente a que aparezcan las opciones del menú
      const menuOptionSelectors = [
        '[role="option"]', '.model-picker-option', '[role="menuitem"]', 'button, div'
      ];

      let option = null;
      const deadline = Date.now() + 3000;

      while (!option && Date.now() < deadline) {
        await randomDelay(200, 200);
        // Buscar el menú (usualmente se renderiza al final del body en un div de radix o similar)
        const dialogs = deepQuerySelectorAll('[role="dialog"], [id^="radix-"], .cmdk-list');
        
        // Juntar todas las opciones
        const options = [];
        for (const dialog of dialogs) {
          dialog.querySelectorAll('[role="option"], button, li, .cmdk-item').forEach(el => options.push(el));
        }

        // Si no encontró dialogs, buscar directamente en el document (a veces está en un portal genérico)
        if (options.length === 0) {
           document.querySelectorAll('[role="option"], .cmdk-item').forEach(el => options.push(el));
        }

        option = options.find(el => normalize(el.innerText || el.textContent).includes(normTarget));
      }

      if (option) {
        console.log(`[ZettaCore][arena] 🎯 Modelo "${targetLabel}" encontrado en la lista. Haciendo clic...`);
        await humanClick(option);
        await randomDelay(400, 700);
      } else {
        console.warn(`[ZettaCore][arena] ⚠️ No se encontró el modelo "${targetLabel}" en la lista después de 3s.`);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    }

    async handle(prompt, requestId) {
      if (this.variant !== 'default') {
        await this.selectMode();
      }
      await super.handle(prompt, requestId);
    }

    isGenerationComplete() {
      // Como lógica inicial para Arena, buscaremos un botón "Stop" (si lo hay) o los botones de "Copy" abajo del mensaje
      const stopBtn = deepQuerySelector('button[aria-label*="Stop"]');
      if (stopBtn && !stopBtn.disabled && stopBtn.offsetParent !== null) return false;

      // Botón "Copy"
      const copyBtns = document.querySelectorAll('button[aria-label*="Copy"], svg[class*="lucide-copy"]');
      if (copyBtns.length > 0) return true;

      // Por defecto fallback simple
      return false; // se mejorará cuando veamos el HTML exacto de la respuesta
    }

    extractResponse() {
      // Como primer intento, buscar bloques markdown o texto dentro del contenedor de chat
      const responses = deepQuerySelectorAll('.prose, .markdown, [dir="auto"]');
      if (responses.length > 0) {
        const lastSet = Array.from(responses).slice(-2);
        const text = lastSet.map(el => el.innerText || el.textContent).join('\n').trim();
        if (text) return text;
      }
      return '[ZettaCore] No se pudo extraer la respuesta (se necesita ajustar selectores de Arena).';
    }
  }

  window.ZettaArenaAdapterClass = ArenaAdapter;
  window.ZettaActiveAdapter = new ArenaAdapter('default');
  console.log('[ZettaCore] arena.js — Adaptador activo ✅ en', window.location.href);
})();
