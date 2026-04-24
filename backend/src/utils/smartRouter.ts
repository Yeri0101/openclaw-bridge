import { RoutingTier, TIER_PROVIDERS, TIER_FALLBACK_ORDER } from './tierConfig';

/**
 * SOAT — Atlas Smart Router
 *
 * A zero-latency heuristic classifier that assigns each request to one of 3 tiers:
 *
 *   ECONOMY  — small/simple prompts, no tools → route to Groq/Cerebras (cheapest)
 *   STANDARD — medium complexity, simple tools → route to OpenRouter/Puter
 *   PREMIUM  — large/complex prompts, heavy tool use → route to OpenAI/Google
 *
 * Classification is purely CPU-based (regex + token counting), < 1ms overhead.
 */

// Economy-tier keyword signals — these indicate a simple task
const ECONOMY_KEYWORDS = [
    'resume', 'traduce', 'translate', 'resume esto', 'bullet points',
    'lista', 'di hola', 'saluda', 'dame un ejemplo', 'qué es',
    'explica brevemente', 'define', 'summarize', 'what is',
    'short answer', 'respuesta corta', 'en una línea',
];

// Premium-tier keyword signals — these indicate a heavy/complex task
const PREMIUM_KEYWORDS = [
    'arquitectura', 'architecture', 'diseña', 'design', 'implementa', 'implement',
    'analiza en detalle', 'analyze', 'refactor', 'migrate', 'migra',
    'código completo', 'full implementation', 'sistema completo', 'full system',
    'escribe el', 'write the', 'paso a paso', 'step by step',
    'plan de', 'roadmap', 'estrategia', 'strategy',
];

// Token thresholds for tier classification
const ECONOMY_TOKEN_LIMIT = 200;   // < 200 estimated tokens → Economy candidate
const PREMIUM_TOKEN_LIMIT = 1500;  // > 1500 estimated tokens → Premium candidate

// Rough token estimator: ~4 chars per token (good enough for routing decisions)
export function estimateTokenCount(messages: any[]): number {
    let total = 0;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            total += Math.ceil(msg.content.length / 4);
        } else if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
                if (block?.text) total += Math.ceil(block.text.length / 4);
            }
        }
        // Tool calls add overhead
        if (msg.tool_calls?.length) total += msg.tool_calls.length * 50;
    }
    return total;
}

function lastUserMessage(messages: any[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            const c = messages[i].content;
            return typeof c === 'string' ? c.toLowerCase() : '';
        }
    }
    return '';
}

/**
 * Classify a request into a routing tier.
 * Returns 'economy', 'standard', or 'premium'.
 */
export function classifyRequest(body: {
    messages: any[];
    tools?: any[];
    model?: string;
}): RoutingTier {
    const { messages = [], tools = [] } = body;
    const estimatedTokens = estimateTokenCount(messages);
    const lastMsg = lastUserMessage(messages);
    const hasTools = tools.length > 0;
    const hasLongHistory = messages.length > 8;

    // Premium fast-path: large context or heavy tool use
    if (estimatedTokens > PREMIUM_TOKEN_LIMIT) return 'premium';
    if (hasTools && tools.length > 3) return 'premium';
    if (hasLongHistory && estimatedTokens > 800) return 'premium';
    if (PREMIUM_KEYWORDS.some(kw => lastMsg.includes(kw))) return 'premium';

    // Economy fast-path: tiny, no tools, economy keywords
    if (!hasTools && estimatedTokens < ECONOMY_TOKEN_LIMIT) {
        if (ECONOMY_KEYWORDS.some(kw => lastMsg.includes(kw))) return 'economy';
        // Even without keywords, tiny requests default to economy
        if (estimatedTokens < 100) return 'economy';
    }

    // Default: standard tier
    return 'standard';
}

/**
 * Given a tier and a list of upstream candidate mappings (each with provider info),
 * returns the best subset of candidates ordered by tier preference.
 *
 * @param tier       The determined routing tier
 * @param candidates Array of upstream key mappings — must include `.provider` field
 * @returns          Filtered & ordered candidates. Falls back to all candidates if no tier match.
 */
export function filterCandidatesByTier(
    tier: RoutingTier,
    candidates: Array<{ provider: string;[key: string]: any }>
): Array<{ provider: string;[key: string]: any }> {
    const fallbackOrder = TIER_FALLBACK_ORDER[tier];

    for (const t of fallbackOrder) {
        const preferredProviders = TIER_PROVIDERS[t];
        const tierCandidates = candidates.filter(c =>
            preferredProviders.includes(c.provider?.toLowerCase())
        );
        if (tierCandidates.length > 0) {
            return tierCandidates;
        }
    }

    // No tier match at all — use all candidates (safety net)
    return candidates;
}
