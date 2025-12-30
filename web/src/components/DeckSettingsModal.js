import React, { useState, useEffect } from 'react';
import './DeckSettingsModal.css';

const DeckSettingsModal = ({ isOpen, onClose, onSave, deckList, isSaving = false }) => {
  const [deckName, setDeckName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [strategy, setStrategy] = useState('');
  const [tradingStatus, setTradingStatus] = useState('play'); // 'wts', 'wtb', or 'play'

  useEffect(() => {
    if (isOpen && deckList) {
      setDeckName(deckList.name || '');
      setIsPrivate(deckList.private || false);
      setStrategy(deckList.strategy || '');
      
      // Determine trading status from selling/buying fields
      if (deckList.selling) {
        setTradingStatus('wts');
      } else if (deckList.buying) {
        setTradingStatus('wtb');
      } else {
        setTradingStatus('play');
      }
    }
  }, [isOpen, deckList]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!deckName.trim()) {
      return; // Don't save if name is empty
    }
    
    // Convert trading status to selling/buying booleans
    const selling = tradingStatus === 'wts';
    const buying = tradingStatus === 'wtb';
    
    onSave({
      name: deckName.trim(),
      private: isPrivate,
      strategy: strategy.trim(),
      selling,
      buying
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <>
      <div className="deck-settings-overlay" onClick={onClose} />
      <div className="deck-settings-modal" onKeyDown={handleKeyPress}>
        <div className="deck-settings-header">
          <h3 className="deck-settings-title">Deck Settings</h3>
          <button className="deck-settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="deck-settings-content">
          {/* Deck Name */}
          <div className="deck-settings-field">
            <label className="deck-settings-label" htmlFor="deck-name-input">
              Deck Name
            </label>
            <input
              id="deck-name-input"
              type="text"
              className="deck-settings-input"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="Enter deck name..."
            />
          </div>

          {/* Visibility */}
          <div className="deck-settings-field">
            <label className="deck-settings-label">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="deck-settings-checkbox"
              />
              <span className="deck-settings-checkbox-label">Make Deck Private</span>
            </label>
            <p className="deck-settings-hint">
              {isPrivate ? 'This deck is private and only visible to you' : 'This deck is public and visible to everyone'}
            </p>
          </div>

          {/* Strategy */}
          <div className="deck-settings-field">
            <label className="deck-settings-label" htmlFor="strategy-input">
              Strategy
            </label>
            <textarea
              id="strategy-input"
              className="deck-settings-textarea"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              placeholder="Enter deck strategy or description..."
              rows={4}
            />
          </div>

          {/* Trading Status */}
          <div className="deck-settings-field">
            <label className="deck-settings-label">Trading Status</label>
            <div className="deck-settings-radio-group">
              <label className="deck-settings-radio-label">
                <input
                  type="radio"
                  name="trading-status"
                  value="wts"
                  checked={tradingStatus === 'wts'}
                  onChange={(e) => setTradingStatus(e.target.value)}
                  className="deck-settings-radio"
                />
                <span>WTS (Want To Sell)</span>
              </label>
              <label className="deck-settings-radio-label">
                <input
                  type="radio"
                  name="trading-status"
                  value="wtb"
                  checked={tradingStatus === 'wtb'}
                  onChange={(e) => setTradingStatus(e.target.value)}
                  className="deck-settings-radio"
                />
                <span>WTB (Want To Buy)</span>
              </label>
              <label className="deck-settings-radio-label">
                <input
                  type="radio"
                  name="trading-status"
                  value="play"
                  checked={tradingStatus === 'play'}
                  onChange={(e) => setTradingStatus(e.target.value)}
                  className="deck-settings-radio"
                />
                <span>Play</span>
              </label>
            </div>
          </div>
        </div>
        <div className="deck-settings-actions">
          <button className="deck-settings-button deck-settings-cancel" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="deck-settings-button deck-settings-save" 
            onClick={handleSave}
            disabled={isSaving || !deckName.trim()}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
};

export default DeckSettingsModal;

