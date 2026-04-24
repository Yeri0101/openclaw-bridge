/**
 * SOAT Phase 3 — OpenAI Batch Poller
 *
 * Polls the status of 'submitted' (and 'polling') openai_batch jobs.
 * When a batch is complete, downloads results and marks the job 'done'.
 *
 * OpenAI Batch statuses:
 *   validating → in_progress → finalizing → completed | failed | expired | cancelled
 */

import { getJobsByStatus, updateJob, BatchJob } from './jobQueue.js';

const OPENAI_API = 'https://api.openai.com/v1';

interface BatchStatus {
    id: string;
    status: string;
    output_file_id: string | null;
    error_file_id: string | null;
    request_counts: {
        total: number;
        completed: number;
        failed: number;
    };
}

async function fetchBatchStatus(apiKey: string, batchId: string): Promise<BatchStatus> {
    const response = await fetch(`${OPENAI_API}/batches/${batchId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(`Batch status fetch failed: ${err?.error?.message || response.statusText}`);
    }

    return response.json() as Promise<BatchStatus>;
}

async function fetchBatchResults(apiKey: string, fileId: string): Promise<any[]> {
    const response = await fetch(`${OPENAI_API}/files/${fileId}/content`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch output file ${fileId}: ${response.statusText}`);
    }

    // Output file is JSONL — parse line by line
    const text = await response.text();
    return text
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
            try { return JSON.parse(line); }
            catch { return null; }
        })
        .filter(Boolean);
}

async function pollJob(job: BatchJob): Promise<void> {
    const { api_key } = job.payload as { api_key: string };
    const batchId = job.openai_batch_id!;

    if (!api_key || !batchId) {
        await updateJob(job.id, { status: 'failed', error: 'Missing api_key or openai_batch_id' });
        return;
    }

    const batchStatus = await fetchBatchStatus(api_key, batchId);
    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchPoller] job=${job.id} batch=${batchId} status=${batchStatus.status} (${batchStatus.request_counts.completed}/${batchStatus.request_counts.total} complete)`);

    switch (batchStatus.status) {
        case 'validating':
        case 'in_progress':
        case 'finalizing':
            // Still running — mark as 'polling' so we can filter easily
            if (job.status !== 'polling') {
                await updateJob(job.id, { status: 'polling' });
            }
            break;

        case 'completed': {
            if (!batchStatus.output_file_id) {
                await updateJob(job.id, { status: 'failed', error: 'Batch completed but no output_file_id' });
                return;
            }
            const results = await fetchBatchResults(api_key, batchStatus.output_file_id);
            console.log(`[${ts}] [BatchPoller] job=${job.id} DONE — ${results.length} results`);
            await updateJob(job.id, {
                status: 'done',
                result: { outputs: results, batch_status: batchStatus },
            });
            break;
        }

        case 'failed':
        case 'expired':
        case 'cancelled': {
            let errorSummary = `Batch ${batchStatus.status}`;
            if (batchStatus.error_file_id) {
                try {
                    const errors = await fetchBatchResults(api_key, batchStatus.error_file_id);
                    errorSummary += ` — ${errors.length} error(s)`;
                } catch { /* ignore */ }
            }
            console.error(`[${ts}] [BatchPoller] job=${job.id} FAILED: ${errorSummary}`);
            await updateJob(job.id, { status: 'failed', error: errorSummary });
            break;
        }

        default:
            console.warn(`[${ts}] [BatchPoller] Unknown batch status: ${batchStatus.status}`);
    }
}

/**
 * Poll all 'submitted' and 'polling' jobs.
 * Called on each tick of the main loop.
 */
export async function pollActiveBatches(): Promise<void> {
    const submitted = await getJobsByStatus('submitted');
    const polling = await getJobsByStatus('polling');
    const toCheck = [...submitted, ...polling];

    if (toCheck.length === 0) return;

    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchPoller] Checking ${toCheck.length} active batch(es)`);

    // Poll all jobs concurrently (each is an independent API call)
    await Promise.allSettled(toCheck.map(job => pollJob(job).catch(err => {
        const ts = new Date().toISOString();
        console.error(`[${ts}] [BatchPoller] Error polling job ${job.id}:`, err.message);
    })));
}
