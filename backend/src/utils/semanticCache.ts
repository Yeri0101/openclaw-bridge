import { createHash } from 'crypto';

/**
 * SOAT — Semantic Cache Module
 * 
 * LRU in-memory cache with SHA-256 keying.
 * Avoids redundant upstream API calls for identical prompts.
 * 
 * Config via env vars:
 *   CACHE_TTL_SECONDS  — time-to-live per entry (default: 60s)
 *   CACHE_MAX_SIZE     — max entries before eviction (default: 500)
 */

const TTL_MS = (parseInt(process.env.CACHE_TTL_SECONDS || '60')) * 1000;
const MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE || '500');

interface CacheEntry {
    value: any;
    expiresAt: number;
    lastAccessed: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Build a cache key from model + messages array.
 * Uses SHA-256 so the key is always a fixed-length string.
 */
export function buildCacheKey(model: string, messages: any[]): string {
    const raw = model + '::' + JSON.stringify(messages);
    return createHash('sha256').update(raw).digest('hex');
}

/**
 * Get a cached response. Returns null on miss or expiry.
 */
export function getCached(key: string): any | null {
    const entry = cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
        cache.delete(key);
        return null;
    }

    // Update LRU timestamp
    entry.lastAccessed = now;
    return entry.value;
}

/**
 * Store a response in cache. Evicts oldest entry if MAX_SIZE is reached.
 */
export function setCached(key: string, value: any): void {
    const now = Date.now();

    // LRU eviction: remove the least-recently-accessed entry
    if (cache.size >= MAX_SIZE) {
        let oldestKey = '';
        let oldestTime = Infinity;
        for (const [k, v] of cache.entries()) {
            if (v.lastAccessed < oldestTime) {
                oldestTime = v.lastAccessed;
                oldestKey = k;
            }
        }
        if (oldestKey) cache.delete(oldestKey);
    }

    cache.set(key, {
        value,
        expiresAt: now + TTL_MS,
        lastAccessed: now,
    });
}

/**
 * Returns current cache stats for logging/debugging.
 */
export function getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return { size: cache.size, maxSize: MAX_SIZE, ttlMs: TTL_MS };
}
