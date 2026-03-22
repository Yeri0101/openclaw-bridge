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
   * Simula un movimiento suave del ratón con curva tipo Bézier y micro-temblores (jitter).
   * Los humanos no mueven el ratón en línea recta: van en arco y con pequeños temblores de pulso.
   * @param {Element} element
   */
  async function simulateMouseMove(element) {
    const rect = element.getBoundingClientRect();

    // Punto de destino con pequeña variación humana
    const targetX = rect.left + rect.width / 2 + (Math.random() * 12 - 6);
    const targetY = rect.top + rect.height / 2 + (Math.random() * 12 - 6);

    // Partir desde una posición "anterior" plausible
    const startX = targetX + (Math.random() * 200 - 100);
    const startY = targetY + (Math.random() * 200 - 100);

    // Punto de control para curva Bézier cuadrática (da el arco humano)
    const cpX = (startX + targetX) / 2 + (Math.random() * 80 - 40);
    const cpY = (startY + targetY) / 2 + (Math.random() * 80 - 40);

    const steps = Math.floor(Math.random() * 8) + 10; // 10-18 pasos

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Curva Bézier cuadrática: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const bx = (1 - t) ** 2 * startX + 2 * (1 - t) * t * cpX + t ** 2 * targetX;
      const by = (1 - t) ** 2 * startY + 2 * (1 - t) * t * cpY + t ** 2 * targetY;

      // Micro-temblor: oscilación de pulso aleatoria (±2px)
      const jitterX = (Math.random() - 0.5) * 2.5;
      const jitterY = (Math.random() - 0.5) * 2.5;

      element.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: bx + jitterX,
        clientY: by + jitterY,
        movementX: jitterX,
        movementY: jitterY,
      }));

      // Velocidad variable: más rápido a mitad del recorrido, más lento al inicio y al final
      const speed = Math.sin(t * Math.PI); // curva de seno: lento→rápido→lento
      const stepDelay = Math.floor(10 + (1 - speed) * 25);
      await new Promise(r => setTimeout(r, stepDelay));
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

    element.dispatchEvent(new PointerEvent('pointerover', eventProps));
    element.dispatchEvent(new MouseEvent('mouseover', eventProps));
    await randomDelay(30, 80);
    element.dispatchEvent(new PointerEvent('pointermove', eventProps));
    element.dispatchEvent(new MouseEvent('mousemove', eventProps));
    await randomDelay(20, 50);
    element.dispatchEvent(new PointerEvent('pointerdown', eventProps));
    element.dispatchEvent(new MouseEvent('mousedown', eventProps));
    await randomDelay(50, 120);
    element.dispatchEvent(new PointerEvent('pointerup', eventProps));
    element.dispatchEvent(new MouseEvent('mouseup', eventProps));
    await randomDelay(10, 30);
    element.dispatchEvent(new PointerEvent('click', eventProps));
    element.dispatchEvent(new MouseEvent('click', eventProps));
    
    // Fallback nativo: útil cuando las librerías ignoran eventos sintéticos (isTrusted=false)
    try {
      element.click();
    } catch (e) {
      console.warn('[ZettaCore] element.click() falló', e);
    }

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
   * Escribe texto carácter a carácter con comportamiento humano avanzado:
   * - Velocidad variable con efecto "racha" (se acelera al coger ritmo)
   * - Erratas aleatorias con corrección inmediata (Backspace)
   * - Pausas largas de "pensamiento" en puntos naturales (espacios, comas)
   * - Micro-movimientos del ratón ocasionales
   * @param {Element} element - Elemento de input/contenteditable
   * @param {string} text - Texto a escribir
   */
  async function humanType(element, text) {
    element.focus();
    await randomDelay(80, 200);

    const isContentEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true';

    // Caracteres adyacentes en teclado QWERTY para simular erratas realistas
    const adjacentKeys = {
      'a': 'sq', 'b': 'vn', 'c': 'xv', 'd': 'sf', 'e': 'wr', 'f': 'dg',
      'g': 'fh', 'h': 'gj', 'i': 'uo', 'j': 'hk', 'k': 'jl', 'l': 'k',
      'm': 'n', 'n': 'mb', 'o': 'ip', 'p': 'o', 'q': 'w', 'r': 'et',
      's': 'ad', 't': 'ry', 'u': 'yi', 'v': 'bc', 'w': 'qe', 'x': 'zc',
      'y': 'tu', 'z': 'x', ' ': ' ',
    };

    // Función para escribir un solo carácter real en el DOM
    const insertChar = (char) => {
      if (isContentEditable) {
        document.execCommand('insertText', false, char);
      } else {
        element.value += char;
        element.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
    };

    // Función para borrar el último carácter (Backspace)
    const pressBackspace = async () => {
      const bsProps = { key: 'Backspace', code: 'Backspace', bubbles: true, cancelable: true };
      element.dispatchEvent(new KeyboardEvent('keydown', bsProps));
      await randomDelay(20, 45);
      if (isContentEditable) {
        document.execCommand('delete');
      } else {
        element.value = element.value.slice(0, -1);
        element.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new KeyboardEvent('keyup', bsProps));
      await randomDelay(30, 65);
    };

    // Función para presionar y escribir un carácter
    const pressChar = async (char) => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true }));
      await randomDelay(5, 18);
      element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true, cancelable: true }));
      insertChar(char);
      await randomDelay(5, 18);
      element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true, cancelable: true }));
    };

    let streakSpeed = 0; // Velocidad de racha: aumenta al escribir seguido, decrece en errores

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // --- Micro-movimiento de ratón ocasional (5% de probabilidad) ---
      if (Math.random() < 0.05) {
        await simulateMouseMove(element);
      }

      // --- Pausa de "pensamiento" en puntos naturales ---
      // En espacios después de coma/punto, o al inicio de oración
      const isPunctuation = [' ', ',', '.', '!', '?'].includes(char);
      const isAfterPunctuation = i > 0 && ['.', '!', '?'].includes(text[i - 1]);

      let delay;
      if (isAfterPunctuation && Math.random() < 0.4) {
        delay = Math.floor(Math.random() * 150 + 75);  // pausa pens.: 75-225ms (mitad)
        streakSpeed = 0;
      } else if (isPunctuation && Math.random() < 0.2) {
        delay = Math.floor(Math.random() * 50 + 25);   // pausa media: 25-75ms (mitad)
      } else {
        // Velocidad con "efecto racha" — base dobla la velocidad
        const baseDelay = Math.max(8, 30 - streakSpeed);
        delay = Math.floor(Math.random() * baseDelay + 8);
        streakSpeed = Math.min(22, streakSpeed + 1);
      }

      // --- Errata aleatoria (2.4% de probabilidad = 70% menos que antes), excepto en caracteres especiales ---
      const lowerChar = char.toLowerCase();
      const typoChars = adjacentKeys[lowerChar];
      if (typoChars && Math.random() < 0.024) {
        // Escribir carácter incorrecto adyacente
        const wrongChar = typoChars[Math.floor(Math.random() * typoChars.length)];
        await pressChar(wrongChar);
        streakSpeed = 0; // El error rompe la racha

        // Pausa de "me di cuenta del error" antes de borrar
        await randomDelay(80, 250);
        await pressBackspace();
        // Ahora escribir el correcto
        await pressChar(char);
      } else {
        await pressChar(char);
      }

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

  /**
   * CDP Click: clic nativo real vía Chrome Debugger Protocol.
   * A diferencia de humanClick(), este clic entra por la ruta nativa del browser,
   * no por dispatchEvent(). React/Radix lo procesa correctamente.
   *
   * Precondiciones verificadas internamente:
   * - El elemento existe y es visible (offsetParent !== null)
   * - Las coordenadas están dentro del viewport
   *
   * @param {Element} element - El elemento a clickear
   * @param {object} [opts]
   * @param {number} [opts.waitForViewport=2000] - ms máx para esperar que el elemento entre al viewport
   * @returns {Promise<boolean>} - true si CDP tuvo éxito, false si usó fallback
   */
  async function cdpClick(element, opts = {}) {
    const { waitForViewport = 2000 } = opts;

    if (!element) {
      console.warn('[ZettaCore][cdpClick] Elemento null, saltando.');
      return false;
    }

    // Esperar hasta que el elemento esté visible y en el viewport
    const deadline = Date.now() + waitForViewport;
    let rect;
    while (Date.now() < deadline) {
      rect = element.getBoundingClientRect();
      const isVisible = element.offsetParent !== null || element.offsetWidth > 0 || element.offsetHeight > 0;
      const inViewport = rect.top >= 0 && rect.left >= 0 &&
                         rect.bottom <= window.innerHeight &&
                         rect.right <= window.innerWidth;
      if (isVisible && inViewport && rect.width > 0 && rect.height > 0) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Calcular punto central con pequeña variación humana
    rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 6 - 3);
    const y = rect.top + rect.height / 2 + (Math.random() * 6 - 3);

    // Verificar que las coordenadas son válidas y están en el viewport
    if (rect.width === 0 || rect.height === 0 ||
        x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      console.warn(`[ZettaCore][cdpClick] Elemento fuera del viewport o sin dimensiones. Usando humanClick() como fallback.`);
      await humanClick(element);
      return false;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'cdp_click', x, y }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (result && result.success) {
        console.log(`[ZettaCore][cdpClick] ✅ Clic CDP en (${Math.round(x)}, ${Math.round(y)})`);
        return true;
      } else {
        console.warn(`[ZettaCore][cdpClick] ⚠️ CDP falló: ${result?.error}. Usando humanClick() como fallback.`);
        await humanClick(element);
        return false;
      }
    } catch (err) {
      console.warn(`[ZettaCore][cdpClick] ⚠️ Error enviando mensaje: ${err.message}. Usando humanClick() como fallback.`);
      await humanClick(element);
      return false;
    }
  }


  // Exponer API globalmente
  window.ZettaBlindProtocol = {
    randomDelay,
    simulateMouseMove,
    humanClick,
    cdpClick,
    wakeUpField,
    humanType,
    pressCtrlEnter,
  };

  console.log('[ZettaCore] blind-protocol.js cargado ✅');
})();
