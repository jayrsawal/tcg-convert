import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  // Show message from signup page if present
  useEffect(() => {
    if (location.state?.message) {
      if (location.state.messageType === 'success') {
        setInfo(location.state.message);
      } else {
        setError(location.state.message);
      }
      // Clear the state to prevent showing it again on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const userData = await signIn(email, password);
      
      // Check if email is confirmed
      if (userData && !userData.emailConfirmed) {
        setError('Please confirm your email address before signing in. Check your inbox for the confirmation link.');
        // Sign out the user since email is not confirmed
        await signOut();
        return;
      }
      
      navigate('/');
    } catch (err) {
      // Check if error is related to email confirmation
      if (err.message && (err.message.includes('email') && err.message.includes('confirm'))) {
        setError('Please confirm your email address before signing in. Check your inbox for the confirmation link.');
      } else {
        setError(err.message || 'Failed to sign in. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <header className="login-header">
        <Link to="/" className="logo-link">
          <h1 className="logo">StrikerPack</h1>
        </Link>
      </header>
      
      <main className="login-main">
        <div className="login-container">
          <h2 className="login-title">Sign In</h2>
          
          {info && (
            <div className="login-info">
              <p>{info}</p>
            </div>
          )}

          {error && (
            <div className="login-error">
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <div className="password-label-row">
                <label htmlFor="password">Password</label>
                <Link to="/forgot-password" className="forgot-password-link">
                  Forgot password?
                </Link>
              </div>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button 
              type="submit" 
              className="login-submit-button"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="login-footer">
            <p>
              Don't have an account?{' '}
              <Link to="/signup" className="login-link">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;

