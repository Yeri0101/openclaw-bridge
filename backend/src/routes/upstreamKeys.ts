import { Hono } from 'hono';
import { supabase } from '../db';
import { authMiddleware } from '../middleware/auth';
import { PUTER_MODELS } from '../utils/puterClient';

const upstreamKeys = new Hono();

upstreamKeys.use('*', authMiddleware);

import { providerStates, resetAllProvidersStatus, resetProviderStatus, pauseProvider } from '../utils/limitTracker';

upstreamKeys.get('/health', async (c) => {
    return c.json(providerStates);
});

// List upstream keys — includes a masked key_preview (first 4 + last 4 chars) for identification without exposing the full key
upstreamKeys.get('/', async (c) => {
    const { data, error } = await supabase
        .from('upstream_keys')
        .select('id, project_id, provider, created_at, api_key, max_context_tokens, projects(name)')
        .order('created_at', { ascending: false });
    if (error) return c.json({ error: error.message }, 500);

    const sanitized = (data || []).map((row: any) => {
        const key: string = row.api_key || '';
        const key_preview = key.length > 8
            ? `${key.slice(0, 4)}...${key.slice(-4)}`
            : `${key.slice(0, 2)}...`;
        const { api_key: _removed, ...rest } = row;
        return { ...rest, key_preview };
    });

    return c.json(sanitized);
});

upstreamKeys.post('/', async (c) => {
    const { project_id, provider, api_key } = await c.req.json();
    const normalizedApiKey = typeof api_key === 'string' ? api_key.trim() : '';

    if (!project_id || !provider || !normalizedApiKey) {
        return c.json({ error: 'project_id, provider and api_key are required' }, 400);
    }

    const { data: existingKey, error: existingKeyError } = await supabase
        .from('upstream_keys')
        .select('id')
        .eq('api_key', normalizedApiKey)
        .limit(1)
        .maybeSingle();

    if (existingKeyError) return c.json({ error: existingKeyError.message }, 500);
    if (existingKey) return c.json({ error: 'This provider API key already exists' }, 409);

    const { data, error } = await supabase
        .from('upstream_keys')
        .insert([{ project_id, provider, api_key: normalizedApiKey }])
        .select('id, project_id, provider, created_at')
        .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json(data, 201);
});

upstreamKeys.delete('/:id', async (c) => {
    const { id } = c.req.param();
    const { error } = await supabase.from('upstream_keys').delete().eq('id', id);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ success: true });
});

// PATCH /:id/context-limit — set or clear max_context_tokens for this upstream key
upstreamKeys.patch('/:id/context-limit', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    // Send null to remove the limit entirely
    const max_context_tokens = body.max_context_tokens === null
        ? null
        : (Number(body.max_context_tokens) || null);
    const { data, error } = await supabase
        .from('upstream_keys')
        .update({ max_context_tokens })
        .eq('id', id)
        .select('id, provider, max_context_tokens')
        .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
});

upstreamKeys.post('/reset-all', async (c) => {
    resetAllProvidersStatus();
    return c.json({ success: true });
});

upstreamKeys.post('/:id/reset', async (c) => {
    const { id } = c.req.param();
    resetProviderStatus(id);
    return c.json({ success: true });
});

upstreamKeys.post('/:id/pause', async (c) => {
    const { id } = c.req.param();
    pauseProvider(id);
    return c.json({ success: true });
});

