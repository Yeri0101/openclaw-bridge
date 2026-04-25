import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchApi } from '../api';
import {
    KeyRound, Server, ChevronLeft, Trash2, Plus, RefreshCw,
    Activity, Pause, Play, Zap, Shield, Download, AlertTriangle,
    CheckCircle2, XCircle, Clock, Cpu, Sliders
} from 'lucide-react';
import { useLanguage } from '../i18n';

type UpstreamKey = { id: string; provider: string; created_at: string; key_preview?: string; max_context_tokens?: number | null; max_output_tokens?: number | null };
type GatewayKey = { id: string; key_name: string; api_key: string; gateway_key_models: any[] };
type PricingEntry = {
    id: string;
    provider: string;
    model_name: string;
    input_price_per_1m: number | string;
    output_price_per_1m: number | string;
    is_active: boolean;
};

interface RequestLog {
    id: string;
    created_at: string;
    provider: string;
    model: string;
    status: 'success' | 'error';
    status_code: number;
    latency_ms: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens: number;
    total_cost_usd?: number | string;
    error_message?: string;
}

/* ─── Provider color / abbrev config ─── */
const PROVIDER_STYLES: Record<string, { cls: string; abbr: string }> = {
    google: { cls: 'provider-google', abbr: 'GG' },
    vertex: { cls: 'provider-google', abbr: 'VX' },
    cerebras: { cls: 'provider-cerebras', abbr: 'CB' },
    kie: { cls: 'provider-kie', abbr: 'KI' },
    openai: { cls: 'provider-openai', abbr: 'OA' },
    groq: { cls: 'provider-groq', abbr: 'GQ' },
    anthropic: { cls: 'provider-anthropic', abbr: 'AN' },
    mistral: { cls: 'provider-mistral', abbr: 'MS' },
    puter: { cls: 'provider-puter', abbr: 'PT' },
    brave: { cls: 'provider-brave', abbr: 'BV' },
    openrouter: { cls: 'provider-openrouter', abbr: 'OR' },
    nvidia: { cls: 'provider-nvidia', abbr: 'NV' },
    vercel: { cls: 'provider-vercel', abbr: 'VL' },
    moonshot: { cls: 'provider-moonshot', abbr: 'KM' },
    deepseek: { cls: 'provider-deepseek', abbr: 'DS' },
    mimo: { cls: 'provider-default', abbr: 'MM' },
    zettacore: { cls: 'provider-default', abbr: 'ZC' },
};

function ProviderChip({ provider }: { provider: string }) {
    const cfg = PROVIDER_STYLES[provider] ?? { cls: 'provider-default', abbr: provider.slice(0, 2).toUpperCase() };
    return (
        <div className="provider-chip">
            <div className={`provider-icon ${cfg.cls}`}>{cfg.abbr}</div>
            <span style={{ textTransform: 'capitalize' }}>{provider}</span>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        healthy: 'badge-healthy',
        error: 'badge-error',
        rate_limited: 'badge-warning',
        paused: 'badge-paused',
        slow: 'badge-slow',
    };
    const label: Record<string, string> = {
        healthy: 'Healthy',
        error: 'Error',
        rate_limited: 'Rate Limited',
        paused: 'Paused',
        slow: 'Slow',
    };
    return (
        <span className={`badge ${map[status] ?? 'badge-paused'}`}>
            <span className="badge-dot" />
            {label[status] ?? status}
        </span>
    );
}

function CtxPill({ value, onClick }: { value: number | null | undefined; onClick: () => void }) {
    const hasLimit = value != null && value > 0;
    return (
        <button
            className={`ctx-pill ${hasLimit ? 'has-limit' : ''}`}
            onClick={onClick}
            title={hasLimit ? `Context limit: ${value!.toLocaleString()} tokens — click to edit` : 'No limit — click to set'}
        >
            {hasLimit ? `${(value! / 1000).toFixed(0)}K tokens` : '∞ Unlimited'}
            <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>✎</span>
        </button>
    );
}

