/**
 * SOAT Phase 3 — Context Compressor
 *
 * Reduces conversation context size when it approaches token limits,
 * preventing upstream provider 400 errors and reducing cost.
 *
 * Strategy (in order of aggressiveness):
 *   1. Drop oldest non-system messages (sliding window)
 *   2. Summarize older turns into a single [SUMMARY] block using the cheapest provider
 *   3. Truncate oversized individual messages
 *
 * Job payload shape (type: 'compress_context'):
 *   {
 *     messages: any[],        -- original message array
 *     max_tokens: number,     -- target token budget (default: 4000)
 *     upstream_key_id: string -- key to use for summarization calls
 *   }
 */

import { getJobsByStatus, updateJob } from './jobQueue.js';
import { supabase } from './db.js';

// Rough token estimator (4 chars ≈ 1 token) — avoids tiktoken dep for simplicity
function estimateTokens(messages: any[]): number {
    let total = 0;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            total += Math.ceil(msg.content.length / 4);
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block?.text) total += Math.ceil(block.text.length / 4);
            }
        }
    }
    return total;
}

/**
 * Sliding window compression: keeps system message + last N turns.
 * Fast and free — no LLM call needed.
 */
function slidingWindowCompress(messages: any[], maxTokens: number): any[] {
    const [system, ...rest] = messages[0]?.role === 'system'
        ? [messages[0], ...messages.slice(1)]
        : [null, ...messages];

    let compressed = system ? [system] : [];
    let i = rest.length - 1;

    // Walk backwards, adding messages until we'd exceed budget
    const kept: any[] = [];
    while (i >= 0) {
        const candidate = [...compressed, rest[i], ...kept];
        if (estimateTokens(candidate) > maxTokens) break;
        kept.unshift(rest[i]);
        i--;
    }

    return [...compressed, ...kept];
}

/**
 * Summarize dropped turns using a cheap upstream provider.
 * Returns a synthetic [SUMMARY] user message to prepend.
 */
async function summarizeDroppedTurns(
    droppedMessages: any[],
    apiKey: string,
    baseUrl: string
): Promise<string> {
    const combined = droppedMessages
        .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n');

    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant', // use cheapest groq model for summarization
            messages: [
                {
                    role: 'system',
                    content: 'You are a concise summarizer. Summarize the following conversation turns in 3-5 sentences, preserving the most important context.',
                },
                { role: 'user', content: combined },
            ],
            max_tokens: 300,
            stream: false,
        }),
    });

    if (!response.ok) {
        const ts = new Date().toISOString();
        console.warn(`[${ts}] [ContextCompressor] Summarization failed, using truncation only`);
        return '[Previous conversation truncated for context length]';
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '[Previous conversation truncated]';
}

/**
 * Process all pending compress_context jobs.
 */
export async function processCompressionJobs(): Promise<void> {
    const jobs = await getJobsByStatus('pending');
    const compressionJobs = jobs.filter(j => j.type === 'compress_context');

    if (compressionJobs.length === 0) return;

    const ts = new Date().toISOString();
    console.log(`[${ts}] [ContextCompressor] Processing ${compressionJobs.length} compression job(s)`);

    for (const job of compressionJobs) {
        try {
            const { messages, max_tokens = 4000, upstream_key_id } = job.payload as {
                messages: any[];
                max_tokens?: number;
                upstream_key_id?: string;
            };

            if (!messages?.length) {
                await updateJob(job.id, { status: 'failed', error: 'No messages in payload' });
                continue;
            }

            const before = estimateTokens(messages);
            let compressed = messages;

            if (before > max_tokens) {
                // Step 1: sliding window (no API call, instant)
                compressed = slidingWindowCompress(messages, max_tokens);
                const after = estimateTokens(compressed);
                const dropped = messages.length - compressed.length;

                const ts2 = new Date().toISOString();
                console.log(`[${ts2}] [ContextCompressor] job=${job.id} ${before}→${after} tokens, dropped ${dropped} messages`);

                // Step 2: if we dropped messages and have an upstream key, add summarization context
                if (dropped > 0 && upstream_key_id) {
                    const { data: upstream } = await supabase
                        .from('upstream_keys')
                        .select('api_key, provider')
                        .eq('id', upstream_key_id)
                        .single();

                    if (upstream) {
                        const baseUrl = upstream.provider === 'groq'
                            ? 'https://api.groq.com/openai/v1/chat/completions'
                            : 'https://api.openai.com/v1/chat/completions';

                        const droppedMessages = messages.slice(
                            messages[0]?.role === 'system' ? 1 : 0,
                            messages.length - (messages.length - compressed.length) - 1
                        );

                        if (droppedMessages.length > 0) {
                            const summary = await summarizeDroppedTurns(droppedMessages, upstream.api_key, baseUrl);
                            // Insert summary as user message right after system prompt
                            const insertIdx = compressed[0]?.role === 'system' ? 1 : 0;
                            compressed.splice(insertIdx, 0, {
                                role: 'user',
                                content: `[CONTEXT SUMMARY — prior conversation]: ${summary}`,
                            });
                            compressed.splice(insertIdx + 1, 0, {
                                role: 'assistant',
                                content: 'Understood. I have the context from our previous conversation.',
                            });
                        }
                    }
                }
            }

            await updateJob(job.id, {
                status: 'done',
                result: {
                    compressed_messages: compressed,
                    original_token_estimate: before,
                    compressed_token_estimate: estimateTokens(compressed),
                },
            });

        } catch (err: any) {
            const ts = new Date().toISOString();
            console.error(`[${ts}] [ContextCompressor] Job ${job.id} failed:`, err.message);
            await updateJob(job.id, { status: 'failed', error: err.message });
        }
    }
}