// A route to fetch available models for a given Upstream Key
upstreamKeys.get('/:id/models', async (c) => {
    const { id } = c.req.param();

    // 1. Fetch the key from db
    const { data: keyData, error } = await supabase
        .from('upstream_keys')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !keyData) return c.json({ error: 'Key not found' }, 404);

    try {
        // 2. Query provider API for models
        let url = '';
        if (keyData.provider === 'openai') url = 'https://api.openai.com/v1/models';
        else if (keyData.provider === 'groq') url = 'https://api.groq.com/openai/v1/models';
        else if (keyData.provider === 'openrouter') url = 'https://openrouter.ai/api/v1/models';
        else if (keyData.provider === 'mimo') url = 'https://api.xiaomimimo.com/v1/models';
        else if (keyData.provider === 'cerebras') url = 'https://api.cerebras.ai/v1/models';
        else if (keyData.provider === 'mistral') {
            // Try Mistral API first; fall back to curated list if the key is invalid or rate-limited
            try {
                const mistralRes = await fetch('https://api.mistral.ai/v1/models', {
                    headers: { 'Authorization': `Bearer ${keyData.api_key}` }
                });
                if (mistralRes.ok) {
                    const mistralData = await mistralRes.json();
                    const models = mistralData.data || [];
                    if (models.length > 0) {
                        return c.json({ models });
                    }
                }
                console.warn(`[Models] Mistral API returned ${mistralRes.status} — using curated fallback list`);
            } catch (fetchErr: any) {
                console.warn(`[Models] Mistral API fetch failed (${fetchErr.message}) — using curated fallback list`);
            }
            // Fallback: curated list of popular Mistral models
            return c.json({
                models: [
                    // Premier models
                    { id: 'mistral-large-latest' },
                    { id: 'mistral-large-2411' },
                    // Medium / general purpose
                    { id: 'mistral-medium-latest' },
                    { id: 'mistral-small-latest' },
                    { id: 'mistral-small-2503' },
                    // Specialized models
                    { id: 'codestral-latest' },
                    { id: 'codestral-2501' },
                    { id: 'mistral-embed' },
                    // Open-weight models
                    { id: 'open-mistral-nemo' },
                    { id: 'open-mistral-7b' },
                    { id: 'open-mixtral-8x7b' },
                    { id: 'open-mixtral-8x22b' },
                    // Pixtral (multimodal)
                    { id: 'pixtral-large-latest' },
                    { id: 'pixtral-12b-2409' },
                    // Moderation
                    { id: 'mistral-moderation-latest' },
                ]
            });
        }
        else if (keyData.provider === 'google' || keyData.provider === 'vertex' || keyData.provider === 'vertexai') {
            const googleRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyData.api_key}`);
            if (!googleRes.ok) {
                const err = await googleRes.json().catch(() => ({}));
                throw new Error(`Google API returned ${googleRes.status}: ${err.error?.message || 'Unknown error'}`);
            }
            const googleData = await googleRes.json();
            console.log("GOOGLE RESPONSE DATA:", JSON.stringify(googleData, null, 2).substring(0, 300));
            const mappedModels = (googleData.models || [])
                .map((m: any) => ({
                    id: m.name.replace('models/', '')
                }));
            return c.json({ models: mappedModels });
        }
        else if (keyData.provider === 'puter') {
            // Puter doesn't have a /models endpoint — return our curated list
            return c.json({ models: PUTER_MODELS });
        }
        else if (keyData.provider === 'kie') {
            // Kie doesn't expose a /models endpoint — return a curated list of supported models
            return c.json({
                models: [
                    // Kie specific tags
                    { id: 'gpt-5-2' }, // New model per user doc: gpt-5-2
                    { id: 'gpt-5-2-pro' },
                    { id: 'gpt-5-2-chat-latest' },
                    { id: 'gemini-3-flash' },
                    { id: 'gemini-2.5-flash' },
                    { id: 'gemini-2.5-pro' },
                    { id: 'gemini-2.0-flash' },
                    { id: 'gemini-2.0-pro-exp' },
                    { id: 'gemini-1.5-pro' },
                    { id: 'gemini-1.5-flash' },

                    // GPT / Open AI
                    { id: 'gpt-4o' },
                    { id: 'gpt-4o-mini' },
                    { id: 'o1' },
                    { id: 'o3-mini' },

                    // Anthropic Claude
                    { id: 'claude-3-7-sonnet-20250219' },
                    { id: 'claude-3-5-sonnet-20241022' },
                    { id: 'claude-3-5-haiku-20241022' },

                    // Open Source / Others
                    { id: 'deepseek-chat' }, // v3
                    { id: 'deepseek-reasoner' }, // r1
                    { id: 'llama-3.3-70b-versatile' },
                    { id: 'llama-3.1-8b-instant' }
                ]
            });
        }
        else if (keyData.provider === 'nvidia') {
            // NVIDIA NIM — try to list models via the OpenAI-compatible /models endpoint
            try {
                const nvidiaRes = await fetch('https://integrate.api.nvidia.com/v1/models', {
                    headers: { 'Authorization': `Bearer ${keyData.api_key}` }
                });
                if (nvidiaRes.ok) {
                    const nvidiaData = await nvidiaRes.json();
                    const models = nvidiaData.data || [];
                    if (models.length > 0) return c.json({ models });
                }
                console.warn(`[Models] NVIDIA API returned ${nvidiaRes.status} — using curated fallback list`);
            } catch (fetchErr: any) {
                console.warn(`[Models] NVIDIA API fetch failed (${fetchErr.message}) — using curated fallback list`);
            }
            // Curated list of popular NVIDIA NIM models
            return c.json({
                models: [
                    // Moonshot / Kimi
                    { id: 'moonshotai/kimi-k2.5' },
                    // Meta Llama
                    { id: 'meta/llama-3.3-70b-instruct' },
                    { id: 'meta/llama-3.1-405b-instruct' },
                    { id: 'meta/llama-3.1-70b-instruct' },
                    { id: 'meta/llama-3.1-8b-instruct' },
                    // Mistral
                    { id: 'mistralai/mistral-large-2-instruct' },
                    { id: 'mistralai/mixtral-8x22b-instruct-v0.1' },
                    // Google
                    { id: 'google/gemma-3-27b-it' },
                    { id: 'google/gemma-3-4b-it' },
                    // NVIDIA
                    { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1' },
                    { id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
                    // DeepSeek
                    { id: 'deepseek-ai/deepseek-r1' },
                    { id: 'deepseek-ai/deepseek-v3' },
                    // Qwen
                    { id: 'qwen/qwen3-235b-a22b' },
                    { id: 'qwen/qwq-32b' },
                    // Microsoft
                    { id: 'microsoft/phi-4-reasoning-plus' },
                ]
            });
        }
        else if (keyData.provider === 'vercel') {
            // Vercel AI Gateway — full curated list including Chinese providers
            return c.json({
                models: [
                    // ── OpenAI ──
                    { id: 'openai/gpt-4o' },
                    { id: 'openai/gpt-4o-mini' },
                    { id: 'openai/o1' },
                    { id: 'openai/o3-mini' },
                    // ── Anthropic ──
                    { id: 'anthropic/claude-3-7-sonnet-20250219' },
                    { id: 'anthropic/claude-3-5-sonnet-20241022' },
                    { id: 'anthropic/claude-3-5-haiku-20241022' },
                    // ── Google ──
                    { id: 'google/gemini-2.0-flash-001' },
                    { id: 'google/gemini-1.5-pro-002' },
                    { id: 'google/gemini-1.5-flash-002' },
                    // ── xAI Grok ──
                    { id: 'xai/grok-2-1212' },
                    { id: 'xai/grok-beta' },
                    // ── Meta Llama ──
                    { id: 'meta-llama/llama-3.3-70b-instruct' },
                    { id: 'meta-llama/llama-3.1-405b-instruct' },
                    // ── Mistral ──
                    { id: 'mistral/mistral-large-latest' },
                    { id: 'mistral/mistral-small-latest' },
                    // ── DeepSeek ──
                    { id: 'deepseek/deepseek-chat' },
                    { id: 'deepseek/deepseek-reasoner' },
                    // ── MoonShot / Kimi (China) ──
                    { id: 'moonshotai/kimi-k2.5' },
                    { id: 'moonshotai/kimi-k1.5' },
                    // ── MiniMax (China) ──
                    { id: 'minimax/minimax-m2.5' },
                    { id: 'minimax/minimax-m2' },
                    // ── Alibaba / Qwen (China) ──
                    { id: 'alibaba/qwen-max' },
                    { id: 'alibaba/qwen-plus' },
                    { id: 'alibaba/qwen-turbo' },
                    // ── Groq ──
                    { id: 'groq/llama-3.3-70b-versatile' },
                    { id: 'groq/llama-3.1-8b-instant' },
                    // ── Cerebras ──
                    { id: 'cerebras/llama3.3-70b' },
                    { id: 'cerebras/llama3.1-8b' },
                    // ── Perplexity ──
                    { id: 'perplexity/sonar-pro' },
                    { id: 'perplexity/sonar' },
                    // ── Cohere ──
                    { id: 'cohere/command-r-plus' },
                    { id: 'cohere/command-r' },
                ]
            });
        }
        else if (keyData.provider === 'zettacore') {
            return c.json({
                models: [
                    { id: 'arena-claude-opus-4-6' },
                    { id: 'arena-gpt-4o' },
                    { id: 'gemini-web' },
                    { id: 'chatgpt-web' },
                    { id: 'qwen-web' }
                ]
            });
        }
        else if (keyData.provider === 'minimax') {
            return c.json({
                models: [
                    { id: 'MiniMax-Text-01' },
                    { id: 'abab6.5s-chat' },
                    { id: 'abab6.5-chat' },
                    { id: 'abab6.5g-chat' },
                    { id: 'abab5.5s-chat' },
                    { id: 'abab5.5-chat' },
                ]
            });
        }
        else if (keyData.provider === 'moonshot') {
            // MoonShot AI (Kimi) — OpenAI-compatible
            return c.json({
                models: [
                    { id: 'moonshot-v1-8k' },
                    { id: 'moonshot-v1-32k' },
                    { id: 'moonshot-v1-128k' },
                    { id: 'kimi-latest' },
                    { id: 'kimi-thinking-preview' },
                ]
            });
        }
        else if (keyData.provider === 'deepseek') {
            // DeepSeek direct API — OpenAI-compatible
            return c.json({
                models: [
                    { id: 'deepseek-chat' },       // DeepSeek-V3
                    { id: 'deepseek-reasoner' },    // DeepSeek-R1
                ]
            });
        }
        else return c.json({ models: [] }); // default fallback

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${keyData.api_key}`
            }
        });

        if (!response.ok) {
            throw new Error(`Provider returned ${response.status}`);
        }

        const result = await response.json();
        return c.json({ models: result.data || [] });
    } catch (err: any) {
        console.error('Error fetching models for key', id, 'Provider:', keyData.provider, err);
        return c.json({ error: err.message }, 500);
    }
});

