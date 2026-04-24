#!/usr/bin/env bash
# SOAT Phase 3 — Gateway Route for Batch Jobs
# Adds the /v1/batch endpoint to the gateway so clients can enqueue jobs via REST.
#
# ── IMPORTANT ──────────────────────────────────────────────────────────────
# Run this script ONCE to add the batch_jobs table to your Supabase project.
# Copy-paste the SQL below into the Supabase SQL editor at:
#   https://supabase.com/dashboard → SQL Editor
# ──────────────────────────────────────────────────────────────────────────

cat <<'SQL'
-- ============================================================
-- SOAT batch_jobs table
-- Run in Supabase SQL Editor
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
    type             TEXT NOT NULL CHECK (type IN ('openai_batch', 'compress_context')),
    status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','submitted','polling','done','failed')),
    payload          JSONB NOT NULL DEFAULT '{}',
    result           JSONB,
    openai_batch_id  TEXT,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast queries by status (the poller queries this constantly)
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_project ON batch_jobs(project_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_batch_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS batch_jobs_updated_at ON batch_jobs;
CREATE TRIGGER batch_jobs_updated_at
    BEFORE UPDATE ON batch_jobs
    FOR EACH ROW EXECUTE FUNCTION update_batch_jobs_updated_at();

-- RLS: service role has full access (batch-worker uses service key)
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON batch_jobs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

SQL

echo ""
echo "✅ SQL printed above. Copy it into the Supabase SQL Editor."
echo ""
echo "After running the SQL, start the batch worker with:"
echo "  cd batch-worker && npm install && npm run dev"
echo ""
echo "Or with PM2 (production):"
echo "  npx pm2 start 'npm run dev' --name batch-worker --cwd ./batch-worker"
