// arena.js
// ZettaCore Adaptador para arena.ai/text/direct

(() => {
  'use strict';

  // Solo ejecutar si estamos en arena.ai
  if (!window.location.hostname.includes('arena.ai')) return;

  const { deepQuerySelector, deepQuerySelectorAll } = window.ZettaShadowWalker;
  const { humanClick, cdpClick, randomDelay } = window.ZettaBlindProtocol;

  class ArenaAdapter extends window.ZettaLLMAdapter {
    constructor(variant = 'default') {
      super({
        platform: 'arena',
        inputSelector: 'textarea[name="message"]',
        submitSelector: null, // Se maneja manualmente en submitPrompt
        responseSelector: null,
        maxWaitMs: 180000,
        pollInterval: 800,
      });
      this.variant = variant;
      this._lastResponseLength = 0;
      this._stableCount = 0;
    }

    /**
     * Selecciona el modelo en Arena usando el botón del selector.
     */
    async selectMode() {
      if (this.variant === 'default') return;

      const targetLabel = this.variant;
      const normalize = (str) => str ? str.toLowerCase().replace(/[-_ .]/g, '') : '';
      const normTarget = normalize(targetLabel);

      // Buscar botón de selección de modelo: tiene aria-haspopup="dialog" y texto visible
      const allBtns = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'));
      const pickerBtn = allBtns.find(b => {
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        // Excluir botones de modo de chat (Direct, Side-by-side, Battle)
        const isModeSelector = txt === 'direct' || txt.includes('side') || txt === 'battle';
        return !isModeSelector && b.offsetWidth > 0 && b.offsetHeight > 0;
      });

      if (!pickerBtn) {
        console.warn(`[ZettaCore][arena] ⚠️ No se encontró el botón de selección de modelo.`);
        return;
      }

      const currentText = (pickerBtn.innerText || pickerBtn.textContent || '').trim();
      if (normalize(currentText).includes(normTarget)) {
        console.log(`[ZettaCore][arena] ✅ Ya en modelo "${currentText}", sin cambio.`);
        return;
      }

      console.log(`[ZettaCore][arena] 🔄 Cambiando de "${currentText}" a "${targetLabel}"...`);
      await cdpClick(pickerBtn);

      // Esperar al menú de selección de modelo (Radix dialog/popover)
      let option = null;
      const deadline = Date.now() + 5000;

      while (!option && Date.now() < deadline) {
        await randomDelay(250, 250);

        // Colectar todos los posibles contenedores del menú
        const containers = [
          ...document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"], [data-radix-popper-content-wrapper]'),
          ...document.querySelectorAll('[id^="radix-"], .cmdk-list, [data-state="open"]'),
        ];

        const options = [];
        for (const c of containers) {
          c.querySelectorAll('[role="option"], [role="menuitem"], button, li, .cmdk-item, [data-value]')
            .forEach(el => options.push(el));
        }

        // Fallback: buscar directamente en el document
        if (options.length === 0) {
          document.querySelectorAll('[role="option"], [role="menuitem"], .cmdk-item').forEach(el => options.push(el));
        }

        // 1. Coincidencia exacta normalizada
        option = options.find(el => {
          const text = (el.innerText || el.textContent || '').trim();
          return text && normalize(text) === normTarget;
        });

        // 2. Inclusión parcial
        if (!option) {
          option = options.find(el => {
            const text = (el.innerText || el.textContent || '').trim();
            return text && normalize(text).includes(normTarget);
          });
        }
      }

      if (option) {
        console.log(`[ZettaCore][arena] 🎯 Modelo "${targetLabel}" encontrado. Seleccionando...`);
        // Re-medir el elemento justo antes del clic (el layout pudo cambiar al abrirse el menú)
        await randomDelay(80, 120);
        await cdpClick(option);
        await randomDelay(600, 900);
      } else {
        console.warn(`[ZettaCore][arena] ⚠️ Modelo "${targetLabel}" no encontrado después de 5s. Continuando con el modelo actual.`);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await randomDelay(300, 400);
      }
    }

    async handle(prompt, requestId) {
      if (this.variant !== 'default') {
        await this.selectMode();
      }
      // Reset contadores de detección de respuesta
      this._lastResponseLength = 0;
      this._stableCount = 0;
      await super.handle(prompt, requestId);
    }

    /**
     * Detecta si Arena terminó de generar.
     * Estrategia multi-señal:
     * 1. Existe botón "Stop" visible → generando
     * 2. El contenido de la respuesta lleva N polls sin cambiar → terminado
     * 3. Aparece botón de feedback/copy/thumb → terminado
     */
    isGenerationComplete() {
      // Señal 1: Botón de Stop visible = aún generando
      const stopSelectors = [
        'button[aria-label*="Stop"]',
        'button[aria-label*="stop"]',
        'button[data-testid*="stop"]',
      ];
      for (const sel of stopSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetParent !== null) {
          this._stableCount = 0;
          return false;
        }
      }

      // Señal 2: Buscar el SVG de stop (cuadrado) que Arena usa durante generación
      // Durante generación: el botón de envío se convierte en botón de stop con ícono cuadrado
      const allBtns = Array.from(document.querySelectorAll('button'));
      const hasStopIcon = allBtns.some(b => {
        if (b.disabled || b.offsetParent === null) return false;
        const svg = b.querySelector('svg');
        if (!svg) return false;
        // Stop icon en Lucide: lucide-square o similar
        const svgClass = svg.getAttribute('class') || '';
        return svgClass.includes('square') || svgClass.includes('stop') || svgClass.includes('lucide-square');
      });
      if (hasStopIcon) {
        this._stableCount = 0;
        return false;
      }

      // Señal 3: Detectar botones de acción post-respuesta (copy, feedback, thumbs)
      const postResponseSelectors = [
        'button[aria-label*="Copy"]',
        'button[aria-label*="copy"]',
        'button[aria-label*="thumb"]',
        'button[aria-label*="Like"]',
        'button[aria-label*="Dislike"]',
        'button[aria-label*="Regenerate"]',
        'button[data-testid*="copy"]',
        'button[data-testid*="feedback"]',
      ];

      let hasPostResponseBtn = false;
      for (const sel of postResponseSelectors) {
        const btns = document.querySelectorAll(sel);
        if (btns.length > 0) {
          hasPostResponseBtn = true;
          break;
        }
      }

      // También buscar SVG de copy (lucide-copy)
      if (!hasPostResponseBtn) {
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
          const cls = svg.getAttribute('class') || '';
          if (cls.includes('lucide-copy') || cls.includes('copy')) {
            hasPostResponseBtn = true;
            break;
          }
        }
      }

      if (hasPostResponseBtn) {
        return true;
      }

      // Señal 4: Estabilidad del texto (el texto deja de crecer)
      const currentText = this._extractCurrentText();
      const currentLen = currentText.length;

      if (currentLen > 50) { // Solo si hay respuesta sustancial
        if (currentLen === this._lastResponseLength) {
          this._stableCount++;
          if (this._stableCount >= 4) { // 4 polls estables = terminado (~3.2s)
            console.log(`[ZettaCore][arena] ✅ Texto estable detectado (${currentLen} chars, ${this._stableCount} polls)`);
            return true;
          }
        } else {
          this._stableCount = 0;
          this._lastResponseLength = currentLen;
        }
      }

      return false;
    }

    /**
     * Devuelve los bloques .prose del último turno del asistente.
     * Si Arena retornó 2 respuestas en el mismo turno, ambas estarán aquí.
     * Siempre tomamos la primera (respuesta A).
     */
    _getLastTurnProse() {
      const allProse = Array.from(document.querySelectorAll('.prose, [class*="prose"]'))
        .filter(el => el.offsetParent !== null && (el.innerText || '').trim().length > 10);

      if (allProse.length === 0) return [];
      if (allProse.length === 1) return allProse;

      // El último bloque siempre es del turno más reciente.
      // Buscamos todos los bloques que comparten el mismo ancestro de mensaje.
      const last = allProse[allProse.length - 1];

      // Subir hasta encontrar un contenedor que parezca ser un mensaje del asistente
      const getMsgRoot = (el) => {
        let p = el;
        while (p && p !== document.body) {
          if (p.matches('article, section, [data-testid], [role="article"]')) return p;
          p = p.parentElement;
        }
        return el.parentElement; // fallback al padre directo
      };

      const lastRoot = getMsgRoot(last);

      // Todos los .prose que caen dentro del mismo root = mismo turno
      const sameTurn = allProse.filter(el => lastRoot && lastRoot.contains(el));

      // Si el root no incluye al menos 1 bloque, devolver solo el último
      return sameTurn.length > 0 ? sameTurn : [last];
    }

    /**
     * Extrae el texto de la respuesta actual del chat.
     */
    _extractCurrentText() {
      const blocks = this._getLastTurnProse();
      if (blocks.length > 0) {
        // Siempre el primero: si hay 2 respuestas es la A, si hay 1 es la única
        const text = (blocks[0].innerText || blocks[0].textContent || '').trim();
        if (text.length > 20) return text;
      }

      // Fallback a selectores genéricos
      const selectors = [
        '[data-testid*="message"] .prose', '[data-testid*="message"] .markdown',
        '[data-testid*="assistant"] p', '.message-content',
        'article .prose', 'main [dir="auto"]', 'main p',
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          // En fallback también tomamos el primero por seguridad
          const text = (els[0].innerText || els[0].textContent || '').trim();
          if (text.length > 20) return text;
        }
      }
      return '';
    }

    extractResponse() {
      const blocks = this._getLastTurnProse();

      if (blocks.length > 0) {
        const isMultiple = blocks.length > 1;
        // Siempre tomamos el primer bloque (respuesta A)
        const text = (blocks[0].innerText || blocks[0].textContent || '').trim();
        if (text.length > 10) {
          console.log(
            `[ZettaCore][arena] 📝 Respuesta A extraída` +
            (isMultiple ? ` (de ${blocks.length} opciones)` : '') +
            ` — ${text.length} chars`
          );
          return text;
        }
      }

      // Último fallback: párrafos de main
      const allParas = document.querySelectorAll('main p, main li');
      if (allParas.length > 0) {
        const text = Array.from(allParas).slice(-20)
          .map(el => el.innerText || el.textContent || '').join('\n').trim();
        if (text.length > 10) return text;
      }

      return '[ZettaCore] No se pudo extraer la respuesta de Arena.';
    }
  }

  window.ZettaArenaAdapterClass = ArenaAdapter;
  window.ZettaActiveAdapter = new ArenaAdapter('default');
  console.log('[ZettaCore] arena.js — Adaptador activo ✅ en', window.location.href);
})();
