CREATE TABLE IF NOT EXISTS public.request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    gateway_key_id UUID REFERENCES public.gateway_keys(id) ON DELETE SET NULL,
    upstream_key_id UUID REFERENCES public.upstream_keys(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status_code SMALLINT NOT NULL,
    latency_ms INTEGER NOT NULL,
    total_tokens INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;

-- Note: pg_cron is only available if enabled in Supabase settings
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'delete-old-request-logs', 
    '0 0 * * *', 
    $$DELETE FROM public.request_logs WHERE created_at < NOW() - INTERVAL '7 days'$$
);
