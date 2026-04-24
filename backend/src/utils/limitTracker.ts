export type ProviderStatus = 'healthy' | 'rate_limited' | 'error' | 'paused';

interface ProviderState {
    status: ProviderStatus;
    lastError?: string;
    lastErrorAt?: number;       // epoch ms when last error was recorded
    requestsPerMinute: number;
    requestsPerDay: number;
    tokensPerMinute: number;
    tokensPerDay: number;
    resetMinute: number;
    resetDay: number;
}

export const providerStates: Record<string, ProviderState> = {};

export function resetProviderStatus(upstreamKeyId: string) {
    if (providerStates[upstreamKeyId]) {
        providerStates[upstreamKeyId].status = 'healthy';
        providerStates[upstreamKeyId].lastError = undefined;
    }
}

export function resetAllProvidersStatus() {
    Object.keys(providerStates).forEach(id => {
        providerStates[id].status = 'healthy';
        providerStates[id].lastError = undefined;
    });
}

export function pauseProvider(upstreamKeyId: string) {
    if (!providerStates[upstreamKeyId]) {
        const now = new Date();
        providerStates[upstreamKeyId] = {
            status: 'paused',
            requestsPerMinute: 0,
            requestsPerDay: 0,
            tokensPerMinute: 0,
            tokensPerDay: 0,
            resetMinute: now.getMinutes(),
            resetDay: now.getDate()
        };
    } else {
        providerStates[upstreamKeyId].status = 'paused';
    }
}

export function checkAndRecoverProvider(upstreamKeyId: string): ProviderStatus {
    const state = providerStates[upstreamKeyId];
    if (!state) return 'healthy'; // if no state tracked, assume healthy

    const now = new Date();
    const minute = now.getMinutes();
    const day = now.getDate();
    const nowMs = Date.now();

    if (state.status === 'rate_limited') {
        // Recover after 60s cooldown OR if minute rolled over
        const cooldownMs = 60_000;
        const elapsed = nowMs - (state.lastErrorAt ?? 0);
        if (elapsed >= cooldownMs || state.resetMinute !== minute) {
            state.status = 'healthy';
            state.resetMinute = minute;
            state.requestsPerMinute = 0;
            state.tokensPerMinute = 0;
        }
    } else if (state.status === 'error') {
        // Recover after 15s retry window OR if minute rolled over
        const retryMs = 15_000;
        const elapsed = nowMs - (state.lastErrorAt ?? 0);
        if (elapsed >= retryMs || state.resetMinute !== minute) {
            state.status = 'healthy';
            state.resetMinute = minute;
            state.requestsPerMinute = 0;
            state.tokensPerMinute = 0;
        }
    }

    if (state.resetDay !== day) {
        state.status = state.status === 'paused' ? 'paused' : 'healthy';
        state.resetDay = day;
        state.requestsPerDay = 0;
        state.tokensPerDay = 0;
    }

    return state.status;
}

export function updateProviderCalls(upstreamKeyId: string, tokens: number) {
    const now = new Date();
    const minute = now.getMinutes();
    const day = now.getDate();

    let state = providerStates[upstreamKeyId];
    if (!state) {
        state = {
            status: 'healthy',
            requestsPerMinute: 0,
            requestsPerDay: 0,
            tokensPerMinute: 0,
            tokensPerDay: 0,
            resetMinute: minute,
            resetDay: day
        };
        providerStates[upstreamKeyId] = state;
    }

    if (state.resetMinute !== minute) {
        state.requestsPerMinute = 0;
        state.tokensPerMinute = 0;
        state.resetMinute = minute;
        // Simple recovery strategy after exactly 1 minute
        if (state.status === 'rate_limited') state.status = 'healthy';
        if (state.status === 'error') state.status = 'healthy';
    }

    if (state.resetDay !== day) {
        state.requestsPerDay = 0;
        state.tokensPerDay = 0;
        // Simple recovery strategy after 1 day
        if (state.status === 'rate_limited') state.status = 'healthy';
        state.resetDay = day;
    }

    state.requestsPerMinute++;
    state.requestsPerDay++;
    state.tokensPerMinute += tokens;
    state.tokensPerDay += tokens;
}

export function markProviderError(upstreamKeyId: string, errorType: 'rate_limited' | 'error', message: string) {
    const now = new Date();
    if (!providerStates[upstreamKeyId]) {
        providerStates[upstreamKeyId] = {
            status: 'healthy',
            requestsPerMinute: 0,
            requestsPerDay: 0,
            tokensPerMinute: 0,
            tokensPerDay: 0,
            resetMinute: now.getMinutes(),
            resetDay: now.getDate()
        };
    }
    providerStates[upstreamKeyId].status = errorType;
    providerStates[upstreamKeyId].lastError = message;
    providerStates[upstreamKeyId].lastErrorAt = Date.now(); // ← timestamp for backoff
}
