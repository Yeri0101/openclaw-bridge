// sora.js
// ZettaCore Adaptador para sora.chatgpt.com — v5 (Auto-verificador e Inteligente)
// Fixes & Features:
// - Usa MutationObserver para no esperar a ciegas
// - Verifica que la opción clicada se haya aplicado realmente (data-state, aria-checked)
// - Reintenta con estrategias fallback si la verificación falla
// - Reporta settings exactos usados al servidor
// - Completa inyección y submit con comprobaciones POST-click

(() => {
  'use strict';

  if (!window.location.hostname.includes('sora.chatgpt.com')) return;

  const { wakeUpField, humanClick, randomDelay } = window.ZettaBlindProtocol;
  const { waitForElement } = window.ZettaShadowWalker;

  // Helper function to track specific DOM mutations
  // Espera inteligentemente a que cambie algo (como aparición de submenús)
  async function waitForDOMChange(container, timeoutMs = 2000) {
    return new Promise((resolve) => {
      let timer;
      const observer = new MutationObserver((mutations) => {
        if (mutations.some(m => m.addedNodes.length > 0 || m.type === 'attributes')) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(true); // Hubo cambios
        }
      });
      observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'aria-expanded'] });
      
      timer = setTimeout(() => {
        observer.disconnect();
        resolve(false); // No hubo cambios a tiempo
      }, timeoutMs);
    });
  }

  // Verifica si un botón se ve "seleccionado" (usado para settings internos)
  function isSelected(btn) {
    if (!btn) return false;
    return btn.getAttribute('aria-checked') === 'true' || 
           btn.getAttribute('aria-selected') === 'true' ||
           btn.getAttribute('data-state') === 'checked' ||
           btn.getAttribute('data-active') === 'true' ||
           (btn.className && btn.className.toLowerCase().includes('active')) ||
           (btn.className && btn.className.toLowerCase().includes('selected'));
  }

  // Simula un hover intensivo para menús React/Tailwind/Radix
  async function forceHover(el) {
    console.log(`[ZettaCore][sora] Forzando hover en:`, el.innerText?.slice(0, 20));
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    
    // A veces Sora (Radix UI) necesita el foco
    el.focus();
    
    // Esperamos 400ms o a que nazca un nuevo menú
    await Promise.race([
        randomDelay(600, 800),
        waitForDOMChange(document.body, 1500)
    ]);
  }

  function getCurrentVideoUrls() {
    const srcs = new Set();
    document.querySelectorAll('video[src]').forEach(v => v.src && srcs.add(v.src));
    document.querySelectorAll('video source[src]').forEach(s => s.src && srcs.add(s.src));
    document.querySelectorAll('a[href*=".mp4"], a[href*=".webm"], a[download]').forEach(a => a.href && srcs.add(a.href));
    return srcs;
  }

  class SoraAdapter extends window.ZettaLLMAdapter {
    constructor() {
      super({
        platform: 'sora',
        inputSelector: [
          'textarea',
          'div[contenteditable="true"]',
          '[data-testid="prompt-input"]',
          '[aria-label*="prompt" i]',
          '[placeholder*="Describe" i]',
          '[placeholder*="video" i]',
        ].join(', '),
        submitSelector: null,
        maxWaitMs: 600000,
        pollInterval: 2000,
      });

      this._generationStarted = false;
      this._startTime = null;
      this._existingVideoUrls = new Set();
      this._appliedSettingsMap = {}; // Guarda lo que logramos aplicar realmente
    }

    async injectText(inputEl, prompt) {
      inputEl.focus();
      await randomDelay(200, 350);

      document.execCommand('selectAll', false, null);
      await randomDelay(50, 80);

      const proto = inputEl.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(inputEl, prompt);
        inputEl.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        await randomDelay(300, 500);

        if ((inputEl.value || '').trim()) {
          console.log('[ZettaCore][sora] ✅ Texto inyectado vía native setter');
          return;
        }
      }

      document.execCommand('insertText', false, prompt);
      await randomDelay(300, 500);
      
      // Auto-verificación de inyección
      if (!inputEl.value && !inputEl.innerText) {
          console.warn('[ZettaCore][sora] ⚠️ execCommand y setter fallaron. Input sigue vacío. Intentando asignación directa sucia.');
          inputEl.value = prompt;
          inputEl.innerText = prompt;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      console.log('[ZettaCore][sora] ✅ Inyección terminada. Longitud:', (inputEl.value || inputEl.innerText || '').length);
    }

    /**
     * Motor de búsqueda y clic auto-verificable para submenús
     */
    async smartApplyOption(settingName, targetValue, btnKeywords) {
      this._appliedSettingsMap[settingName] = "failed"; // Asumimos fallo hasta verificar victoria

      const targetStr = targetValue.toString().toLowerCase();
      const popover = document.querySelector('[role="menu"], [role="dialog"], [data-state="open"]')?.parentElement || document.body;
      const popoverButtons = Array.from(popover.querySelectorAll('button:not([disabled])'));
      
      // 1. Encontrar botón madre (ej: "Aspect Ratio", "Duration")
      let mainBtn = popoverButtons.find(b => {
        const t = (b.innerText||'').toLowerCase();
        return btnKeywords.some(kw => t.includes(kw));
      });
      
      if (!mainBtn) {
          console.warn(`[ZettaCore][sora] ⚠️ Botón principal para ${settingName} no encontrado.`);
          return false;
      }
      
      console.log(`[ZettaCore][sora] Configurando [${settingName}] usando botón:`, mainBtn.innerText?.replace(/\n/g, ' '));
      
      // Chequear si por milagro el botón principal YA dice lo que queremos 
      // ej: El botón ya dice "16:9 Landscape"
      if ((mainBtn.innerText||'').toLowerCase().includes(targetStr)) {
          console.log(`[ZettaCore][sora] ✅ [${settingName}] ya estaba en ${targetValue} por defecto.`);
          this._appliedSettingsMap[settingName] = targetValue;
          return true;
      }

      // 2. Intentar Hover agresivo para abrir submenú reactivo
      await forceHover(mainBtn);

      // 3. Buscar subBotón que contenga la respuesta
      // (Volvemos a escanear DOM porque Radix UI inyecta portales al body)
      let subMenuButtons = Array.from(document.querySelectorAll('button:not([disabled]), [role="menuitem"], [role="option"]'));
      
      let targetOption = subMenuButtons.find(b => {
         const text = (b.innerText||'').toLowerCase();
         // Para duration "10" -> buscaremos "10s" o "10 sec"
         if (settingName === 'duration') return text.includes(`${targetStr}s`) || text.includes(`${targetStr} sec`);
         return text.includes(targetStr) || text === targetStr;
      });

      if (targetOption) {
          console.log(`[ZettaCore][sora] -> Encontrada coincidencia en submenú: "${targetOption.innerText}"`);
          await humanClick(targetOption);
          await randomDelay(300, 500);

          // 4. Inteligencia: ¿Se aplicó?
          // a) Si el menú se cerró y ahora el mainBtn muestra el valor
          // b) Si el targetOption ahora tiene isSelected() = true
          
          if (isSelected(targetOption) || (mainBtn.innerText||'').toLowerCase().includes(targetStr)) {
              console.log(`[ZettaCore][sora] ✅ Verificado: [${settingName}] = ${targetValue}`);
              this._appliedSettingsMap[settingName] = targetValue;
              return true;
          } else {
             console.warn(`[ZettaCore][sora] ⚠️ Se hizo clic pero la UI no parece reflejarlo. Estado dudoso.`);
             // Igualmente lo damos por bueno asumiendo que el DOM no cambió visualmente
             this._appliedSettingsMap[settingName] = targetValue + "(unverified)";
             return true; 
          }
      } else {
          // Fallback: Si no hay targetOption en submenú, haremos clic en el mainBtn
          // Algunas UIs rotan al hacer click cíclico.
          console.log(`[ZettaCore][sora] -> No vi submenú para ${targetValue}. Haciendo clic cíclico en el botón padre...`);
          await humanClick(mainBtn);
          await randomDelay(400, 600);
          
          if ((mainBtn.innerText||'').toLowerCase().includes(targetStr)) {
             console.log(`[ZettaCore][sora] ✅ Verificado post-ciclo: [${settingName}] = ${targetValue}`);
             this._appliedSettingsMap[settingName] = targetValue;
             return true;
          }
          console.warn(`[ZettaCore][sora] ❌ Falló aplicación de [${settingName}].`);
          return false;
      }
    }

    async applySettings(settings) {
      if (!settings || Object.keys(settings).length === 0) return;
      console.log('[ZettaCore][sora] ⚙️ Solicitud de settings:', settings);
      
      this._appliedSettingsMap = {}; 

      await randomDelay(500, 800);
      
      // 1. Encontrar botón de Settings inteligente
      const allButtons = Array.from(document.querySelectorAll('button:not([disabled])'));
      let settingsBtn = allButtons.find(b => {
        const text = (b.innerText || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('settings') || aria.includes('settings') || 
               aria.includes('options') || text.includes('options') ||
               (b.getAttribute('aria-haspopup') === 'menu') ||
               (b.getAttribute('aria-expanded') !== null);
      });

      // Fallback: El botón justo antes del Submit suele ser Settings UI (Sora/ChatGPT normal)
      if (!settingsBtn) {
        const submitIdx = allButtons.findIndex(b => {
          const text = (b.innerText || '').toLowerCase().trim();
          return ['create', 'generate', 'submit'].some(k => text.startsWith(k));
        });
        if (submitIdx > 0) settingsBtn = allButtons[submitIdx - 1]; 
      }

      if (!settingsBtn) {
        console.warn('[ZettaCore][sora] ⚠️ Critical: Botón Settings no encontrado. UI muy distinta.');
        return;
      }

      // Si ya estaba abierto (aria-expanded true), no clickearlo
      if (settingsBtn.getAttribute('aria-expanded') !== 'true') {
         console.log('[ZettaCore][sora] Abriendo settings...', settingsBtn.innerText?.slice(0, 15));
         await humanClick(settingsBtn);
         await waitForDOMChange(document.body, 2000); // Esperar que nazca el modal
      }

      // 2. Aplicar individualmente con motor inteligente
      if (settings.orientation) {
         await this.smartApplyOption('orientation', settings.orientation, ['aspect', 'ratio', 'landscape', 'portrait', 'square', '16:9', '9:16', 'size']);
      }
      
      if (settings.duration) { // "5" o "10"
         await this.smartApplyOption('duration', settings.duration, ['duration', 'length', 'second', 'time']);
      }
      
      if (settings.count) { // "1"
         await this.smartApplyOption('count', settings.count, ['count', 'number', 'videos', 'variations']);
      }

      // Cerrar settings panel
      console.log('[ZettaCore][sora] ⚙️ Resultados internos de settings:', this._appliedSettingsMap);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      
      // Verificar Cierre
      await waitForDOMChange(document.body, 1000);
      if (settingsBtn.getAttribute('aria-expanded') === 'true') {
          console.warn('[ZettaCore][sora] ⚠️ Settings no se cerró con Escape. Re-cick...');
          await humanClick(settingsBtn); 
      }
      await randomDelay(400, 600);
    }

    async submitPrompt(inputEl) {
      await randomDelay(700, 1000);

      const allButtons = Array.from(document.querySelectorAll('button:not([disabled])'));
      const keywords = ['create', 'generate', 'submit', 'send', 'make'];
      
      let btn = allButtons.find(b => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.innerText || '').toLowerCase().trim();
        return keywords.some(k => aria.includes(k) || text === k || text.startsWith(k));
      });

      if (!btn) btn = allButtons.filter(b => b.querySelector('svg')).pop(); // Último svg
      if (!btn) btn = document.querySelector('form button[type="submit"]:not([disabled])');

      if (btn) {
        console.log('[ZettaCore][sora] ✅ Click en submit:', btn.innerText?.trim()?.slice(0,20) || btn.getAttribute('aria-label'));
        
        const urlBefore = window.location.href;
        await humanClick(btn);
        
        // Verificación de click 
        await randomDelay(500, 800);
        // Si el botón ya no está en el DOM, o cambió de Disabled=false a Disabled=true, asumo que funcionó
        if (!document.body.contains(btn) || btn.disabled || document.body.innerText.toLowerCase().includes('generating')) {
            console.log('[ZettaCore][sora] ✅ Submit verificado: La web reaccionó al click.');
            return;
        } else {
             console.warn('[ZettaCore][sora] ⚠️ El botón de Submit no reaccionó tras click. Aplicando Enter al Input...');
        }
      }

      console.warn('[ZettaCore][sora] Probando Fallbacks de Submit (Enter en teclado)...');
      inputEl.focus();
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
    }

    isGenerationComplete() {
      if (!this._generationStarted) return false;

      const currentUrls = getCurrentVideoUrls();
      for (const url of currentUrls) {
        if (!this._existingVideoUrls.has(url)) {
          console.log('[ZettaCore][sora] 🎬 Verificado: ¡NUEVO video nacido en el DOM!');
          return true;
        }
      }

      // Fallbacks
      const bodyText = document.body.innerText.toLowerCase();
      const doneKws = ['view video', 'watch video', 'download video', 'generation complete', 'success'];
      if (doneKws.some(kw => bodyText.includes(kw) && !bodyText.includes('generating'))) {
        return true;
      }
      return false;
    }

    extractResponse() {
      const currentUrls = getCurrentVideoUrls();
      for (const url of currentUrls) {
        if (!this._existingVideoUrls.has(url)) {
           // Si pidió los settings aplicados, los adjunto a la respuesta cruda para el usuario
           const setsPrt = JSON.stringify(this._appliedSettingsMap);
           return `Video: ${url}\nSettings Aplicados: ${setsPrt}`;
        }
      }
      const firstUrl = currentUrls.values().next().value;
      return firstUrl || `[SoraVideo] Completado sin URL. Info: ${JSON.stringify(this._appliedSettingsMap)}`;
    }

    async handle(prompt, requestId, settings = {}) {
      console.log('[ZettaCore][sora] v5 — Autónomo. Prompt chars:', prompt.length);
      this._generationStarted = false;
      this._existingVideoUrls = getCurrentVideoUrls();

      try {
        const inputEl = await this.getInputElement();
        await this.clearInput(inputEl);

        // APLICAR SETTINGS (AUTO-VERIFICABLE)
        if (settings && Object.keys(settings).length > 0) {
           await this.applySettings(settings);
        }

        // TEXTO
        await this.injectText(inputEl, prompt);
        
        // ENVIO (AUTO-VERIFICABLE)
        await this.submitPrompt(inputEl);
        
        this._generationStarted = true;
        this._startTime = Date.now();
        console.log('[ZettaCore][sora] 🧠 En espera heurística del video...');

        await this.waitForCompletion();

        const responseTxt = this.extractResponse();
        console.log('[ZettaCore][sora] 🎬 Extracción exitosa. Longitud:', responseTxt.length);

        chrome.runtime.sendMessage({
          action: 'generation_complete',
          requestId,
          content: responseTxt,
          platform: 'sora',
        });
      } catch (error) {
        console.error('[ZettaCore][sora] ❌ Falla catastrófica recuperable:', error.message);
        chrome.runtime.sendMessage({
          action: 'generation_complete',
          requestId,
          content: null,
          error: error.message,
          platform: 'sora',
        });
      }
    }
  }

  window.ZettaActiveAdapter = new SoraAdapter();
  console.log('[ZettaCore] sora.js v5 INTELLIGENCE — Listo en', window.location.href);
})();
