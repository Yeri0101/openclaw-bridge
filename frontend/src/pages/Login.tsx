import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchApi } from '../api';
import { Layers, ArrowRight, Lock, User } from 'lucide-react';
import { useLanguage } from '../i18n';

export default function Login() {
    const { t } = useLanguage();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await fetchApi('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
            localStorage.setItem('token', res.token);
            localStorage.setItem('user', res.user || username);
            navigate('/');
        } catch (err: any) {
            setError(err.message || t('login.error'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.35s ease-out',
        }}>
            {/* Logo */}
            <div className="login-logo">
                <Layers size={32} style={{ color: 'white' }} />
            </div>

            <h1 className="login-title" style={{ fontSize: '1.65rem', marginBottom: '0.25rem' }}>TierMax</h1>
            <p className="login-subtitle" style={{ marginBottom: '2rem' }}>{t('login.subtitle')}</p>

            {/* Card */}
            <div className="login-card">
                {error && (
                    <div className="login-error">
                        <span>⚠</span> {error}
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <User size={11} /> Username
                            </span>
                        </label>
                        <input
                            id="login-username"
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            placeholder="admin"
                            autoComplete="username"
                            required
                        />
                    </div>

                    <div className="form-group" style={{ marginBottom: '1.75rem' }}>
                        <label>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Lock size={11} /> {t('login.password')}
                            </span>
                        </label>
                        <input
                            id="login-password"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <button
                        id="login-submit"
                        type="submit"
                        className="btn btn-primary w-full btn-xl"
                        disabled={loading}
                    >
                        {loading ? (
                            <><span className="spinner-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> {t('login.btn_signing_in')}</>
                        ) : (
                            <>{t('login.btn_signin')} <ArrowRight size={16} /></>
                        )}
                    </button>
                </form>
            </div>

            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '1.5rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                SOAT · Fallback · Context-Guard · Latency · Anti-F200
            </p>
        </div>
    );
}
