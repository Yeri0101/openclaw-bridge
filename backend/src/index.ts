import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import * as dotenv from 'dotenv';
import * as dns from 'node:dns';

// Fix for Node.js fetch() timeout on Windows with Google APIs IPv6 
dns.setDefaultResultOrder('ipv4first');

import { supabase } from './db';

import projectsRoute from './routes/projects';
import upstreamKeysRoute from './routes/upstreamKeys';
import gatewayKeysRoute from './routes/gatewayKeys';
import v1Route from './routes/v1';
import analyticsRoute from './routes/analytics';
import batchRoute from './routes/batch';
import pricingRoute from './routes/pricing';

dotenv.config({ override: true });

const app = new Hono();

app.use('*', logger());
app.use('*', cors());

app.route('/api/projects', projectsRoute);
app.route('/api/providers', upstreamKeysRoute);
app.route('/api/gateway-keys', gatewayKeysRoute);
app.route('/api/analytics', analyticsRoute);
app.route('/api/batch', batchRoute);
app.route('/api/pricing', pricingRoute);
app.route('/v1', v1Route);

app.get('/', (c) => {
    return c.json({ message: 'OpenClaw API Gateway Running' });
});

// ── Public health + metrics endpoint (no auth required) ─────────────────────
// Consumed by Mission Control /infra page for passive observability.
// All data comes from the existing `request_logs` table in Supabase.
const GATEWAY_START = Date.now();
app.get('/health', async (c) => {
    const since24h  = new Date(Date.now() - 86_400_000).toISOString();
    const since30d   = new Date(Date.now() - 30 * 86_400_000).toISOString();

    // Parallel queries — best effort, errors return empty gracefully
    const [providersRes, logsRes, recentRes, logs30dRes] = await Promise.all([
        // Active upstream providers
        supabase.from('upstream_keys').select('id, provider').eq('is_active', true),

        // 24h aggregated stats from request_logs
        supabase.from('request_logs')
            .select('model, provider, latency_ms, total_tokens, status_code, error_message')
            .gte('created_at', since24h)
            .limit(1000),

        // Last 10 requests for the recent table
        supabase.from('request_logs')
            .select('model, provider, latency_ms, total_tokens, status_code, created_at')
            .order('created_at', { ascending: false })
            .limit(10),

        // 30-day token totals (for cost calculator)
        supabase.from('request_logs')
            .select('total_tokens, status_code')
            .gte('created_at', since30d)
            .limit(5000),
    ]);

    const logs    = logsRes.data    || [];
    const recent  = recentRes.data  || [];
    const logs30d = logs30dRes.data || [];

    // Aggregate latency + tokens
    const successLogs = logs.filter((l: any) => l.status_code === 200);
    const allLatencies = successLogs.map((l: any) => l.latency_ms as number).sort((a: number, b: number) => a - b);
    const avgLatency = allLatencies.length ? Math.round(allLatencies.reduce((s: number, v: number) => s + v, 0) / allLatencies.length) : null;
    const p95Latency = allLatencies.length ? allLatencies[Math.floor(allLatencies.length * 0.95)] ?? null : null;
    const totalTokens = logs.reduce((s: number, l: any) => s + (l.total_tokens || 0), 0);

    // Per-model breakdown
    const byModel: Record<string, { model: string; provider: string; requests: number; avg_latency: number | null; total_tokens: number; errors: number }> = {};
    for (const l of logs as any[]) {
        const key = l.model || 'unknown';
        if (!byModel[key]) byModel[key] = { model: key, provider: l.provider, requests: 0, avg_latency: null, total_tokens: 0, errors: 0 };
        byModel[key].requests++;
        byModel[key].total_tokens += l.total_tokens || 0;
        if (l.status_code !== 200) byModel[key].errors++;
    }
    // Compute per-model avg latency
    for (const m of Object.values(byModel)) {
        const lats = (logs as any[]).filter((l: any) => l.model === m.model && l.status_code === 200).map((l: any) => l.latency_ms as number);
        m.avg_latency = lats.length ? Math.round(lats.reduce((s: number, v: number) => s + v, 0) / lats.length) : null;
    }

    // Per-provider breakdown
    const byProvider: Record<string, { requests: number; errors: number; total_tokens: number }> = {};
    for (const l of logs as any[]) {
        const p = l.provider || 'unknown';
        if (!byProvider[p]) byProvider[p] = { requests: 0, errors: 0, total_tokens: 0 };
        byProvider[p].requests++;
        byProvider[p].total_tokens += l.total_tokens || 0;
        if (l.status_code !== 200) byProvider[p].errors++;
    }

    return c.json({
        status:        'ok',
        uptime:        Math.floor((Date.now() - GATEWAY_START) / 1000),
        providers:     (providersRes.data || []).map((p: any) => ({ provider: p.provider, health: 'active' })),
        // 24-hour metrics window
        metrics_24h: {
            total_requests: logs.length,
            success_requests: successLogs.length,
            error_requests: logs.length - successLogs.length,
            avg_latency_ms:  avgLatency,
            p95_latency_ms:  p95Latency,
            total_tokens:    totalTokens,
            by_model:        Object.values(byModel).sort((a, b) => b.requests - a.requests),
            by_provider:     Object.entries(byProvider).map(([provider, s]) => ({ provider, ...s })).sort((a, b) => b.requests - a.requests),
        },
        // 30-day window for cost estimation
        metrics_30d: {
            total_requests:  logs30d.length,
            success_requests: (logs30d as any[]).filter((l: any) => l.status_code === 200).length,
            total_tokens:    (logs30d as any[]).reduce((s: number, l: any) => s + (l.total_tokens || 0), 0),
        },
        recent_requests: recent.map((r: any) => ({
            model:             r.model,
            provider:          r.provider,
            latency_ms:        r.latency_ms,
            prompt_tokens:     r.prompt_tokens ?? 0,
            completion_tokens: r.completion_tokens ?? 0,
            total_tokens:      r.total_tokens,
            status_code:       r.status_code,
            ts:                r.created_at ?? r.inserted_at ?? null,
        })),
        ts: Date.now(),
    });
});


