// blind-protocol.js
// ZettaCore Blind Protocol: Simula comportamiento humano para evadir detección de bots.
// NUNCA inyecta valores directamente vía .value = "..." o dispatchEvent(InputEvent).
// USA eventos físicos de teclado y movimientos de ratón aleatorios.

(() => {
  'use strict';

  /**
   * Espera un tiempo aleatorio entre min y max ms.
   */
  function randomDelay(min = 80, max = 220) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Simula un movimiento suave del ratón hacia un elemento.
   * Los movimientos de ratón hacen que el sitio "crea" que hay un humano.
   * @param {Element} element
   */
  async function simulateMouseMove(element) {
    const rect = element.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2 + (Math.random() * 10 - 5);
    const targetY = rect.top + rect.height / 2 + (Math.random() * 10 - 5);

    // Simular movimiento en pasos
    const steps = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < steps; i++) {
      const progress = (i + 1) / steps;
      const x = targetX * progress;
      const y = targetY * progress;
      element.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        movementX: Math.random() * 5,
        movementY: Math.random() * 5,
      }));
      await randomDelay(10, 30);
    }
  }

  /**
   * Clic humano simulado: mouseover → mousemove → mousedown → mouseup → click
   * @param {Element} element
   */
  async function humanClick(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
    const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);

    const eventProps = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    };

    element.dispatchEvent(new MouseEvent('mouseover', eventProps));
    await randomDelay(30, 80);
    element.dispatchEvent(new MouseEvent('mousemove', eventProps));
    await randomDelay(20, 50);
    element.dispatchEvent(new MouseEvent('mousedown', eventProps));
    await randomDelay(50, 120);
    element.dispatchEvent(new MouseEvent('mouseup', eventProps));
    await randomDelay(10, 30);
    element.dispatchEvent(new MouseEvent('click', eventProps));
    await randomDelay(40, 100);
  }

  /**
   * Protocolo de "Wake Up": inserta Space + Backspace para activar el campo
   * sin dejar rastro en el contenido. Hace que el campo "despierte" y sea
   * reconocido como activo por el sitio.
   * @param {Element} element - El campo de texto a "despertar"
   */
  async function wakeUpField(element) {
    element.focus();
    await randomDelay(100, 200);

    // Space + Backspace = activa el campo sin añadir contenido neto
    element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    await randomDelay(50, 100);

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', bubbles: true }));
    await randomDelay(80, 150);
  }

  /**
   * Escribe texto carácter a carácter con delay humano variable.
   * @param {Element} element - Elemento de input/contenteditable
   * @param {string} text - Texto a escribir
   */
  async function humanType(element, text) {
    element.focus();
    await randomDelay(150, 300);

    const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';

    for (const char of text) {
      // Simular movimiento de ratón ocasional (como lo haría un humano)
      if (Math.random() < 0.05) {
        await simulateMouseMove(element);
      }

      // Pausa larga ocasional (el humano "piensa")
      const delay = Math.random() < 0.08
        ? Math.floor(Math.random() * 400 + 300)  // pausa larga
        : Math.floor(Math.random() * 80 + 40);   // delay normal

      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));
      await randomDelay(5, 15);
      element.dispatchEvent(new KeyboardEvent('keypress', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));
      
      // INSERTAR EL CARACTER REAL (necesario ya que KeyboardEvent no inserta texto)
      if (isContentEditable) {
        document.execCommand('insertText', false, char);
      } else {
        element.value += char;
        // Lanzamos evento input para que frameworks como React deteten el cambio
        element.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }));
      }

      await randomDelay(5, 15);
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        bubbles: true,
        cancelable: true,
      }));

      await new Promise(r => setTimeout(r, delay));
    }
  }

  /**
   * Dispara Ctrl+Enter para enviar el formulario (alternativa a clic en botón).
   * @param {Element} element
   */
  async function pressCtrlEnter(element) {
    element.focus();
    await randomDelay(100, 200);
    const ctrl = { ctrlKey: true, bubbles: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ...ctrl }));
    await randomDelay(30, 60);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ...ctrl }));
    element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', ...ctrl }));
    await randomDelay(30, 60);
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', ...ctrl }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', ...ctrl }));
  }

  // Exponer API globalmente
  window.ZettaBlindProtocol = {
    randomDelay,
    simulateMouseMove,
    humanClick,
    wakeUpField,
    humanType,
    pressCtrlEnter,
  };

  console.log('[ZettaCore] blind-protocol.js cargado ✅');
})();