export default function ProjectDetail() {
    const { t } = useLanguage();
    const { id } = useParams();
    const [activeTab, setActiveTab] = useState<'providers' | 'gateway' | 'analytics'>('providers');
    const [project, setProject] = useState<any>(null);
    const [providers, setProviders] = useState<UpstreamKey[]>([]);
    const [providerHealth, setProviderHealth] = useState<Record<string, any>>({});
    const [gateways, setGateways] = useState<GatewayKey[]>([]);
    const [analyticsData, setAnalyticsData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [newProvider, setNewProvider] = useState({ provider: 'groq', api_key: '' });
    const [newGateway, setNewGateway] = useState({ key_name: '', custom_key: '' });
    const [availableModels, setAvailableModels] = useState<{ upstream_key_id: string, provider: string, models: any[] }[]>([]);
    const [selectedModels, setSelectedModels] = useState<{ upstream_key_id: string, model_name: string }[]>([]);

    const [testPrompts, setTestPrompts] = useState<Record<string, string>>({});
    const [testModels, setTestModels] = useState<Record<string, string>>({});
    const [testResults, setTestResults] = useState<Record<string, any>>({});
    const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});

    const [recentRequests, setRecentRequests] = useState<RequestLog[]>([]);
    const [pricingEntries, setPricingEntries] = useState<PricingEntry[]>([]);
    const [pricingForm, setPricingForm] = useState({ id: '', provider: '*', model_name: '', input_price_per_1m: '', output_price_per_1m: '' });
    const [budgetInput, setBudgetInput] = useState('');
    const [budgetAlertThresholdInput, setBudgetAlertThresholdInput] = useState('80');

    const [gatewayKeyBulkModels, setGatewayKeyBulkModels] = useState<Record<string, string[]>>({});
    const [expandedAddModels, setExpandedAddModels] = useState<Record<string, boolean>>({});
    const [ctxLimitEdit, setCtxLimitEdit] = useState<Record<string, string | null>>({});
    const [gatewaySearch, setGatewaySearch] = useState('');
    const [createModelSearch, setCreateModelSearch] = useState('');
    const [addModelSearch, setAddModelSearch] = useState<Record<string, string>>({});
    const [isTestingAll, setIsTestingAll] = useState(false);
    const [testProviderResults, setTestProviderResults] = useState<Record<string, { success: boolean; msg: string; testing: boolean }>>({});
    const [tokenLimitModal, setTokenLimitModal] = useState<{ mode: 'global' | 'single'; providerId?: string; providerName?: string } | null>(null);
    const [tokenLimitInput, setTokenLimitInput] = useState<string>('');

    /* ─── Data loading ─── */
    const loadData = async () => {
        try {
            const projData = await fetchApi('/projects');
            const currentProj = projData.find((p: any) => p.id === id);
            setProject(currentProj);

            const provData = await fetchApi('/providers');
            const projProv = provData.filter((p: any) => p.project_id === id);
            setProviders(projProv);

            const gwData = await fetchApi('/gateway-keys');
            setGateways(gwData.filter((g: any) => g.project_id === id));

            try {
                const healthData = await fetchApi('/providers/health');
                setProviderHealth(healthData);
            } catch (e) { console.error('Health fetch error:', e); }

            const modelsData = [];
            for (const p of projProv) {
                try {
                    const res = await fetchApi(`/providers/${p.id}/models`);
                    modelsData.push({ upstream_key_id: p.id, provider: p.provider, models: res.models });
                } catch (modelErr: any) {
                    console.warn(`[OpenClaw] Failed to fetch models for ${p.provider} (${p.id}):`, modelErr?.message || modelErr);
                }
            }
            setAvailableModels(modelsData);

            try {
                const analyticsRes = await fetchApi(`/analytics/${id}`);
                setAnalyticsData(analyticsRes);
                if (analyticsRes?.recentLogs) setRecentRequests(analyticsRes.recentLogs);
            } catch { /* skip */ }

            try {
                setPricingEntries(await fetchApi('/pricing'));
            } catch { /* skip */ }

            setBudgetInput(currentProj?.budget_usd != null ? String(currentProj.budget_usd) : '');
            setBudgetAlertThresholdInput(currentProj?.budget_alert_threshold_pct != null ? String(currentProj.budget_alert_threshold_pct) : '80');

        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const loadRealtimeData = async () => {
        if (!id) return;
        try { setProviderHealth(await fetchApi('/providers/health')); } catch { /* skip */ }
        try {
            const r = await fetchApi(`/analytics/${id}`);
            setAnalyticsData(r);
            if (r?.recentLogs) setRecentRequests(r.recentLogs);
        } catch { /* skip */ }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(loadRealtimeData, 4000);
        return () => clearInterval(interval);
    }, [id]);

    /* ─── Handlers ─── */
    const handleAddProvider = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProvider.api_key) return;
        try {
            await fetchApi('/providers', { method: 'POST', body: JSON.stringify({ project_id: id, ...newProvider }) });
            setNewProvider({ ...newProvider, api_key: '' });
            loadData();
        } catch (err: any) { alert(err.message || 'Failed to add provider'); }
    };

    const handleDeleteProvider = async (provId: string) => {
        if (!confirm('Delete this provider key?')) return;
        try { await fetchApi(`/providers/${provId}`, { method: 'DELETE' }); loadData(); }
        catch { alert('Failed to delete'); }
    };

    const handleSaveContextLimit = async (provId: string) => {
        const raw = ctxLimitEdit[provId];
        const value = raw === '' || raw === null ? null : Number(raw);
        if (value !== null && (isNaN(value) || value < 100)) {
            alert('Enter a number ≥ 100, or leave blank to remove the limit');
            return;
        }
        try {
            await fetchApi(`/providers/${provId}/context-limit`, {
                method: 'PATCH',
                body: JSON.stringify({ max_context_tokens: value }),
            });
            setProviders(prev => prev.map(p => p.id === provId ? { ...p, max_context_tokens: value } : p));
            setCtxLimitEdit(prev => ({ ...prev, [provId]: null }));
        } catch { alert('Failed to save context limit'); }
    };

    const handleResetAllProviders = async () => {
        try { await fetchApi('/providers/reset-all', { method: 'POST' }); loadData(); }
        catch { alert('Failed to reset all providers'); }
    };

    const handlePingAllProviders = async () => {
        setIsTestingAll(true);
        const words = ["sol", "luna", "viento", "fuego", "nube", "rio", "bosque", "cielo", "nieve", "roca", "mar", "estrella"];

        // Collect all allowed models across every gateway key, annotated with their upstream_key_id
        const allAllowedModels: { model_name: string; upstream_key_id?: string }[] = gateways.flatMap(
            g => g.gateway_key_models || []
        );

        const promises = providers.map(async (p, idx) => {
            setTestProviderResults(prev => ({ ...prev, [p.id]: { success: false, msg: '', testing: true } }));
            const randomWord = words[Math.floor(Math.random() * words.length)] + idx * 7;

            // Try to find a model that belongs directly to this upstream provider
            let matchingModel = allAllowedModels.find(m => m.upstream_key_id === p.id)?.model_name;
            
            // If none directly assigned, find a model assigned to ANY other upstream key of the same provider type
            if (!matchingModel) {
                const siblingKeyIds = providers.filter(prov => prov.provider === p.provider).map(prov => prov.id);
                matchingModel = allAllowedModels.find(m => m.upstream_key_id && siblingKeyIds.includes(m.upstream_key_id))?.model_name;
            }

            try {
                const res = await fetchApi(`/providers/${p.id}/test`, {
                    method: 'POST',
                    body: JSON.stringify({
                        prompt: `Responde unicamente con la palabra: ${randomWord}`,
                        ...(matchingModel ? { model: matchingModel } : {})
                    })
                });
                if (res?.status === 200 || res?.status === '200') {
                    setTestProviderResults(prev => ({ 
                        ...prev, 
                        [p.id]: { success: true, msg: 'OK (200)', testing: false }
                    }));
                } else {
                    let errMsg = 'Failed';
                    if (res?.error) {
                        if (typeof res.error === 'string') errMsg = res.error;
                        else if (res.error.error && typeof res.error.error === 'string') errMsg = res.error.error;
                        else if (res.error.error?.message) errMsg = res.error.error.message;
                        else if (res.error.message) errMsg = res.error.message;
                        else errMsg = JSON.stringify(res.error);
                    }
                    setTestProviderResults(prev => ({ 
                        ...prev, 
                        [p.id]: { success: false, msg: errMsg, testing: false }
                    }));
                }
            } catch (err: any) {
                setTestProviderResults(prev => ({ 
                    ...prev, 
                    [p.id]: { success: false, msg: err.message || 'Error', testing: false }
                }));
            }
        });
        await Promise.all(promises);
        setIsTestingAll(false);
    };

    const handlePauseAllProjectProviders = async () => {
        try { await fetchApi(`/projects/${id}/pause-all`, { method: 'POST' }); loadData(); }
        catch { alert('Failed to pause project providers'); }
    };

    const openTokenLimitModal = (mode: 'global' | 'single', providerId?: string, providerName?: string) => {
        const current = mode === 'single'
            ? providers.find(p => p.id === providerId)?.max_output_tokens
            : null;
        setTokenLimitInput(current != null ? String(current) : '');
        setTokenLimitModal({ mode, providerId, providerName });
    };

    const handleSaveTokenLimit = async () => {
        if (!tokenLimitModal) return;
        const value = tokenLimitInput.trim() === '' ? null : Number(tokenLimitInput);
        if (value !== null && (isNaN(value) || value < 100)) {
            alert('Enter a number ≥ 100, or leave blank to remove the limit (uses gateway default)');
            return;
        }
        try {
            if (tokenLimitModal.mode === 'global') {
                await fetchApi('/providers/output-token-limit-all', {
                    method: 'PATCH',
                    body: JSON.stringify({ max_output_tokens: value }),
                });
            } else if (tokenLimitModal.providerId) {
                await fetchApi(`/providers/${tokenLimitModal.providerId}/output-token-limit`, {
                    method: 'PATCH',
                    body: JSON.stringify({ max_output_tokens: value }),
                });
            }
            setTokenLimitModal(null);
            loadData();
        } catch { alert('Failed to save token limit'); }
    };

    const handleResetProvider = async (provId: string) => {
        try { await fetchApi(`/providers/${provId}/reset`, { method: 'POST' }); loadData(); }
        catch { alert('Failed to reset provider'); }
    };

    const handlePauseProvider = async (provId: string) => {
        try { await fetchApi(`/providers/${provId}/pause`, { method: 'POST' }); loadData(); }
        catch { alert('Failed to pause provider'); }
    };

    const handleCreateGateway = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newGateway.key_name) return;
        try {
            await fetchApi('/gateway-keys', {
                method: 'POST',
                body: JSON.stringify({ project_id: id, ...newGateway, models: selectedModels }),
            });
            setNewGateway({ key_name: '', custom_key: '' });
            setSelectedModels([]);
            loadData();
        } catch (err: any) { alert(err.message || 'Failed to create gateway key'); }
    };

    const handleDeleteGateway = async (gwId: string) => {
        if (!confirm('Delete this gateway key?')) return;
        try { await fetchApi(`/gateway-keys/${gwId}`, { method: 'DELETE' }); loadData(); }
        catch { alert('Failed to delete'); }
    };

    const handleAddModelsToGateway = async (gwId: string) => {
        const modelNames = gatewayKeyBulkModels[gwId] || [];
        if (modelNames.length === 0) return;
        const newSelections: { upstream_key_id: string; model_name: string }[] = [];
        modelNames.forEach(model_name => {
            availableModels.forEach(am => {
                if (am.models.some(m => m.id === model_name)) {
                    newSelections.push({ upstream_key_id: am.upstream_key_id, model_name });
                }
            });
        });
        try {
            await fetchApi(`/gateway-keys/${gwId}/models`, { method: 'POST', body: JSON.stringify({ models: newSelections }) });
            setGatewayKeyBulkModels(prev => ({ ...prev, [gwId]: [] }));
            loadData();
        } catch { alert('Failed to add models'); }
    };

    const handleDeleteModelFromGateway = async (gwId: string, modelName: string) => {
        if (!confirm(`Remove ${modelName}?`)) return;
        try { await fetchApi(`/gateway-keys/${gwId}/models/${encodeURIComponent(modelName)}`, { method: 'DELETE' }); loadData(); }
        catch { alert('Failed to delete model'); }
    };

    const handleTestKey = async (gatewayKey: GatewayKey) => {
        const prompt = testPrompts[gatewayKey.id];
        const model = testModels[gatewayKey.id] || gatewayKey.gateway_key_models?.[0]?.model_name;
        if (!prompt || !model) { alert('Please enter a prompt and select a model.'); return; }
        setTestLoading(prev => ({ ...prev, [gatewayKey.id]: true }));
        setTestResults(prev => ({ ...prev, [gatewayKey.id]: null }));
        try {
            const baseUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin;
            const res = await fetch(`${baseUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gatewayKey.api_key}` },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
            });
            const data = await res.json();
            setTestResults(prev => ({ ...prev, [gatewayKey.id]: { status: res.status, data } }));
            loadData();
        } catch (err: any) {
            setTestResults(prev => ({ ...prev, [gatewayKey.id]: { status: 500, error: err.message } }));
        } finally {
            setTestLoading(prev => ({ ...prev, [gatewayKey.id]: false }));
        }
    };

    const handleClearAnalytics = async () => {
        if (!confirm('Clear all analytics data for this project?')) return;
        try { await fetchApi(`/analytics/${id}`, { method: 'DELETE' }); loadData(); }
        catch { alert('Failed to clear analytics'); }
    };

    const handleExportAnalytics = () => {
        if (!analyticsData) return;
        let md = `# Analytics: ${project?.name || 'Project'}\n\n`;
        md += `## Stats\n- Requests: ${analyticsData.stats?.totalRequests || 0}\n`;
        md += `- Success Rate: ${analyticsData.stats?.successRate || 0}%\n`;
        md += `- Tokens: ${(analyticsData.stats?.totalTokens || 0).toLocaleString()}\n`;
        md += `- Estimated Cost: $${Number(analyticsData.stats?.totalCostUsd || 0).toFixed(4)}\n`;
        md += `- Avg Latency: ${analyticsData.stats?.averageLatency || 0}ms\n\n`;
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `analytics-${project?.name || 'export'}.md`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    const handleSaveBudget = async () => {
        try {
            const budget = budgetInput.trim() === '' ? null : Number(budgetInput);
            const threshold = budgetAlertThresholdInput.trim() === '' ? 80 : Number(budgetAlertThresholdInput);
            if (budget !== null && (isNaN(budget) || budget < 0)) {
                alert('Budget must be a number >= 0');
                return;
            }
            if (isNaN(threshold) || threshold < 1 || threshold > 100) {
                alert('Alert threshold must be between 1 and 100');
                return;
            }
            const updated = await fetchApi(`/projects/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ budget_usd: budget, budget_alert_threshold_pct: threshold }),
            });
            setProject(updated);
            setBudgetInput(updated?.budget_usd != null ? String(updated.budget_usd) : '');
            setBudgetAlertThresholdInput(updated?.budget_alert_threshold_pct != null ? String(updated.budget_alert_threshold_pct) : '80');
        } catch (err: any) {
            alert(err.message || 'Failed to save budget');
        }
    };

    const totalCostUsd = Number(analyticsData?.stats?.totalCostUsd || 0);
    const budgetUsd = project?.budget_usd != null ? Number(project.budget_usd) : null;
    const budgetAlertThresholdPct = project?.budget_alert_threshold_pct != null ? Number(project.budget_alert_threshold_pct) : 80;
    const budgetUsagePct = budgetUsd && budgetUsd > 0 ? (totalCostUsd / budgetUsd) * 100 : 0;
    const isBudgetExceeded = budgetUsd != null && totalCostUsd >= budgetUsd;
    const isBudgetWarning = !isBudgetExceeded && budgetUsd != null && budgetUsagePct >= budgetAlertThresholdPct;

    const handleSavePricing = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pricingForm.model_name.trim()) return;
        try {
            const payload = {
                provider: pricingForm.provider.trim() || '*',
                model_name: pricingForm.model_name.trim(),
                input_price_per_1m: Number(pricingForm.input_price_per_1m || 0),
                output_price_per_1m: Number(pricingForm.output_price_per_1m || 0),
            };

            if (pricingForm.id) {
                await fetchApi(`/pricing/${pricingForm.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });
            } else {
                await fetchApi('/pricing', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            }

            setPricingEntries(await fetchApi('/pricing'));
            setPricingForm({ id: '', provider: '*', model_name: '', input_price_per_1m: '', output_price_per_1m: '' });
        } catch (err: any) {
            alert(err.message || 'Failed to save pricing');
        }
    };

    const handleEditPricing = (entry: PricingEntry) => {
        setPricingForm({
            id: entry.id,
            provider: entry.provider || '*',
            model_name: entry.model_name,
            input_price_per_1m: String(entry.input_price_per_1m ?? ''),
            output_price_per_1m: String(entry.output_price_per_1m ?? ''),
        });
    };

    const handleDeletePricing = async (entryId: string) => {
        if (!confirm('Delete this pricing rule?')) return;
        try {
            await fetchApi(`/pricing/${entryId}`, { method: 'DELETE' });
            setPricingEntries(await fetchApi('/pricing'));
            if (pricingForm.id === entryId) {
                setPricingForm({ id: '', provider: '*', model_name: '', input_price_per_1m: '', output_price_per_1m: '' });
            }
        } catch (err: any) {
            alert(err.message || 'Failed to delete pricing');
        }
    };

    /* ─── Render guards ─── */
    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
                <div className="spinner-ring" style={{ width: 32, height: 32, borderWidth: 3 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading project…</p>
            </div>
        );
    }
    if (!project) return <div className="glass-panel"><p style={{ color: 'var(--text-muted)' }}>Project not found</p></div>;

    const projColor = project.color || '#ff6b2b';

    /* ─── Main render ─── */
    return (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            {/* Back */}
            <Link to="/" className="back-link">
                <ChevronLeft size={16} /> {t('project.back')}
            </Link>

            {/* Project Header */}
            <div className="flex items-center gap-3" style={{ marginBottom: '1.75rem' }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 'var(--radius-md)',
                    background: `${projColor}18`, border: `1px solid ${projColor}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    boxShadow: `0 0 16px ${projColor}30`,
                }}>
                    <Server size={22} style={{ color: projColor }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                        {project.name}
                    </h1>
                    <code style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{project.id}</code>
                </div>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.25)',
                    borderRadius: 'var(--radius-pill)', padding: '0.3rem 0.75rem',
                    fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em',
                    color: 'var(--brand-orange)', textTransform: 'uppercase', flexShrink: 0,
                }}>
                    <Shield size={10} /> SOAT Active
                </span>
            </div>

            {/* Tabs */}
            <div className="tabs">
                <button id="tab-providers" className={`tab-btn ${activeTab === 'providers' ? 'active' : ''}`} onClick={() => setActiveTab('providers')}>
                    <Server size={14} /> {t('project.tab_providers')}
                </button>
                <button id="tab-gateway" className={`tab-btn ${activeTab === 'gateway' ? 'active' : ''}`} onClick={() => setActiveTab('gateway')}>
                    <KeyRound size={14} /> {t('project.tab_gateway')}
                </button>
                <button id="tab-analytics" className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
                    <Activity size={14} /> {t('project.tab_analytics')}
                </button>
            </div>

            {/* ═══ TAB: PROVIDERS ═══ */}
            {activeTab === 'providers' && (
                <div className="side-panel-layout">
                    {/* Add Provider Form */}
                    <div className="glass-panel">
                        <div className="section-label" style={{ marginBottom: '1.25rem' }}>
                            <Plus size={11} /> {t('project.add_provider')}
                        </div>
                        <form onSubmit={handleAddProvider}>
                            <div className="form-group">
                                <label>{t('project.provider')}</label>
                                <select value={newProvider.provider} onChange={e => setNewProvider({ ...newProvider, provider: e.target.value })}>
                                    <option value="groq">Groq</option>
                                    <option value="mistral">Mistral AI</option>
                                    <option value="openrouter">OpenRouter</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="google">Google</option>
                                    <option value="vertex">Vertex AI (via AI Studio)</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="kie">Kie (Gemini vía Kie)</option>
                                    <option value="cerebras">Cerebras</option>
                                    <option value="nvidia">NVIDIA NIM</option>
                                    <option value="vercel">Vercel AI Gateway</option>
                                    <option value="brave">Brave Search</option>
                                    <option value="puter">Puter (500+ modelos gratis)</option>
                                    <option value="mimo">Xiaomi MiMo</option>
                                    <option value="zettacore">ZettaCore (Chrome Bridge)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>{t('project.api_key')}</label>
                                <input
                                    type="password"
                                    value={newProvider.api_key}
                                    onChange={e => setNewProvider({ ...newProvider, api_key: e.target.value })}
                                    placeholder="gsk_... / sk-or-v1-..."
                                    required
                                />
                            </div>
                            <button type="submit" className="btn btn-primary w-full">
                                <Plus size={15} /> {t('project.btn_save_fetch')}
                            </button>
                        </form>
                    </div>

                    {/* Providers List */}
                    <div>
                        <div className="glass-panel">
                            <div className="panel-header">
                                <div className="section-label" style={{ marginBottom: 0 }}>
                                    <Server size={11} /> {t('project.configured_providers')} ({providers.length})
                                </div>
                                <div className="panel-actions">
                                    <button onClick={handlePauseAllProjectProviders} className="btn btn-warning btn-sm">
                                        <Pause size={13} /> Pause All
                                    </button>
                                    <button onClick={handleResetAllProviders} className="btn btn-success btn-sm">
                                        <RefreshCw size={13} /> Reset All
                                    </button>
                                    <button onClick={() => openTokenLimitModal('global')} className="btn btn-sm" style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)', color: '#a78bfa' }}>
                                        <Sliders size={13} /> Token Limit
                                    </button>
                                    <button onClick={handlePingAllProviders} className="btn btn-primary btn-sm" disabled={isTestingAll}>
                                        {isTestingAll ? <span className="spinner-ring" style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Zap size={13} />} Test All
                                    </button>
                                    <button onClick={loadData} className="btn btn-secondary btn-icon btn-sm" title="Refresh">
                                        <RefreshCw size={14} />
                                    </button>
                                </div>
                            </div>

                            {providers.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-icon"><Server size={24} /></div>
                                    <h3>{t('project.no_providers')}</h3>
                                    <p>Add your first upstream API key using the form on the left.</p>
                                </div>
                            ) : (
                                <div className="table-wrapper">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>{t('project.provider')} / Key</th>
                                                <th>{t('project.status')}</th>
                                                <th>{t('project.usage')}</th>
                                                <th>Ctx Limit</th>
                                                <th>Output Limit</th>
                                                <th>{t('project.actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {providers.map((p, index) => {
                                                const health = providerHealth[p.id] || { status: 'healthy', requestsPerMinute: 0, requestsPerDay: 0, tokensPerMinute: 0, tokensPerDay: 0 };
                                                const isEditing = ctxLimitEdit[p.id] !== undefined && ctxLimitEdit[p.id] !== null;
                                                return (
                                                    <tr key={p.id}>
                                                        <td>
                                                            <div className="flex items-center gap-1" style={{ marginBottom: '0.2rem' }}>
                                                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: '0.2rem' }}>#{index + 1}</span>
                                                                <ProviderChip provider={p.provider} />
                                                            </div>
                                                            <div className="provider-id">{p.key_preview || p.id.split('-')[0] + '...'}</div>
                                                            {testProviderResults[p.id] && (
                                                                <div style={{ fontSize: '0.65rem', marginTop: '0.2rem', color: testProviderResults[p.id].testing ? 'var(--text-muted)' : (testProviderResults[p.id].success ? 'var(--status-success)' : 'var(--status-error)') }}>
                                                                    {testProviderResults[p.id].testing ? 'Testing...' : testProviderResults[p.id].msg}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <StatusBadge status={health.status} />
                                                            {health?.error && (
                                                                <div style={{ fontSize: '0.68rem', color: 'var(--status-error)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.2rem' }} title={health.error}>
                                                                    {health.error}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                                                                <div><span style={{ color: 'var(--text-muted)' }}>rpm </span><span style={{ color: 'var(--text-secondary)' }}>{health.requestsPerMinute}</span><span style={{ color: 'var(--text-muted)' }}> / {health.requestsPerDay}d</span></div>
                                                                <div><span style={{ color: 'var(--text-muted)' }}>tok </span><span style={{ color: 'var(--text-secondary)' }}>{health.tokensPerMinute}</span><span style={{ color: 'var(--text-muted)' }}> / {health.tokensPerDay}d</span></div>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {isEditing ? (
                                                                <div className="ctx-edit-row">
                                                                    <input
                                                                        className="ctx-edit-input"
                                                                        type="number" min={100} step={500}
                                                                        autoFocus
                                                                        value={ctxLimitEdit[p.id] ?? ''}
                                                                        onChange={e => setCtxLimitEdit(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                                        onKeyDown={e => {
                                                                            if (e.key === 'Enter') handleSaveContextLimit(p.id);
                                                                            if (e.key === 'Escape') setCtxLimitEdit(prev => ({ ...prev, [p.id]: null }));
                                                                        }}
                                                                        placeholder="e.g. 8000"
                                                                    />
                                                                    <button className="ctx-edit-save" onClick={() => handleSaveContextLimit(p.id)} title="Save">✓</button>
                                                                    <button className="ctx-edit-cancel" onClick={() => setCtxLimitEdit(prev => ({ ...prev, [p.id]: null }))} title="Cancel">✕</button>
                                                                </div>
                                                            ) : (
                                                                <CtxPill
                                                                    value={p.max_context_tokens}
                                                                    onClick={() => setCtxLimitEdit(prev => ({ ...prev, [p.id]: p.max_context_tokens != null ? String(p.max_context_tokens) : '' }))}
                                                                />
                                                            )}
                                                        </td>
                                                        <td>
                                                            {/* Output Token Limit pill */}
                                                            <button
                                                                className={`ctx-pill ${p.max_output_tokens != null && p.max_output_tokens > 0 ? 'has-limit' : ''}`}
                                                                onClick={() => openTokenLimitModal('single', p.id, p.provider)}
                                                                title={p.max_output_tokens ? `Output cap: ${p.max_output_tokens.toLocaleString()} tokens — click to edit` : 'No cap (uses gateway default 16k) — click to set'}
                                                            >
                                                                {p.max_output_tokens && p.max_output_tokens > 0
                                                                    ? `${(p.max_output_tokens / 1000).toFixed(0)}K out`
                                                                    : '∞ Default'}
                                                                <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>✎</span>
                                                            </button>
                                                        </td>
                                                        <td>
                                                            <div className="flex gap-2">
                                                                {health.status === 'paused' ? (
                                                                    <button onClick={() => handleResetProvider(p.id)} className="btn btn-success btn-sm" title="Resume provider">
                                                                        <Play size={13} /> Resume
                                                                    </button>
                                                                ) : (
                                                                    <button onClick={() => handlePauseProvider(p.id)} className="btn btn-warning btn-sm" title="Pause provider">
                                                                        <Pause size={13} /> Pause
                                                                    </button>
                                                                )}
                                                                <button onClick={() => handleResetProvider(p.id)} className="btn btn-secondary btn-icon btn-sm" title="Force Reset">
                                                                    <RefreshCw size={13} />
                                                                </button>
                                                                <button onClick={() => handleDeleteProvider(p.id)} className="btn btn-danger btn-icon btn-sm" title="Delete">
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: GATEWAY KEYS ═══ */}
            {activeTab === 'gateway' && (
                <div className="side-panel-layout">
                    {/* Create Gateway Form */}
                    <div className="glass-panel">
                        <div className="section-label" style={{ marginBottom: '1.25rem' }}>
                            <KeyRound size={11} /> {t('project.create_gateway')}
                        </div>
                        <form onSubmit={handleCreateGateway}>
                            <div className="form-group">
                                <label>{t('project.key_name')}</label>
                                <input
                                    type="text"
                                    value={newGateway.key_name}
                                    onChange={e => setNewGateway({ ...newGateway, key_name: e.target.value })}
                                    placeholder="Agent Rocky"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>{t('project.custom_key')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                                <input
                                    type="text"
                                    value={newGateway.custom_key}
                                    onChange={e => setNewGateway({ ...newGateway, custom_key: e.target.value })}
                                    placeholder={t('project.custom_key_ph')}
                                />
                            </div>

                            <div style={{ marginBottom: '1.25rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                                    {t('project.select_models')}
                                </label>
                                {availableModels.length > 0 ? (() => {
                                    const allModelIds = Array.from(new Set(availableModels.flatMap(am => am.models.map(m => m.id)))).sort();
                                    const uniqueSelected = Array.from(new Set(selectedModels.map(sm => sm.model_name)));
                                    return (
                                        <div>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Ctrl/Cmd para selección múltiple</p>
                                            <input
                                                type="text"
                                                placeholder="Buscar modelos..."
                                                value={createModelSearch}
                                                onChange={e => setCreateModelSearch(e.target.value)}
                                                style={{ width: '100%', marginBottom: '0.5rem', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
                                            />
                                            <select
                                                multiple
                                                value={uniqueSelected}
                                                onChange={e => {
                                                    const vals = Array.from(e.target.selectedOptions, o => o.value);
                                                    const newSel: { upstream_key_id: string; model_name: string }[] = [];
                                                    vals.forEach(mn => availableModels.forEach(am => {
                                                        if (am.models.some(m => m.id === mn)) newSel.push({ upstream_key_id: am.upstream_key_id, model_name: mn });
                                                    }));
                                                    setSelectedModels(newSel);
                                                }}
                                                style={{ width: '100%', minHeight: 160, padding: '0.4rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                                            >
                                                {allModelIds.filter(mid => mid.toLowerCase().includes(createModelSearch.toLowerCase())).map(mid => <option key={mid} value={mid}>{mid}</option>)}
                                            </select>
                                        </div>
                                    );
                                })() : <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('project.no_models')}</p>}
                            </div>

                            <button type="submit" className="btn btn-primary w-full">
                                <Plus size={15} /> {t('project.btn_create_key')}
                            </button>
                        </form>
                    </div>

                    {/* Gateway Keys List */}
                    <div>
                        <div className="glass-panel">
                            <div className="flex justify-between items-center" style={{ marginBottom: '1.25rem' }}>
                                <div className="section-label" style={{ marginBottom: 0 }}>
                                    <Zap size={11} /> {t('project.active_gateways')} ({gateways.length})
                                </div>
                                <input
                                    type="text"
                                    placeholder="Buscar claves gateway..."
                                    value={gatewaySearch}
                                    onChange={e => setGatewaySearch(e.target.value)}
                                    style={{ width: '200px', padding: '0.4rem 0.6rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
                                />
                            </div>

                            {gateways.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-icon"><KeyRound size={24} /></div>
                                    <h3>{t('project.no_gateways')}</h3>
                                    <p>Create your first gateway key to start routing requests.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {gateways.filter(g => g.key_name.toLowerCase().includes(gatewaySearch.toLowerCase())).map((g, index) => (
                                        <div key={g.id} style={{
                                            border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)',
                                            padding: '1.25rem', background: 'var(--bg-secondary)', position: 'relative', overflow: 'hidden',
                                            transition: 'border-color 0.2s',
                                        }}
                                            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,107,43,0.2)')}
                                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                                        >
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--accent-gradient)', opacity: 0.5 }} />

                                            {/* Header */}
                                            <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
                                                <div className="flex items-center gap-2">
                                                    <div style={{
                                                        width: 28, height: 28, borderRadius: 'var(--radius-sm)',
                                                        background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.25)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: '0.65rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--brand-orange)',
                                                    }}>
                                                        {index + 1}
                                                    </div>
                                                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{g.key_name}</h4>
                                                </div>
                                                <button onClick={() => handleDeleteGateway(g.id)} className="btn btn-danger btn-sm">
                                                    <Trash2 size={13} /> Delete
                                                </button>
                                            </div>

                                            {/* API Key */}
                                            <code className="key-display" style={{ marginBottom: '1rem', display: 'block' }}>{g.api_key}</code>

                                            {/* Models */}
                                            <div style={{ marginBottom: '1rem' }}>
                                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                                                    {t('project.allowed_models')} ({Array.from(new Set(g.gateway_key_models?.map(m => m.model_name))).length})
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                    {Array.from(new Set(g.gateway_key_models?.map(m => m.model_name))).map((modelName: any, i) => (
                                                        <span key={i} className="model-tag">
                                                            {modelName}
                                                            <button className="model-tag-remove" onClick={() => handleDeleteModelFromGateway(g.id, modelName)}>✕</button>
                                                        </span>
                                                    ))}
                                                </div>

                                                {availableModels.length > 0 && (
                                                    <div style={{ marginTop: '0.75rem' }}>
                                                        {!expandedAddModels[g.id] ? (
                                                            <button onClick={() => setExpandedAddModels(prev => ({ ...prev, [g.id]: true }))} className="btn btn-ghost btn-sm">
                                                                <Plus size={12} /> Add Models
                                                            </button>
                                                        ) : (
                                                            <div className="flex gap-2" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Buscar modelo para agregar..."
                                                                    value={addModelSearch[g.id] || ''}
                                                                    onChange={e => setAddModelSearch(prev => ({ ...prev, [g.id]: e.target.value }))}
                                                                    style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
                                                                />
                                                                <div className="flex gap-2" style={{ width: '100%', alignItems: 'flex-start' }}>
                                                                    <select multiple
                                                                        value={gatewayKeyBulkModels[g.id] || []}
                                                                        onChange={e => setGatewayKeyBulkModels(prev => ({ ...prev, [g.id]: Array.from(e.target.selectedOptions, o => o.value) }))}
                                                                        style={{ flex: 1, height: 110, padding: '0.4rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--brand-orange)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
                                                                    >
                                                                        {Array.from(new Set(availableModels.flatMap(am => am.models.map(m => m.id)))).sort()
                                                                            .filter(mid => !g.gateway_key_models?.some(gm => gm.model_name === mid))
                                                                            .filter(mid => mid.toLowerCase().includes((addModelSearch[g.id] || '').toLowerCase()))
                                                                            .map(mid => <option key={mid} value={mid}>{mid}</option>)}
                                                                    </select>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                                        <button onClick={() => { handleAddModelsToGateway(g.id); setExpandedAddModels(prev => ({ ...prev, [g.id]: false })); }} className="btn btn-primary btn-sm">Add</button>
                                                                        <button onClick={() => setExpandedAddModels(prev => ({ ...prev, [g.id]: false }))} className="btn btn-secondary btn-sm">Cancel</button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Test section */}
                                            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
                                                <div className="section-label" style={{ marginBottom: '0.75rem' }}>
                                                    <Zap size={10} /> {t('project.test_gateway')}
                                                </div>
                                                <select
                                                    value={testModels[g.id] || ''}
                                                    onChange={e => setTestModels(prev => ({ ...prev, [g.id]: e.target.value }))}
                                                    style={{ width: '100%', marginBottom: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)', outline: 'none' }}
                                                >
                                                    <option value="">{t('project.select_model_ph')}</option>
                                                    {Array.from(new Set(g.gateway_key_models?.map(m => m.model_name))).map((mn: any, i) => (
                                                        <option key={i} value={mn}>{mn}</option>
                                                    ))}
                                                </select>
                                                <textarea
                                                    placeholder={t('project.test_prompt_ph')}
                                                    value={testPrompts[g.id] || ''}
                                                    onChange={e => setTestPrompts(prev => ({ ...prev, [g.id]: e.target.value }))}
                                                    style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)', minHeight: 64, marginBottom: '0.5rem', fontSize: '0.875rem', fontFamily: 'var(--font-sans)', resize: 'vertical', outline: 'none' }}
                                                />
                                                <button onClick={() => handleTestKey(g)} className="btn btn-primary w-full" disabled={testLoading[g.id]}>
                                                    {testLoading[g.id] ? <><span className="spinner-ring" style={{ width: 14, height: 14, borderWidth: 2 }} /> {t('project.btn_testing')}</> : <><Zap size={14} /> {t('project.btn_test')}</>}
                                                </button>

                                                {testResults[g.id] && (
                                                    <div className="test-result" style={{ borderColor: testResults[g.id].status === 200 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }}>
                                                        <div className="test-result-header">
                                                            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                                                                {testResults[g.id].status === 200
                                                                    ? <CheckCircle2 size={14} style={{ color: 'var(--status-healthy)' }} />
                                                                    : <XCircle size={14} style={{ color: 'var(--status-error)' }} />}
                                                                <span style={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: testResults[g.id].status === 200 ? '#22c55e' : '#ef4444' }}>
                                                                    HTTP {testResults[g.id].status}
                                                                </span>
                                                                {testResults[g.id].data?._openclaw_metadata && (() => {
                                                                    const meta = testResults[g.id].data._openclaw_metadata;
                                                                    const cfg = PROVIDER_STYLES[meta.provider] ?? { cls: 'provider-default', abbr: (meta.provider || '??').slice(0, 2).toUpperCase() };
                                                                    return (
                                                                        <>
                                                                            <div className="provider-chip" style={{ fontSize: '0.7rem' }}>
                                                                                <div className={`provider-icon ${cfg.cls}`} style={{ width: 18, height: 18, fontSize: '0.55rem' }}>{cfg.abbr}</div>
                                                                                <span style={{ textTransform: 'capitalize' }}>{meta.provider}</span>
                                                                            </div>
                                                                            {meta.upstream_key_id && (
                                                                                <code style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--brand-amber)', background: 'rgba(255,170,0,0.08)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,170,0,0.2)' }}>
                                                                                    {meta.upstream_key_id.split('-')[0]}…
                                                                                </code>
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                            <button onClick={() => setTestResults(prev => ({ ...prev, [g.id]: { ...prev[g.id], showRaw: !prev[g.id].showRaw } }))}
                                                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                                                                {testResults[g.id].showRaw ? 'formatted' : 'raw json'}
                                                            </button>
                                                        </div>
                                                        <div className="test-result-body">
                                                            {testResults[g.id].status === 200 && !testResults[g.id].showRaw && testResults[g.id].data?.choices?.[0]?.message?.content
                                                                ? testResults[g.id].data.choices[0].message.content
                                                                : JSON.stringify(testResults[g.id].data || testResults[g.id].error, null, 2)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: ANALYTICS ═══ */}
            {activeTab === 'analytics' && (
                <div>
                    <div className="flex justify-end gap-2" style={{ marginBottom: '1.5rem' }}>
                        <button onClick={handleExportAnalytics} className="btn btn-secondary">
                            <Download size={14} /> {t('project.analytics.export')}
                        </button>
                        <button onClick={handleClearAnalytics} className="btn btn-danger">
                            <AlertTriangle size={14} /> {t('project.analytics.clear')}
                        </button>
                    </div>

                    <div className="stats-row" style={{ marginBottom: '1.5rem' }}>
                        <div className="stat-card">
                            <div className="stat-label"><Activity size={10} /> {t('project.analytics.total_reqs')}</div>
                            <div className="stat-value white">{analyticsData?.stats?.totalRequests || 0}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label"><CheckCircle2 size={10} /> {t('project.analytics.success_rate')}</div>
                            <div className="stat-value green">{analyticsData?.stats?.successRate || 0}%</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label"><Cpu size={10} /> {t('project.analytics.tokens')}</div>
                            <div className="stat-value amber">{(analyticsData?.stats?.totalTokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label"><Shield size={10} /> {t('project.analytics.cost')}</div>
                            <div className="stat-value white">${Number(analyticsData?.stats?.totalCostUsd || 0).toFixed(4)}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label"><Clock size={10} /> {t('project.analytics.latency')}</div>
                            <div className="stat-value orange">{analyticsData?.stats?.averageLatency || 0}<span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}>ms</span></div>
                        </div>
                    </div>

                    {(isBudgetWarning || isBudgetExceeded) && (
                        <div
                            style={{
                                marginBottom: '1.5rem',
                                padding: '0.9rem 1rem',
                                borderRadius: '12px',
                                border: isBudgetExceeded ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(255,170,0,0.35)',
                                background: isBudgetExceeded ? 'rgba(239,68,68,0.10)' : 'rgba(255,170,0,0.10)',
                                color: isBudgetExceeded ? '#fecaca' : '#fde68a',
                            }}
                        >
                            <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>
                                {isBudgetExceeded ? t('project.analytics.limit_reached') : t('project.analytics.warning_threshold')}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                                Spent ${totalCostUsd.toFixed(4)} / ${budgetUsd?.toFixed(2)} ({budgetUsagePct.toFixed(1)}%)
                            </div>
                        </div>
                    )}

                    <div className="flex gap-4" style={{ marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                        <div className="glass-panel" style={{ flex: 1, minWidth: 260 }}>
                            <div className="section-label"><Shield size={11} /> {t('project.analytics.budget')}</div>
                            <div style={{ display: 'grid', gap: '0.8rem' }}>
                                <div className="flex gap-3 items-end" style={{ flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: 180 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                            USD
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={budgetInput}
                                            onChange={e => setBudgetInput(e.target.value)}
                                            placeholder="0.00"
                                            style={{ marginBottom: 0 }}
                                        />
                                    </div>
                                    <div style={{ width: 160 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                            {t('project.analytics.alert_threshold')}
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="100"
                                            step="1"
                                            value={budgetAlertThresholdInput}
                                            onChange={e => setBudgetAlertThresholdInput(e.target.value)}
                                            placeholder="80"
                                            style={{ marginBottom: 0 }}
                                        />
                                    </div>
                                    <button className="btn btn-secondary" onClick={handleSaveBudget}>
                                        {t('project.analytics.save_budget')}
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                                    <span>Spent: ${totalCostUsd.toFixed(4)}</span>
                                    <span>Budget: {budgetUsd != null ? `$${budgetUsd.toFixed(2)}` : '—'}</span>
                                    <span>{t('project.analytics.remaining')}: {budgetUsd != null ? `$${Math.max(budgetUsd - totalCostUsd, 0).toFixed(4)}` : '—'}</span>
                                    <span>Usage: {budgetUsd != null ? `${budgetUsagePct.toFixed(1)}%` : '—'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="glass-panel" style={{ flex: 2, minWidth: 320 }}>
                            <div className="section-label"><Cpu size={11} /> {t('project.analytics.model_pricing')}</div>
                            <form onSubmit={handleSavePricing} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr 1fr auto', gap: '0.65rem', marginBottom: '1rem', alignItems: 'end' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Provider</label>
                                    <input value={pricingForm.provider} onChange={e => setPricingForm(prev => ({ ...prev, provider: e.target.value }))} placeholder="*" style={{ marginBottom: 0 }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Model</label>
                                    <input value={pricingForm.model_name} onChange={e => setPricingForm(prev => ({ ...prev, model_name: e.target.value }))} placeholder="gpt-4o-mini" style={{ marginBottom: 0 }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{t('project.analytics.input_price')}</label>
                                    <input type="number" min="0" step="0.000001" value={pricingForm.input_price_per_1m} onChange={e => setPricingForm(prev => ({ ...prev, input_price_per_1m: e.target.value }))} placeholder="0.150000" style={{ marginBottom: 0 }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>{t('project.analytics.output_price')}</label>
                                    <input type="number" min="0" step="0.000001" value={pricingForm.output_price_per_1m} onChange={e => setPricingForm(prev => ({ ...prev, output_price_per_1m: e.target.value }))} placeholder="0.600000" style={{ marginBottom: 0 }} />
                                </div>
                                <button className="btn btn-secondary" type="submit">
                                    {t('project.analytics.add_pricing')}
                                </button>
                            </form>

                            <div className="table-wrapper" style={{ maxHeight: 260 }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Provider</th>
                                            <th>Model</th>
                                            <th>{t('project.analytics.input_price')}</th>
                                            <th>{t('project.analytics.output_price')}</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pricingEntries.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.25rem' }}>No pricing rules yet.</td>
                                            </tr>
                                        ) : pricingEntries.map((entry) => (
                                            <tr key={entry.id}>
                                                <td>{entry.provider === '*' ? t('project.analytics.any_provider') : entry.provider}</td>
                                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{entry.model_name}</td>
                                                <td style={{ fontFamily: 'var(--font-mono)' }}>{Number(entry.input_price_per_1m || 0).toFixed(6)}</td>
                                                <td style={{ fontFamily: 'var(--font-mono)' }}>{Number(entry.output_price_per_1m || 0).toFixed(6)}</td>
                                                <td>
                                                    <div className="flex gap-2">
                                                        <button className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }} onClick={() => handleEditPricing(entry)}>Edit</button>
                                                        <button className="btn btn-danger" style={{ padding: '0.35rem 0.55rem' }} onClick={() => handleDeletePricing(entry.id)}>Delete</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4" style={{ marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                        <div className="glass-panel" style={{ flex: 1, minWidth: 240 }}>
                            <div className="section-label"><Server size={11} /> {t('project.analytics.top_providers')}</div>
                            {analyticsData?.providerUsage ? (
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                    {Object.entries(analyticsData.providerUsage).map(([prov, count]: any) => {
                                        const total = Object.values(analyticsData.providerUsage).reduce((a: any, b: any) => a + b, 0) as number;
                                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                                        return (
                                            <li key={prov} style={{ marginBottom: '0.875rem' }}>
                                                <div className="flex justify-between items-center" style={{ marginBottom: '0.3rem' }}>
                                                    <ProviderChip provider={prov} />
                                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--brand-orange)', fontWeight: 600 }}>
                                                        {count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>reqs</span>
                                                    </span>
                                                </div>
                                                <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('project.analytics.no_provider_data')}</p>}
                        </div>

                        <div className="glass-panel" style={{ flex: 1, minWidth: 240 }}>
                            <div className="section-label"><Cpu size={11} /> {t('project.analytics.top_models')}</div>
                            {analyticsData?.modelUsage ? (
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                    {Object.entries(analyticsData.modelUsage).map(([mod, count]: any) => {
                                        const total = Object.values(analyticsData.modelUsage).reduce((a: any, b: any) => a + b, 0) as number;
                                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                                        return (
                                            <li key={mod} style={{ marginBottom: '0.875rem' }}>
                                                <div className="flex justify-between items-center" style={{ marginBottom: '0.3rem' }}>
                                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{mod}</span>
                                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--brand-amber)', fontWeight: 600, flexShrink: 0 }}>
                                                        {count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>reqs</span>
                                                    </span>
                                                </div>
                                                <div className="progress-bar">
                                                    <div className="progress-fill" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--brand-amber), var(--brand-orange))' }} />
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{t('project.analytics.no_model_data')}</p>}
                        </div>
                    </div>

                    {/* Recent requests */}
                    <div className="glass-panel">
                        <div className="section-label"><Activity size={11} /> {t('project.analytics.recent_requests') || 'Recent Requests'}</div>
                        <div className="table-wrapper" style={{ maxHeight: 380 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Provider</th>
                                        <th>Model</th>
                                        <th>Status</th>
                                        <th>Input</th>
                                        <th>Output</th>
                                        <th>Latency</th>
                                        <th>Tokens</th>
                                        <th>Cost</th>
                                        <th>Error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentRequests.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>No recent requests.</td>
                                        </tr>
                                    ) : recentRequests.map((req: any) => (
                                        <tr key={req.id}>
                                            <td style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                {new Date(req.created_at).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                                            </td>
                                            <td>{req.provider ? <ProviderChip provider={req.provider} /> : '—'}</td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{req.model}</td>
                                            <td>
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center',
                                                    padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-pill)',
                                                    fontSize: '0.72rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                                                    background: (req.status_code || 200) < 400 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                                                    color: (req.status_code || 200) < 400 ? '#22c55e' : '#ef4444',
                                                    border: `1px solid ${(req.status_code || 200) < 400 ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                                                }}>
                                                    {req.status_code || (req.status === 'success' ? 200 : 500)}
                                                </span>
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {typeof req.prompt_tokens === 'number' ? req.prompt_tokens.toLocaleString() : '—'}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {typeof req.completion_tokens === 'number' ? req.completion_tokens.toLocaleString() : '—'}
                                            </td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: req.latency_ms > 5000 ? 'var(--brand-amber)' : 'var(--text-secondary)' }}>{req.latency_ms}ms</td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{req.total_tokens ? req.total_tokens.toLocaleString() : '—'}</td>
                                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                ${Number(req.total_cost_usd || 0).toFixed(6)}
                                            </td>
                                            <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ef4444', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }} title={req.error_message || ''}>
                                                {req.error_message || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TOKEN LIMIT MODAL ═══ */}
            {tokenLimitModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'fadeIn 0.2s ease-out',
                }} onClick={() => setTokenLimitModal(null)}>
                    <div style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid rgba(139,92,246,0.35)',
                        borderRadius: 'var(--radius-xl)',
                        padding: '2rem',
                        width: '100%', maxWidth: 420,
                        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.2)',
                        position: 'relative',
                    }} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 'var(--radius-md)',
                                background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Sliders size={18} style={{ color: '#a78bfa' }} />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#fff' }}>
                                    {tokenLimitModal.mode === 'global' ? 'Global Output Token Limit' : `Token Limit — ${tokenLimitModal.providerName}`}
                                </h3>
                                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    {tokenLimitModal.mode === 'global'
                                        ? 'Applies to ALL providers in this project'
                                        : 'Applies only to this provider'}
                                </p>
                            </div>
                        </div>

                        {/* Info box */}
                        <div style={{
                            background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
                            borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem',
                            marginBottom: '1.25rem', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6,
                        }}>
                            <strong style={{ color: '#a78bfa' }}>max_tokens cap</strong> — el gateway trunca las respuestas de salida al valor que configures aquí.
                            Deja en blanco para usar el default global (16,000). Google &amp; Vertex están exentos siempre.
                        </div>

                        {/* Presets */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                            {[null, 4096, 8192, 16000, 32000, 65536, 131072].map(v => (
                                <button
                                    key={v ?? 'default'}
                                    onClick={() => setTokenLimitInput(v === null ? '' : String(v))}
                                    style={{
                                        padding: '0.3rem 0.65rem',
                                        borderRadius: 'var(--radius-pill)',
                                        fontSize: '0.72rem', fontWeight: 700, fontFamily: 'var(--font-mono)',
                                        background: tokenLimitInput === (v === null ? '' : String(v))
                                            ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.06)',
                                        border: tokenLimitInput === (v === null ? '' : String(v))
                                            ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                        color: tokenLimitInput === (v === null ? '' : String(v))
                                            ? '#c4b5fd' : 'var(--text-secondary)',
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    }}
                                >
                                    {v === null ? '∞ Default' : v >= 1000 ? `${v / 1024 >= 1 ? (v / 1024).toFixed(0) + 'k' : v}` : v}
                                </button>
                            ))}
                        </div>

                        {/* Input */}
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' }}>
                                Custom value (tokens)
                            </label>
                            <input
                                type="number"
                                min={100}
                                step={512}
                                value={tokenLimitInput}
                                onChange={e => setTokenLimitInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveTokenLimit(); if (e.key === 'Escape') setTokenLimitModal(null); }}
                                placeholder="Blank = use gateway default (16,000)"
                                autoFocus
                                style={{ width: '100%', marginBottom: 0, fontFamily: 'var(--font-mono)', fontSize: '1rem', padding: '0.65rem 0.85rem', borderColor: 'rgba(139,92,246,0.4)' }}
                            />
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => setTokenLimitModal(null)}
                                className="btn btn-secondary"
                                style={{ flex: 1 }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveTokenLimit}
                                className="btn btn-sm"
                                style={{ flex: 2, background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', color: '#c4b5fd', fontSize: '0.9rem', padding: '0.65rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                            >
                                <Sliders size={14} />
                                {tokenLimitModal.mode === 'global' ? 'Apply to All Providers' : 'Save Token Limit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
