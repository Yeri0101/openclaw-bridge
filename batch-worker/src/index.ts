/**
 * SOAT Phase 3 — Batch Worker Daemon
 *
 * Main entry point. Runs an event loop that:
 *   1. Picks up pending 'openai_batch' jobs → submits to OpenAI Batch API
 *   2. Polls 'submitted' / 'polling' jobs for completion
 *   3. Runs 'compress_context' jobs with the Context Compressor
 *
 * Loop interval is configurable via BATCH_WORKER_INTERVAL_MS (default: 60s).
 *
 * Run with:
 *   npm run dev                 (development)
 *   pm2 start dist/index.js --name batch-worker   (production)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { processPendingBatches } from './batchSubmitter.js';
import { pollActiveBatches } from './batchPoller.js';
import { processCompressionJobs } from './contextCompressor.js';

const INTERVAL_MS = parseInt(process.env.BATCH_WORKER_INTERVAL_MS || '60000');

async function tick(): Promise<void> {
    const ts = new Date().toISOString();
    console.log(`\n[${ts}] [BatchWorker] ─── tick ───────────────────────────────────`);

    try {
        // 1. Submit new openai_batch jobs
        await processPendingBatches();
    } catch (err: any) {
        console.error(`[BatchWorker] processPendingBatches error:`, err.message);
    }

    try {
        // 2. Poll active batch jobs for completion
        await pollActiveBatches();
    } catch (err: any) {
        console.error(`[BatchWorker] pollActiveBatches error:`, err.message);
    }

    try {
        // 3. Run context compression jobs
        await processCompressionJobs();
    } catch (err: any) {
        console.error(`[BatchWorker] processCompressionJobs error:`, err.message);
    }
}

async function main(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║   SOAT Batch Worker — OpenClaw Gateway               ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`Interval : ${INTERVAL_MS / 1000}s`);
    console.log(`Supabase : ${process.env.SUPABASE_URL}`);
    console.log('');

    // Run immediately on startup, then on interval
    await tick();

    setInterval(async () => {
        await tick();
    }, INTERVAL_MS);
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n[BatchWorker] SIGTERM received — shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n[BatchWorker] SIGINT received — shutting down gracefully');
    process.exit(0);
});

main().catch(err => {
    console.error('[BatchWorker] Fatal error:', err);
    process.exit(1);
});
