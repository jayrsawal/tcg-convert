import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { fetchUserProfile } from '../lib/api';
import { HiUser, HiLogout } from 'react-icons/hi';
import './NavigationBar.css';

const NavigationBar = ({ className = '' }) => {
  const { user, signOut } = useAuth();
  const { selectedCurrency, setSelectedCurrency } = useCurrency();
  const location = useLocation();
  const [username, setUsername] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (path) => {
    return location.pathname === path;
  };

  useEffect(() => {
    const loadUsername = async () => {
      if (user?.id) {
        try {
          const profile = await fetchUserProfile(user.id);
          if (profile?.username) {
            setUsername(profile.username);
          }
        } catch (error) {
          console.error('Error loading username:', error);
        }
      } else {
        setUsername(null);
      }
    };

    loadUsername();
  }, [user?.id]);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);

  return (
    <header className={`navigation-bar ${className}`}>
      <div className="header-content">
        <Link to="/" className="logo-link" aria-label="StrikerPack Home">
          <img src="/logo-2-small.png" alt="StrikerPack" className="logo-image" />
        </Link>
        <nav className={`header-nav ${isMenuOpen ? 'nav-open' : ''}`}>
          <div className={`nav-links ${isMenuOpen ? 'nav-links-open' : ''}`}>
            {user ? (
              <>
                <div className="nav-primary-links">
                  <Link 
                    to="/inventory" 
                    className={`nav-link ${isActive('/inventory') ? 'nav-link-active' : ''}`}
                  >
                    Browse
                  </Link>
                  <Link 
                    to="/deck-lists" 
                    className={`nav-link ${isActive('/deck-lists') ? 'nav-link-active' : ''}`}
                  >
                    Deck Lists
                  </Link>
                </div>
                <div className="nav-profile-actions">
                  <Link 
                    to="/profile" 
                    className={`nav-link nav-link-icon nav-profile-link ${isActive('/profile') ? 'nav-link-active' : ''}`}
                    title="Profile"
                  >
                    <HiUser className="nav-icon" />
                    {username && (
                      <span className="nav-username">@{username}</span>
                    )}
                    <span className="nav-icon-text">Profile</span>
                  </Link>
                  <button 
                    onClick={signOut} 
                    className="nav-button nav-button-icon" 
                    title="Sign Out"
                  >
                    <HiLogout className="nav-icon nav-icon-red" />
                    <span className="nav-icon-text">Logout</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="nav-auth-links">
                <Link 
                  to="/inventory" 
                  className={`nav-link ${isActive('/inventory') ? 'nav-link-active' : ''}`}
                >
                  Browse
                </Link>
                <Link 
                  to="/deck-lists" 
                  className={`nav-link ${isActive('/deck-lists') ? 'nav-link-active' : ''}`}
                >
                  Deck Lists
                </Link>
                <Link 
                  to="/login" 
                  className={`nav-link ${isActive('/login') ? 'nav-link-active' : ''}`}
                >
                  Log In
                </Link>
                <Link 
                  to="/signup" 
                  className={`nav-link nav-link-primary ${isActive('/signup') ? 'nav-link-active' : ''}`}
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
          <div className="nav-controls">
            <button 
              className={`nav-menu-toggle ${isMenuOpen ? 'is-open' : ''}`}
              type="button"
              aria-label="Toggle navigation"
              onClick={toggleMenu}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="nav-currency-selector">
              <select
                className="nav-currency-select"
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
              >
                <option value="usd">USD</option>
                <option value="cad">CAD</option>
                <option value="eur">EUR</option>
              </select>
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
};

export default NavigationBar;

