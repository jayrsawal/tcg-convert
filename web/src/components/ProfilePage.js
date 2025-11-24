import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useTCGPercentage } from '../contexts/TCGPercentageContext';
import { fetchUserProfile, updateUserCurrency, updateUserTcgPercentage } from '../lib/api';
import NavigationBar from './NavigationBar';
import './ProfilePage.css';

const ProfilePage = () => {
  const { user, loading: authLoading } = useAuth();
  const { selectedCurrency, setSelectedCurrency } = useCurrency();
  const { selectedTCGPercentage, setSelectedTCGPercentage } = useTCGPercentage();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState(selectedCurrency.toUpperCase());
  const [tcgPercentage, setTcgPercentage] = useState(selectedTCGPercentage);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    // Only redirect if auth has finished loading and user is still null
    if (!authLoading && !user) {
      navigate('/login');
      return;
    }
    
    // Don't load profile if still checking auth or no user
    if (authLoading || !user) {
      return;
    }

    // Load user's currency from profile
    const loadProfile = async () => {
      try {
        setLoading(true);
        setError('');
        const profile = await fetchUserProfile(user.id);
        
        if (profile && profile.currency) {
          const profileCurrency = profile.currency.toLowerCase();
          setCurrency(profileCurrency);
          // Sync with currency context
          setSelectedCurrency(profileCurrency);
        } else {
          // Default to current selected currency
          setCurrency(selectedCurrency);
        }

        if (profile && profile.tcg_percentage !== undefined) {
          const profileTCGPercentage = parseInt(profile.tcg_percentage, 10);
          setTcgPercentage(profileTCGPercentage);
          // Sync with TCG percentage context
          setSelectedTCGPercentage(profileTCGPercentage);
        } else {
          // Default to current selected TCG percentage
          setTcgPercentage(selectedTCGPercentage);
        }
      } catch (err) {
        console.error('Error loading profile:', err);
        setError('Failed to load profile. Using default currency.');
        setCurrency(selectedCurrency);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user, navigate, selectedCurrency, setSelectedCurrency]);

  const handleCurrencyChange = (e) => {
    setCurrency(e.target.value);
    setError('');
    setSuccess('');
  };

  const handleTcgPercentageChange = (e) => {
    const value = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
    setTcgPercentage(value);
    setError('');
    setSuccess('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Update both currency and TCG percentage
      const currencyChanged = currency.toLowerCase() !== selectedCurrency;
      const tcgPercentageChanged = tcgPercentage !== selectedTCGPercentage;

      if (currencyChanged) {
        await updateUserCurrency(user.id, currency);
        // Update currency context
        setSelectedCurrency(currency.toLowerCase());
      }

      if (tcgPercentageChanged) {
        await updateUserTcgPercentage(user.id, tcgPercentage);
        // Update TCG percentage context
        setSelectedTCGPercentage(tcgPercentage);
      }

      if (currencyChanged || tcgPercentageChanged) {
        setSuccess('Settings updated successfully!');
      } else {
        setSuccess('No changes to save.');
      }
    } catch (err) {
      console.error('Error updating settings:', err);
      setError(err.message || 'Failed to update settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="profile-page">
        <NavigationBar className="profile-header" />
        <main className="profile-main">
          <div className="profile-container">
            <div className="profile-loading">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

  // Redirect if not authenticated (after loading is complete)
  if (!user) {
    return null; // Will redirect to login
  }

  return (
    <div className="profile-page">
      <NavigationBar className="profile-header" />

      <main className="profile-main">
        <div className="profile-container">
          <h1 className="profile-title">Profile</h1>
          
          {loading ? (
            <div className="profile-loading">Loading profile...</div>
          ) : (
            <form onSubmit={handleSave} className="profile-form">
              <div className="profile-section">
                <h2 className="profile-section-title">Currency Preferences</h2>
                <p className="profile-section-description">
                  Select your preferred currency for displaying prices throughout the application.
                </p>

                <div className="form-group">
                  <label htmlFor="currency" className="form-label">
                    Currency
                  </label>
                  <select
                    id="currency"
                    className="form-select"
                    value={currency.toLowerCase()}
                    onChange={handleCurrencyChange}
                    disabled={saving}
                  >
                    <option value="usd">USD - US Dollar</option>
                    <option value="cad">CAD - Canadian Dollar</option>
                    <option value="eur">EUR - Euro</option>
                  </select>
                </div>
              </div>

              <div className="profile-section">
                <h2 className="profile-section-title">TCG Preferences</h2>
                <p className="profile-section-description">
                  Set your default maximum percentage value for TCG histograms and market value distributions.
                </p>

                <div className="form-group">
                  <label htmlFor="tcg-percentage" className="form-label">
                    TCG %
                    <span
                      className="tooltip-icon"
                      title="This value defines the maximum percentage for histogram displays (0-100%)."
                    >
                      ?
                    </span>
                  </label>
                  <div className="form-input-group">
                    <input
                      type="number"
                      id="tcg-percentage"
                      className="form-input"
                      value={tcgPercentage}
                      onChange={handleTcgPercentageChange}
                      disabled={saving}
                      min="0"
                      max="100"
                    />
                    <span className="form-input-suffix">&nbsp;%</span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="profile-error">
                  {error}
                </div>
              )}

              {success && (
                <div className="profile-success">
                  {success}
                </div>
              )}

              <div className="profile-actions">
                <button
                  type="submit"
                  className="profile-save-button"
                  disabled={saving || loading}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProfilePage;

