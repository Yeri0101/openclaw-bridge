import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Layers, Globe, KeyRound, Home, LogOut, Zap, Shield, Activity } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import { LanguageProvider, useLanguage } from './i18n';
import { fetchApi } from './api';
import './index.css';

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { language, setLanguage, t } = useLanguage();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const isLoggedIn = !!localStorage.getItem('token');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  };

  const toggleLanguage = () => setLanguage(language === 'en' ? 'es' : 'en');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordLoading(true);
    const username = localStorage.getItem('user') || 'admin';
    try {
      await fetchApi('/auth/credentials', {
        method: 'PUT',
        body: JSON.stringify({ currentUsername: username, currentPassword, newPassword }),
      });
      setPasswordSuccess(t('settings.success'));
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setShowPasswordModal(false), 2000);
    } catch (err: any) {
      setPasswordError(err.message || t('settings.error'));
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <>
      <nav className="navbar">
        {/* Brand */}
        <Link to="/" className="navbar-brand">
          <div className="navbar-logo">
            <Layers size={18} style={{ color: 'white' }} />
          </div>
          <div>
            <div className="navbar-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              TierMax
              <span style={{
                fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em',
                background: 'rgba(255,107,43,0.15)', border: '1px solid rgba(255,107,43,0.35)',
                color: 'var(--brand-orange)', borderRadius: '4px',
                padding: '0.05rem 0.35rem', lineHeight: 1.4,
              }}>v2.1</span>
            </div>
            <div className="navbar-subtitle">Gateway · SOAT</div>
          </div>
        </Link>

        {/* Center status chips */}
        {isLoggedIn && (
          <div className="flex items-center gap-3" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 'var(--radius-pill)', padding: '0.25rem 0.65rem',
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', color: '#22c55e',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e', animation: 'pulseGlow 2s infinite' }} />
              LIVE
            </div>
            <div className="flex items-center gap-3" style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Zap size={10} style={{ color: 'var(--brand-orange)' }} /> FALLBACK
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Shield size={10} style={{ color: 'var(--brand-amber)' }} /> ANTI-F200
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Activity size={10} style={{ color: '#22c55e' }} /> LATENCY
              </span>
            </div>
          </div>
        )}

        {/* Right actions */}
        <div className="navbar-right">
          {isLoggedIn && (
            <Link to="/" className="btn btn-secondary btn-icon" title="Dashboard" style={{ textDecoration: 'none' }}>
              <Home size={16} />
            </Link>
          )}

          <button
            onClick={toggleLanguage}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.7rem', gap: '0.3rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700 }}
          >
            <Globe size={13} /> {language.toUpperCase()}
          </button>

          {isLoggedIn && (
            <>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="btn btn-secondary btn-icon"
                title={t('nav.change_password')}
              >
                <KeyRound size={15} />
              </button>

              <button
                onClick={handleLogout}
                className="btn btn-danger btn-icon"
                title={t('nav.logout')}
              >
                <LogOut size={15} />
              </button>
            </>
          )}
        </div>
      </nav>

      <main style={{ maxWidth: 1300, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {children}
      </main>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div onClick={() => setShowPasswordModal(false)} style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
        }}>
          <div onClick={e => e.stopPropagation()} className="glass-panel" style={{
            width: '100%', maxWidth: 400, padding: '2rem', border: '1px solid var(--border-accent)',
          }}>
            <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
              <div className="flex items-center gap-2">
                <KeyRound size={17} style={{ color: 'var(--brand-orange)' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{t('settings.password_title')}</h3>
              </div>
              <button onClick={() => setShowPasswordModal(false)} className="btn btn-secondary btn-icon">✕</button>
            </div>

            {passwordError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{passwordError}</div>}
            {passwordSuccess && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{passwordSuccess}</div>}

            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t('settings.current_password')}</label>
                <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                <label>{t('settings.new_password')}</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <div className="flex gap-3">
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPasswordModal(false)}>{t('settings.btn_cancel')}</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={passwordLoading}>
                  {passwordLoading ? <><span className="spinner-ring" style={{ width: 14, height: 14, borderWidth: 2 }} /> Updating…</> : t('settings.btn_update')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <LanguageProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/projects/:id" element={<PrivateRoute><ProjectDetail /></PrivateRoute>} />
          </Routes>
        </Layout>
      </Router>
    </LanguageProvider>
  );
}

export default App;
