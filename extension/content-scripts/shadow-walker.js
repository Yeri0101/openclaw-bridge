// shadow-walker.js
// Utilidad ZettaCore para atravesar Shadow DOMs anidados.
// Las interfaces modernas de LLMs (Gemini, ChatGPT) usan Web Components 
// con Shadow Roots que ocultan elementos al querySelector normal.

(() => {
  'use strict';

  /**
   * Busca un selector CSS dentro del árbol completo del DOM,
   * incluyendo todos los Shadow Roots anidados (Breadth-First Search).
   * @param {string} selector - El selector CSS a buscar.
   * @param {Document|Element|ShadowRoot} root - El nodo raíz desde donde buscar.
   * @returns {Element|null} El primer elemento que coincida, o null.
   */
  function deepQuerySelector(selector, root = document) {
    // Intento directo primero (más rápido)
    const direct = root.querySelector(selector);
    if (direct) return direct;

    // BFS sobre todos los Shadow Roots
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();

      // Obtener todos los elementos con shadow root dentro del nodo actual
      const allElements = current.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = el.shadowRoot.querySelector(selector);
          if (found) return found;
          queue.push(el.shadowRoot);
        }
      }
    }
    return null;
  }

  /**
   * Busca TODOS los elementos que coincidan con el selector en el árbol completo.
   * @param {string} selector
   * @param {Document|Element|ShadowRoot} root
   * @returns {Element[]}
   */
  function deepQuerySelectorAll(selector, root = document) {
    const results = [];
    const fromDirect = root.querySelectorAll(selector);
    results.push(...fromDirect);

    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      const allElements = current.querySelectorAll('*');
      for (const el of allElements) {
        if (el.shadowRoot) {
          const found = el.shadowRoot.querySelectorAll(selector);
          results.push(...found);
          queue.push(el.shadowRoot);
        }
      }
    }
    return results;
  }

  /**
   * Espera un elemento (con Shadow DOM) durante un máximo de tiempo.
   * @param {string} selector
   * @param {number} timeoutMs - Tiempo máximo de espera en ms.
   * @param {number} intervalMs - Intervalo de polling en ms.
   * @returns {Promise<Element>}
   */
  function waitForElement(selector, timeoutMs = 10000, intervalMs = 300) {
    return new Promise((resolve, reject) => {
      const el = deepQuerySelector(selector);
      if (el) return resolve(el);

      const start = Date.now();
      const timer = setInterval(() => {
        const found = deepQuerySelector(selector);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`ShadowWalker: Timeout esperando selector "${selector}"`));
        }
      }, intervalMs);
    });
  }

  // Exponer API globalmente en el contexto del content script
  window.ZettaShadowWalker = {
    deepQuerySelector,
    deepQuerySelectorAll,
    waitForElement,
  };

  console.log('[ZettaCore] shadow-walker.js cargado ✅');
})();
