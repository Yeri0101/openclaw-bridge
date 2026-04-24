import { Hono } from 'hono';
import { supabase } from '../db';
import { authMiddleware } from '../middleware/auth';
import { pauseProvider } from '../utils/limitTracker';

const projects = new Hono();

// Apply auth middleware to all project routes
projects.use('*', authMiddleware);

projects.get('/recent-calls', async (c) => {
    const { data: recentLogs, error: logsError } = await supabase
        .from('request_logs')
        .select('project_id, gateway_key_id, model, latency_ms, total_tokens, created_at')
        .order('created_at', { ascending: false })
        .limit(12);

    if (logsError) return c.json({ error: logsError.message }, 500);

    const directProjectIds = (recentLogs || []).map((log: any) => log.project_id).filter(Boolean);
    const gatewayKeyIds = [...new Set((recentLogs || []).map((log: any) => log.gateway_key_id).filter(Boolean))];

    const { data: gatewayKeysData, error: gatewayKeysError } = gatewayKeyIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('gateway_keys')
            .select('id, project_id')
            .in('id', gatewayKeyIds);

    if (gatewayKeysError) return c.json({ error: gatewayKeysError.message }, 500);

    const projectIdByGatewayKeyId = new Map((gatewayKeysData || []).map((gatewayKey: any) => [gatewayKey.id, gatewayKey.project_id]));
    const allProjectIds = [...new Set([
        ...directProjectIds,
        ...(gatewayKeysData || []).map((gatewayKey: any) => gatewayKey.project_id).filter(Boolean),
    ])];

    const { data: projectsData, error: projectsError } = allProjectIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from('projects')
            .select('id, name')
            .in('id', allProjectIds);

    if (projectsError) return c.json({ error: projectsError.message }, 500);

    const projectNameById = new Map((projectsData || []).map((project: any) => [project.id, project.name]));

    const normalizedLogs = (recentLogs || [])
        .map((log: any) => {
            const resolvedProjectId = log.project_id || projectIdByGatewayKeyId.get(log.gateway_key_id) || null;
            return {
                project_id: resolvedProjectId,
                project_name: resolvedProjectId ? (projectNameById.get(resolvedProjectId) || 'Proyecto desconocido') : 'Proyecto desconocido',
                model: log.model || 'Modelo desconocido',
                latency_ms: log.latency_ms ?? null,
                total_tokens: log.total_tokens ?? 0,
                created_at: log.created_at,
            };
        })
        .filter((log: any) => log.project_id || log.model !== 'Modelo desconocido')
        .slice(0, 3);

    return c.json(normalizedLogs);
});

projects.post('/:id/pause-all', async (c) => {
    const { id } = c.req.param();
    const { data: keys, error } = await supabase.from('upstream_keys').select('id').eq('project_id', id);
    if (error) return c.json({ error: error.message }, 500);

    keys.forEach(k => pauseProvider(k.id));
    return c.json({ success: true, count: keys.length });
});

projects.get('/', async (c) => {
    const [{ data, error }, { data: logs, error: logsError }] = await Promise.all([
        supabase
            .from('projects')
            .select('*, gateway_keys(id, key_name, api_key)')
            .order('created_at', { ascending: false }),
        supabase
            .from('request_logs')
            .select('project_id, latency_ms')
    ]);

    if (error) return c.json({ error: error.message }, 500);
    if (logsError) return c.json({ error: logsError.message }, 500);

    // Aggregate avg latency per project
    const latencyMap: Record<string, { sum: number; count: number }> = {};
    for (const log of (logs || [])) {
        if (!log.project_id || log.latency_ms == null) continue;
        if (!latencyMap[log.project_id]) latencyMap[log.project_id] = { sum: 0, count: 0 };
        latencyMap[log.project_id].sum += log.latency_ms;
        latencyMap[log.project_id].count++;
    }

    const sanitized = (data || []).map((project: any) => {
        const keys = (project.gateway_keys || []).map((gk: any) => {
            const key: string = gk.api_key || '';
            const key_preview = key.length > 9
                ? `${key.slice(0, 4)}...${key.slice(-5)}`
                : `${key.slice(0, 4)}...`;
            const { api_key: _removed, ...rest } = gk;
            return { ...rest, key_preview };
        });
        const agg = latencyMap[project.id];
        const avg_latency_ms = agg ? Math.round(agg.sum / agg.count) : null;
        return { ...project, gateway_keys: keys, avg_latency_ms };
    });

    return c.json(sanitized);
});

projects.post('/', async (c) => {
    const { name } = await c.req.json();
    const { data, error } = await supabase.from('projects').insert([{ name }]).select().single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data, 201);
});

projects.delete('/:id', async (c) => {
    const { id } = c.req.param();
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
});

projects.patch('/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = body.color;
    if (body.budget_usd !== undefined) {
        updates.budget_usd = body.budget_usd === null || body.budget_usd === '' ? null : Number(body.budget_usd);
    }
    if (body.budget_alert_threshold_pct !== undefined) {
        updates.budget_alert_threshold_pct = body.budget_alert_threshold_pct === null || body.budget_alert_threshold_pct === ''
            ? 80
            : Number(body.budget_alert_threshold_pct);
    }
    if (Object.keys(updates).length === 0) return c.json({ error: 'Nothing to update' }, 400);
    const { data, error } = await supabase.from('projects').update(updates).eq('id', id).select();
    if (error) return c.json({ error: error.message }, 500);
    if (!data || data.length === 0) return c.json({ error: 'Project not found' }, 404);
    return c.json(data[0]);
});

export default projects;