app.post('/api/auth/login', async (c) => {
    const { username, password } = await c.req.json();

    // Very simplistic auth for the admin panel using our Admins table
    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username)
        .single();

    if (error || !data || data.password_hash !== password) {
        // Note: In production, use bcrypt to compare hashes. 
        // For this prototype we will compare plain text to hash column to keep it simple, 
        // but ideally we should hash it. Let's assume password_hash is plain text for this scaffold unless changed.
        return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Issue a simple token (mock JWT for now)
    return c.json({ token: 'mock-admin-token-123', user: data.username });
});

// -----------------------------------------------------------------------------
// UPDATE CREDENTIALS ENDPOINT
// PUT /api/auth/credentials
// Allows administrators to securely replace their current username and/or password.
// Security: Verifies the 'currentPassword' before processing any updates to prevent 
// unauthorized changes.
// -----------------------------------------------------------------------------
app.put('/api/auth/credentials', async (c) => {
    const { currentUsername, currentPassword, newUsername, newPassword } = await c.req.json();

    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('username', currentUsername)
        .single();

    if (error || !data || data.password_hash !== currentPassword) {
        return c.json({ error: 'Invalid current credentials' }, 401);
    }

    const updates: any = {};
    if (newUsername) updates.username = newUsername;
    if (newPassword) updates.password_hash = newPassword;

    if (Object.keys(updates).length === 0) {
        return c.json({ error: 'No new credentials provided' }, 400);
    }

    const { error: updateError } = await supabase
        .from('admins')
        .update(updates)
        .eq('username', currentUsername);

    if (updateError) {
        return c.json({ error: updateError.message }, 500);
    }

    return c.json({ success: true, newUsername: newUsername || currentUsername });
});

const port = parseInt(process.env.PORT || '3000');
console.log(`Server is running on port ${port}`);

serve({
    fetch: app.fetch,
    port
});
