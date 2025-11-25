import React, { useState, useEffect } from 'react';
import './DeckNamePromptModal.css';

const DeckNamePromptModal = ({ isOpen, onClose, onConfirm, title, message, defaultValue = '' }) => {
  const [deckName, setDeckName] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      setDeckName(defaultValue);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (deckName.trim()) {
      onConfirm(deckName.trim());
      onClose();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleConfirm();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <>
      <div className="deck-name-prompt-overlay" onClick={onClose} />
      <div className="deck-name-prompt-modal">
        <div className="deck-name-prompt-header">
          <h3 className="deck-name-prompt-title">{title}</h3>
          <button className="deck-name-prompt-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="deck-name-prompt-content">
          {message && <p className="deck-name-prompt-message">{message}</p>}
          <input
            type="text"
            className="deck-name-prompt-input"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            onKeyPress={handleKeyPress}
            onKeyDown={handleKeyPress}
            placeholder="Enter deck name..."
            autoFocus
          />
        </div>
        <div className="deck-name-prompt-actions">
          <button className="deck-name-prompt-button deck-name-prompt-cancel" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="deck-name-prompt-button deck-name-prompt-confirm" 
            onClick={handleConfirm}
            disabled={!deckName.trim()}
          >
            Duplicate
          </button>
        </div>
      </div>
    </>
  );
};

export default DeckNamePromptModal;

