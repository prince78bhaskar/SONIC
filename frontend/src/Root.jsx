import React, { useEffect, useState } from 'react';
import Auth from './Auth.jsx';
import ChatWorkspace from './ChatWorkspace.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function Root() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const token = localStorage.getItem('forma_token');
    if (!token) { setReady(true); return; }
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session expired');
        const data = await response.json();
        setUser(data.user);
      })
      .catch(() => localStorage.removeItem('forma_token'))
      .finally(() => setReady(true));
  }, []);

  function onAuthenticated(data) {
    localStorage.setItem('forma_token', data.token);
    setUser(data.user);
  }

  function onLogout() {
    localStorage.removeItem('forma_token');
    setUser(null);
  }

  if (!ready) return <main className="auth-loading" aria-label="Loading SONIC"><div className="loading-brand"><span className="brand-mark"><span/><span/><span/><span/></span><span>SONIC</span></div></main>;
  return user ? <ChatWorkspace user={user} onLogout={onLogout} /> : <Auth onAuthenticated={onAuthenticated} />;
}
