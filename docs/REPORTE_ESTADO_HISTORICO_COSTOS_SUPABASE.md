# Reporte de Estado: Historico, Costos y MCP Supabase

Fecha: 2026-04-03

## Objetivo actual

Preparar una implementacion ordenada para:

- historico de uso mas completo
- calculo de costos por proyecto
- presupuesto en USD por proyecto

La decision tomada fue:

1. primero fortalecer el historico
2. despues reutilizar Analiticas
3. luego agregar costos
4. finalmente presupuesto y alertas

## Contexto ya confirmado

### Proyecto Supabase usado por este gateway

El repo local apunta a este proyecto:

- project ref: `your-project-ref`
- url: `https://your-project-ref.supabase.co`

Fuente local:

- `backend/.env`

### MCP de Supabase

El usuario ya configuro correctamente el MCP en su maquina:

- `remote_mcp_client_enabled = true`
- servidor `supabase` agregado
- autenticacion OAuth completada
- `codex mcp list` muestra `supabase` como `enabled`

Importante:

- en la sesion actual de Codex no se reflejo todavia el MCP
- probablemente hace falta reabrir la ventana o iniciar una conversacion nueva
- este reporte existe para retomar el trabajo cuando la nueva sesion si tenga acceso al MCP

## Lo que ya se reviso del codigo

### Fuente actual de analiticas

La logica principal ya existente esta basada en `request_logs`.

Archivos relevantes:

- `backend/src/routes/analytics.ts`
- `backend/src/routes/v1.ts`
- `frontend/src/pages/ProjectDetail.tsx`

### Conclusiones ya tomadas

- no conviene crear un sistema paralelo al de Analiticas
- hay que reutilizar `request_logs` como fuente de verdad
- `recentLogs` ya demuestra que parte de la informacion necesaria existe
- primero debe existir un historico mas completo y consistente

## Funcionalidades discutidas y aceptadas como valiosas

### 1. Presupuesto por costo

Idea aceptada:

- el usuario define precios manuales por 1 millon de tokens
- el usuario define cuanto esta dispuesto a gastar en USD por proyecto

Modelo mental acordado:

- precio input por 1M tokens
- precio output por 1M tokens
- presupuesto maximo en USD por proyecto

### 2. Historico mas util

Objetivo aceptado:

- ver que key se uso
- en que proyecto
- cuando
- que modelo/provider respondio
- cuantos tokens consumo
- latencia
- costo estimado

Conclusion acordada:

- primero historico
- luego costos sobre el mismo historico

## Estado actual del dashboard

Ya se implemento y funciona:

- tarjetas de ultimas llamadas en el dashboard
- ubicadas en el header, a la derecha
- muestran proyecto, llm, latencia, tokens y hora

Archivos tocados durante esta iteracion:

- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/i18n.tsx`

## Lo que falta implementar conceptualmente

### Fase 1: fortalecer historico

Meta:

- asegurar que cada request relevante quede registrada de forma completa

Campos minimos deseables en historico:

- `project_id`
- `gateway_key_id`
- `upstream_key_id`
- `provider`
- `model`
- `status_code`
- `latency_ms`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `error_message`
- `created_at`

Nota:

- hoy ya existe `request_logs`
- hay que verificar en la base real cuales de estos campos existen de verdad
- especialmente hay que validar si ya existen `prompt_tokens` y `completion_tokens`

### Fase 2: historico navegable

Meta:

- vista mas rica basada en `request_logs`

Consultas utiles futuras:

- historial por proyecto
- historial por gateway key
- historial por modelo
- historial por provider
- filtros por rango de fechas
- filtros por status

### Fase 3: costos

Meta:

- calcular costo por request usando datos del historico

Campos futuros recomendados:

- `input_cost_usd`
- `output_cost_usd`
- `total_cost_usd`
- `pricing_snapshot_input_per_1m`
- `pricing_snapshot_output_per_1m`

Razon del snapshot:

- si el precio cambia despues, el historico viejo no debe recalcularse con el precio nuevo

### Fase 4: presupuesto

Meta:

- sumar costo acumulado por proyecto
- compararlo con el limite configurado en USD

Comportamientos posibles:

- solo informar
- alertar al 80 por ciento
- alertar al 100 por ciento
- bloquear al 100 por ciento

## Reutilizacion concreta de Analiticas

La base reutilizable ya existe en:

- `backend/src/routes/analytics.ts`

Ese endpoint ya hace:

- lectura de `request_logs`
- agregaciones por proyecto
- entrega de `recentLogs`
- metricas como requests, success rate, tokens y latencia

La recomendacion sigue siendo:

- extender esa logica
- no duplicarla en otra capa distinta

## Que hay que revisar con MCP Supabase cuando la nueva sesion lo vea

Ese chequeo ya se pudo hacer con el MCP. Resultado real:

### Tablas public existentes

- `projects`
- `upstream_keys`
- `gateway_keys`
- `gateway_key_models`
- `admins`
- `request_logs`
- `batch_jobs`

### Migraciones reales presentes

- `01_initial_schema`
- `create_batch_jobs_table`
- `add_max_context_tokens_to_upstream_keys`
- `add_project_color`

### Esquema real de `request_logs`

Columnas reales hoy:

- `id`
- `project_id`
- `gateway_key_id`
- `upstream_key_id`
- `provider`
- `model`
- `status_code`
- `latency_ms`
- `total_tokens`
- `error_message`
- `created_at`

### Hallazgos importantes en datos reales

- `request_logs` tiene 334 filas
- no hay nulos en:
  - `project_id`
  - `gateway_key_id`
  - `upstream_key_id`
  - `total_tokens`
- no existen tablas de precios, costos o presupuestos
- `gateway_keys.api_key` si es `UNIQUE`
- `upstream_keys.api_key` no aparece con constraint `UNIQUE`

### Conclusion concreta

El historico base ya existe y esta mejor de lo esperado.

Lo que falta no es crear el historico desde cero, sino enriquecerlo.

### Faltantes reales para costos

No existen en `request_logs`:

- `prompt_tokens`
- `completion_tokens`
- `input_cost_usd`
- `output_cost_usd`
- `total_cost_usd`
- `pricing_snapshot_input_per_1m`
- `pricing_snapshot_output_per_1m`

### Recomendacion tecnica actualizada

La mejor ruta ahora es:

1. extender `request_logs`
2. no crear otra tabla paralela para el historico
3. agregar una tabla de pricing manual
4. agregar presupuesto por proyecto en tabla dedicada o columnas en `projects`

### Seguridad observada desde Supabase

Los advisors de Supabase reportan:

- RLS deshabilitado en todas las tablas principales del schema `public`
- exposicion sensible de `api_key` en:
  - `gateway_keys`
  - `upstream_keys`

Esto no bloquea el objetivo de historico/costos, pero si debe quedar marcado como deuda tecnica importante.

## Siguiente paso recomendado al retomar

1. confirmar que la nueva sesion ve el MCP `supabase`
2. inspeccionar el esquema real de la base
3. escribir un reporte mas preciso basado en la DB real
4. decidir si:
   - extendemos `request_logs`
   - o agregamos tabla complementaria para costos/pricing

## Notas importantes para retomarlo rapido

- el usuario quiere reporte y plan, no implementacion inmediata
- el usuario remarco que varias funciones ya existen:
  - `Ctx Limit`
  - pausar key
- el foco real ahora es:
  - historico mas util
  - costos
  - presupuesto
