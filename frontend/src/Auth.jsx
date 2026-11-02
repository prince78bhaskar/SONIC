import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Mail, Sparkles, UserRound } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export default function Auth({ onAuthenticated }) {
  const [view, setView] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!resendIn) return undefined;
    const timer = window.setTimeout(() => setResendIn((remaining) => Math.max(remaining - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function request(path, body) {
    const response = await fetch(`${API_URL}/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
    return data;
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (view === 'signup') {
        await request('signup', { name, email, password });
        setView('verify'); setResendIn(60); setNotice(`We sent a six-digit code to ${email}.`);
      } else if (view === 'verify') {
        const data = await request('verify-email', { email, otp });
        onAuthenticated(data);
      } else if (view === 'forgot') {
        await request('forgot-password', { email });
        setView('reset'); setResendIn(60); setNotice(`If an account exists, a reset code is on its way to ${email}.`);
      } else if (view === 'reset') {
        await request('reset-password', { email, otp, password });
        setView('login'); setOtp(''); setPassword(''); setNotice('Your password has been updated. Sign in with your new password.');
      } else {
        const data = await request('login', { email, password });
        onAuthenticated(data);
      }
    } catch (submitError) { setError(submitError.message); }
    finally { setBusy(false); }
  }

  async function resendCode() {
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await request(view === 'verify' ? 'resend-verification' : 'forgot-password', { email });
      setNotice(data.message); setResendIn(60);
    } catch (resendError) { setError(resendError.message); }
    finally { setBusy(false); }
  }

  const verificationView = view === 'verify' || view === 'reset';
  const title = ({ login: 'Welcome back', signup: 'Create your account', verify: 'Check your inbox', forgot: 'Forgot your password?', reset: 'Choose a new password' })[view];
  const subtitle = ({ login: 'Sign in to pick up where you left off.', signup: 'A calmer space for all the things on your mind.', verify: 'Enter the six-digit code we sent you. It expires in 5 minutes.', forgot: 'We’ll send a one-time code to your email address.', reset: 'Enter the code from your email and a new password.' })[view];

  return <main className="auth-page"><div className="auth-brand-row"><a className="brand auth-brand" href="#home" aria-label="SONIC"><span className="brand-mark"><span/><span/><span/><span/></span><span>SONIC</span></a><span className="auth-trust"><LockKeyhole size={13}/> Private by design</span></div><section className="auth-card"><div className="auth-symbol"><Sparkles size={19}/></div><div className="auth-overline">YOUR PERSONAL WORKSPACE</div><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p><form className="auth-form" onSubmit={submit}>
    {view === 'signup' && <label className="auth-field"><span>Name</span><div className="auth-input-wrap"><UserRound size={16}/><input autoComplete="name" value={name} onChange={(event)=>setName(event.target.value)} placeholder="Your name" minLength={2} maxLength={80} required/></div></label>}
    {(!verificationView || view === 'reset') && <label className="auth-field"><span>Email address</span><div className="auth-input-wrap"><Mail size={16}/><input type="email" autoComplete="email" value={email} onChange={(event)=>setEmail(event.target.value)} placeholder="you@example.com" required disabled={verificationView}/></div></label>}
    {verificationView && <label className="auth-field"><span>Six-digit code</span><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event)=>setOtp(event.target.value.replace(/\D/g,'').slice(0,6))} placeholder="000000" pattern="[0-9]{6}" minLength={6} maxLength={6} required/></label>}
    {(view === 'signup' || view === 'login' || view === 'reset') && <label className="auth-field"><span>{view === 'reset' ? 'New password' : 'Password'}{view !== 'signup' && view !== 'reset' ? <button className="auth-inline-link" type="button" onClick={()=>{setView('forgot');setError('');setNotice('');}}>Forgot password?</button> : null}</span><div className="auth-input-wrap"><LockKeyhole size={16}/><input type="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event)=>setPassword(event.target.value)} placeholder="At least 8 characters" minLength={8} maxLength={128} required/></div></label>}
    {error && <div className="auth-message auth-error" role="alert">{error}</div>}{notice && <div className="auth-message auth-notice" role="status">{notice}</div>}
    <button className="auth-submit" type="submit" disabled={busy || (verificationView && otp.length !== 6)}>{busy ? 'Please wait…' : ({login:'Sign in',signup:'Create account',verify:'Verify email',forgot:'Send reset code',reset:'Update password'})[view]} {!busy && <ArrowRight size={16}/>}</button>
  </form>
  {verificationView && <div className="auth-resend">Didn’t get a code? <button disabled={busy || resendIn > 0} onClick={resendCode}>{resendIn ? `Resend in ${resendIn}s` : 'Resend code'}</button></div>}
  {view === 'forgot' && <button className="auth-back" onClick={()=>{setView('login');setError('');setNotice('');}}><ArrowLeft size={14}/> Back to sign in</button>}
  {!verificationView && view !== 'forgot' && <div className="auth-switch">{view === 'login' ? <>New to SONIC? <button onClick={()=>{setView('signup');setError('');setNotice('');}}>Create an account</button></> : <>Already have an account? <button onClick={()=>{setView('login');setError('');setNotice('');}}>Sign in</button></>}</div>}
  <div className="auth-security"><Check size={13}/> Your password is encrypted and never shared.</div></section><footer className="auth-footer"><span>Thoughtful by design.</span><span><a href="#privacy">Privacy</a><span>·</span><a href="#terms">Terms</a></span></footer></main>;
}