upstreamKeys.post('/:id/test', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const prompt = body.prompt || 'Ping';
    const preferredModel: string | undefined = body.model;

    try {
        const { data: keyData, error } = await supabase
            .from('upstream_keys')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !keyData) return c.json({ error: 'Key not found' }, 404);

        let url = '';
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let model = '';
        let payload: any = {};

        if (['openai', 'openrouter', 'groq', 'cerebras', 'mistral', 'nvidia', 'vercel', 'minimax', 'moonshot', 'deepseek', 'kie', 'zettacore', 'mimo'].includes(keyData.provider)) {
            if (keyData.provider === 'openai') { url = 'https://api.openai.com/v1/chat/completions'; model = 'gpt-3.5-turbo'; }
            else if (keyData.provider === 'groq') { url = 'https://api.groq.com/openai/v1/chat/completions'; model = 'gemma2-9b-it'; }
            else if (keyData.provider === 'openrouter') { url = 'https://openrouter.ai/api/v1/chat/completions'; model = 'google/gemini-2.5-flash-preview'; }
            else if (keyData.provider === 'cerebras') { url = 'https://api.cerebras.ai/v1/chat/completions'; model = 'llama3.1-8b'; }
            else if (keyData.provider === 'mistral') { url = 'https://api.mistral.ai/v1/chat/completions'; model = 'mistral-small-latest'; }
            else if (keyData.provider === 'nvidia') { url = 'https://integrate.api.nvidia.com/v1/chat/completions'; model = 'meta/llama3-8b-instruct'; }
            else if (keyData.provider === 'minimax') { url = 'https://api.minimax.chat/v1/chat/completions'; model = 'minimax-text-01'; }
            else if (keyData.provider === 'moonshot') { url = 'https://api.moonshot.cn/v1/chat/completions'; model = 'moonshot-v1-8k'; }
            else if (keyData.provider === 'deepseek') { url = 'https://api.deepseek.com/chat/completions'; model = 'deepseek-chat'; }
            else if (keyData.provider === 'mimo') { url = 'https://api.xiaomimimo.com/v1/chat/completions'; model = 'mimo-v2-pro'; }
            else if (keyData.provider === 'vercel') { url = 'https://ai-gateway.vercel.sh/v1/chat/completions'; model = 'gpt-3.5-turbo'; }
            else if (keyData.provider === 'kie') { url = 'https://api.kie.ai/gemini-1.5-flash/v1/chat/completions'; model = 'gemini-1.5-flash'; }
            else if (keyData.provider === 'zettacore') { url = 'http://localhost:8000/v1/chat/completions'; model = 'arena-claude-opus-4-6'; }

            headers['Authorization'] = `Bearer ${keyData.api_key}`;
            if (preferredModel) model = preferredModel;
            payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 20
            };
        } else if (keyData.provider === 'google' || keyData.provider === 'vertex') {
            url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
            headers['Authorization'] = `Bearer ${keyData.api_key}`;
            model = preferredModel || 'gemini-2.0-flash';
            payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 20
            };
        } else if (keyData.provider === 'anthropic') {
            url = 'https://api.anthropic.com/v1/messages';
            model = 'claude-3-haiku-20240307';
            headers['x-api-key'] = keyData.api_key;
            headers['anthropic-version'] = '2023-06-01';
            payload = {
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 20
            };
        } else if (keyData.provider === 'puter') {
            return c.json({ status: 200, data: { status: 'Puter SDK Health OK (Simulated)' } });
        } else {
            return c.json({ error: 'Unsupported provider for direct test' }, 400);
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            return c.json({ status: response.status, error: data || response.statusText }, response.status as any);
        }

        return c.json({ status: response.status, data });
    } catch (err: any) {
        return c.json({ status: 500, error: err.message }, 500);
    }
});

export default upstreamKeys;
