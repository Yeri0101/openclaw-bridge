/**
 * SOAT Phase 3 — OpenAI Batch Submitter
 *
 * Picks up 'pending' jobs of type 'openai_batch' and submits them
 * to the OpenAI Batch API. On success, updates the job to 'submitted'
 * and stores the openai_batch_id for the poller to track.
 *
 * OpenAI Batch API flow:
 *   1. Upload a JSONL file with multiple /v1/chat/completions requests
 *   2. Create a batch referencing that file_id
 *   3. Poll /v1/batches/{batch_id} until status is 'completed' or 'failed'
 *   4. Download output_file_id content and parse results
 *
 * Job payload shape:
 *   {
 *     api_key: string,          // OpenAI API key to use
 *     model: string,
 *     requests: Array<{
 *       custom_id: string,       // correlates to your internal request ID
 *       messages: any[],
 *       max_tokens?: number,
 *     }>
 *   }
 */

import { getJobsByStatus, updateJob } from './jobQueue.js';

const OPENAI_API = 'https://api.openai.com/v1';

interface BatchRequest {
    custom_id: string;
    messages: any[];
    max_tokens?: number;
}

async function uploadBatchFile(apiKey: string, requests: BatchRequest[], model: string): Promise<string> {
    // Build JSONL content — one JSON object per line
    const jsonl = requests.map(req => JSON.stringify({
        custom_id: req.custom_id,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
            model,
            messages: req.messages,
            max_tokens: req.max_tokens || 4096,
        }
    })).join('\n');

    // OpenAI requires multipart/form-data file upload
    const formData = new FormData();
    const blob = new Blob([jsonl], { type: 'application/jsonl' });
    formData.append('file', blob, 'batch_input.jsonl');
    formData.append('purpose', 'batch');

    const response = await fetch(`${OPENAI_API}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(`File upload failed: ${err?.error?.message || response.statusText}`);
    }

    const file = await response.json() as any;
    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchSubmitter] Uploaded JSONL file_id=${file.id} (${requests.length} requests)`);
    return file.id;
}

async function createBatch(apiKey: string, fileId: string): Promise<string> {
    const response = await fetch(`${OPENAI_API}/batches`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            input_file_id: fileId,
            endpoint: '/v1/chat/completions',
            completion_window: '24h',
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any;
        throw new Error(`Batch creation failed: ${err?.error?.message || response.statusText}`);
    }

    const batch = await response.json() as any;
    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchSubmitter] Created batch_id=${batch.id} status=${batch.status}`);
    return batch.id;
}

/**
 * Process all 'pending' openai_batch jobs.
 * Called on each tick of the main loop.
 */
export async function processPendingBatches(): Promise<void> {
    const jobs = await getJobsByStatus('pending');
    const batchJobs = jobs.filter(j => j.type === 'openai_batch');

    if (batchJobs.length === 0) return;

    const ts = new Date().toISOString();
    console.log(`[${ts}] [BatchSubmitter] Found ${batchJobs.length} pending batch job(s)`);

    for (const job of batchJobs) {
        try {
            const { api_key, model, requests } = job.payload as {
                api_key: string;
                model: string;
                requests: BatchRequest[];
            };

            if (!api_key || !model || !requests?.length) {
                await updateJob(job.id, {
                    status: 'failed',
                    error: 'Invalid payload: missing api_key, model, or requests',
                });
                continue;
            }

            // 1. Upload JSONL file to OpenAI
            const fileId = await uploadBatchFile(api_key, requests, model);

            // 2. Create the batch
            const batchId = await createBatch(api_key, fileId);

            // 3. Mark job as 'submitted' with the batch ID for poller to track
            await updateJob(job.id, {
                status: 'submitted',
                openai_batch_id: batchId,
            });

        } catch (err: any) {
            const ts = new Date().toISOString();
            console.error(`[${ts}] [BatchSubmitter] Job ${job.id} failed:`, err.message);
            await updateJob(job.id, { status: 'failed', error: err.message });
        }
    }
}
