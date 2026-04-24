/**
 * SOAT Phase 3 — Job Queue
 *
 * Manages the lifecycle of batch jobs using Supabase as the persistent store.
 * Each job has a type, payload, and status (pending → submitted → polling → done/failed).
 *
 * Table schema (run once in Supabase SQL editor):
 *
 *   CREATE TABLE batch_jobs (
 *     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
 *     type         TEXT NOT NULL,          -- 'openai_batch' | 'compress_context'
 *     status       TEXT NOT NULL DEFAULT 'pending',  -- pending|submitted|polling|done|failed
 *     payload      JSONB NOT NULL,
 *     result       JSONB,
 *     openai_batch_id  TEXT,              -- OpenAI batch_id after submission
 *     error        TEXT,
 *     created_at   TIMESTAMPTZ DEFAULT now(),
 *     updated_at   TIMESTAMPTZ DEFAULT now()
 *   );
 */

import { supabase } from './db.js';

export type JobStatus = 'pending' | 'submitted' | 'polling' | 'done' | 'failed';
export type JobType = 'openai_batch' | 'compress_context';

export interface BatchJob {
    id: string;
    project_id: string;
    type: JobType;
    status: JobStatus;
    payload: any;
    result: any | null;
    openai_batch_id: string | null;
    error: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * Fetch jobs by status — the main driver of the polling loop.
 */
export async function getJobsByStatus(status: JobStatus): Promise<BatchJob[]> {
    const { data, error } = await supabase
        .from('batch_jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: true });

    if (error) {
        console.error(`[JobQueue] Failed to fetch ${status} jobs:`, error.message);
        return [];
    }
    return (data as BatchJob[]) || [];
}

/**
 * Update a job's status and optional extra fields atomically.
 */
export async function updateJob(
    id: string,
    updates: Partial<Pick<BatchJob, 'status' | 'openai_batch_id' | 'result' | 'error'>>
): Promise<void> {
    const { error } = await supabase
        .from('batch_jobs')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error(`[JobQueue] Failed to update job ${id}:`, error.message);
    }
}

/**
 * Enqueue a new job — callable from the gateway (or any other service).
 */
export async function enqueueJob(
    project_id: string,
    type: JobType,
    payload: any
): Promise<string | null> {
    const { data, error } = await supabase
        .from('batch_jobs')
        .insert([{ project_id, type, payload }])
        .select('id')
        .single();

    if (error) {
        console.error('[JobQueue] Failed to enqueue job:', error.message);
        return null;
    }
    const ts = new Date().toISOString();
    console.log(`[${ts}] [JobQueue] Enqueued ${type} job → id=${data.id}`);
    return data.id;
}
