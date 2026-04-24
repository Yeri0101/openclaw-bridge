# Reporte Técnico: Modificaciones al Sistema SOAT y Estrategias de Fallback en Mission Control

**Fecha de Implementación:** 11 de Marzo de 2026
**Componentes Afectados:**
1. OpenClaw Gateway (`backend/src/routes/v1.ts`)
2. Mission Control Consensus Controller (`src/app/api/consensus/deliberate/route.ts`)

---

## 1. El Problema Original: Límite Muro de 8,192 Tokens
Durante las ejecuciones del "Synthesis Report" por parte del agente **Atlas**, las respuestas se estaban cortando prematuramente, impidiendo que el agente pudiera imprimir el bloque JSON final requerido por el contrato del sistema.

Tras investigar la causa, se concluyó que el problema radicaba en el **límite de hardware nativo de Google Gemini (`gemini-1.5-flash`, `gemini-3.0-flash`)**, el cual tiene una restricción física inquebrantable de **8,192 Output Tokens (Tokens de Salida)** por petición. 

A pesar de que Atlas intentaba generar enormes reportes teóricos (de hasta 65,000 tokens) porque su prompt le indicaba "no reprimirse", la API de Google cortaba la conexión al llegar al token 8,192 con un `finish_reason: max_tokens`.

Adicionalmente, el Gateway (SOAT) de OpenClaw tenía una red de seguridad general que capaba cualquier petición mayor a 16,000 tokens hacia abajo para evitar rechazos en enrutadores externos (como OpenRouter), impidiendo en primer lugar que se solicitaran outputs masivos reales.

---

## 2. Modificaciones Realizadas

### A. Ajustes en OpenClaw Gateway (Módulo SOAT)
**Archivo Modificado:** `backend/src/routes/v1.ts`

Se modificó el comportamiento restrictivo del SOAT (Single Origin Access Token) para permitir **excepciones privilegiadas** basadas en las llaves de acceso (API Keys) de los proyectos.

*   **Peticiones Normales:** Siguen estando limitadas a un máximo de 16,000 tokens como medida de seguridad para economizar créditos y prevenir rechazos upstream.
*   **Peticiones Premium (NUEVO):** El SOAT ahora inspecciona el token de autorización (`Authorization: Bearer gk_...`). Si detecta la llave premium específica `gk_your_premium_key` (correspondiente al proyecto *Open router_Prim*), el SOAT **desactiva el limitador de 16K**. Esto permite al Gateway aceptar peticiones con capacidades masivas de salida (ej. 65,000 tokens) enviadas desde Mission Control sin intervenir ni reducirlas.

### B. Ajustes en Mission Control (Consensus Controller)
**Archivo Modificado:** `src/app/api/consensus/deliberate/route.ts`

El controlador de consenso fue rediseñado para incorporar un mecanismo de **Arreglo de Respaldo Nativo (Fallback Array)** altamente resiliente, diseñado primordialmente para rescatar el "Synthesis Report" de Atlas cuando el modelo Gemini estándar colapsa por sus propios límites de hardware.

**La Lógica Implementada:**
1.  **Iteración de Estrategias:** La generación estricta de un solo `fetch` fue reemplazada por un bucle `for...of` que itera sobre un arreglo de estrategias (`strategies`).
2.  **Generación de Agentes Estándar:** Para el debate regular, se emplea únicamente el modelo base (`gemini-3-flash-preview`) con la clave de la API del Gateway general (limitada por SOAT a los 16K estándar).
3.  **Condición Excepcional para Atlas (`isFinal === true`):**
    *   Mission Control empujará el payload masivo de **65,000 max_tokens**
    *   Añadirá dinámicamente un **segundo modelo de respaldo** a las estrategias: `minimax/minimax-m2.5`, asociado estrictamente con la llave premium (`gk_your_premium_key`).
4.  **Ejecución a Prueba de Fallos:**
    *   Mission Control intenta generar el reporte primero con Gemini 3 Flash.
    *   Si Gemini falla (error 500, crash por tokens o rechazo de red), el bucle descarta el error y hace un *reintento silencioso*.
    *   En el reintento, ejecuta la estrategia #2: Llama a **Minimax** con la llave premium.
    *   La petición llega al Gateway, el SOAT detecta la llave premium, ignora la barrera de 16K, y envía los 65,000 tokens a OpenRouter/Minimax para que la gigantesca respuesta fluya ininterrumpidamente.

---

## 3. Conclusión
Esta arquitectura dual garantiza dos beneficios protectores vitales:
- **Ahorro de Créditos:** El 99% de las peticiones (usuarios genéricos y debates internos de Agentes que usan las llaves estandarizadas) siguen protegidas de desbordamientos indeseados gracias al muro conservador de 16K del SOAT.
- **Tolerancia a Fallos Masivos para Misiones Críticas:** Atlas, cuyo propósito es consumir una inmensa concentración de tokens para la síntesis arquitectónica final, puede usar Gemini, pero cuenta ahora con un *salvavidas automático*. Si Gemini lo decapitara u originara problemas de carga, la estructura cambiará instintivamente a una infraestructura en la nube sin límites (Minimax), apoyada por la política "Bypass Limit" de la llave premium validada del Gateway.
