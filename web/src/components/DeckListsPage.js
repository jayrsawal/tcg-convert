import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import DecksSection from './DecksSection';
import './DeckListsPage.css';

const DeckListsPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [selectedCategoryId] = useState(86); // Default to category 86
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
  }, [user, navigate]);

  if (!user) {
    return null; // Will redirect to login
  }

  return (
    <div className="deck-lists-page">
      <header className="deck-lists-header">
        <div className="header-content">
          <Link to="/" className="logo-link">
            <h1 className="logo">TCGConvert</h1>
          </Link>
          <nav className="header-nav">
            <div className="user-menu">
              <Link to="/inventory" className="nav-link">Inventory</Link>
              <Link to="/deck-lists" className="nav-link">Deck Lists</Link>
              <button onClick={signOut} className="nav-button">Sign Out</button>
            </div>
          </nav>
        </div>
      </header>

      <main className="deck-lists-main">
        <div className="deck-lists-container">
          <h2 className="page-title">My Deck Lists</h2>
          
          {loading && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading your decks...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p className="error-message">⚠️ {error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="deck-lists-layout">
              <DecksSection 
                user={user} 
                categoryId={selectedCategoryId}
                showAddDeck={true}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default DeckListsPage;

