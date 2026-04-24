/**
 * SOAT — Latency Guard Module
 * 
 * Tracks per-upstream-key latency. If a provider responds slower than
 * LATENCY_TIMEOUT_MS it gets temporarily marked "slow" and skipped
 * during the fallback loop to keep the user experience snappy.
 *
 * Config via env vars:
 *   LATENCY_TIMEOUT_MS     — max acceptable response time (default: 5000ms)
 *   LATENCY_SLOW_WINDOW_MS — how long a slow provider is penalized (default: 60000ms)
 *   LATENCY_SLOW_THRESHOLD — consecutive slow responses before marking slow (default: 2)
 */

const TIMEOUT_MS = parseInt(process.env.LATENCY_TIMEOUT_MS || '15000');
const SLOW_WINDOW_MS = parseInt(process.env.LATENCY_SLOW_WINDOW_MS || '60000');
const SLOW_THRESHOLD = parseInt(process.env.LATENCY_SLOW_THRESHOLD || '2');

interface LatencyState {
    lastLatencyMs: number;
    slowUntil: number;       // timestamp — 0 means not slow
    consecutiveSlowCount: number;
    avgLatencyMs: number;    // rolling average (last 10 samples)
    samples: number[];
}

const latencyStates: Record<string, LatencyState> = {};

function getOrCreate(upstreamKeyId: string): LatencyState {
    if (!latencyStates[upstreamKeyId]) {
        latencyStates[upstreamKeyId] = {
            lastLatencyMs: 0,
            slowUntil: 0,
            consecutiveSlowCount: 0,
            avgLatencyMs: 0,
            samples: [],
        };
    }
    return latencyStates[upstreamKeyId];
}

/**
 * Record a completed request latency for this upstream key.
 * If latency exceeds TIMEOUT_MS enough times, the key is flagged as slow.
 */
export function recordLatency(upstreamKeyId: string, ms: number): void {
    const state = getOrCreate(upstreamKeyId);
    state.lastLatencyMs = ms;

    // Rolling average over last 10 samples
    state.samples.push(ms);
    if (state.samples.length > 10) state.samples.shift();
    state.avgLatencyMs = Math.round(
        state.samples.reduce((a, b) => a + b, 0) / state.samples.length
    );

    if (ms >= TIMEOUT_MS) {
        state.consecutiveSlowCount++;
        if (state.consecutiveSlowCount >= SLOW_THRESHOLD) {
            markProviderSlow(upstreamKeyId);
        }
    } else {
        // Reset consecutive counter on a fast response
        state.consecutiveSlowCount = 0;
    }

    const ts = new Date().toISOString();
    console.log(`[${ts}] [LatencyGuard] upstream=${upstreamKeyId.substring(0, 8)}… latency=${ms}ms avg=${state.avgLatencyMs}ms slow=${isProviderSlow(upstreamKeyId)}`);
}

/**
 * Returns true if this provider is currently penalized as "slow".
 */
export function isProviderSlow(upstreamKeyId: string): boolean {
    const state = latencyStates[upstreamKeyId];
    if (!state || state.slowUntil === 0) return false;
    if (Date.now() > state.slowUntil) {
        // Penalty expired — reset
        state.slowUntil = 0;
        state.consecutiveSlowCount = 0;
        return false;
    }
    return true;
}

/**
 * Manually mark a provider as slow for SLOW_WINDOW_MS milliseconds.
 * Called automatically by recordLatency when threshold is exceeded.
 */
export function markProviderSlow(upstreamKeyId: string, durationMs: number = SLOW_WINDOW_MS): void {
    const state = getOrCreate(upstreamKeyId);
    state.slowUntil = Date.now() + durationMs;
    const ts = new Date().toISOString();
    console.warn(`[${ts}] [LatencyGuard] Provider ${upstreamKeyId.substring(0, 8)}… marked SLOW for ${durationMs / 1000}s (${state.consecutiveSlowCount} consecutive slow responses)`);
}

/**
 * The configured timeout (in ms) for AbortController signals in v1.ts.
 * We set this to 60s (a reasonable max time for LLM generation).
 * The 5s TIMEOUT_MS is only used for flagging upstream keys as slow over time,
 * not for violently aborting successful long-generation requests.
 */
export const LATENCY_ABORT_TIMEOUT_MS = 60000;

/**
 * Returns stats for all tracked providers (useful for admin dashboard).
 */
export function getLatencyStats(): Record<string, { avgLatencyMs: number; isSlow: boolean; lastLatencyMs: number }> {
    const result: Record<string, any> = {};
    for (const [key, state] of Object.entries(latencyStates)) {
        result[key] = {
            avgLatencyMs: state.avgLatencyMs,
            isSlow: isProviderSlow(key),
            lastLatencyMs: state.lastLatencyMs,
        };
    }
    return result;
}
