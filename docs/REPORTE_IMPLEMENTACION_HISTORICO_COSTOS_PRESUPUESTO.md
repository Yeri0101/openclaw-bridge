# Reporte de Implementacion: Historico, Costos y Presupuesto

Fecha: 2026-04-03

## Resumen

En esta fase se implementaron tres bloques principales:

1. historico enriquecido de requests
2. pricing manual por modelo para calcular costos
3. presupuesto por proyecto con alerta visual y bloqueo real

La implementacion se apoyo en la estructura existente de:

- `request_logs`
- `analytics`
- `projects`
- `ProjectDetail.tsx`

## Lo implementado

### 1. Historico enriquecido

Se agrego al historico de `request_logs`:

- `prompt_tokens`
- `completion_tokens`

Esto permite dejar preparado el sistema para calcular costos reales con input y output separados.

Tambien se actualizo el backend para registrar estos datos en:

- `/v1/chat/completions`
- `/v1/embeddings`

Y en la UI de Analiticas se agregaron columnas visibles:

- `Input`
- `Output`

### 2. Pricing manual por modelo

Se creo una tabla nueva:

- `model_pricing`

Campos principales:

- `provider`
- `model_name`
- `input_price_per_1m`
- `output_price_per_1m`
- `is_active`

Se agrego un CRUD basico autenticado en:

- `backend/src/routes/pricing.ts`

Ruta expuesta:

- `/api/pricing`

La UI de Analiticas ahora permite:

- crear precio por modelo
- editar precio
- borrar precio

### 3. Costos por request

Se agregaron a `request_logs` los campos:

- `input_cost_usd`
- `output_cost_usd`
- `total_cost_usd`
- `pricing_provider`
- `pricing_model_name`
- `pricing_input_per_1m`
- `pricing_output_per_1m`

Cada request nueva calcula costo automaticamente en backend usando:

- tokens input
- tokens output
- pricing manual configurado

Si no existe regla de pricing:

- el costo queda en `0`

### 4. Presupuesto por proyecto

Se agrego a `projects`:

- `budget_usd`
- `budget_alert_threshold_pct`

Esto permite configurar por proyecto:

- presupuesto maximo en USD
- porcentaje de advertencia, por ejemplo `80`

### 5. Alertas visuales

En la pestaña `Analytics` del proyecto ahora se muestra:

- gasto acumulado
- presupuesto
- restante
- porcentaje de uso

Y ademas:

- alerta visual de advertencia al llegar al umbral configurado
- alerta visual de limite cuando ya se alcanzo el presupuesto

### 6. Bloqueo real de requests

El gateway ahora bloquea nuevas requests cuando:

- `spent >= budget_usd`

Esto se aplica antes de procesar la request en:

- chat completions
- embeddings
- endpoints Brave proxy

Respuesta actual:

- error tipo `budget_exceeded_error`
- status `402`

## Migraciones aplicadas

Se agregaron estas migraciones al repo:

- `backend/migrations/20260403113000_add_request_log_token_breakdown.sql`
- `backend/migrations/20260403124500_add_pricing_and_project_budget.sql`
- `backend/migrations/20260403134000_add_budget_alert_threshold.sql`

Ademas, estas migraciones ya fueron aplicadas en Supabase.

## Archivos principales modificados

Backend:

- `backend/src/routes/v1.ts`
- `backend/src/routes/analytics.ts`
- `backend/src/routes/projects.ts`
- `backend/src/routes/pricing.ts`
- `backend/src/index.ts`

Frontend:

- `frontend/src/pages/ProjectDetail.tsx`
- `frontend/src/i18n.tsx`

Documentacion:

- `docs/REPORTE_ESTADO_HISTORICO_COSTOS_SUPABASE.md`

## Validacion realizada

Se verifico:

- migraciones aplicadas correctamente en Supabase
- `backend` compila con `npm run build`
- `frontend` compila con `npm run build`

## Estado funcional actual

El flujo ya soporta:

1. definir precio manual por modelo
2. registrar requests con tokens separados
3. calcular costo por request
4. sumar costo en Analiticas
5. configurar presupuesto por proyecto
6. alertar visualmente por consumo
7. bloquear requests al superar el presupuesto

## Deuda tecnica o mejoras siguientes

Posibles mejoras siguientes:

- mostrar alerta de presupuesto tambien en el dashboard principal
- incluir costo en exportacion markdown mas detallada
- devolver en respuestas bloqueadas cuanto faltaba o cuanto se excedio
- agregar historial filtrable por rango, key y modelo
- permitir reglas de pricing por provider y fallback general con mejor prioridad
- evitar recalcular gasto por proyecto leyendo todos los logs en cada request, usando agregados o cache

## Commits ya creados anteriormente

Commits previos relevantes:

- `1b6c299 feat: add dashboard recent calls and history planning report`
- `506824d feat: enrich request history with token breakdown`

## Commit sugerido para esta fase

Todavia no se creo un commit para la parte de pricing y presupuesto.

Commit sugerido:

```bash
git add backend/migrations/20260403124500_add_pricing_and_project_budget.sql \
        backend/migrations/20260403134000_add_budget_alert_threshold.sql \
        backend/src/index.ts \
        backend/src/routes/analytics.ts \
        backend/src/routes/pricing.ts \
        backend/src/routes/projects.ts \
        backend/src/routes/v1.ts \
        frontend/src/i18n.tsx \
        frontend/src/pages/ProjectDetail.tsx \
        docs/REPORTE_IMPLEMENTACION_HISTORICO_COSTOS_PRESUPUESTO.md

git commit -m "feat: add pricing, project budgets, and request budget enforcement"
```

## Nota importante

El repo tiene otros cambios locales no relacionados en el arbol de trabajo.

Por eso, para el commit de esta fase conviene agregar explicitamente solo los archivos anteriores y no hacer un `git add .`.
