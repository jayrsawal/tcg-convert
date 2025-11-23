import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { HiUser, HiLogout } from 'react-icons/hi';
import './NavigationBar.css';

const NavigationBar = ({ className = '' }) => {
  const { user, signOut } = useAuth();
  const { selectedCurrency, setSelectedCurrency } = useCurrency();
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <header className={`navigation-bar ${className}`}>
      <div className="header-content">
        <Link to="/" className="logo-link">
          <h1 className="logo">TCGConvert</h1>
        </Link>
        <nav className="header-nav">
          {user ? (
            <div className="user-menu">
              <Link 
                to="/inventory" 
                className={`nav-link ${isActive('/inventory') ? 'nav-link-active' : ''}`}
              >
                Inventory
              </Link>
              <Link 
                to="/deck-lists" 
                className={`nav-link ${isActive('/deck-lists') ? 'nav-link-active' : ''}`}
              >
                Deck Lists
              </Link>
              <Link 
                to="/profile" 
                className={`nav-link nav-link-icon ${isActive('/profile') ? 'nav-link-active' : ''}`}
                title="Profile"
              >
                <HiUser className="nav-icon" />
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
          ) : (
            <div className="auth-links">
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
        </nav>
      </div>
    </header>
  );
};

export default NavigationBar;

