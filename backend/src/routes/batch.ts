/**
 * SOAT Phase 3 — Batch Jobs REST API
 *
 * Exposes endpoints for enqueuing and querying batch jobs.
 * Mounted at /api/batch in index.ts.
 *
 * Endpoints:
 *   POST /api/batch/jobs          — enqueue a new job
 *   GET  /api/batch/jobs          — list project's jobs
 *   GET  /api/batch/jobs/:id      — get a specific job (with results)
 */

import { Hono } from 'hono';
import { supabase } from '../db';

const batchRoute = new Hono();

// ── Auth helper: resolve project_id from gateway key header ──────────────────
async function getProjectId(authHeader: string | undefined): Promise<string | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    const { data } = await supabase
        .from('gateway_keys')
        .select('project_id')
        .eq('api_key', token)
        .single();
    return data?.project_id || null;
}

// ── POST /api/batch/jobs ─────────────────────────────────────────────────────
batchRoute.post('/jobs', async (c) => {
    const projectId = await getProjectId(c.req.header('Authorization'));
    if (!projectId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json().catch(() => null);
    if (!body?.type || !body?.payload) {
        return c.json({ error: 'Missing required fields: type, payload' }, 400);
    }

    const validTypes = ['openai_batch', 'compress_context'];
    if (!validTypes.includes(body.type)) {
        return c.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    const { data, error } = await supabase
        .from('batch_jobs')
        .insert([{
            project_id: projectId,
            type: body.type,
            payload: body.payload,
        }])
        .select('id, type, status, created_at')
        .single();

    if (error) {
        return c.json({ error: 'Failed to enqueue job', details: error.message }, 500);
    }

    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchAPI] Enqueued job id=${data.id} type=${data.type} project=${projectId}`);
    return c.json(data, 201);
});

// ── GET /api/batch/jobs ──────────────────────────────────────────────────────
batchRoute.get('/jobs', async (c) => {
    const projectId = await getProjectId(c.req.header('Authorization'));
    if (!projectId) return c.json({ error: 'Unauthorized' }, 401);

    const status = c.req.query('status'); // optional filter
    let query = supabase
        .from('batch_jobs')
        .select('id, type, status, openai_batch_id, error, created_at, updated_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
});

// ── GET /api/batch/jobs/:id ──────────────────────────────────────────────────
batchRoute.get('/jobs/:id', async (c) => {
    const projectId = await getProjectId(c.req.header('Authorization'));
    if (!projectId) return c.json({ error: 'Unauthorized' }, 401);

    const { data, error } = await supabase
        .from('batch_jobs')
        .select('*')
        .eq('id', c.req.param('id'))
        .eq('project_id', projectId)
        .single();

    if (error || !data) return c.json({ error: 'Job not found' }, 404);
    return c.json(data);
});

export default batchRoute;
