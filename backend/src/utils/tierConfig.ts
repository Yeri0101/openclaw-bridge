/**
 * SOAT — Atlas Smart Router Tier Configuration
 *
 * Maps routing tiers to preferred provider names.
 * Providers are listed in priority order within each tier.
 * Override via env var TIER_CONFIG_JSON with a JSON string.
 *
 * Example override in .env:
 *   TIER_CONFIG_JSON={"economy":["cerebras","groq"],"standard":["puter","openrouter"],"premium":["openai","google"]}
 */

export type RoutingTier = 'economy' | 'standard' | 'premium';

// Default tier → provider mappings (priority order within each tier)
const DEFAULT_TIER_PROVIDERS: Record<RoutingTier, string[]> = {
    economy: ['groq', 'cerebras'],
    standard: ['kie', 'mistral', 'openrouter', 'puter', 'mimo'],
    premium: ['openai', 'google', 'vertex', 'nvidia', 'vercel', 'mistral', 'openrouter', 'mimo'],
};

// Allow runtime override via environment variable
function loadTierConfig(): Record<RoutingTier, string[]> {
    const override = process.env.TIER_CONFIG_JSON;
    if (override) {
        try {
            const parsed = JSON.parse(override);
            return { ...DEFAULT_TIER_PROVIDERS, ...parsed };
        } catch {
            console.warn('[TierConfig] TIER_CONFIG_JSON is invalid JSON — using defaults');
        }
    }
    return DEFAULT_TIER_PROVIDERS;
}

export const TIER_PROVIDERS: Record<RoutingTier, string[]> = loadTierConfig();

/**
 * Returns the fallback tier order starting from a given tier.
 * e.g. for 'economy' → ['economy', 'standard', 'premium']
 */
export const TIER_FALLBACK_ORDER: Record<RoutingTier, RoutingTier[]> = {
    economy: ['economy', 'standard', 'premium'],
    standard: ['standard', 'premium', 'economy'],
    premium: ['premium', 'standard', 'economy'],
};
