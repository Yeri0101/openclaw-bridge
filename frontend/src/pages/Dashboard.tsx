import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchApi } from '../api';
import { FolderOpen, Plus, Trash2, Edit2, Zap, Palette, Key, Activity } from 'lucide-react';
import { useLanguage } from '../i18n';

type GatewayKeyPreview = {
    id: string;
    key_name: string;
    key_preview: string;
};

type Project = {
    id: string;
    name: string;
    color?: string;
    created_at: string;
    gateway_keys?: GatewayKeyPreview[];
    avg_latency_ms?: number | null;
};

type RecentCall = {
    project_id: string;
    project_name: string;
    model: string;
    latency_ms: number | null;
    total_tokens: number;
    created_at: string;
};

const PROJECT_COLORS = [
    '#ff6b2b', // orange (default)
    '#ffaa00', // amber
    '#22c55e', // green
    '#14b8a6', // teal
    '#3b82f6', // blue
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#ef4444', // red
];

export default function Dashboard() {
    const { t } = useLanguage();
    const [projects, setProjects] = useState<Project[]>([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [loading, setLoading] = useState(true);
    const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [colorPickerId, setColorPickerId] = useState<string | null>(null);

    const loadProjects = async () => {
        try {
            const projectsData = await fetchApi('/projects');
            setProjects(projectsData);

            const analyticsResponses = await Promise.all(
                projectsData.map(async (project: Project) => {
                    try {
                        const analytics = await fetchApi(`/analytics/${project.id}`);
                        const projectRecentLogs = Array.isArray(analytics?.recentLogs) ? analytics.recentLogs : [];
                        return projectRecentLogs.map((log: any) => ({
                            project_id: project.id,
                            project_name: project.name,
                            model: log.model || '—',
                            latency_ms: log.latency_ms ?? null,
                            total_tokens: log.total_tokens ?? 0,
                            created_at: log.created_at,
                        }));
                    } catch (err) {
                        console.error(`Failed to load analytics for project ${project.id}:`, err);
                        return [];
                    }
                })
            );

            const latestCalls = analyticsResponses
                .flat()
                .filter((log: RecentCall) => !!log.created_at)
                .sort((a: RecentCall, b: RecentCall) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .slice(0, 3);

            setRecentCalls(latestCalls);
        } catch (err) {
            console.error(err);
            setRecentCalls([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadProjects(); }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim()) return;
        try {
            await fetchApi('/projects', {
                method: 'POST',
                body: JSON.stringify({ name: newProjectName }),
            });
            setNewProjectName('');
            loadProjects();
        } catch { alert('Failed to create project'); }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        if (!confirm('Delete this project and all its data?')) return;
        try {
            await fetchApi(`/projects/${id}`, { method: 'DELETE' });
            loadProjects();
        } catch { alert('Failed to delete project'); }
    };

    const handleEditStart = (p: Project, e: React.MouseEvent) => {
        e.preventDefault();
        setEditingId(p.id);
        setEditName(p.name);
        setColorPickerId(null);
    };

    const handleEditSave = async (id: string, e: React.MouseEvent | React.FormEvent) => {
        e.preventDefault();
        if (!editName.trim()) return;
        try {
            await fetchApi(`/projects/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: editName }),
            });
            setEditingId(null);
            loadProjects();
        } catch { alert('Failed to rename project'); }
    };

    const handleColorChange = async (id: string, color: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await fetchApi(`/projects/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ color }),
            });
            setProjects(prev => prev.map(p => p.id === id ? { ...p, color } : p));
            setColorPickerId(null);
        } catch { console.error('Failed to change color'); }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
                <div className="spinner-ring" style={{ width: 32, height: 32, borderWidth: 3 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading projects…</p>
            </div>
        );
    }

    const recentCallCards = Array.from({ length: 3 }, (_, index) => recentCalls[index] || null);

    const formatLatency = (latencyMs: number | null) => {
        if (latencyMs == null) return '—';
        return latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`;
    };

    const formatCallTime = (createdAt: string) => {
        return new Date(createdAt).toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    };

    return (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            {/* Page header */}
            <div
                className="flex items-center justify-between"
                style={{ marginBottom: '2rem', gap: '1.25rem', alignItems: 'stretch', flexWrap: 'wrap' }}
            >
                <div>
                    <div className="flex items-center gap-2" style={{ marginBottom: '0.35rem' }}>
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                            background: 'rgba(255,107,43,0.1)', border: '1px solid rgba(255,107,43,0.25)',
                            borderRadius: 'var(--radius-pill)', padding: '0.2rem 0.65rem',
                            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em',
                            color: 'var(--brand-orange)', textTransform: 'uppercase',
                        }}>
                            <Zap size={9} /> SOAT Gateway
                        </span>
                    </div>
                    <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 }}>
                        {t('dashboard.title')}
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>{t('dashboard.subtitle')}</p>
                </div>

                <div style={{ flex: '1 1 640px', minWidth: '320px', maxWidth: '760px' }}>
                    <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem', justifyContent: 'flex-end' }}>
                        <Activity size={16} style={{ color: 'var(--brand-orange)' }} />
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{t('dashboard.recent_calls')}</h3>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.85rem' }}>
                    {recentCallCards.map((call, index) => (
                        <div
                            key={call?.created_at || `empty-${index}`}
                            style={{
                                border: '1px solid rgba(255,255,255,0.08)',
                                background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))',
                                borderRadius: '14px',
                                padding: '0.9rem',
                                minHeight: '148px',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                            }}
                        >
                            {call ? (
                                <>
                                    <div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--brand-orange)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                                            #{index + 1}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('dashboard.recent_project')}</div>
                                        <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: '0.7rem' }}>
                                            {call.project_name}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('dashboard.recent_model')}</div>
                                        <div style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                                            {call.model}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.65rem 0 0.2rem' }}>{t('dashboard.recent_time')}</div>
                                        <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                            {formatCallTime(call.created_at)}
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '0.85rem' }}>
                                        <div style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>{t('dashboard.recent_latency')}</div>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatLatency(call.latency_ms)}</div>
                                        </div>
                                        <div style={{ padding: '0.45rem 0.55rem', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>{t('dashboard.recent_tokens')}</div>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{call.total_tokens.toLocaleString()}</div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--brand-orange)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                                        #{index + 1}
                                    </div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                                        {t('dashboard.recent_empty')}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {t('dashboard.recent_project')}: —
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {t('dashboard.recent_model')}: —
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {t('dashboard.recent_latency')}: —
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {t('dashboard.recent_tokens')}: —
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {t('dashboard.recent_time')}: —
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    </div>
                </div>
            </div>

            {/* Create Project */}
            <div className="glass-panel" style={{ marginBottom: '2rem' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: '0.875rem' }}>
                    <Plus size={16} style={{ color: 'var(--brand-orange)' }} />
                    <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{t('dashboard.create_title')}</h3>
                </div>
                <form onSubmit={handleCreate} className="flex gap-3 items-center">
                    <input
                        id="new-project-name"
                        type="text"
                        placeholder={t('dashboard.input_placeholder')}
                        value={newProjectName}
                        onChange={e => setNewProjectName(e.target.value)}
                        required
                        style={{ flex: 1, marginBottom: 0 }}
                    />
                    <button id="create-project-btn" type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                        <Plus size={15} /> {t('dashboard.btn_create')}
                    </button>
                </form>
            </div>

            {/* Section label */}
            <div className="section-label" style={{ marginBottom: '1rem' }}>
                <FolderOpen size={12} />
                Projects ({projects.length})
            </div>

            {/* Projects Grid */}
            <div className="projects-grid">
                {projects.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1' }}>
                        <div className="empty-state">
                            <div className="empty-state-icon"><FolderOpen size={28} /></div>
                            <h3>{t('dashboard.no_projects')}</h3>
                            <p>{t('dashboard.no_projects_desc')}</p>
                        </div>
                    </div>
                ) : (
                    projects.map(p => {
                        const projColor = p.color || '#ff6b2b';
                        return (
                            <Link
                                to={`/projects/${p.id}`}
                                key={p.id}
                                className="project-card"
                                style={{ '--project-color': projColor } as any}
                                onClick={e => {
                                    // Prevent navigation when interacting with color/edit controls
                                    if ((e.target as HTMLElement).closest('.card-actions')) e.preventDefault();
                                }}
                            >
                                {/* Card header */}
                                <div className="flex items-center gap-2" style={{ marginBottom: '0.75rem' }}>
                                    <div className="project-color-dot" style={{ background: projColor, boxShadow: `0 0 8px ${projColor}60` }} />

                                    {editingId === p.id ? (
                                        <div className="flex items-center gap-2 card-actions" style={{ flex: 1 }}
                                            onClick={e => e.preventDefault()}>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                autoFocus
                                                onKeyDown={e => { if (e.key === 'Enter') handleEditSave(p.id, e as any); if (e.key === 'Escape') setEditingId(null); }}
                                                style={{ flex: 1, padding: '0.3rem 0.6rem', fontSize: '0.85rem', marginBottom: 0, borderColor: projColor }}
                                            />
                                            <button onClick={e => handleEditSave(p.id, e)} className="ctx-edit-save" title="Save">✓</button>
                                            <button onClick={e => { e.preventDefault(); setEditingId(null); }} className="ctx-edit-cancel" title="Cancel">✕</button>
                                        </div>
                                    ) : (
                                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                                            {p.name}
                                        </h3>
                                    )}
                                </div>

                                {/* Color picker */}
                                {colorPickerId === p.id && (
                                    <div className="color-picker-row card-actions" onClick={e => e.preventDefault()} style={{ marginBottom: '0.75rem' }}>
                                        {PROJECT_COLORS.map(c => (
                                            <button
                                                key={c}
                                                className={`color-swatch${projColor === c ? ' active' : ''}`}
                                                style={{ background: c }}
                                                onClick={e => handleColorChange(p.id, c, e)}
                                                title={c}
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Gateway Key Previews */}
                                {p.gateway_keys && p.gateway_keys.length > 0 && (
                                    <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                        {p.gateway_keys.map(gk => (
                                            <div key={gk.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <Key size={10} style={{ color: projColor, flexShrink: 0 }} />
                                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0.1rem 0.4rem', letterSpacing: '0.04em' }}>
                                                    {gk.key_preview}
                                                </span>
                                                {gk.key_name && (
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {gk.key_name}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Footer */}
                                <div className="flex items-center justify-between card-actions" style={{ marginTop: '0.75rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                                            {new Date(p.created_at).toLocaleDateString()}
                                        </p>
                                        {p.avg_latency_ms != null && (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: p.avg_latency_ms < 1000 ? '#22c55e' : p.avg_latency_ms < 3000 ? '#ffaa00' : '#ef4444', background: p.avg_latency_ms < 1000 ? 'rgba(34,197,94,0.1)' : p.avg_latency_ms < 3000 ? 'rgba(255,170,0,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${p.avg_latency_ms < 1000 ? 'rgba(34,197,94,0.25)' : p.avg_latency_ms < 3000 ? 'rgba(255,170,0,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: '4px', padding: '0.1rem 0.4rem' }}>
                                                <Activity size={9} />
                                                {p.avg_latency_ms < 1000 ? `${p.avg_latency_ms}ms` : `${(p.avg_latency_ms / 1000).toFixed(1)}s`}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex gap-1" onClick={e => e.preventDefault()}>
                                        <button
                                            onClick={e => { e.preventDefault(); setColorPickerId(colorPickerId === p.id ? null : p.id); setEditingId(null); }}
                                            title="Change color"
                                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: 'var(--text-primary)', padding: '0.35rem', borderRadius: '6px', transition: 'all 0.15s', display: 'flex', alignItems: 'center' }}
                                            onMouseEnter={e => { e.currentTarget.style.color = projColor; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                        >
                                            <Palette size={14} />
                                        </button>
                                        <button
                                            onClick={e => handleEditStart(p, e)}
                                            title="Rename"
                                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: 'var(--text-primary)', padding: '0.35rem', borderRadius: '6px', transition: 'all 0.15s', display: 'flex', alignItems: 'center' }}
                                            onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-amber)'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={e => handleDelete(p.id, e)}
                                            title="Delete project"
                                            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: 'var(--text-primary)', padding: '0.35rem', borderRadius: '6px', transition: 'all 0.15s', display: 'flex', alignItems: 'center' }}
                                            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </Link>
                        );
                    })
                )}
            </div>
        </div>
    );
}
