import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import './ForgotPasswordPage.css';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const { resetPassword, updatePassword } = useAuth();
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('request'); // 'request' or 'reset'

  // Check if user is in password recovery mode (clicked email link)
  useEffect(() => {
    const checkRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      // If there's a session and it's a recovery session, show reset form
      if (session) {
        // Check if this is a password recovery session
        // Supabase sets the session when user clicks the reset link
        setStep('reset');
      }
    };
    
    checkRecoverySession();
  }, []);

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await resetPassword(email);
      setSuccess('Password reset email sent! Please check your inbox and click the link to reset your password.');
      setEmail('');
    } catch (err) {
      setError(err.message || 'Failed to send password reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await updatePassword(newPassword);
      setSuccess('Password updated successfully! Redirecting to login...');
      setTimeout(() => {
        navigate('/login', {
          state: {
            message: 'Your password has been reset successfully. Please sign in with your new password.',
            messageType: 'success'
          }
        });
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to update password. The reset link may have expired. Please request a new one.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="forgot-password-page">
      <header className="forgot-password-header">
        <Link to="/" className="logo-link">
          <h1 className="logo">TCGConvert</h1>
        </Link>
      </header>
      
      <main className="forgot-password-main">
        <div className="forgot-password-container">
          {step === 'request' ? (
            <>
              <h2 className="forgot-password-title">Reset Password</h2>
              <p className="forgot-password-description">
                Enter your email address and we'll send you a link to reset your password.
              </p>
              
              {success && (
                <div className="forgot-password-success">
                  <p>{success}</p>
                </div>
              )}

              {error && (
                <div className="forgot-password-error">
                  <p>{error}</p>
                </div>
              )}

              <form onSubmit={handleRequestReset} className="forgot-password-form">
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="Enter your email"
                  />
                </div>

                <button 
                  type="submit" 
                  className="forgot-password-submit-button"
                  disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>

              <div className="forgot-password-footer">
                <Link to="/login" className="forgot-password-link">
                  Back to Sign In
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="forgot-password-title">Set New Password</h2>
              <p className="forgot-password-description">
                Please enter your new password below.
              </p>
              
              {success && (
                <div className="forgot-password-success">
                  <p>{success}</p>
                </div>
              )}

              {error && (
                <div className="forgot-password-error">
                  <p>{error}</p>
                </div>
              )}

              <form onSubmit={handleResetPassword} className="forgot-password-form">
                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type="password"
                    id="newPassword"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    placeholder="Enter new password"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                    placeholder="Confirm new password"
                  />
                </div>

                <button 
                  type="submit" 
                  className="forgot-password-submit-button"
                  disabled={loading}
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>

              <div className="forgot-password-footer">
                <Link to="/login" className="forgot-password-link">
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default ForgotPasswordPage;

