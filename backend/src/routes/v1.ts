import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { supabase } from '../db';
import { gatewayAuth } from '../middleware/gatewayAuth';
import { providerStates, updateProviderCalls, markProviderError, checkAndRecoverProvider } from '../utils/limitTracker';
import { callPuterAI, callPuterAIStream } from '../utils/puterClient';
import { buildCacheKey, getCached, setCached } from '../utils/semanticCache';
import { isProviderSlow, recordLatency, markProviderSlow, LATENCY_ABORT_TIMEOUT_MS } from '../utils/latencyGuard';
import { classifyRequest, filterCandidatesByTier, estimateTokenCount } from '../utils/smartRouter';

type Variables = {
    gatewayKey: any;
};

type UsageBreakdown = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
};

type PricingMatch = {
    provider: string;
    model_name: string;
    input_price_per_1m: number;
    output_price_per_1m: number;
};

const v1 = new Hono<{ Variables: Variables }>();

v1.use('*', gatewayAuth);

// In-memory counter for round-robin load balancing
const modelCounters: Record<string, number> = {};
function normalizeUsage(usage: any, fallbackPromptTokens = 0): UsageBreakdown {
    const prompt_tokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? fallbackPromptTokens ?? 0) || 0;
    const completion_tokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0;
    const total_tokens = Number(usage?.total_tokens ?? (prompt_tokens + completion_tokens)) || 0;

    return {
        prompt_tokens,
        completion_tokens,
        total_tokens: Math.max(total_tokens, prompt_tokens + completion_tokens),
    };
}

async function insertRequestLog(entry: {
    project_id: string;
    gateway_key_id: string;
    upstream_key_id: string | null;
    provider: string | null;
    model: string;
    status_code: number;
    latency_ms: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    input_cost_usd?: number;
    output_cost_usd?: number;
    total_cost_usd?: number;
    pricing_provider?: string | null;
    pricing_model_name?: string | null;
    pricing_input_per_1m?: number | null;
    pricing_output_per_1m?: number | null;
    error_message?: string | null;
}) {
    const { error: logErr } = await supabase.from('request_logs').insert([entry]);
    if (logErr) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] Logging failed:`, logErr);
    }
}

async function getPricingForModel(model: string, provider: string | null): Promise<PricingMatch | null> {
    const { data, error } = await supabase
        .from('model_pricing')
        .select('provider, model_name, input_price_per_1m, output_price_per_1m, is_active')
        .eq('model_name', model)
        .eq('is_active', true)
        .in('provider', provider ? [provider, '*'] : ['*']);

    if (error) {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] Pricing lookup failed:`, error);
        return null;
    }

    if (!data || data.length === 0) return null;

    const exact = provider ? data.find((row: any) => row.provider === provider) : null;
    const fallback = data.find((row: any) => row.provider === '*');
    const match = exact || fallback;
    if (!match) return null;

    return {
        provider: match.provider,
        model_name: match.model_name,
        input_price_per_1m: Number(match.input_price_per_1m || 0),
        output_price_per_1m: Number(match.output_price_per_1m || 0),
    };
}

function roundUsd(value: number): number {
    return Number(value.toFixed(8));
}

async function buildCostFields(model: string, provider: string | null, promptTokens: number, completionTokens: number) {
    const pricing = await getPricingForModel(model, provider);
    if (!pricing) {
        return {
            input_cost_usd: 0,
            output_cost_usd: 0,
            total_cost_usd: 0,
            pricing_provider: null,
            pricing_model_name: null,
            pricing_input_per_1m: null,
            pricing_output_per_1m: null,
        };
    }

    const input_cost_usd = roundUsd((promptTokens / 1_000_000) * pricing.input_price_per_1m);
    const output_cost_usd = roundUsd((completionTokens / 1_000_000) * pricing.output_price_per_1m);
    const total_cost_usd = roundUsd(input_cost_usd + output_cost_usd);

    return {
        input_cost_usd,
        output_cost_usd,
        total_cost_usd,
        pricing_provider: pricing.provider,
        pricing_model_name: pricing.model_name,
        pricing_input_per_1m: pricing.input_price_per_1m,
        pricing_output_per_1m: pricing.output_price_per_1m,
    };
}

async function enforceProjectBudget(c: any, gatewayKey: any) {
    const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id, name, budget_usd, budget_alert_threshold_pct')
        .eq('id', gatewayKey.project_id)
        .single();

    if (projectError || !project) {
        return c.json({ error: { message: 'Project not found for gateway key', type: 'server_error' } }, 500);
    }

    if (project.budget_usd == null) return null;

    const { data: spendRows, error: spendError } = await supabase
        .from('request_logs')
        .select('total_cost_usd')
        .eq('project_id', gatewayKey.project_id);

    if (spendError) {
        return c.json({ error: { message: 'Failed to verify project budget', type: 'server_error' } }, 500);
    }

    const spentUsd = Number((spendRows || []).reduce((sum: number, row: any) => sum + Number(row.total_cost_usd || 0), 0).toFixed(6));
    const budgetUsd = Number(project.budget_usd);

    if (spentUsd >= budgetUsd) {
        return c.json({
            error: {
                message: `Project budget exceeded. Spent $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}.`,
                type: 'budget_exceeded_error',
            }
        }, 402);
    }

    c.set('projectBudget', {
        budget_usd: budgetUsd,
        spent_usd: spentUsd,
        alert_threshold_pct: Number(project.budget_alert_threshold_pct ?? 80),
    });

    return null;
}

