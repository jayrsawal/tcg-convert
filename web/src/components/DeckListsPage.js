import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import NavigationBar from './NavigationBar';
import DecksSection from './DecksSection';
import './DeckListsPage.css';

const DeckListsPage = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [selectedCategoryId] = useState(86); // Default to category 86
  const [loading] = useState(false);
  const [error] = useState(null);

  useEffect(() => {
    // Only redirect if auth has finished loading and user is still null
    if (!authLoading && !user) {
      navigate('/login');
      return;
    }
  }, [user, authLoading, navigate]);

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="deck-lists-page">
        <NavigationBar className="deck-lists-header" />
        <main className="deck-lists-main">
          <div className="deck-lists-container">
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading...</p>
            </div>
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
    <div className="deck-lists-page">
      <NavigationBar className="deck-lists-header" />

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