v1.post('/chat/completions', async (c) => {
    const gatewayKey = c.get('gatewayKey');
    const allowedModels = gatewayKey.gateway_key_models || [];

    const budgetBlock = await enforceProjectBudget(c, gatewayKey);
    if (budgetBlock) return budgetBlock;

    try {
        const body = await c.req.json();
        let requestedModel: string = body.model || '';

        // `:buf` suffix on the model name → force non-streaming (legacy support)
        if (requestedModel.endsWith(':buf')) {
            requestedModel = requestedModel.slice(0, -4);
            body.model = requestedModel;
            body.stream = false;
        }

        // Gateway key name contains [buf] → force non-streaming for ALL models on this key.
        // Create a key named e.g. "ZettaCore Tasks [buf]" and assign it to task agents.
        // This way model changes never break buffered mode — it's tied to the key, not the model.
        if (gatewayKey.key_name?.includes('[buf]')) {
            body.stream = false;
        }
        // Debug: dump body structure to file to diagnose 400 errors
        try {
            const { writeFileSync } = await import('fs');
            writeFileSync('/tmp/openclaw-body.json', JSON.stringify({
                model: body.model, stream: body.stream, max_tokens: body.max_tokens,
                tool_choice: body.tool_choice, response_format: body.response_format,
                keys: Object.keys(body), tools_count: (body.tools || []).length,
                messages: body.messages?.map((m: any) => ({
                    role: m.role, has_tool_calls: !!(m.tool_calls?.length),
                    content_type: typeof m.content, content_len: (m.content || '').length
                }))
            }, null, 2));
        } catch (_) { }


        // Check if the gateway key is allowed to use this model
        const allowed = allowedModels.filter((m: any) => m.model_name === requestedModel);

        if (allowed.length === 0) {
            return c.json({ error: { message: `Model ${requestedModel} is not available for this API key.`, type: "invalid_request_error" } }, 403);
        }

        // Filter out keys marked as error, rate_limited, or currently slow from our tracker
        const healthyAllowed = allowed.filter((m: any) => {
            return checkAndRecoverProvider(m.upstream_key_id) === 'healthy'
                && !isProviderSlow(m.upstream_key_id);
        });

        // Fallback to all mappings if everything is unhealthy/slow, EXCEPT explicitly paused ones
        let candidates = healthyAllowed.length > 0
            ? healthyAllowed
            : allowed.filter((m: any) => checkAndRecoverProvider(m.upstream_key_id) !== 'paused');

        if (candidates.length === 0) {
            return c.json({ error: { message: `Gateway: Model ${requestedModel} is not available. All configured providers are exhausted, broken, or paused.`, type: "server_error" } }, 503);
        }

        // --- SOAT: Semantic Cache Check ---
        // Only cache non-streaming requests (streaming responses can't be replayed)
        const cacheKey = !body.stream ? buildCacheKey(requestedModel, body.messages) : null;
        if (cacheKey) {
            const cached = getCached(cacheKey);
            if (cached) {
                const ts = new Date().toISOString();
                console.log(`[${ts}] [SemanticCache] HIT for model=${requestedModel} key=${cacheKey.substring(0, 12)}…`);
                c.header('X-Cache', 'HIT');
                return c.json(cached, 200);
            }
        }

        // --- SOAT: Atlas Smart Router — 3-Tier Classification ---
        // Bulk-fetch provider names for all candidate upstream_key_ids (single query, no loop)
        const candidateUpstreamIds = candidates.map((m: any) => m.upstream_key_id);
        const { data: providerMeta } = await supabase
            .from('upstream_keys')
            .select('id, provider')
            .in('id', candidateUpstreamIds);

        const providerMap: Record<string, string> = {};
        (providerMeta || []).forEach((row: any) => { providerMap[row.id] = row.provider; });

        // Enrich candidates with provider name for tier filtering
        const enrichedCandidates = candidates.map((m: any) => ({
            ...m,
            provider: providerMap[m.upstream_key_id] || 'unknown',
        }));

        const routingTier = classifyRequest({
            messages: body.messages || [],
            tools: body.tools || [],
        });
        const estimatedTok = estimateTokenCount(body.messages || []);
        candidates = filterCandidatesByTier(routingTier, enrichedCandidates);

        const tsRouter = new Date().toISOString();
        console.log(`[${tsRouter}] [SmartRouter] tier=${routingTier} estimatedTokens=${estimatedTok} candidatesAfterFilter=${candidates.length}/${enrichedCandidates.length}`);

        if (candidates.length === 0) {
            return c.json({ error: { message: `Model ${requestedModel} is not available.`, type: "invalid_request_error" } }, 403);
        }

        // Round-robin load balancing
        const counterKey = `${gatewayKey.id}:${requestedModel}`;
        if (typeof modelCounters[counterKey] === 'undefined') {
            modelCounters[counterKey] = 0;
        }

        // Diagnostic: log all configured keys and their health status for this model
        const ts0 = new Date().toISOString();
        console.log(`[${ts0}] [RoundRobin] model=${requestedModel} | DB keys for this gw-key: ${allowed.length} | Healthy: ${healthyAllowed.length} | Counter: ${modelCounters[counterKey]}`);
        allowed.forEach((m: any, i: number) => {
            const s = checkAndRecoverProvider(m.upstream_key_id);
            console.log(`[${ts0}]   slot[${i}] upstream_id=${m.upstream_key_id.substring(0, 8)}... health=${s} inCandidates=${candidates.some((c: any) => c.upstream_key_id === m.upstream_key_id)}`);
        });

        // Advance counter ONCE before the fallback loop so that failed retries
        // don't consume a rotation slot and skip a key on the next request.
        const startIndex = modelCounters[counterKey] % candidates.length;
        modelCounters[counterKey]++;

        const startTime = Date.now();
        let finalResponse: any = null;
        let finalStatus = 500;
        let finalTokens = 0;
        let finalPromptTokens = 0;
        let finalCompletionTokens = 0;
        let usedUpstreamKeyId: string | null = null;
        let usedProvider: string | null = null;
        let finalErrorMsg: string | null = null;
        let finalErrorData: any = null;
        const estimatedPromptTokens = estimateTokenCount(body.messages || []);

        // Fallback Loop — starts at startIndex, wraps around through all candidates
        for (let attempt = 0; attempt < candidates.length; attempt++) {
            const selectedIndex = (startIndex + attempt) % candidates.length;
            const selectedMapping = candidates[selectedIndex];


            usedUpstreamKeyId = selectedMapping.upstream_key_id;

            const { data: upstream, error } = await supabase
                .from('upstream_keys')
                .select('*')
                .eq('id', selectedMapping.upstream_key_id)
                .single();

            if (error || !upstream) {
                const timestamp = new Date().toISOString();
                console.error(`[${timestamp}] Upstream provider not found or misconfigured for id: ${selectedMapping.upstream_key_id}`);
                continue; // Try next
            }

            usedProvider = upstream.provider;
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [Load Balancer] Attempt ${attempt + 1}: Using upstream key ${upstream.id} for model ${requestedModel} (Index: ${selectedIndex}, Total Options: ${candidates.length})`);

            // Determine the base URL based on provider
            let baseUrl = '';
            if (upstream.provider === 'openai') baseUrl = 'https://api.openai.com/v1/chat/completions';
            else if (upstream.provider === 'groq') baseUrl = 'https://api.groq.com/openai/v1/chat/completions';
            else if (upstream.provider === 'openrouter') baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
            else if (upstream.provider === 'cerebras') baseUrl = 'https://api.cerebras.ai/v1/chat/completions';
            else if (upstream.provider === 'google' || upstream.provider === 'vertex') baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
            // Mistral: fully OpenAI-compatible REST API
            else if (upstream.provider === 'mistral') baseUrl = 'https://api.mistral.ai/v1/chat/completions';
            // NVIDIA NIM: OpenAI-compatible API via integrate.api.nvidia.com
            else if (upstream.provider === 'nvidia') baseUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
            // Vercel AI Gateway: OpenAI-compatible proxy — base URL confirmed from Vercel docs
            else if (upstream.provider === 'vercel') baseUrl = 'https://ai-gateway.vercel.sh/v1/chat/completions';
            // Chinese providers — all OpenAI-compatible
            else if (upstream.provider === 'minimax') baseUrl = 'https://api.minimax.chat/v1/chat/completions';
            else if (upstream.provider === 'moonshot') baseUrl = 'https://api.moonshot.cn/v1/chat/completions';
            else if (upstream.provider === 'deepseek') baseUrl = 'https://api.deepseek.com/chat/completions';
            else if (upstream.provider === 'mimo') baseUrl = 'https://api.xiaomimimo.com/v1/chat/completions';
            // Kie: OpenAI-compatible, but the model name is embedded in the URL path
            // e.g. gemini-2.5-flash → https://api.kie.ai/gemini-2.5-flash/v1/chat/completions
            else if (upstream.provider === 'kie') baseUrl = `https://api.kie.ai/${encodeURIComponent(requestedModel)}/v1/chat/completions`;
            else if (upstream.provider === 'zettacore') baseUrl = 'http://localhost:8000/v1/chat/completions';
            else if (upstream.provider === 'puter') {
                // Puter uses a JS SDK, not a REST endpoint — handle separately
                try {
                    const ts = new Date().toISOString();
                    console.log(`[${ts}] [Puter] Using Puter AI SDK, model=${requestedModel}`);

                    if (body.stream) {
                        // Streaming via Puter SDK
                        finalStatus = 200;
                        finalPromptTokens = estimatedPromptTokens;
                        finalCompletionTokens = 0;
                        finalTokens = Math.max(500, finalPromptTokens + finalCompletionTokens);
                        updateProviderCalls(upstream.id, finalTokens);
                        const latencyMs = Date.now() - startTime;
                        const costFields = await buildCostFields(requestedModel, 'puter', finalPromptTokens, finalCompletionTokens);
                        insertRequestLog({
                            project_id: gatewayKey.project_id,
                            gateway_key_id: gatewayKey.id,
                            upstream_key_id: upstream.id,
                            provider: 'puter',
                            model: requestedModel,
                            status_code: 200,
                            latency_ms: latencyMs,
                            total_tokens: finalTokens,
                            prompt_tokens: finalPromptTokens,
                            completion_tokens: finalCompletionTokens,
                            ...costFields,
                        }).catch(() => { });

                        c.header('Content-Type', 'text/event-stream');
                        c.header('Cache-Control', 'no-cache');
                        c.header('Connection', 'keep-alive');

                        return stream(c, async (s) => {
                            try {
                                const gen = callPuterAIStream(upstream.api_key, body.messages, {
                                    model: requestedModel,
                                    max_tokens: body.max_tokens,
                                    temperature: body.temperature,
                                });
                                for await (const chunk of gen) {
                                    await s.write(new TextEncoder().encode(chunk));
                                }
                            } catch (err: any) {
                                console.error(`[Puter] Stream error: ${err.message}`);
                                markProviderError(upstream.id, 'error', err.message);
                            }
                        });
                    } else {
                        // Non-streaming
                        const data = await callPuterAI(upstream.api_key, body.messages, {
                            model: requestedModel,
                            max_tokens: body.max_tokens,
                            temperature: body.temperature,
                        });

                        finalStatus = 200;
                        const usage = normalizeUsage(data.usage, estimatedPromptTokens);
                        finalPromptTokens = usage.prompt_tokens;
                        finalCompletionTokens = usage.completion_tokens;
                        finalTokens = usage.total_tokens;
                        updateProviderCalls(upstream.id, finalTokens);

                        data._openclaw_metadata = { provider: 'puter', upstream_key_id: upstream.id };
                        finalResponse = data;
                        break; // success
                    }
                } catch (puterErr: any) {
                    const ts = new Date().toISOString();
                    console.error(`[${ts}] [Puter] Error: ${puterErr.message}`);
                    markProviderError(upstream.id, 'error', puterErr.message);
                    finalStatus = 500;
                    finalErrorMsg = puterErr.message;
                    continue; // try next candidate
                }
            }

            if (!baseUrl) {
                const timestamp = new Date().toISOString();
                console.error(`[${timestamp}] Unknown provider ${upstream.provider}`);
                continue; // Try next
            }

            // Deep copy the body so provider-specific normalizations don't mutate the original
            // This is crucial for fallback: if Google fails, the next provider needs the original fields.
            const forwardBody = JSON.parse(JSON.stringify(body));

            // ─────────────────────────────────────────────────────────────────
            // SOAT: Silent Prompt Restructuring (Semantic Cache Anchor)
            //
            // Goal: Keep the system prompt token-stable at position [0] on every
            // request so modern LLM APIs (Gemini, Anthropic) can activate their
            // read-cache automatically → ~50% discount on input tokens.
            //
            // Algorithm:
            //  1. Pull ALL messages whose role === 'system' out of the array.
            //  2. Merge their content into a single, consolidated system block.
            //  3. Re-insert that single block at index 0, followed by the
            //     remaining user/assistant/tool turns in original order.
            // ─────────────────────────────────────────────────────────────────
            if (Array.isArray(forwardBody.messages) && forwardBody.messages.length > 0) {
                const systemMsgs: any[] = [];
                const otherMsgs: any[] = [];

                for (const msg of forwardBody.messages) {
                    if (msg.role === 'system') {
                        systemMsgs.push(msg);
                    } else {
                        otherMsgs.push(msg);
                    }
                }

                if (systemMsgs.length > 0) {
                    // Consolidate multiple system blocks into one (separated by double newline)
                    const mergedContent = systemMsgs
                        .map((m: any) => {
                            if (typeof m.content === 'string') return m.content.trim();
                            if (Array.isArray(m.content)) {
                                // Handle content-block arrays (OpenAI format)
                                return m.content
                                    .map((b: any) => (typeof b === 'string' ? b : b?.text ?? ''))
                                    .join('')
                                    .trim();
                            }
                            return '';
                        })
                        .filter(Boolean)
                        .join('\n\n');

                    const wasReordered =
                        systemMsgs.length > 1 || // multiple system blocks → always consolidate
                        forwardBody.messages[0]?.role !== 'system'; // system not already at index 0

                    forwardBody.messages = [
                        { role: 'system', content: mergedContent },
                        ...otherMsgs,
                    ];

                    if (wasReordered) {
                        const tsReorder = new Date().toISOString();
                        console.log(
                            `[${tsReorder}] [PromptAnchor] Restructured messages: ` +
                            `${systemMsgs.length} system block(s) → consolidated & anchored at [0]. ` +
                            `Total messages: ${forwardBody.messages.length} ` +
                            `(${otherMsgs.length} user/assistant turns)`
                        );
                        c.header('X-Prompt-Restructured', 'true');
                    }
                }
            }
            // ─────────────────────────────────────────────────────────────────

            // Cap max_tokens to prevent provider rejections and credit pre-reservation issues on OpenRouter
            // Priority: 1) per-provider max_output_tokens from DB  2) env var SOAT_DEFAULT_MAX_TOKENS  3) hardcoded 16000
            // SOAT Override: Premium key (SOAT_PREMIUM_BYPASS_KEY) and Google/Vertex are always exempt.
            const premiumKey = process.env.SOAT_PREMIUM_BYPASS_KEY || '';
            const isPremiumProject = premiumKey.length > 0 && typeof gatewayKey?.id === 'string' && gatewayKey.id === premiumKey;

            if (!isPremiumProject && upstream.provider !== 'google' && upstream.provider !== 'vertex') {
                // Effective cap: per-provider DB value → env default → 16000
                const envDefault = process.env.SOAT_DEFAULT_MAX_TOKENS ? Number(process.env.SOAT_DEFAULT_MAX_TOKENS) : 16000;
                const effectiveCap = (upstream.max_output_tokens && upstream.max_output_tokens > 0)
                    ? upstream.max_output_tokens
                    : envDefault;
                if (forwardBody.max_tokens && forwardBody.max_tokens > effectiveCap) {
                    forwardBody.max_tokens = effectiveCap;
                    const tsCap = new Date().toISOString();
                    console.log(`[${tsCap}] [TokenCap] max_tokens capped to ${effectiveCap} for provider=${upstream.provider} (db=${upstream.max_output_tokens ?? 'null'}, env=${process.env.SOAT_DEFAULT_MAX_TOKENS ?? 'unset'})`);
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // SOAT: Context Trim Guard
            // If the upstream key has a max_context_tokens limit, trim the oldest
            // non-system messages until the estimated input tokens fit.
            // Preserves: all system messages + last user message (never trimmed).
            // ─────────────────────────────────────────────────────────────────
            if (upstream.max_context_tokens && Array.isArray(forwardBody.messages)) {
                const limit = upstream.max_context_tokens;
                let estimated = estimateTokenCount(forwardBody.messages);
                if (estimated > limit) {
                    const ts = new Date().toISOString();
                    console.warn(`[${ts}] [ContextTrim] estimated=${estimated} > limit=${limit} for ${upstream.provider} — trimming oldest messages`);
                    // Separate: system messages (always kept) + trimmable messages
                    const systemMsgs = forwardBody.messages.filter((m: any) => m.role === 'system');
                    const nonSystem = forwardBody.messages.filter((m: any) => m.role !== 'system');
                    // Always keep at least the last user message
                    const lastUserIdx = nonSystem.map((m: any) => m.role).lastIndexOf('user');
                    let trimIdx = 0; // Start trimming from the oldest non-system message
                    while (estimated > limit && trimIdx < lastUserIdx) {
                        const removed = nonSystem.splice(0, 1);
                        estimated -= Math.ceil((JSON.stringify(removed[0]).length) / 4); // rough 1 token ≈ 4 chars
                        trimIdx++;
                    }
                    forwardBody.messages = [...systemMsgs, ...nonSystem];
                    console.warn(`[${ts}] [ContextTrim] After trim: ~${estimated} tokens, messages=${forwardBody.messages.length}`);
                }
            }
            // ─────────────────────────────────────────────────────────────────

            // Google OpenAI-compat normalization for gemini-3+ models:
            if (upstream.provider === 'google' || upstream.provider === 'vertex' || (upstream.provider === 'kie' && requestedModel.includes('gemini'))) {
                // 1. Map max_completion_tokens → max_tokens (google compat uses max_tokens)
                if (forwardBody.max_completion_tokens && !forwardBody.max_tokens) {
                    forwardBody.max_tokens = forwardBody.max_completion_tokens;
                }
                // 2. Remove fields Google does not support
                delete forwardBody.store;
                delete forwardBody.stream_options;
                delete forwardBody.max_completion_tokens;

                // 3. Normalize messages
                if (Array.isArray(forwardBody.messages)) {
                    forwardBody.messages = forwardBody.messages.map((msg: any) => {
                        // Flatten content arrays (OpenAI content blocks) → plain string
                        let content = msg.content;
                        if (Array.isArray(content)) {
                            content = content
                                .map((block: any) => {
                                    if (typeof block === 'string') return block;
                                    if (block?.type === 'text') return block.text ?? '';
                                    return '';
                                })
                                .join('');
                        }
                        // role:tool → role:user (Google compat rejects tool role)
                        if (msg.role === 'tool') {
                            return { role: 'user', content: content ?? '' };
                        }
                        // assistant: content must not be null
                        if (msg.role === 'assistant' && (content === null || content === undefined)) {
                            content = '';
                        }
                        return { ...msg, content };
                    });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // Cerebras normalization:
            // Cerebras returns 422 when receiving OpenAI-style tool_calls in the
            // message history (assistant messages with tool_calls array, or
            // role:tool result messages). Strip these to plain text equivalents.
            // ─────────────────────────────────────────────────────────────────
            if (upstream.provider === 'cerebras') {
                delete forwardBody.store;
                delete forwardBody.stream_options;
                delete forwardBody.parallel_tool_calls;

                if (Array.isArray(forwardBody.messages)) {
                    forwardBody.messages = forwardBody.messages
                        .map((msg: any) => {
                            // Flatten content arrays → plain string
                            let content = msg.content;
                            if (Array.isArray(content)) {
                                content = content
                                    .map((block: any) => {
                                        if (typeof block === 'string') return block;
                                        if (block?.type === 'text') return block.text ?? '';
                                        return '';
                                    })
                                    .join('');
                            }
                            // role:tool (tool result) → role:user
                            if (msg.role === 'tool') {
                                return { role: 'user', content: `[Tool result]: ${content ?? ''}` };
                            }
                            // assistant with tool_calls → strip tool_calls, keep text content
                            if (msg.role === 'assistant' && msg.tool_calls) {
                                const toolNames = (msg.tool_calls as any[]).map((tc: any) => tc.function?.name ?? tc.id).join(', ');
                                const textContent = content || `[Called tools: ${toolNames}]`;
                                return { role: 'assistant', content: textContent };
                            }
                            // Ensure assistant content is never null
                            if (msg.role === 'assistant' && (content === null || content === undefined)) {
                                content = '';
                            }
                            return { ...msg, content };
                        })
                        // Remove any empty assistant messages that would cause 422
                        .filter((msg: any) => !(msg.role === 'assistant' && msg.content === ''));
                }

                // Cerebras doesn't support tools/functions in the request
                delete forwardBody.tools;
                delete forwardBody.tool_choice;
                delete forwardBody.functions;
                delete forwardBody.function_call;
            }
            // ─────────────────────────────────────────────────────────────────

            try {
                // --- SOAT: Latency Guard — abort if upstream takes too long ---
                const abortController = new AbortController();
                const abortTimer = setTimeout(() => {
                    abortController.abort();
                }, LATENCY_ABORT_TIMEOUT_MS);

                const fetchStartMs = Date.now();
                let response: Response;
                try {
                    // Forward the exact body to the upstream
                    response = await fetch(baseUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${upstream.api_key}`,
                            // If OpenRouter, add required headers (can be configurable later)
                            ...(upstream.provider === 'openrouter' ? { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'OpenClaw Gateway' } : {})
                        },
                        body: JSON.stringify(forwardBody),
                        signal: abortController.signal,
                    });
                } finally {
                    clearTimeout(abortTimer);
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    const isRateLimit = response.status === 429;
                    const errMsg = errData.error?.message || response.statusText;
                    markProviderError(upstream.id, isRateLimit ? 'rate_limited' : 'error', errMsg);

                    finalStatus = response.status;
                    finalErrorMsg = errMsg;
                    finalErrorData = errData;
                    const timestamp = new Date().toISOString();
                    console.error(`[${timestamp}] [Fallback] API request failed with ${response.status}: ${errMsg}`);
                    if (response.status === 400) {
                        // Debug: show what we sent and what Google returned
                        console.error(`[${timestamp}] [Debug400] Body keys sent: ${Object.keys(body).join(', ')}`);
                        console.error(`[${timestamp}] [Debug400] Body model: ${body.model}, stream: ${body.stream}, max_tokens: ${body.max_tokens}, tools count: ${(body.tools || []).length}`);
                        console.error(`[${timestamp}] [Debug400] Google error: ${JSON.stringify(errData).substring(0, 500)}`);
                    }

                    if (isRateLimit || response.status >= 500) {
                        continue; // try next candidate if rate limited or server error
                    } else {
                        // Bad request, no need to fallback, return right away
                        break;
                    }
                }

                // --- Intercept Fake 200 OK Errors ---
                // Kie.ai specifically returns HTTP 200 OK even when it fails with code 500 or 422
                // We must catch these to trigger the SOAT fallback loop correctly.
                const contentType = response.headers.get('content-type') || '';
                if (upstream.provider === 'kie' && contentType.includes('application/json')) {
                    const clonedResponse = response.clone();
                    const jsonBody = await clonedResponse.json().catch(() => ({}));
                    if (jsonBody.code === 500 || jsonBody.code === 422 || jsonBody.error) {
                        const errMsg = jsonBody.msg || jsonBody.error?.message || 'Fake 200 Server Error';
                        markProviderError(upstream.id, 'error', errMsg);

                        finalStatus = 500;
                        finalErrorMsg = errMsg;
                        finalErrorData = jsonBody;
                        const timestamp = new Date().toISOString();
                        console.error(`[${timestamp}] [Fallback] Intercepted Kie fake 200 error: ${errMsg}`);
                        continue; // try next candidate in fallback queue
                    }
                }

                // Handle SSE (Server-Sent Events) Streaming
                // If the client requested stream: true, we must stream the upstream response
                // immediately to avoid buffer-induced latency (Time-Between-Tokens delay).
                if (body.stream && response.body) {
                    finalStatus = 200;
                    finalPromptTokens = estimatedPromptTokens;
                    finalCompletionTokens = 0;
                    finalTokens = Math.max(500, finalPromptTokens + finalCompletionTokens); // Approximation for streaming
                    updateProviderCalls(upstream.id, finalTokens);

                    // Log to supabase asynchronously
                    const latencyMs = Date.now() - startTime;
                    const costFields = await buildCostFields(requestedModel, usedProvider, finalPromptTokens, finalCompletionTokens);
                    insertRequestLog({
                        project_id: gatewayKey.project_id,
                        gateway_key_id: gatewayKey.id,
                        upstream_key_id: usedUpstreamKeyId,
                        provider: usedProvider,
                        model: requestedModel,
                        status_code: finalStatus,
                        latency_ms: latencyMs,
                        total_tokens: finalTokens,
                        prompt_tokens: finalPromptTokens,
                        completion_tokens: finalCompletionTokens,
                        ...costFields,
                    }).catch(() => { });

                    c.header('Content-Type', 'text/event-stream');
                    c.header('Cache-Control', 'no-cache');
                    c.header('Connection', 'keep-alive');

                    // stream() uses Hono's streaming wrapper to pipe the fetch ReadableStream
                    // directly to the client socket without buffering the chunks in Node.js.
                    // This creates a perfect real-time typing effect in the OpenClaw terminal.
                    return stream(c, async (s) => {
                        const reader = response.body!.getReader();

                        s.onAbort(() => {
                            const timestamp = new Date().toISOString();
                            console.log(`[${timestamp}] [Stream] Client disconnected from ${usedProvider}, aborting upstream fetch.`);
                            reader.cancel().catch(() => { });
                        });

                        try {
                            const timestamp = new Date().toISOString();
                            console.log(`[${timestamp}] [Stream] Started streaming from ${usedProvider}`);
                            let chunkCount = 0;
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    const ts = new Date().toISOString();
                                    console.log(`[${ts}] [Stream] Finished reading from ${usedProvider} after ${chunkCount} chunks. Closing.`);
                                    break;
                                }
                                chunkCount++;
                                await s.write(value); // Flush the chunk instantly to the client
                                // console.log(`[Stream] Wrote chunk ${chunkCount} of length ${value?.length}`);
                            }
                        } catch (err: any) {
                            const timestamp = new Date().toISOString();
                            console.error(`[${timestamp}] [Stream] Error streaming from ${usedProvider}:`, err.message);
                            // Notify the client so it can retry the turn instead of silently dying
                            try {
                                const errEvent = `data: ${JSON.stringify({ error: { message: `Stream terminated by upstream (${usedProvider}): ${err.message}`, type: 'stream_error', code: 'upstream_terminated' } })}\n\ndata: [DONE]\n\n`;
                                await s.write(new TextEncoder().encode(errEvent));
                            } catch { /* client already disconnected */ }
                        }
                    });
                }

                // Handle non-streaming
                const data = await response.json();
                finalStatus = 200;
                const usage = normalizeUsage(data.usage, estimatedPromptTokens);
                finalPromptTokens = usage.prompt_tokens;
                finalCompletionTokens = usage.completion_tokens;
                finalTokens = usage.total_tokens;
                updateProviderCalls(upstream.id, finalTokens);

                // Record latency for this upstream key (latency guard tracking)
                recordLatency(upstream.id, Date.now() - fetchStartMs);

                // Inject metadata for debugging and verifying rotation
                data._openclaw_metadata = {
                    provider: upstream.provider,
                    upstream_key_id: upstream.id
                };

                // --- SOAT: Store in semantic cache (non-streaming only) ---
                if (cacheKey) {
                    setCached(cacheKey, data);
                    const ts = new Date().toISOString();
                    console.log(`[${ts}] [SemanticCache] MISS → stored key=${cacheKey.substring(0, 12)}… model=${requestedModel}`);
                }

                finalResponse = data;
                break; // success, break the loop

            } catch (fetchErr: any) {
                finalStatus = 500;
                finalErrorMsg = fetchErr.message;
                const timestamp = new Date().toISOString();
                // Distinguish AbortError (timeout) from other network errors
                if ((fetchErr as Error).name === 'AbortError') {
                    console.warn(`[${timestamp}] [LatencyGuard] Upstream ${upstream.provider} timed out after ${LATENCY_ABORT_TIMEOUT_MS}ms — marking slow, trying next.`);
                    markProviderSlow(upstream.id);
                } else {
                    console.error(`[${timestamp}] [Fallback] Fetch error: ${fetchErr.message}`);
                    markProviderError(upstream.id, 'error', fetchErr.message);
                }
                continue; // connection/timeout error, try next
            }
        } // end fallback loop

        // Log the final outcome
        const latencyMs = Date.now() - startTime;
        const costFields = await buildCostFields(requestedModel, usedProvider, finalPromptTokens, finalCompletionTokens);
        insertRequestLog({
            project_id: gatewayKey.project_id,
            gateway_key_id: gatewayKey.id,
            upstream_key_id: usedUpstreamKeyId,
            provider: usedProvider,
            model: requestedModel,
            status_code: finalStatus,
            latency_ms: latencyMs,
            total_tokens: finalTokens,
            prompt_tokens: finalPromptTokens,
            completion_tokens: finalCompletionTokens,
            ...costFields,
            error_message: finalErrorMsg
        }).catch(() => { });

        if (finalResponse) {
            c.header('X-Cache', 'MISS');
            c.header('X-Router-Tier', routingTier);
            return c.json(finalResponse, finalStatus as any);
        } else {
            const errRes = finalErrorData && finalErrorData.error ? finalErrorData : { error: { message: finalErrorMsg || "All upstream candidates failed", type: "api_error" } };
            errRes._openclaw_metadata = {
                provider: usedProvider,
                upstream_key_id: usedUpstreamKeyId
            };
            return c.json(errRes, finalStatus as any);
        }

    } catch (err: any) {
        return c.json({ error: { message: err.message, type: "internal_server_error" } }, 500);
    }
});

// Counter for Brave Search round-robin
const braveCounters: Record<string, number> = {};

// Gateway proxy for Brave Web Search
v1.get('/brave/search', async (c) => {
    const gatewayKey = c.get('gatewayKey');
    const budgetBlock = await enforceProjectBudget(c, gatewayKey);
    if (budgetBlock) return budgetBlock;
    const { q, count, offset, country, search_lang, ui_lang, safesearch, freshness, extra_snippets, enable_rich_callback } = c.req.query();

    if (!q) {
        return c.json({ error: "Missing 'q' parameter for search" }, 400);
    }

    try {
        const { data: keys, error } = await supabase
            .from('upstream_keys')
            .select('*')
            .eq('project_id', gatewayKey.project_id)
            .eq('provider', 'brave');

        if (error || !keys || keys.length === 0) {
            return c.json({ error: "No Brave Search keys configured for this project" }, 404);
        }

        // Filter healthy keys
        const healthyKeys = keys.filter(k => {
            const st = providerStates[k.id];
            return !st || st.status === 'healthy';
        });

        if (healthyKeys.length === 0) {
            return c.json({ error: "All configured Brave Search keys are currently exhausted or paused." }, 429);
        }

        const projectId = gatewayKey.project_id;
        if (braveCounters[projectId] === undefined) braveCounters[projectId] = 0;

        const keyIndex = braveCounters[projectId] % healthyKeys.length;
        braveCounters[projectId]++;
        const selectedKey = healthyKeys[keyIndex];

        // Build URL
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.append('q', q);
        if (count) url.searchParams.append('count', count);
        if (offset) url.searchParams.append('offset', offset);
        if (country) url.searchParams.append('country', country);
        if (search_lang) url.searchParams.append('search_lang', search_lang);
        if (ui_lang) url.searchParams.append('ui_lang', ui_lang);
        if (safesearch) url.searchParams.append('safesearch', safesearch);
        if (freshness) url.searchParams.append('freshness', freshness);
        if (extra_snippets) url.searchParams.append('extra_snippets', extra_snippets);
        if (enable_rich_callback) url.searchParams.append('enable_rich_callback', enable_rich_callback);

        const startTime = Date.now();
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'X-Subscription-Token': selectedKey.api_key
            }
        });

        const status = response.status;
        let data: any;

        try {
            data = await response.json();
        } catch (e) {
            data = await response.text();
        }

        if (status === 429) {
            // Mark provider as paused
            markProviderError(selectedKey.id, 'rate_limited', 'Brave Search API Rate limit exceeded');
            return c.json({ error: "Brave Search API Rate limit exceeded. Try again." }, 429);
        }

        if (!response.ok) {
            return c.json({ error: data }, status as any);
        }

        // Track usage (assuming 1 request = 1 call, tokens are not applicable here)
        updateProviderCalls(selectedKey.id, 0);

        // Add metadata for debugging
        if (typeof data === 'object' && data !== null) {
            data._openclaw_metadata = {
                provider: 'brave',
                upstream_key_id: selectedKey.id,
                latency_ms: Date.now() - startTime
            };
        }

        return c.json(data, status as any);

    } catch (err: any) {
        return c.json({ error: { message: err.message, type: "internal_server_error" } }, 500);
    }
});

// Gateway proxy for Brave Local POIs
v1.get('/brave/local/pois', async (c) => {
    const gatewayKey = c.get('gatewayKey');
    const budgetBlock = await enforceProjectBudget(c, gatewayKey);
    if (budgetBlock) return budgetBlock;
    const ids = c.req.queries('ids'); // expects ?ids=123&ids=456

    if (!ids || ids.length === 0) {
        return c.json({ error: "Missing 'ids' parameter" }, 400);
    }

    try {
        const { data: keys, error } = await supabase
            .from('upstream_keys')
            .select('*')
            .eq('project_id', gatewayKey.project_id)
            .eq('provider', 'brave');

        if (error || !keys || keys.length === 0) return c.json({ error: "No Brave Search keys configured" }, 404);

        const healthyKeys = keys.filter(k => !providerStates[k.id] || providerStates[k.id].status === 'healthy');
        if (healthyKeys.length === 0) return c.json({ error: "All keys exhausted" }, 429);

        const projectId = gatewayKey.project_id;
        if (braveCounters[projectId] === undefined) braveCounters[projectId] = 0;
        const selectedKey = healthyKeys[braveCounters[projectId]++ % healthyKeys.length];

        const url = new URL('https://api.search.brave.com/res/v1/local/pois');
        ids.forEach(id => url.searchParams.append('ids', id));

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': selectedKey.api_key
            }
        });

        const data = await (response.ok ? response.json() : response.text());

        if (response.status === 429) markProviderError(selectedKey.id, 'rate_limited', 'Brave Search Local API Rate limit exceeded');
        if (response.ok) updateProviderCalls(selectedKey.id, 0);

        return c.json(data, response.status as any);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// Gateway proxy for Brave Local Descriptions (AI-generated location summaries)
v1.get('/brave/local/descriptions', async (c) => {
    const gatewayKey = c.get('gatewayKey');
    const budgetBlock = await enforceProjectBudget(c, gatewayKey);
    if (budgetBlock) return budgetBlock;
    const ids = c.req.queries('ids');

    if (!ids || ids.length === 0) return c.json({ error: "Missing 'ids' parameter" }, 400);

    try {
        const { data: keys, error } = await supabase
            .from('upstream_keys')
            .select('*')
            .eq('project_id', gatewayKey.project_id)
            .eq('provider', 'brave');

        if (error || !keys || keys.length === 0) return c.json({ error: "No Brave Search keys configured" }, 404);

        const healthyKeys = keys.filter(k => !providerStates[k.id] || providerStates[k.id].status === 'healthy');
        if (healthyKeys.length === 0) return c.json({ error: "All keys exhausted" }, 429);

        const projectId = gatewayKey.project_id;
        if (braveCounters[projectId] === undefined) braveCounters[projectId] = 0;
        const selectedKey = healthyKeys[braveCounters[projectId]++ % healthyKeys.length];

        const url = new URL('https://api.search.brave.com/res/v1/local/descriptions');
        ids.forEach(id => url.searchParams.append('ids', id));

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': selectedKey.api_key
            }
        });

        const data = await (response.ok ? response.json() : response.text());

        if (response.status === 429) markProviderError(selectedKey.id, 'rate_limited', 'Brave Local Descriptions Rate limit exceeded');
        if (response.ok) updateProviderCalls(selectedKey.id, 0);

        return c.json(data, response.status as any);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// /v1/embeddings — Proxy to Google Gemini Embeddings API
// OpenAI-compatible interface → Gemini API format
// Uses gateway_key_models routing (same as chat/completions)
// Add "gemini-embedding-2-preview" to your project's model list to enable
// ─────────────────────────────────────────────────────────────────────────────
const embeddingCounters: Record<string, number> = {};

v1.post('/embeddings', async (c) => {
    const gatewayKey = c.get('gatewayKey');
    const allowedModels = gatewayKey.gateway_key_models || [];
    const budgetBlock = await enforceProjectBudget(c, gatewayKey);
    if (budgetBlock) return budgetBlock;

    try {
        const body = await c.req.json();
        const requestedModel: string = body.model || 'gemini-embedding-2-preview';
        const input: string | string[] = body.input;

        if (!input) {
            return c.json({ error: { message: "Missing 'input' field", type: "invalid_request_error" } }, 400);
        }

        // Use same model routing as chat/completions
        const allowed = allowedModels.filter((m: any) => m.model_name === requestedModel);

        if (allowed.length === 0) {
            return c.json({ error: { message: `Model ${requestedModel} is not available for this API key. Add it to your project's model list.`, type: "invalid_request_error" } }, 403);
        }

        // Filter healthy upstream keys
        const healthyAllowed = allowed.filter((m: any) => checkAndRecoverProvider(m.upstream_key_id) !== 'paused');
        const candidates = healthyAllowed.length > 0 ? healthyAllowed : allowed;

        if (candidates.length === 0) {
            return c.json({ error: { message: `All upstream keys for ${requestedModel} are paused.`, type: "server_error" } }, 503);
        }

        // Round-robin rotation across upstream keys
        const counterKey = `embed:${gatewayKey.id}:${requestedModel}`;
        if (embeddingCounters[counterKey] === undefined) embeddingCounters[counterKey] = 0;
        const selectedMapping = candidates[embeddingCounters[counterKey]++ % candidates.length];

        // Fetch upstream key details
        const { data: upstream, error } = await supabase
            .from('upstream_keys')
            .select('*')
            .eq('id', selectedMapping.upstream_key_id)
            .single();

        if (error || !upstream) {
            return c.json({ error: { message: "Upstream provider not found", type: "server_error" } }, 503);
        }

        // Normalize input to array
        const inputs: string[] = Array.isArray(input) ? input : [input];

        // Call Gemini batchEmbedContents API
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${requestedModel}:batchEmbedContents?key=${upstream.api_key}`;
        const geminiBody = {
            requests: inputs.map((text: string) => ({
                model: `models/${requestedModel}`,
                content: { parts: [{ text }] }
            }))
        };

        const startTime = Date.now();
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || response.statusText;
            const isRateLimit = response.status === 429;
            markProviderError(upstream.id, isRateLimit ? 'rate_limited' : 'error', errMsg);
            const ts = new Date().toISOString();
            console.error(`[${ts}] [Embeddings] ${upstream.provider} error ${response.status}: ${errMsg}`);
            return c.json({ error: { message: errMsg, type: "api_error" } }, response.status as any);
        }

        const geminiData: any = await response.json();
        const promptTokens = inputs.reduce((acc: number, t: string) => acc + Math.ceil(t.length / 4), 0);
        updateProviderCalls(upstream.id, promptTokens);

        const latencyMs = Date.now() - startTime;
        const ts = new Date().toISOString();
        console.log(`[${ts}] [Embeddings] model=${requestedModel} inputs=${inputs.length} latency=${latencyMs}ms upstream=${upstream.id.substring(0, 8)}...`);

        const costFields = await buildCostFields(requestedModel, upstream.provider, promptTokens, 0);
        insertRequestLog({
            project_id: gatewayKey.project_id,
            gateway_key_id: gatewayKey.id,
            upstream_key_id: upstream.id,
            provider: upstream.provider,
            model: requestedModel,
            status_code: 200,
            latency_ms: latencyMs,
            total_tokens: promptTokens,
            prompt_tokens: promptTokens,
            completion_tokens: 0,
            ...costFields,
            error_message: null,
        }).catch(() => { });

        // Convert Gemini → OpenAI format
        const embeddings = (geminiData.embeddings || []).map((emb: any, index: number) => ({
            object: 'embedding',
            index,
            embedding: emb.values
        }));

        return c.json({
            object: 'list',
            data: embeddings,
            model: requestedModel,
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: 0,
                total_tokens: promptTokens
            }
        });

    } catch (err: any) {
        return c.json({ error: { message: err.message, type: "internal_server_error" } }, 500);
    }
});

export default v1;
